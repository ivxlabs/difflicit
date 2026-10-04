// Every build setting, read in one place. The instance's settings come from difflicit.config.json;
// API_BASE and PROJECT_REPO can be overridden by environment variables (see vite.config.ts).
import instance from "../difflicit.config.json";

const env = import.meta.env;

export const PRODUCT = "Difflicit";
/** This deployment of Difflicit, e.g. ivx/xnu. */
export const INSTANCE = { name: instance.name, icon: instance.icon };

export const API_BASE = env.VITE_API_BASE.replace(/\/$/, "");
export const PROJECT_REPO = env.VITE_PROJECT_REPO;
export const GITHUB_API = "https://api.github.com";

/** "Sign In" (iam.ivx.run). Only used when __IAM__ is true; empty otherwise, e.g. in `vite dev` without the variables. */
export const IAM = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? "",
  clientId: env.VITE_SUPABASE_CLIENT_ID ?? "",
  url: (env.VITE_IAM_URL ?? "").replace(/\/$/, ""),
};
