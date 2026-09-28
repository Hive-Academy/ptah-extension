# Code Style Review — `TASK_2026_563_2939`, Batch 5

## Summary

| Metric          | Value                       |
| --------------- | --------------------------- |
| Overall score   | 8/10                        |
| Assessment      | APPROVED                    |
| Blocking issues | 0                           |
| Serious issues  | 0                           |
| Minor issues    | 2                           |
| Files reviewed  | 5 batch files, read in full |

Scope: `merge-candidate-collector.ts`, its spec, `memory-curator.service.ts`, its spec, and `di/register.spec.ts`. Paths below are relative to `libs/backend/memory-curator/src/lib/` unless explicitly rooted elsewhere. All reads and this artifact are confined to `D:\projects\ptah-extension-memory-quality-source`.

The implementation fits the agreed service-owned collaborator pattern: construction is beside `CuratorWindowRunner` at `memory-curator.service.ts:206`, collection has its own bounded concern at `curator-llm/merge-candidate-collector.ts:62`, and the guard remains a small service method at `memory-curator.service.ts:774`. This is sound 7–8-band structure, rather than the 5–6 band with material structural gaps. Two misleading comments and the service's existing constructor/navigation burden keep it below the exemplary 9–10 band.

Inputs examined: `CONVENTIONS.md`, task `context.md`, Batch 5 in `batches.md:373`, and component 7 in `implementation-plan.md:654`. Root `CLAUDE.md`, `AGENTS.md`, and `HANDOFF.md` are absent in this worktree; no directory-level files of those first two names or `CONVENTIONS.md` were found under `libs`. Comparisons: `curator-window-runner.ts` and `curator-pass-admission.ts`, plus existing spec sections in the two modified suites. Other batches' implementations are not reviewed here.

Verification: read the full five files and the scoped `git diff HEAD`; reviewed the complete barrel only to check collector visibility. No unrelated hunks appear in the three modified Batch 5 files: the changes comprise imports, collector wiring/diagnostics, the guard, and corresponding tests (`memory-curator.service.ts:42`, `:203`, `:619`, `:774`; `memory-curator.service.spec.ts:1923`; `di/register.spec.ts:207`). The two new collector files were read directly because untracked additions are absent from `git diff HEAD`.

`ptah_get_diagnostics` was requested with absolute paths to the two production files. It returned **Unavailable: None of the requested files are inside the workspace root**. No diagnostic pass is claimed. No build, lint, or test suite was run in this read-only structural review, and no current Batch 5 execution report was available among the task artifacts inspected. Runtime and dual-driver verification remain separate gates.

## Five style questions

### 1. What breaks in six months?

Changing collection policy is localized: the four named limits and finite skip-reason union live at `curator-llm/merge-candidate-collector.ts:20` and `:35`; D4=B is explicit at `:90`. The main maintenance risk is constructor growth: search is the eleventh positional parameter at `memory-curator.service.ts:204`, and the new test builder must spell out the optional slots at `memory-curator.service.spec.ts:2000`. Appending it preserves the agreed compatibility contract (`implementation-plan.md:701`), so replacing that constructor is not required in this batch.

### 2. What would a new team member misread?

The skip-reason comment says tier 2 contributed nothing, although an error can preserve partial results (`curator-llm/merge-candidate-collector.ts:34`, `:145`, `:151`). The governor comment still says LAST even though search follows (`memory-curator.service.ts:193`, `:204`). Findings 1 and 2 address those documentation contradictions without changing the agreed field names or constructor order.

### 3. What does this cost to maintain?

There is one focused collaborator and one private guard method, with no additional token, public barrel export, or runtime option (`curator-llm/merge-candidate-collector.ts:50`; `memory-curator.service.ts:209`, `:774`; `libs/backend/memory-curator/src/index.ts:95`). The service remains large, but the collector already removes the candidate-search concern from its pipeline (`memory-curator.service.ts:619`). A further split solely to meet a physical line count would add indirection without an evidenced second responsibility in the new guard.

### 4. Where is this inconsistent with the rest of the repository?

No material pattern inconsistency was found in scope. Constructor-owned helpers match `curator-window-runner.ts:69` and `curator-pass-admission.ts:79`. Type-only Logger reuse matches those existing collaborators (`curator-window-runner.ts:12`; `curator-pass-admission.ts:51`) and adds no runtime import from vscode-core in the collector (`merge-candidate-collector.ts:14`). The existing library's platform coupling remains; this batch creates no new backend library or platform adapter dependency.

### 5. What would you have done differently?

Correct the two comments to describe actual results and positional compatibility. Keep the collaborator, finite result shape, and local private guard: they express the agreed responsibilities without a strategy interface or configuration used by only one implementation (`merge-candidate-collector.ts:41`, `:50`; `memory-curator.service.ts:774`). The new integration-style describe block has its own fixture lifecycle (`memory-curator.service.spec.ts:1935`, `:1954`), so moving it purely because the suite is long would not improve this batch's organization.

## Blocking issues

None found within the reviewed scope.

## Serious issues

None found within the reviewed scope.

## Minor issues

### 1. Skip-reason documentation promises an empty contribution

- Severity: Minor.
- File: `curator-llm/merge-candidate-collector.ts:34`.
- Problem: “contributed nothing by design” does not describe the `'error'` arm. The collector retains previously collected rows, and `null` also occurs on abort or ordinary exhaustion, not only when a bound is reached (`:103`, `:145`, `:151`).
- Impact: A maintainer interpreting diagnostics could mistake a partial tier-2 result for zero enrichment or infer completion from `null`.
- Recommendation: Describe this as the reason tier 2 was skipped or stopped by a search error; explicitly permit partial candidates and avoid claiming `null` proves the bounds were reached. Preserve the agreed union and field name.

### 2. Governor's LAST comment became stale

- Severity: Minor.
- File: `memory-curator.service.ts:193`.
- Problem: The existing parameter comment says “Optional and LAST,” while the new search parameter follows at `:204`.
- Impact: Future edits to this positional API receive contradictory placement guidance immediately above the constructor parameters.
- Recommendation: Say that the governor's position is retained for existing callers and new optional dependencies are appended. Keep the implemented parameter order.

## File-by-file

### `curator-llm/merge-candidate-collector.ts`

Score 8/10 — 0 B, 0 S, 1 M. Named limits, readonly result fields, and literal skip reasons match component 7 (`:20`, `:41`, `:86`). The local catch narrows `unknown`, logs once at warn, and carries the requested degradation marker (`:133`); finding 1 concerns its documentation, not the agreed fallback structure.

### `curator-llm/merge-candidate-collector.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. Small local fixture builders and behavior-oriented cases keep ordering, bounds, scope, partial failure, and abort assertions readable (`:30`, `:61`, `:133`, `:198`, `:284`, `:336`). Partial class doubles use the existing suite's `as unknown as` convention rather than introducing production suppressions (`:69`, `:84`; precedent `memory-curator.service.spec.ts:75`).

### `memory-curator.service.ts`

Score 8/10 — 0 B, 0 S, 1 M. Optional injection follows the governor and existing decorator style; construction occurs beside the other owned collaborators (`:196`, `:203`, `:206`). The private guard returns a branded `MemoryId | null`, keeping the pipeline concise without changing public stats (`:774`, `:729`). Finding 2 is the stale placement comment.

Size observation, not a split request: the current read contains **860 physical lines**; `git diff HEAD --numstat` reports **68 additions / 13 deletions**, implying **805 base lines** under the same counting convention. The supplied 861 figure is compatible with counting a trailing empty line. This is above 700 physical lines and below the requested 1000 soft ceiling. The actual lint rule is warning-only and excludes comments and blanks (`eslint.config.mjs:514`); a simple whole-line count gives **583 nonblank/noncomment lines**, not an ESLint execution result. Therefore physical growth alone does not establish a max-lines violation. The substantive risk remains the existing service/constructor breadth (`:176`), while the new extraction already isolates the collection concern (`:619`).

### `memory-curator.service.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. The appended describe owns setup, cleanup, search doubles, and service construction (`:1923`, `:1935`, `:1954`, `:1982`). Guard tests assert stored effects and reason fields rather than calling the private guard, preserving freedom to refactor it (`:2055`, `:2074`, `:2106`, `:2133`).

### `di/register.spec.ts`

Score 8/10 — 0 B, 0 S, 0 M. The added case reuses the existing child-container/real-database fixture instead of introducing another registration path (`:70`, `:207`). It resolves the registered search and curator, spies on the real search method, and asserts the workspace passed through the public curate entry point (`:248`, `:257`, `:264`), making wiring changes reviewable.

## Pattern compliance

| Repository rule or nearby convention                                      | Status         | Evidence                                                                                                                 |
| ------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Construct internal collaborator like CuratorWindowRunner; no new DI token | PASS           | `memory-curator.service.ts:206`, `:209`; `curator-window-runner.ts:69`                                                   |
| No collector export from public barrel                                    | PASS           | Complete `libs/backend/memory-curator/src/index.ts:1` examined; curator exports at `:95` do not expose it                |
| Agreed names, four limits, result fields, skip reasons                    | PASS           | `merge-candidate-collector.ts:20`, `:35`, `:41`                                                                          |
| Search injection optional and appended after governor                     | PASS           | `memory-curator.service.ts:196`, `:203`; `implementation-plan.md:701`                                                    |
| Catch unknown and narrow before message access                            | PASS           | `merge-candidate-collector.ts:133`, `:142`                                                                               |
| Degradation-audit marker in optional capability catch                     | PASS           | `merge-candidate-collector.ts:134`; `implementation-plan.md:696` (format inspection; audit target not run)               |
| Structured logs at agreed levels                                          | PASS           | Collector warning `:137`; service counts at debug `memory-curator.service.ts:625`; refusal reason at info `:780`, `:791` |
| No new cross-lib deep import or host branching                            | PASS           | Collector imports `:14`; service imports `:14`; new spec imports `memory-curator.service.spec.ts:11`                     |
| Parameterized SQL for variable fixture values                             | PASS           | `memory-curator.service.spec.ts:1946`, `:2093`; `di/register.spec.ts:245`                                                |
| Public facade and CuratorRunStats preserved                               | PASS           | `memory-curator.service.ts:111`, `:320`, `:729`                                                                          |
| Explain growth rather than split mechanically                             | PASS           | `memory-curator.service.ts:619`, `:774`; `eslint.config.mjs:499`                                                         |
| Angular/NestJS/platform-adapter conventions                               | NOT_APPLICABLE | Existing backend service and internal collaborator, `memory-curator.service.ts:151`, `merge-candidate-collector.ts:50`   |

## Maintenance debt

- Introduced: one optional constructor slot and two comment inconsistencies (`memory-curator.service.ts:193`, `:204`; `merge-candidate-collector.ts:34`).
- Retired: inline candidate assembly in the service is replaced by a named collector call, concentrating tier policy in one unit (`memory-curator.service.ts:619`; `merge-candidate-collector.ts:62`).
- Net: modest additional policy/test surface with a coherent ownership boundary; no evidence justifying another abstraction or service split in this batch (`memory-curator.service.ts:209`, `:774`).

## Verdict

- Recommendation: APPROVE.
- Confidence: MEDIUM — full source/diff review completed; workspace-scoped diagnostics were unavailable and execution gates were not rerun.
- Key concern: inaccurate comments can mislead future maintenance of otherwise explicit diagnostic and constructor contracts (findings 1–2).
- What a 10/10 version would do differently: correct both comments; attach successful scoped diagnostics/lint evidence. Reconsider service constructor breadth only when another concrete change establishes a useful responsibility boundary, not merely to reduce physical lines.
