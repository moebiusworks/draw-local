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
      : {
          location,
          name: location.slice(index + 13),
          version: pkg.version,
          archive: pkg.resolved,
        };
  });
const identity = (pkg) => `${pkg.name}@${pkg.version}`;
const entries = [
  ...new Map(
    rawEntries.filter(Boolean).map((pkg) => [identity(pkg), pkg]),
  ).values(),
];
const noticeName = /^(license|notice|copying|authors|attribution)(\.|$)/i;
const upstream = (pkg) => {
  if (pkg.name.startsWith("@radix-ui/"))
    return ["radix-ui", "primitives", "main", "LICENSE"];
  if (pkg.name === "@excalidraw/excalidraw")
    return ["excalidraw", "excalidraw", "master", "LICENSE"];
  if (pkg.name.startsWith("@esbuild/"))
    return ["evanw", "esbuild", "main", "LICENSE.md"];
  if (pkg.name.startsWith("@rolldown/"))
    return ["rolldown", "rolldown", "main", "LICENSE"];
  if (pkg.name === "emoji-regex")
    return ["mathiasbynens", "emoji-regex", "main", "LICENSE-MIT.txt"];
  if (pkg.name === "react-remove-scroll-bar")
    return ["theKashey", "react-remove-scroll-bar", "master", "LICENSE"];
  if (pkg.name === "fuzzy")
    return ["mattyork", "fuzzy", "master", "LICENSE-MIT"];
  if (["fastdom", "strictdom"].includes(pkg.name))
    return ["wilsonpage", pkg.name, "master", "README.md"];
};
const upstreamCache = new Map();
async function upstreamNotice(pkg) {
  const spec = upstream(pkg);
  if (!spec)
    throw new Error(`No authentic notice source for ${identity(pkg)}.`);
  const key = spec.join("/");
  if (!upstreamCache.has(key)) {
    upstreamCache.set(
      key,
      (async () => {
        const [owner, repo, ref, file] = spec;
        const commitResponse = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`,
          { headers: { "User-Agent": "draw-local-notices" } },
        );
        if (!commitResponse.ok) throw new Error(`Cannot resolve ${key}.`);
        const { sha } = await commitResponse.json();
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${file}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot read ${url}.`);
        let text = await response.text();
        if (file === "README.md") {
          const section = text.match(/^## License\s*\n([\s\S]*)$/im);
          if (!section) throw new Error(`No License section in ${url}.`);
          text = section[1];
        }
        return { name: file, text: text.trim(), source: url };
      })(),
    );
  }
  return upstreamCache.get(key);
}

async function sourceFromInstalledPackages() {
  const source = {};
  for (const pkg of entries) {
    if (pkg.name.startsWith("@lickle/lock-")) {
      const parent = source[`@lickle/lock@${pkg.version}`];
      if (!parent)
        throw new Error(`Missing parent license for ${identity(pkg)}.`);
      source[identity(pkg)] = {
        ...parent,
        notices: parent.notices.map((notice) => ({ ...notice })),
      };
      continue;
    }
    const manifestText = await fs.readFile(
      path.join(pkg.location, "package.json"),
      "utf8",
    );
    const manifest = JSON.parse(manifestText);
    const names = (await fs.readdir(pkg.location, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && noticeName.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    let license =
      typeof manifest.license === "string" ? manifest.license : "SEE PACKAGE";
    if (pkg.name === "khroma" || pkg.name === "fuzzy") license = "MIT";
    const notices = await Promise.all(
      names.map(async (name) => ({
        name,
        text: (await fs.readFile(path.join(pkg.location, name), "utf8"))
          .trim()
          .replaceAll("\r\n", "\n")
          .replace(/[ \t]+$/gm, ""),
        source: `${pkg.archive ?? `npm:${identity(pkg)}`}#${name}`,
      })),
    );
    source[identity(pkg)] = {
      license,
      repository:
        typeof manifest.repository === "string"
          ? manifest.repository
          : typeof manifest.repository?.url === "string"
            ? manifest.repository.url
            : undefined,
      notices: notices.length ? notices : [await upstreamNotice(pkg)],
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
    !record.license ||
    record.license === "SEE PACKAGE" ||
    !Array.isArray(record.notices) ||
    !record.notices.length ||
    record.notices.some(
      (notice) =>
        !notice.text?.trim() ||
        !notice.source ||
        /standard MIT text/i.test(notice.name) ||
        /^MIT License\s+Copyright \(c\) <year> <copyright holders>/i.test(
          notice.text,
        ),
    )
  )
    throw new Error(`Incomplete or placeholder notice for ${identity(pkg)}.`);
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
    out += `### ${notice.name}\n\n- Source: ${notice.source ?? "draw-local LICENSE"}\n\n\`\`\`text\n${notice.text}\n\`\`\`\n\n`;
}
out = out.trimEnd() + "\n";
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
