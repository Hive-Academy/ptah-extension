# Batch 17 report

## Files changed
- `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-stage.ts` (+ spec): 17.1. `keepPreviousFigure` now takes `config` and `extensions`. When a different measure's figure is kept, its limit is rebuilt from the current settings and extensions (`effectiveSessionBudgetLimit`) instead of the stale `previous.limit`. The same-measure branch already used the current limit. New spec: a kept `cost` figure after an extension gets `usd * 1.2`.
- `.../session-budget/session-handoff-writer.ts` (+ spec): 17.2. `prune` now first removes `.<uuid>.<uuid>.tmp` files at least 10 minutes old. Younger ones are kept as possible in-progress writes. This runs before the retention early-return. New spec: an old orphan is removed and a fresh one is kept.
- `libs/backend/agent-sdk/src/index.ts`: 17.3. Removed the `SessionBudgetState` re-export. A multi-line grep over apps and libs found no importer from `@ptah-extension/agent-sdk`.
- `libs/shared/src/lib/types/branded.types.ts` (+ spec): 17.4. The SDK (`@anthropic-ai/claude-agent-sdk` 0.3.278, `sdk.mjs`) makes ids with Node `crypto.randomUUID()` (fork session id `rb()`, imported as `randomUUID as rb`), which is v4. So `UUID_REGEX` is NOT relaxed. I added a comment naming the source and a spec that checks a `randomUUID()` id. No `nx affected` run was needed.
- `libs/frontend/webview-e2e-harness/.../settings.fixtures.ts`: 17.5. Now uses `Object.hasOwn(SESSION_BUDGET_SETTINGS_FIXTURE, key)`.

## Checks
- `nx run-many -t test -p shared`: exit 0.
- The jest run of `session-budget-stage.spec.ts` and `session-handoff-writer.spec.ts` (agent-sdk config): 56 tests passed.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: exit 0.
- `nx run-many -t typecheck,lint,test -p agent-sdk,shared,webview-e2e-harness`: exit 1. The earlier failure in `session-budget-stage.spec.ts` was my own and is fixed. The remaining failures are not in my files and come from other batches' in-flight edits:
  - `session-budget.service.ts:217` has `trackedEntry` missing.
  - `StreamTransformer` expects 8 constructor args but specs pass 7.
  - Root-barrel and contract specs fail as a result.
- No baseline PNGs were rewritten.

## Open notes
- agent-sdk typecheck and test should be re-run once the other P1 batches (16 and 18) have landed.
