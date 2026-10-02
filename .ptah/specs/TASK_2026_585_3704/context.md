# Task Context - TASK_2026_585_3704

## Origin

TASK_2026_494_ca38 shipped in PR #598 with four manual QA items unrecorded (`TASK_2026_494_ca38/completion-validation.md`
"Remaining work" 1-4). On 2026-10-01 the user chose to split them: Req 9.2 (lazy-chunk proof) was recorded in 494
itself; the three items below need a live, authenticated agent turn and moved here. 494 is `done`.

## Task Type

QA evidence only. A finding goes to the owner of the affected surface, not into a 494 code change.

## Preconditions

- Electron dev build from `main`.
- A provider login in the Electron profile. Each item spends paid agent turns.

## Items (source: `TASK_2026_494_ca38/implementation-plan.md:979-990`)

1. **A2 - permission prompt.** In an Apps session, ask for a form so the agent calls
   `mcp__ptah__ptah_surface_update` and `mcp__ptah__ptah_surface_get_state`. Confirm both run without an unexpected
   permission prompt, the same way `ptah_dashboard_propose_spec` does. If a prompt appears, it must render on the Apps
   page (494 Req 2.3), not in the coding chat. An unexpected prompt is a finding for the permission allowlist owner.
2. **Tool-result rendering.** The dashboard tool result renders in the Apps transcript through
   `ExecutionNodeComponent` as generic MCP tool output.
3. **`ptah_surface_get_state` follow-through.** The agent follows `APPS_SYSTEM_PROMPT`
   (`libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:19-20`): select a table row, ask "what is this row?",
   and confirm the agent calls `ptah_surface_get_state` (the D4 cost check).

## Deliverable

`test-report.md` in this folder with one screenshot per item (dark theme is enough) and the PASS / FAIL / finding
for each.
