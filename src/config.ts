// SPDX-License-Identifier: GPL-3.0-only
// Every build setting, read in one place. The instance's settings come from difflicit.config.json;
// CATALOG and PROJECT_REPO can be overridden by environment variables (see vite.config.ts).
import instance from "../difflicit.config.json";

const env = import.meta.env;

export const PRODUCT = "Difflicit";
/** This deployment of Difflicit, e.g. ivx/xnu. */
export const INSTANCE = { name: instance.name, icon: instance.icon };

/** What this instance analyzes, and the naming convention that finds the analyses on GitHub (see lib/projects.ts). */
export const PROJECTS = instance.projects;

/** Where the project catalog lives; empty means the user's own projects (in the desktop app, ~/Difflicit). */
export const CATALOG = env.VITE_CATALOG.replace(/\/$/, "");
export const PROJECT_REPO = env.VITE_PROJECT_REPO;
export const GITHUB_API = "https://api.github.com";

/** Difflicit's documentation; the app keeps its own text short and links here. */
export const docsUrl = (page?: "analyses" | "desktop" | "github" | "instances") =>
  `https://ivx.run/docs/difflicit/${page ? `${page}/` : ""}`;

/** "Sign In" (iam.ivx.run). Only used when __IAM__ is true; empty otherwise, e.g. in `vite dev` without the variables. */
export const IAM = {
  supabaseUrl: env.VITE_SUPABASE_URL ?? "",
  clientId: env.VITE_SUPABASE_CLIENT_ID ?? "",
  url: (env.VITE_IAM_URL ?? "").replace(/\/$/, ""),
};
