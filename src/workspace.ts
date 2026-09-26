import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const extensions = new Set([".excalidraw", ".excalidrawlib"]);
export type WorkspaceFile = {
  path: string;
  size: number;
  modifiedAt: string;
  revision: string;
};
export type Project = {
  id: string;
  path: string;
  name: string;
  available: boolean;
  error?: string;
};
export type Draft = WorkspaceFile & { id: string; name?: string };
export type ProjectEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  revision?: string;
};
type StoredProject = Pick<Project, "id" | "path" | "name">;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export class Workspace {
  readonly root: string;
  readonly gitWriteEnabled: boolean;
  readonly configPath: string;
  readonly draftsPath: string;
  readonly libraryPath: string;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(
    root = process.env.DRAW_LOCAL_ROOT ??
      path.resolve(process.cwd(), "diagrams"),
    options?: {
      configPath?: string;
      draftsPath?: string;
      libraryPath?: string;
    },
  ) {
    this.root = path.resolve(root);
    this.gitWriteEnabled = process.env.DRAW_LOCAL_ALLOW_GIT_WRITE === "1";
    this.configPath =
      options?.configPath ??
      path.join(
        process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
        "draw-local",
        "projects.json",
      );
    this.draftsPath =
      options?.draftsPath ??
      path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        "draw-local",
        "drafts",
      );
    this.libraryPath =
      options?.libraryPath ??
      path.join(path.dirname(this.draftsPath), "library.excalidrawlib");
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.dirname(this.configPath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(this.draftsPath, { recursive: true, mode: 0o700 });
    try {
      await fs.access(this.configPath);
    } catch {
      await this.writeAtomic(this.configPath, {
        projects: [
          {
            id: "default",
            path: await fs.realpath(this.root),
            name: path.basename(this.root) || this.root,
          },
        ],
      });
    }
  }
  private async withLock<T>(
    identity: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(identity) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(identity, queued);
    await previous.catch(() => {});
    try {
      return await action();
    } finally {
      release();
      if (this.locks.get(identity) === queued) this.locks.delete(identity);
    }
  }
  private async registry(): Promise<StoredProject[]> {
    await this.init();
    const value = JSON.parse(await fs.readFile(this.configPath, "utf8")) as {
      projects?: StoredProject[];
    };
    return Array.isArray(value.projects) ? value.projects : [];
  }
  private async saveRegistry(projects: StoredProject[]) {
    await this.writeAtomic(this.configPath, { projects });
  }
  private async writeAtomic(target: string, value: unknown, exclusive = false) {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temp = path.join(
      path.dirname(target),
      `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`,
    );
    try {
      await fs.writeFile(temp, json(value), { mode: 0o600, flag: "wx" });
      if (exclusive) {
        await fs.link(temp, target);
        await fs.unlink(temp);
      } else await fs.rename(temp, target);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      if (exclusive && (error as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("Destination already exists.");
      throw error;
    }
  }
  private async canonicalDirectory(input: string) {
    if (!input || !path.isAbsolute(input))
      throw new Error("Directory path must be absolute.");
    const resolved = await fs.realpath(input);
    if (!(await fs.stat(resolved)).isDirectory())
      throw new Error("Path is not a directory.");
    return resolved;
  }
  async listProjects(): Promise<Project[]> {
    return Promise.all(
      (await this.registry()).map(async (project) => {
        try {
          const resolved = await this.canonicalDirectory(project.path);
          return { ...project, path: resolved, available: true };
        } catch (error) {
          return {
            ...project,
            available: false,
            error:
              error instanceof Error ? error.message : "Unavailable project",
          };
        }
      }),
    );
  }
  async registerProject(directory: string, name?: string): Promise<Project> {
    const canonical = await this.canonicalDirectory(directory);
    return this.withLock(`registry:${this.configPath}`, async () => {
      const projects = await this.registry();
      const existing = projects.find((project) => project.path === canonical);
      if (existing) return { ...existing, available: true };
      const project = {
        id: randomUUID(),
        path: canonical,
        name: name?.trim() || path.basename(canonical) || canonical,
      };
      await this.saveRegistry([...projects, project]);
      return { ...project, available: true };
    });
  }
  async reorderProjects(ids: string[]) {
    return this.withLock(`registry:${this.configPath}`, async () => {
      const projects = await this.registry();
      if (
        ids.length !== projects.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !projects.some((project) => project.id === id))
      )
        throw new Error(
          "Project order must contain every registered project once.",
        );
      const byId = new Map(projects.map((project) => [project.id, project]));
      const ordered = ids.map((id) => byId.get(id)!);
      await this.saveRegistry(ordered);
      return this.listProjects();
    });
  }
  async locateProject(id: string, directory: string) {
    const canonical = await this.canonicalDirectory(directory);
    return this.withLock(`registry:${this.configPath}`, async () => {
      const projects = await this.registry();
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) throw new Error("Unknown project.");
      if (
        projects.some(
          (project) => project.id !== id && project.path === canonical,
        )
      )
        throw new Error(
          "That directory is already registered as another project.",
        );
      const updated = { ...projects[index]!, path: canonical };
      projects[index] = updated;
      await this.saveRegistry(projects);
      return { ...updated, available: true };
    });
  }
  async removeProject(id: string) {
    return this.withLock(`registry:${this.configPath}`, async () => {
      const projects = await this.registry();
      if (!projects.some((project) => project.id === id))
        throw new Error("Unknown project.");
      await this.saveRegistry(projects.filter((project) => project.id !== id));
    });
  }
  private isSensitiveBrowsePath(directory: string) {
    const home = path.resolve(os.homedir());
    const sensitiveRoots = [
      "/boot",
      "/dev",
      "/etc",
      "/proc",
      "/root",
      "/run",
      "/sys",
      "/var",
      "/System",
      "/Library",
      "/private",
      "/Volumes",
    ];
    if (
      sensitiveRoots.some(
        (root) => directory === root || directory.startsWith(root + path.sep),
      )
    )
      return true;
    const relative = path.relative(home, directory);
    if (
      relative !== "" &&
      !relative.startsWith(".." + path.sep) &&
      relative !== ".."
    ) {
      const parts = relative.split(path.sep);
      if (
        parts.some((part) => part.startsWith(".")) ||
        parts[0]?.toLowerCase() === "library"
      )
        return true;
    }
    const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean);
    const drive =
      parts.findIndex((part) => /^[a-z]:$/i.test(part)) >= 0
        ? parts.findIndex((part) => /^[a-z]:$/i.test(part))
        : parts[0] === "mnt" && /^[a-z]$/i.test(parts[1] ?? "")
          ? 1
          : -1;
    if (drive < 0) return false;
    const windowsRoot = parts[drive + 1]?.toLowerCase();
    if (
      [
        "windows",
        "program files",
        "program files (x86)",
        "programdata",
        "$recycle.bin",
        "system volume information",
        "recovery",
        "perflogs",
      ].includes(windowsRoot ?? "")
    )
      return true;
    return (
      windowsRoot === "users" && parts[drive + 3]?.toLowerCase() === "appdata"
    );
  }
  async browseDirectory(directory?: string) {
    const resolved = await this.canonicalDirectory(directory || os.homedir());
    if (this.isSensitiveBrowsePath(resolved))
      throw new Error(
        "Sensitive or hidden directories are not available in the folder picker.",
      );
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const parent = path.dirname(resolved);
    return {
      path: resolved,
      parent:
        parent === resolved || this.isSensitiveBrowsePath(parent)
          ? undefined
          : parent,
      entries: entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !entry.name.startsWith("."),
        )
        .map((entry) => entry.name)
        .sort(),
    };
  }
  async resolveDirectory(directory: string) {
    return { path: await this.canonicalDirectory(directory) };
  }
  private async projectRoot(id: string) {
    const project = (await this.listProjects()).find((item) => item.id === id);
    if (!project) throw new Error("Unknown project.");
    if (!project.available)
      throw new Error(project.error || "Project is unavailable.");
    return project.path;
  }
  private resolve(root: string, relative: string) {
    if (!relative || path.isAbsolute(relative))
      throw new Error("Path must be project-relative.");
    const portable = relative.replaceAll("\\", "/");
    if (portable.split("/").includes(".."))
      throw new Error("Parent traversal is not allowed.");
    const target = path.resolve(root, portable);
    if (target !== root && !target.startsWith(root + path.sep))
      throw new Error("Path escapes project root.");
    return target;
  }
  private assertFile(relative: string) {
    if (!extensions.has(path.extname(relative).toLowerCase()))
      throw new Error("Only .excalidraw and .excalidrawlib files are allowed.");
  }
  private async assertNoSymlink(root: string, target: string) {
    let current = root;
    for (const part of path.relative(root, target).split(path.sep)) {
      current = path.join(current, part);
      try {
        if ((await fs.lstat(current)).isSymbolicLink())
          throw new Error("Symbolic links are not allowed in workspace paths.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
  }
  private valid(value: unknown, relative: string) {
    if (!value || typeof value !== "object")
      throw new Error("File must contain JSON object data.");
    if (relative.toLowerCase().endsWith(".excalidraw")) {
      const doc = value as { type?: unknown; elements?: unknown };
      if (doc.type !== "excalidraw" || !Array.isArray(doc.elements))
        throw new Error("Invalid Excalidraw document.");
    }
  }
  private revision(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  private async info(root: string, relative: string): Promise<WorkspaceFile> {
    const target = this.resolve(root, relative);
    await this.assertNoSymlink(root, target);
    const [stat, source] = await Promise.all([
      fs.stat(target),
      fs.readFile(target, "utf8"),
    ]);
    return {
      path: relative.replaceAll(path.sep, "/"),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      revision: this.revision(source),
    };
  }
  private async listRoot(root: string): Promise<WorkspaceFile[]> {
    const result: WorkspaceFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (
          [".git", "node_modules"].includes(entry.name) ||
          entry.isSymbolicLink()
        )
          continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (extensions.has(path.extname(entry.name).toLowerCase()))
          result.push(await this.info(root, path.relative(root, absolute)));
      }
    };
    await walk(root);
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  async listProjectFiles(id: string) {
    return this.listRoot(await this.projectRoot(id));
  }
  async listProjectEntries(id: string, relative = ""): Promise<ProjectEntry[]> {
    const root = await this.projectRoot(id);
    if (
      path.isAbsolute(relative) ||
      relative.replaceAll("\\", "/").split("/").includes("..")
    )
      throw new Error("Path must be project-relative.");
    const directory = relative ? this.resolve(root, relative) : root;
    await this.assertNoSymlink(root, directory);
    if (!(await fs.stat(directory)).isDirectory())
      throw new Error("Path is not a directory.");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return Promise.all(
      entries
        .filter(
          (entry) =>
            !entry.isSymbolicLink() &&
            !entry.name.startsWith(".") &&
            ![".git", "node_modules"].includes(entry.name) &&
            (entry.isDirectory() ||
              extensions.has(path.extname(entry.name).toLowerCase())),
        )
        .map(async (entry) => {
          const child = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory())
            return {
              name: entry.name,
              path: child,
              kind: "directory" as const,
            };
          return {
            name: entry.name,
            path: child,
            kind: "file" as const,
            revision: (await this.info(root, child)).revision,
          };
        }),
    ).then((items) => items.sort((a, b) => a.name.localeCompare(b.name)));
  }
  private async readRoot(root: string, relative: string) {
    this.assertFile(relative);
    const target = this.resolve(root, relative);
    await this.assertNoSymlink(root, target);
    const source = await fs.readFile(target, "utf8");
    return { document: JSON.parse(source), revision: this.revision(source) };
  }
  async readProjectFile(id: string, relative: string) {
    return this.readRoot(await this.projectRoot(id), relative);
  }
  private async writeRoot(
    root: string,
    relative: string,
    value: unknown,
    expectedRevision?: string,
    exclusive = false,
  ) {
    this.assertFile(relative);
    this.valid(value, relative);
    const target = this.resolve(root, relative);
    return this.withLock(`write:${target}`, async () => {
      await this.assertNoSymlink(root, target);
      let source: string | undefined;
      try {
        source = await fs.readFile(target, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (exclusive && source !== undefined)
        throw new Error("Destination already exists.");
      if (
        expectedRevision !== undefined &&
        (source === undefined || this.revision(source) !== expectedRevision)
      )
        throw new Error(
          "File changed outside draw-local. Your local copy is still recoverable.",
        );
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await this.assertNoSymlink(root, target);
      // The lock serializes draw-local writers; re-read immediately before replacement
      // so an external editor cannot be overwritten after the initial precondition.
      if (expectedRevision !== undefined) {
        let latest: string | undefined;
        try {
          latest = await fs.readFile(target, "utf8");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (latest === undefined || this.revision(latest) !== expectedRevision)
          throw new Error(
            "File changed outside draw-local. Your local copy is still recoverable.",
          );
      }
      await this.writeAtomic(target, value, exclusive);
      return this.info(root, relative);
    });
  }
  async writeProjectFile(
    id: string,
    relative: string,
    value: unknown,
    expectedRevision?: string,
  ) {
    return this.writeRoot(
      await this.projectRoot(id),
      relative,
      value,
      expectedRevision,
    );
  }
  async createProjectFile(id: string, relative: string, value: unknown) {
    return this.writeRoot(
      await this.projectRoot(id),
      relative,
      value,
      undefined,
      true,
    );
  }
  async createDraft(value: unknown) {
    this.valid(value, "draft.excalidraw");
    const id = randomUUID();
    await this.writeRoot(
      this.draftsPath,
      `${id}.excalidraw`,
      value,
      undefined,
      true,
    );
    return {
      id,
      ...(await this.draftInfo(`${id}.excalidraw`)),
    };
  }
  private async draftInfo(
    relative: string,
  ): Promise<WorkspaceFile & { name?: string }> {
    const info = await this.info(this.draftsPath, relative);
    const value = JSON.parse(
      await fs.readFile(this.resolve(this.draftsPath, relative), "utf8"),
    ) as { appState?: { name?: unknown } };
    const name = value.appState?.name;
    return {
      ...info,
      ...(typeof name === "string" && name.trim()
        ? { name: name.trim().slice(0, 100) }
        : {}),
    };
  }
  async listDrafts(): Promise<Draft[]> {
    await this.init();
    return Promise.all(
      (await this.listRoot(this.draftsPath)).map(async (file) => ({
        id: path.basename(file.path, ".excalidraw"),
        ...(await this.draftInfo(file.path)),
      })),
    );
  }
  async readDraft(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid draft ID.");
    return this.readRoot(this.draftsPath, `${id}.excalidraw`);
  }
  async writeDraft(id: string, value: unknown, expectedRevision?: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid draft ID.");
    return this.writeRoot(
      this.draftsPath,
      `${id}.excalidraw`,
      value,
      expectedRevision,
    );
  }
  private validLibrary(
    value: unknown,
  ): asserts value is { libraryItems: unknown[] } {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Array.isArray((value as { libraryItems?: unknown }).libraryItems)
    )
      throw new Error("Invalid Excalidraw library.");
  }
  async readLibrary() {
    try {
      const value = JSON.parse(await fs.readFile(this.libraryPath, "utf8"));
      this.validLibrary(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async writeLibrary(value: unknown) {
    this.validLibrary(value);
    return this.withLock(`library:${this.libraryPath}`, async () => {
      const previous = await this.readLibrary();
      await this.writeAtomic(this.libraryPath, {
        ...(previous ?? {}),
        ...value,
        libraryItems: value.libraryItems,
      });
    });
  }
  async saveDraft(
    id: string,
    projectId: string,
    relative: string,
    value: unknown,
  ) {
    const draft = await this.readDraft(id);
    try {
      const target = await this.createProjectFile(projectId, relative, value);
      await fs.unlink(this.resolve(this.draftsPath, `${id}.excalidraw`));
      return target;
    } catch (error) {
      if ((error as Error).message !== "Destination already exists.")
        throw error;
      // A crash can leave the just-created target alongside its draft. Only reconcile
      // byte-equivalent JSON data; divergent files remain separate recovery choices.
      const target = await this.readProjectFile(projectId, relative);
      if (JSON.stringify(target.document) !== JSON.stringify(draft.document))
        throw error;
      await fs.unlink(this.resolve(this.draftsPath, `${id}.excalidraw`));
      return this.info(await this.projectRoot(projectId), relative);
    }
  }
  async copyProjectFile(
    fromId: string,
    from: string,
    toId: string,
    to: string,
    value: unknown,
  ) {
    await this.readProjectFile(fromId, from);
    return this.createProjectFile(toId, to, value);
  }
  async removeProjectFile(
    id: string,
    relative: string,
    expectedRevision?: string,
  ) {
    const root = await this.projectRoot(id);
    this.assertFile(relative);
    const target = this.resolve(root, relative);
    return this.withLock(`write:${target}`, async () => {
      await this.assertNoSymlink(root, target);
      const source = await fs.readFile(target, "utf8");
      if (
        expectedRevision !== undefined &&
        this.revision(source) !== expectedRevision
      )
        throw new Error(
          "File changed outside draw-local. Your local copy is still recoverable.",
        );
      await fs.unlink(target);
    });
  }
  async renameProjectFile(
    id: string,
    from: string,
    to: string,
    expectedRevision?: string,
  ) {
    const root = await this.projectRoot(id);
    this.assertFile(from);
    this.assertFile(to);
    const source = this.resolve(root, from),
      target = this.resolve(root, to);
    return this.withLock(`rename:${source}`, async () => {
      await this.assertNoSymlink(root, source);
      await this.assertNoSymlink(root, target);
      const contents = await fs.readFile(source, "utf8");
      if (
        expectedRevision !== undefined &&
        this.revision(contents) !== expectedRevision
      )
        throw new Error(
          "File changed outside draw-local. Your local copy is still recoverable.",
        );
      try {
        await fs.lstat(target);
        throw new Error("Destination already exists.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.rename(source, target);
      return this.info(root, to);
    });
  }
  async list() {
    await this.init();
    return this.listRoot(this.root);
  }
  async read(relative: string) {
    return (await this.readRoot(this.root, relative)).document;
  }
  async write(relative: string, value: unknown) {
    await this.writeRoot(this.root, relative, value);
  }
  async remove(relative: string) {
    this.assertFile(relative);
    const target = this.resolve(this.root, relative);
    await this.assertNoSymlink(this.root, target);
    await fs.unlink(target);
  }
  async rename(from: string, to: string) {
    this.assertFile(from);
    this.assertFile(to);
    const source = this.resolve(this.root, from),
      target = this.resolve(this.root, to);
    await this.assertNoSymlink(this.root, source);
    await this.assertNoSymlink(this.root, target);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.rename(source, target);
  }
  private async gitRaw(args: string[], cwd: string) {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      timeout: 10000,
      maxBuffer: 5 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout || stderr;
  }
  private async git(args: string[], cwd: string) {
    return (await this.gitRaw(args, cwd)).trim();
  }
  async gitContext(id: string) {
    const root = await this.projectRoot(id);
    try {
      const repo = await this.git(["rev-parse", "--show-toplevel"], root);
      const branch = await this.git(
        ["symbolic-ref", "--short", "-q", "HEAD"],
        root,
      ).catch(() => "detached HEAD");
      const raw = await this.gitRaw(
        [
          "status",
          "--porcelain=v1",
          "-z",
          "--ignored",
          "--untracked-files=all",
          "--",
          ".",
        ],
        root,
      );
      const prefix = path.relative(repo, root).replaceAll(path.sep, "/");
      const statuses: Record<
        string,
        { index: string; worktree: string; label: string }
      > = {};
      const records = raw.split("\0");
      for (let i = 0; i < records.length; i++) {
        const item = records[i];
        if (!item) continue;
        const index = item[0],
          worktree = item[1];
        let filename = item.slice(3);
        if (index === "R" || index === "C") i++; // porcelain -z follows a rename/copy with its source path
        if (prefix) {
          if (!filename.startsWith(`${prefix}/`)) continue;
          filename = filename.slice(prefix.length + 1);
        }
        const conflicted =
          index === "U" ||
          worktree === "U" ||
          ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(index + worktree);
        const label =
          index === "?"
            ? "Untracked"
            : index === "!"
              ? "Ignored"
              : conflicted
                ? "Conflicted"
                : `${index !== " " ? "Staged" : ""}${index !== " " && worktree !== " " ? "; " : ""}${worktree !== " " ? "Modified" : ""}` ||
                  "Committed";
        statuses[filename] = { index, worktree, label };
      }
      return { available: true, branch, statuses, repo };
    } catch {
      return { available: false, branch: undefined, statuses: {} };
    }
  }
  async gitStatus() {
    try {
      return {
        available: true,
        output: await this.git(["status", "--short", "--branch"], this.root),
      };
    } catch {
      return {
        available: false,
        output: "Workspace is not inside an accessible Git repository.",
      };
    }
  }
  async gitDiff(relative?: string) {
    const args = ["diff", "--no-ext-diff", "--"];
    if (relative) {
      this.assertFile(relative);
      await this.assertNoSymlink(this.root, this.resolve(this.root, relative));
      args.push(relative);
    }
    return this.git(args, this.root);
  }
  async gitCommit(message: string, paths: string[]) {
    if (!this.gitWriteEnabled)
      throw new Error(
        "Git writes are disabled. Set DRAW_LOCAL_ALLOW_GIT_WRITE=1 to opt in.",
      );
    if (!message.trim() || !paths.length)
      throw new Error("Commit message and explicit paths are required.");
    for (const item of paths) {
      this.assertFile(item);
      await this.assertNoSymlink(this.root, this.resolve(this.root, item));
    }
    await this.git(["add", "--", ...paths], this.root);
    return this.git(["commit", "-m", message, "--", ...paths], this.root);
  }
}
