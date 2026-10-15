# Batch W3 fix round 1 - TASK_2026_677_efcd

Scope: the four defects in batches.md "Wave 3 MODE 2 result" (session 6). No other file touched; no spec edited.

## 1. A2-1 - TS2349 `title()` shadowed by template ref

- File: `libs/frontend/chat/src/lib/components/molecules/session-header/session-header.component.ts`
- `:80` template ref `#title` -> `#titleRef` (no longer shadows the `title` input, so `title()` at `:83,85` resolves to the input).
- `:160` `viewChild<ElementRef<HTMLElement>>('title')` -> `viewChild<ElementRef<HTMLElement>>('titleRef')`.
- Public `titleEl` / `toggleEl` names unchanged; behaviour identical. Grep: no spec or other file references the
  `'title'` ref string.

## 2. D-1 - TS2339 `row.input` / `row.output`

- File: `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts`
- Type checked first: `libs/shared/src/lib/types/rpc/rpc-session.types.ts:380-392` - `modelUsageList` rows carry
  `inputTokens: number` ("Uncached input tokens") and `outputTokens: number`.
- `:133` `formatOptionalTokens(row.input)` -> `formatOptionalTokens(row.inputTokens)`.
- `:134` `formatOptionalTokens(row.output)` -> `formatOptionalTokens(row.outputTokens)`.
- Minor warning `:195` (non-null assertion) also fixed, trivially: `modelNames` now reads
  `const primary = this.primaryModel();` and narrows on `primary` instead of `this.primaryModel()!`
  (`:195-196`). Same result, one fewer signal read.

## 3. D-1 - lint `@angular-eslint/template/no-duplicate-attributes`

- File: `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts`
- `:155-157` the `linkPlanTiles` `<button>` dropped its static `class="..."`; the static classes are folded into the
  single binding:
  `[class]="'h-6 min-w-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content ' + chipClass(planChip.chip.tone)"`.
  `chipClass` returns a `string` (`stats-tile.styles.ts:44`), so the rendered class set equals the previous
  static + bound merge.
- The `@else` `<span>` branch is untouched (byte-identical to the original lines in `git diff`).

## 4. B-3 - lint `@nx/enforce-module-boundaries` (static import of lazy lib)

- File: `eslint.config.mjs`
- `:285-286` appended to `checkDynamicDependenciesExceptions` (after `'@ptah-extension/marketplace/harness'`):
  `// TasksChangedFeed (a MESSAGE_HANDLERS service) must register at app bootstrap.` then
  `'@ptah-extension/tasks-ui/presentation',` - per decisions row 72. `app.config.ts` itself unchanged.

## Verification

- `ptah_get_diagnostics` scoped to `session-header.component.ts`, `inspector-session-stats.component.ts`,
  `lane-usage-tile.component.ts`, `app.config.ts`: source typescript-compiler, coverage clean,
  **"No diagnostics in the requested files."** (Sibling-file errors reported are pre-existing spec typings in
  files this round did not touch.)
- Limitation: that checker is the plain TypeScript compiler; it does not type-check Angular templates, so fixes 1-3
  (template errors / template lint) and fix 4 (ESLint config) are confirmed only by the team-leader's
  `nx typecheck` / `nx lint` re-run. No nx/jest/lint run here, per the round's rules.

## Decisions

- Fix 3: folded the static classes into the bound expression (static prefix + `chipClass(...)`) rather than
  `class` + `[class.x]` bindings - one binding, matches the MODE 2 instruction. Reversible.
- Fix 4: placed the comment as a one-line inline comment on the new entry rather than another paragraph in the
  existing block comment, to keep the diff minimal. Reversible.
