# Batch 12 report - Prior-blended local cells (TASK_2026_857_f660)

Status: COMPLETE. Task 12.1 done; `npm run verify -- -p @ptah-extension/lane-routing`
passes (lint, test, typecheck; exit 0).

## Task 12.1 - Per-rate blend, prior from the exact seed cell

Evidence per requirement (all line numbers are post-change):

- `BLEND_PRIOR_WEIGHT = 10` is a named export in
  `libs/backend/lane-routing/src/lib/routing-constants.ts:151-156`, with a doc
  comment naming the blend formula. `MINIMUM_SAMPLE_COUNT` is deleted. A repo-wide
  grep confirms no other lib or app imported it (it was never exported through
  the barrel). The existing `assertRoutingConstantInvariants` checks still hold;
  none referenced the deleted constant.
- `cellFrom` (`local-derivation.ts:271-292`) now derives a cell when
  `deliveryTotal > 0 || reviewTotal > 0`; the five-run gate is gone.
- Prior lookup (`priorScore`, `local-derivation.ts:255-269`): the score of the
  seed value cell for the exact `(family, model)` profile match and the same
  task kind, from `buildSeedMatrix(nowMs)` (built once per derivation in
  `profilesFrom`, `local-derivation.ts:224`), else `NEUTRAL_SCORE` 50. The
  family profile (`*`) never matches a seed, so lane-default/auto buckets blend
  with the neutral prior. Purity holds: `buildSeedMatrix` is a pure function of
  `nowMs`; no other clock or I/O enters the module.
- Blend math (`local-derivation.ts:361-420`): one rate blends through
  `roundPercent(100*s + k*prior, 100*(n + k))`; both rates blend through
  `roundMean(100*s1 + k*prior, 100*(n1 + k), 100*s2 + k*prior, 100*(n2 + k))`
  exactly as the plan specifies (implementation-plan.md:688-692). All products
  and sums go through the existing integer-safe helpers (`safeMul`, new
  `safeAdd`); an unsafe product still leaves the cell underived
  (`floorRatio`, `local-derivation.ts:422-438`). Half-away-from-zero rounding is
  the existing `floorRatio`, unchanged.
- Rate definitions are unchanged: delivery `s = delivered`,
  `n = delivered + noDeliverable + failed`; review `s = approved`,
  `n = approved + rejected` (`countSummary`, `local-derivation.ts:173-210`).
  `delivered` never counts toward the review rate.
- Unclassified rows stay excluded: `bucketFor` drops `taskKind === null`
  (`local-derivation.ts:136`); spec case `ignores a null task kind, unverified
delivery and rows outside the window` (Req 2).
- `sampleCount` minimum is 1 in the schema
  (`matrix.schema.ts:41`, `.min(1)`) and in the reasons compiler
  (`compile-reasons.ts:228-241`, message now "an integer of at least 1").
- Header comment (`local-derivation.ts:23-45`) and the `deriveLocalMatrix` doc
  phrase "reached the sample count" were updated to the blend semantics.
- n = 0 (Req 8 quality line): when both rate totals are zero the local layer
  emits no cell (binding table row "Zero denominators"), so resolution falls
  through the store layers (user, local, seed) to the exact seed score, or to
  neutral when no seed exists. `capability-matrix.store.spec.ts` precedence and
  persistence-skip tests pass unchanged.

## Blend table results

Every row of the plan's table (implementation-plan.md:698-710) is a spec case in
`local-derivation.spec.ts`; all pass:

| Case              | Prior                     | Observations                      | Expected | Got     | Test                                                                                                           |
| ----------------- | ------------------------- | --------------------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| Seeded, falling   | 80 (z-ai/glm-5 implement) | 1 failed                          | 73       | 73      | `blends one seeded failure toward the prior 80` (also asserts the full cell, schema-valid at `sampleCount: 1`) |
| Seeded, falling   | 80                        | 5 failed                          | 53       | 53      | `blends five seeded failures toward the prior 80`                                                              |
| Seeded, falling   | 80                        | 50 failed                         | 13       | 13      | `blends fifty seeded failures toward the prior 80`                                                             |
| Neutral, rising   | 50                        | 1 delivered                       | 55       | 55      | `blends one delivered run toward the neutral prior 50`                                                         |
| Neutral, rising   | 50                        | 5 delivered                       | 67       | 67      | `blends five delivered runs toward the neutral prior 50`                                                       |
| Neutral, rising   | 50                        | 100 delivered                     | 95       | 95      | `blends one hundred delivered runs toward the neutral prior 50`                                                |
| Both rates        | 50                        | delivery 5/5, review 1/1 approved | 61       | 61      | `blends both rates before their mean (delivery 5/5, review 1/1)`                                               |
| Exact half        | 50                        | 30 failed                         | 13       | 13      | `rounds an exact half away from zero (neutral prior, thirty failed)`                                           |
| Zero denominators | any                       | only `unverified` rows            | no cell  | no cell | `derives no cell when only unverified rows exist`                                                              |

Extra blend values asserted by the supporting specs (all pass):

- Review-only 5/5 seeded (no delivery verdict): 87.
- Both seeded rates, delivery 4/5 and review 2/5: 73.
- Seeded prior applies only to the seeded kind (plan run on z-ai/glm-5): 45;
  model without a seed profile: 45.
- Pooling: 3 delivered on z-ai/glm-5 -> 85, on codex/glm-5 -> 62, z-ai/glm-5
  plan -> 62 (three cells, two profiles).
- Family profile (`*`), 5 delivered: 67.
- Store level (`capability-matrix.store.spec.ts`): 4 delivered -> local 86
  overrides the seed; 5 delivered -> 87; lane-default 5 delivered -> 67.
- Determinism with shuffled input and duplicate run ids: 5 delivered -> 87,
  identical matrices both orders and on a repeat call.

## Files touched (absolute paths)

Batch 12 file list:

1. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\routing-constants.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\matrix\local-derivation.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\matrix\local-derivation.spec.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\matrix\matrix.schema.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\reasons\compile-reasons.ts`
6. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\reasons\compile-reasons.spec.ts`

Outside the batch list, under the Decisions below (same lib, direct consequence
of this batch's requirement change):

7. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\matrix\seed-matrix.spec.ts`
8. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-routing\src\lib\matrix\capability-matrix.store.spec.ts`

Deliverable:

9. `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-12-report.md`

No other file was touched. The lane-outcomes, vscode-lm-tools and agent-sdk
files shown modified in the worktree belong to other lanes.

## Verification

Command (memory-safe, per batches.md "Run constraints"):

`npm run verify -- -p @ptah-extension/lane-routing`

First run caught two failing store tests (see Decisions); after the fix, final
run at the final tree state (2026-10-30):

```
[verify 2026-10-30T18:38:33.791Z] waiting on queued pid 9616 [verify typecheck
  (ptah-electron,ptah-extension-vscode,ptah-cli)] ... (FIFO lock, expected)
[verify 2026-10-30T18:42:17.510Z] lock slot 1 acquired after 224s: verify
  lint,test,typecheck (@ptah-extension/lane-routing)

 NX   3 tasks: 3 succeeded

  Run duration:      26.3s
  Cache:             0/3 hit (0%)
  Critical path:     17.0s (1 task)
[verify 2026-10-30T18:42:52.492Z] lock released after 35.0s, exit code 0
```

Earlier green run of the same command before the comment-only final edit:
`3 tasks: 3 succeeded`, exit code 0 (18:36-18:38). Full Jest counts from the
first (red) run: 776 tests total in the project; after the fixes the whole
project suite passes (the only two failures were the two store tests below).

Encoding: a byte scan of all eight source files shows no BOM (all start with
ASCII `imp` or `/**`), no mojibake, and the only non-ASCII character is the
pre-existing `§` on `matrix.schema.ts:13`, a line this batch did not touch.

No workspace-wide check was run; no build/serve/dev/e2e/package target was run;
no git command was run.

## Decisions

1. `seed-matrix.spec.ts` - schema-minimum fixture updated (outside batch list).
   - Decision: change the it.each case `a local value below the minimum sample
count` from `sampleCount: 4` to `sampleCount: 0` (one value; case name and
     purpose unchanged).
   - Options: update the value; leave the test red and report it.
   - Evidence: D-9 (implementation-plan.md:1272) fixes the schema minimum at 1,
     so `sampleCount: 4` becomes valid and the case fails; the case exists only
     to pin the old minimum of 5. The file is inside this batch's lib and its
     own verify target, and plan line 696 ("Specs replace the
     `MINIMUM_SAMPLE_COUNT` imports") shows the plan intended spec fixtures that
     pin the old minimum to move with the change. Leaving it red would block the
     batch on a one-token edit.
   - Reversible: yes.
2. `capability-matrix.store.spec.ts` - two tests updated to blend values
   (outside batch list).
   - Decision: `replaces the seed when five local runs qualify (Req 6.6)` becomes
     `replaces the seed with blended local cells (Req 6.6, Req 8)`: the 4-run
     half now asserts a local cell 86 (gate gone), the 5-run half asserts 87
     instead of 100. `puts lane-default outcomes on the family profile` asserts
     67 instead of 100. No structure, harness or other assertion changed.
   - Options: minimal expectation update; leave both red and report.
   - Evidence: the plan called this spec "(unchanged, rerun)"
     (implementation-plan.md:714-716), but both tests assert exactly the removed
     behaviour - the five-run gate (4 runs resolve to the seed) and the raw
     100 saturation (task-description.md:115; decisions.md "remove the
     five-sample cell gate"). The first verify run failed on precisely these
     two tests and nothing else. The new expected values are the plan's own
     blend formula applied to the fixtures (seed prior 80: 1200/14 -> 86,
     1300/15 -> 87; family profile prior 50: 1000/15 -> 67).
   - Reversible: yes.
3. n = 0 reading settled. The binding table row "Zero denominators ... no cell"
   means the local layer emits no cell when both rate totals are zero; "n = 0 ->
   seed score exactly" (batches.md edge case, Req 8) is delivered by layer
   precedence in the store (user, local, seed), not by a local cell that copies
   the prior. Evidence: plan table row is binding; `capability-matrix.store.spec.ts`
   precedence and persistence tests pass unchanged.
4. Prior lookup shape: `buildSeedMatrix(nowMs)` is computed once per
   `deriveLocalMatrix` call (in `profilesFrom`) and the prior is read by exact
   profile match plus task-kind cell. This is what the plan specifies
   (implementation-plan.md:686-688); recorded here because the call site
   (per-derivation vs per-bucket) was left to the implementer.

## Issues outside scope

- None in this batch's own files. Both plan gaps found (the two spec files under
  Decisions) were inside lane-routing and directly caused by this batch; they
  are flagged for the team-leader's review.
- Other lanes hold modified files in lane-outcomes, vscode-lm-tools and
  agent-sdk in this worktree. I did not touch them and my scoped verify did not
  exercise them, so I report no result for them.
- The verify lock waited behind other lanes' checks (agent-sdk, chat, host
  typecheck, lane-outcomes) on the final run; expected FIFO behaviour, no
  action needed.
- No `any`, no `@ts-ignore`, no new Nx edges, no barrel change (B14 owns the
  lane-routing barrel).
