import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import test from "node:test";

const git = promisify(execFile);
const doc = {
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
};
const envFor = (base: string, root: string) => ({
  ...process.env,
  DRAW_LOCAL_ROOT: root,
  XDG_CONFIG_HOME: path.join(base, "config"),
  XDG_DATA_HOME: path.join(base, "data"),
});

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test("HTTP Git contract accepts a visible-path body beyond header limits", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "draw-local-http-"));
  const root = path.join(base, "project");
  const port = await freePort();
  await fs.mkdir(path.join(root, "drawings"), { recursive: true });
  await git("git", ["init", root]);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: process.cwd(),
    env: { ...envFor(base, root), DRAW_LOCAL_PORT: String(port) },
    stdio: "ignore",
  });
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("HTTP server exited early.");
      ready = await fetch(`${baseUrl}/api/projects`)
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    const paths = Array.from(
      { length: 1_000 },
      (_, index) =>
        `drawings/drawing-${String(index).padStart(4, "0")}.excalidraw`,
    );
    assert.ok(
      new URLSearchParams(paths.map((value) => ["path", value])).toString()
        .length > 16_384,
    );
    const response = await fetch(`${baseUrl}/api/project/git`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "default", paths }),
    });
    assert.equal(response.status, 200);
    const context = await response.json();
    assert.equal(context.available, true);
    assert.equal(context.repositoryPaths.length, paths.length);
    const traversal = await fetch(`${baseUrl}/api/project/git`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "default",
        paths: ["../escape.excalidraw"],
      }),
    });
    assert.equal(traversal.status, 400);
  } finally {
    child.kill();
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("MCP read and write tools use the canonical default project", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "draw-local-mcp-"));
  const root = path.join(base, "project"),
    link = path.join(base, "linked-project");
  await fs.mkdir(root);
  await fs.symlink(root, link, "dir");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/mcp.ts"],
    cwd: process.cwd(),
    env: envFor(base, link) as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "draw-local-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "write_diagram"));
    const saved = await client.callTool({
      name: "write_diagram",
      arguments: { path: "mcp.excalidraw", document: doc },
    });
    assert.equal(saved.isError, undefined);
    const read = await client.callTool({
      name: "read_diagram",
      arguments: { path: "mcp.excalidraw" },
    });
    assert.equal(read.isError, undefined);
    const content = read.content as { type: string; text: string }[];
    const contents = JSON.parse(content[0]!.text);
    assert.deepEqual(contents.document, doc);
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(root, "mcp.excalidraw"), "utf8")),
      doc,
    );
  } finally {
    await client.close();
    await fs.rm(base, { recursive: true, force: true });
  }
});
