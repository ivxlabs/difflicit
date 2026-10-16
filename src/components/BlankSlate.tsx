// SPDX-License-Identifier: GPL-3.0-only
import { SyncIcon } from "@primer/octicons-react";
import { docsUrl } from "../config";

/** The centered empty / error / loading state used across the app. */
export function BlankSlate({ icon, title, children }: { icon?: React.ReactNode; title?: string; children?: React.ReactNode }) {
  return (
    <div className="blank-slate">
      {icon}
      {title && <h2>{title}</h2>}
      {children}
    </div>
  );
}

/** Where the explanation lives: the documentation, so the app's own text stays short. */
export const DocsLink = ({ page, children = "How it works" }: { page?: Parameters<typeof docsUrl>[0]; children?: React.ReactNode }) => (
  <a href={docsUrl(page)} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export const Spinner = () => <BlankSlate icon={<SyncIcon size={24} className="spinner big-icon" />} />;
