import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Lock, openLock } from "@lickle/lock";

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
  private async processStartedAt(pid: number) {
    if (process.platform !== "linux") return undefined;
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      // Fields after the final ')' start at field 3; starttime is field 22.
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    } catch {
      return undefined;
    }
  }
  private async legacyLockIsGone(lock: string) {
    const info = await fs.lstat(lock).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return true;
    const directory = info.isDirectory();
    if (!directory && !info.isFile())
      throw new Error("Unexpected legacy workspace lock type.");
    const recordPath = directory ? path.join(lock, "owner.json") : lock;
    const source = await fs
      .readFile(recordPath, "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
    let record: { pid?: number; host?: string; startedAt?: string } = {};
    try {
      const value = JSON.parse(source);
      if (value && typeof value === "object") record = value;
    } catch {
      // A legacy creator may have died before publishing its owner record.
    }
    if (record.host === os.hostname() && typeof record.pid === "number") {
      try {
        process.kill(record.pid, 0);
        const startedAt = await this.processStartedAt(record.pid);
        if (!record.startedAt || !startedAt || startedAt === record.startedAt)
          return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
      }
    } else if (Date.now() - info.mtimeMs < 1_000) return false;
    if (directory) {
      await fs.unlink(recordPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await fs.rmdir(lock).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    } else
      await fs.unlink(lock).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    return true;
  }
  /** OS locks release on process exit; the stable inode is never unlinked. */
  private async withProcessLock<T>(identity: string, action: () => Promise<T>) {
    const locksPath = path.join(path.dirname(this.configPath), "locks");
    const name = createHash("sha256").update(identity).digest("hex");
    await fs.mkdir(locksPath, { recursive: true, mode: 0o700 });
    const guard = await openLock(
      path.join(locksPath, `${name}.oslock`),
      Lock.Exclusive,
      {
        timeout: 10_000,
      },
    );
    const deadline = Date.now() + 10_000;
    try {
      while (!(await this.legacyLockIsGone(path.join(locksPath, name)))) {
        if (Date.now() >= deadline)
          throw new Error("Workspace is busy in another draw-local process.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return await action();
    } finally {
      await guard.drop();
    }
  }
  private async withWorkspaceLock<T>(
    identity: string,
    action: () => Promise<T>,
  ) {
    return this.withLock(identity, () =>
      this.withProcessLock(identity, action),
    );
  }
  private async withLocks<T>(identities: string[], action: () => Promise<T>) {
    const unique = [...new Set(identities)].sort();
    const acquire = async (index: number): Promise<T> =>
      index === unique.length
        ? action()
        : this.withWorkspaceLock(unique[index]!, () => acquire(index + 1));
    return acquire(0);
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
  async defaultProjectId() {
    const root = await fs.realpath(this.root);
    const project = (await this.listProjects()).find(
      (item) => item.available && item.path === root,
    );
    if (!project) throw new Error("The default workspace is not registered.");
    return project.id;
  }
  async registerProject(directory: string, name?: string): Promise<Project> {
    const canonical = await this.canonicalDirectory(directory);
    return this.withWorkspaceLock(`registry:${this.configPath}`, async () => {
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
    return this.withWorkspaceLock(`registry:${this.configPath}`, async () => {
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
    return this.withWorkspaceLock(`registry:${this.configPath}`, async () => {
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
    return this.withWorkspaceLock(`registry:${this.configPath}`, async () => {
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
    return this.withWorkspaceLock(`write:${target}`, async () => {
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
    return this.withWorkspaceLock(`library:${this.libraryPath}`, async () => {
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
    expectedRevision?: string,
  ) {
    const draftPath = this.resolve(this.draftsPath, `${id}.excalidraw`);
    const transferPath = path.join(this.draftsPath, `${id}.transfer.json`);
    const root = await this.projectRoot(projectId);
    this.assertFile(relative);
    const targetPath = this.resolve(root, relative);
    return this.withLocks(
      [`write:${draftPath}`, `write:${targetPath}`],
      async () => {
        this.valid(value, "draft.excalidraw");
        const source = await fs.readFile(draftPath, "utf8");
        const revision = this.revision(source);
        if (expectedRevision !== undefined && expectedRevision !== revision)
          throw new Error(
            "Draft changed outside this Save. Your local copy is still recoverable.",
          );
        const transfer = {
          draftId: id,
          projectId,
          path: relative,
          draftRevision: revision,
          documentRevision: this.revision(json(value)),
        };
        let retry = false;
        try {
          const prior = JSON.parse(await fs.readFile(transferPath, "utf8"));
          let priorTargetExists = false;
          const sameDestination =
            prior?.projectId === projectId && prior?.path === relative;
          if (
            sameDestination &&
            prior?.draftId === id &&
            typeof prior.projectId === "string" &&
            typeof prior.path === "string"
          ) {
            try {
              const priorRoot = await this.projectRoot(prior.projectId);
              this.assertFile(prior.path);
              await fs.access(this.resolve(priorRoot, prior.path));
              priorTargetExists = true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
          }
          if (priorTargetExists) {
            if (JSON.stringify(prior) !== JSON.stringify(transfer))
              throw new Error("Destination already exists.");
            retry = true;
          } else {
            // Retain an old target as an independent copy when the edited
            // draft is saved to a different destination.
            await fs.unlink(transferPath);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (!retry) {
          // A marker only proves a retry of a transfer that started with an empty
          // destination. Never create one for an already occupied filename.
          try {
            await fs.readFile(targetPath, "utf8");
            throw new Error("Destination already exists.");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          try {
            await this.writeAtomic(transferPath, transfer, true);
          } catch (error) {
            if ((error as Error).message !== "Destination already exists.")
              throw error;
            const prior = JSON.parse(await fs.readFile(transferPath, "utf8"));
            if (JSON.stringify(prior) !== JSON.stringify(transfer)) throw error;
          }
        }
        try {
          await this.assertNoSymlink(root, targetPath);
          await fs.mkdir(path.dirname(targetPath), {
            recursive: true,
            mode: 0o700,
          });
          await this.assertNoSymlink(root, targetPath);
          await this.writeAtomic(targetPath, value, true);
          const target = await this.info(root, relative);
          const latest = await fs.readFile(draftPath, "utf8");
          if (this.revision(latest) !== revision)
            throw new Error(
              "Draft changed during Save. The project copy was retained and the draft remains recoverable.",
            );
          await fs.unlink(draftPath);
          await fs.unlink(transferPath).catch(() => {});
          return target;
        } catch (error) {
          if ((error as Error).message !== "Destination already exists.")
            throw error;
          // A crash can leave the just-created target alongside its draft. The
          // private transfer marker proves that this exact draft initiated it;
          // equal JSON alone is never enough to consume a draft.
          const target = await this.readRoot(root, relative);
          if (
            this.revision(json(target.document)) !== transfer.documentRevision
          )
            throw error;
          const latest = await fs.readFile(draftPath, "utf8");
          if (this.revision(latest) !== revision)
            throw new Error(
              "Draft changed during Save. The project copy was retained and the draft remains recoverable.",
            );
          await fs.unlink(draftPath);
          await fs.unlink(transferPath).catch(() => {});
          return this.info(root, relative);
        }
      },
    );
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
    return this.withWorkspaceLock(`write:${target}`, async () => {
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
    return this.withLocks([`write:${source}`, `write:${target}`], async () => {
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
      // link() is an atomic no-replace operation on the single project filesystem.
      // Unlike rename(), it cannot silently overwrite a racing destination.
      try {
        await fs.link(source, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new Error("Destination already exists.");
        throw error;
      }
      await fs.unlink(source);
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
  async readFile(relative: string) {
    return this.readRoot(this.root, relative);
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
  private gitStatusLabel(index: string, worktree: string) {
    const conflicted =
      index === "U" ||
      worktree === "U" ||
      ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(index + worktree);
    return index === "?"
      ? "Untracked"
      : index === "!"
        ? "Ignored"
        : conflicted
          ? "Conflicted"
          : `${index !== " " ? "Staged" : ""}${index !== " " && worktree !== " " ? "; " : ""}${worktree !== " " ? "Modified" : ""}` ||
            "Committed";
  }
  async gitContext(id: string, visiblePaths: string[] = []) {
    const root = await this.projectRoot(id);
    const paths = [...new Set(visiblePaths)];
    for (const relative of paths) {
      this.assertFile(relative);
      await this.assertNoSymlink(root, this.resolve(root, relative));
    }
    const repo = await this.git(["rev-parse", "--show-toplevel"], root).catch(
      () => undefined,
    );
    const branch = repo
      ? await this.git(["symbolic-ref", "--short", "-q", "HEAD"], root).catch(
          () => "detached HEAD",
        )
      : undefined;
    const defaultBranch = repo
      ? await this.git(
          ["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"],
          root,
        )
          .then((value) => value.replace(/^origin\//, "") || undefined)
          .catch(() => undefined)
      : undefined;
    const groups = new Map<string, { repo: string; paths: string[] }>();
    const repositoryPaths: string[] = [];
    const directoryRepos = new Map<string, string | undefined>();
    for (const relative of paths) {
      const directory = path.dirname(this.resolve(root, relative));
      let nearest = directoryRepos.get(directory);
      if (nearest === undefined && !directoryRepos.has(directory)) {
        nearest = await this.git(
          ["rev-parse", "--show-toplevel"],
          directory,
        ).catch(() => undefined);
        directoryRepos.set(directory, nearest);
      }
      if (!nearest) continue;
      repositoryPaths.push(relative);
      const group = groups.get(nearest) ?? { repo: nearest, paths: [] };
      group.paths.push(relative);
      groups.set(nearest, group);
    }
    const statuses: Record<
      string,
      { index: string; worktree: string; label: string }
    > = {};
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const relativePaths = group.paths.map((item) =>
          path
            .relative(group.repo, this.resolve(root, item))
            .replaceAll(path.sep, "/"),
        );
        const raw = await this.gitRaw(
          [
            "status",
            "--porcelain=v1",
            "-z",
            "--ignored",
            "--untracked-files=all",
            "--",
            ...relativePaths,
          ],
          group.repo,
        );
        const byRepositoryPath = new Map(
          group.paths.map((item, index) => [relativePaths[index]!, item]),
        );
        for (const item of raw.split("\0")) {
          if (!item) continue;
          const pathInRepo = item.slice(3);
          const projectPath = byRepositoryPath.get(pathInRepo);
          if (!projectPath) continue;
          const index = item[0]!,
            worktree = item[1]!;
          statuses[projectPath] = {
            index,
            worktree,
            label: this.gitStatusLabel(index, worktree),
          };
        }
      }),
    );
    return {
      available: Boolean(repo),
      branch,
      defaultBranch,
      statuses,
      repositoryPaths,
      repo,
    };
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
