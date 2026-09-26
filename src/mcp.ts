import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Workspace } from "./workspace";

const workspace = new Workspace();
await workspace.init();
const server = new McpServer(
  { name: "draw-local", version: "0.1.0" },
  {
    instructions:
      "Operate only on the configured draw-local workspace. Prefer list_diagrams before reads/writes. Git commits require explicit paths and DRAW_LOCAL_ALLOW_GIT_WRITE=1.",
  },
);
const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

server.registerTool(
  "list_diagrams",
  { description: "List drawings and libraries.", inputSchema: {} },
  async () => text(await workspace.list()),
);
server.registerTool(
  "list_projects",
  {
    description:
      "List registered local project directories. Existing tools continue to use DRAW_LOCAL_ROOT during migration.",
    inputSchema: {},
  },
  async () => text(await workspace.listProjects()),
);
server.registerTool(
  "list_project_diagrams",
  {
    description: "List drawings in one registered project.",
    inputSchema: { projectId: z.string().min(1) },
  },
  async ({ projectId }) => text(await workspace.listProjectFiles(projectId)),
);
server.registerTool(
  "read_project_diagram",
  {
    description: "Read a drawing from one registered project.",
    inputSchema: { projectId: z.string().min(1), path: z.string().min(1) },
  },
  async ({ projectId, path }) =>
    text((await workspace.readProjectFile(projectId, path)).document),
);
server.registerTool(
  "read_diagram",
  {
    description: "Read an Excalidraw JSON file.",
    inputSchema: { path: z.string().min(1) },
  },
  async ({ path }) => text(await workspace.read(path)),
);
server.registerTool(
  "write_diagram",
  {
    description:
      "Create or replace an Excalidraw JSON file. Omit projectId for the legacy DRAW_LOCAL_ROOT.",
    inputSchema: {
      path: z.string().min(1),
      projectId: z.string().min(1).optional(),
      document: z.record(z.string(), z.unknown()),
    },
  },
  async ({ path, projectId, document }) => {
    if (projectId) await workspace.writeProjectFile(projectId, path, document);
    else await workspace.write(path, document);
    return text(`Saved ${path}`);
  },
);
server.registerTool(
  "rename_diagram",
  {
    description:
      "Rename/move a drawing. Omit projectId for the legacy DRAW_LOCAL_ROOT.",
    inputSchema: {
      from: z.string().min(1),
      to: z.string().min(1),
      projectId: z.string().min(1).optional(),
    },
  },
  async ({ from, to, projectId }) => {
    if (projectId) await workspace.renameProjectFile(projectId, from, to);
    else await workspace.rename(from, to);
    return text(`Renamed ${from} -> ${to}`);
  },
);
server.registerTool(
  "delete_diagram",
  {
    description:
      "Delete a drawing. Omit projectId for the legacy DRAW_LOCAL_ROOT.",
    inputSchema: {
      path: z.string().min(1),
      projectId: z.string().min(1).optional(),
    },
  },
  async ({ path, projectId }) => {
    if (projectId) await workspace.removeProjectFile(projectId, path);
    else await workspace.remove(path);
    return text(`Deleted ${path}`);
  },
);
server.registerTool(
  "git_status",
  {
    description:
      "Read Git status; projectId returns project-scoped structured status.",
    inputSchema: { projectId: z.string().min(1).optional() },
  },
  async ({ projectId }) =>
    text(
      projectId
        ? await workspace.gitContext(projectId)
        : await workspace.gitStatus(),
    ),
);
server.registerTool(
  "git_diff",
  {
    description: "Read Git diff for the workspace or one file.",
    inputSchema: { path: z.string().optional() },
  },
  async ({ path }) => text(await workspace.gitDiff(path)),
);
server.registerTool(
  "git_commit",
  {
    description: "Commit explicit drawing paths. Disabled unless opted in.",
    inputSchema: {
      message: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1),
    },
  },
  async ({ message, paths }) => text(await workspace.gitCommit(message, paths)),
);

await server.connect(new StdioServerTransport());
console.error(`draw-local MCP on stdio; workspace: ${workspace.root}`);
