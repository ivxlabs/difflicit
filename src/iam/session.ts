// SPDX-License-Identifier: GPL-3.0-only
// "Sign In" with an ivx account (iam.ivx.run, a Supabase OAuth 2.1 / OpenID Connect provider) as a public
// client: authorization code + PKCE, entirely in the browser. GitHub is then used through iam's /api/github
// proxy, which holds the user's GitHub token; this app never sees it.
//
// Only built into Sign In builds (__IAM__). Nothing here may run at import time: other builds drop this
// module, and `vite dev` loads it without the settings.

import { IAM } from "../config";
import type { Access } from "../lib/access";
import { cached, signal } from "../lib/util";
import type { GitHubStatus } from "../types";

interface Session {
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
}

const SESSION_KEY = "difflicit-session";
const FLOW_KEY = "difflicit-oauth";
const changes = signal();
let grants = 0; // bumped when GitHub access is allowed while the app is open, so views reload
let refreshing: Promise<Session | null> | null = null;

export const iamAccountUrl = () => `${IAM.url}/account`;

// ── Session ──

function load(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
  } catch {
    return null;
  }
}

function save(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  githubStatus.reset();
  changes.notify();
}

/** The access token's claims (sub, email, …). Only decoded here; iam verifies it. */
export function claims(): { sub?: string; email?: string } {
  try {
    return JSON.parse(atob(load()!.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return {};
  }
}

// ── OAuth ──

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const redirectUri = () => location.origin + location.pathname;

const endpoints = cached(async (): Promise<{ authorization_endpoint: string; token_endpoint: string }> => {
  const res = await fetch(`${IAM.supabaseUrl}/auth/v1/.well-known/openid-configuration`);
  if (!res.ok) throw new Error("Sign In is unavailable right now.");
  return res.json();
});

async function tokenRequest(params: Record<string, string>): Promise<Session> {
  const res = await fetch((await endpoints()).token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: IAM.clientId, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description ?? body.error ?? `Sign In failed (${res.status})`);
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? null,
    expires_at: Date.now() / 1000 + (Number(body.expires_in) || 3600),
  };
}

export async function signIn() {
  const verifier = random();
  const state = random();
  sessionStorage.setItem(FLOW_KEY, JSON.stringify({ verifier, state, hash: location.hash }));
  const url = new URL((await endpoints()).authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: IAM.clientId,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state,
    code_challenge: b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
    code_challenge_method: "S256",
  }).toString();
  location.assign(url);
}

/** Sign out here and end the session on iam too, so a copied token stops working as well. */
export async function signOut() {
  const session = load();
  save(null);
  if (session) {
    await fetch(`${IAM.url}/api/github/signout`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` },
    }).catch(() => {}); // already signed out here; an expired session needs no ending
  }
}

/** The session, refreshed first when it is about to expire; null when signed out. */
async function current(): Promise<Session | null> {
  const session = load();
  if (!session || session.expires_at - 60 > Date.now() / 1000) return session;
  if (!session.refresh_token) return save(null), null;
  return (refreshing ??= tokenRequest({ grant_type: "refresh_token", refresh_token: session.refresh_token })
    .then(
      (fresh) => {
        // Not save(): a refresh is the same sign-in, so nothing needs to reload.
        const next = { ...fresh, refresh_token: fresh.refresh_token ?? session.refresh_token };
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        return next;
      },
      () => (save(null), null),
    )
    .finally(() => (refreshing = null)));
}

// ── GitHub through iam ──

/** Whether the user allowed ivx apps to use their GitHub repositories (on their iam account page). */
export const githubStatus = cached(async (): Promise<GitHubStatus> => {
  const session = await current();
  if (!session) return { connected: false };
  const res = await fetch(`${IAM.url}/api/github/status`, { headers: { authorization: `Bearer ${session.access_token}` } });
  if (res.status === 401) return save(null), { connected: false }; // e.g. this app was revoked on iam
  if (!res.ok) throw new Error(`iam.ivx.run: ${res.status}`);
  return res.json();
});

export const ivxAccess: Access = {
  base: `${IAM.url}/api/github/rest`,
  async authorization() {
    const session = await current();
    const connected = session && (await githubStatus().catch(() => null))?.connected;
    return connected ? `Bearer ${session.access_token}` : null;
  },
  snapshot: () => (load() ? `${claims().sub}#${grants}` : null),
  subscribe: changes.subscribe,
};

/** Sign In, or when already signed in, open iam to allow GitHub access. */
export function connectGitHub() {
  if (!load()) return signIn();
  window.open(iamAccountUrl(), "_blank", "noreferrer");
}

/**
 * Run once at startup: finish a Sign In if iam just sent the user back (?code=…&state=…), and re-check
 * GitHub access whenever the user returns to the tab. Returns an error message to show, if any.
 */
export async function initSession(): Promise<string | null> {
  window.addEventListener("focus", async () => {
    // Back from iam's account page, where the user may have just allowed GitHub access.
    if (!load() || (await githubStatus().catch(() => null))?.connected) return;
    githubStatus.reset();
    if ((await githubStatus().catch(() => null))?.connected) {
      grants++;
      changes.notify();
    }
  });

  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return null;
  const flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? "null") as { verifier: string; state: string; hash: string } | null;
  sessionStorage.removeItem(FLOW_KEY);
  const uri = redirectUri();
  history.replaceState(null, "", uri + (flow?.hash ?? location.hash)); // drop ?code=… and return to the page the user was on

  if (params.has("error")) return params.get("error_description") ?? params.get("error");
  if (!flow || flow.state !== params.get("state")) return "That Sign In expired. Please try again.";
  try {
    save(await tokenRequest({ grant_type: "authorization_code", code: params.get("code")!, redirect_uri: uri, code_verifier: flow.verifier }));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
