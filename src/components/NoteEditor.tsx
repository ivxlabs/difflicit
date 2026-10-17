// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { KebabHorizontalIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from "@primer/octicons-react";
import { createNote, fileInfo, renderMarkdown, writeNote } from "../lib/desktop";
import { joinBlocks, splitBlocks } from "../lib/diffmd";
import { useAsync } from "../lib/util";
import { BlankSlate, DocsLink, Spinner } from "./BlankSlate";
import { NoteHtml, Notes } from "./Notes";

interface Props {
  /** The project folder, and the note's path in it. */
  project: string;
  path: string;
  /** Bumped when the project is read again (the window regained focus): the note may have been edited elsewhere. */
  reads: number;
  /** After a block is saved. */
  onSaved: () => void;
}

/**
 * Desktop: a note (diffmd), block by block. Every block shows rendered; Edit opens just that block's source, and
 * it's saved to the file when you're done with it (or leave the note).
 */
export function NoteBlocks(props: Props) {
  return <Blocks key={`${props.project}\n${props.path}`} {...props} />;
}

/** The block being edited: its index (where it goes, for a new one), its source so far, and whether it's new. */
interface Editing {
  at: number;
  draft: string;
  isNew: boolean;
}

function Blocks({ project, path, reads, onSaved }: Props) {
  // Read again on `reads`, keeping the note on screen meanwhile.
  const [info, loadError] = useAsync(() => fileInfo(project, path), [project, path], [reads]);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest state for the handlers below, which outlive a render (saving on the way out).
  const latest = useRef({ blocks, editing });
  latest.current = { blocks, editing };

  // The note as read, but never under a block being edited: that would lose what's typed.
  useEffect(() => {
    if (info?.kind === "notes" && !latest.current.editing) setBlocks(splitBlocks(info.text));
  }, [info]);

  /** Save the edited block, if it changed; true unless saving failed. */
  const commit = async () => {
    const { blocks: now, editing: e } = latest.current;
    if (!e) return true;
    if (!e.isNew && e.draft === now[e.at]) {
      setEditing(null);
      return true;
    }
    const next = [...now];
    next.splice(e.at, e.isNew ? 0 : 1, e.draft);
    try {
      const text = joinBlocks(next);
      await writeNote(project, path, text);
      // Read back as blocks: a block typed with blank lines in it becomes several.
      setBlocks(splitBlocks(text));
      setEditing(null);
      setError(null);
      onSaved();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  // One block is edited at a time (the others' actions hide meanwhile), so the indices below are current.
  const edit = (at: number, isNew = false) => setEditing({ at, draft: isNew ? "" : blocks[at], isNew });

  const remove = async (at: number) => {
    const next = blocks.filter((_, i) => i !== at);
    try {
      await writeNote(project, path, joinBlocks(next));
      setBlocks(next);
      onSaved();
    } catch (err) {
      setError(String(err));
    }
  };

  // Leaving the note (another file, another project) saves the block being edited.
  useEffect(
    () => () => void commit(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!info)
    return loadError ? (
      <BlankSlate title={path}>
        <p>{loadError}</p>
      </BlankSlate>
    ) : (
      <Spinner />
    );
  if (info.kind !== "notes") {
    return (
      <BlankSlate title={path}>
        <p>Only notes (.diffmd or .md) can be edited here.</p>
      </BlankSlate>
    );
  }
  if (info.truncated) {
    return (
      <>
        <div className="notice">This note is over 512 KB: shown read-only. Edit it in your own editor.</div>
        <Notes html={info.html} />
      </>
    );
  }

  const editor = (e: Editing) => (
    <BlockEditor
      key={`edit-${e.at}`}
      draft={e.draft}
      onChange={(draft) => setEditing({ ...e, draft })}
      onDone={() => void commit()}
      onCancel={() => setEditing(null)}
    />
  );

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <article className="markdown notes note-blocks">
        {blocks.map((text, i) => (
          <div key={i}>
            {editing?.isNew && editing.at === i && editor(editing)}
            {editing && !editing.isNew && editing.at === i ? (
              editor(editing)
            ) : (
              <Block
                text={text}
                busy={Boolean(editing)}
                onEdit={() => edit(i)}
                onAddBelow={() => edit(i + 1, true)}
                onDelete={() => void remove(i)}
              />
            )}
          </div>
        ))}
        {editing?.isNew && editing.at === blocks.length && editor(editing)}
        {!editing && (
          <button className="btn note-add" onClick={() => edit(blocks.length, true)}>
            <PlusIcon size={14} /> Add block
          </button>
        )}
      </article>
    </>
  );
}

/** A block as it reads: rendered exactly like the saved note, with its actions on hover (none while another is edited). */
function Block({
  text,
  busy,
  onEdit,
  onAddBelow,
  onDelete,
}: {
  text: string;
  busy: boolean;
  onEdit: () => void;
  onAddBelow: () => void;
  onDelete: () => void;
}) {
  const [html] = useAsync(() => renderMarkdown(text), [text]);
  const [menu, setMenu] = useState(false);
  return (
    <div className="note-block" onDoubleClick={busy ? undefined : onEdit} onMouseLeave={() => setMenu(false)}>
      {html === null ? <pre className="notes-raw">{text}</pre> : <NoteHtml html={html} />}
      {!busy && (
        <div className="note-block-actions">
          <button className="btn ghost" onClick={onEdit} title="Edit this block (or double-click it)">
            <PencilIcon size={14} /> Edit
          </button>
          <button className="btn ghost" onClick={() => setMenu((m) => !m)} aria-label="More" title="More">
            <KebabHorizontalIcon size={14} />
          </button>
          {menu && (
            <div className="dropdown menu note-block-menu">
              <button className="list-item" onClick={onAddBelow}>
                <PlusIcon size={14} /> Add a block below
              </button>
              <button className="list-item" onClick={onDelete}>
                <TrashIcon size={14} /> Delete block
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A block's source, being edited: ⌘Enter (or ⌘S) is done, Esc cancels. Emptying it deletes the block. */
function BlockEditor({
  draft,
  onChange,
  onDone,
  onCancel,
}: {
  draft: string;
  onChange: (draft: string) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="note-block editing">
      <textarea
        className="note-block-text mono"
        value={draft}
        rows={Math.max(3, draft.split("\n").length + 1)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && (e.key === "Enter" || e.key.toLowerCase() === "s")) {
            e.preventDefault();
            onDone();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        spellCheck={false}
        autoFocus
        placeholder={"Markdown, or a patch:\n```diff\n-old\n+new\n```"}
      />
      <div className="note-block-bar">
        <span className="muted small-note">Markdown · ```diff blocks show as diffs · ⌘Enter to finish, Esc to cancel</span>
        <span className="grow" />
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Desktop: name a new note; it's created as `<name>.diffmd` and opened. */
export function NewNoteDialog({ project, onCreated, onClose }: { project: string; onCreated: (path: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await createNote(project, name.trim() || undefined));
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={create}>
        <header>
          <span className="grow">New note</span>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            <XIcon size={16} />
          </button>
        </header>
        <div className="content">
          <p className="muted">
            Notes are Markdown with patch diffs in them. <DocsLink page="diffmd">diffmd</DocsLink>
          </p>
          <label className="field">
            <span>Name</span>
            <input className="input" autoFocus placeholder="README" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <span className="muted small-note">Saved as {name.trim() ? name.trim().replace(/ /g, "-") : "README"}.diffmd in the project.</span>
          {error && <div className="notice error">{error}</div>}
        </div>
        <footer>
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </form>
    </div>
  );
}
