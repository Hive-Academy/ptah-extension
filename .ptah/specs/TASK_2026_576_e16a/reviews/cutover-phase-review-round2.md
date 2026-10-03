# Cutover logic review — final round

Reviewer: Codex, GPT-6

Score: 9/10

Verdict: APPROVED

Reviewed commit `68251d0e447fb92bc9d3493d03a2c2f7edf85210` against findings 1–5 in the previous review and the author's Fix round 2 responses. Evidence below refers to source at this commit, not the working tree. All five findings are fixed; no new concrete behavioral defect was identified in the changed implementations.

| Round-1 finding | status | evidence file:line |
| --- | --- | --- |
| 1 — Latest-open ticket did not cover leave-guard/reset continuations | FIXED | `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:250` and `:308` advance the shared generation when an asynchronous open begins. `:401` rejects superseded RPC results, and `:454`–`:463` use the same generation for the final guarded commit. A newer open therefore invalidates an older pending guard without changing seq, allowing the newer read to proceed. Workspace switches advance it at `:361`; the reset follows the same guarded path at `:388`. Deferred-guard regression cases are present in `libs/frontend/git-ui/src/lib/services/review-navigation.service.spec.ts:578` and `:613`. |
| 2 — Tab-only commit reassigned a retained editor's workspace owner | FIXED | `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:495` identifies the retained target, and `:500` preserves its existing owner. Tab changes pass the same target at `:344`; dropping a historical comparison while retaining the editor does likewise at `:387`. Removing the original workspace still reaches the guard at `:369`. `libs/frontend/git-ui/src/lib/services/review-navigation.service.spec.ts:800` covers Keep editing → History → Changes → removal of the original workspace. |
| 3 — Composer text migrated to another non-null draft owner | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:88` defines identity using both workspace and session, `:763` records it when the composer opens, and `:694` clears the composer on owner loss or replacement. The submission-time check at `:789` also prevents misattribution before the clearing effect runs. Equal owner records retain the text. Relevant coverage is in `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.spec.ts:968` and `:990`. |
| 4 — Failed/non-text read erased a retained comment | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts:694` now clears only for owner loss/replacement, not read status or labels. The composer remains outside the error/label branches at `:266`; `:332` disables Add draft and `:348` explains that the comment is retained. `:787` enforces the readable-diff requirement at submission too, while Cancel remains available at `:339`. Recovery and labelled-result cases are covered in `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.spec.ts:1000` and `:1048`. |
| 5 — Staging merge lost collapse state when the destination section already existed | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/review-canvas-position.ts:93` selects same-path survivors without excluding existing ids; `:96` removes the vanished source id, and `:97` transfers collapse state to the survivors. This handles stage and unstage merges and preserves collapse when both source sections were collapsed. `libs/frontend/git-ui/src/lib/review-canvas/review-canvas-position.spec.ts:34`, `:43` and `:52` cover those cases. |

## New findings

None.

## Verification scope

Static inspection of the committed diffs, affected source and added specs, including the spot editor's actual leave-guard behavior at `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts:540` and `:629`. Superseded guard answers do not themselves discard the editor buffer; a newer guarded navigation can reuse an outstanding question. Synchronous commits still supersede older continuations through seq checks.

Tests, builds and application runs were not performed, as instructed. The author's reported verification was not independently reproduced. Accepted tradeoffs from the preceding review were not reopened. Only this deliverable was written; the other writer's uncommitted visual edits were not reviewed or modified.