---
name: workspace-security
description: Review filesystem, Git, networking, or dependency changes against draw-local's local-first security model.
---

# Workspace security

1. Confirm paths remain scoped to the configured root.
2. Reject absolute paths and `..` before disk access.
3. Keep the extension allowlist narrow.
4. Prefer atomic writes.
5. Use `execFile`/argument arrays for Git.
6. Keep mutating Git behavior opt-in.
7. Keep listeners loopback-only by default.
8. Add regression tests for boundary changes.
9. Update `docs/SECURITY_MODEL.md` when trust boundaries change.
