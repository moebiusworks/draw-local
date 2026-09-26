import express from "express";
import path from "node:path";
import { Workspace } from "./workspace";

const host = process.env.DRAW_LOCAL_HOST ?? "127.0.0.1";
const port = Number(process.env.DRAW_LOCAL_PORT ?? 8787);
const workspace = new Workspace();
await workspace.init();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "50mb" }));
const allowedHosts = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  ...(process.env.DRAW_LOCAL_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
]);
app.use((req, res, next) => {
  const hostname = (req.headers.host ?? "").split(":")[0];
  if (!allowedHosts.has(hostname))
    return void res.status(403).json({ error: "Host is not allowed." });
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    !allowedHosts.has(new URL(req.headers.origin).hostname)
  )
    return void res.status(403).json({ error: "Origin is not allowed." });
  next();
});
const route =
  (fn: (req: express.Request, res: express.Response) => Promise<void>) =>
  async (req: express.Request, res: express.Response) => {
    try {
      await fn(req, res);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  };
const id = (req: express.Request) =>
  String(req.query.projectId ?? req.body?.projectId ?? "");
const file = (req: express.Request) =>
  String(req.query.path ?? req.body?.path ?? "");
app.get("/api/config", (_req, res) =>
  res.json({
    root: workspace.root,
    gitWriteEnabled: workspace.gitWriteEnabled,
  }),
);
app.get(
  "/api/projects",
  route(async (_req, res) => {
    res.json(await workspace.listProjects());
  }),
);
app.post(
  "/api/projects",
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await workspace.registerProject(
          String(req.body.path ?? ""),
          typeof req.body.name === "string" ? req.body.name : undefined,
        ),
      );
  }),
);
app.get(
  "/api/directories",
  route(async (req, res) => {
    res.json(
      await workspace.browseDirectory(
        req.query.path ? String(req.query.path) : undefined,
      ),
    );
  }),
);
app.get(
  "/api/directories/resolve",
  route(async (req, res) => {
    res.json(await workspace.resolveDirectory(String(req.query.path ?? "")));
  }),
);
app.get(
  "/api/project/files",
  route(async (req, res) => {
    res.json(await workspace.listProjectFiles(id(req)));
  }),
);
app.get(
  "/api/project/entries",
  route(async (req, res) => {
    res.json(
      await workspace.listProjectEntries(
        id(req),
        req.query.path ? String(req.query.path) : "",
      ),
    );
  }),
);
app.get(
  "/api/project/file",
  route(async (req, res) => {
    res.json(await workspace.readProjectFile(id(req), file(req)));
  }),
);
app.put(
  "/api/project/file",
  route(async (req, res) => {
    res.json(
      await workspace.writeProjectFile(
        id(req),
        file(req),
        req.body.document,
        typeof req.body.revision === "string" ? req.body.revision : undefined,
      ),
    );
  }),
);
app.post(
  "/api/project/file",
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await workspace.createProjectFile(
          id(req),
          file(req),
          req.body.document,
        ),
      );
  }),
);
app.delete(
  "/api/project/file",
  route(async (req, res) => {
    await workspace.removeProjectFile(
      id(req),
      file(req),
      typeof req.body?.revision === "string" ? req.body.revision : undefined,
    );
    res.status(204).end();
  }),
);
app.post(
  "/api/project/rename",
  route(async (req, res) => {
    res.json(
      await workspace.renameProjectFile(
        id(req),
        String(req.body.from ?? ""),
        String(req.body.to ?? ""),
        typeof req.body.revision === "string" ? req.body.revision : undefined,
      ),
    );
  }),
);
app.get(
  "/api/drafts",
  route(async (_req, res) => {
    res.json(await workspace.listDrafts());
  }),
);
app.get(
  "/api/library",
  route(async (_req, res) => {
    res.json(await workspace.readLibrary());
  }),
);
app.put(
  "/api/library",
  route(async (req, res) => {
    await workspace.writeLibrary(req.body);
    res.status(204).end();
  }),
);
app.post(
  "/api/drafts",
  route(async (req, res) => {
    res.status(201).json(await workspace.createDraft(req.body.document));
  }),
);
app.get(
  "/api/draft/:id",
  route(async (req, res) => {
    res.json(await workspace.readDraft(String(req.params.id)));
  }),
);
app.put(
  "/api/draft/:id",
  route(async (req, res) => {
    res.json(
      await workspace.writeDraft(
        String(req.params.id),
        req.body.document,
        typeof req.body.revision === "string" ? req.body.revision : undefined,
      ),
    );
  }),
);
app.post(
  "/api/draft/:id/save",
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await workspace.saveDraft(
          String(req.params.id),
          String(req.body.projectId ?? ""),
          String(req.body.path ?? ""),
          req.body.document,
        ),
      );
  }),
);
app.post(
  "/api/project/copy",
  route(async (req, res) => {
    res
      .status(201)
      .json(
        await workspace.copyProjectFile(
          String(req.body.fromProjectId ?? ""),
          String(req.body.fromPath ?? ""),
          String(req.body.projectId ?? ""),
          String(req.body.path ?? ""),
          req.body.document,
        ),
      );
  }),
);
app.get(
  "/api/project/git",
  route(async (req, res) => {
    res.json(await workspace.gitContext(id(req)));
  }),
);
app.get(
  "/api/files",
  route(async (_req, res) => {
    res.json(await workspace.list());
  }),
);
app.get(
  "/api/file",
  route(async (req, res) => {
    res.json(await workspace.read(file(req)));
  }),
);
app.put(
  "/api/file",
  route(async (req, res) => {
    await workspace.write(file(req), req.body);
    res.status(204).end();
  }),
);
app.delete(
  "/api/file",
  route(async (req, res) => {
    await workspace.remove(file(req));
    res.status(204).end();
  }),
);
app.post(
  "/api/rename",
  route(async (req, res) => {
    await workspace.rename(
      String(req.body.from ?? ""),
      String(req.body.to ?? ""),
    );
    res.status(204).end();
  }),
);
app.get(
  "/api/git/status",
  route(async (_req, res) => {
    res.json(await workspace.gitStatus());
  }),
);
app.get(
  "/api/git/diff",
  route(async (req, res) => {
    res
      .type("text/plain")
      .send(
        await workspace.gitDiff(
          req.query.path ? String(req.query.path) : undefined,
        ),
      );
  }),
);
app.post(
  "/api/git/commit",
  route(async (req, res) => {
    res
      .type("text/plain")
      .send(
        await workspace.gitCommit(
          String(req.body.message ?? ""),
          Array.isArray(req.body.paths) ? req.body.paths.map(String) : [],
        ),
      );
  }),
);
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res, next) =>
  res.sendFile(path.resolve("dist/index.html"), (err) => err && next()),
);
app.listen(port, host, () =>
  console.error(
    `draw-local API: http://${host}:${port}\nworkspace: ${workspace.root}`,
  ),
);
