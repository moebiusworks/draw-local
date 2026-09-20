import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const extensions = new Set([".excalidraw", ".excalidrawlib"]);

export type WorkspaceFile = { path: string; size: number; modifiedAt: string };

export class Workspace {
  readonly root: string;
  readonly gitWriteEnabled: boolean;

  constructor(root = process.env.DRAW_LOCAL_ROOT ?? path.resolve(process.cwd(), "diagrams")) {
    this.root = path.resolve(root);
    this.gitWriteEnabled = process.env.DRAW_LOCAL_ALLOW_GIT_WRITE === "1";
  }

  async init() { await fs.mkdir(this.root, { recursive: true }); }

  private resolve(relative: string) {
    if (!relative || path.isAbsolute(relative)) throw new Error("Path must be workspace-relative.");
    const portable = relative.replaceAll("\\", "/");
    if (portable.split("/").includes("..")) throw new Error("Parent traversal is not allowed.");
    const target = path.resolve(this.root, portable);
    if (target !== this.root && !target.startsWith(this.root + path.sep)) throw new Error("Path escapes workspace root.");
    return target;
  }

  private assertFile(relative: string) {
    if (!extensions.has(path.extname(relative).toLowerCase())) throw new Error("Only .excalidraw and .excalidrawlib files are allowed.");
  }

  async list(): Promise<WorkspaceFile[]> {
    await this.init();
    const result: WorkspaceFile[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(absolute); continue; }
        if (!extensions.has(path.extname(entry.name).toLowerCase())) continue;
        const stat = await fs.stat(absolute);
        result.push({ path: path.relative(this.root, absolute).split(path.sep).join("/"), size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    };
    await walk(this.root);
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(relative: string): Promise<unknown> {
    this.assertFile(relative);
    return JSON.parse(await fs.readFile(this.resolve(relative), "utf8"));
  }

  async write(relative: string, value: unknown) {
    this.assertFile(relative);
    if (!value || typeof value !== "object") throw new Error("File must contain JSON object data.");
    if (relative.endsWith(".excalidraw")) {
      const doc = value as { type?: unknown; elements?: unknown };
      if (doc.type !== "excalidraw" || !Array.isArray(doc.elements)) throw new Error("Invalid Excalidraw document.");
    }
    const target = this.resolve(relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    await fs.rename(temp, target);
  }

  async remove(relative: string) { this.assertFile(relative); await fs.unlink(this.resolve(relative)); }

  async rename(from: string, to: string) {
    this.assertFile(from); this.assertFile(to);
    const target = this.resolve(to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(this.resolve(from), target);
  }

  async gitStatus() {
    try { return { available: true, output: await this.git(["status", "--short", "--branch"]) }; }
    catch { return { available: false, output: "Workspace is not inside an accessible Git repository." }; }
  }

  async gitDiff(relative?: string) {
    const args = ["diff", "--no-ext-diff", "--"];
    if (relative) { this.resolve(relative); args.push(relative); }
    return this.git(args);
  }

  async gitCommit(message: string, paths: string[]) {
    if (!this.gitWriteEnabled) throw new Error("Git writes are disabled. Set DRAW_LOCAL_ALLOW_GIT_WRITE=1 to opt in.");
    if (!message.trim()) throw new Error("Commit message is required.");
    if (!paths.length) throw new Error("Explicit paths are required.");
    for (const item of paths) { this.assertFile(item); this.resolve(item); }
    await this.git(["add", "--", ...paths]);
    return this.git(["commit", "-m", message, "--", ...paths]);
  }

  private async git(args: string[]) {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: this.root, timeout: 10000, maxBuffer: 5 * 1024 * 1024, windowsHide: true });
    return (stdout || stderr).trim();
  }
}
