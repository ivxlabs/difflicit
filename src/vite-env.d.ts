// SPDX-License-Identifier: GPL-3.0-only
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the project catalog, e.g. https://cdn.ivx.run/applesec/api; empty for the user's own projects. */
  readonly VITE_CATALOG: string;
  /** owner/name of this project's repository (Star button). */
  readonly VITE_PROJECT_REPO: string;
  // Sign In (iam.ivx.run). Only set in builds where __IAM__ is true.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_CLIENT_ID?: string;
  readonly VITE_IAM_URL?: string;
}

/** True when the build was configured to sign in with ivx (see vite.config.ts). Constant-folded at build time. */
declare const __IAM__: boolean;

// noVNC ships no type declarations; we use the RFB class loosely in the desktop VNC viewer.
declare module "@novnc/novnc" {
  const RFB: new (target: Element, url: string, options?: { credentials?: { password?: string } }) => {
    scaleViewport: boolean;
    background: string;
    focusOnClick: boolean;
    addEventListener(type: string, listener: (e: CustomEvent) => void): void;
    sendCredentials(credentials: { password?: string }): void;
    disconnect(): void;
  };
  export default RFB;
}
