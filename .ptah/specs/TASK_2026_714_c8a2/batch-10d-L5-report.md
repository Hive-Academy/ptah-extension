# Batch 10d.L5 report

## G5a — native Codex lane usage

**Root cause.** The native adapter emits input, output and cache-read usage in `codex-lane-events.ts:193-211`, as the legacy Codex adapter does in `codex-cli.adapter.ts:1277-1297` and the Claude stream loop does in `ptah-cli-stream-loop.service.ts:795-841`. The process manager received the segment but retained it only as output (`agent-process-manager.service.ts:1254-1269`); completion then hard-coded null tokens and cost (`lane-completion-outcome.ts:66-68`, before this change).

**Change.** Keep terminal turn usage only from handles that explicitly declare it as a turn total, clear it at continuation, pass it through completion context, and copy input/output into the outcome. Cost is copied only when reported; otherwise it stays null. The outcome schema has no cache-read field (`lane-outcome.schema.ts:55-58`), so cache-read remains in the output segment and is not written into the outcome row. Other streaming adapters do not opt into outcome usage.

**Specs.** `agent-process-manager.service.spec.ts:1436` checks streamed usage reaches the completion context; `:2063` checks a continuation does not inherit earlier usage. `lane-completion-notifier.service.spec.ts:153` checks the recorded token values and null cost.

## G5b — report receipts

**Root cause / design.** `ptah_agent_report` sends a peer envelope via `sendMessageToSession` and logs delivery in `agent-report-router.service.ts:339-379`. It does not submit a structured outcome report. The outcome report schema accepts only deliverables and review (`lane-outcome.schema.ts:14-33`); the recorder submits those in `lane-outcome-recorder.service.ts:253-305`. SQLite inserts a receipt only after applying such a report to an existing outcome row (`sqlite-lane-outcome.store.ts:146-179`). The zero receipts for two plain delivered agent reports are therefore expected. No code or spec changed for this gap.

## G5c — Electron startup warning

**Root cause status.** The startup exception's message was lost because `start.ts` passed an Error inside metadata, which serialized as `{}` (`vscode-core/logging/logger.ts:20-29`). The exact cause of the throw cannot be proven from that log or the static registration chain. `startLaneOutcomes` eagerly resolves the recorder and pipeline (`lane-outcomes/di/start.ts:75-82`); the recorder resolves store, pipeline and optional classifiers (`lane-outcomes/di/register.ts:76-93`). Electron registers the outcome services and classifier aliases in phase 2 (`phase-2-libraries.ts:293-303`), and SQLite before the old phase-2 start point (`:385`). No missing token in that chain has been identified. A live Electron boot must establish whether the deferred start removes the warning and reveal the original failure if it persists.

**Change.** Electron now starts outcomes after phase 4 registration (`container.ts:47-48`) as a defensive ordering improvement. The non-fatal warning now logs the Error message and stack as serializable strings (`start.ts:203-210`). No startup failure is swallowed differently.

**Specs.** `container.smoke.spec.ts:735-781` checks the startup order and `:783-825` exercises a minimal outcome graph; `lane-outcomes/di/start.spec.ts:150-171` checks that a failed start logs the message and stack while registering a safe disposer.

**Open risk.** The exact old Electron exception was lost in the source log, so the deferred startup fix and warning text need coordinator verification in a live Electron boot. The test and typecheck commands were not run, per task rules.

## Revision 1 — code logic review

**B1 — usage scope.** `agent-process-manager.service.ts:1260-1262` previously copied every streamed usage segment, leaving only the last value. OpenCode emits per-`step_finish` usage (`opencode-cli.adapter.ts:1048-1071`), so a multi-step lane would have an understated plausible row. Copilot emits usage from a session event (`copilot-sdk.adapter.ts:703-731`), Antigravity from a completed agent response step (`antigravity-cli.adapter.ts:1340-1358`), and Claude CLI forwards runner segments (`claude-cli.adapter.ts:254-270`); their lane-total semantics are not established here. Cursor and Pi stream segments (`cursor-cli.adapter.ts:522`, `pi-cli.adapter.ts:546`), but the examined emission paths do not establish a numeric lane total. Legacy Codex emits terminal usage (`codex-cli.adapter.ts:1277-1299`) but retains its prior outcome behavior in this scoped fix. `SdkHandle.outcomeUsageIsTurnTotal` (`cli-adapter.interface.ts:177-178`) explicitly opts a handle in. Only native Codex sets it (`codex-app-server-lane.adapter.ts:541-544`), backed by a single terminal usage segment (`codex-lane-events.ts:150-160`). The manager now accepts usage only from such a handle (`agent-process-manager.service.ts:1260-1262`). The manager spec at `:1436-1473` now models one terminal total; `:1488-1516` emits two step figures without a declaration and asserts no outcome usage. The native adapter spec checks the declaration (`codex-app-server-lane.adapter.spec.ts:214-218`), and the continuation spec declares its test handle (`agent-process-manager.service.spec.ts:2091-2113`). The input context estimate may still use streamed step usage for resume gating; this revision changes only recorded outcome totals.

**S1 — startup cause and behavior.** The outcome start resolves recorder then pipeline (`lane-outcomes/di/start.ts:75-82`); the recorder factory resolves pipeline/store and, if registered, failure and task classifiers (`lane-outcomes/di/register.ts:76-93`). Electron registers these aliases in phase 2 (`phase-2-libraries.ts:293-303`) and SQLite at `:385`, before the former start near the end of phase 2. `container.ts:42-47` shows the new phase order. This does **not** prove the old throw was caused by early start, so the original report's causal claim is withdrawn. `container.smoke.spec.ts:783-825` now resolves the recorder, starts/disposes outcomes and checks for a startup warning against its minimal DI graph; its text-order check remains at `:768-780` because the spec explicitly excludes full `ElectronDIContainer.setup()` and its native dependencies (`:12-17`). Neither test substitutes for a live Electron boot.

**S2 — other hosts.** VS Code registers routing/outcome aliases in phase 2 (`phase-2-libraries.ts:150-157`), SDK services at `:199`, and starts outcomes at `:268`; this host deliberately has no SQLite connection (`:109-119`), so it selects the state-storage outcome store. CLI registers routing and outcome services at `cli-engine/container.ts:767-770`, Thoth/SQLite at `:798`, then starts at `:799`. The suspected Electron ordering cause is unproven, and neither sequence shows the same missing dependency. No VS Code or CLI edit was made; their startup logs remain an open observation for the coordinator.

**M1 — order comment.** `apps/ptah-electron/src/di/container.ts:47` now states why outcome startup follows phase 4. The source-order smoke assertion remains, with the behavioral minimal-container check noted under S1.

**M3 — sibling warnings.** `lane-outcomes/di/start.ts:89-94`, `:133-140`, and `:154-159` now log error message and stack for cleanup, callback registration, and drain failures. `lane-outcomes/di/start.spec.ts:98-148` checks callback registration and cleanup messages; `:199-216` checks the drain warning. These catches remain non-fatal.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\container.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\phase-2-libraries.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\apps\ptah-electron\src\di\container.smoke.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\tracked-agent.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\agent-process-manager.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\cli-adapter.interface.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-notifier.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\lane-completion-outcome.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\lane-outcomes\src\lib\di\start.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\lane-outcomes\src\lib\di\start.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-10d-L5-report.md`

## Line endings

The requested `tr`/`wc` utilities are not available in this PowerShell environment. An equivalent byte scan of every written file found **0 CR bytes and no BOM**:

| Written file | CR bytes |
| --- | ---: |
| `apps/ptah-electron/src/di/container.ts` | 0 |
| `apps/ptah-electron/src/di/phase-2-libraries.ts` | 0 |
| `apps/ptah-electron/src/di/container.smoke.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/tracked-agent.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts` | 0 |
| `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts` | 0 |
| `libs/backend/lane-outcomes/src/lib/di/start.ts` | 0 |
| `libs/backend/lane-outcomes/src/lib/di/start.spec.ts` | 0 |
| `.ptah/specs/TASK_2026_714_c8a2/batch-10d-L5-report.md` | 0 |
