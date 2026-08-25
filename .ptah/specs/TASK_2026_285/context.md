# TASK_2026_285 — Antigravity as an MCP install target

Split out of TASK_2026_284 (opencode/pi harness support) at the user's request: the same type lock that hides opencode also hides antigravity, and antigravity is the cheap half — its MCP config file is known, in-repo, and already written to.

## The gap

`libs/shared/src/lib/types/mcp-directory.types.ts:24-29`

```ts
export type McpInstallTarget = 'vscode' | 'claude' | 'cursor' | 'copilot' | 'codex';
```

Intents in `~/.ptah/mcp-installed.json` are typed `McpInstallTarget[]` (`harness-sync/src/lib/sources/mcp-intent-store.ts:68,94`), and `MCP_FACET_TARGETS` (`targets/mcp/mcp-facet.registry.ts:23-30`) lists the same five. So an antigravity intent cannot be recorded, offered in the UI, or reconciled.

`harness-sync/CLAUDE.md` explains the absence as "user-installed servers are not offered for `agy` by the install surface, so there is no intent to reconcile". That is true and circular — the install surface cannot offer what the type cannot express.

## The part that is not a one-line change

`AntigravityCliAdapter` already owns writes to the same file:

- `antigravity-cli.adapter.ts:368-370` — `configureMcpServer(port)` before every spawn
- `antigravity-cli.adapter.ts:522-526` — `cleanupMcpEntry()` after `done`
- target: `~/.gemini/config/mcp_config.json`

Adding a reconciler facet puts a second writer on that file. Two hazards, both must be closed:

1. **The adapter's cleanup must only remove its own key.** If it rewrites the file wholesale, or removes anything but the `ptah` entry it added, a user's server installed through the new facet disappears after the next agent run.
2. **Concurrent spawn + reconcile must not lose entries.** Both sides do read-modify-write. The reconciler writes through `atomicWriteWithRetry` and holds the workspace lock, but the adapter is outside that lock and its file is in `$HOME`, not the workspace — so the workspace lock does not serialize them. Decide the mechanism: either the adapter writes through the same facet (preferred — one writer, one format, `mcp-facet.registry.ts` stays the single definition of the file), or a shared home-scoped lock.

Preferred shape: make `configureMcpServer`/`cleanupMcpEntry` call the antigravity MCP facet rather than hand-rolling their own read-modify-write. The facet already knows the file's schema, the fence/ownership rule and the atomic write. Ptah's own ephemeral `ptah` entry stays adapter-owned and per-spawn; user-installed entries stay manifest-owned. Neither may reap the other's keys.

## Scope

1. `McpInstallTarget` gains `'antigravity'` (`libs/shared/src/lib/types/mcp-directory.types.ts`), and `MCP_FACET_TARGETS` gains it in `mcp-facet.registry.ts` with a definition for `~/.gemini/config/mcp_config.json` — confirm the exact key shape (`mcpServers` vs `servers`, whether `type` is required) from `AntigravityCliAdapter`'s existing writer, which is the in-repo source of truth.
2. Route the adapter's own writes through the facet so one module owns the file.
3. Wherever the install surface enumerates targets — UI lists in `libs/frontend`, RPC params, docs — antigravity appears. No UI redesign; just stop excluding it.
4. `harness-sync/CLAUDE.md`: replace the circular justification with the real matrix row, and record the two-writer rule.

## Acceptance

- A user can install an MCP server for antigravity; it lands in `~/.gemini/config/mcp_config.json` and survives an agent spawn/teardown cycle.
- Uninstall removes only the manifest-owned entry.
- Ptah's own per-spawn `ptah` entry still appears before spawn and is gone after `done`, and neither writer removes the other's keys.
- Specs: install → spawn → cleanup → the user's server is still there; concurrent reconcile + spawn keeps both; foreign keys the user hand-wrote are never touched.
