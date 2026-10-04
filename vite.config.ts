import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import instance from "./difflicit.config.json";

// The instance's defaults; VITE_* environment variables (set by CI) override them.
const DEFAULTS = {
  VITE_API_BASE: instance.apiBase,
  VITE_PROJECT_REPO: instance.projectRepo,
};

// "Sign In" (iam.ivx.run) is only built when all of these are set; otherwise the bundle
// contains none of it and users bring their own GitHub token.
const IAM_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_CLIENT_ID", "VITE_IAM_URL"] as const;

const originOf = (url: string) => (url.startsWith("http") ? new URL(url).origin : "");

/**
 * The app holds GitHub credentials and renders README HTML from arbitrary repos, so lock down
 * where scripts can come from and where data can be sent.
 */
function csp(connect: string[]): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src * data:",
    `connect-src 'self' https://api.github.com https://raw.githubusercontent.com ${connect.filter(Boolean).join(" ")}`.trim(),
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "csp",
    apply: "build", // Vite's dev server injects inline scripts for HMR.
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  for (const [key, value] of Object.entries(DEFAULTS)) process.env[key] = env[key] || value;
  const iam = IAM_VARS.every((key) => env[key]);

  return {
    base: "./", // works on a custom domain and under /<repo>/ on github.io
    build: { target: "es2022" }, // top-level await in main.tsx
    define: { __IAM__: JSON.stringify(iam) },
    plugins: [
      react(),
      csp([
        originOf(process.env.VITE_API_BASE!),
        ...(iam ? [originOf(env.VITE_SUPABASE_URL), originOf(env.VITE_IAM_URL)] : []),
      ]),
    ],
  };
});
