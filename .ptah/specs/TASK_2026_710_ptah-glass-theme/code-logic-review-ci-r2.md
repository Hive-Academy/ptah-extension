# Independent review — final CI revision and bounded correction

## Review family

Implementer: Grok CLI. Reviewer: OpenAI orchestrator, independent of the correction author. Reviewed pending diff on cbadcf164. Revision 2 of 2 plus the one bounded correction; cap is exhausted.

## Verdict

REVISE / incomplete. Do not describe the remaining CI failures as fixed. No further automatic correction round is started.

## Outstanding issue

1. `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-visual.e2e.spec.ts:128-161`: the bounded correction now fails explicitly instead of silently saving incorrectly sized screenshots, which resolves the review's test-integrity defect. It does not establish a fix for the original sizing failure. `viewport = target + (applied - measured)` is algebraically the original `viewport += target - measured` after rounding. The only settling change is one animation frame before measurement. There is no measured evidence identifying why a discovery view produced a divergent/illegal next viewport or demonstrating convergence within six attempts. The lane explicitly records this uncertainty in ci-bounded-correction.md:85. This is a useful diagnostic improvement, not an established root-cause correction. The unsupported production max-width cap was removed, correctly.

## Other reviewed changes

- `apps/ptah-electron-e2e/src/support/axe.ts:68-78`: removing data-glass/data-glass-mode matches the anubis/anubis-light themes this helper selects, and removes the hybrid state observed by the contrast assertion. The additional CSS ink specificity handles that hybrid state but is not evidence for real glass-theme contrast.
- `apps/ptah-extension-webview/src/styles.css`: moving backdrop-filter to a non-ancestor pseudo-element addresses the fixed-containing-block mechanism; element backgrounds are made transparent and late fills updated. License host block display and parent lift address source-level host layering. These are broad rendered changes across chrome/bar/overlay surfaces and must not be accepted as preserving C4 appearance solely from source review. No new rendered dark/light evidence exists for this revision.
- `apps/ptah-extension-webview/src/app/glass-roles.spec.ts:17-29`: source assertions guard the intended rule placement, not computed style, popover hit testing, clipping or visual parity.

## Verification and disposition

No local heavy checks run for revision 2. No CI run exists for these pending changes. Latest pushed head cbadcf164 has green unit/main checks and Electron shards 1,3,4; Electron shard2 and webview E2E fail. Revision 2 and bounded correction remain uncommitted in the task worktree; unrelated .gitignore untouched. Stop at the announced cap and report the outstanding marketplace root cause and rendered verification requirement rather than declaring completion or resetting the revision budget.
