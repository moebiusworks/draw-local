import { promises as fs } from "node:fs";
import path from "node:path";

const packages = new Map();
async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = path.join(dir, entry.name);
    if (entry.name.startsWith("@")) {
      await walk(base);
      continue;
    }
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(base, "package.json"), "utf8"),
      );
      if (pkg.name && pkg.version) {
        const names = (await fs.readdir(base))
          .filter((name) =>
            /^(license|licence|notice|copying)(\.|$)/i.test(name),
          )
          .sort();
        const notices = [];
        for (const name of names)
          notices.push({
            name,
            text: (await fs.readFile(path.join(base, name), "utf8")).trim(),
          });
        packages.set(pkg.name + "@" + pkg.version, {
          name: pkg.name,
          version: pkg.version,
          license:
            typeof pkg.license === "string" ? pkg.license : "SEE PACKAGE",
          repository:
            typeof pkg.repository === "string"
              ? pkg.repository
              : pkg.repository?.url,
          notices,
        });
      }
    } catch {}
    await walk(path.join(base, "node_modules"));
  }
}

await walk(path.resolve("node_modules"));
const noticeData = [
  {
    name: "draw-local",
    version: JSON.parse(await fs.readFile("package.json", "utf8")).version,
    license: "Apache-2.0",
    repository: "https://github.com/moebiusworks/draw-local",
    notices: [
      {
        name: "LICENSE",
        text: (await fs.readFile("LICENSE", "utf8")).trim(),
      },
    ],
  },
  ...[...packages.values()].sort((a, b) =>
    (a.name + a.version).localeCompare(b.name + b.version),
  ),
];
let out =
  "# Generated third-party notices\n\n> Generated from the installed dependency tree by npm run notices.\n\n";
for (const pkg of noticeData) {
  out +=
    "## " +
    pkg.name +
    "@" +
    pkg.version +
    "\n\n- License: " +
    pkg.license +
    "\n";
  if (pkg.repository) out += "- Repository: " + pkg.repository + "\n";
  out += "\n";
  if (!pkg.notices.length)
    out += "_No standalone license/notice file found._\n\n";
  for (const notice of pkg.notices)
    out += "### " + notice.name + "\n\n```text\n" + notice.text + "\n```\n\n";
}
const json = JSON.stringify(noticeData, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const current = await Promise.all([
    fs.readFile("THIRD_PARTY_NOTICES.generated.md", "utf8"),
    fs.readFile("public/third-party-notices.json", "utf8"),
  ]).catch(() => {
    throw new Error(
      "Run npm run notices to generate the local notices assets.",
    );
  });
  if (current[0] !== out || current[1] !== json)
    throw new Error("Notices assets are stale. Run npm run notices.");
} else {
  await fs.writeFile("THIRD_PARTY_NOTICES.generated.md", out);
  await fs.mkdir("public", { recursive: true });
  await fs.writeFile("public/third-party-notices.json", json);
}
console.error("Wrote notices for " + packages.size + " installed packages.");
