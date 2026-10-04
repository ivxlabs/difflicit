/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the static JSON API, e.g. https://cdn.ivx.run/applesec/api */
  readonly VITE_API_BASE: string;
  /** owner/name of this project's repository (Star button). */
  readonly VITE_PROJECT_REPO: string;
  // Sign In (iam.ivx.run). Only set in builds where __IAM__ is true.
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_CLIENT_ID?: string;
  readonly VITE_IAM_URL?: string;
}

/** True when the build was configured to sign in with ivx (see vite.config.ts). Constant-folded at build time. */
declare const __IAM__: boolean;
