import { promises as fs } from "node:fs";
import path from "node:path";

const sourcePath = "third-party-notices-source.json";
const lockfile = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
const rawEntries = Object.entries(lockfile.packages ?? {})
  .filter(([location, pkg]) => location && pkg.version && !pkg.link)
  .map(([location, pkg]) => {
    const index = location.lastIndexOf("node_modules/");
    return index < 0
      ? undefined
      : { location, name: location.slice(index + 13), version: pkg.version };
  });
const identity = (pkg) => `${pkg.name}@${pkg.version}`;
const entries = [
  ...new Map(
    rawEntries.filter(Boolean).map((pkg) => [identity(pkg), pkg]),
  ).values(),
];
const noticeName = /^(license|notice|copying|authors|attribution)(\.|$)/i;
const mit = `MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

async function sourceFromInstalledPackages() {
  const source = {};
  for (const pkg of entries) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(pkg.location, "package.json"), "utf8"),
    );
    const names = (await fs.readdir(pkg.location, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && noticeName.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const license =
      typeof manifest.license === "string" ? manifest.license : "SEE PACKAGE";
    source[identity(pkg)] = {
      license,
      repository:
        typeof manifest.repository === "string"
          ? manifest.repository
          : typeof manifest.repository?.url === "string"
            ? manifest.repository.url
            : undefined,
      notices: await Promise.all(
        names.map(async (name) => ({
          name,
          text: (await fs.readFile(path.join(pkg.location, name), "utf8"))
            .trim()
            .replaceAll("\r\n", "\n")
            .replace(/[ \t]+$/gm, ""),
        })),
      ).then((notices) =>
        notices.length || license !== "MIT"
          ? notices
          : [{ name: "LICENSE (standard MIT text)", text: mit }],
      ),
    };
  }
  return source;
}

if (process.argv.includes("--update-source"))
  await fs.writeFile(
    sourcePath,
    JSON.stringify(await sourceFromInstalledPackages(), null, 2) + "\n",
  );
const source = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const packages = entries.map((pkg) => {
  const record = source[identity(pkg)];
  if (!record)
    throw new Error(`Missing bundled notice source for ${identity(pkg)}.`);
  if (
    /^(MIT|Apache-2\.0|BSD-[23]-Clause)$/.test(record.license) &&
    !record.notices.length
  )
    throw new Error(`Missing required license text for ${identity(pkg)}.`);
  return { name: pkg.name, version: pkg.version, ...record };
});
const noticeData = [
  {
    name: "draw-local",
    version: JSON.parse(await fs.readFile("package.json", "utf8")).version,
    license: "Apache-2.0",
    repository: "https://github.com/moebiusworks/draw-local",
    notices: [
      { name: "LICENSE", text: (await fs.readFile("LICENSE", "utf8")).trim() },
    ],
  },
  ...packages.sort((a, b) => identity(a).localeCompare(identity(b))),
];
let out =
  "# Generated third-party notices\n\n> Generated from package-lock.json and bundled notice sources by npm run notices.\n\n";
for (const pkg of noticeData) {
  out += `## ${identity(pkg)}\n\n- License: ${pkg.license}\n`;
  if (pkg.repository) out += `- Repository: ${pkg.repository}\n`;
  out += "\n";
  for (const notice of pkg.notices)
    out += `### ${notice.name}\n\n\`\`\`text\n${notice.text}\n\`\`\`\n\n`;
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
console.error("Wrote notices for " + packages.length + " locked packages.");
