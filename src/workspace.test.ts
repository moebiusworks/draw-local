import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Workspace } from "./workspace";

const doc = { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} };

test("writes, lists and reads drawings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-"));
  try {
    const ws = new Workspace(root);
    await ws.write("platform/overview.excalidraw", doc);
    assert.deepEqual((await ws.list()).map((x) => x.path), ["platform/overview.excalidraw"]);
    assert.deepEqual(await ws.read("platform/overview.excalidraw"), doc);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects traversal and unsupported extensions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-"));
  try {
    const ws = new Workspace(root);
    await assert.rejects(() => ws.write("../escape.excalidraw", doc));
    await assert.rejects(() => ws.write("notes.txt", {}));
  } finally { await rm(root, { recursive: true, force: true }); }
});
