// SPDX-License-Identifier: GPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initSession } from "./iam/session";
import "@fontsource/archivo-black/latin-400.css"; // the Difflicit wordmark
import "./styles.css";

// Builds that sign in with ivx finish a pending sign-in (?code=…) before the first render.
const signInError = __IAM__ ? await initSession() : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App signInError={signInError} />
  </StrictMode>,
);
