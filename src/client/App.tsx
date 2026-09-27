import { Excalidraw, useHandleLibrary } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeDocument } from "./document";
import {
  commandTooltip,
  commands,
  drawingDeletionAction,
  platform,
} from "./shortcuts";

type Project = {
  id: string;
  name: string;
  path: string;
  available: boolean;
  error?: string;
};
type FileInfo = { path: string; revision: string };
type Draft = FileInfo & { id: string; name?: string; theme?: "light" | "dark" };
type Open =
  | { kind: "draft"; id: string }
  | { kind: "file"; projectId: string; path: string };
type Directory = { path: string; parent?: string; entries: string[] };
type ProjectEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  revision?: string;
  theme?: "light" | "dark";
  gitRoot?: boolean;
};
type TrashEntry = {
  id: string;
  kind: "draft" | "file";
  name: string;
  projectId?: string;
  path?: string;
  deletedAt: string;
  revision: string;
};
type FileTarget = { projectId: string; path: string; revision: string };
type DeleteTarget = {
  open: Open;
  name: string;
  revision: string;
  focusId?: string;
};
type GitContext = {
  available: boolean;
  branch?: string;
  defaultBranch?: string;
  repositoryPaths: string[];
  statuses: Record<
    string,
    { label: string; index?: string; worktree?: string }
  >;
};
type Notice = {
  name: string;
  version: string;
  license: string;
  repository?: string;
  notices: { name: string; text: string }[];
};
const noticeId = (notice: Pick<Notice, "name" | "version">) =>
  `${notice.name}@${notice.version}`;
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
const dragFileType = "application/x-draw-local-file";
const fileRowId = (projectId: string, relative: string) =>
  `file-${projectId}-${encodeURIComponent(relative)}`;
function draggedFile(transfer: DataTransfer): FileTarget | undefined {
  try {
    const value = JSON.parse(transfer.getData(dragFileType)) as FileTarget;
    return typeof value.projectId === "string" &&
      typeof value.path === "string" &&
      typeof value.revision === "string"
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function Icon({
  name,
}: {
  name:
    | "new"
    | "save"
    | "save-as"
    | "panel"
    | "folder"
    | "github"
    | "licenses"
    | "rename"
    | "trash"
    | "refresh"
    | "sun"
    | "moon"
    | "theme-auto"
    | "restore";
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
    rename: <path d="m4 20 4-.8L19 8.2 15.8 5 4.8 16zM13.8 7l3.2 3.2" />,
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </>
    ),
    moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z" />,
    "theme-auto": (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 4v16" />
      </>
    ),
    restore: (
      <>
        <path d="M4 11a8 8 0 1 1 2.3 6.7M4 4v7h7" />
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
  id,
  icon,
  command,
  disabled,
  disabledReason,
  onClick,
  revealShortcut,
}: {
  id?: string;
  icon:
    | "new"
    | "save"
    | "save-as"
    | "panel"
    | "folder"
    | "github"
    | "licenses"
    | "trash";
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
        : icon === "trash"
          ? "Trash"
          : icon === "save-as"
            ? "Save As"
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
      id={id}
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

function ThemeBadge({ theme }: { theme?: "light" | "dark" }) {
  const label =
    theme === "dark"
      ? "Dark theme"
      : theme === "light"
        ? "Light theme"
        : "Theme follows system";
  return (
    <span className="theme-badge" title={label} aria-hidden="true">
      <Icon
        name={
          theme === "dark" ? "moon" : theme === "light" ? "sun" : "theme-auto"
        }
      />
    </span>
  );
}

function RowAction({
  id,
  icon,
  label,
  onClick,
}: {
  id?: string;
  icon: "rename" | "trash" | "restore";
  label: string;
  onClick: () => void;
}) {
  const shortcut =
    icon === "trash"
      ? platform() === "mac"
        ? "Delete or Backspace; Shift+Delete or Option+Command+Delete skips confirmation"
        : "Delete; Shift+Delete skips confirmation"
      : undefined;
  return (
    <button
      id={id}
      className="row-action icon-button"
      type="button"
      aria-label={label}
      aria-keyshortcuts={
        icon === "trash"
          ? platform() === "mac"
            ? "Delete Backspace Shift+Delete Meta+Alt+Backspace Meta+Alt+Delete"
            : "Delete Shift+Delete"
          : undefined
      }
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

function Modal({
  children,
  labelledBy,
  onClose,
  restoreFocusId,
}: {
  children: React.ReactNode;
  labelledBy: string;
  onClose: () => void;
  restoreFocusId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.requestAnimationFrame(() =>
      ref.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus(),
    );
    return () => {
      window.requestAnimationFrame(() =>
        (
          window.document.getElementById(restoreFocusId) ??
          window.document.getElementById("save-command")
        )?.focus(),
      );
    };
  }, [restoreFocusId]);
  return (
    <div
      ref={ref}
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
          return;
        }
        if (event.key !== "Tab") return;
        const focusable = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []),
        ];
        if (!focusable.length) return;
        const index = focusable.indexOf(
          window.document.activeElement as HTMLElement,
        );
        if (event.shiftKey && index <= 0) {
          event.preventDefault();
          focusable.at(-1)?.focus();
        } else if (!event.shiftKey && index === focusable.length - 1) {
          event.preventDefault();
          focusable[0]?.focus();
        }
      }}
    >
      {children}
    </div>
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
    [transitioning, setTransitioning] = useState(false),
    [status, setStatus] = useState("Ready"),
    [destination, setDestination] = useState(false),
    [picker, setPicker] = useState(false),
    [directory, setDirectory] = useState<Directory>(),
    [resolvedDirectoryPath, setResolvedDirectoryPath] = useState<string>(),
    [resolvingDirectory, setResolvingDirectory] = useState(false),
    [pickerNodes, setPickerNodes] = useState<Record<string, Directory>>({}),
    [pickerRoots, setPickerRoots] = useState<string[]>([]),
    [pickerRootLabels, setPickerRootLabels] = useState<Record<string, string>>(
      {},
    ),
    [pickerSearch, setPickerSearch] = useState(""),
    [pickerError, setPickerError] = useState(""),
    [expandedPickerNodes, setExpandedPickerNodes] = useState<Set<string>>(() =>
      storedPathSet("draw-local.picker-expanded"),
    ),
    [destinationProject, setDestinationProject] = useState(""),
    [destinationPath, setDestinationPath] = useState("untitled.excalidraw"),
    [gitByProject, setGitByProject] = useState<Record<string, GitContext>>({}),
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
    [selectedNotice, setSelectedNotice] = useState<string>("draw-local@0.1.0");
  const [renameTarget, setRenameTarget] = useState<FileTarget>();
  const [renamePath, setRenamePath] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>();
  const [removeTarget, setRemoveTarget] = useState<Project>();
  const [promoteTarget, setPromoteTarget] = useState<{
    project: Project;
    path: string;
  }>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([]);
  const [dialogError, setDialogError] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<TrashEntry>();
  const [restoreProject, setRestoreProject] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [renamingDraft, setRenamingDraft] = useState<string>(),
    [draftName, setDraftName] = useState(""),
    [draftNameError, setDraftNameError] = useState("");
  const openRef = useRef<Open | undefined>(undefined);
  const draftRenameInput = useRef<HTMLInputElement>(null);
  const documents = useRef(new Map<string, unknown>()),
    revisions = useRef(new Map<string, string>()),
    timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    writes = useRef(new Map<string, Promise<void>>()),
    documentStates = useRef(
      new Map<string, "unsaved" | "saving" | "saved" | "conflict">(),
    ),
    cancelledDraftRename = useRef<string | undefined>(undefined),
    loadSequence = useRef(0),
    refreshSequence = useRef(0),
    gitRefreshSequence = useRef(new Map<string, number>()),
    gitRootRequested = useRef(new Set<string>()),
    projectEntriesRef = useRef(projectEntries),
    expandedEntriesRef = useRef(expandedEntries),
    projectIdRef = useRef<string | undefined>(undefined);
  const transitionRef = useRef(false);
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
  const refreshGit = useCallback(
    async (id: string, entries = projectEntriesRef.current) => {
      const sequence = (gitRefreshSequence.current.get(id) ?? 0) + 1;
      gitRefreshSequence.current.set(id, sequence);
      const paths = Object.entries(entries)
        .filter(([identity]) => identity.startsWith(`${id}:`))
        .flatMap(([, items]) =>
          items.filter((item) => item.kind === "file").map((item) => item.path),
        );
      const context = await request<GitContext>("/api/project/git", {
        method: "POST",
        body: JSON.stringify({ projectId: id, paths: [...new Set(paths)] }),
      });
      if (gitRefreshSequence.current.get(id) === sequence)
        setGitByProject((current) => ({ ...current, [id]: context }));
    },
    [],
  );
  useEffect(() => {
    for (const project of projects) {
      if (!project.available || gitRootRequested.current.has(project.id))
        continue;
      gitRootRequested.current.add(project.id);
      void refreshGit(project.id).catch((error: Error) => {
        gitRootRequested.current.delete(project.id);
        setStatus(`Git refresh failed: ${error.message}`);
      });
    }
  }, [projects, refreshGit]);
  const refresh = useCallback(
    async (id?: string) => {
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
        const identities = [...expandedEntriesRef.current].filter((identity) =>
          identity.startsWith(`${selected}:`),
        );
        const refreshed = Object.fromEntries(
          await Promise.all(
            identities.map(async (identity) => {
              const relative = identity.slice(selected.length + 1);
              const items = await request<ProjectEntry[]>(
                `/api/project/entries?projectId=${encodeURIComponent(selected)}${relative ? `&path=${encodeURIComponent(relative)}` : ""}`,
              );
              return [identity, items] as const;
            }),
          ),
        );
        if (
          sequence !== refreshSequence.current ||
          selected !== projectIdRef.current
        )
          return;
        await refreshGit(selected, refreshed);
        if (
          sequence !== refreshSequence.current ||
          selected !== projectIdRef.current
        )
          return;
        setFiles([]);
        projectEntriesRef.current = {
          ...Object.fromEntries(
            Object.entries(projectEntriesRef.current).filter(
              ([identity]) => !identity.startsWith(`${selected}:`),
            ),
          ),
          ...refreshed,
        };
        setProjectEntries(projectEntriesRef.current);
      }
    },
    [refreshGit],
  );
  const refreshTrash = useCallback(async () => {
    setTrashItems(await request<TrashEntry[]>("/api/trash"));
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
    projectEntriesRef.current = {
      ...projectEntriesRef.current,
      [`${id}:${relative}`]: items,
    };
    setProjectEntries(projectEntriesRef.current);
    return items;
  }, []);
  const toggleProjectEntry = async (id: string, relative = "") => {
    const identity = `${id}:${relative}`;
    const next = new Set(expandedEntriesRef.current);
    if (next.has(identity)) next.delete(identity);
    else next.add(identity);
    expandedEntriesRef.current = next;
    setExpandedEntries(next);
    if (!projectEntries[identity]) {
      try {
        await loadProjectEntries(id, relative);
        await refreshGit(id);
      } catch (error) {
        setStatus(`Folder failed: ${(error as Error).message}`);
      }
    }
    if (projectEntries[identity])
      void refreshGit(id).catch((error: Error) =>
        setStatus(`Git refresh failed: ${error.message}`),
      );
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
      if (projects.some((project) => project.id === id && project.available)) {
        void loadProjectEntries(id!, relative)
          .then(() => refreshGit(id!))
          .catch((error: Error) =>
            setStatus(`Folder or Git refresh failed: ${error.message}`),
          );
      }
    }
  }, [
    expandedEntries,
    loadProjectEntries,
    projectEntries,
    projects,
    refreshGit,
  ]);
  const load = useCallback(async (next: Open) => {
    const sequence = ++loadSequence.current;
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
      if (sequence !== loadSequence.current) return;
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
      if (sequence === loadSequence.current)
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
        // A conflicted source must never receive another stale-revision write.
        // Its current in-memory snapshot is the recovery payload for Save As.
        if (documentStates.current.get(identity) !== "conflict")
          await persist(target);
      } else {
        try {
          await writes.current.get(identity);
        } catch (error) {
          // Conflict recovery creates a draft and deliberately leaves the current
          // document available for Save As instead of rethrowing a stale write.
          if (documentStates.current.get(identity) !== "conflict") throw error;
        }
      }
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
      setPickerError("");
      const next = await request<Directory>(
        `/api/directories${target ? `?path=${encodeURIComponent(target)}` : ""}`,
      );
      setDirectory(next);
      setResolvedDirectoryPath(next.path);
      setPickerNodes((nodes) => ({ ...nodes, [next.path]: next }));
    } catch (error) {
      setPickerError((error as Error).message);
      setStatus(`Directory failed: ${(error as Error).message}`);
    }
  };
  const resolveTypedDirectory = async () => {
    if (!directory?.path) return;
    setResolvingDirectory(true);
    try {
      setPickerError("");
      const resolved = await request<{ path: string }>(
        `/api/directories/resolve?path=${encodeURIComponent(directory.path)}`,
      );
      setDirectory({ path: resolved.path, entries: [] });
      await browse(resolved.path);
    } catch (error) {
      setPickerError((error as Error).message);
      setStatus(`Directory failed: ${(error as Error).message}`);
    } finally {
      setResolvingDirectory(false);
    }
  };
  const openPicker = async () => {
    setPicker(true);
    setPickerError("");
    try {
      const [home, config] = await Promise.all([
        request<Directory>("/api/directories"),
        request<{ launchDirectory: string }>("/api/config"),
      ]);
      const rootOptions: Array<[string, string]> = [
        [home.path, "Home"],
        [config.launchDirectory, "Launch folder"],
        ...projects
          .filter((project) => project.available)
          .map((project): [string, string] => [
            project.path,
            `Project: ${project.name}`,
          ]),
      ];
      const roots = [...new Set(rootOptions.map(([root]) => root))];
      setPickerRoots(roots);
      setPickerRootLabels(
        Object.fromEntries(
          roots.map((root) => [
            root,
            rootOptions.find(([candidate]) => candidate === root)![1],
          ]),
        ),
      );
      setPickerNodes({ [home.path]: home });
      setDirectory(home);
      setResolvedDirectoryPath(home.path);
      setExpandedPickerNodes((current) => new Set([home.path, ...current]));
      const restored = [...storedPathSet("draw-local.picker-expanded")];
      const restoredNodes = await Promise.all(
        restored.map(async (path) => {
          try {
            return await request<Directory>(
              `/api/directories?path=${encodeURIComponent(path)}`,
            );
          } catch {
            return undefined;
          }
        }),
      );
      setPickerNodes((nodes) => ({
        ...nodes,
        ...Object.fromEntries(
          restoredNodes
            .filter((node): node is Directory => Boolean(node))
            .map((node) => [node.path, node]),
        ),
      }));
      const savedLocation = localStorage.getItem("draw-local.picker-location");
      if (savedLocation && savedLocation !== home.path)
        await browse(savedLocation);
    } catch (error) {
      setPickerError((error as Error).message);
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
      closePicker();
    } catch (error) {
      setStatus(`Add directory failed: ${(error as Error).message}`);
    }
  };
  const closePicker = () => {
    setPicker(false);
    requestAnimationFrame(() =>
      window.document.getElementById("browse-folders")?.focus(),
    );
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
      transitionRef.current = true;
      setTransitioning(true);
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
                revision: revisions.current.get(key(open)),
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
      // First Save deletes its source draft. If the editor changed while that
      // transfer was in flight, retain the newer snapshot as a fresh draft
      // instead of replacing the visible document with the older target.
      if (
        open.kind === "draft" &&
        documents.current.get(key(open)) !== content
      ) {
        const recovery = await request<Draft>("/api/drafts", {
          method: "POST",
          body: JSON.stringify({ document: documents.current.get(key(open)) }),
        });
        await refresh(destinationProject);
        await load({ kind: "draft", id: recovery.id });
        setDestination(false);
        setStatus(
          "Saved to the project; newer edits remain in a recovery draft.",
        );
        return;
      }
      documents.current.set(
        `project:${destinationProject}:${destinationPath}`,
        content,
      );
      revisions.current.set(
        `project:${destinationProject}:${destinationPath}`,
        result.revision,
      );
      projectIdRef.current = destinationProject;
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
    } finally {
      transitionRef.current = false;
      setTransitioning(false);
    }
  };
  const save = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      binaryFiles: Record<string, unknown>,
    ) => {
      const target = openRef.current;
      if (!target || transitionRef.current) return;
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
        !event.defaultPrevented &&
        !editable &&
        !destination &&
        !picker &&
        !licenses
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
  useEffect(() => {
    if (trashOpen)
      void refreshTrash().catch((error: Error) => {
        setDialogError(error.message);
        setStatus(`Trash failed: ${error.message}`);
      });
  }, [trashOpen, refreshTrash]);
  const activeProject = projects.find((project) => project.id === projectId);
  const git: GitContext = projectId
    ? (gitByProject[projectId] ?? {
        available: false,
        statuses: {},
        repositoryPaths: [],
      })
    : { available: false, statuses: {}, repositoryPaths: [] };
  const libraryReturnUrl = open
    ? encodeURIComponent(
        `${window.location.origin}${window.location.pathname}?${open.kind === "draft" ? `draft=${open.id}` : `project=${open.projectId}&file=${encodeURIComponent(open.path)}`}`,
      )
    : undefined;
  const onProjectTreeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const buttons = [
      ...(event.currentTarget
        .closest('[role="tree"]')
        ?.querySelectorAll<HTMLButtonElement>(".tree-button, .file") ?? []),
    ];
    const index = buttons.indexOf(event.currentTarget);
    if (event.key === "ArrowDown" && buttons[index + 1]) {
      event.preventDefault();
      buttons[index + 1]!.focus();
      return;
    }
    if (event.key === "ArrowUp" && buttons[index - 1]) {
      event.preventDefault();
      buttons[index - 1]!.focus();
      return;
    }
    const project = event.currentTarget.dataset.projectId;
    const relative = event.currentTarget.dataset.projectPath;
    const treeItem = event.currentTarget.closest('[role="treeitem"]');
    const expanded = treeItem?.getAttribute("aria-expanded") === "true";
    if (
      event.key === "ArrowRight" &&
      project !== undefined &&
      relative !== undefined
    ) {
      event.preventDefault();
      if (!expanded) void toggleProjectEntry(project, relative);
      else
        treeItem
          ?.querySelector<HTMLButtonElement>(
            '[role="group"] > [role="treeitem"] .tree-button',
          )
          ?.focus();
    }
    if (
      event.key === "ArrowLeft" &&
      expanded &&
      project !== undefined &&
      relative !== undefined
    ) {
      event.preventDefault();
      void toggleProjectEntry(project, relative);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      treeItem?.parentElement
        ?.closest('[role="treeitem"]')
        ?.querySelector<HTMLButtonElement>(".tree-button")
        ?.focus();
    }
  };
  const renderProjectEntries = (id: string, relative = "", level = 2) => {
    const projectGit = gitByProject[id] ?? {
      available: false,
      statuses: {},
      repositoryPaths: [],
    };
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
            className={`tree-row directory-row ${entry.gitRoot ? "git-root" : ""}`}
            onDragOver={
              entry.gitRoot
                ? (event) => {
                    if (event.dataTransfer.types.includes(dragFileType))
                      event.preventDefault();
                  }
                : undefined
            }
            onDrop={
              entry.gitRoot
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const source = draggedFile(event.dataTransfer);
                    if (source) void moveDrawing(source, id, entry.path);
                  }
                : undefined
            }
          >
            <button
              type="button"
              className="tree-button"
              data-project-id={id}
              data-project-path={entry.path}
              onClick={() => void toggleProjectEntry(id, entry.path)}
              onKeyDown={onProjectTreeKeyDown}
            >
              <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              <Icon name="folder" />
              {entry.name}
              {entry.gitRoot && (
                <span className="git-root-label" title="Git repository root">
                  Git
                </span>
              )}
            </button>
            {entry.gitRoot && (
              <button
                className="text-button promote-button"
                type="button"
                title={`Make ${entry.name} the project root`}
                onClick={() => {
                  const project = projects.find((item) => item.id === id);
                  if (project) {
                    setDialogError("");
                    setPromoteTarget({ project, path: entry.path });
                  }
                }}
              >
                Make root
              </button>
            )}
            <div role="group">
              {renderProjectEntries(id, entry.path, level + 1)}
            </div>
          </div>
        );
      }
      const label = projectGit.repositoryPaths?.includes(entry.path)
        ? (projectGit.statuses[entry.path]?.label ?? "Committed")
        : "";
      const gitState = projectGit.statuses[entry.path];
      const conflicted = gitState?.label === "Conflicted";
      const base = conflicted
        ? "◆"
        : gitState?.index === "?"
          ? "?"
          : gitState?.index === "!"
            ? "⊘"
            : gitState?.index && gitState.index !== " "
              ? "◆"
              : "✓";
      const overlay = conflicted
        ? "!"
        : gitState?.worktree && gitState.worktree !== " "
          ? "●"
          : "";
      const target: FileTarget = {
        projectId: id,
        path: entry.path,
        revision: entry.revision ?? "",
      };
      const isDrawing = entry.path.toLowerCase().endsWith(".excalidraw");
      return (
        <div
          key={childIdentity}
          className="drawing-row"
          role="treeitem"
          aria-level={level}
          aria-current={
            open?.kind === "file" &&
            open.projectId === id &&
            open.path === entry.path
              ? "page"
              : undefined
          }
          aria-label={`${entry.name}${isDrawing ? `, ${entry.theme === "dark" ? "dark theme" : entry.theme === "light" ? "light theme" : "theme follows system"}` : ""}${label ? `, Git: ${label}` : ""}`}
          onKeyDown={(event) =>
            deletionShortcut(event, {
              open: { kind: "file", projectId: id, path: entry.path },
              name: entry.name,
              revision: entry.revision ?? "",
              focusId: fileRowId(id, entry.path),
            })
          }
        >
          <button
            id={fileRowId(id, entry.path)}
            type="button"
            className={
              open?.kind === "file" &&
              open.projectId === id &&
              open.path === entry.path
                ? "file active"
                : "file"
            }
            onKeyDown={onProjectTreeKeyDown}
            title={label || entry.name}
            draggable
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(dragFileType, JSON.stringify(target));
            }}
            onClick={() => {
              selectProject(id);
              void load({ kind: "file", projectId: id, path: entry.path });
            }}
          >
            {label && (
              <span
                className="git-icon"
                aria-hidden="true"
                data-git-state={label}
                title={`Git: ${label}`}
              >
                <span>{base}</span>
                {overlay && <sup>{overlay}</sup>}
              </span>
            )}
            {isDrawing && <ThemeBadge theme={entry.theme} />}
            <span className="drawing-name">{entry.name}</span>
          </button>
          <div className="drawing-actions">
            <RowAction
              id={`rename-${fileRowId(id, entry.path)}`}
              icon="rename"
              label={`Rename ${entry.name}`}
              onClick={() => {
                setDialogError("");
                setRenameTarget(target);
                setRenamePath(entry.path);
              }}
            />
            <RowAction
              id={`trash-${fileRowId(id, entry.path)}`}
              icon="trash"
              label={`Delete ${entry.name}`}
              onClick={() => {
                setDialogError("");
                setDeleteTarget({
                  open: { kind: "file", projectId: id, path: entry.path },
                  name: entry.name,
                  revision: entry.revision ?? "",
                  focusId: `trash-${fileRowId(id, entry.path)}`,
                });
              }}
            />
          </div>
        </div>
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
  const renameFile = async () => {
    const target = renameTarget;
    const next = renamePath.trim();
    if (!target || !next) return;
    if (next === target.path) {
      setRenameTarget(undefined);
      return;
    }
    const currentOpen =
      open?.kind === "file" &&
      open.projectId === target.projectId &&
      open.path === target.path
        ? open
        : undefined;
    try {
      transitionRef.current = true;
      setTransitioning(true);
      if (currentOpen) {
        await flush(currentOpen);
        if (documentStates.current.get(key(currentOpen)) === "conflict")
          throw new Error("Resolve the open drawing's save conflict first.");
      }
      const info = await request<FileInfo>(
        `/api/project/rename?projectId=${encodeURIComponent(target.projectId)}`,
        {
          method: "POST",
          body: JSON.stringify({
            from: target.path,
            to: next,
            revision: currentOpen
              ? revisions.current.get(key(currentOpen))
              : target.revision,
          }),
        },
      );
      const oldIdentity = `project:${target.projectId}:${target.path}`;
      const nextOpen: Open = {
        kind: "file",
        projectId: target.projectId,
        path: next,
      };
      // Edits can arrive while the rename request is in flight. Move that
      // latest in-memory snapshot to the new identity before reloading.
      const latest = documents.current.get(oldIdentity);
      const pending = timers.current.get(oldIdentity);
      if (pending) clearTimeout(pending);
      if (latest !== undefined) documents.current.set(key(nextOpen), latest);
      documents.current.delete(oldIdentity);
      revisions.current.set(key(nextOpen), info.revision);
      revisions.current.delete(oldIdentity);
      timers.current.delete(oldIdentity);
      writes.current.delete(oldIdentity);
      if (currentOpen && latest !== undefined) await persist(nextOpen);
      await loadProjectEntries(
        target.projectId,
        target.path.split("/").slice(0, -1).join("/"),
      );
      if (
        next.split("/").slice(0, -1).join("/") !==
        target.path.split("/").slice(0, -1).join("/")
      )
        await loadProjectEntries(
          target.projectId,
          next.split("/").slice(0, -1).join("/"),
        );
      await refreshGit(target.projectId);
      if (currentOpen) await load(nextOpen);
      setRenameTarget(undefined);
    } catch (error) {
      setDialogError((error as Error).message);
      setStatus(`Rename failed: ${(error as Error).message}`);
    } finally {
      transitionRef.current = false;
      setTransitioning(false);
    }
  };
  const beginDraftRename = (draft: Draft) => {
    cancelledDraftRename.current = undefined;
    setRenamingDraft(draft.id);
    setDraftName(draft.name ?? "Untitled draft");
    setDraftNameError("");
  };
  useEffect(() => {
    draftRenameInput.current?.select();
  }, [renamingDraft]);
  const commitDraftRename = async (draft: Draft) => {
    if (cancelledDraftRename.current === draft.id) {
      cancelledDraftRename.current = undefined;
      return;
    }
    const name = draftName.trim();
    if (!name) return setDraftNameError("A draft name is required.");
    if (name.length > 100)
      return setDraftNameError("Draft names must be 100 characters or fewer.");
    const target: Open = { kind: "draft", id: draft.id };
    const identity = key(target);
    let attempted: unknown, previous: unknown;
    try {
      const current = documents.current.get(identity);
      const loaded = current
        ? undefined
        : await request<{ document: unknown; revision: string }>(
            `/api/draft/${encodeURIComponent(draft.id)}`,
          );
      const saved = current ?? loaded!.document;
      previous = saved;
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
      attempted = next;
      documents.current.set(identity, next);
      await persist(target);
      setDrafts((items) =>
        items.map((item) => (item.id === draft.id ? { ...item, name } : item)),
      );
      setRenamingDraft(undefined);
      setDraftNameError("");
      requestAnimationFrame(() =>
        window.document.getElementById(`draft-${draft.id}`)?.focus(),
      );
      if (open?.kind === "draft" && open.id === draft.id) setDocument(next);
    } catch (error) {
      if (documents.current.get(identity) === attempted) {
        documents.current.set(identity, previous);
        if (open?.kind === "draft" && open.id === draft.id)
          setDocument(previous);
      }
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
      await refreshGit(project.id);
    } catch (error) {
      setStatus(`Locate project failed: ${(error as Error).message}`);
    }
  };
  const removeProject = async (project: Project) => {
    const isOpen = open?.kind === "file" && open.projectId === project.id;
    try {
      if (isOpen) {
        await flush(open);
        if (documentStates.current.get(key(open)) === "conflict")
          throw new Error("Resolve the open drawing's save conflict first.");
      }
      if (isOpen) await newDraft();
      await request<void>(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
      setRemoveTarget(undefined);
      if (projectId === project.id) {
        projectIdRef.current = undefined;
        setProjectId(undefined);
      }
      await retryProject();
    } catch (error) {
      setDialogError((error as Error).message);
      setStatus(`Remove project failed: ${(error as Error).message}`);
    }
  };
  const promoteProject = async () => {
    if (!promoteTarget) return;
    const { project, path } = promoteTarget;
    try {
      if (open?.kind === "file" && open.projectId === project.id) {
        await flush(open);
        if (documentStates.current.get(key(open)) === "conflict")
          throw new Error("Resolve the open drawing's save conflict first.");
        await newDraft();
      }
      await request<Project>(
        `/api/projects/${encodeURIComponent(project.id)}/promote`,
        {
          method: "POST",
          body: JSON.stringify({ path }),
        },
      );
      setPromoteTarget(undefined);
      projectEntriesRef.current = Object.fromEntries(
        Object.entries(projectEntriesRef.current).filter(
          ([identity]) => !identity.startsWith(`${project.id}:`),
        ),
      );
      setProjectEntries(projectEntriesRef.current);
      const expanded = new Set(
        [...expandedEntriesRef.current].filter(
          (identity) => !identity.startsWith(`${project.id}:`),
        ),
      );
      expanded.add(`${project.id}:`);
      expandedEntriesRef.current = expanded;
      setExpandedEntries(expanded);
      await retryProject();
      await loadProjectEntries(project.id);
      await refreshGit(project.id);
      selectProject(project.id);
    } catch (error) {
      setDialogError((error as Error).message);
      setStatus(`Project root change failed: ${(error as Error).message}`);
    }
  };
  const deleteDrawing = async (target: DeleteTarget) => {
    const currentOpen =
      open && key(open) === key(target.open) ? open : undefined;
    let deleted = false;
    try {
      transitionRef.current = true;
      setTransitioning(true);
      if (currentOpen) {
        await flush(currentOpen);
        if (documentStates.current.get(key(currentOpen)) === "conflict")
          throw new Error("Resolve the open drawing's save conflict first.");
      }
      const revision = currentOpen
        ? revisions.current.get(key(currentOpen))
        : target.revision;
      if (!revision)
        throw new Error(
          "Drawing revision is unavailable. Refresh and try again.",
        );
      if (target.open.kind === "draft") {
        await request<TrashEntry>(
          `/api/draft/${encodeURIComponent(target.open.id)}/trash`,
          {
            method: "POST",
            body: JSON.stringify({ revision }),
          },
        );
      } else {
        await request<TrashEntry>("/api/project/trash", {
          method: "POST",
          body: JSON.stringify({
            projectId: target.open.projectId,
            path: target.open.path,
            revision,
          }),
        });
      }
      deleted = true;
      setDeleteTarget(undefined);
      if (currentOpen) {
        openRef.current = undefined;
        setOpen(undefined);
        setDocument(undefined);
      }
      if (target.open.kind === "file") {
        await loadProjectEntries(
          target.open.projectId,
          target.open.path.split("/").slice(0, -1).join("/"),
        );
        await refreshGit(target.open.projectId);
      }
      const identity = key(target.open);
      const timer = timers.current.get(identity);
      if (timer) clearTimeout(timer);
      timers.current.delete(identity);
      documents.current.delete(identity);
      revisions.current.delete(identity);
      writes.current.delete(identity);
      documentStates.current.delete(identity);
      if (currentOpen) await newDraft();
      else await refresh();
      await refreshTrash();
      setStatus(`${target.name} moved to Trash.`);
    } catch (error) {
      if (!deleted) setDialogError((error as Error).message);
      setStatus(
        `${deleted ? "Moved to Trash, but the view did not refresh" : "Delete failed"}: ${(error as Error).message}`,
      );
    } finally {
      transitionRef.current = false;
      setTransitioning(false);
    }
  };
  const restoreDrawing = async (
    item: TrashEntry,
    destination?: { projectId: string; path: string },
  ) => {
    let restoredFile = false;
    try {
      const restored = await request<TrashEntry>(
        `/api/trash/${encodeURIComponent(item.id)}/restore`,
        {
          method: "POST",
          ...(destination ? { body: JSON.stringify(destination) } : {}),
        },
      );
      restoredFile = true;
      setDialogError("");
      setRestoreTarget(undefined);
      await refreshTrash();
      if (restored.kind === "file" && restored.projectId && restored.path) {
        await loadProjectEntries(restored.projectId);
        await loadProjectEntries(
          restored.projectId,
          restored.path.split("/").slice(0, -1).join("/"),
        );
        await refreshGit(restored.projectId);
      } else await refresh();
      setStatus(`${item.name} restored.`);
    } catch (error) {
      setDialogError((error as Error).message);
      setStatus(
        `${restoredFile ? "Restored, but the view did not refresh" : "Restore failed"}: ${(error as Error).message}`,
      );
    }
  };
  const beginRestoreElsewhere = (item: TrashEntry) => {
    setDialogError("");
    setRestoreProject(
      projects.some(
        (project) => project.id === item.projectId && project.available,
      )
        ? item.projectId!
        : (projects.find((project) => project.available)?.id ?? ""),
    );
    setRestorePath(item.path ?? item.name);
    setRestoreTarget(item);
  };
  const moveDrawing = async (
    source: FileTarget,
    toProjectId: string,
    toDirectory = "",
  ) => {
    const currentOpen =
      open?.kind === "file" &&
      open.projectId === source.projectId &&
      open.path === source.path
        ? open
        : undefined;
    let moved = false;
    try {
      transitionRef.current = true;
      setTransitioning(true);
      if (currentOpen) {
        await flush(currentOpen);
        if (documentStates.current.get(key(currentOpen)) === "conflict")
          throw new Error("Resolve the open drawing's save conflict first.");
      }
      const revision = currentOpen
        ? revisions.current.get(key(currentOpen))
        : source.revision;
      if (!revision)
        throw new Error(
          "Drawing revision is unavailable. Refresh and try again.",
        );
      const result = await request<FileInfo>("/api/project/move", {
        method: "POST",
        body: JSON.stringify({
          fromProjectId: source.projectId,
          fromPath: source.path,
          toProjectId,
          toDirectory,
          revision,
        }),
      });
      moved = true;
      if (currentOpen) {
        const movedOpen: Open = {
          kind: "file",
          projectId: toProjectId,
          path: result.path,
        };
        openRef.current = undefined;
        setOpen(undefined);
        setDocument(undefined);
        projectIdRef.current = toProjectId;
        setProjectId(toProjectId);
        await load(movedOpen);
      }
      await Promise.all([
        loadProjectEntries(
          source.projectId,
          source.path.split("/").slice(0, -1).join("/"),
        ),
        loadProjectEntries(toProjectId, toDirectory),
      ]);
      await Promise.all([
        refreshGit(source.projectId),
        refreshGit(toProjectId),
      ]);
      setStatus(`Moved ${source.path} to ${result.path}.`);
    } catch (error) {
      setStatus(
        `${moved ? "Drawing moved, but the view did not refresh" : "Move failed"}: ${(error as Error).message}`,
      );
    } finally {
      transitionRef.current = false;
      setTransitioning(false);
    }
  };
  const deletionShortcut = (
    event: React.KeyboardEvent,
    target: DeleteTarget,
  ) => {
    if (
      (event.target as HTMLElement).closest(
        "input, textarea, select, [contenteditable=true]",
      )
    )
      return;
    const action = drawingDeletionAction(event, platform());
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "bypass") void deleteDrawing(target);
    else {
      setDialogError("");
      setDeleteTarget(target);
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
        setResolvedDirectoryPath(next.path);
      } catch (error) {
        setPickerError((error as Error).message);
        setExpandedPickerNodes(
          (current) => new Set([...current].filter((item) => item !== path)),
        );
        setStatus(`Directory failed: ${(error as Error).message}`);
      }
    }
  };
  const pickerNodeMatches = (path: string, query: string): boolean => {
    if (!query) return true;
    const name = path.split("/").filter(Boolean).at(-1) ?? path;
    return (
      name.toLocaleLowerCase().includes(query) ||
      (pickerNodes[path]?.entries.some((entry) =>
        pickerNodeMatches(`${path}/${entry}`, query),
      ) ??
        false)
    );
  };
  const renderPickerNode = (path: string, name: string, level = 1) => {
    const node = pickerNodes[path];
    const expanded = expandedPickerNodes.has(path);
    const query = pickerSearch.trim().toLocaleLowerCase();
    const visibleChildren = node?.entries.filter((entry) =>
      pickerNodeMatches(`${path}/${entry}`, query),
    );
    if (!pickerNodeMatches(path, query)) return null;
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
          data-picker-path={path}
          title={path}
          onClick={() => {
            setPickerError("");
            setDirectory(node ?? { path, entries: [] });
            setResolvedDirectoryPath(node ? path : undefined);
            void togglePickerNode(path);
          }}
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
          <Icon name="folder" />
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
            id="save-command"
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
            disabled={!open}
            disabledReason="Open a drawing first"
            onClick={openDestination}
          />
        </div>
        <div className="expanded-only git">
          {git.available
            ? `Branch: ${git.branch ?? "Detached HEAD"}`
            : activeProject
              ? "Not a Git repository"
              : ""}
          {projectId && (
            <button
              className="text-button git-refresh"
              type="button"
              aria-label="Refresh Git status"
              title="Refresh Git status"
              onClick={() => void refresh(projectId)}
            >
              <Icon name="refresh" />
            </button>
          )}
        </div>
        <div className="expanded-only files">
          <strong>Drafts</strong>
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="draft-row"
              onKeyDown={(event) =>
                deletionShortcut(event, {
                  open: { kind: "draft", id: draft.id },
                  name: draft.name ?? "Untitled draft",
                  revision: draft.revision,
                  focusId: `draft-${draft.id}`,
                })
              }
            >
              {renamingDraft === draft.id ? (
                <input
                  aria-label="Draft name"
                  autoFocus
                  ref={draftRenameInput}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commitDraftRename(draft);
                    if (event.key === "Escape") {
                      cancelledDraftRename.current = draft.id;
                      setRenamingDraft(undefined);
                      requestAnimationFrame(() =>
                        window.document
                          .getElementById(`draft-${draft.id}`)
                          ?.focus(),
                      );
                    }
                  }}
                  onBlur={() => void commitDraftRename(draft)}
                  aria-describedby={
                    draftNameError ? "draft-name-error" : undefined
                  }
                />
              ) : (
                <button
                  id={`draft-${draft.id}`}
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
                  <ThemeBadge theme={draft.theme} />
                  <span className="drawing-name">
                    {draft.name ?? "Untitled draft"}
                  </span>
                </button>
              )}
              {renamingDraft === draft.id && draftNameError && (
                <span id="draft-name-error" className="inline-error">
                  {draftNameError}
                </span>
              )}
              <div className="drawing-actions">
                <RowAction
                  icon="rename"
                  label={`Rename ${draft.name ?? "Untitled draft"}`}
                  onClick={() => beginDraftRename(draft)}
                />
                <RowAction
                  icon="trash"
                  label={`Delete ${draft.name ?? "Untitled draft"}`}
                  onClick={() => {
                    setDialogError("");
                    setDeleteTarget({
                      open: { kind: "draft", id: draft.id },
                      name: draft.name ?? "Untitled draft",
                      revision: draft.revision,
                      focusId: `draft-${draft.id}`,
                    });
                  }}
                />
              </div>
            </div>
          ))}
          <strong>Projects</strong>
          <div role="tree" aria-label="Project explorer">
            {projects.map((project) => {
              const rootIdentity = `${project.id}:`;
              const expanded = expandedEntries.has(rootIdentity);
              const projectGit = gitByProject[project.id];
              return (
                <div
                  key={project.id}
                  role="treeitem"
                  aria-level={1}
                  aria-expanded={project.available ? expanded : undefined}
                  className="tree-row project-root"
                  draggable
                  onDragStart={(event) => {
                    if ((event.target as HTMLElement).closest(".drawing-row"))
                      return;
                    event.dataTransfer.setData("text/plain", project.id);
                  }}
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer.types.includes(dragFileType) &&
                      !projectGit?.available
                    )
                      return;
                    event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggedFile(event.dataTransfer);
                    if (source) {
                      if (projectGit?.available)
                        void moveDrawing(source, project.id);
                      return;
                    }
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
                    data-project-id={project.id}
                    data-project-path=""
                    disabled={!project.available}
                    title={project.path}
                    onClick={() => {
                      selectProject(project.id);
                      void toggleProjectEntry(project.id);
                    }}
                    onKeyDown={onProjectTreeKeyDown}
                  >
                    <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
                    <Icon name="folder" />
                    {project.name}
                    {project.available ? "" : " (unavailable)"}
                    {projectGit && (
                      <span
                        className="project-git-context"
                        title={
                          projectGit.available
                            ? `Git branch: ${projectGit.branch ?? "Detached HEAD"}`
                            : "Not a Git repository"
                        }
                        aria-label={
                          projectGit.available
                            ? `Git branch: ${projectGit.branch ?? "Detached HEAD"}`
                            : "Not a Git repository"
                        }
                      >
                        {projectGit.available ? "Git" : "No Git"}
                      </span>
                    )}
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
                      onClick={() => {
                        setDialogError("");
                        setRemoveTarget(project);
                      }}
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
            id="browse-folders"
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
          <IconButton
            id="licenses-command"
            icon="licenses"
            onClick={() => setLicenses(true)}
          />
          <IconButton
            id="trash-command"
            icon="trash"
            onClick={() => {
              setDialogError("");
              setTrashOpen(true);
            }}
          />
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
            viewModeEnabled={transitioning}
          />
        ) : (
          <div className="empty">
            <h1>Local drawings, normal files.</h1>
            <button onClick={() => void newDraft()}>Create a drawing</button>
          </div>
        )}
        {renameTarget && (
          <Modal
            labelledBy="rename-dialog-title"
            onClose={() => setRenameTarget(undefined)}
            restoreFocusId={`rename-${fileRowId(renameTarget.projectId, renameTarget.path)}`}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void renameFile();
              }}
            >
              <h2 id="rename-dialog-title">Rename drawing</h2>
              <label>
                Project-relative filename
                <input
                  required
                  value={renamePath}
                  onChange={(event) => setRenamePath(event.target.value)}
                />
              </label>
              <p>Existing files are protected.</p>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              <button type="submit">Rename</button>
              <button type="button" onClick={() => setRenameTarget(undefined)}>
                Cancel
              </button>
            </form>
          </Modal>
        )}
        {deleteTarget && (
          <Modal
            labelledBy="delete-dialog-title"
            onClose={() => setDeleteTarget(undefined)}
            restoreFocusId={deleteTarget.focusId ?? "trash-command"}
          >
            <div>
              <h2 id="delete-dialog-title">Move drawing to Trash?</h2>
              <p>
                <strong>{deleteTarget.name}</strong> can be restored from
                draw-local’s local Trash.
              </p>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void deleteDrawing(deleteTarget)}
              >
                Move to Trash
              </button>
              <button type="button" onClick={() => setDeleteTarget(undefined)}>
                Cancel
              </button>
            </div>
          </Modal>
        )}
        {removeTarget && (
          <Modal
            labelledBy="remove-project-title"
            onClose={() => setRemoveTarget(undefined)}
            restoreFocusId="browse-folders"
          >
            <div>
              <h2 id="remove-project-title">Remove project from workspace?</h2>
              <p>
                <strong>{removeTarget.name}</strong> will disappear from this
                explorer. Its folder and drawings stay on disk.
              </p>
              <p className="project-path">{removeTarget.path}</p>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              <button
                type="button"
                onClick={() => void removeProject(removeTarget)}
              >
                Remove from workspace
              </button>
              <button type="button" onClick={() => setRemoveTarget(undefined)}>
                Cancel
              </button>
            </div>
          </Modal>
        )}
        {promoteTarget && (
          <Modal
            labelledBy="promote-project-title"
            onClose={() => setPromoteTarget(undefined)}
            restoreFocusId="browse-folders"
          >
            <div>
              <h2 id="promote-project-title">Make this the project root?</h2>
              <p>
                The explorer will show <strong>{promoteTarget.path}</strong> as
                this project’s root. The parent folder and its files stay on
                disk.
              </p>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              <button type="button" onClick={() => void promoteProject()}>
                Make project root
              </button>
              <button type="button" onClick={() => setPromoteTarget(undefined)}>
                Cancel
              </button>
            </div>
          </Modal>
        )}
        {trashOpen && !restoreTarget && (
          <Modal
            labelledBy="trash-dialog-title"
            onClose={() => setTrashOpen(false)}
            restoreFocusId="trash-command"
          >
            <div className="trash-dialog">
              <h2 id="trash-dialog-title">Trash</h2>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              {trashItems.length === 0 ? (
                <p>No drawings in Trash.</p>
              ) : (
                <ul className="trash-list">
                  {trashItems.map((item) => (
                    <li key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.kind === "file" ? item.path : "Draft"} ·{" "}
                          {new Date(item.deletedAt).toLocaleString()}
                        </small>
                      </span>
                      <RowAction
                        icon="restore"
                        label={`Restore ${item.name}`}
                        onClick={() => void restoreDrawing(item)}
                      />
                      {item.kind === "file" && (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => beginRestoreElsewhere(item)}
                        >
                          Restore elsewhere
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setTrashOpen(false)}>
                Close
              </button>
            </div>
          </Modal>
        )}
        {restoreTarget && (
          <Modal
            labelledBy="restore-elsewhere-title"
            onClose={() => setRestoreTarget(undefined)}
            restoreFocusId="trash-command"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (restoreProject && restorePath)
                  void restoreDrawing(restoreTarget, {
                    projectId: restoreProject,
                    path: restorePath,
                  });
              }}
            >
              <h2 id="restore-elsewhere-title">Restore drawing elsewhere</h2>
              <p>
                Choose a registered project and an unused filename for{" "}
                <strong>{restoreTarget.name}</strong>.
              </p>
              <label>
                Project
                <select
                  value={restoreProject}
                  onChange={(event) => setRestoreProject(event.target.value)}
                >
                  {projects
                    .filter((project) => project.available)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Project-relative filename
                <input
                  required
                  value={restorePath}
                  onChange={(event) => setRestorePath(event.target.value)}
                />
              </label>
              {dialogError && (
                <p className="inline-error" role="alert">
                  {dialogError}
                </p>
              )}
              <button type="submit" disabled={!restoreProject}>
                Restore
              </button>
              <button type="button" onClick={() => setRestoreTarget(undefined)}>
                Cancel
              </button>
            </form>
          </Modal>
        )}
        {destination && (
          <Modal
            labelledBy="save-dialog-title"
            onClose={() => setDestination(false)}
            restoreFocusId="save-command"
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveTo();
              }}
            >
              <h2 id="save-dialog-title">
                {open?.kind === "draft" ? "Save drawing" : "Save As"}
              </h2>
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
          </Modal>
        )}
        {picker && (
          <Modal
            labelledBy="folder-picker-title"
            onClose={closePicker}
            restoreFocusId="browse-folders"
          >
            <div className="folder-picker">
              <h2 id="folder-picker-title">Choose project folder</h2>
              <label>
                Folder path
                <input
                  value={directory?.path ?? ""}
                  onChange={(event) => {
                    setDirectory({ path: event.target.value, entries: [] });
                    setResolvedDirectoryPath(undefined);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void resolveTypedDirectory();
                    }
                  }}
                  placeholder="/absolute/path"
                />
              </label>
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
                  Go to path
                </button>
              </div>
              <div className="folder-list" role="tree" aria-label="Folder tree">
                {pickerRoots.map((root) => (
                  <div className="picker-root" key={root} role="presentation">
                    <div className="picker-root-label" aria-hidden="true">
                      {pickerRootLabels[root]}
                    </div>
                    {renderPickerNode(root, root)}
                  </div>
                ))}
              </div>
              {pickerSearch &&
                !pickerRoots.some((root) =>
                  pickerNodeMatches(
                    root,
                    pickerSearch.trim().toLocaleLowerCase(),
                  ),
                ) && <p>Only discovered folders are searched.</p>}
              {pickerError && (
                <p className="inline-error" role="alert">
                  {pickerError}
                </p>
              )}
              <button
                disabled={
                  !directory ||
                  resolvingDirectory ||
                  resolvedDirectoryPath !== directory.path
                }
                onClick={() => void addDirectory()}
              >
                Use this folder
              </button>
              <button onClick={closePicker}>Cancel</button>
            </div>
          </Modal>
        )}
        {licenses && (
          <Modal
            labelledBy="licenses-title"
            onClose={() => setLicenses(false)}
            restoreFocusId="licenses-command"
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
                        aria-selected={selectedNotice === noticeId(notice)}
                        className={
                          selectedNotice === noticeId(notice) ? "active" : ""
                        }
                        key={noticeId(notice)}
                        onClick={() => setSelectedNotice(noticeId(notice))}
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
                    notices.find((item) => noticeId(item) === selectedNotice) ??
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
          </Modal>
        )}
      </main>
    </div>
  );
}
