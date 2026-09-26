# draw-local

Local-first Excalidraw workspace for filesystem- and Git-backed diagrams.

draw-local keeps ordinary `.excalidraw` files as the source of truth. It is aimed at personal/internal developer workflows: run it locally (including from WSL), edit in your browser, keep diagrams in Git, and optionally expose the same workspace through a local MCP server.

## What it provides

- Multiple registered local project directories, each with a normal folder tree.
- Unnamed drafts that autosave in local application data until first Save.
- Excalidraw embedded as the editor.
- Debounced autosave to real `.excalidraw` files.
- No database, cloud account, telemetry, or collaboration backend.
- Self-hosted Excalidraw fonts at runtime.
- Read-only Git status/diff by default.
- Explicit opt-in Git commit support.
- Local stdio MCP tools for agent/harness integrations.

## Quick start

Requires Node.js 22+, npm, and Git if you want Git integration.

```bash
git clone https://github.com/moebiusworks/draw-local.git
cd draw-local
npm install
export DRAW_LOCAL_ROOT="$HOME/git/architecture"
npm run dev
```

Open http://localhost:5173.

On normal WSL2 setups, Windows Chrome can reach the WSL listener through localhost forwarding. If your setup cannot, use `DRAW_LOCAL_WEB_HOST=0.0.0.0` carefully; that broadens network exposure.

Example workspace:

```text
architecture/
├── platform/
│   ├── overview.excalidraw
│   └── kubernetes.excalidraw
├── apps/
│   └── payments.excalidraw
└── libraries/
    └── cloud-native.excalidrawlib
```

Use **New** (or Ctrl+Alt+N) to create an unnamed draft. Ctrl/Command+S flushes its current save; for a draft, choose a registered project and a relative `.excalidraw` filename. **Save As** copies a saved drawing to a new project/path and then edits that copy. Existing destinations are never overwritten implicitly. Registered projects are stored in `$XDG_CONFIG_HOME/draw-local/projects.json` (or `~/.config/draw-local/projects.json`); drafts live in `$XDG_DATA_HOME/draw-local/drafts/` (or `~/.local/share/draw-local/drafts/`).

The selected Git project shows its branch and per-file read-only state. Save only writes drawing JSON; it never stages or commits.

## MCP

```bash
DRAW_LOCAL_ROOT="$HOME/git/architecture" npm run mcp
```

Example host configuration:

```json
{
  "mcpServers": {
    "draw-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/home/you/git/draw-local",
      "env": { "DRAW_LOCAL_ROOT": "/home/you/git/architecture" }
    }
  }
}
```

Tools: `list_diagrams`, `read_diagram`, `write_diagram`, `rename_diagram`, `delete_diagram`, `git_status`, `git_diff`, and `git_commit`.

Git commits are disabled unless you explicitly set `DRAW_LOCAL_ALLOW_GIT_WRITE=1`. The commit tool requires explicit paths; it intentionally has no commit-everything mode.

## Security posture

The default topology is browser -> loopback Vite dev server -> loopback API -> scoped workspace filesystem/Git. File traversal and unsupported extensions are rejected; Git commands avoid shell interpolation; Git writes are opt-in. MCP uses stdio rather than opening another port.

See `docs/SECURITY_MODEL.md`.

## Commands

- `npm run dev` — browser UI + API
- `npm run build` — production browser bundle
- `npm start` — local API serving the bundle when built
- `npm run mcp` — local stdio MCP server
- `npm run typecheck`
- `npm test`
- `npm run check`
- `npm run notices` — generate installed dependency notices

## License and third-party notices

draw-local is Apache-2.0 licensed. See `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`.

Before distributing a build, run `npm run notices` and include `THIRD_PARTY_NOTICES.generated.md` with the distribution.
