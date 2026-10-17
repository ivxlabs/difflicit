// SPDX-License-Identifier: GPL-3.0-only
// What a change was probably about, predicted without AI: patterns that security fixes (and non-fixes) leave in a
// diff, each with a weight and a reason, matched against the changed lines. Every finding keeps the lines that
// triggered it, so a prediction can always be checked against the diff itself. Works on source diffs and on
// radare2's disassembly diffs (instructions, and the names of called functions).

import { type DiffFile, type DiffLine, diffLines } from "./diff";

export interface Evidence {
  /** The diff file (or binary function) and the line's index in diffLines(), for jumping to it. */
  file: string;
  line: number;
  text: string;
}

export interface Finding {
  kind: string;
  label: string;
  phrase: string;
  /** Why this pattern suggests that kind of change. */
  why: string;
  score: number;
  evidence: Evidence[];
}

export interface Prediction {
  headline: string;
  confidence: "strong" | "likely" | "possible" | "none";
  findings: Finding[];
  /** Where the change is: the files or functions with the most evidence, else the most changed. */
  areas: string[];
  stats: { files: number; additions: number; deletions: number };
}

type Side = "added" | "removed";
interface Rule {
  kind: string;
  /** Which changed lines it looks at, and the pattern. */
  side: Side;
  re: RegExp;
  weight: number;
}

interface Kind {
  label: string;
  /** How the headline names it: "Most likely <phrase> in …". */
  phrase: string;
  why: string;
}

const KINDS: Record<string, Kind> = {
  bounds: { label: "Bounds check", phrase: "a bounds check fix", why: "Comparisons on sizes, lengths or indices were added or tightened." },
  validation: { label: "Input validation", phrase: "added input validation", why: "New early exits that reject bad input with an error." },
  overflow: { label: "Integer overflow check", phrase: "an integer overflow fix", why: "Overflow-checked arithmetic or explicit limits were added." },
  inttype: { label: "Integer width or signedness", phrase: "an integer width or signedness fix", why: "An integer's type changed in otherwise identical code." },
  null: { label: "NULL / validity check", phrase: "a NULL pointer fix", why: "A pointer is now checked before it's used." },
  lifetime: { label: "Lifetime / use-after-free", phrase: "a use-after-free or lifetime fix", why: "References are now taken or dropped differently, or freed pointers are cleared." },
  locking: { label: "Locking / race condition", phrase: "a race condition fix", why: "Locks or atomics were added around shared state." },
  uninit: { label: "Uninitialized memory / info leak", phrase: "an uninitialized memory or info leak fix", why: "Memory is now zeroed before it's used or copied out." },
  typecheck: { label: "Type confusion", phrase: "a type confusion fix", why: "An object's type or kind is now checked before it's used as one." },
  permission: { label: "Permission / entitlement check", phrase: "a missing permission check", why: "The caller's privileges or entitlements are now checked." },
  copy: { label: "Unsafe copy or string handling", phrase: "an unsafe copy fix", why: "Unbounded copies were replaced, or copy sizes changed." },
  hardening: { label: "Hardening / exploit mitigation", phrase: "hardening", why: "Assertions, panics or mitigations (PAC, typed allocations, zone checks) were added." },
  removed: { label: "Code removed", phrase: "removed code (less attack surface)", why: "Much more was deleted than added: a feature or code path was taken out." },
  docs: { label: "Comments and documentation only", phrase: "a comments-only change", why: "Only comments or blank lines changed." },
  format: { label: "Formatting only", phrase: "a formatting-only change", why: "The changed lines are identical apart from whitespace." },
  rename: { label: "Rename / refactor", phrase: "a rename or refactor", why: "Lines changed only in the names they use." },
};

const SIZEY = String.raw`\b\w*(len|length|size|sz|count|cnt|num|idx|index|offset|off|pos|nbytes|bytes|cap|capacity|limit|max|min|end|bound)\w*\b`;

// Source code (C, C++, Objective-C, Swift, Rust…): matched against changed lines without comments.
const SOURCE: Rule[] = [
  { kind: "bounds", side: "added", re: new RegExp(String.raw`\bif\s*\(.*${SIZEY}.*(<=?|>=?)|\bif\s*\(.*(<=?|>=?).*${SIZEY}`, "i"), weight: 2 },
  { kind: "bounds", side: "added", re: /\b(MIN|MAX|min|max|clamp)\s*\(/, weight: 1 },
  { kind: "validation", side: "added", re: /\breturn\s+(-?E[A-Z0-9_]{2,}|KERN_[A-Z_]+|kIOReturn\w+|-1\b|false\b|NULL\b|nullptr\b|nil\b|Err\()/, weight: 1.5 },
  { kind: "validation", side: "added", re: /\bgoto\s+(out|err|fail|bad|done|exit|cleanup)\w*/, weight: 1 },
  {
    kind: "overflow",
    side: "added",
    re: /\b(os_(add|sub|mul)3?_overflow|__builtin_(add|sub|mul)_overflow|checked_(add|sub|mul)|overflowing_\w+|S?SIZE_MAX|U?INT(8|16|32|64)?_MAX|U?LONG_MAX)\b|overflow/i,
    weight: 4, // an explicit overflow check is unmistakable
  },
  { kind: "null", side: "added", re: /\bif\s*\(\s*!\s*[\w>.\-[\]]+\s*\)|[!=]=\s*(NULL|nullptr|nil|None)\b|\b(NULL|nullptr|nil)\s*[!=]=/, weight: 2 },
  { kind: "lifetime", side: "added", re: /\b(\w*retain\w*|\w*release\w*|os_ref_\w+|\w*_reference\w*|\w*_deallocate\w*|\w*refcnt\w*|\w*refcount\w*|kref_\w+)\s*\(/i, weight: 2 },
  { kind: "lifetime", side: "added", re: /^\s*[\w>.\-[\]]+\s*=\s*(NULL|nullptr|nil)\s*;/, weight: 1.5 },
  { kind: "lifetime", side: "removed", re: /\b(\w*retain\w*|\w*release\w*|os_ref_\w+|\w*_deallocate\w*|free)\s*\(/i, weight: 1 },
  {
    kind: "locking",
    side: "added",
    re: /\b(lck_(mtx|rw|spin)_\w+|simple_lock\w*|spin_?lock\w*|pthread_mutex_\w+|mutex_\w+|os_unfair_lock\w*|\w+_lock|\w+_unlock|atomic_\w+|OSCompareAndSwap\w*|disable_preemption|enable_preemption)\s*\(|@synchronized/i,
    weight: 2.5,
  },
  { kind: "uninit", side: "added", re: /\b(bzero|explicit_bzero|memset_s|memset|calloc|IOMallocZero\w*)\s*\(|=\s*\{\s*0?\s*\}|\b(Z_ZERO|M_ZERO)\b|kalloc\w*zero/i, weight: 2.5 },
  {
    kind: "typecheck",
    side: "added",
    re: /\b(OSDynamicCast|OSRequiredCast|dynamic_cast|isKindOfClass|metaCast|typeid|io_kotype|ip_kotype|IKOT_\w+)\b|(->|\.)(type|kind|_type)\s*[!=]=|\bkind\s*[!=]=/,
    weight: 2.5,
  },
  {
    kind: "permission",
    side: "added",
    re: /\b(\w*[Ee]ntitlement\w*|csr_check|sandbox_check\w*|mac_\w+_check\w*|kauth_\w+|suser|proc_suser|priv_check\w*|issetugid|proc_issetugid|task_is_\w+|csproc_\w+|cs_valid\w*)\b/,
    weight: 3,
  },
  { kind: "copy", side: "removed", re: /\b(strcpy|strcat|sprintf|vsprintf|gets)\s*\(/, weight: 2.5 },
  { kind: "copy", side: "added", re: /\b(strlcpy|strlcat|snprintf|vsnprintf|strncpy|strscpy|memcpy_s)\s*\(/, weight: 1.5 },
  { kind: "copy", side: "added", re: /\b(copyin|copyout|copyinstr|copy_from_user|copy_to_user|memcpy|memmove|bcopy)\s*\(/, weight: 1 },
  { kind: "hardening", side: "added", re: /\b(assert\w*|os_crash\w*|__builtin_trap|BUG_ON|WARN_ON|release_assert|guarantee)\s*\(|\bpanic\s*\(/, weight: 2 },
  { kind: "hardening", side: "added", re: /\b(zone_require\w*|kalloc_type\w*|KALLOC_TYPE\w*|ptrauth_\w+|zalloc_ro\w*|kmem_guard\w*)\b/, weight: 2.5 },
];

// Disassembly (arm64, x86): instructions, plus the source rules applied to called functions' names.
const ASM: Rule[] = [
  { kind: "bounds", side: "added", re: /^\s*(cmp|cmn|ccmp)\b/, weight: 1.5 },
  { kind: "bounds", side: "added", re: /^\s*(b\.(hi|hs|lo|ls|gt|ge|lt|le|cs|cc)|ja|jae|jb|jbe|jg|jge|jl|jle)\b/, weight: 1 },
  { kind: "null", side: "added", re: /^\s*(cbz|cbnz)\b|^\s*test\s+(\w+),\s*\2\b/, weight: 1.5 },
  { kind: "overflow", side: "added", re: /^\s*(umulh|smulh)\b|^\s*b\.(vs|vc)\b|^\s*j[n]?o\b/, weight: 1.5 },
];
const CALL = /^\s*(bl|blr|blraa|blraaz|call|jmp|b)\s+(.*)$/;

const COMMENT = /^\s*(\/\/|\/\*|\*|#(?!include|define|if|else|endif)|--|;)/;
const TYPES = /\b(unsigned|signed|int|long|short|char|u?int(8|16|32|64)_t|size_t|ssize_t|off_t|uint|NSU?Integer|u?int(8|16|32|64)|[ui](8|16|32|64)|usize|isize)\b/g;
const COMPARATOR = /<=|>=|<|>/g;

const squash = (s: string) => s.replace(/\s+/g, "");
const identifiers = (s: string) => s.replace(/[A-Za-z_]\w*/g, "x");

/** The function a hunk is in, from its header ("@@ -1,7 +1,8 @@ static int foo(…)"). */
const hunkFunction = (hunk: string) => hunk.replace(/^@@[^@]*@@\s*/, "").replace(/\(.*$/, "").split(/\s+/).pop() ?? "";

interface Block {
  file: string;
  area: string;
  removed: { l: DiffLine; i: number }[];
  added: { l: DiffLine; i: number }[];
}

/** Each run of removed and added lines, with the function (or file) it's in. */
function blocks(file: DiffFile, asm: boolean): Block[] {
  const out: Block[] = [];
  let area = file.path;
  let cur: Block | null = null;
  diffLines(file).forEach((l, i) => {
    if (l.type === "hunk") {
      const fn = hunkFunction(l.text);
      area = !asm && fn ? `${file.path} (${fn})` : file.path;
    }
    if (l.type === "add" || l.type === "del") {
      cur ??= { file: file.path, area, removed: [], added: [] };
      (l.type === "add" ? cur.added : cur.removed).push({ l, i });
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

/**
 * Predict what a change was about from its diff: source files, or disassembly diffs of a binary's functions
 * (`asm`). `extraRemoved` counts code that's gone without a diff of its own (e.g. a binary's removed functions).
 */
export function predict(files: DiffFile[], { asm = false, extraRemoved = 0 } = {}): Prediction {
  const found = new Map<string, Finding>();
  const areaScore = new Map<string, number>();
  const hit = (kind: string, weight: number, file: string, area: string, l: { l: DiffLine; i: number }) => {
    const f = found.get(kind) ?? { kind, ...KINDS[kind], score: 0, evidence: [] };
    f.score += weight;
    if (f.evidence.length < 8 && !f.evidence.some((e) => e.file === file && e.line === l.i)) f.evidence.push({ file, line: l.i, text: l.l.text.trim() });
    found.set(kind, f);
    areaScore.set(area, (areaScore.get(area) ?? 0) + weight);
  };

  let additions = 0;
  let deletions = 0;
  let code = 0; // changed lines that are neither comments nor blank
  let onlyWhitespace = true;
  let onlyRenames = true;

  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
    for (const b of blocks(file, asm)) {
      const lines = { added: b.added, removed: b.removed };
      for (const side of ["added", "removed"] as Side[]) {
        for (const x of lines[side]) {
          const text = x.l.text;
          if (!text.trim() || (!asm && COMMENT.test(text))) continue;
          code++;
          for (const r of asm ? ASM : SOURCE) if (r.side === side && r.re.test(text)) hit(r.kind, r.weight, b.file, b.area, x);
          // A call's target names what it does: judge it like source (bl _lck_mtx_lock → locking).
          const call = asm ? CALL.exec(text) : null;
          if (call) for (const r of SOURCE) if (r.side === side && r.re.test(`${call[2]}(`)) hit(r.kind, r.weight, b.file, b.area, x);
        }
      }
      // Line pairs: the same line before and after, changed in a telling way.
      for (let k = 0; k < Math.min(b.removed.length, b.added.length); k++) {
        const [was, now] = [b.removed[k].l.text, b.added[k].l.text];
        if (squash(was) !== squash(now)) onlyWhitespace = false;
        if (identifiers(squash(was)) !== identifiers(squash(now))) onlyRenames = false;
        if (asm) continue;
        const cmpWas = was.match(COMPARATOR)?.join() ?? "";
        const cmpNow = now.match(COMPARATOR)?.join() ?? "";
        if (cmpWas && cmpNow && cmpWas !== cmpNow && was.replace(COMPARATOR, "<") === now.replace(COMPARATOR, "<")) {
          hit("bounds", 3, b.file, b.area, b.added[k]);
        }
        const typesWas = was.match(TYPES)?.join() ?? "";
        const typesNow = now.match(TYPES)?.join() ?? "";
        if (typesWas !== typesNow && squash(was.replace(TYPES, "T")) === squash(now.replace(TYPES, "T"))) hit("inttype", 2, b.file, b.area, b.added[k]);
      }
      if (b.removed.length !== b.added.length) {
        onlyWhitespace = false;
        onlyRenames = false;
      }
    }
  }

  // Whole-change verdicts.
  const removedLines = deletions + extraRemoved;
  if (removedLines >= 10 && removedLines > 3 * additions) {
    found.set("removed", { kind: "removed", ...KINDS.removed, score: Math.min(6, removedLines / Math.max(additions, 1)), evidence: [] });
  }
  if (additions + deletions > 0 && code === 0 && !asm) found.set("docs", { kind: "docs", ...KINDS.docs, score: 8, evidence: [] });
  else if (additions + deletions > 0 && onlyWhitespace && !asm) found.set("format", { kind: "format", ...KINDS.format, score: 8, evidence: [] });
  else if (additions + deletions > 0 && onlyRenames && !asm && !found.size) found.set("rename", { kind: "rename", ...KINDS.rename, score: 3, evidence: [] });

  const findings = [...found.values()].sort((a, b) => b.score - a.score);
  const top = findings[0];
  const confidence: Prediction["confidence"] = !top ? "none" : top.score >= 8 ? "strong" : top.score >= 4 ? "likely" : top.score >= 1.5 ? "possible" : "none";
  const ranked = [...areaScore.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const areas = (ranked.length ? ranked : [...files].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions)).map((f) => f.path)).slice(0, 3);
  const where = areas.length ? ` in ${areas[0]}` : "";
  const lead = { strong: "Almost certainly", likely: "Most likely", possible: "Possibly", none: "" }[confidence];
  const headline =
    additions + deletions === 0 && !extraRemoved
      ? "These two versions are identical."
      : confidence === "none"
        ? `No clear pattern: this doesn't look like a typical security fix${where}.`
        : `${lead} ${top.phrase}${where}.`;

  return { headline, confidence, findings, areas, stats: { files: files.length, additions, deletions } };
}
