import { promises as fs } from "node:fs";
const lockfile = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
const packages = new Map();
for (const [location, pkg] of Object.entries(lockfile.packages ?? {})) {
  if (!location || !pkg.version || pkg.link) continue;
  const marker = "node_modules/";
  const index = location.lastIndexOf(marker);
  if (index < 0) continue;
  const name = location.slice(index + marker.length);
  packages.set(`${name}@${pkg.version}`, {
    name,
    version: pkg.version,
    license: typeof pkg.license === "string" ? pkg.license : "SEE PACKAGE",
    notices: [],
  });
}
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
  "# Generated third-party notices\n\n> Generated from package-lock.json by npm run notices.\n\n";
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
    out += "_No standalone license/notice file recorded in the lockfile._\n\n";
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
console.error("Wrote notices for " + packages.size + " locked packages.");
