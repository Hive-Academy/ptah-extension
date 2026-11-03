# Phase C code logic review — TASK_2026_857_f660

Reviewer: codex lane  
Implementers: Glm lane B12, Claude subagent B20  
Review family: codex  
Score: **6/10**  
Verdict: **REVISE**

## Scope and evidence

Reviewed commits 3d87596ac and e008c1d3c against task-description.md Req 4 and Req 8, implementation-plan.md Components 12 and 19 and D-9, context.md, batch-12-report.md, batch-20-report.md, and decisions.md rows 8 and 17. Read the changed production files, the new B20 specs, relevant B12 tests, the seed builder, and the shared save feedback service. B7 and B14 are outside this verdict. No reviewed source or git state was changed.

The batch reports record passing scoped lint, test, and typecheck for @ptah-extension/lane-routing and @ptah-extension/chat. My scoped ptah_get_diagnostics calls were unavailable because the TypeScript compiler exceeded 45 seconds; I did not independently rerun project verification. ptah_code_search_symbols had an empty index for MINIMUM_SAMPLE_COUNT; read-only git grep found no occurrence under libs or apps. No TODO, FIXME, or stub marker was found in the two main implementation files.

## Numbered findings

1. **Serious — the save toast can contradict its own read-back.** host-routing-setting.component.ts:212-230 determines success solely from the settings:set acknowledgment. It reads the stored flag afterward but never checks that it equals the requested value. settings-save-feedback.service.ts:174-183 then shows “Saved routing suggestions.” and offers Undo. If the host acknowledges a write but a concurrent or lost write leaves the old value, the checkbox shows the old value while the toast claims the new value was saved. Conversely, when settings:set reports failure and the re-read fails, host-routing-setting.component.ts:226-230 reports “The saved setting is unchanged” although persistence is unknown. **Fix:** success requires a read-back equal to the requested value; a failed read is unconfirmed regardless of the set acknowledgment; a mismatched read reports conflict or failure without Undo. Test both cases.

2. **Moderate — the no-model guard can become stale.** host-routing-setting.component.ts:165-171 reads agent:getConfig during reload only; lines 183-196 authorize a write from that cached modelConfigured signal. If the model is unset by the host or another settings session while this row remains mounted, the toggle stays enabled, can write, and can show “on” even though routing cannot run. host-routing-setting.component.spec.ts:152-169 covers only a model unset before mount. **Fix:** refresh or subscribe to model status before accepting a toggle and reject a write if the latest status is unset or unreadable. Test a model change after mount.

3. **Moderate — an earlier Undo is lost if a later save fails.** host-routing-setting.component.ts:193-197 supplies an Undo closure to the shared service. Sequence: save true to false; start a second toggle back to true; press the first toast’s Undo while that second save is in flight; the second save fails. settings-save-feedback.service.ts:191-208 retains the old Undo during the busy period, but its failure path at lines 174-176 replaces the toast with canUndo false. The flag remains false and the offered reversal of the first change disappears. The B20 Undo test (host-routing-setting.component.spec.ts:171-198) does not cover the overlap. **Fix:** keep the earlier Undo through a failed later generic save, or supersede it only after a confirmed later write; test this sequence.

Score 6 rather than 7–8 because B20 can report a confirmed save contradicted by its own read and has two state races. It remains above 5 because the requested B12 blend and normal B20 paths are implemented and exercised. **Counts: 0 Blocking, 1 Serious, 2 Moderate, 0 Minor; 3 failure modes.**

## Blend recomputation

For k = 10, each rate is round((100s + 10p)/(n + 10)); the two-rate result is the rounded mean of the unrounded blended rates. routing-constants.ts:151-157 fixes k, local-derivation.ts:259-269 looks up the exact seed profile and task kind or uses 50, local-derivation.ts:294-323 separates the rates, and local-derivation.ts:330-456 checks safe integers and rounds half away from zero.

| Plan case                               | Independent calculation            |  Result | Spec evidence                |
| --------------------------------------- | ---------------------------------- | ------: | ---------------------------- |
| Seed 80, 1 failed                       | 800/11 = 72.727…                   |      73 | local-derivation.spec.ts:100 |
| Seed 80, 5 failed                       | 800/15 = 53.333…                   |      53 | local-derivation.spec.ts:115 |
| Neutral 50, 1 delivered                 | 600/11 = 54.545…                   |      55 | local-derivation.spec.ts:135 |
| Neutral 50, delivery 5/5 and review 1/1 | mean(1000/15, 600/11) = 60.606…    |      61 | local-derivation.spec.ts:165 |
| Neutral 50, 30 failed                   | 500/40 = 12.5, half away from zero |      13 | local-derivation.spec.ts:183 |
| Both denominators zero                  | no available rate                  | no cell | local-derivation.ts:276-278  |

Delivery counts delivered, no-deliverable and failed; review counts only approved and rejected (local-derivation.ts:173-209). A review-only unverified row creates a review cell (local-derivation.ts:310-313); an unclassified row is excluded (local-derivation.ts:136). sampleCount is the union of contributing run IDs, while asOf is the newest contributing endedAt (local-derivation.ts:282-290,459-479). The schema and reasons compiler accept sampleCount 1 (matrix.schema.ts:37; compile-reasons.ts:224-233). Unsafe arithmetic leaves a cell underived (local-derivation.ts:421-456).

Existing edge: bucketFor has no upper bound on endedAt (local-derivation.ts:137-139), so a future-dated outcome can become the newest asOf and be non-stale by seed-matrix.ts:72-74. This predates B12 and is residual uncertainty, not a counted Phase C finding. A timestamp outside the JavaScript Date range can throw at local-derivation.ts:283; the summary write boundary was outside this review.

## Five logic questions

1. **How does this fail silently?** A set acknowledgment produces a “Saved” toast despite a contrary read-back (Finding 1, host-routing-setting.component.ts:212-230).
2. **What user action produces unexpected behaviour?** Undo during a later in-flight toggle can disappear when that toggle fails (Finding 3, settings-save-feedback.service.ts:174-208).
3. **What input data produces a wrong answer?** A future endedAt gives a future asOf and stale false (local-derivation.ts:137,283; seed-matrix.ts:72-74). A post-write read value unlike the requested value gives incorrect success feedback (Finding 1).
4. **What happens when a dependency fails, times out, or returns a bad shape?** Failed initial reads hide the checkbox and offer Retry; unset plus unreachable is a read failure (host-routing-setting.component.ts:62-112,233-272). Both RPCs use five-second timeouts (lines 20,207-210,236-239,257-259). A failed set followed by a failed read is misclassified as definitely unchanged (Finding 1).
5. **What is missing that the requirements never mentioned?** Live model-status invalidation after reload is absent (host-routing-setting.component.ts:159-174,254-266). There is no destruction or cancellation guard around pending RPCs (lines 129-156,203-230); after destruction, a pending write can still update the detached instance and publish a toast. This is a lifecycle risk, not an additional counted finding.

## Other checked paths

The toggle is mounted only when VSCodeService.isElectron is true, after Lane guards (orchestration-settings.component.ts:66-72,89-95). It uses ClaudeRpcService for every RPC and has no innerHTML binding (host-routing-setting.component.ts:9,48-127). A synchronous saving guard blocks rapid double-toggle writes in one mounted instance (host-routing-setting.component.ts:177-200), and the existing busy test covers one in-flight write (host-routing-setting.component.spec.ts:232-251). The normal Undo restores the previous flag and rereads it (host-routing-setting.component.spec.ts:171-198).

## Decisions

| Decision                                                                             | Options                                    | Evidence                                                                      | Reversible |
| ------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------- | ---------- |
| Both rates at n = 0 produce no local cell; layer precedence leaves a seed available. | Prior-valued local cell / no local cell.   | Req 8, plan table at implementation-plan.md:710, local-derivation.ts:276-278. | Yes        |
| Treat model configuration changes after mount as a live correctness issue.           | Trust initial read / refresh before write. | Req 4 no-model rule; host-routing-setting.component.ts:159-174,183-196.       | Yes        |

## Verdict

**REVISE.** Fix B20’s save confirmation and state races, then add focused tests for divergent read-back, model changes after mount, and Undo during a failed later save. B12’s requested blend behavior matches the recomputed table.
