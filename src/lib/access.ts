// SPDX-License-Identifier: GPL-3.0-only
import { useSyncExternalStore } from "react";
import { GITHUB_API } from "../config";
import { ivxAccess } from "../iam/session";
import { signal } from "./util";

/** How the app reaches GitHub as the user. */
export interface Access {
  /** Base URL for GitHub REST calls made as the user: api.github.com itself, or a proxy mirroring it. */
  base: string;
  /** Authorization header for calls as the user; null means call GitHub anonymously. */
  authorization(): Promise<string | null>;
  /** Changes whenever the user signs in or out, or their GitHub access changes. */
  snapshot(): string | null;
  subscribe(listener: () => void): () => void;
}

// Bring your own token: a GitHub personal access token kept in this browser and sent only to api.github.com.
const TOKEN_KEY = "difflicit-github-token";
const changes = signal();

export const pat = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set(value: string | null) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    changes.notify();
  },
};

const patAccess: Access = {
  base: GITHUB_API,
  authorization: async () => (pat.get() ? `Bearer ${pat.get()}` : null),
  snapshot: pat.get,
  subscribe: changes.subscribe,
};

/** Sign In builds (see vite.config.ts) use GitHub through iam.ivx.run; all others, the user's own token. */
export const access: Access = __IAM__ ? ivxAccess : patAccess;

/** What connecting is called in this build. */
export const CONNECT_LABEL = __IAM__ ? "Sign In" : "Connect GitHub";

export const useSignedIn = () => useSyncExternalStore(access.subscribe, access.snapshot);
