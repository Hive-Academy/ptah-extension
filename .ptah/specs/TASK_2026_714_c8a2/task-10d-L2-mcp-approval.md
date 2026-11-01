# Task 10d.L2 — corrective batch M: Ptah MCP tools under lane `approval_policy never` (TASK_2026_714_c8a2)

W = D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration
T = W\.ptah\specs\TASK_2026_714_c8a2

## HARD RULES (read first)

- Do NOT run verify, tests, typecheck, lint, build, nx, npm or ptah_get_diagnostics. Do NOT commit, push, merge or run
  history-changing or discarding git (stash, reset, restore, checkout, clean). The coordinator runs all checks.
- Do NOT start a real Codex App Server, a real `codex` binary, or any network or paid model call.
- Do NOT edit ~/.codex/config.toml or ~/.ptah/settings.json.
- Also apply every rule in T\task-10d-common-rules.md (HARD RULES).
- NEVER strip, revert, disable or comment out MCP. The fix ADDS approval config; it removes nothing.
- Do not convert line endings. UTF-8 without BOM. Touch ONLY the files in Scope.
- Two other codex lanes edit other files in W at the same time (batch R: codex-app-server-lane.adapter.ts; batch N:
  lane completion / parent session id). Do not touch their files.

## Defect 1 (blocker, live run gap G3)

Native lanes run with `approval_policy: 'never'` (D26, W\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts:184-193
and W\libs\backend\codex-runtime\src\lib\codex-lane-thread-config.ts:48,129). Codex 0.165.0 then rejects every
Ptah MCP tool call in a lane: `MCP tool call requires approval, but approval policy is never`. So
`ptah_agent_report`, `ptah_agent_spawn` and `ptah_agent_message` can never work from a lane.

## Fix 1

1. Find the App Server config key that pre-approves an MCP server's tools. Evidence: the protocol schema
   W\libs\backend\codex-runtime\src\lib\protocol\codex-app-server-protocol.schema.json (search
   `default_tools_approval_mode`, `approval_mode`, `AppToolApproval` and the MCP server config definition) and the
   evidence harness W\libs\backend\codex-runtime\tools\evidence-harness.ts:1425 and :2014-2018, which already sends
   `mcp_servers.<name>.default_tools_approval_mode`. Record the exact key, the allowed values, and which value means
   "run without asking" under `## Decisions`, with schema line numbers. If the schema does not prove the value,
   say so plainly in the report and do not guess silently.
2. In `buildCodexLaneThreadConfig`, add that key with the "run without asking" value to the `ptah` server entry
   ONLY. User MCP servers keep `{ enabled: false }` exactly as today. Extend `codexLaneThreadConfigSchema`
   (`ptahServer`) strictly for the new key (literal value). Do not change `approval_policy`, the sandbox, or the
   profile fingerprint inputs.
3. Check that the same frame is sent on thread/start AND thread/resume (read where the builder output is used in
   codex-runtime) so a resumed lane keeps the approval. Note the call sites under `## Decisions`.
4. Specs in W\libs\backend\codex-runtime\src\lib\codex-lane-thread-config.spec.ts (create it only if no spec for
   this builder exists; search first): ptah entry carries the key; user servers stay `{ enabled: false }`; no ptah
   server means no key; the schema rejects another value.

## Defect 2 (gap G4)

An MCP tool error is stored as `tool-result-error` with content `"null"`, so the rejection reason above was not
visible in Ptah. Mapper: W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-events.ts:~70-100.

## Fix 2

When a failed MCP tool item has a null or absent result, use its error message (the App Server item error field;
read the item schema) as the content. If there is no message either, use a fixed short text such as
`MCP tool call failed` — never the string "null". Match the Claude adapter's tool-result-error content shape.
Spec in W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-events.spec.ts.

## Scope (only these files)

- W\libs\backend\codex-runtime\src\lib\codex-lane-thread-config.ts and its spec
- W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-events.ts and codex-lane-events.spec.ts
- Read-only: everything else.

## Deliverable

**Deliverable**: D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L2-report.md
(write a skeleton early): what changed (file:line), `## Decisions` with schema evidence, specs added, anything not done.
Reply `WROTE: <path>` plus one headline line.
