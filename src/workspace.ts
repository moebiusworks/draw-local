import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const extensions = new Set([".excalidraw", ".excalidrawlib"]);
export type WorkspaceFile = { path: string; size: number; modifiedAt: string; revision: string };
export type Project = { id: string; path: string; name: string; available: boolean; error?: string };
export type Draft = WorkspaceFile & { id: string };
type StoredProject = Pick<Project, "id" | "path" | "name">;
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export class Workspace {
  readonly root: string; readonly gitWriteEnabled: boolean; readonly configPath: string; readonly draftsPath: string;
  constructor(root = process.env.DRAW_LOCAL_ROOT ?? path.resolve(process.cwd(), "diagrams"), options?: { configPath?: string; draftsPath?: string }) {
    this.root = path.resolve(root); this.gitWriteEnabled = process.env.DRAW_LOCAL_ALLOW_GIT_WRITE === "1";
    this.configPath = options?.configPath ?? path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "draw-local", "projects.json");
    this.draftsPath = options?.draftsPath ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "draw-local", "drafts");
  }
  async init() { await fs.mkdir(this.root, { recursive: true, mode: 0o700 }); await fs.mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 }); await fs.mkdir(this.draftsPath, { recursive: true, mode: 0o700 }); try { await fs.access(this.configPath); } catch { await this.writeAtomic(this.configPath, { projects: [{ id: "default", path: await fs.realpath(this.root), name: path.basename(this.root) || this.root }] }); } }
  private async registry(): Promise<StoredProject[]> { await this.init(); const value = JSON.parse(await fs.readFile(this.configPath, "utf8")) as { projects?: StoredProject[] }; return Array.isArray(value.projects) ? value.projects : []; }
  private async saveRegistry(projects: StoredProject[]) { await this.writeAtomic(this.configPath, { projects }); }
  private async writeAtomic(target: string, value: unknown, exclusive = false) { await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`); try { await fs.writeFile(temp, json(value), { mode: 0o600, flag: "wx" }); if (exclusive) { await fs.link(temp, target); await fs.unlink(temp); } else await fs.rename(temp, target); } catch (error) { await fs.unlink(temp).catch(() => {}); if (exclusive && (error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Destination already exists."); throw error; } }
  private async canonicalDirectory(input: string) { if (!input || !path.isAbsolute(input)) throw new Error("Directory path must be absolute."); const resolved = await fs.realpath(input); if (!(await fs.stat(resolved)).isDirectory()) throw new Error("Path is not a directory."); return resolved; }
  async listProjects(): Promise<Project[]> { return Promise.all((await this.registry()).map(async (project) => { try { const resolved = await this.canonicalDirectory(project.path); return { ...project, path: resolved, available: true }; } catch (error) { return { ...project, available: false, error: error instanceof Error ? error.message : "Unavailable project" }; } })); }
  async registerProject(directory: string, name?: string): Promise<Project> { const canonical = await this.canonicalDirectory(directory), projects = await this.registry(), existing = projects.find((project) => project.path === canonical); if (existing) return { ...existing, available: true }; const project = { id: randomUUID(), path: canonical, name: name?.trim() || path.basename(canonical) || canonical }; await this.saveRegistry([...projects, project]); return { ...project, available: true }; }
  private isSensitiveBrowsePath(directory: string) {
    const home = path.resolve(os.homedir());
    const sensitiveRoots = ["/boot", "/dev", "/etc", "/proc", "/root", "/run", "/sys", "/var", "/System", "/Library", "/private", "/Volumes"];
    if (sensitiveRoots.some((root) => directory === root || directory.startsWith(root + path.sep))) return true;
    const relative = path.relative(home, directory);
    if (relative !== "" && !relative.startsWith(".." + path.sep) && relative !== "..") {
      const parts = relative.split(path.sep);
      if (parts.some((part) => part.startsWith(".")) || parts[0]?.toLowerCase() === "library") return true;
    }
    const parts = directory.replaceAll("\\", "/").split("/").filter(Boolean);
    const drive = parts.findIndex((part) => /^[a-z]:$/i.test(part)) >= 0
      ? parts.findIndex((part) => /^[a-z]:$/i.test(part))
      : parts[0] === "mnt" && /^[a-z]$/i.test(parts[1] ?? "") ? 1 : -1;
    if (drive < 0) return false;
    const windowsRoot = parts[drive + 1]?.toLowerCase();
    if (["windows", "program files", "program files (x86)", "programdata", "$recycle.bin", "system volume information", "recovery", "perflogs"].includes(windowsRoot ?? "")) return true;
    return windowsRoot === "users" && parts[drive + 3]?.toLowerCase() === "appdata";
  }
  async browseDirectory(directory?: string) {
    const resolved = await this.canonicalDirectory(directory || os.homedir());
    if (this.isSensitiveBrowsePath(resolved)) throw new Error("Sensitive or hidden directories are not available in the folder picker.");
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const parent = path.dirname(resolved);
    return {
      path: resolved,
      parent: parent === resolved || this.isSensitiveBrowsePath(parent) ? undefined : parent,
      entries: entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".")).map((entry) => entry.name).sort(),
    };
  }
  private async projectRoot(id: string) { const project = (await this.listProjects()).find((item) => item.id === id); if (!project) throw new Error("Unknown project."); if (!project.available) throw new Error(project.error || "Project is unavailable."); return project.path; }
  private resolve(root: string, relative: string) { if (!relative || path.isAbsolute(relative)) throw new Error("Path must be project-relative."); const portable = relative.replaceAll("\\", "/"); if (portable.split("/").includes("..")) throw new Error("Parent traversal is not allowed."); const target = path.resolve(root, portable); if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path escapes project root."); return target; }
  private assertFile(relative: string) { if (!extensions.has(path.extname(relative).toLowerCase())) throw new Error("Only .excalidraw and .excalidrawlib files are allowed."); }
  private async assertNoSymlink(root: string, target: string) { let current = root; for (const part of path.relative(root, target).split(path.sep)) { current = path.join(current, part); try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not allowed in workspace paths."); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; } } }
  private valid(value: unknown, relative: string) { if (!value || typeof value !== "object") throw new Error("File must contain JSON object data."); if (relative.toLowerCase().endsWith(".excalidraw")) { const doc = value as { type?: unknown; elements?: unknown }; if (doc.type !== "excalidraw" || !Array.isArray(doc.elements)) throw new Error("Invalid Excalidraw document."); } }
  private revision(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private async info(root: string, relative: string): Promise<WorkspaceFile> { const target = this.resolve(root, relative); await this.assertNoSymlink(root, target); const [stat, source] = await Promise.all([fs.stat(target), fs.readFile(target, "utf8")]); return { path: relative.replaceAll(path.sep, "/"), size: stat.size, modifiedAt: stat.mtime.toISOString(), revision: this.revision(source) }; }
  private async listRoot(root: string): Promise<WorkspaceFile[]> { const result: WorkspaceFile[] = []; const walk = async (dir: string): Promise<void> => { for (const entry of await fs.readdir(dir, { withFileTypes: true })) { if ([".git", "node_modules"].includes(entry.name) || entry.isSymbolicLink()) continue; const absolute = path.join(dir, entry.name); if (entry.isDirectory()) await walk(absolute); else if (extensions.has(path.extname(entry.name).toLowerCase())) result.push(await this.info(root, path.relative(root, absolute))); } }; await walk(root); return result.sort((a, b) => a.path.localeCompare(b.path)); }
  async listProjectFiles(id: string) { return this.listRoot(await this.projectRoot(id)); }
  private async readRoot(root: string, relative: string) { this.assertFile(relative); const target = this.resolve(root, relative); await this.assertNoSymlink(root, target); const source = await fs.readFile(target, "utf8"); return { document: JSON.parse(source), revision: this.revision(source) }; }
  async readProjectFile(id: string, relative: string) { return this.readRoot(await this.projectRoot(id), relative); }
  private async writeRoot(root: string, relative: string, value: unknown, expectedRevision?: string, exclusive = false) { this.assertFile(relative); this.valid(value, relative); const target = this.resolve(root, relative); await this.assertNoSymlink(root, target); let source: string | undefined; try { source = await fs.readFile(target, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } if (exclusive && source !== undefined) throw new Error("Destination already exists."); if (expectedRevision !== undefined && source !== undefined && this.revision(source) !== expectedRevision) throw new Error("File changed outside draw-local. Your local copy is still recoverable."); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await this.assertNoSymlink(root, target); await this.writeAtomic(target, value, exclusive); return this.info(root, relative); }
  async writeProjectFile(id: string, relative: string, value: unknown, expectedRevision?: string) { return this.writeRoot(await this.projectRoot(id), relative, value, expectedRevision); }
  async createProjectFile(id: string, relative: string, value: unknown) { return this.writeRoot(await this.projectRoot(id), relative, value, undefined, true); }
  async createDraft(value: unknown) { this.valid(value, "draft.excalidraw"); const id = randomUUID(); await this.writeRoot(this.draftsPath, `${id}.excalidraw`, value, undefined, true); return { id, ...(await this.info(this.draftsPath, `${id}.excalidraw`)) }; }
  async listDrafts(): Promise<Draft[]> { await this.init(); return (await this.listRoot(this.draftsPath)).map((file) => ({ id: path.basename(file.path, ".excalidraw"), ...file })); }
  async readDraft(id: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid draft ID."); return this.readRoot(this.draftsPath, `${id}.excalidraw`); }
  async writeDraft(id: string, value: unknown, expectedRevision?: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid draft ID."); return this.writeRoot(this.draftsPath, `${id}.excalidraw`, value, expectedRevision); }
  async saveDraft(id: string, projectId: string, relative: string, value: unknown) { await this.readDraft(id); const target = await this.createProjectFile(projectId, relative, value); await fs.unlink(this.resolve(this.draftsPath, `${id}.excalidraw`)); return target; }
  async copyProjectFile(fromId: string, from: string, toId: string, to: string, value: unknown) { await this.readProjectFile(fromId, from); return this.createProjectFile(toId, to, value); }
  async list() { await this.init(); return this.listRoot(this.root); } async read(relative: string) { return (await this.readRoot(this.root, relative)).document; } async write(relative: string, value: unknown) { await this.writeRoot(this.root, relative, value); } async remove(relative: string) { this.assertFile(relative); const target = this.resolve(this.root, relative); await this.assertNoSymlink(this.root, target); await fs.unlink(target); } async rename(from: string, to: string) { this.assertFile(from); this.assertFile(to); const source = this.resolve(this.root, from), target = this.resolve(this.root, to); await this.assertNoSymlink(this.root, source); await this.assertNoSymlink(this.root, target); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.rename(source, target); }
  private async git(args: string[], cwd: string) { const { stdout, stderr } = await execFileAsync("git", args, { cwd, timeout: 10000, maxBuffer: 5 * 1024 * 1024, windowsHide: true }); return (stdout || stderr).trim(); }
  async gitContext(id: string) { const root = await this.projectRoot(id); try { const repo = await this.git(["rev-parse", "--show-toplevel"], root); const branch = await this.git(["symbolic-ref", "--short", "-q", "HEAD"], root).catch(() => "detached HEAD"); const raw = await this.git(["status", "--porcelain=v1", "-z", "--ignored", "--untracked-files=all", "--", "."], root); const statuses: Record<string, { index: string; worktree: string; label: string }> = {}; for (const item of raw.split("\0").filter(Boolean)) { const index = item[0], worktree = item[1], filename = item.slice(3); statuses[filename] = { index, worktree, label: index === "?" ? "Untracked" : index === "!" ? "Ignored" : index === "U" || worktree === "U" ? "Conflicted" : `${index !== " " ? "Staged" : ""}${index !== " " && worktree !== " " ? "; " : ""}${worktree !== " " ? "Modified" : ""}` || "Committed" }; } return { available: true, branch, statuses, repo }; } catch { return { available: false, branch: undefined, statuses: {} }; } }
  async gitStatus() { try { return { available: true, output: await this.git(["status", "--short", "--branch"], this.root) }; } catch { return { available: false, output: "Workspace is not inside an accessible Git repository." }; } } async gitDiff(relative?: string) { const args = ["diff", "--no-ext-diff", "--"]; if (relative) { this.assertFile(relative); await this.assertNoSymlink(this.root, this.resolve(this.root, relative)); args.push(relative); } return this.git(args, this.root); } async gitCommit(message: string, paths: string[]) { if (!this.gitWriteEnabled) throw new Error("Git writes are disabled. Set DRAW_LOCAL_ALLOW_GIT_WRITE=1 to opt in."); if (!message.trim() || !paths.length) throw new Error("Commit message and explicit paths are required."); for (const item of paths) { this.assertFile(item); await this.assertNoSymlink(this.root, this.resolve(this.root, item)); } await this.git(["add", "--", ...paths], this.root); return this.git(["commit", "-m", message, "--", ...paths], this.root); }
}
