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

const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", ...(process.env.DRAW_LOCAL_ALLOWED_HOSTS ?? "").split(",").map((x) => x.trim()).filter(Boolean)]);
app.use((req, res, next) => {
  const hostname = (req.headers.host ?? "").split(":")[0];
  if (!allowedHosts.has(hostname)) return void res.status(403).json({ error: "Host is not allowed." });
  next();
});

const asyncRoute = (fn: (req: express.Request, res: express.Response) => Promise<void>) => async (req: express.Request, res: express.Response) => {
  try { await fn(req, res); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Unexpected error" }); }
};

app.get("/api/config", (_req, res) => res.json({ root: workspace.root, gitWriteEnabled: workspace.gitWriteEnabled }));
app.get("/api/files", asyncRoute(async (_req, res) => { res.json(await workspace.list()); }));
app.get("/api/file", asyncRoute(async (req, res) => { res.json(await workspace.read(String(req.query.path ?? ""))); }));
app.put("/api/file", asyncRoute(async (req, res) => { await workspace.write(String(req.query.path ?? ""), req.body); res.status(204).end(); }));
app.delete("/api/file", asyncRoute(async (req, res) => { await workspace.remove(String(req.query.path ?? "")); res.status(204).end(); }));
app.post("/api/rename", asyncRoute(async (req, res) => { await workspace.rename(String(req.body.from ?? ""), String(req.body.to ?? "")); res.status(204).end(); }));
app.get("/api/git/status", asyncRoute(async (_req, res) => { res.json(await workspace.gitStatus()); }));
app.get("/api/git/diff", asyncRoute(async (req, res) => { res.type("text/plain").send(await workspace.gitDiff(req.query.path ? String(req.query.path) : undefined)); }));
app.post("/api/git/commit", asyncRoute(async (req, res) => { res.type("text/plain").send(await workspace.gitCommit(String(req.body.message ?? ""), Array.isArray(req.body.paths) ? req.body.paths.map(String) : [])); }));

app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res, next) => res.sendFile(path.resolve("dist/index.html"), (err) => err && next()));
app.listen(port, host, () => console.error(`draw-local API: http://${host}:${port}\nworkspace: ${workspace.root}`));
