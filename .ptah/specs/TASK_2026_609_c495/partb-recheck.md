# Part B Re-check — fix round

Verdict: APPROVED WITH NOTES
Score: 9/10

Reviewed committed content only: `603808f5c`, `1fa2b6cc8`, `7dca3b7cc`. No source changes or test runs. Regression sensitivity below is established by code inspection, not an executed revert/mutation test; guard tests assume the corresponding API-name adaptation when comparing old behavior.

Paths below use these prefixes:
- H = `libs/backend/harness-sync/src/lib/targets/`
- Q = `libs/backend/agent-generation/src/lib/services/user-layer/`
- U = `libs/frontend/skill-synthesis-ui/src/lib/components/clones/`

| Finding | Status | Evidence |
| --- | --- | --- |
| Backend #1 — Blocking: edit saved between planning/snapshot and replacement is lost | FIXED | H`workspace-target.ts:933` detaches every owned update regardless of planned drift; H`artifact-retirement.ts:226` moves the live object into history; H`workspace-target.ts:1013` publishes the agent with `wx`. A new live file survives as a reported conflict, and earlier edited bytes remain in history. H`workspace-target.overwrite-detach.spec.ts:217` and `:244` would fail without the fix: respectively the conflict/history assertions and the late-edit snapshot assertion. The first test injects after the new detach seam, rather than replaying the old snapshot seam. |
| Backend #2 — Serious: Restore cleanup unlinks another writer's replacement | FIXED | Q`user-layer-seed-quarantine.ts:915` and `:922` retain failed/mismatching published destinations as conflicts; `:1066` returns fallback failure without explicit destination cleanup. An atomic editor replacement after linking is retained. Q`user-layer-seed-quarantine.spec.ts:1415` and `:1437` cover replacement-after-link and fallback failure; both would fail against the old unlink behavior. |
| Backend #3 — Serious: model change hides edits and skips history | FIXED | H`workspace-target.ts:530` determines drift from actual versus owned output independently of source/model changes; `:933` protects the actual bytes during apply. H`workspace-target.overwrite-detach.spec.ts:189` would fail without the fix on local-edit/history assertions. The untouched-copy control at `:203` should also pass before the fix, as intended. |
| Frontend #1 — Serious: destruction during health read authorizes save or strands modal | FIXED | U`reconcile-guard.ts:312` rejects a late health reply after destruction; `:337` marks destruction and settles an open modal. U`agent-model-editor.component.ts:696` and `:758` stop the editor chain after teardown. U`reconcile-guard.spec.ts:428`, `:438` and U`agent-model-editor.component.spec.ts:533` would fail without the fix: no-edit auto-approval would mutate, and edited health would leave an unresolved modal. |
| Frontend #2 — Serious: late workspace-A save or older load overwrites current models | FIXED | U`agent-models.store.ts:137` checks host identity and epoch; `:160` rejects superseded loads; `:192` rejects mismatched saves and increments revision. U`agent-model-editor.component.ts:724` drops stale save replies; `:475` drops drafts on workspace changes. U`agent-model-editor.component.spec.ts:557`, `:591`, `:604` would fail without the fix for delayed A replies after switching to B, retained drafts, and pre-save loads restoring older values. |
| Frontend #3 — Moderate: successful model save silently skips required reconcile | FIXED | U`agent-model-editor.component.ts:775` detects an already-running pass and retains a sync-failed notice with Sync retry. There is no await between this check and entering reconcile, whose busy check is synchronous. U`agent-model-editor.component.spec.ts:648` would fail without the fix because the skipped pass previously cleared the notice. |
| Frontend #4 — Moderate: per-file write failures announced as successful sync | FIXED | U`agent-model-editor.component.ts:802` and U`quarantined-agents-panel.component.ts:497` inspect writeFailed entries and retain failure/retry messaging. A returned EACCES report now names the path/reason rather than claiming completion. U`agent-model-editor.component.spec.ts:678` and U`quarantined-agents-panel.component.spec.ts:411`, `:497` would fail without the fix on model-save, Restore and Finish restore notices. |
| Frontend #5 — Moderate: health recovery turns unverified into Cancel and discards draft | FIXED | U`reconcile-guard.ts:372` derives dismissal from this invocation's modal state, returning unverified even after a health push; U`agent-model-editor.component.ts:697` retains the draft and Retry. U`agent-model-editor.component.spec.ts:623` would fail without the fix when a valid healthChanged push arrives before Close; U`reconcile-guard.spec.ts:396` also asserts the stable outcome. |

B-FIX-1 trade-off: acceptable. When history is unwritable, H`artifact-retirement.ts:212` fails before detaching; H`workspace-target.ts:940` reports writeFailed without replacing the untouched copy or advancing its ownership record. Retrying a later pass preserves safety at the cost of update availability. The rename-failure regression at H`workspace-target.overwrite-detach.spec.ts:263` covers retained bytes/ownership; the exact untouched-copy plus unwritable-history combination has no dedicated new regression.

The setup-wizard changes in `7dca3b7cc` alter warning presentation only. No behavioral defect found in that diff; visual contrast ratios were not independently measured in this logic review. Backend #4, frontend #6 and accepted FU-5 were excluded as requested.

## New findings

None.