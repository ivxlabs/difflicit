// SPDX-License-Identifier: GPL-3.0-only
import { useCallback, useRef, useState } from "react";
import { TriangleDownIcon } from "@primer/octicons-react";
import { useCommand } from "../lib/commands";
import { useOutside } from "./useOutside";

interface ButtonProps {
  icon: React.ReactNode;
  top: React.ReactNode;
  main: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  width?: number;
  title?: string;
  className?: string;
  caret?: boolean;
}

/** A GitHub Desktop toolbar item: icon, small caption, bold value. Renders a link when given `href`. */
export function ToolbarButton({ icon, top, main, href, onClick, disabled, width, title, className = "", caret }: ButtonProps) {
  const inner = (
    <>
      {icon}
      <span className="labels">
        <span className="label-top">{top}</span>
        <span className="label-main">{main}</span>
      </span>
      {caret && <TriangleDownIcon size={16} className="caret" />}
    </>
  );
  // Items with a width shrink when the window is narrow; the rest keep their natural size.
  const props = { className: `toolbar-button ${className}`, style: width ? { flex: `0 1 ${width}px` } : undefined, title };
  return href ? (
    <a {...props} href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <button {...props} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

interface DropdownProps extends Omit<ButtonProps, "href" | "onClick" | "caret" | "className"> {
  defaultOpen?: boolean;
  /** The command (lib/commands.ts) that toggles the dropdown, e.g. from ⌘O or the command palette. */
  command?: string;
  children: (close: () => void) => React.ReactNode;
}

export function ToolbarDropdown({ defaultOpen = false, command, children, ...button }: DropdownProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);

  useCommand(command ?? "", () => setOpen((o) => !o), Boolean(command) && !button.disabled);

  return (
    <div className="toolbar-dropdown-wrap" ref={ref} style={button.width ? { flex: `0 1 ${button.width}px` } : undefined}>
      <ToolbarButton {...button} width={undefined} caret className={`fill ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} />
      {open && children(close)}
    </div>
  );
}
