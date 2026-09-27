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
- Browser and MCP processes serialize registry and drawing mutations through
  private OS file locks. Their lock files remain in place so concurrent processes
  always lock the same inode; the OS releases a lock if its owner exits. During
  upgrade, a new process waits for a live legacy owner or removes a stale legacy
  owner record while holding the new OS lock. Linux process start time helps
  distinguish reused legacy PIDs. Stop older running versions before upgrading;
  their legacy lock protocol cannot coordinate with the new OS lock.
  The lock binding is required at install time. Supported targets are macOS,
  Windows, and glibc Linux on x64/ARM64; other targets attempt a best-effort
  source build during installation. Lock acquisition failures abort a write
  rather than silently proceeding without cross-process exclusion. This
  coordination assumes a local filesystem and does not guarantee cross-host
  exclusion on network filesystems.
- Directory registration canonicalizes an existing readable directory. Directory browsing is read-only; state-changing API requests also validate a same-loopback Origin when one is supplied.
- The browser folder picker omits hidden directories and does not expose operating-system sensitive roots by default. This includes Linux system roots, macOS system and user Library paths, and Windows system/program/recovery roots plus per-user AppData, including mounted Windows volumes. This limits accidental disclosure in the UI; registered projects still use their explicit canonical paths.
- Project explorer expansion reads only the immediate children of an explicitly registered root or already validated relative directory. It rejects absolute and parent-traversal paths, omits hidden and symbolic-link entries, and never recursively scans unopened folders.
- Project removal and replacement modify only the private registration list. Replacement canonicalizes an existing directory and rejects registrations already owned by another project; removal never deletes or writes the registered directory.
- Promoting a nested Git root replaces one registration's path and name while retaining its ID and order. It validates the relative directory, rejects links and duplicate registrations, and requires a local `.git` marker. The browser flushes and closes a drawing in that project before promotion.
- UI Delete moves a drawing or draft into private application-data Trash before removing its source. The source revision must match the explorer's revision; a changed or conflicted drawing is retained. Restore checks the original registered root and creates the original filename exclusively. Restore elsewhere writes only into an explicitly selected, currently registered root at an unused relative filename with the original extension. Project removal never deletes its files or Trash copies. The older MCP delete operation remains a separate explicit API.
- Explorer drag/drop moves only an explicitly selected drawing into a Git-backed registered root or nested repository root. Both paths are validated and locked. A destination is created exclusively from the source bytes, including across filesystems; the source is removed only after the destination copy and a final revision check succeed. If final removal fails, both copies remain and the UI reports the partial move. No Git stage or commit runs.
- Git uses `execFile` with fixed argument arrays, not a shell.
- Git status/diff are read-only; commits require explicit opt-in and explicit file paths.
  Project Git refreshes inspect only drawing paths already loaded by the explorer
  and group them by their nearest worktree; unopened directories are not scanned.
- MCP uses stdio and opens no network listener.
- Excalidraw fonts are copied locally at install time.
- Installing an Excalidraw public library is an explicit browser action. The browser uses Excalidraw's built-in library URL allowlist to fetch it; the server never fetches library URLs. Installed libraries are stored outside registered projects in one private, atomically written XDG application-data file, so the normal drawing runtime remains offline.

## Non-goals

- Protecting against another malicious local OS account with equivalent filesystem/process access.
- Public internet hosting.
- Untrusted multi-user access.
- Defending against another local process that swaps path components during a filesystem operation.
- Arbitrary plugin execution.

Any future feature that adds outbound networking, remote serving/authentication, arbitrary process execution, access outside the workspace, or automatic Git mutation must update this document and receive explicit review.
