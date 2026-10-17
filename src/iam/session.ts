// SPDX-License-Identifier: GPL-3.0-only
// "Sign In" with an ivx account (iam.ivx.run, a Supabase OAuth 2.1 / OpenID Connect provider) as a public
// client: authorization code + PKCE, entirely in the browser. GitHub is then used through iam's /api/github
// proxy, which holds the user's GitHub token; this app never sees it.
//
// Only built into Sign In builds (__IAM__). Nothing here may run at import time: other builds drop this
// module, and `vite dev` loads it without the settings.

import { IAM } from "../config";
import type { Access } from "../lib/access";
import { IS_DESKTOP, focusWindow, oauthCallback, openExternal } from "../lib/desktop";
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

/**
 * Desktop: the loopback port the browser comes back to after signing in (src-tauri/src/oauth.rs). The redirect URI
 * http://127.0.0.1:48297/callback must be registered for the OAuth client, exactly.
 */
const LOOPBACK_PORT = 48297;

// Where iam sends the user back. The website returns to the page they were on; the desktop app listens on
// 127.0.0.1 for the browser's redirect (RFC 8252's loopback redirect), which works without a URL scheme.
const redirectUri = () => (IS_DESKTOP ? `http://127.0.0.1:${LOOPBACK_PORT}/callback` : location.origin + location.pathname);

// Desktop: how a failed sign-in reaches the user (App shows it in its banner).
let reportError: (message: string) => void = () => {};
export const onSignInError = (report: (message: string) => void) => {
  reportError = report;
};
let attempt = 0; // the latest sign-in; an earlier one replaced by a new click stays quiet

// The desktop sign-in round-trips through the system browser, so its in-flight state must outlive a webview
// reload; on the website a tab-scoped store is enough.
const flow = () => (IS_DESKTOP ? localStorage : sessionStorage);

// iam's GitHub proxy only allows the website's origin (CORS). From the desktop webview those calls are made
// natively through tauri-plugin-http, which isn't subject to CORS; Supabase and api.github.com send permissive
// CORS and use the ordinary fetch.
const proxyFetch: typeof fetch = IS_DESKTOP
  ? (((input, init) => import("@tauri-apps/plugin-http").then(({ fetch: f }) => f(input as string, init))) as typeof fetch)
  : fetch;

const endpoints = cached(async (): Promise<{ authorization_endpoint: string; token_endpoint: string }> => {
  const res = await proxyFetch(`${IAM.supabaseUrl}/auth/v1/.well-known/openid-configuration`);
  if (!res.ok) throw new Error("Sign In is unavailable right now.");
  return res.json();
});

async function tokenRequest(params: Record<string, string>): Promise<Session> {
  const res = await proxyFetch((await endpoints()).token_endpoint, {
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
  flow().setItem(FLOW_KEY, JSON.stringify({ verifier, state, hash: location.hash }));
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
  if (!IS_DESKTOP) return location.assign(url); // the website navigates itself there and comes back (initSession)

  // The desktop app listens for the browser's way back first, then sends the user off to sign in.
  const mine = ++attempt;
  const back = oauthCallback(LOOPBACK_PORT);
  openExternal(url.toString());
  let error: string | null;
  try {
    error = await completeSignIn(await back);
  } catch (e) {
    error = String(e);
  }
  if (mine !== attempt) return;
  if (error) reportError(error);
  else focusWindow();
}

/** Desktop: finish a sign-in from the URL the browser came back to. Returns an error message, or null. */
async function completeSignIn(rawUrl: string): Promise<string | null> {
  const params = new URL(rawUrl).searchParams;
  const saved = JSON.parse(flow().getItem(FLOW_KEY) ?? "null") as { verifier: string; state: string } | null;
  flow().removeItem(FLOW_KEY);
  if (params.has("error")) return params.get("error_description") ?? params.get("error");
  if (!params.has("code")) return null;
  if (!saved || saved.state !== params.get("state")) return "That Sign In expired. Please try again.";
  try {
    save(await tokenRequest({ grant_type: "authorization_code", code: params.get("code")!, redirect_uri: redirectUri(), code_verifier: saved.verifier }));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Sign out here and end the session on iam too, so a copied token stops working as well. */
export async function signOut() {
  const session = load();
  save(null);
  if (session) {
    await proxyFetch(`${IAM.url}/api/github/signout`, {
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
  const res = await proxyFetch(`${IAM.url}/api/github/status`, { headers: { authorization: `Bearer ${session.access_token}` } });
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
  fetch: proxyFetch,
  snapshot: () => (load() ? `${claims().sub}#${grants}` : null),
  subscribe: changes.subscribe,
};

/** Sign In, or when already signed in, open iam to allow GitHub access. */
export function connectGitHub() {
  if (!load()) return signIn();
  openExternal(iamAccountUrl());
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

  // The desktop app's sign-in comes back to its loopback listener (signIn), not here.
  const params = new URLSearchParams(location.search);
  if (IS_DESKTOP || (!params.has("code") && !params.has("error"))) return null;
  const pending = JSON.parse(flow().getItem(FLOW_KEY) ?? "null") as { verifier: string; state: string; hash: string } | null;
  flow().removeItem(FLOW_KEY);
  const uri = redirectUri();
  history.replaceState(null, "", uri + (pending?.hash ?? location.hash)); // drop ?code=… and return to the page the user was on

  if (params.has("error")) return params.get("error_description") ?? params.get("error");
  if (!pending || pending.state !== params.get("state")) return "That Sign In expired. Please try again.";
  try {
    save(await tokenRequest({ grant_type: "authorization_code", code: params.get("code")!, redirect_uri: uri, code_verifier: pending.verifier }));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
