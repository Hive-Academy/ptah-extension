# Batch 18 report: Harvest result contract and skills UI

Implementer: frontend-developer subagent (claude family). Paths are relative to the worktree root.

## Files changed

- MODIFIED `libs/shared/src/lib/types/rpc.types.ts`: `SkillSynthesisHarvestSpecsResult` gains `pending?: number; skippedFolders?: number` (`:2844`, `:2846`). Nothing else in that file changed.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`: adds `SKILLS_HARVEST_FAILED_MESSAGE`, `SkillsHarvestOutcome`, and the `harvesting`, `lastHarvest` and `harvestError` signals, and rewrites `harvestSpecs`.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts`: the harvest mock now returns real counts. 3 new cases.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts`: busy label, waiting-to-harvest count, result status line, error alert, how-it-works.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.spec.ts`: the mount stub gains the new signals. 6 new cases.
- MODIFIED `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts`: this file is outside the batch's file list. Its state stub only gains `harvesting`, `harvestError` and `lastHarvest`. That stub renders the real `ptah-skill-specs-control`, so without them 4 tab cases failed with `ctx.harvesting is not a function`.

## Acceptance criteria evidence

Task 18.1: the two optional fields are at `rpc.types.ts:2844-2846`. The backend `HarvestResult` (`spec-harvester.service.ts:67-78`) already returns both, and `skill-synthesis-rpc.service.ts:487-497` passes `result.data` through unchanged.

Task 18.2:
- The `harvesting`, `lastHarvest` and `harvestError` signals are at `skill-synthesis-state.service.ts:48-52`.
- `lastHarvest` is set (`:275`) before `refreshSpecs` runs (`:294`). The spec asserts this from inside the `listSpecs` mock.
- `refreshSpecs` touches neither signal.
- Every failure sets `SKILLS_HARVEST_FAILED_MESSAGE`, `Harvest failed. See the logs for details.` (`:19`). No raw text is shown.

Task 18.3 (`skill-specs-control.component.ts`):
- While a harvest runs, the button shows `Harvesting…` with a spinner, and sets `aria-busy` (`:33`).
- The status line has `data-testid="skills-harvest-result"` and `role="status"` (`:46`). It reads either:
  - `Last run <shortTime>: N tasks scanned, N harvested, N skill runs reconciled`, or
  - `Nothing new to harvest (N tasks scanned, N skill runs reconciled)` when `harvested` is 0 (`:83`).
  - Either form can end with `. N folders skipped (no task.md)` (`:86`).
- A failure shows as `role="alert"` (`:43`).
- The pending count comes from `specs()` with status `complete-unharvested` (`:72`). It appears in the counts line as `N waiting to harvest`.
- The how-it-works text is verbatim (`:50`), inside a "How this works" `<details>`.

## Tests added

- State spec:
  - counts are stored before the refresh, `harvesting` is true during it, and `lastHarvest` survives a later `refreshSpecs`
  - a failure gives the fixed sentence, raw text is absent, the flags are cleared, and the error survives `refreshSpecs`
  - a later successful harvest clears the error
- Control spec:
  - `Harvesting…` with a spinner, `aria-busy` and the disabled state
  - the exact counts line with `role="status"`
  - `Nothing new to harvest` with the skipped-folders suffix
  - the `role="alert"` failure
  - the waiting-to-harvest count
  - the verbatim how-it-works text

## Verify

Command, run from the worktree root with `TMPDIR=/var/tmp/b878`:
`npm run verify -- -p @ptah-extension/shared,@ptah-extension/skill-synthesis-ui,ptah-electron,ptah-extension-webview` (N=4)

**First run:**
- Lint and typecheck: `NX 8 tasks: 7 succeeded, 1 cached, 1 failed`. The failure is `✖ ptah-extension-webview:lint`, which is pre-existing.
- Test: `NX 10 tasks: 8 succeeded, 1 cached, 2 failed`.
  - `skill-synthesis-ui:test` failed in 6 cases. Two had a time-format mismatch: Angular `shortTime` uses U+202F before AM/PM, and the spec normalized whitespace on only one side. Four failed on the tab-spec stub described above. Both are now fixed.
  - `ptah-electron:test`: every suite failed to compile on `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:723`, `workspaceFingerprint` `string | undefined` not assignable to `IndexingFailedEvent`. That backend file belongs to the peer subagent and was being edited at the time. I did not touch it.

**Re-run:**
- Lint and typecheck: `NX 8 tasks: 7 succeeded, 3 cached, 1 failed`. The only failure is `✖ nx run ptah-extension-webview:lint`, the known pre-existing "Static imports of lazy-loaded libraries are forbidden" errors in unchanged app files.
- Test: `NX 10 tasks: 10 succeeded, 2 cached`. That includes `ptah-electron:test`, which passed once the peer's backend edit compiled.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Add a `harvesting` signal | reuse `specsLoading` / new signal | `specsLoading` is also true for refresh and clear-stale, so it cannot drive a `Harvesting…` label | yes |
| A failed harvest sets `lastHarvest` to `null` | keep the previous result / clear it | A "Last run" line next to a failure alert would describe a run that is no longer the last one. The rule "not cleared by `refreshSpecs`" still holds | yes |
| A harvest failure no longer writes raw text into `state.error` | keep / drop | `SkillSynthesisStateService.error` is not rendered anywhere (grep), and the brief forbids raw text. `harvestError` now carries the fixed sentence | yes |
| When nothing is harvested, the line still shows the scanned and reconciled counts | bare "Nothing new to harvest" / with counts | Reconcile runs for every finished spec regardless of marker (Batch 16), so reconciled can be above 0 when harvested is 0. Hiding it would not be honest | yes |
| Time uses `formatDate(at, 'shortTime', LOCALE_ID)` | relative clock / absolute time | Needs no wall-clock timer and no per-instance subscription | yes |

## Proposed removals

None.
