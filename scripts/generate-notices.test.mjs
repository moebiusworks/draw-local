import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";

test("bundled notices retain representative permissive-license text", async () => {
  const source = JSON.parse(
    await fs.readFile("third-party-notices-source.json", "utf8"),
  );
  const records = Object.values(source);
  for (const license of ["MIT", "BSD-3-Clause", "Apache-2.0"]) {
    const record = records.find((item) => item.license === license);
    assert.ok(record, `expected a ${license} dependency`);
    assert.ok(record.notices.length, `expected retained text for ${license}`);
  }
});
