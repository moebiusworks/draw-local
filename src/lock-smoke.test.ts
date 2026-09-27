import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Workspace } from "./workspace";

test("workspace imports and acquires its native lock", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "draw-local-lock-smoke-"));
  try {
    const workspace = new Workspace(path.join(base, "project"), {
      configPath: path.join(base, "config", "projects.json"),
      draftsPath: path.join(base, "data", "drafts"),
    });
    const draft = await workspace.createDraft({
      type: "excalidraw",
      version: 2,
      elements: [],
      appState: {},
      files: {},
    });
    assert.equal(
      (await workspace.readDraft(draft.id)).document.type,
      "excalidraw",
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
