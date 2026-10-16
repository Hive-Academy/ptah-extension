# Batch 7 report

## Completion and evidence

| Task | Result | Evidence |
| --- | --- | --- |
| 7.1 | Complete. Pure framing, lane tag and round bounds; approved-root continuation appends to the existing persona framing. Run service delegates. | `tribunal-run-framing.ts:97-118,221-235`; `tribunal-run.service.ts:68,88`; `tribunal-run-framing.spec.ts:8-40` |
| 7.2 | Complete. Pure phase derivation handles missing artifacts and tagged provisional lanes. Progress service retains RPC reads and delegates phase calculation. | `tribunal-phase-derivation.ts:8-16,49-76,79-176`; `tribunal-progress.service.ts:225-249`; `tribunal-phase-derivation.spec.ts:10-32` |
| 7.3 | Complete. Narrow function/type exports and one TS alias. No command-center import into tribunal-panel. | `phase.ts:1-4`; `tsconfig.base.json:33`; `rg` returned no `@ptah-extension/command-center` reference in tribunal-panel. |

The existing run spec pins Council, Forge, Race, Relay and Crucible framing with full-string `toBe` comparisons at `tribunal-run.service.spec.ts:573-604`. It passed after extraction. The new exact Council string at `tribunal-run-framing.spec.ts:17-33` also passed. The progress service spec passed without behavioral edits; its only change is the moved constant import. Existing path output is therefore byte-identical under the pinned fixtures. The root variant is a new path and has a separate test at `tribunal-run-framing.spec.ts:35-40`.

## Verification

Scoped command, with PowerShell `Select-Object -Last 60` replacing `tail -60`:

`npx nx run-many -t test typecheck lint -p @ptah-extension/tribunal-panel --parallel=1 2>&1 | Select-Object -Last 60`

Header: `NX Running targets test, typecheck, lint for project @ptah-extension/tribunal-panel:` (exactly one project).

Result: `NX Successfully ran targets test, typecheck, lint for project @ptah-extension/tribunal-panel`. Lint reported no warnings. The test target included 19 suites. Scoped Ptah diagnostics found no diagnostics in the requested changed source files; it also reported existing errors in sibling specs and core test helpers outside this batch. Nx Cloud emitted a disabled-organization notice after local target success.

The first scoped run found a new test fixture encoding error (`?` for an em dash). I corrected the fixture with `\u2014` and reran the same scoped command successfully.

## Plan-validation risks

| Risk | Handling in this batch |
| --- | --- |
| R1 rewind persona; R2 route ordering; R3 answer tab; R5 new-lib skeleton; R6 spoken filter; R7 status context; R9 large tab/chat files; R11 spike; R12 echo; R13 draw cost; R14 design review; R15 synthesis cost | Owned by the other batches named in Plan validation; this batch changed none of those surfaces. |
| R4 discovery spawns / A1 | Approved-root framing is an additive pure variant (`tribunal-run-framing.ts:112-115`). This batch does not launch or confirm a run. The separate launch and Decline rules remain with Batch 8. |
| R8 host message handling | Pure phase entry and existing progress RPC calls only; no transport or handler provider added. |
| R10 renderer persona | The variant appends an instruction to the existing framing; no global prompt or persona replacement. Schema validation remains with Tasks 1.2 and 2.2. |
| R16 persisted writes | No storage or manifest writes added. Existing spec folder allocation remains in the run service. |

The degradation-audit baseline was not edited; this extraction adds no catch or `.catch(() => undefined)` site.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep RPC artifact reads in the service and pass facts to `derivePhase`. | Move I/O into helper; pure fact input. | Task 7.2 requires pure derivation and the service's `tasks:get`/judge reads at `tribunal-progress.service.ts:251-333`. | Yes |
| Represent provisional tagged work with the existing relay phase shape and the observed lane ID. | New progress kind; existing relay shape. | `TribunalProgress` supports relay lane IDs and a single running index; `tribunal-phase-derivation.spec.ts:15-22`. | Yes |
| Keep the existing run-service launch spec type local. | Move type; keep type. | Current consumers import the service, while `phase.ts` is a narrow entry for functions and their input types. | Yes |

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.ts` (created)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run-framing.spec.ts` (created)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.ts` (created)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-phase-derivation.spec.ts` (created)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts` (import only)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/tribunal-panel/src/phase.ts` (created)
- `D:/projects/ptah-extension/.claude-worktrees/command-center/tsconfig.base.json`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-7-report.md` (created)
