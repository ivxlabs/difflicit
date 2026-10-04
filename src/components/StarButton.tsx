// SPDX-License-Identifier: GPL-3.0-only
import { MarkGithubIcon, StarIcon } from "@primer/octicons-react";
import { PROJECT_REPO } from "../config";
import { getRepo } from "../lib/github";
import { cached, useAsync } from "../lib/util";
import { ToolbarButton } from "./ToolbarItem";

// One request per page load, shared by every StarButton. Without a count (e.g. rate limited) the button still shows.
const stars = cached(() =>
  getRepo(PROJECT_REPO).then(
    (r) => (r ? Intl.NumberFormat(undefined, { notation: "compact" }).format(r.stargazers_count) : null),
    () => null,
  ),
);

export function StarButton({ variant }: { variant: "toolbar" | "button" }) {
  const [count] = useAsync(stars, []);
  const href = `https://github.com/${PROJECT_REPO}`;

  return variant === "toolbar" ? (
    <ToolbarButton
      icon={<MarkGithubIcon size={16} />}
      top={PROJECT_REPO}
      main={
        <>
          <StarIcon size={12} /> Star{count && ` · ${count}`}
        </>
      }
      href={href}
      title={`Star ${PROJECT_REPO} on GitHub`}
    />
  ) : (
    <a className="btn star-btn" href={href} target="_blank" rel="noreferrer">
      <StarIcon size={14} /> Star on GitHub
      {count && <span className="star-count">{count}</span>}
    </a>
  );
}
