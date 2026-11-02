# Batch 10b report

## Tasks and evidence

- **10b.0:** Audited all explicit `mtime` and `startedAt` fixtures in `lane-completion-notifier.service.spec.ts`. Updated the earlier-run lane assertion to `no-deliverable` and added an explicit verdict assertion to the other stale-file case. See the fixture list below.
- **10b.1:** `verdictOf` requires every declared file to exist, be nonempty, and have `writtenAfterSpawn !== false`. With no fresh complete deliverable, `rateLimited` yields `failed`; the existing classifier maps that to `usage-limit`. A fresh complete deliverable still yields `delivered`. `LaneCompletionContext.rateLimited` is optional and defaults to false. The outcome input gets transient `{ brief: info.task }`; a missing recorder emits one process warning plus a per-run debug line. The pre-existing `cli-agent-runtime` → `lane-outcomes` edge and barrel export of `taskKindForRole` were confirmed in source.
- **10b.2:** Review-kind lanes read up to three declared files, at most 64 KiB each, using `IFileSystemProvider`; paths must remain inside the working directory. The notifier submits their joined text to `recorder.captureReview` after the chat send attempt, or on a delivery refusal. Capture is asynchronous, and failures log only `runId` and an error code. Added a real recorder/pipeline/in-memory-store integration spec for completed exit, failed exit/crash, quota usage limit, timeout, caller stop, continuation dedupe, stale file, exit-0 rate limit, fresh file, optional recorder, review before/after target, replay dedupe, approved/rejected verdicts, and a review without a target. Failure cases assert `failed`, not `delivered`.

## Files touched

- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-terminal-outcomes.integration.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/lane-learning-routing/.ptah/specs/TASK_2026_857_f660/batch-10b-report.md`

## Stale fixtures (10b.0)

- `flags a deliverable left behind by an earlier run`: `mtime = STARTED_AT - 60_000`; added `verdict === 'no-deliverable'`. The existing `writtenAfterSpawn === false` and envelope text assertions remain.
- Session-child test with a parallel lane fixture at `mtime = STARTED_AT - 1`: changed the lane expectation from `delivered` to `no-deliverable` and updated its comment. The session-child expectation was already `no-deliverable`.
- `applies the exported disk check` uses `STARTED_AT - 1` only to assert `writtenAfterSpawn`; it has no lane-verdict expectation. The unparsable-lane-`startedAt` case intentionally retains `delivered` because an absent freshness flag follows the documented compatibility rule.

## Verification

Scoped `ptah_get_diagnostics` after the last source edit: **0 errors, 0 warnings**, clean coverage.

The prescribed project verify ran once. It exited 1 because its test target failed. Its exact filtered tail was:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/cli-agent-runtime

[verify 2026-10-30T20:43:47.784Z] lock slot 0 acquired after 0s: verify lint,test,typecheck (@ptah-extension/cli-agent-runtime)
node.exe :
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

 NX   3 tasks: 2 succeeded, 1 failed
✖ nx run @ptah-extension/cli-agent-runtime:test
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\15038523815929166310
Re-run with --output-style=static to inline logs.
  Run duration:      2m 5s
  Cache:             0/2 hit (0%)
  Critical path:     1m 32s (1 task)
  Recoverable time:  32.9s (26% of the run)

  Recommendations:
    - Increase parallelism to recover up to 32.9s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/HIgkjCY7D4.
[verify 2026-10-30T20:45:57.349Z] lock released after 129.6s, exit code 1
```

The Nx test log showed eight failures: four integration assertions expected `failureKind` in the persisted row although the existing recorder strips it; two review assertions raced asynchronous file capture and incorrectly expected `finalReview: 'revise'` rather than `reviseRounds: 1`; two notifier mocks expected one recorder argument while the new transient brief is a second argument. I changed those assertions and waits. The task's one-run rule prevented a project verify rerun, so post-fix test success is **unconfirmed**. The existing row schema omits `failureKind`; the integration spec now checks it at the recorder input boundary and checks persisted `verdict`/`failureClass` in the store.

The prescribed degradation audit ran once and exited 0. Its exact filtered tail was:

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -t lint -p degradation-audit

[verify 2026-10-30T20:47:37.069Z] waiting for a slot: 2/2 held by pid 9700 [verify lint,test,typecheck (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:47:01.867Z; pid 38924 [verify lint,test,typecheck (agent-sdk,rpc-handlers,codex-runtime)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:47:32.722Z (queue position 1)
[verify 2026-10-30T20:48:37.704Z] waiting for a slot: 2/2 held by pid 9700 [verify lint,test,typecheck (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:47:01.867Z; pid 38924 [verify lint,test,typecheck (agent-sdk,rpc-handlers,codex-runtime)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:47:32.722Z (queue position 1)
[verify 2026-10-30T20:49:38.369Z] waiting for a slot: 2/2 held by pid 9700 [verify lint,test,typecheck (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:47:01.867Z; pid 38924 [verify lint,test,typecheck (agent-sdk,rpc-handlers,codex-runtime)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:47:32.722Z (queue position 1)
[verify 2026-10-30T20:50:38.943Z] waiting for a slot: 2/2 held by pid 9700 [verify lint,test,typecheck (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T20:47:01.867Z; pid 38924 [verify lint,test,typecheck (agent-sdk,rpc-handlers,codex-runtime)] in D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration since 2026-10-30T20:47:32.722Z (queue position 1)
[verify 2026-10-30T20:50:54.086Z] lock slot 0 acquired after 197s: verify lint (degradation-audit)

 NX   1 task: 1 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      7.4s
  Cache:             0/1 hit (0%)
  Critical path:     7.3s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T20:51:07.470Z] lock released after 13.4s, exit code 0
```

## Risks and handoff

- **R4 live defect:** The stale-file path now signals `no-deliverable`; an exit-0 run explicitly marked `rateLimited` with no fresh complete file signals `failed` and records `usage-limit`. Fresh files win. B10c must set `rateLimited` from the bounded current-turn error segments, including the exit-0 429 marker; B10b cannot detect that output on its own.
- **Review capture:** The filesystem read is bounded by count and file size, rejects absolute/escaping paths, and logs metadata only. The real recorder's deterministic `(reviewed run, reviewer run)` report ID handles replays. B11 should consume the terminal row and review evidence without storing text.
- **Scope discrepancy for the spawner:** The plan's verification seam says a persisted row should have `failureKind: null`, but `LaneOutcomeRecorder.recordLaneCompletion` strips `failureKind` before the `LaneOutcomeRecord` is inserted, and the row schema has no such field. Option A (recommended): keep that established schema and assert `failureKind` at the recorder input boundary, as this spec does. Option B: expand the shared row schema/store in a separately authorized batch if durable `failureKind` becomes a product requirement. No out-of-scope file was changed.
- **Verification gate:** Project test target failed on the sole allowed run. The fixes and final placement of review capture have clean TypeScript diagnostics, but the test target needs a later authorized verify run before Batch 10b is marked fully verified.
- **Skill availability:** This lane exposed no native skill invocation or available-skills catalog. No skill was loaded.

## Decisions

| Decision                                                                                                                               | Options                                                      | Evidence                                                                                             | Reversible |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------- |
| Treat a pre-existing nonempty deliverable as `no-deliverable` and downgrade a rate-limited run only when no complete fresh set exists. | Existence-only verdict; freshness with or without downgrade. | Plan Component 10 and decisions.md row 10; session-child precedent.                                  | Yes        |
| Keep `rateLimited` optional and default it to false.                                                                                   | Required context field; optional field.                      | B10b contract and B10c producer is a later batch.                                                    | Yes        |
| Keep review capture independent of chat delivery and begin it after the chat send attempt when possible.                               | Capture before/after send; skip on refusal.                  | Req 7 host observation plus plan fire-and-forget ordering.                                           | Yes        |
| Assert `failureKind` at recorder input instead of changing the row schema.                                                             | Retain current schema; expand schema in another batch.       | Recorder destructures `failureKind` before row insertion; B10b path ownership excludes schema/store. | Yes        |
