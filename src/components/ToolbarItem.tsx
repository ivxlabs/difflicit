import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleDownIcon } from "@primer/octicons-react";
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
  /** ⌘/Ctrl + this key toggles the dropdown. */
  shortcut?: string;
  children: (close: () => void) => React.ReactNode;
}

export function ToolbarDropdown({ defaultOpen = false, shortcut, children, ...button }: DropdownProps) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open, close);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === shortcut) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  return (
    <div className="toolbar-dropdown-wrap" ref={ref} style={button.width ? { flex: `0 1 ${button.width}px` } : undefined}>
      <ToolbarButton {...button} width={undefined} caret className={`fill ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} />
      {open && children(close)}
    </div>
  );
}
