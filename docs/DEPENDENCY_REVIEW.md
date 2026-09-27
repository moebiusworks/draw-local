# Native dependency review

## `fs-ext-extra-prebuilt@2.2.13`

Status: accepted temporarily. Reviewed 2026-09-27.

This MIT-licensed package supplies the cross-process OS file locks that protect
registry, draft, library, and drawing mutations. Reimplementing the binding now
would transfer native ABI, packaging, and platform maintenance into draw-local
without reducing the amount of native code that must be trusted. The project
therefore keeps the exact package version while limiting and testing its use.

### Verified release identity

- Package: `fs-ext-extra-prebuilt@2.2.13`
- Repository: `https://github.com/adamziel/fs-ext-prebuilt`
- npm `gitHead`: `792ba4cf6f887011afd03757716ca099824a23d0`
- npm tarball integrity:
  `sha512-mVSm+UDKvftEMHljOThNW3NtI8/gX7f1z9U1WGRbBf6JXQTFbS8Wv+qPVpZhYH6zCj1rXV/XnhQMek3tEn41Pg==`
- npm publishes SLSA provenance for the release. Its trusted-publisher record
  identifies `adamziel/fs-ext-prebuilt`, `.github/workflows/publish.yml`, and
  workflow source commit `bef5b052487076c0c1b74cc3c2ed45fb4f54d84f`.
  That workflow creates the version commit recorded by npm as `gitHead` before
  publishing.
- Runtime transitive dependency: `nan@2.29.0`, MIT.

The package and `nan` are present in the generated third-party notices. CI uses
`npm ci`, so installation must match the committed lockfile and integrity
digest. The package's install script and `esbuild@0.28.2`'s required build-tool
script are the only dependency install scripts approved in `package.json`, and
both approvals are version-pinned.

### Required API surface

`src/workspace.ts` uses only:

- `flockSync(fd, "exnb")` and `flockSync(fd, "un")` on non-Windows systems;
- `lockFileExSync(fd, flags, 0, 0, 1, 0)` and
  `unlockFileExSync(fd, 0, 0, 1, 0)` on Windows; and
- `LOCKFILE_EXCLUSIVE_LOCK` and `LOCKFILE_FAIL_IMMEDIATELY` from `constants`.

Do not expand this surface without a new dependency and security review.

### Supported matrix

| Operating system | Architectures | Node.js    | Installation     |
| ---------------- | ------------- | ---------- | ---------------- |
| macOS            | x64, ARM64    | 22, 24 LTS | Prebuilt binding |
| Windows          | x64, ARM64    | 22, 24 LTS | Prebuilt binding |
| glibc Linux      | x64, ARM64    | 22, 24 LTS | Prebuilt binding |

CI runs the lock smoke test with Node.js 22 and 24 on representative x64 and
ARM64 runners across these operating systems. musl Linux and other targets are
best-effort source builds and require a C++ toolchain and Python. Network
filesystems are outside the cross-host locking guarantee.

### Review triggers

Repeat this review before any of the following:

- changing the package or version, including `nan`;
- changing the supported Node.js majors, operating systems, or architectures;
- accepting a release without npm provenance or with a changed publisher,
  repository, workflow, install script, or integrity record;
- expanding the imported native API; or
- responding to a relevant advisory or loss of upstream maintenance.

At each trigger, compare replacing the dependency with a small N-API binding.
Any replacement must retain fail-closed installation, the same lock semantics,
license notices, and the full platform and contention test matrix.
