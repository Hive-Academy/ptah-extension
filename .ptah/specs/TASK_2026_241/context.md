# Context — TASK_2026_241

## How this surfaced

While answering a question about whether Ptah has UI for adding and authorizing
MCP connectors, the Marketplace was surveyed end to end. The answer was yes —
`libs/frontend/marketplace` ships five live provider surfaces and the OAuth flow
is complete. The gap found along the way is the read side, not the write side.

## The gap

Each provider surface owns its own installed list, and nothing merges them:

| Surface                                           | RPC it reads                         | Source of truth              |
| ------------------------------------------------- | ------------------------------------ | ---------------------------- |
| MCP Registry (`McpDirectoryBrowserComponent`)     | `mcpDirectory:listInstalled`         | per-target config files      |
| Smithery (`smithery-surface.component.ts:958`)    | `mcpDirectory:listSmitheryInstalled` | Smithery on-disk manifest    |
| Connected Apps (`oauth-surface.component.ts:572`) | `mcpDirectory:listOAuthConnected`    | OAuth manifest + token store |
| Plugins / Skills                                  | own skill-install paths              | —                            |

Consequences:

- A server installed through Smithery does not appear in Connected Apps, and
  vice versa. Neither shows what the MCP Registry surface installed.
- There is no view of what is actually written into the four target configs.
  `mcp-directory/installers/` fans installs out to claude
  (`<workspaceRoot>/.mcp.json`, root key `mcpServers`), copilot, cursor and
  vscode — each with its own path and root key. A user cannot see that fan-out.
- Uninstall is only reachable from the surface that performed the install. If a
  user forgets which provider they used, the entry is effectively orphaned in
  the UI even though it is live in `.mcp.json`.
- The three lists do not share a row shape, so there is no reusable
  installed-row component; each surface re-implements status pills and
  per-key inflight tracking.

## Proposed shape

A sixth Marketplace provider descriptor — an **Installed** surface — that reads
across every installer target and every provider manifest and renders one
inventory, grouped by target config file, with the originating provider shown
per row and uninstall routed back to whichever installer owns it.

Open design questions for the architect, not decided here:

- Whether this is a new aggregate RPC (`mcpDirectory:listAllInstalled`) or a
  frontend fan-out over the three existing calls. An aggregate RPC is likely
  right — the backend already holds every installer instance, and the frontend
  would otherwise need to know the target/provider matrix.
- How to reconcile the same logical server appearing in two targets (installed
  to both claude and cursor) — one row with target badges, or one row per target.
- Whether the existing per-surface installed lists stay (redundant but
  contextual) or become filtered views over the shared inventory.
- Whether an installed-row presentational component gets extracted to
  `libs/frontend/ui` so the four surfaces stop re-implementing it.

## Constraints

- New RPC namespace or method requires the **dual registration**: the
  compile-time type in `libs/shared/.../rpc.types.ts` AND the prefix in
  `ALLOWED_METHOD_PREFIXES` at
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`. The `mcpDirectory:`
  prefix is already allowed, so a new method under it needs only the type.
- `MARKETPLACE_PROVIDERS` in `providers.registry.ts` is the open/closed seam —
  adding a descriptor must require no edit to `marketplace-hub.component.ts`.
  Note the hub currently special-cases three surfaces by identity
  (`isGenericSurface`), so a new surface should mount through the generic
  `NgComponentOutlet` path rather than adding a fourth special case.
- Angular 21: signals, `OnPush`, `inject()`.

## Related

- Discovered during TASK_2026_238 (codex native binary path resolution), which
  is unrelated in code but shares the `cli-agent-runtime` lib.
- `composio` is already registered as a `coming-soon` provider and would become
  a fifth inventory source when it lands.
