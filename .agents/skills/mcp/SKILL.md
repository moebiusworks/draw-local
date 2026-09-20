---
name: mcp-tools
description: Add or modify draw-local MCP tools without duplicating workspace logic.
---

# MCP tools

- MCP is an adapter over `Workspace`, not a second implementation.
- Use narrow tool schemas and explicit destructive-action descriptions.
- Keep stdio as the default transport.
- Never write protocol diagnostics to stdout; use stderr.
- Mutating Git tools must remain explicit opt-in.
- Preserve existing Excalidraw JSON fields when editing diagrams.
