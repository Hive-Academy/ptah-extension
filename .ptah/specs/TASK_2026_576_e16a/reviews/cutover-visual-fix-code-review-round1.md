# Cutover visual fix — final code review

Reviewer: codex — GPT-6

Reviewed commit: `f5594b9c12ff87d7bd97997e2355c624a1cc8eb3`.

Score: **9/10**

Verdict: **APPROVED**

Reviewed the committed production changes, accompanying specs and the committed “Fix round 2” response. Evidence below refers to that commit, not the working tree. No tests, builds or runtime visual checks were run, as requested; rendered layout verification remains with the coordinator's capture pass.

| Finding | status | evidence file:line |
| --- | --- | --- |
| 1 — Late preference read undoes Split | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.ts:348` records every explicit press before the same-value return. At `:377`, a late read applies its value only without a user choice; `:383` reconciles against the current choice and avoids repeating an already-issued write. `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.spec.ts:258` covers the original deferred-read/Split scenario and verifies exactly one write of true. |
| 2 — Populated chips overflow narrow file header | FIXED | `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts:106` replaces individual chips with one summary below 480 px. At `:125`, the comparison badge is bounded at narrow widths; `:193` gives the summary its full metadata through both title and accessible name. The previous unbounded width contribution from multiple chip labels is removed. `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.spec.ts:940` checks that a collapsed in-progress comment remains represented in the summary. |
| 3 — Long history author crowds out subject | FIXED | `libs/frontend/git-ui/src/lib/history/history-timeline.component.ts:239` and `:295` cap authors at 30% and truncate for both root and ordinary commits. Adjacent title bindings retain the full names, and the full text remains in the DOM. The existing narrow-container hiding behavior is retained. |

The preference fix preserves ordinary loading when no choice was made, keeps an explicit pre-load choice when the stored value disagrees, and does not add a redundant reconciliation write when the value already agrees or the choice was already written. The canvas layout and pressed-state derivations are unchanged. No concrete new behavioral regression was identified in the three fixes.

## New findings

None.
