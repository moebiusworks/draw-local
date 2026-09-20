import { promises as fs } from "node:fs";
import path from "node:path";

const packages = new Map();
async function walk(dir) {
  let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = path.join(dir, entry.name);
    if (entry.name.startsWith("@")) { await walk(base); continue; }
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(base, "package.json"), "utf8"));
      if (pkg.name && pkg.version) {
        const names = (await fs.readdir(base)).filter((name) => /^(license|licence|notice|copying)(\.|$)/i.test(name)).sort();
        const notices = [];
        for (const name of names) notices.push({ name, text: (await fs.readFile(path.join(base, name), "utf8")).trim() });
        packages.set(pkg.name + "@" + pkg.version, { name: pkg.name, version: pkg.version, license: typeof pkg.license === "string" ? pkg.license : "SEE PACKAGE", repository: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url, notices });
      }
    } catch {}
    await walk(path.join(base, "node_modules"));
  }
}

await walk(path.resolve("node_modules"));
let out = "# Generated third-party notices\n\n> Generated from the installed dependency tree by npm run notices.\n\n";
for (const pkg of [...packages.values()].sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version))) {
  out += "## " + pkg.name + "@" + pkg.version + "\n\n- License: " + pkg.license + "\n";
  if (pkg.repository) out += "- Repository: " + pkg.repository + "\n";
  out += "\n";
  if (!pkg.notices.length) out += "_No standalone license/notice file found._\n\n";
  for (const notice of pkg.notices) out += "### " + notice.name + "\n\n```text\n" + notice.text + "\n```\n\n";
}
await fs.writeFile("THIRD_PARTY_NOTICES.generated.md", out);
console.error("Wrote notices for " + packages.size + " installed packages.");
