# Security model

draw-local is intended as a local, single-user developer tool, not a public multi-user service.

## Controls

- HTTP API binds to loopback by default.
- Unexpected Host headers are rejected to reduce DNS-rebinding risk.
- No permissive CORS policy is enabled.
- Filesystem operations are confined to `DRAW_LOCAL_ROOT`.
- Absolute paths and parent traversal are rejected.
- Writable file extensions are allowlisted.
- File replacement is atomic.
- Git uses `execFile` with fixed argument arrays, not a shell.
- Git status/diff are read-only; commits require explicit opt-in and explicit file paths.
- MCP uses stdio and opens no network listener.
- Excalidraw fonts are copied locally at install time.

## Non-goals

- Protecting against another malicious local OS account with equivalent filesystem/process access.
- Public internet hosting.
- Untrusted multi-user access.
- Arbitrary plugin execution.

Any future feature that adds outbound networking, remote serving/authentication, arbitrary process execution, access outside the workspace, or automatic Git mutation must update this document and receive explicit review.
