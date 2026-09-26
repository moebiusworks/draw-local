import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Workspace } from "./workspace";

const doc = {
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: {},
  files: {},
};
const isolated = (root: string) => ({
  configPath: path.join(root, ".test-config", "projects.json"),
  draftsPath: path.join(root, ".test-data", "drafts"),
});
const git = promisify(execFile);

test("writes, lists and reads drawings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-"));
  try {
    const ws = new Workspace(root, isolated(root));
    await ws.write("platform/overview.excalidraw", doc);
    assert.deepEqual(
      (await ws.list()).map((x) => x.path),
      ["platform/overview.excalidraw"],
    );
    assert.deepEqual(await ws.read("platform/overview.excalidraw"), doc);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal and unsupported extensions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-"));
  try {
    const ws = new Workspace(root, isolated(root));
    await assert.rejects(() => ws.write("../escape.excalidraw", doc));
    await assert.rejects(() => ws.write("notes.txt", {}));
    await assert.rejects(
      () => ws.write("invalid.EXCALIDRAW", {}),
      /Invalid Excalidraw document/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not follow links outside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "draw-local-outside-"));
  try {
    const ws = new Workspace(root, isolated(root));
    await writeFile(
      path.join(outside, "private.excalidraw"),
      JSON.stringify(doc),
    );
    await symlink(outside, path.join(root, "linked"), "dir");
    await symlink(
      path.join(outside, "private.excalidraw"),
      path.join(root, "linked-file.excalidraw"),
    );
    assert.deepEqual(await ws.list(), []);
    await assert.rejects(
      () => ws.read("linked/private.excalidraw"),
      /Symbolic links/,
    );
    await assert.rejects(
      () => ws.read("linked-file.excalidraw"),
      /Symbolic links/,
    );
    await assert.rejects(
      () => ws.write("linked/new.excalidraw", doc),
      /Symbolic links/,
    );
    await assert.rejects(
      () => ws.rename("linked-file.excalidraw", "renamed.excalidraw"),
      /Symbolic links/,
    );
    assert.equal(
      await readFile(path.join(outside, "private.excalidraw"), "utf8"),
      JSON.stringify(doc),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("projects and drafts persist separately and first save is exclusive", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "draw-local-projects-"));
  const first = path.join(base, "first"),
    second = path.join(base, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  const options = {
    configPath: path.join(base, "config", "projects.json"),
    draftsPath: path.join(base, "data", "drafts"),
  };
  try {
    const ws = new Workspace(first, options);
    await ws.init();
    const a = await ws.registerProject(first),
      b = await ws.registerProject(second);
    const draft = await ws.createDraft({ ...doc, elements: [{ id: "draft" }] });
    await ws.writeDraft(
      draft.id,
      { ...doc, elements: [{ id: "latest" }] },
      draft.revision,
    );
    await ws.saveDraft(draft.id, a.id, "overview.excalidraw", {
      ...doc,
      elements: [{ id: "latest" }],
    });
    await ws.writeProjectFile(b.id, "overview.excalidraw", {
      ...doc,
      elements: [{ id: "other" }],
    });
    assert.equal(
      (
        (await ws.readProjectFile(a.id, "overview.excalidraw")).document as {
          elements: { id: string }[];
        }
      ).elements[0].id,
      "latest",
    );
    assert.equal(
      (
        (await ws.readProjectFile(b.id, "overview.excalidraw")).document as {
          elements: { id: string }[];
        }
      ).elements[0].id,
      "other",
    );
    assert.deepEqual(await ws.listDrafts(), []);
    await assert.rejects(
      () => ws.createProjectFile(a.id, "overview.excalidraw", doc),
      /already exists/,
    );
    const restarted = new Workspace(first, options);
    assert.equal(
      (await restarted.listProjects()).filter((item) => item.available)
        .length >= 2,
      true,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("project writes reject an external revision change", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "draw-local-revision-"));
  const root = path.join(base, "project");
  await mkdir(root);
  try {
    const ws = new Workspace(root, {
      configPath: path.join(base, "config", "projects.json"),
      draftsPath: path.join(base, "data", "drafts"),
    });
    const project = await ws.registerProject(root);
    await ws.writeProjectFile(project.id, "overview.excalidraw", doc);
    const revision = (
      await ws.readProjectFile(project.id, "overview.excalidraw")
    ).revision;
    await writeFile(
      path.join(root, "overview.excalidraw"),
      JSON.stringify({ ...doc, elements: [{ id: "external" }] }),
    );
    await assert.rejects(
      () =>
        ws.writeProjectFile(project.id, "overview.excalidraw", doc, revision),
      /changed outside/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("only one concurrent revision write succeeds and deletion conflicts", async () => {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "draw-local-revision-race-"),
  );
  const root = path.join(base, "project");
  await mkdir(root);
  try {
    const ws = new Workspace(root, isolated(base));
    const project = await ws.registerProject(root);
    await ws.writeProjectFile(project.id, "overview.excalidraw", doc);
    const revision = (
      await ws.readProjectFile(project.id, "overview.excalidraw")
    ).revision;
    const results = await Promise.allSettled([
      ws.writeProjectFile(
        project.id,
        "overview.excalidraw",
        { ...doc, elements: [{ id: "a" }] },
        revision,
      ),
      ws.writeProjectFile(
        project.id,
        "overview.excalidraw",
        { ...doc, elements: [{ id: "b" }] },
        revision,
      ),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    await rm(path.join(root, "overview.excalidraw"));
    await assert.rejects(
      () =>
        ws.writeProjectFile(project.id, "overview.excalidraw", doc, revision),
      /changed outside/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("concurrent registration retains each canonical project", async () => {
  const base = await mkdtemp(
    path.join(os.tmpdir(), "draw-local-registry-race-"),
  );
  const root = path.join(base, "root"),
    a = path.join(base, "a"),
    b = path.join(base, "b");
  await Promise.all([mkdir(root), mkdir(a), mkdir(b)]);
  try {
    const ws = new Workspace(root, isolated(base));
    const [first, second] = await Promise.all([
      ws.registerProject(a),
      ws.registerProject(b),
    ]);
    const ids = new Set((await ws.listProjects()).map((project) => project.id));
    assert.equal(ids.has(first.id), true);
    assert.equal(ids.has(second.id), true);
    const duplicate = await Promise.all([
      ws.registerProject(a),
      ws.registerProject(a),
    ]);
    assert.equal(duplicate[0].id, duplicate[1].id);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("first-save retry reconciles an exact duplicate without deleting divergent data", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "draw-local-draft-retry-"));
  const root = path.join(base, "project");
  await mkdir(root);
  try {
    const ws = new Workspace(root, isolated(base));
    const project = await ws.registerProject(root);
    const exact = { ...doc, elements: [{ id: "same" }] };
    const draft = await ws.createDraft(exact);
    await ws.createProjectFile(project.id, "same.excalidraw", exact);
    await ws.saveDraft(draft.id, project.id, "same.excalidraw", exact);
    assert.deepEqual(await ws.listDrafts(), []);
    const divergent = await ws.createDraft({
      ...doc,
      elements: [{ id: "draft" }],
    });
    await ws.createProjectFile(project.id, "different.excalidraw", {
      ...doc,
      elements: [{ id: "target" }],
    });
    await assert.rejects(
      () => ws.saveDraft(divergent.id, project.id, "different.excalidraw", doc),
      /already exists/,
    );
    assert.equal(
      (await ws.listDrafts()).some((item) => item.id === divergent.id),
      true,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("folder browsing omits hidden directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-browse-"));
  try {
    await Promise.all([
      mkdir(path.join(root, "visible")),
      mkdir(path.join(root, ".hidden")),
    ]);
    const ws = new Workspace(root, {
      configPath: path.join(root, "config", "projects.json"),
      draftsPath: path.join(root, "data", "drafts"),
    });
    const listing = await ws.browseDirectory(root);
    assert.deepEqual(listing.entries, ["visible"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sensitive macOS and Windows locations are excluded from the folder picker", async () => {
  const ws = new Workspace("/tmp", {
    configPath: "/tmp/draw-local-test-config.json",
    draftsPath: "/tmp/draw-local-test-drafts",
  });
  const sensitive = ws as unknown as {
    isSensitiveBrowsePath(directory: string): boolean;
  };
  assert.equal(sensitive.isSensitiveBrowsePath("/System/Library"), true);
  assert.equal(
    sensitive.isSensitiveBrowsePath("/Library/Application Support"),
    true,
  );
  assert.equal(
    sensitive.isSensitiveBrowsePath("/mnt/c/Windows/System32"),
    true,
  );
  assert.equal(sensitive.isSensitiveBrowsePath("/mnt/c/Program Files"), true);
  assert.equal(
    sensitive.isSensitiveBrowsePath("/mnt/c/Users/alice/AppData/Roaming"),
    true,
  );
  assert.equal(
    sensitive.isSensitiveBrowsePath("/mnt/c/Users/alice/Documents"),
    false,
  );
});

test("git context is project-relative and distinguishes file states", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "draw-local-git-"));
  const root = path.join(base, "nested");
  await mkdir(root);
  try {
    await git("git", ["init"], { cwd: base });
    await git("git", ["config", "user.email", "test@example.invalid"], {
      cwd: base,
    });
    await git("git", ["config", "user.name", "Test"], { cwd: base });
    await Promise.all([
      writeFile(path.join(root, "clean.excalidraw"), JSON.stringify(doc)),
      writeFile(path.join(root, "modified.excalidraw"), JSON.stringify(doc)),
      writeFile(path.join(root, "staged.excalidraw"), JSON.stringify(doc)),
      writeFile(path.join(root, "both.excalidraw"), JSON.stringify(doc)),
      writeFile(path.join(base, ".gitignore"), "nested/ignored.excalidraw\n"),
    ]);
    await git("git", ["add", "."], { cwd: base });
    await git("git", ["commit", "-m", "initial"], { cwd: base });
    await writeFile(
      path.join(root, "modified.excalidraw"),
      JSON.stringify({ ...doc, elements: [{ id: "modified" }] }),
    );
    await writeFile(
      path.join(root, "staged.excalidraw"),
      JSON.stringify({ ...doc, elements: [{ id: "staged" }] }),
    );
    await git("git", ["add", "nested/staged.excalidraw"], { cwd: base });
    await writeFile(
      path.join(root, "both.excalidraw"),
      JSON.stringify({ ...doc, elements: [{ id: "staged" }] }),
    );
    await git("git", ["add", "nested/both.excalidraw"], { cwd: base });
    await writeFile(
      path.join(root, "both.excalidraw"),
      JSON.stringify({ ...doc, elements: [{ id: "modified" }] }),
    );
    await Promise.all([
      writeFile(
        path.join(root, "untracked name.excalidraw"),
        JSON.stringify(doc),
      ),
      writeFile(path.join(root, "ignored.excalidraw"), JSON.stringify(doc)),
    ]);
    const ws = new Workspace(root, isolated(base));
    const project = await ws.registerProject(root);
    const statuses = (await ws.gitContext(project.id)).statuses as Record<
      string,
      { label: string }
    >;
    assert.equal(statuses["clean.excalidraw"], undefined);
    assert.equal(
      statuses["modified.excalidraw"].label,
      "Modified",
      JSON.stringify(statuses),
    );
    assert.equal(statuses["staged.excalidraw"].label, "Staged");
    assert.equal(statuses["both.excalidraw"].label, "Staged; Modified");
    assert.equal(statuses["untracked name.excalidraw"].label, "Untracked");
    assert.equal(statuses["ignored.excalidraw"].label, "Ignored");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("typed directory resolution canonicalizes an explicit path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "draw-local-resolve-"));
  try {
    const ws = new Workspace(root, isolated(root));
    assert.deepEqual(await ws.resolveDirectory(root), {
      path: await realpath(root),
    });
    await assert.rejects(() => ws.resolveDirectory(path.join(root, "missing")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
