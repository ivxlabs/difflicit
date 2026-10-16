// SPDX-License-Identifier: GPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initSession } from "./iam/session";
import { IS_DESKTOP, openLinksInBrowser } from "./lib/desktop";
import "@fontsource/archivo-black/latin-400.css"; // the Difflicit wordmark
import "./styles.css";

// The macOS desktop window has no title bar (tauri.conf.json); the toolbar takes its place.
if (IS_DESKTOP && navigator.userAgent.includes("Mac")) {
  document.documentElement.classList.add("mac-window");
}
if (IS_DESKTOP) openLinksInBrowser();

// Builds that sign in with ivx finish a pending sign-in (?code=…) before the first render.
const signInError = __IAM__ ? await initSession() : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App signInError={signInError} />
  </StrictMode>,
);
