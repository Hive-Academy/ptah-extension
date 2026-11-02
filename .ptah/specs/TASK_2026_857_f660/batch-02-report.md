# Batch 2 report

## Tasks and evidence

- **2.1:** `LaneOutcomeRowSchema` accepts the four `OUTCOME_TASK_KIND_SOURCES` values, preserves `null`, and defaults a missing field to `null` for legacy rows. The review report branch accepts a bounded optional `reviewerRunId`. `LaneCompletionOutcomeInput` omits the provenance field, so existing callers do not supply it. The recorder sets `explicit` when a lane input has a task kind, `unclassified` otherwise and for subagent stops.
- **2.2:** Added `taskKindSource: null` to the four legacy-shaped fixture literals; spread-based fixtures inherit it.

## Files touched

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-recorder.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\store.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\agent-signals.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\lane-outcome-reader.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\subagent-join.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-02-report.md`

## Risks

- **R1:** Verification was scoped to the three Batch 2 projects. One test failed in `vscode-lm-tools`, outside the Batch 2 file list. Its property-list expectation must be updated by the later owner; no outside-scope edit was made.
- **R3:** All four assigned fixture literals now carry the field. The shared contract remains optional until the Batch 11 required-field flip, when its broader literal census and host checks run.
- **R7:** The recorder change is limited to its input `Omit` and the two row constructors. The Batch 7 rewrite can replace the interim source resolution in place.

## Verification

- `ptah_get_diagnostics` scoped to six changed TypeScript files: **0 errors, 0 warnings**; clean coverage.
- `npm run verify -- -p @ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools 2>&1 | Select-Object -Last 40`: **exit 1**. PowerShell has no `tail`, so `Select-Object -Last 40` is the equivalent filter. Nx reported **8 succeeded, 1 failed**. No additional host typecheck was listed for B2.

Selected command-tail lines (queue-holder paths abbreviated):

```text
[verify 2026-10-30T18:06:53.436Z] waiting on queued pid 11480 [verify lint,test,typecheck (@ptah-extension/agent-sdk,@ptah-extension/skill-synthesis)]
[verify 2026-10-30T18:07:54.287Z] waiting on queued pid 11480 [verify lint,test,typecheck (@ptah-extension/agent-sdk,@ptah-extension/skill-synthesis)]
[verify 2026-10-30T18:08:55.077Z] waiting on queued pid 11480 [verify lint,test,typecheck (@ptah-extension/agent-sdk,@ptah-extension/skill-synthesis)]
[verify 2026-10-30T18:09:03.152Z] waiting for a slot: 2/2 held (queue position 1)
[verify 2026-10-30T18:10:03.863Z] waiting for a slot: 2/2 held (queue position 1)
[verify 2026-10-30T18:10:21.075Z] waiting for memory: 7.2 GB free, a second run needs 8.0 GB
[verify 2026-10-30T18:10:22.089Z] lock slot 0 acquired after 209s: verify lint,test,typecheck (@ptah-extension/lane-outcomes,@ptah-extension/cli-agent-runtime,@ptah-extension/vscode-lm-tools)
NX   9 tasks: 8 succeeded, 1 failed
✖ nx run @ptah-extension/vscode-lm-tools:test
full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\5382706156613535101
Run duration: 7m 42s
[verify 2026-10-30T18:18:11.818Z] lock released after 469.7s, exit code 1
VERIFY_EXIT_CODE=1
```

The failed task log reports **99 passed suites, 1 failed suite; 3297 passed tests, 1 failed test**. Failure: `outcome-report.tool.spec.ts:144` expects the published property keys without `reviewerRunId`; the new optional schema key appears in the actual keys. The test file is assigned to Batch 11 (`batches.md:587`).

## Decisions

- **Fixture provenance:** Use `null` for existing fixtures, including the fixture with `taskKind: 'implement'`. Options were `null` (legacy-shaped) or `explicit` (new provenance assertion). The plan explicitly prescribes `null` for legacy fixtures and Batch 2 makes no behavior assertions about provenance. Reversible: yes.
- **Interim lane provenance:** Presence of `input.taskKind` means `explicit`; absence means `unclassified`. The plan specifies this exact temporary rule; Batch 7 will add mapping and classification. Reversible: yes.

## Issues outside scope

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tools\outcome-report.tool.spec.ts:144` expects the old report schema properties. Batch 11 owns this file. It was not edited here.
- No invocable skill mechanism was exposed to this lane; the available harness skill search only inventories plugins and marketplace entries.
