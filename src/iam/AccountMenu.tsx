import { AlertIcon, LinkExternalIcon, PersonIcon, SignOutIcon } from "@primer/octicons-react";
import { ToolbarButton, ToolbarDropdown } from "../components/ToolbarItem";
import { useSignedIn } from "../lib/access";
import { useAsync } from "../lib/util";
import type { Viewer } from "../types";
import { claims, githubStatus, iamAccountUrl, signIn, signOut } from "./session";

/** The toolbar's account control in Sign In builds. */
export function AccountMenu({ viewer }: { viewer: Viewer | null }) {
  const signedIn = useSignedIn();
  const [status] = useAsync(() => (signedIn ? githubStatus() : null), [signedIn]);

  if (!signedIn) {
    return <ToolbarButton icon={<PersonIcon size={16} />} top="ivx account" main="Sign In" onClick={signIn} />;
  }

  return (
    <ToolbarDropdown
      icon={viewer ? <img className="avatar-img" src={viewer.avatar_url} alt="" /> : <PersonIcon size={16} />}
      top={claims().email ?? "ivx account"}
      main={status?.connected ? `@${status.login}` : "GitHub not connected"}
      width={220}
    >
      {(close) => (
        <div className="dropdown menu action-menu">
          {status && !status.connected && (
            <a className="list-item notice-row" href={iamAccountUrl()} target="_blank" rel="noreferrer" onClick={close}>
              <AlertIcon size={14} />
              <div className="main">
                Allow ivx apps to use your GitHub repositories on your ivx account page to see private analyses and
                fork. Come back to this tab when you're done.
              </div>
            </a>
          )}
          <a className="list-item" href={iamAccountUrl()} target="_blank" rel="noreferrer" onClick={close}>
            <LinkExternalIcon size={14} />
            <div className="main">Manage ivx account</div>
          </a>
          <div
            className="list-item"
            onClick={() => {
              close();
              signOut();
            }}
          >
            <SignOutIcon size={14} />
            <div className="main">Sign out</div>
          </div>
        </div>
      )}
    </ToolbarDropdown>
  );
}
