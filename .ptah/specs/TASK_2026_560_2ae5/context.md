
## Triage 2026-10-12

Re-scoped. Done: the toggle store, scope labels and schema-size display; Claude SDK sessions including proxied ones (sdk-query-options-builder.ts) and ptah-cli lanes (ptah-cli-spawn-options.service.ts) apply the capability resolver. Left: enforcement for system CLI lanes (codex, opencode, antigravity and others), which do not consume the resolver today. Close when that is done or recorded as out of scope.

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: The PR 2 items: MCP enforcement for Codex, OpenCode and Antigravity lanes and the CLI proxy, schema-size token measurement, the skills/plugins Marketplace pages, duplicate-scope display, Codex quoted keys, the CLI warning print, and the Ptah CLI agents' unverified notice.
- Evidence on main: PR #599 ('per-workspace and global MCP/skill/plugin toggles (PR 1 of 2)') delivered the capability contract, store, resolver, Claude and Ptah CLI enforcement and the Marketplace switches. main:libs/shared/src/lib/types/capability-toggle.types.ts:688-693 still marks codex, opencode and antigravity as MCP_NOT_ENFORCED and the ptah-cli-proxy row as mcp 'not-enforced'. The Marketplace still shows SCHEMA_SIZE_UNKNOWN ('size unknown').
