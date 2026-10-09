# Agents panel defect report

## Defect 1 — duplicate lane headers

**Root cause:** `AgentLaneGridComponent` rendered a column-level title/status/remove strip before projecting `AgentCardComponent`, whose `AgentCardHeaderComponent` repeated the same lane identity and controls. The duplicated grid header began at `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts:45` before this change; the card header is composed in `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:47`.

**Fix:** Removed the grid-owned header. The card header is now the only lane header and includes lane name, status, model, elapsed duration, stop/resume, and the lane-column close action. The template outlet now supplies the grid's existing remove callback to the card at `agent-lane-grid.component.ts:57`; `AgentCardComponent` forwards its lane id at `agent-card.component.ts:58`; the panel consumes it at `agent-monitor-panel.component.ts:540`. The header no longer nests action buttons inside a button: its expand toggle is independently keyboard accessible.

## Defect 2 — missing lane stats card

**Root cause:** Lane usage was folded in `AgentMonitorStore` but `CliAgentOutputComponent` only rendered a small conditional row from retained segments. It omitted context/cache/not-reported fields and was absent when no structured output was present.

**Fix:** Added `CliLaneUsageSummaryComponent` and placed it directly under every lane header (`agent-card.component.ts:61`). It reuses the existing chat stats formatters in `stats-bar.utils.ts` and the same compact card treatment as `SubagentUsageSummaryComponent`: input, output, context, cache read/write, cost, and duration are displayed; absent values use an em dash and cache has a clear `cache not reported` state.

## Defect 3 — CLI cache usage was dropped

**Root cause:** `CliOutputSegment.usage` did not define cache or context fields (`libs/shared/src/lib/types/agent-process.types.ts:417` before this change), so adapters discarded Codex's `cached_input_tokens` and Ptah CLI's Claude SDK cache fields. The frontend consequently hard-coded CLI cache as unreported.

**Fix:**

- Added typed `cacheReadTokens`, `cacheWriteTokens`, and `contextTokens` usage fields at `agent-process.types.ts:425`.
- Updated the shared incremental fold to sum cache token reports and retain the most recent context at `cli-usage.utils.ts:34`.
- Preserved Codex `cached_input_tokens` at `codex-cli.adapter.ts:1168`.
- Preserved Ptah CLI `cache_read_input_tokens` and `cache_creation_input_tokens` at `ptah-cli-stream-loop.service.ts:677`.
- Set `MonitoredAgent.cacheReported` when received lane totals include either cache field at `agent-monitor.store.ts:1307`; providers that send no cache report remain explicitly unreported.

## Files changed

- Modified `libs/shared/src/lib/types/agent-process.types.ts`
- Modified `libs/shared/src/lib/utils/cli-usage.utils.ts`
- Modified `libs/shared/src/lib/utils/cli-usage.utils.spec.ts`
- Modified `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts`
- Modified `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts`
- Modified `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts`
- Modified `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts`
- Modified `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
- Modified `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts`
- Modified `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`
- Modified `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.spec.ts`
- Created `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts`
- Created `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.spec.ts`
- Modified `libs/frontend/chat/src/lib/components/organisms/agent-monitor/agent-lane-grid.component.ts`
- Modified `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`

## Verification

- Ran Prettier on all touched source and test files: completed successfully.
- Started the required scoped command: `npx nx run-many -t typecheck,lint,test -p @ptah-extension/chat,@ptah-extension/chat-streaming,@ptah-extension/cli-agent-runtime,@ptah-extension/shared --parallel=2`.
- Its permitted single completion check was still running after 60 seconds, with no output returned. It was not re-run or polled again.
- `ptah_get_diagnostics` was unavailable because its compiler check remained active after 45 seconds; no diagnostic result was produced.

## Decisions

- Kept the existing card-header component as the single header instead of adding a second shared primitive; it already owns stop/resume state and is the natural action boundary.
- Reused the established chat usage formatter building blocks rather than importing an orchestrator component into a presentational surface.
- Cache absence stays distinct from zero. A CLI that reports `0` cache tokens displays `0`; one that sends no cache fields displays `cache not reported`.
- Did not modify effort logic or settings/analytics code. Adapter changes are limited to usage extraction.

## Anything not done

- The scoped Nx verification process had not returned a result at the allowed single completion check. A subsequent owner should collect its final result before treating the change as verified.
