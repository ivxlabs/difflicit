// SPDX-License-Identifier: GPL-3.0-only
/** The 💀 used in place of logos (the GitHub mark only appears on the Star button). Sized like an octicon. */
export function Skull({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`skull ${className}`} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true">
      💀
    </span>
  );
}
