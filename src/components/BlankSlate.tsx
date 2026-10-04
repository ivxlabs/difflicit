// SPDX-License-Identifier: GPL-3.0-only
import { SyncIcon } from "@primer/octicons-react";

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

export const Spinner = () => <BlankSlate icon={<SyncIcon size={24} className="spinner big-icon" />} />;
