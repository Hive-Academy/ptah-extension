## Verdict

REVISE — 6/10. Review family: codex (implementer family: Claude).

Two major findings; no blockers; two failure-mode families. The named implementation preserves the main selection/opening paths, but compacting information has left keyboard and screen-reader access incomplete. This is below 7–8 because information required for interpreting usage is inaccessible through those interaction paths; above 3–4 because the inspected thread dispatch, sibling action controls, unknown-value rendering and variant separation remain coherent.

This is a static review of the named working-tree files, not a verified census of the uncommitted diff. No source was edited and no checks were run.

## Findings

1. **major — Hidden LANES explanations have no keyboard-visible replacement.**

   Evidence: `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts:74` makes the disclosure button focusable, but the explanatory titles are on its nonfocusable child spans at lines 87, 93, 102 and 111. The compact expanded panel removes the visible summary at line 194 and replaces the owner explanation with a titled paragraph and screen-reader-only text at lines 339–348. `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-subtotal-tile.component.ts:32` similarly puts its complete explanation on a nonfocusable div, while lines 39 and 51 hide the subtotal label and counts. The shared “not in totals” explanation becomes a nonfocusable titled icon at `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts:54`.

   Failure scenario: a sighted keyboard user tabs through LANES, expands a lane, and tries to discover why its owner/limit is unknown or whether its cost belongs to session totals. There is no focus-triggered tooltip or visible disclosure for that explanation; expanding the row still leaves its full owner footnote hidden. Screen-reader-only text does not restore access for that user.

   The accessible-name requirement also remains incomplete: `lane-usage-tile.component.ts:79` connects the usage/limit summary through `aria-describedby`, and line 185 renders it outside the button. That supplies a description rather than putting the removed summary into the accessible name requested by the task.

   Suggested fix: provide a keyboard-focusable information control with an actual focus-triggered tooltip or a keyboard-openable explanatory panel for the shared caption, subtotal and owner footnote. Preserve the requested complete accessible name on the lane control, avoiding duplicate announcements. Merely adding a native title to another element is not a focus-triggered tooltip implementation.

   Coverage gap: `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts:609` checks title strings, hidden text and an `aria-describedby` relationship; the expanded-footnote test at line 647 checks the same DOM ingredients. Neither tests keyboard-visible information or the computed accessible name. These assertions can pass with the failure above.

2. **major — AGENTS buttons suppress the displayed model and token split in their accessible names.**

   Evidence: `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-row.component.ts:37` assigns the entire row button `r.ariaLabel`. `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-list.ts:103` builds usage text containing only total tokens and cost; lines 106–110 supply name, kind, status and duration to the base label, and line 126 concatenates those two strings. Neither the model nor the input/output split is included. The model and split appear only in descendant content/titles at `inspector-agent-row.component.ts:54` and line 62.

   Failure scenario: keyboard/screen-reader users focus two agents with different models or need the input/output split before opening a thread. The explicit button label overrides its descendant text as the accessible name, so neither the displayed model nor “In x · Out y” is announced as part of the focused control. The child title is also not a keyboard-visible tooltip.

   Suggested fix: include the resolved model and the known input/output split in the row's accessible label or explicitly associated accessible text, and expose the split through a focus-triggered tooltip. Preserve “not reported” for missing values. Add an assertion against the button's computed accessible name, using a known model and asymmetric input/output values.

   Coverage gap: `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts:227` verifies the split only as a descendant title. It cannot establish that the row announces it.

## Five logic questions

1. **How does this fail silently?** The compact UI renders normally while explanations become unavailable to sighted keyboard users; finding 1 identifies the exact template boundaries. No error is raised.
2. **What user action produces unexpected behavior?** Focusing an AGENTS row omits its model and split (finding 2); expanding a compact lane still does not reveal its complete owner explanation (finding 1). Static selection tracing shows a single lane dispatch per click at `inspector-agents-section.component.ts:346`, with the no-surface Orchestrator excluded by `canOpen` at line 336. The repeated-click spec at line 242 tests one selection notification and a thread request per click.
3. **What input produces a wrong answer?** Known model and input/output values produce an incomplete spoken answer in finding 2. For compact lane totals, mixed known/unknown runs retain a lower-bound marker through `lane-tiles.ts:163` and line 166; subtotal bounds use the corresponding missing-count conditions at lines 775–776. `lane-bound-value.component.ts:19` preserves the visible marker and supplies “at least.” No additional arithmetic defect is asserted.
4. **What happens when a dependency fails?** `lane-tiles.ts:449` represents absent owner limits as unknown; lines 455–461 preserve last-known provenance and lines 568–574 distinguish timeout/failure. Finding 1 makes some explanations difficult to discover. Steering handles a false result with an error at `inspector-agents-section.component.ts:391`; rejection behavior depends on the tray service contract and was not established in this review.
5. **What is missing from requirements?** Exact tooltip focus/escape behavior and accessible-name verification are not specified as test cases. The implementation needs those behavioral criteria to demonstrate the requested information parity; DOM presence alone is insufficient (spec citations above).

## Decisions

- **Scope:** Reviewed the explicitly named files and relevant templates/spec excerpts rather than claiming an exhaustive uncommitted review. Options were Git inspection or the supplied file list. The reviewer role explicitly prohibits Git operations, while the file list and behavior are sufficient to proceed. Reversible: the coordinator can attach a diff and request a supplementary review.
- **Severity:** Treat inaccessible usage/owner information as functional accessibility defects, not formatting issues. Options were minor visual feedback or major capability gaps; the required tooltip/accessibility parity and the template evidence support major. Reversible after keyboard and accessible-name verification.
- **Other hosts:** The usage/subtotal components default to `strip` (`lane-usage-tile.component.ts:372`, `lane-subtotal-tile.component.ts:93`). `session-stats-summary.component.html:472` and line 480 omit a variant override. This supports static layout separation, not a host-runtime pass.
- **Dead-code candidates:** `sessionTokens` is bound by `session-inspector.component.html:181` and consumed at `inspector-agents-section.component.ts:421`; `canOpen` is called at line 351; duration feeds the accessible label at `inspector-agent-list.ts:110`. These are not dead. The returned `usageLabel` field is redundant with its local use in `ariaLabel` (lines 125–126), but no functional failure is attributed to that redundancy.
- **Removed API search:** Free-text searches across `libs/` and `apps/` found no occurrences of `agent-dock-detail`, `agent-open-thread` or `contextText`. The scoped `cells` search in inspector/stats files found unrelated tests/comments; it is not a proof that all possible consumers are compatible.

## Could not check

- Git status/diff, branch identity, the exact changed-line boundary and the complete untracked-file census: prohibited by the reviewer role's no-Git rule. Findings describe present code; introduction specifically in this uncommitted revision remains unverified.
- No tests, typechecks, diagnostics, browser, Electron or assistive-technology sessions were run, per the task's explicit no-checks instruction. The coordinator owns verification. No runtime or host-compilation claim is made.
- Task discovery found `context.md`, which contains lane quota information, but no `task-description.md`, `implementation-plan.md`, `batches.md`, `tasks.md`, `test-report.md` or `code-style-review.md`. Behavioral intent therefore comes from the supplied request.
- The `ptah_code_search_symbols` lookup for SessionAgent returned zero hits with an empty/unavailable index; the subsequent native free-text search supplied field evidence. No symbol-reference completeness claim is made.
- Large file outputs were truncated in several reads; targeted follow-up reads covered cited paths and relevant branches, but this report does not certify full-file/whole-diff approval or exhaustive spec coverage.

