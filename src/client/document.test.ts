import assert from "node:assert/strict";
import test from "node:test";
import { mergeDocument } from "./document";

test("autosave preserves unfamiliar document and app state fields", () => {
  const original = {
    type: "excalidraw",
    version: 3,
    source: "another-editor",
    futureField: { enabled: true },
    elements: [{ id: "same", futureElementField: "keep", x: 1 }],
    appState: { futureSetting: "keep", viewBackgroundColor: "#fff" },
    files: { old: {} },
  };
  const next = mergeDocument(
    original,
    [{ id: "same", x: 2 }],
    { viewBackgroundColor: "#eee" },
    {},
  );
  assert.deepEqual(next.futureField, original.futureField);
  assert.equal(next.version, 3);
  assert.equal(next.source, "another-editor");
  assert.equal(next.appState.futureSetting, "keep");
  assert.equal(next.appState.viewBackgroundColor, "#eee");
  assert.deepEqual(next.elements, [
    { id: "same", futureElementField: "keep", x: 2 },
  ]);
  assert.deepEqual(next.files, {});
});
