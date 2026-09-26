# Security model

draw-local is intended as a local, single-user developer tool, not a public multi-user service.

## Controls

- HTTP API binds to loopback by default.
- Unexpected Host headers are rejected to reduce DNS-rebinding risk.
- No permissive CORS policy is enabled.
- Each drawing operation is confined to its explicitly selected registered project root. The project registry and drafts are private local application data, not files added to target repositories.
- Absolute paths and parent traversal are rejected.
- Nested symbolic links are rejected for file access and omitted from listings, preventing links in the workspace from redirecting operations outside the root. The explicitly configured workspace root may itself be a symbolic link.
- Writable file extensions are allowlisted.
- File replacement is atomic.
- Directory registration canonicalizes an existing readable directory. Directory browsing is read-only; state-changing API requests also validate a same-loopback Origin when one is supplied.
- The browser folder picker omits hidden directories and does not expose operating-system sensitive roots by default. This includes Linux system roots, macOS system and user Library paths, and Windows system/program/recovery roots plus per-user AppData, including mounted Windows volumes. This limits accidental disclosure in the UI; registered projects still use their explicit canonical paths.
- Git uses `execFile` with fixed argument arrays, not a shell.
- Git status/diff are read-only; commits require explicit opt-in and explicit file paths.
- MCP uses stdio and opens no network listener.
- Excalidraw fonts are copied locally at install time.

## Non-goals

- Protecting against another malicious local OS account with equivalent filesystem/process access.
- Public internet hosting.
- Untrusted multi-user access.
- Defending against another local process that swaps path components during a filesystem operation.
- Arbitrary plugin execution.

Any future feature that adds outbound networking, remote serving/authentication, arbitrary process execution, access outside the workspace, or automatic Git mutation must update this document and receive explicit review.
