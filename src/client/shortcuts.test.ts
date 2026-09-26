import assert from "node:assert/strict";
import test from "node:test";
import { commands } from "./shortcuts";

const event = (values: Partial<KeyboardEvent>) =>
  ({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...values,
  }) as KeyboardEvent;

test("draw-local shortcuts have distinct platform chords", () => {
  for (const value of ["mac", "other"] as const) {
    const labels = Object.values(commands).map((command) =>
      command.label(value),
    );
    assert.equal(new Set(labels).size, labels.length);
  }
  assert.equal(
    commands.new.matches(
      event({ code: "KeyN", ctrlKey: true, altKey: true, shiftKey: true }),
      "other",
    ),
    false,
  );
  assert.equal(
    commands["panel-toggle"].matches(
      event({ code: "Numpad0", altKey: true, shiftKey: true }),
      "other",
    ),
    false,
  );
  assert.equal(
    commands["browse-folders"].matches(
      event({ code: "Numpad1", altKey: true, shiftKey: true }),
      "other",
    ),
    false,
  );
});

test("registry uses physical Alt chords and platform primary modifiers", () => {
  assert.equal(
    commands.new.matches(
      event({ code: "KeyN", ctrlKey: true, altKey: true }),
      "other",
    ),
    true,
  );
  assert.equal(
    commands.new.matches(
      event({ code: "KeyN", metaKey: true, altKey: true }),
      "mac",
    ),
    true,
  );
  assert.equal(
    commands["browse-folders"].matches(
      event({ code: "Digit1", altKey: true, key: "¡" }),
      "mac",
    ),
    true,
  );
  assert.equal(
    commands["panel-toggle"].matches(
      event({ code: "Numpad0", altKey: true }),
      "other",
    ),
    true,
  );
  assert.equal(
    commands["browse-folders"].matches(
      event({ code: "Numpad1", altKey: true }),
      "mac",
    ),
    true,
  );
  assert.equal(
    commands.save.matches(event({ code: "KeyS", ctrlKey: true }), "other"),
    true,
  );
  for (const value of ["mac", "other"] as const) {
    assert.equal(
      commands.save.matches(
        event({
          code: "KeyS",
          [value === "mac" ? "metaKey" : "ctrlKey"]: true,
          shiftKey: true,
        }),
        value,
      ),
      false,
      "Save must not overlap Excalidraw Save As",
    );
  }
});
