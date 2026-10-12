# Epic: Skills distribution to CLIs (P2)

Created 2026-10-12 by the memory and skills backlog triage (code audit against `main`, codex cross-review).

## Children, in suggested order

| Pri | Task | Problem today (evidence) | Size | Depends on |
|---|---|---|---|---|
| P2 | TASK_2026_564 | The CLI Anthropic proxy merges `skill__`/`mcp__` placeholder tools it never forwards, fires false `proxy.tool_invoked`, and drops caller `tools[]` and `tool_result` (`workspace-mcp-collector.ts:185,204`, `anthropic-sse-translator.ts:21,175`). | M | - |
| P2 | TASK_2026_279 | Harness skill and command copies carry no provenance marker, so a stale Ptah skill reads as user-authored (`workspace-target.ts:542-549`). | M | - |
| P3 | TASK_2026_560 | Re-scoped: SDK sessions (incl. proxied) and ptah-cli lanes already apply the capability resolver (`sdk-query-options-builder.ts`, `ptah-cli-spawn-options.service.ts`). Left: enforcement for system CLI lanes (codex, opencode, ...), then close. | S | - |
| P3 | TASK_2026_280 | Re-scoped to the settings UI only: a schema and controls for `harness.manageGitignore` and `harness.preflightTimeoutMs`. Rebase-on-orphaned and badge paths are already fixed. | S | - |
| P3 | TASK_2026_313 | No e2e covers the harness disclosure surfaces; the blocked-path list has no cap (`harness-blocked-paths.component.ts:74-87`). | S | - |
| P4 | TASK_2026_284 | Re-scoped to the pi half (opencode shipped, `rival-targets.ts:190-199`). pi is not installed here. | M | 279 |
| P4 | TASK_2026_276 | Scope decision: ship a `ptah-python` plugin and the two skills `stack-profiles.ts:183-184` names. | L | - |
| P4 | TASK_2026_289 | Scope decision: is a Smithery skills provider worth building (the MCP half exists). | M | - |

Closed in this triage: TASK_2026_321 and TASK_2026_574 (done in code).
