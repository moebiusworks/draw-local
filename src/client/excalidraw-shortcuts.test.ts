import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("reviewed Excalidraw shortcut source matches the pinned package", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(root, "src/client/excalidraw-shortcuts.manifest.json"),
      "utf8",
    ),
  ) as {
    version: string;
    source: string;
    sha256: string;
    overrides: { command: string }[];
  };
  const packageJson = JSON.parse(
    await readFile(
      path.join(root, "node_modules/@excalidraw/excalidraw/package.json"),
      "utf8",
    ),
  ) as { version: string };
  assert.equal(
    packageJson.version,
    manifest.version,
    "Excalidraw changed: review its shortcuts and update the manifest.",
  );
  const map = JSON.parse(
    await readFile(
      path.join(
        root,
        "node_modules/@excalidraw/excalidraw/dist/dev/index.js.map",
      ),
      "utf8",
    ),
  ) as { sources: string[]; sourcesContent: string[] };
  const index = map.sources.indexOf(manifest.source);
  assert.notEqual(
    index,
    -1,
    "Shortcut source moved: review the installed source map and update the manifest.",
  );
  const source = map.sourcesContent[index]!;
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.sha256,
    "Shortcut source changed: review collisions and update the manifest.",
  );
  assert.ok(manifest.overrides.some((item) => item.command === "save"));
});
