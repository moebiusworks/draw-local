# AGENTS.md

## Product intent

draw-local is a narrow, local-first Excalidraw workspace. The filesystem is the source of truth. Do not add a database, cloud dependency, telemetry, accounts, or background services without an explicit product decision.

## Commands

`npm install`, `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check`, `npm run mcp`, `npm run notices`.

## Invariants

- Keep filesystem/Git logic in `src/workspace.ts`; HTTP and MCP are thin adapters.
- Reject absolute paths and `..` traversal.
- Restrict writes to `.excalidraw` / `.excalidrawlib`.
- Use argument-array process execution; never shell-concatenate Git commands.
- Git writes stay opt-in and path-explicit.
- HTTP binds to loopback by default.
- Runtime should not need outbound internet access.
- Preserve unknown Excalidraw fields; do not normalize away forward-compatible data.
- Security-boundary changes require tests and a threat-model update.
- Dependency changes require license/notices review.
