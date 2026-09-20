import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";

type FileInfo = { path: string; size: number; modifiedAt: string };
const emptyDoc = { type: "excalidraw", version: 2, source: "draw-local", elements: [], appState: {}, files: {} };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers });
  if (!response.ok) { const body = await response.json().catch(() => ({ error: response.statusText })); throw new Error(body.error ?? response.statusText); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function App() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selected, setSelected] = useState<string>();
  const [document, setDocument] = useState<unknown>();
  const [status, setStatus] = useState("Ready");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const list = await request<FileInfo[]>("/api/files");
    setFiles(list.filter((file) => file.path.endsWith(".excalidraw")));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (file: string) => {
    setStatus("Loading..."); setSelected(file);
    setDocument(await request("/api/file?path=" + encodeURIComponent(file)));
    setStatus("Ready");
  };

  const create = async () => {
    const raw = window.prompt("Drawing path", "architecture/overview.excalidraw"); if (!raw) return;
    const file = raw.endsWith(".excalidraw") ? raw : raw + ".excalidraw";
    await request("/api/file?path=" + encodeURIComponent(file), { method: "PUT", body: JSON.stringify(emptyDoc) });
    await refresh(); await open(file);
  };

  const rename = async () => {
    if (!selected) return; const raw = window.prompt("Rename drawing", selected); if (!raw || raw === selected) return;
    const to = raw.endsWith(".excalidraw") ? raw : raw + ".excalidraw";
    await request("/api/rename", { method: "POST", body: JSON.stringify({ from: selected, to }) });
    await refresh(); await open(to);
  };

  const remove = async () => {
    if (!selected || !window.confirm("Delete " + selected + "?")) return;
    await request("/api/file?path=" + encodeURIComponent(selected), { method: "DELETE" });
    setSelected(undefined); setDocument(undefined); await refresh();
  };

  const save = (elements: readonly unknown[], appState: Record<string, unknown>, binaryFiles: Record<string, unknown>) => {
    if (!selected) return; if (timer.current) clearTimeout(timer.current); setStatus("Unsaved");
    const next = { type: "excalidraw", version: 2, source: "draw-local", elements, appState: { ...appState, collaborators: undefined }, files: binaryFiles };
    timer.current = setTimeout(() => {
      void request("/api/file?path=" + encodeURIComponent(selected), { method: "PUT", body: JSON.stringify(next) })
        .then(() => { setStatus("Saved"); void refresh(); })
        .catch((error: Error) => setStatus("Save failed: " + error.message));
    }, 600);
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><strong>draw-local</strong><span>Git-friendly Excalidraw</span></div>
      <div className="actions"><button onClick={() => void create()}>New</button><button disabled={!selected} onClick={() => void rename()}>Rename</button><button disabled={!selected} onClick={() => void remove()}>Delete</button></div>
      <div className="files">{files.map((file) => <button key={file.path} className={file.path === selected ? "file active" : "file"} onClick={() => void open(file.path)}>{file.path}</button>)}</div>
      <div className="status">{status}</div>
    </aside>
    <main className="canvas">{selected && document ? <Excalidraw key={selected} initialData={document as never} onChange={save as never} /> : <div className="empty"><h1>Local drawings, normal files.</h1><p>Create or open an .excalidraw file. Your workspace remains the source of truth.</p><button onClick={() => void create()}>Create a drawing</button></div>}</main>
  </div>;
}
