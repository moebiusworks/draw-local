import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";

test("every locked dependency has authentic, traceable notice text", async () => {
  const source = JSON.parse(
    await fs.readFile("third-party-notices-source.json", "utf8"),
  );
  const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
  const identities = new Set(
    Object.entries(lock.packages)
      .filter(([location, pkg]) => location && pkg.version && !pkg.link)
      .map(([location, pkg]) => {
        const index = location.lastIndexOf("node_modules/");
        return `${location.slice(index + 13)}@${pkg.version}`;
      }),
  );
  assert.deepEqual(new Set(Object.keys(source)), identities);
  for (const id of identities) {
    const record = source[id];
    assert.notEqual(record.license, "SEE PACKAGE", id);
    assert.ok(record.notices.length, id);
    for (const notice of record.notices) {
      assert.ok(notice.source, id);
      assert.ok(notice.text.trim(), id);
      assert.doesNotMatch(notice.name, /standard MIT text/i, id);
      assert.doesNotMatch(
        notice.text,
        /^MIT License\s+Copyright \(c\) <year> <copyright holders>/i,
        id,
      );
    }
  }
});
