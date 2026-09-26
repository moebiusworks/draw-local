import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeDocument } from "./document";
import { commandTooltip, commands, platform } from "./shortcuts";

type Project = {
  id: string;
  name: string;
  path: string;
  available: boolean;
  error?: string;
};
type FileInfo = { path: string; revision: string };
type Draft = FileInfo & { id: string; name?: string };
type Open =
  | { kind: "draft"; id: string }
  | { kind: "file"; projectId: string; path: string };
type Directory = { path: string; parent?: string; entries: string[] };
type ProjectEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  revision?: string;
};
type Notice = {
  name: string;
  version: string;
  license: string;
  repository?: string;
  notices: { name: string; text: string }[];
};
const emptyDoc = {
  type: "excalidraw",
  version: 2,
  source: "draw-local",
  elements: [],
  appState: {},
  files: {},
};
const key = (open: Open) =>
  open.kind === "draft"
    ? `draft:${open.id}`
    : `project:${open.projectId}:${open.path}`;

function Icon({
  name,
}: {
  name: "new" | "save" | "save-as" | "panel" | "folder" | "github" | "licenses";
}) {
  const paths = {
    new: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    save: (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4M8 19v-5h8v5" />
      </>
    ),
    "save-as": (
      <>
        <path d="M5 4h12l2 2v14H5z" />
        <path d="M8 4v6h8V4M12 13v5m-2-2 2 2 2-2" />
      </>
    ),
    panel: (
      <>
        <path d="M4 5h16v14H4zM10 5v14M7 12h.01" />
      </>
    ),
    folder: (
      <>
        <path d="M3 7h7l2 2h9v10H3z" />
      </>
    ),
    github: (
      <path d="M12 3a9 9 0 0 0-2.85 17.54c.45.08.62-.2.62-.43v-1.68c-2.53.55-3.06-1.08-3.06-1.08-.42-1.07-1.01-1.35-1.01-1.35-.83-.56.06-.55.06-.55.92.06 1.4.94 1.4.94.82 1.4 2.14 1 2.66.77.08-.59.32-1 .58-1.23-2.02-.23-4.15-1.01-4.15-4.5 0-1 .35-1.8.93-2.44-.09-.23-.4-1.16.09-2.42 0 0 .76-.24 2.48.93A8.6 8.6 0 0 1 12 6.3c.76 0 1.52.1 2.23.3 1.72-1.17 2.48-.93 2.48-.93.49 1.26.18 2.19.09 2.42.58.64.93 1.45.93 2.44 0 3.5-2.14 4.27-4.17 4.5.33.28.62.82.62 1.65v2.44c0 .24.16.52.63.43A9 9 0 0 0 12 3Z" />
    ),
    licenses: (
      <>
        <path d="M6 3h9l3 3v15H6z" />
        <path d="M15 3v4h3M9 11h6M9 15h6" />
      </>
    ),
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}

function IconButton({
  icon,
  command,
  disabled,
  disabledReason,
  onClick,
  revealShortcut,
}: {
  icon: "new" | "save" | "save-as" | "panel" | "folder" | "github" | "licenses";
  command?: keyof typeof commands;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
  revealShortcut?: boolean;
}) {
  const currentPlatform = platform();
  const definition = command ? commands[command] : undefined;
  const label =
    definition?.name ??
    (icon === "github"
      ? "draw-local on GitHub"
      : icon === "licenses"
        ? "Licenses"
        : "Command");
  const tooltip = definition
    ? commandTooltip(
        definition,
        currentPlatform,
        disabled ? disabledReason : undefined,
      )
    : label;
  return (
    <button
      className="icon-button"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-keyshortcuts={definition?.ariaKeyShortcuts(currentPlatform)}
      data-tooltip={tooltip}
    >
      <Icon name={icon} />
      {revealShortcut && definition && !disabled && (
        <span className="shortcut-hint" aria-hidden="true">
          {definition.label(currentPlatform)}
        </span>
      )}
    </button>
  );
}

function storedPathSet(key: string) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...(init.headers ?? {}) }
      : init?.headers,
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? response.statusText);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState<string>(),
    [files, setFiles] = useState<FileInfo[]>([]),
    [projectEntries, setProjectEntries] = useState<
      Record<string, ProjectEntry[]>
    >({}),
    [expandedEntries, setExpandedEntries] = useState<Set<string>>(() =>
      storedPathSet("draw-local.project-expanded"),
    ),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [open, setOpen] = useState<Open>(),
    [document, setDocument] = useState<unknown>(),
    [status, setStatus] = useState("Ready"),
    [destination, setDestination] = useState(false),
    [picker, setPicker] = useState(false),
    [directory, setDirectory] = useState<Directory>(),
    [pickerNodes, setPickerNodes] = useState<Record<string, Directory>>({}),
    [pickerRoots, setPickerRoots] = useState<string[]>([]),
    [pickerSearch, setPickerSearch] = useState(""),
    [expandedPickerNodes, setExpandedPickerNodes] = useState<Set<string>>(() =>
      storedPathSet("draw-local.picker-expanded"),
    ),
    [destinationProject, setDestinationProject] = useState(""),
    [destinationPath, setDestinationPath] = useState("untitled.excalidraw"),
    [git, setGit] = useState<{
      available: boolean;
      branch?: string;
      statuses: Record<string, { label: string }>;
    }>({ available: false, statuses: {} }),
    [theme, setTheme] = useState<"light" | "dark">(() =>
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
    [panelCollapsed, setPanelCollapsed] = useState(
      () => localStorage.getItem("draw-local.panel-collapsed") === "true",
    ),
    [panelWidth, setPanelWidth] = useState(
      () => Number(localStorage.getItem("draw-local.panel-width")) || 280,
    ),
    [showShortcuts, setShowShortcuts] = useState(false),
    [licenses, setLicenses] = useState(false),
    [notices, setNotices] = useState<Notice[]>([]),
    [noticeSearch, setNoticeSearch] = useState(""),
    [selectedNotice, setSelectedNotice] = useState<string>("draw-local");
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [renamingDraft, setRenamingDraft] = useState<string>(),
    [draftName, setDraftName] = useState(""),
    [draftNameError, setDraftNameError] = useState("");
  const openRef = useRef<Open | undefined>(undefined);
  const documents = useRef(new Map<string, unknown>()),
    revisions = useRef(new Map<string, string>()),
    timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    writes = useRef(new Map<string, Promise<void>>()),
    documentStates = useRef(
      new Map<string, "unsaved" | "saving" | "saved" | "conflict">(),
    ),
    refreshSequence = useRef(0),
    projectIdRef = useRef<string | undefined>(undefined);
  const libraryAdapter = useMemo(
    () => ({
      load: async () =>
        request<{ libraryItems: unknown[] } | null>("/api/library"),
      save: async (libraryData: { libraryItems: unknown[] }) => {
        await request<void>("/api/library", {
          method: "PUT",
          body: JSON.stringify(libraryData),
        });
      },
    }),
    [],
  );
  useHandleLibrary({
    excalidrawAPI,
    adapter: libraryAdapter as never,
  });
  useEffect(() => {
    if (!window.name)
      window.name = `drawlocal${crypto.randomUUID().replaceAll("-", "")}`;
  }, []);
  const refresh = useCallback(async (id?: string) => {
    const sequence = ++refreshSequence.current;
    const [nextProjects, nextDrafts] = await Promise.all([
      request<Project[]>("/api/projects"),
      request<Draft[]>("/api/drafts"),
    ]);
    if (sequence !== refreshSequence.current) return;
    setProjects(nextProjects);
    setDrafts(nextDrafts);
    const selected = id ?? projectIdRef.current;
    if (selected) {
      const context = await request<typeof git>(
        `/api/project/git?projectId=${encodeURIComponent(selected)}`,
      );
      if (
        sequence !== refreshSequence.current ||
        selected !== projectIdRef.current
      )
        return;
      setFiles([]);
      setGit(context);
    }
  }, []);
  const selectProject = useCallback(
    (id: string) => {
      projectIdRef.current = id;
      setProjectId(id);
      void refresh(id);
    },
    [refresh],
  );
  const loadProjectEntries = useCallback(async (id: string, relative = "") => {
    const items = await request<ProjectEntry[]>(
      `/api/project/entries?projectId=${encodeURIComponent(id)}${relative ? `&path=${encodeURIComponent(relative)}` : ""}`,
    );
    setProjectEntries((entries) => ({
      ...entries,
      [`${id}:${relative}`]: items,
    }));
  }, []);
  const toggleProjectEntry = async (id: string, relative = "") => {
    const identity = `${id}:${relative}`;
    setExpandedEntries((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
    if (!projectEntries[identity]) {
      try {
        await loadProjectEntries(id, relative);
      } catch (error) {
        setStatus(`Folder failed: ${(error as Error).message}`);
      }
    }
  };
  useEffect(() => {
    localStorage.setItem(
      "draw-local.project-expanded",
      JSON.stringify([...expandedEntries]),
    );
  }, [expandedEntries]);
  useEffect(() => {
    for (const identity of expandedEntries) {
      if (projectEntries[identity]) continue;
      const [id, relative = ""] = identity.split(":", 2);
      if (projects.some((project) => project.id === id && project.available))
        void loadProjectEntries(id!, relative).catch((error: Error) =>
          setStatus(`Folder failed: ${error.message}`),
        );
    }
  }, [expandedEntries, loadProjectEntries, projectEntries, projects]);
  const load = useCallback(async (next: Open) => {
    const identity = key(next);
    if (documentStates.current.get(identity) === "conflict") {
      openRef.current = next;
      setOpen(next);
      setDocument(documents.current.get(identity));
      setStatus("Recovery needed: use Save As or open the recovery draft.");
      return;
    }
    setStatus("Loading...");
    try {
      const result =
        next.kind === "draft"
          ? await request<{ document: unknown; revision: string }>(
              `/api/draft/${encodeURIComponent(next.id)}`,
            )
          : await request<{ document: unknown; revision: string }>(
              `/api/project/file?projectId=${encodeURIComponent(next.projectId)}&path=${encodeURIComponent(next.path)}`,
            );
      documents.current.set(identity, result.document);
      const savedTheme = (result.document as { appState?: { theme?: unknown } })
        .appState?.theme;
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
      revisions.current.set(identity, result.revision);
      documentStates.current.set(identity, "saved");
      openRef.current = next;
      setOpen(next);
      setDocument(result.document);
      window.history.replaceState(
        null,
        "",
        `?${next.kind === "draft" ? `draft=${next.id}` : `project=${next.projectId}&file=${encodeURIComponent(next.path)}`}${window.location.hash}`,
      );
      setStatus("Saved");
    } catch (error) {
      setStatus(`Open failed: ${(error as Error).message}`);
    }
  }, []);
  useEffect(() => {
    void request<Project[]>("/api/projects")
      .then((items) => {
        setProjects(items);
        const selected =
          new URLSearchParams(location.search).get("project") ||
          items.find((item) => item.available)?.id;
        if (selected) {
          projectIdRef.current = selected;
          setProjectId(selected);
          return refresh(selected);
        }
      })
      .then(() => {
        const qs = new URLSearchParams(location.search),
          draft = qs.get("draft"),
          project = qs.get("project"),
          file = qs.get("file");
        if (draft) void load({ kind: "draft", id: draft });
        else if (project && file)
          void load({ kind: "file", projectId: project, path: file });
      })
      .catch((error: Error) => setStatus(`List failed: ${error.message}`));
  }, [refresh, load]);
  useEffect(() => {
    const onFocus = () =>
      projectIdRef.current && void refresh(projectIdRef.current);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  const persist = useCallback(
    (target: Open) => {
      const identity = key(target),
        next = documents.current.get(identity),
        previous = writes.current.get(identity) ?? Promise.resolve();
      documentStates.current.set(identity, "saving");
      const write = previous
        .catch(() => {})
        .then(async () => {
          const revision = revisions.current.get(identity);
          const result =
            target.kind === "draft"
              ? await request<FileInfo>(`/api/draft/${target.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ document: next, revision }),
                })
              : await request<FileInfo>(
                  `/api/project/file?projectId=${encodeURIComponent(target.projectId)}&path=${encodeURIComponent(target.path)}`,
                  {
                    method: "PUT",
                    body: JSON.stringify({ document: next, revision }),
                  },
                );
          revisions.current.set(identity, result.revision);
          documentStates.current.set(identity, "saved");
        });
      writes.current.set(identity, write);
      void write
        .then(() => {
          if (
            openRef.current &&
            key(openRef.current) === identity &&
            documents.current.get(identity) === next
          )
            setStatus("Saved");
          void refresh(target.kind === "file" ? target.projectId : undefined);
        })
        .catch(async (error: Error) => {
          documentStates.current.set(identity, "conflict");
          if (target.kind === "file") {
            try {
              const recovery = await request<Draft>("/api/drafts", {
                method: "POST",
                body: JSON.stringify({ document: next }),
              });
              setStatus(
                `Save conflicted: recovery draft ${recovery.id} was created. Open it to retry or Save As.`,
              );
              void refresh();
              return;
            } catch {}
          }
          if (openRef.current && key(openRef.current) === identity)
            setStatus(`Save failed: ${error.message}`);
        });
      return write;
    },
    [refresh],
  );
  const flush = useCallback(
    async (target?: Open) => {
      if (!target) return;
      const identity = key(target),
        timer = timers.current.get(identity);
      if (timer) {
        clearTimeout(timer);
        timers.current.delete(identity);
        await persist(target);
      } else await writes.current.get(identity);
    },
    [persist],
  );
  const newDraft = async () => {
    const draft = await request<Draft>("/api/drafts", {
      method: "POST",
      body: JSON.stringify({
        document: { ...emptyDoc, appState: { theme } },
      }),
    });
    await refresh();
    await load({ kind: "draft", id: draft.id });
  };
  const browse = async (target?: string) => {
    try {
      const next = await request<Directory>(
        `/api/directories${target ? `?path=${encodeURIComponent(target)}` : ""}`,
      );
      setDirectory(next);
      setPickerNodes((nodes) => ({ ...nodes, [next.path]: next }));
    } catch (error) {
      setStatus(`Directory failed: ${(error as Error).message}`);
    }
  };
  const resolveTypedDirectory = async () => {
    if (!directory?.path) return;
    try {
      const resolved = await request<{ path: string }>(
        `/api/directories/resolve?path=${encodeURIComponent(directory.path)}`,
      );
      setDirectory({ path: resolved.path, entries: [] });
      await browse(resolved.path);
    } catch (error) {
      setStatus(`Directory failed: ${(error as Error).message}`);
    }
  };
  const openPicker = async () => {
    setPicker(true);
    try {
      const home = await request<Directory>("/api/directories");
      const roots = [
        ...new Set([
          home.path,
          ...projects
            .filter((project) => project.available)
            .map((project) => project.path),
        ]),
      ];
      setPickerRoots(roots);
      setPickerNodes({ [home.path]: home });
      setDirectory(home);
      setExpandedPickerNodes((current) => new Set([home.path, ...current]));
      const savedLocation = localStorage.getItem("draw-local.picker-location");
      if (savedLocation && savedLocation !== home.path)
        await browse(savedLocation);
    } catch (error) {
      setStatus(`Directory failed: ${(error as Error).message}`);
    }
  };
  const addDirectory = async () => {
    if (!directory) return;
    try {
      const project = await request<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ path: directory.path }),
      });
      selectProject(project.id);
      setPicker(false);
    } catch (error) {
      setStatus(`Add directory failed: ${(error as Error).message}`);
    }
  };
  const openDestination = () => {
    setDestinationProject(projectId ?? "");
    const suggestedName = (
      (open?.kind === "draft"
        ? drafts.find((draft) => draft.id === open.id)?.name
        : undefined) ?? "Untitled draft"
    )
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 100);
    setDestinationPath(
      open?.kind === "file"
        ? open.path
        : `${suggestedName || "untitled"}.excalidraw`,
    );
    setDestination(true);
  };
  const saveTo = async () => {
    if (!open || !destinationProject || !destinationPath) return;
    try {
      await flush(open);
      const content = documents.current.get(key(open));
      const result =
        open.kind === "draft"
          ? await request<FileInfo>(`/api/draft/${open.id}/save`, {
              method: "POST",
              body: JSON.stringify({
                projectId: destinationProject,
                path: destinationPath,
                document: content,
              }),
            })
          : await request<FileInfo>("/api/project/copy", {
              method: "POST",
              body: JSON.stringify({
                fromProjectId: open.projectId,
                fromPath: open.path,
                projectId: destinationProject,
                path: destinationPath,
                document: content,
              }),
            });
      documents.current.set(
        `project:${destinationProject}:${destinationPath}`,
        content,
      );
      revisions.current.set(
        `project:${destinationProject}:${destinationPath}`,
        result.revision,
      );
      setProjectId(destinationProject);
      await refresh(destinationProject);
      await load({
        kind: "file",
        projectId: destinationProject,
        path: destinationPath,
      });
      setDestination(false);
    } catch (error) {
      setStatus(`Save failed: ${(error as Error).message}`);
    }
  };
  const save = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      binaryFiles: Record<string, unknown>,
    ) => {
      const target = openRef.current;
      if (!target) return;
      const identity = key(target);
      const old = documents.current.get(identity);
      documents.current.set(
        identity,
        mergeDocument(old, elements, appState, binaryFiles),
      );
      if (appState.theme === "light" || appState.theme === "dark")
        setTheme(appState.theme);
      setStatus("Unsaved");
      const timer = timers.current.get(identity);
      if (timer) clearTimeout(timer);
      timers.current.set(
        identity,
        setTimeout(() => {
          timers.current.delete(identity);
          void persist(target);
        }, 600),
      );
    },
    [persist],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable =
        target?.matches("input, textarea, select, [contenteditable=true]") ||
        Boolean(
          target?.closest(
            "input, textarea, select, [contenteditable=true], .dialog",
          ),
        );
      const currentPlatform = platform();
      if (
        commands.save.matches(event, currentPlatform) &&
        openRef.current &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        if (openRef.current.kind === "draft") openDestination();
        else void flush(openRef.current);
      }
      if (
        commands.new.matches(event, currentPlatform) &&
        !event.defaultPrevented &&
        !editable &&
        !destination &&
        !picker &&
        !licenses
      ) {
        event.preventDefault();
        void newDraft();
      }
      if (
        commands["panel-toggle"].matches(event, currentPlatform) &&
        !event.defaultPrevented &&
        !editable &&
        !destination &&
        !picker &&
        !licenses
      ) {
        event.preventDefault();
        setPanelCollapsed((value) => !value);
      }
      if (
        commands["browse-folders"].matches(event, currentPlatform) &&
        !event.defaultPrevented &&
        !editable &&
        !destination &&
        !picker &&
        !licenses
      ) {
        event.preventDefault();
        void openPicker();
      }
    };
    const modifierDown = (event: KeyboardEvent) => {
      if (
        (platform() === "mac" && event.metaKey) ||
        (platform() === "other" && event.ctrlKey)
      )
        setShowShortcuts(true);
    };
    const modifierUp = () => setShowShortcuts(false);
    addEventListener("keydown", handler);
    addEventListener("keydown", modifierDown);
    addEventListener("keyup", modifierUp);
    addEventListener("blur", modifierUp);
    window.document.addEventListener("visibilitychange", modifierUp);
    return () => {
      removeEventListener("keydown", handler);
      removeEventListener("keydown", modifierDown);
      removeEventListener("keyup", modifierUp);
      removeEventListener("blur", modifierUp);
      window.document.removeEventListener("visibilitychange", modifierUp);
    };
  }, [flush, open, destination, picker, licenses]);
  useEffect(
    () =>
      localStorage.setItem(
        "draw-local.panel-collapsed",
        String(panelCollapsed),
      ),
    [panelCollapsed],
  );
  useEffect(
    () =>
      localStorage.setItem(
        "draw-local.panel-width",
        String(Math.min(420, Math.max(240, panelWidth))),
      ),
    [panelWidth],
  );
  useEffect(() => {
    if (directory?.path)
      localStorage.setItem("draw-local.picker-location", directory.path);
  }, [directory?.path]);
  useEffect(() => {
    localStorage.setItem(
      "draw-local.picker-expanded",
      JSON.stringify([...expandedPickerNodes]),
    );
  }, [expandedPickerNodes]);
  useEffect(() => {
    if (!licenses || notices.length) return;
    void request<Notice[]>("/third-party-notices.json")
      .then(setNotices)
      .catch((error: Error) =>
        setStatus(`License information failed to load: ${error.message}`),
      );
  }, [licenses, notices.length]);
  const activeProject = projects.find((project) => project.id === projectId);
  const libraryReturnUrl = open
    ? encodeURIComponent(
        `${window.location.origin}${window.location.pathname}?${open.kind === "draft" ? `draft=${open.id}` : `project=${open.projectId}&file=${encodeURIComponent(open.path)}`}`,
      )
    : undefined;
  const renderProjectEntries = (id: string, relative = "", level = 2) => {
    const identity = `${id}:${relative}`;
    if (!expandedEntries.has(identity)) return null;
    return projectEntries[identity]?.map((entry) => {
      const childIdentity = `${id}:${entry.path}`;
      if (entry.kind === "directory") {
        const expanded = expandedEntries.has(childIdentity);
        return (
          <div
            key={childIdentity}
            role="treeitem"
            aria-level={level}
            aria-expanded={expanded}
            className="tree-row directory-row"
          >
            <button
              type="button"
              className="tree-button"
              onClick={() => void toggleProjectEntry(id, entry.path)}
            >
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              {entry.name}
            </button>
            <div role="group">
              {renderProjectEntries(id, entry.path, level + 1)}
            </div>
          </div>
        );
      }
      const label =
        git.statuses[entry.path]?.label ?? (git.available ? "Committed" : "");
      return (
        <button
          key={childIdentity}
          type="button"
          role="treeitem"
          aria-level={level}
          aria-current={
            open?.kind === "file" &&
            open.projectId === id &&
            open.path === entry.path
              ? "page"
              : undefined
          }
          className={
            open?.kind === "file" &&
            open.projectId === id &&
            open.path === entry.path
              ? "file active"
              : "file"
          }
          title={label}
          onClick={() => {
            selectProject(id);
            void load({ kind: "file", projectId: id, path: entry.path });
          }}
        >
          {label && (
            <span className="git-icon" aria-hidden="true">
              {label === "Conflicted"
                ? "⚠"
                : label === "Untracked"
                  ? "?"
                  : label === "Ignored"
                    ? "⊘"
                    : label.includes("Staged")
                      ? "◆"
                      : label.includes("Modified")
                        ? "●"
                        : "✓"}
            </span>
          )}
          {entry.name}
        </button>
      );
    });
  };
  const resizePanel = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = panelWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) =>
      setPanelWidth(
        Math.min(420, Math.max(240, startWidth + next.clientX - startX)),
      );
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const renameOpen = async () => {
    if (open?.kind !== "file") return;
    const next = window.prompt("New filename", open.path);
    if (!next || next === open.path) return;
    try {
      const info = await request<FileInfo>(
        `/api/project/rename?projectId=${encodeURIComponent(open.projectId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            from: open.path,
            to: next,
            revision: revisions.current.get(key(open)),
          }),
        },
      );
      documents.current.set(
        `project:${open.projectId}:${next}`,
        documents.current.get(key(open)),
      );
      revisions.current.set(`project:${open.projectId}:${next}`, info.revision);
      await refresh(open.projectId);
      await load({ kind: "file", projectId: open.projectId, path: next });
    } catch (error) {
      setStatus(`Rename failed: ${(error as Error).message}`);
    }
  };
  const beginDraftRename = (draft: Draft) => {
    setRenamingDraft(draft.id);
    setDraftName(draft.name ?? "Untitled draft");
    setDraftNameError("");
  };
  const commitDraftRename = async (draft: Draft) => {
    const name = draftName.trim();
    if (!name) return setDraftNameError("A draft name is required.");
    if (name.length > 100)
      return setDraftNameError("Draft names must be 100 characters or fewer.");
    const target: Open = { kind: "draft", id: draft.id };
    const identity = key(target);
    try {
      const current = documents.current.get(identity);
      const loaded = current
        ? undefined
        : await request<{ document: unknown; revision: string }>(
            `/api/draft/${encodeURIComponent(draft.id)}`,
          );
      const saved = current ?? loaded!.document;
      if (!current) {
        documents.current.set(identity, saved);
        revisions.current.set(identity, loaded!.revision);
      }
      const next = {
        ...(saved as Record<string, unknown>),
        appState: {
          ...((saved as { appState?: Record<string, unknown> }).appState ?? {}),
          name,
        },
      };
      documents.current.set(identity, next);
      await persist(target);
      setDrafts((items) =>
        items.map((item) => (item.id === draft.id ? { ...item, name } : item)),
      );
      setRenamingDraft(undefined);
      setDraftNameError("");
      if (open?.kind === "draft" && open.id === draft.id) setDocument(next);
    } catch (error) {
      setDraftNameError(`Rename failed: ${(error as Error).message}`);
    }
  };
  const reorderProjects = async (ids: string[]) => {
    try {
      setProjects(
        await request<Project[]>("/api/projects/order", {
          method: "PUT",
          body: JSON.stringify({ ids }),
        }),
      );
    } catch (error) {
      setStatus(`Project order failed: ${(error as Error).message}`);
    }
  };
  const moveProject = (id: string, direction: -1 | 1) => {
    const index = projects.findIndex((project) => project.id === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= projects.length) return;
    const ids = projects.map((project) => project.id);
    [ids[index], ids[destination]] = [ids[destination]!, ids[index]!];
    void reorderProjects(ids);
  };
  const retryProject = async () => {
    try {
      setProjects(await request<Project[]>("/api/projects"));
    } catch (error) {
      setStatus(`Project retry failed: ${(error as Error).message}`);
    }
  };
  const locateProject = async (project: Project) => {
    const directory = window.prompt("Replacement project folder", project.path);
    if (!directory) return;
    try {
      await request<Project>(
        `/api/projects/${encodeURIComponent(project.id)}/locate`,
        { method: "POST", body: JSON.stringify({ path: directory }) },
      );
      await retryProject();
    } catch (error) {
      setStatus(`Locate project failed: ${(error as Error).message}`);
    }
  };
  const removeProject = async (project: Project) => {
    const isOpen = open?.kind === "file" && open.projectId === project.id;
    if (
      !window.confirm(
        `Remove ${project.name} from this workspace? Its files will not be changed.`,
      )
    )
      return;
    try {
      if (isOpen) await flush(open);
      if (isOpen) await newDraft();
      await request<void>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      if (projectId === project.id) {
        projectIdRef.current = undefined;
        setProjectId(undefined);
      }
      await retryProject();
    } catch (error) {
      setStatus(`Remove project failed: ${(error as Error).message}`);
    }
  };
  const togglePickerNode = async (path: string) => {
    const wasExpanded = expandedPickerNodes.has(path);
    setExpandedPickerNodes((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!wasExpanded && !pickerNodes[path]) {
      try {
        const next = await request<Directory>(
          `/api/directories?path=${encodeURIComponent(path)}`,
        );
        setPickerNodes((nodes) => ({ ...nodes, [path]: next }));
      } catch (error) {
        setStatus(`Directory failed: ${(error as Error).message}`);
      }
    }
  };
  const renderPickerNode = (path: string, name: string, level = 1) => {
    const node = pickerNodes[path];
    const expanded = expandedPickerNodes.has(path);
    const query = pickerSearch.trim().toLocaleLowerCase();
    const visibleChildren = node?.entries.filter((entry) =>
      entry.toLocaleLowerCase().includes(query),
    );
    if (
      query &&
      !name.toLocaleLowerCase().includes(query) &&
      !visibleChildren?.length
    )
      return null;
    return (
      <div
        key={path}
        role="treeitem"
        aria-level={level}
        aria-expanded={expanded}
        aria-selected={directory?.path === path}
        className="picker-tree-row"
      >
        <button
          type="button"
          className="tree-button"
          onClick={() => setDirectory(node ?? { path, entries: [] })}
          onKeyDown={(event) => {
            const buttons = [
              ...(event.currentTarget
                .closest('[role="tree"]')
                ?.querySelectorAll<HTMLButtonElement>(".tree-button") ?? []),
            ];
            const index = buttons.indexOf(event.currentTarget);
            if (event.key === "ArrowDown" && buttons[index + 1]) {
              event.preventDefault();
              buttons[index + 1]!.focus();
            }
            if (event.key === "ArrowUp" && buttons[index - 1]) {
              event.preventDefault();
              buttons[index - 1]!.focus();
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              if (!expanded) void togglePickerNode(path);
              else
                event.currentTarget
                  .closest('[role="treeitem"]')
                  ?.querySelector<HTMLButtonElement>(
                    '[role="group"] > [role="treeitem"] .tree-button',
                  )
                  ?.focus();
            }
            if (event.key === "ArrowLeft" && expanded) {
              event.preventDefault();
              void togglePickerNode(path);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              event.currentTarget
                .closest('[role="treeitem"]')
                ?.parentElement?.closest('[role="treeitem"]')
                ?.querySelector<HTMLButtonElement>(".tree-button")
                ?.focus();
            }
          }}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          {name}
        </button>
        {expanded && (
          <div role="group">
            {visibleChildren?.map((entry) =>
              renderPickerNode(`${path}/${entry}`, entry, level + 1),
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <div
      className={`shell ${panelCollapsed ? "panel-collapsed" : ""}`}
      data-theme={theme}
      style={
        {
          "--panel-width": `${Math.min(420, Math.max(240, panelWidth))}px`,
        } as React.CSSProperties
      }
    >
      <aside className="sidebar" aria-label="Workspace explorer">
        <div className="expanded-only brand">
          <strong>draw-local</strong>
          <span>Git-friendly Excalidraw</span>
        </div>
        <div className="actions" aria-label="Drawing commands">
          <IconButton
            icon="new"
            command="new"
            onClick={() => void newDraft()}
            revealShortcut={showShortcuts}
          />
          <IconButton
            icon="save"
            command="save"
            disabled={!open}
            disabledReason="Open a drawing first"
            onClick={() =>
              open?.kind === "draft"
                ? openDestination()
                : open && void flush(open)
            }
            revealShortcut={showShortcuts}
          />
          <IconButton
            icon="save-as"
            disabled={!open || open.kind !== "file"}
            disabledReason="Save a drawing first"
            onClick={openDestination}
          />
          <span className="expanded-only action-separator" />
          <button
            className="expanded-only text-button"
            disabled={open?.kind !== "file"}
            onClick={() => void renameOpen()}
          >
            Rename
          </button>
        </div>
        <div className="expanded-only project">
          <div className="section-heading">Projects</div>
          <span className="project-path">
            Registered project roots appear below.
          </span>
        </div>
        <div className="expanded-only git">
          {git.available
            ? `Branch: ${git.branch ?? "Detached HEAD"}`
            : activeProject
              ? "Not a Git repository"
              : ""}
        </div>
        <div className="expanded-only files">
          <strong>Drafts</strong>
          {drafts.map((draft) => (
            <div key={draft.id} className="draft-row">
              {renamingDraft === draft.id ? (
                <input
                  aria-label="Draft name"
                  autoFocus
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitDraftRename(draft);
                    if (event.key === "Escape") setRenamingDraft(undefined);
                  }}
                  onBlur={() => void commitDraftRename(draft)}
                  aria-describedby={
                    draftNameError ? "draft-name-error" : undefined
                  }
                />
              ) : (
                <button
                  className={
                    open?.kind === "draft" && open.id === draft.id
                      ? "file active"
                      : "file"
                  }
                  onClick={() => void load({ kind: "draft", id: draft.id })}
                  onKeyDown={(event) => {
                    if (
                      (platform() === "mac" && event.key === "Enter") ||
                      (platform() === "other" && event.key === "F2")
                    ) {
                      event.preventDefault();
                      beginDraftRename(draft);
                    }
                  }}
                >
                  {draft.name ?? "Untitled draft"}
                </button>
              )}
              {renamingDraft === draft.id && draftNameError && (
                <span id="draft-name-error" className="inline-error">
                  {draftNameError}
                </span>
              )}
              <button
                className="draft-rename text-button"
                type="button"
                aria-label={`Rename ${draft.name ?? "Untitled draft"}`}
                onClick={() => beginDraftRename(draft)}
              >
                Rename
              </button>
            </div>
          ))}
          <strong>Projects</strong>
          <div role="tree" aria-label="Project explorer">
            {projects.map((project) => {
              const rootIdentity = `${project.id}:`;
              const expanded = expandedEntries.has(rootIdentity);
              return (
                <div
                  key={project.id}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={project.available ? expanded : undefined}
                  className="tree-row project-root"
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", project.id)
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const moving = event.dataTransfer.getData("text/plain");
                    const ids = projects.map((item) => item.id);
                    const from = ids.indexOf(moving);
                    const to = ids.indexOf(project.id);
                    if (from < 0 || to < 0 || from === to) return;
                    ids.splice(to, 0, ids.splice(from, 1)[0]!);
                    void reorderProjects(ids);
                  }}
                >
                  <button
                    type="button"
                    className={
                      project.id === projectId
                        ? "tree-button active"
                        : "tree-button"
                    }
                    disabled={!project.available}
                    title={project.path}
                    onClick={() => {
                      selectProject(project.id);
                      void toggleProjectEntry(project.id);
                    }}
                  >
                    <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                    {project.name}
                    {project.available ? "" : " (unavailable)"}
                  </button>
                  <div
                    className="project-controls"
                    aria-label={`${project.name} actions`}
                  >
                    {project.available ? (
                      <>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => moveProject(project.id, -1)}
                          disabled={projects[0]?.id === project.id}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => moveProject(project.id, 1)}
                          disabled={projects.at(-1)?.id === project.id}
                        >
                          Move down
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void retryProject()}
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => void locateProject(project)}
                        >
                          Locate
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void removeProject(project)}
                    >
                      Remove
                    </button>
                  </div>
                  <div role="group">{renderProjectEntries(project.id)}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="utility-actions">
          <IconButton
            icon="panel"
            command="panel-toggle"
            onClick={() => setPanelCollapsed((value) => !value)}
            revealShortcut={showShortcuts}
          />
          <IconButton
            icon="folder"
            command="browse-folders"
            onClick={() => void openPicker()}
            revealShortcut={showShortcuts}
          />
          <a
            className="icon-button"
            href="https://github.com/moebiusworks/draw-local"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="draw-local on GitHub"
            data-tooltip="draw-local on GitHub"
          >
            <Icon name="github" />
          </a>
          <IconButton icon="licenses" onClick={() => setLicenses(true)} />
        </div>
        <div className="expanded-only status" role="status">
          {status}
        </div>
      </aside>
      {!panelCollapsed && (
        <div
          className="panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize project panel"
          onPointerDown={resizePanel}
        />
      )}
      <main className="canvas">
        {open && document ? (
          <Excalidraw
            key={key(open)}
            initialData={document as never}
            onChange={save as never}
            excalidrawAPI={setExcalidrawAPI}
            libraryReturnUrl={libraryReturnUrl}
          />
        ) : (
          <div className="empty">
            <h1>Local drawings, normal files.</h1>
            <button onClick={() => void newDraft()}>Create a drawing</button>
          </div>
        )}
        {destination && (
          <div className="dialog">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveTo();
              }}
            >
              <h2>{open?.kind === "draft" ? "Save drawing" : "Save As"}</h2>
              <label>
                Project
                <select
                  value={destinationProject}
                  onChange={(event) =>
                    setDestinationProject(event.target.value)
                  }
                >
                  {projects
                    .filter((project) => project.available)
                    .map((project) => (
                      <option
                        key={project.id}
                        value={project.id}
                        title={project.path}
                      >
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Filename
                <input
                  required
                  value={destinationPath}
                  onChange={(event) => setDestinationPath(event.target.value)}
                  placeholder="architecture/overview.excalidraw"
                />
              </label>
              <p>Existing files are protected.</p>
              <button type="submit">Save</button>
              <button type="button" onClick={() => setDestination(false)}>
                Cancel
              </button>
            </form>
          </div>
        )}
        {picker && (
          <div className="dialog">
            <div className="folder-picker">
              <h2>Choose project folder</h2>
              <label>
                Folder path
                <input
                  value={directory?.path ?? ""}
                  onChange={(event) =>
                    setDirectory({ path: event.target.value, entries: [] })
                  }
                  onBlur={() => void resolveTypedDirectory()}
                  placeholder="/absolute/path"
                />
              </label>
              <p className="selected-path" title={directory?.path}>
                {directory?.path}
              </p>
              <label>
                Filter discovered folders
                <input
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                  placeholder="Folder name"
                />
              </label>
              <div className="folder-actions">
                <button
                  disabled={!directory?.parent}
                  onClick={() =>
                    directory?.parent && void browse(directory.parent)
                  }
                >
                  Up
                </button>
                <button onClick={() => void resolveTypedDirectory()}>
                  Resolve path
                </button>
              </div>
              <div className="folder-list" role="tree" aria-label="Folder tree">
                {pickerRoots.map((root) =>
                  renderPickerNode(
                    root,
                    root === directory?.path
                      ? root
                      : (root.split("/").filter(Boolean).at(-1) ?? root),
                  ),
                )}
              </div>
              {pickerSearch &&
                !Object.values(pickerNodes).some((node) =>
                  node.entries.some((entry) =>
                    entry
                      .toLocaleLowerCase()
                      .includes(pickerSearch.trim().toLocaleLowerCase()),
                  ),
                ) && <p>Only discovered folders are searched.</p>}
              <button disabled={!directory} onClick={() => void addDirectory()}>
                Use this folder
              </button>
              <button onClick={() => setPicker(false)}>Cancel</button>
            </div>
          </div>
        )}
        {licenses && (
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="licenses-title"
          >
            <div className="license-viewer">
              <div className="dialog-heading">
                <h2 id="licenses-title">Licenses</h2>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setLicenses(false)}
                >
                  Close
                </button>
              </div>
              <input
                autoFocus
                aria-label="Search licenses"
                placeholder="Search packages"
                value={noticeSearch}
                onChange={(event) => setNoticeSearch(event.target.value)}
              />
              <div className="license-content">
                <div
                  className="license-list"
                  role="listbox"
                  aria-label="Packages"
                >
                  {notices
                    .filter((notice) =>
                      `${notice.name} ${notice.license}`
                        .toLowerCase()
                        .includes(noticeSearch.toLowerCase()),
                    )
                    .map((notice) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedNotice === notice.name}
                        className={
                          selectedNotice === notice.name ? "active" : ""
                        }
                        key={notice.name}
                        onClick={() => setSelectedNotice(notice.name)}
                      >
                        {notice.name}
                        <small>
                          {notice.version} · {notice.license}
                        </small>
                      </button>
                    ))}
                </div>
                {(() => {
                  const notice =
                    notices.find((item) => item.name === selectedNotice) ??
                    notices[0];
                  return notice ? (
                    <article className="license-detail">
                      <h3>
                        {notice.name} <small>{notice.version}</small>
                      </h3>
                      <p>License: {notice.license}</p>
                      {notice.repository && (
                        <p>Repository: {notice.repository}</p>
                      )}
                      {notice.notices.map((item) => (
                        <section key={item.name}>
                          <h4>{item.name}</h4>
                          <pre>{item.text}</pre>
                        </section>
                      ))}
                    </article>
                  ) : (
                    <p className="license-detail">
                      Loading locally bundled license information…
                    </p>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
