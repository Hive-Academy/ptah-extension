# Batch 24 report

Status: partial. The run telemetry, harvest path, seam, and registration are implemented. P1-L3 needs a parent-session provider source that is absent from the stop payload; the outcome writer still stores `claude`.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\skill-invocation-recorder.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\skill-invocation-recorder.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\skill-candidate.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\di\register.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\di\register.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\outcome-seam\skill-telemetry-seam.adapter.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\skill-synthesis\src\lib\outcome-seam\skill-telemetry-seam.adapter.spec.ts` (created)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-cli\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-24-report.md` (created)

## Assumptions and evidence

- PB-1: `agentId` comes directly from SDK hook `input.agent_id` (`libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:520-524`); the payload carries both that ID and `subagentSessionId` (`libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts:8-16`). The local producer does not establish that `agent_id` is unique across all runs. Batch 20 also recorded this limitation (`reports/batch-20-report.md:38`). The current implementation follows the plan's agent ID join; a duplicate gets `ambiguous` from the seam. The PB-1 fallback to `subagentSessionId` would require changing both outcome and telemetry run keys together and remains open.
- PB-3: Skill tool-use events have a session ID, but the nested session is not correlated to the stop payload's subagent session by the available event contract (`skill-trigger.service.ts:574-594`; `subagent-stop-callback-registry.ts:8-16`). The adapter returns `skillsLoaded: null` for `subagent:` scopes (`skill-telemetry-seam.adapter.ts:94-98`) as specified.
- Module boundary: both libs have `scope:extension`, `type:feature` (`libs/backend/skill-synthesis/project.json:5`, `libs/backend/lane-outcomes/project.json:5`), and the ESLint dependency boundary permits feature-to-feature imports (`eslint.config.mjs:407-410`). No package.json was changed.

## Task evidence

- `onSubagentStop` passes `payload.agentId` to the recorder (`skill-trigger.service.ts:528`); non-stop event paths do not supply it. The recorder dedups subagent events with a nonblank ID by run, preserving the 2 s bucket for other cases (`skill-invocation-recorder.ts:40-45`); spec at `skill-invocation-recorder.spec.ts:47-66`.
- Store insert includes `run_id` and writes null when absent (`skill-candidate.store.ts:1192-1220`). The store fixture applies migration 0055 and asserts the ID (`skill-candidate.store.spec.ts:78,168,644-656`).
- Stop schedules a per-workspace harvest before analyze gates (`skill-trigger.service.ts:430-435,483-492`), with timer disposal (`:263-264`); master switch no longer gates harvest (`:495-499`). Regression spec at `skill-trigger.service.spec.ts:1859-1880`.
- Seam reads subagent runs and reports matched, unmatched or ambiguous (`skill-telemetry-seam.adapter.ts:40-81`); reads session verdict evidence (`:116-132`); adapter spec covers two same-slug runs and ambiguity (`skill-telemetry-seam.adapter.spec.ts:11-69`). Queries are parameterized and read-only.
- DI binds the seam token to the adapter (`di/register.ts:72-76`), with lib and existing-host guard specs (`di/register.spec.ts:39-48`, `apps/ptah-electron/src/di/container.smoke.spec.ts:79-84`, `apps/ptah-cli/src/di/container.smoke.spec.ts:76-81`). The adapter injects the already registered persistence connection, not a lane-outcomes service.
- TL-16/P1-C1: existing lane-outcomes startup registers the budget-stop callback and calls only `markSubagentBudgetStop` (`libs/backend/lane-outcomes/src/lib/di/start.ts:39-47`); disposal calls its unsubscribe (`:49-50`). No lane-outcomes store code changed.
- P1-L3 family source: the stop payload has no provider field (`libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts:8-16`); the outcome recorder still writes `SUBAGENT_FAMILY` (`libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:108`), defined as `claude` (`libs/shared/src/lib/utils/lane-family.ts:23`). A session provider resolver and outcome writer change are required. I did not fabricate a provider from the global active setting, which could differ from the parent session.

## Checks and risks

- `npx eslint <10 skill-synthesis files>`: exit 0, 0 errors, 3 warnings. Tail: non-null assertion in the new adapter spec (subsequently removed); existing max-lines warnings for `skill-candidate.store.ts` (1253) and `skill-trigger.service.ts` (857). The two existing files already exceeded the 700-line rule before this batch.
- `npx prettier --check <10 skill-synthesis files>`: `All matched files use Prettier code style!` Host guard specs were formatted after this check.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`: `degradation-audit: TOTAL 296 unsuppressed site(s)`; no FAIL.
- `npx ts-node --transpile-only tools/di-lint/check-injects.ts`: `di-lint OK: 1842 @inject sites all resolve to a registered token (813 tokens)`.
- No Nx or Jest was run (decision #53). The host guard specs and the last small edits were not included in the earlier ESLint/Prettier check, and remain for team-leader verification.
- Query errors propagate to the outcome reader, whose join degrades to unavailable (`libs/backend/lane-outcomes/src/lib/lane-outcome-reader.service.ts:134-143`). The seam reports duplicate run IDs as ambiguous rather than summing metrics.
