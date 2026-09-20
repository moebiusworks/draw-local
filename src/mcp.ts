import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Workspace } from "./workspace";

const workspace = new Workspace();
await workspace.init();
const server = new McpServer({ name: "draw-local", version: "0.1.0" }, { instructions: "Operate only on the configured draw-local workspace. Prefer list_diagrams before reads/writes. Git commits require explicit paths and DRAW_LOCAL_ALLOW_GIT_WRITE=1." });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

server.registerTool("list_diagrams", { description: "List drawings and libraries.", inputSchema: {} }, async () => text(await workspace.list()));
server.registerTool("read_diagram", { description: "Read an Excalidraw JSON file.", inputSchema: { path: z.string().min(1) } }, async ({ path }) => text(await workspace.read(path)));
server.registerTool("write_diagram", { description: "Create or replace an Excalidraw JSON file.", inputSchema: { path: z.string().min(1), document: z.record(z.string(), z.unknown()) } }, async ({ path, document }) => { await workspace.write(path, document); return text(`Saved ${path}`); });
server.registerTool("rename_diagram", { description: "Rename/move a drawing within the workspace.", inputSchema: { from: z.string().min(1), to: z.string().min(1) } }, async ({ from, to }) => { await workspace.rename(from, to); return text(`Renamed ${from} -> ${to}`); });
server.registerTool("delete_diagram", { description: "Delete a drawing from the workspace.", inputSchema: { path: z.string().min(1) } }, async ({ path }) => { await workspace.remove(path); return text(`Deleted ${path}`); });
server.registerTool("git_status", { description: "Read Git status.", inputSchema: {} }, async () => text(await workspace.gitStatus()));
server.registerTool("git_diff", { description: "Read Git diff for the workspace or one file.", inputSchema: { path: z.string().optional() } }, async ({ path }) => text(await workspace.gitDiff(path)));
server.registerTool("git_commit", { description: "Commit explicit drawing paths. Disabled unless opted in.", inputSchema: { message: z.string().min(1), paths: z.array(z.string().min(1)).min(1) } }, async ({ message, paths }) => text(await workspace.gitCommit(message, paths)));

await server.connect(new StdioServerTransport());
console.error(`draw-local MCP on stdio; workspace: ${workspace.root}`);
