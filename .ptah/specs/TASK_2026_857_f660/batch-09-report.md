# Batch 9 report

## Task 9.1 — outcome DI, subscription, and barrel

- Added optional `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` (`Symbol.for`). The recorder factory resolves `LaneTaskKindClassifier` only when registered and passes it as constructor argument 5.
- Added `observeSubagentEnded?: boolean` to both start helpers. When true and `SDK_TOKENS.SDK_ADAPTER_EVENTS` is registered, startup subscribes `recorder.recordSubagentEnded` through `SdkAdapterEvents.onSubagentEnded`; the returned unsubscribe joins normal disposal and partial-start cleanup.
- Exported `taskKindForRole`, `reportedSubagentStopRow`, `parseReviewDeliverable`, `deterministicReviewReportId`, and `LaneCompletionTransient` from the lane-outcomes barrel. `LANE_OUTCOME_TOKENS` already exports the new token.
- `di/start.spec.ts` proves opt-in subscription, forwarding, one unsubscribe on dispose, and default no-subscription. Existing partial-start cleanup remains covered.

## Task 9.2 — subagent stop integration

Created `subagent-stop.integration.spec.ts` with the real `SubagentStopCallbackRegistry`, `SdkAdapterEvents`, recorder, pipeline, and in-memory store. The DI fixture registers no task-kind classifier. Hook-first and event-first delivery for the same agent, with null hook session, parent, workspace and transcript metadata, each produces exactly one row. The row remains `unclassified` with `telemetryJoin: 'unavailable'`; the SDK event fills missing parent and workspace fields. Additional cases prove a held deliverables report joins the row and a review stop updates its named target, while a message without a target leaves that row unchanged. Listener cleanup is asserted.

## Files touched (absolute)

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/di/tokens.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/di/register.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/di/start.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/di/start.spec.ts`
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/index.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/lane-outcomes/src/lib/subagent-stop.integration.spec.ts`
- CREATED `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-09-report.md`

## Verification

No skill discovery mechanism or matching backend skill was exposed to this lane; repository instructions and Batch 9 handoffs governed the work.

`ptah_get_diagnostics` on the six changed source files: TypeScript compiler, clean coverage, 0 errors, 0 warnings. UTF-8 inspection found no `â€` mojibake. Both requested verification commands ran once in the foreground. PowerShell has no `tail` executable here, so `Select-Object -Last 40` and `Select-Object -Last 20` provided the same output filtering. Exact filtered tails (blank lines omitted):

`npm run verify -- -p @ptah-extension/lane-outcomes 2>&1 | Select-Object -Last 40`:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/lane-outcomes
[verify 2026-10-30T20:32:00.463Z] waiting for a slot: 2/2 held by pid 2720 [verify test (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:31:58.650Z; pid 30936 [verify lint,test,typecheck (agent-sdk,rpc-handlers,codex-runtime,cli-agent-runtime,gateway-chat-bridge,cli-engine,ptah-electron,@ptah-extension/shared,@ptah-extension/chat,@ptah-extension/session-organization)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:06:33.346Z (queue position 2)
[verify 2026-10-30T20:32:19.674Z] waiting on queued pid 23856 [verify test (@ptah-extension/canvas,@ptah-extension/workspace-indexing)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:30:53.504Z
[verify 2026-10-30T20:32:20.690Z] waiting for the newest run to settle before memory is measured (held by pid 23856 [verify test (@ptah-extension/canvas,@ptah-extension/workspace-indexing)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:32:20.645Z)
[verify 2026-10-30T20:32:51.029Z] lock slot 1 acquired after 51s: verify lint,test,typecheck (@ptah-extension/lane-outcomes)
 NX   3 tasks: 3 succeeded
Re-run with --output-style=static to inline logs.
  Run duration:      53.8s
  Cache:             0/3 hit (0%)
  Critical path:     34.9s (1 task)
  Recoverable time:  18.9s (35% of the run)
  Recommendations:
    - Increase parallelism to recover up to 18.9s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/8MEeJkN2N2.
[verify 2026-10-30T20:33:52.138Z] lock released after 61.1s, exit code 0
```

`npm run verify -- -t lint -p degradation-audit 2>&1 | Select-Object -Last 20`:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -t lint -p degradation-audit
[verify 2026-10-30T20:34:00.273Z] waiting for a slot: 2/2 held by pid 32068 [verify typecheck (ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:33:21.816Z; pid 23976 [verify test (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:33:52.886Z (queue position 1)
[verify 2026-10-30T20:34:18.497Z] lock slot 1 acquired after 18s: verify lint (degradation-audit)
 NX   1 task: 1 succeeded
Re-run with --output-style=static to inline logs.
  Run duration:      8.2s
  Cache:             0/1 hit (0%)
  Critical path:     8.1s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T20:34:33.029Z] lock released after 14.5s, exit code 0
```

## Risks and handling

- **Two producers and incomplete metadata:** both orders produce one row; the later producer fills only missing join fields.
- **Optional classifier:** the DI fixture omits `TASK_KIND_CLASSIFIER`; tests prove the recorder still writes an `unclassified` row.
- **Listener lifetime:** the SDK unsubscribe is in `unsubs`; specs cover normal disposal and the existing partial-start cleanup path.
- **Privacy:** SDK message text is transient. No prompt, brief, deliverable or CLI output text was added to a row, journal or log.
- **Dependency and host scope:** `di/start.ts` already imported the `@ptah-extension/agent-sdk` barrel, which exports `SdkAdapterEvents`; no new library edge or host file was added. Host checks were outside the two explicitly requested verification commands.

## Decisions

| Decision                                                       | Options                     | Evidence                                                                                           | Reversible |
| -------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- | ---------- |
| Keep SDK event observation opt-in and pass the option through. | Always subscribe; opt-in.   | `implementation-plan.md:473-500` specifies `observeSubagentEnded?: boolean`.                       | Yes        |
| Keep `onLaneRecordInserted` unchanged.                         | Rename; keep name.          | The batch makes the rename optional; the pipeline file is outside Batch 9 ownership.               | Yes        |
| Use the existing agent-sdk barrel.                             | Deep import; barrel import. | `agent-sdk/src/index.ts` exports `SdkAdapterEvents`, and `di/start.ts` already imports the barrel. | Yes        |
