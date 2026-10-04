# PR #639 webview-e2e fix (round 2) — Orchestration fold + stuck busy element

Task branch: `fix/task-597-session-budget` (base commit `ce2d35e77`). All commands run from the worktree root.

## Root cause

PR 3 (TASK_2026_597 N7) inserted the session-budget card's `@defer (on viewport)` block **between the CLI matrix and the subagent prompt-cache TTL block** in `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`, with a same-footprint placeholder of `min-h-[30rem]` (480 px + the container's 10 px `space-y-2.5` gap):

- `git diff origin/main...HEAD` on that file shows PR 3's only template change is the session-budget block (import + `imports[]` entry + the 480 px placeholder block).
- The fold gate `assertOrchestrationFold` (`libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts:330-376`, budget `ORCHESTRATION_FOLD = 660` at `:317`, per-region assertion at `:367`) measures `rolesSummary` = `[data-testid="background-roles-summary"]` bottom at 1024x768 with zero scroll. The 490 px of placeholder above the roles `<details>` pushed the roles summary from its pre-PR-3 position (≤ 660) to **1142 / 1192** — the 7x failure in the `baseline smoke — Orchestration order strip, fold, roles and order popover` test (`settings-visual.e2e.spec.ts:501`).
- The once-seen busy failure (`expect(locator('body').locator('[aria-busy="true"], .loading-spinner, [data-read-loading]')).toHaveCount(0)` received 1) is the **subagent-cache-TTL placeholder**: it carries `aria-busy="true"` and sits in an `@defer (on viewport)` block (component lines 84-93). PR 3's 480 px placeholder pushed it below the fold, so its viewport trigger never fired and the placeholder stayed `aria-busy` forever; `waitForSettled` (`settings.fixtures.ts:936-943`) sees count 1. (The session-budget placeholder's own `aria-busy` was already removed by `a6a8af2ef`; the new card in `session-budget-settings.component.ts` has no `aria-busy` / `.loading-spinner` / `data-read-loading` markers — its loading state is `role="status"` at `:158-167`.)

## Fix (product layout, not the assertion)

In `orchestration-settings.component.ts`:

1. **Moved the session-budget `@defer (on viewport)` block below the background-roles `<details>`** (now at lines 183-195, before the commit-feedback block). Everything above the roles summary is now identical to `origin/main` — the pre-PR-3 geometry that was green in all four combos.
2. **Shrunk the placeholder** from `min-h-[30rem]` to `min-h-[2.75rem]` (one row, matching the TTL placeholder at line 89), so neither the placeholder nor the loaded chunk can push the fold regions down.
3. Kept `@defer (on viewport)` (own chunk) and the `session-budget-placeholder` test id; the placeholder stays without `aria-busy` (can legitimately persist off-screen, per `a6a8af2ef`).
4. With the 480 px insertion gone, the TTL placeholder is back above the fold, its viewport trigger fires at tab open, and `aria-busy` clears — nothing stays busy.
5. Updated the component doc comment (lines 47-52) to record the order: session budget after the roles `<details>`, below the fold content.

Unit spec (`orchestration-settings.component.spec.ts`) updated to the new layout (specs are part of the change, the e2e assertion was not touched):

- The session-budget defer test (was "between the CLI matrix and the subagent cache TTL card") is now "after the background roles (below the Orchestration fold)": block index `blocks[2]` (template order matrix → TTL → session budget) and document-order asserts `matrix < ttl < roles < budget`.
- The TTL defer test's block index changed from `blocks[blocks.length - 1]` to `blocks[1]` (it is no longer the last defer block).

## Files changed

- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts` — move + shrink + comments.
- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts` — defer-block indices/order asserts.

Not changed: the e2e spec and its 660 px fold budget, `session-budget-settings.component.ts`, fixtures.

## Check results

- `npx nx run @ptah-extension/webview-e2e-harness:e2e -- --grep "baseline smoke|live-shaped values"` → **36 passed (25.9s), exit 0.** Fold evidence (B36 log lines, all four combos): roles summary bottom **550** (vscode/anubis, vscode/anubis-light) and **600** (electron/anubis, electron/anubis-light) — all ≤ 660, `over: none`, scroll 0/0, 5+2 reference set intact. (Run through PowerShell: `Tee-Object` to a log + `Select-Object -Last`, output not re-run.)
- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness` → **exit 0** (chat typecheck 53.2 s on the critical path).
- `npx nx run @ptah-extension/chat:test --maxWorkers=2` → **Test Suites: 165 passed, 165 total; Tests: 2 skipped, 3053 passed, 3055 total.**
- Baseline PNGs: the e2e run rewrote **104** baseline PNG files in the harness. Left as rewritten (not reverted, not kept) per instructions.
