# Code Logic Review — `TASK_2026_494` — Batch 7, round 2

Score: **8/10**  
Verdict: **APPROVED**

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining in this round's scope |

All three production components were read in full. The new regression specs and their fixture wiring were inspected against both round-1 reviews, the fix report, Task 7.1 (`batches.md:358`), and `implementation-plan.md:764-775`. Context, task requirements and the existing style review were also consulted; the latter concerns Batch 2 and contributes no Batch 7 logic finding. No production or spec files were edited and no git commands were run.

Paths below use `C/ = libs/frontend/declarative-dashboard/src/lib/components/` and `S/ = libs/shared/src/mcp-apps-contracts/`. Line numbers are from the current worktree.

The score reflects sound component logic with targeted passing regressions. It is above the 5–6 band because the previously demonstrated failures now have concrete guards and regression coverage. It is below the exemplary band because this verification does not establish renderer/RPC integration behavior, and several timing permutations were traced in source rather than independently added as Angular tests.

## Findings table: original findings and fix-list items

| Finding / item | Ruling | File:line evidence and effect |
| --- | --- | --- |
| F1 — High: consumed text draft commits twice before input refresh | RESOLVED | `C/surface-text-input.component.ts:218` records the current drafts object and id before either output. `:232` blocks fallback to that consumed generation. `C/surface-text-input.component.spec.ts:254` and `:269` exercise Enter→blur and debounce→blur/Enter without refresh, then blur again after refresh. |
| F2 — High: stale local text survives replacement/removal | RESOLVED within the accepted parent contract | `C/surface-text-input.component.ts:123` observes node/drafts; `:241` compares id, path, host value and the corresponding entry on a new drafts object. `:246` clears local text and timer. `:229` repeats the guard at commit time. `C/surface-text-input.component.spec.ts:283`, `:295`, `:306`, `:316` cover host replacement with draft removal, swapped node, external clear and external replacement after actual typing. |
| F3 — Medium: sanitized rendering still validates raw options | RESOLVED | `C/surface-choice-input.component.ts:108` creates a node containing the filtered options. Both error computation (`:131`) and selection (`:153`) use it. This prevents malformed entries from reaching the unchecked `.some` in `S/surface-bindings.ts:229`. The parameterized specs at `C/surface-choice-input.component.spec.ts:189` run for both select and radio-group. |
| Fix 1 — generation consumption without permanent value dedupe | RESOLVED | `C/surface-text-input.component.ts:182` installs every new typed edit; `:230` returns it before the consumed-generation check at `:232`. The marker compares object identity/id, not text value. A subsequent edit to the same string is pinned at `C/surface-text-input.component.spec.ts:264`. |
| Fix 2 — invalidate obsolete local text/timer; preserve unrelated changes | RESOLVED within the stated B8 exclusions | `C/surface-text-input.component.ts:242-244` checks bound identity/value and this draft entry rather than merely observing object replacement. `:247-248` drops stale local state/timer. `:233` uses the current parent's replacement draft. `C/surface-text-input.component.spec.ts:325` preserves the text across an unrelated drafts update. Cleanup of swapped-away parent entries remains the explicitly accepted B8 responsibility. |
| Fix 3 — text regressions for duplicate triggers, invalidation and later edits | RESOLVED | `C/surface-text-input.component.spec.ts:254-278` covers repeated triggers before/after refresh and a later same-value edit; `:283-322` covers actual typing followed by host change, component reuse, external clearing/replacement, blur and timer advancement. |
| Fix 4 — same sanitized options for rendering and both validation paths | RESOLVED | `C/surface-choice-input.component.ts:55`, `:103`, `:108`, `:131`, `:151-154` all derive from the same filtered list. The shared validator's contract is unchanged. |
| Fix 5 — malformed-options selection and non-null validation specs for both kinds | RESOLVED | `C/surface-choice-input.component.spec.ts:202` selects the valid option from `[null, valid]`, asserts the commit and rerenders with the fixture's non-null pending overlay (`:48-50`). `:209-222` checks non-array options with string host, pending and draft values, their validation messages and absence of commits. The new tests do not separately count DOM options; the filtering/render path is directly verified at `C/surface-choice-input.component.ts:103-105` and `:55-56`. |

Fix-list item 6 is excluded. Draft output wiring, helper extraction, host rejection handling, cleanup of swapped-away draft entries and the synchronous-parent-draft-write assumption remain accepted B8 carry-overs, not Batch 7 blockers.

## Five logic questions

### 1. How does this fail silently?

No remaining silent-failure scenario was established within the reviewed component contract. Duplicate commits are suppressed before emission (`C/surface-text-input.component.ts:218`, `:232`), and externally discarded local text cannot override the current displayed draft (`:229-233`, `:241-248`). This conclusion assumes the accepted parent reconciliation contract; it does not claim these components acknowledge host acceptance.

### 2. What user action produces unexpected behaviour?

The previously problematic Enter→blur and debounce→blur sequences now produce one commit, as exercised at `C/surface-text-input.component.spec.ts:254` and `:269`. A legitimate next edit bypasses the consumed marker because `typed` is returned first (`C/surface-text-input.component.ts:180-184`, `:230`). This also holds before the next input round trip by source trace: unchanged node/host plus the same drafts object makes `isStale` false (`:241-244`).

### 3. What input data produces a wrong answer?

The reported malformed choice data no longer throws or changes selection indexing: render, lookup and validation use `options()` (`C/surface-choice-input.component.ts:55`, `:108`, `:120`, `:151-154`). Non-array options yield an empty list, and string selections then produce the normal undeclared-option error (`S/surface-bindings.ts:229-233`). Explicit null, false and empty-string overlays retain precedence because absence is tested against undefined (text `:133-136`, choice `:112-115`, checkbox `:63-66`).

### 4. What happens when a dependency fails?

These components perform no network operation; outputs hand ownership to the parent (text `:219-220`, choice `:155`, checkbox `:96`). Choice/checkbox restore the currently authoritative DOM state when a parent does not apply the output (choice `:161-165`, checkbox `:98`). Local validation prevents invalid commits (text `:216`, choice `:154`, checkbox `:95`). Host timeout/rejection behavior is outside this re-check. The malformed options dependency shape that previously crashed validation is now normalized at choice `:103-108`.

### 5. What is missing that the requirements never mentioned?

No new component-level requirement gap justifies another fix round. The local-buffer/parent relationship is now explicit at `C/surface-text-input.component.ts:100-119` and implemented at `:241-244`. A same-id path-only switch and a fresh second edit before any parent refresh are useful additional regression permutations, but their local guard/precedence behavior is visible in `:242` and `:230`; no defect was demonstrated. Parent cleanup during a binding/surface switch remains the accepted integration responsibility.

## Failure modes

No new or remaining in-scope failure mode was established. Reviewed paths include local typing, first commit before draft propagation, repeated triggers with stale inputs, a later edit to the same value, external removal/replacement, unrelated draft updates, node replacement, choice option normalization, and timer teardown.

Residual uncertainty: this is a component re-check, not renderer reconciliation, RPC failure, browser accessibility or visual verification. An authoritative host/binding replacement must arrive with the parent's reconciled draft state: dropping `typed` alone deliberately does not delete the parent's entry, and fallback still reads it (`C/surface-text-input.component.ts:233`, `:246-248`). This is recorded as the accepted ownership boundary, not a new blocker.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

No new correctness findings. Optional test strengthening described above is not counted as a failure mode or a revision requirement.

## Data flow

1. **OK:** Parent node, drafts, pending values and issues enter as signal inputs (text `:92-96`, choice `:93-97`, checkbox `:53-57`). Each display applies draft → pending → host precedence.
2. **OK:** Text keystrokes capture node identity/host/drafts, emit only a draft write, and restart one timer (text `:180-198`). No commit occurs per keystroke.
3. **OK:** Input updates invalidate obsolete typed state and cancel its timer (text `:123-127`, `:241-248`). Unrelated entry changes preserve the local text because this entry still matches.
4. **OK:** Commit clears the timer, rechecks local freshness, and rejects undefined or invalid drafts (text `:211-216`, `:226-244`).
5. **OK:** A valid draft is marked consumed before notification. A changed value emits inputCommit before draft removal, allowing the parent to install its overlay first (text `:217-220`). Unchanged valid drafts only remove the draft.
6. **OK:** Later same-generation fallback is blocked; new typed edits take priority and a new parent drafts object is independently eligible (text `:230-233`).
7. **OK:** Choice normalizes options before every validation/selection path (choice `:103-108`, `:131`, `:150-157`). Checkbox validates its boolean then restores controlled DOM state (checkbox `:92-98`).
8. **OK:** Text destroy clears the sole outstanding timeout; restarts, commit attempts and stale-state invalidation also clear it (text `:122`, `:193-203`, `:212`, `:248`). The constructor-created Angular effect has no manual-cleanup override (`:123`).

## Requirements fulfilment

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| Text drafts per keystroke; blur/Enter/600 ms commits | COMPLETE for B7 | Text `:72`, `:78`, `:180-198`; parent draft wiring remains B8. |
| Valid changed values only; commit precedes draft removal | COMPLETE | Text `:216-220`; choice `:154`; checkbox `:95`. |
| One timer, cleared on commit and destroy | COMPLETE | Text `:99`, `:122`, `:193-203`, `:212`. |
| No duplicate consumed draft / no stale local resurrection | COMPLETE within accepted parent contract | Text `:218`, `:229-244`; F1/F2 specs above. |
| Choice empty option, radio group, checkbox change | COMPLETE | Choice `:54`, `:62-74`, `:150-155`; checkbox `:35-38`, `:92-98`. |
| Labels, error descriptions, required/invalid and focus keys | COMPLETE at template level | Text `:64-83`; choice `:47-84`; checkbox `:34-45`. No new browser/screen-reader audit. |
| Safe malformed choice options | COMPLETE | Choice `:103-108`, `:131`, `:153`; F3 specs above. |

Implicit requirements not addressed in B7: only the explicitly accepted B8 integration responsibilities; no newly discovered obligation.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| First commit before initial draft round trip | YES | Same input-object generation does not stale typed text; typed wins (`text :230`, `:244`). | Source trace; no newly added dedicated test. |
| Enter then blur / idle then blur before refresh | YES | Consumed-generation marker (`text :218`, `:232`); specs `:254`, `:269`. | None found. |
| Fresh edit to same string | YES | New typed state bypasses marker (`text :182`, `:230`); spec `:264`. | None found. |
| Unrelated drafts/node metadata update | YES | Id/path/host and matching entry remain valid (`text :242-244`); draft update spec `:325`. | Accepted synchronous-parent assumption. |
| Host replacement plus cleared draft | YES | Local invalidation, no fallback entry; spec `:283`. | Parent owns authoritative reconciliation. |
| External draft clear/replacement | YES | Timer canceled; current replacement used on blur (`text :233`, `:248`); specs `:306`, `:316`. | None found. |
| Destroy with active timer | YES | DestroyRef callback (`text :122`). | No new timer source introduced. |
| Invalid / oversized text | YES | Validation before consume/output (`text :216`; `S/surface-bindings.ts:208-215`). | Invalid draft retained. |
| Malformed choice array / non-array | YES | Filtered node used in both validation paths (`choice :108`, `:131`, `:153`). | No shared-validator widening. |

## Verification

- Ran once: `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts --runInBand`.
- Result: **3 suites passed, 51 tests passed, exit 0**. Only the tail was collected. PowerShell wrapped Jest stderr in a NativeCommandError display, but the process exit and Jest test summary both show success.
- Scoped `ptah_get_diagnostics` reported three TS4029 errors outside the reviewed input files: `C/dashboard-list.component.ts:81`, `C/dashboard-stat.component.ts:42`, `C/dashboard-table.component.ts:95` (exported node properties reference unnameable `DisplayNodeFields`). No diagnostic was reported against these input components. This is not a clean project-wide typecheck claim and the unrelated errors were not classified as Batch 7 regressions.
- `ptah_search_files` found no AGENTS.md or CLAUDE.md in the workspace; applicable ancestor AGENTS.md paths checked were absent. No Ptah body-read/Write tool was available, so native reads and the native patch tool were used.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for the three component fixes; renderer integration not assessed.
- Top risk: the parent must honor the accepted draft reconciliation and output-ordering contract (`C/surface-text-input.component.ts:219-220`, `:233`, `:244`).
- What a robust implementation would add: optional dedicated no-round-trip/path-only timing tests plus the already assigned B8 integration coverage; no additional B7 source correction is required by the evidence.

One-line summary: **APPROVED, 8/10 — F1–F3 and fix items 1–5 resolved; no new in-scope correctness defect; 51 targeted tests passed.**
