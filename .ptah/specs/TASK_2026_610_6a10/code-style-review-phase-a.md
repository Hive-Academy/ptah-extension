# Code Style Review, Phase A (PR A) — TASK_2026_610_6a10

Score 7/10. Verdict REVISE (0 blocking, 3 serious, 4 minor). Scope: commits A1-A7, read in full via `git show`; sibling comparisons against `changeSetAnchors`, `electron-only-chunks.js`, `scripts/jest.config.ts`. Diagnostics and tests were not run by me.

## Findings

1. SERIOUS. Duplicate cost formatting survives A3. `formatUsdCost` was meant to be the single source, but four copies of the same `< 0.01 ? toFixed(4) : toFixed(2)` rule remain:
   - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts:57`
   - `libs/frontend/chat-ui/src/lib/molecules/session/session-cost-summary.component.ts:121`
   - `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:836`
   - `libs/frontend/dashboard/src/lib/utils/format.utils.ts:26` (differs: `cost > 0 &&`)
   The shared JSDoc claims "every other surface prints the same string", which is untrue (drift risk). `cost-badge.component.ts:33` also still inlines `toFixed(4)` for the title.
   Fix: point the three chat-ui copies at `formatUsdCost` (unwrap the null with `?? ''`). Leave dashboard alone, but reword the JSDoc to "the badge and recap" and name the remaining copies.

2. SERIOUS. `scripts/eager-closure-gate.js:159` plus `package.json:70` define `gate:eager-closure`, but nothing in `.github` or any `project.json` runs it. The only enforcement is `apps/ptah-electron/src/config/eager-closure-gate.spec.ts:1-17`, which skips unless a build artifact exists (`describeIfBuiltOrFail`). The `--base` growth mode (`gate.js:~60-80`) has no caller, so `ALLOWED_EAGER_GROWTH_INPUTS` (lines 24-29) is dead allowlist surface.
   Fix: wire it into the webview build or CI job, or drop `--base` and the allowlist until a caller exists.

3. SERIOUS. `libs/shared/src/lib/utils/index.ts:11-30` plus `libs/shared/src/index.ts:55` push all four new utils into the main `@ptah-extension/shared` barrel, which is eager on both hosts. That is why the gate allowlists them (`gate.js:28`).
   - Acceptable for `formatUsdCost`/`formatDurationMs` (the badges are eager).
   - `classifyTestCommand`, `collectTurnTests` and `buildTurnSourceSnapshot` are Electron-recap and host logic. A plan-component-level check is needed on whether they belong in the eager barrel at all.
   - `test-command.fixtures.ts` is not barrelled (good), but confirm it is excluded from the lib build via `tsconfig.lib.json` (`grep` found no exclusion).
   Fix: keep the barrel, but add the fixtures exclusion. If bundle weight matters, move the turn-* utils to a dedicated `@ptah-extension/shared/turn-recap` entry like the chat-ui one.

4. MINOR. `chat-transcript.component.ts:500-518` writes `_frozenTurnTestsAnchors` inside `computed`. It copies `_frozenAnchors` (`:482-498`), so it is consistent. It is still a side effect inside a computed, and now there are three of them (`_frozenView`, `_frozenAnchors`, `_frozenTurnTestsAnchors`). Not a blocker.
   Fix: leave as is for this PR, and file a follow-up for one shared "freeze while hidden" helper at the third copy.

5. MINOR. `turn-tests-row.component.ts` (A3 template, `outcomeClass(run.outcome)`) is a template method call, against the Angular rules.
   - It is pure and cheap, but it is the only one in the file, while the rest uses `computed`.
   - Fix: precompute a `rows = computed(() => runs().map(r => ({ ...r, cls })))`, or use a lookup record `OUTCOME_CLASS[run.outcome]`.
   - Also `@for ... track $index` has no stable id. Acceptable for an append-only list, but state it in a comment.

6. MINOR. `role="status"` on the `<section>` of `turn-tests-row.component.ts` makes it a polite live region for a static transcript item. Every re-render of a deferred row may be announced, and several turns would stack announcements.
   Fix: drop `role="status"` and use `role="group"` with the existing `aria-label`. Also `role="list"` on a `<ul>` is redundant, so keep it only if list-style is reset (Safari).

7. MINOR. `host-source-registry.baseline.ts` is a generated 567-entry fixture with `"` quotes (prettier-hostile) and a header that names a commit but no regeneration command.
   - As a pin it is a sound choice: the diff is reviewable, and the spec says an edit needs a Gate 2 exception.
   - Maintenance cost: any legitimate RPC addition forces a hand edit.
   - Fix: add the regeneration script or command to the file header, mark the file as generated in `.prettierignore`/`.gitattributes`, and consider asserting a diff of added/removed names so failures are readable.

## Passes
- `@ptah-extension/chat-ui/turn-recap` and the `tsconfig.base.json` alias mirror `change-set-card` exactly (`turn-recap.ts:1-15`). The `index.ts` re-export ban is documented, and the gate's `FORBIDDEN_EAGER_INPUTS` (`gate.js:19`) enforces it.
- `import type` is used and there is no `any`. Naming follows kebab-case. No `console` in shared or chat code (the gate script uses it as a CLI, in line with `electron-only-chunks.js:212`).
- Gate: reuses `assertEagerClosureKept` from `electron-only-chunks.js` and keeps its CommonJS style. The `staticClosure` BFS is nearly identical to `electron-only-chunks.js:154-166`, so export a shared `staticClosure` there instead of copying it. The spec `require`s the `.js` file via `eslint-disable no-require-imports`. That avoids the ts-jest `allowJs` warning. Fine, but the cast type is hand-maintained.
- Boundary: the shared (leaf) to chat-ui to chat direction is respected. `transcript-turns.ts` sits in the chat lib next to `transcript-change-set-anchors`.
- `CostBadge`/`DurationBadge`: `protected readonly formatUsdCost = formatUsdCost` is a reference assignment, not a template call. Fine, but see finding 1 for the remaining duplicates.
