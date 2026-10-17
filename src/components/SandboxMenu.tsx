// SPDX-License-Identifier: GPL-3.0-only
import { useState } from "react";
import { DeviceDesktopIcon, PencilIcon, PlusIcon, TrashIcon } from "@primer/octicons-react";
import { type Sandbox, newSandboxId, removeSandbox, sandboxes, saveSandbox } from "../lib/sandbox";
import { ToolbarDropdown } from "./ToolbarItem";

/** Desktop: the app-wide list of VNC sandboxes (VMs, boxes). Pick one to open it in the viewer. */
export function SandboxMenu({ onConnect }: { onConnect: (sandbox: Sandbox) => void }) {
  const [list, setList] = useState<Sandbox[]>(sandboxes);
  const [editing, setEditing] = useState<Sandbox | null>(null);

  return (
    <ToolbarDropdown icon={<DeviceDesktopIcon size={16} />} top="Sandbox" main={list.length ? `${list.length} saved` : "Connect VNC"} width={160}>
      {(close) => (
        <div className="dropdown menu sandbox-menu">
          {list.map((s) => (
            <div key={s.id} className="list-item two-line">
              <div
                className="main connect"
                onClick={() => {
                  close();
                  onConnect(s);
                }}
                title={`Connect to ${s.host}:${s.port}`}
              >
                <div className="title">{s.label || `${s.host}:${s.port}`}</div>
                <div className="sub muted mono">
                  {s.host}:{s.port}
                </div>
              </div>
              <button type="button" className="icon-link" title="Edit" onClick={() => setEditing(s)}>
                <PencilIcon size={14} />
              </button>
              <button type="button" className="icon-link" title="Remove" onClick={() => setList(removeSandbox(s.id))}>
                <TrashIcon size={14} />
              </button>
            </div>
          ))}
          {!list.length && !editing && (
            <div className="sidebar-note muted">No sandboxes yet. Add a VNC connection to your VM or box.</div>
          )}
          {editing ? (
            <SandboxForm
              sandbox={editing}
              onSave={(s) => {
                setList(saveSandbox(s));
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <button type="button" className="btn" onClick={() => setEditing({ id: newSandboxId(), label: "", host: "", port: 5900 })}>
              <PlusIcon size={14} /> Add sandbox…
            </button>
          )}
        </div>
      )}
    </ToolbarDropdown>
  );
}

function SandboxForm({ sandbox, onSave, onCancel }: { sandbox: Sandbox; onSave: (s: Sandbox) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(sandbox.label);
  const [host, setHost] = useState(sandbox.host);
  const [port, setPort] = useState(String(sandbox.port));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(port, 10);
    if (!host.trim() || !p || p > 65535) return;
    onSave({ ...sandbox, label: label.trim(), host: host.trim(), port: p });
  };

  return (
    <form className="sandbox-form" onSubmit={save}>
      <input className="input" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <div className="row">
        <input className="input" placeholder="host or IP" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
        <input className="input sandbox-port" placeholder="5900" value={port} onChange={(e) => setPort(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" type="submit">
          Save
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
