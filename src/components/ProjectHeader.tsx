// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
import type { Block, Link, Project } from "../types";

/** The project summary bar (click to expand its details), with the page's main action on the right. */
export function ProjectHeader({ project, action, compact }: { project: Project; action?: React.ReactNode; compact?: boolean }) {
  // Compact (embeds) starts collapsed and doesn't remember the choice.
  const [open, setOpen] = useState(() => !compact && localStorage.getItem("difflicit-details") !== "closed");
  const toggle = () => {
    if (!compact) localStorage.setItem("difflicit-details", open ? "closed" : "open");
    setOpen(!open);
  };

  return (
    <section className="project-header">
      <div className="project-header-bar" onClick={toggle}>
        {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        <h1>{project.id}</h1>
        {project.badge && <span className={`pill ${project.badge.tone ?? ""}`}>{project.badge.label}</span>}
        {project.tags[0] && <span className="pill">{project.tags[0]}</span>}
        <span className="summary">{project.summary}</span>
        {action}
      </div>
      {open && project.sections.length > 0 && (
        <div className="project-details">
          {project.sections.map((section) => (
            <div key={section.title} className={section.wide ? "wide" : undefined}>
              <h3>{section.title}</h3>
              {section.blocks.map((block, i) => (
                <BlockView key={i} block={block} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const LinkView = ({ link, className }: { link: Link; className?: string }) =>
  link.url ? (
    <a className={className} href={link.url} target="_blank" rel="noreferrer">
      {link.label}
    </a>
  ) : (
    <span className={className}>{link.label}</span>
  );

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return <p className={block.muted ? "muted" : undefined}>{block.text}</p>;
    case "entry":
      return (
        <div className="entry">
          <p>
            <b>{block.title}</b>
            {block.detail && <> — {block.detail}</>}
          </p>
          {block.notes?.map((note) => (
            <p key={note} className="muted">
              {note}
            </p>
          ))}
        </div>
      );
    case "code":
      return (
        <p className="muted">
          {block.label}: <code>{block.code}</code>
        </p>
      );
    case "tags":
      return (
        <p className="tags">
          {block.items.map((link) => (
            <LinkView key={link.label} link={link} className="pill" />
          ))}
        </p>
      );
    case "links":
      return (
        <ul className="refs">
          {block.items.map((link) => (
            <li key={link.url ?? link.label}>
              <LinkView link={link} />
              {link.note && <span className="muted"> ({link.note})</span>}
            </li>
          ))}
        </ul>
      );
  }
}
