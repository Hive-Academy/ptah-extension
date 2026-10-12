# Batch 33F report: dock tabpanel display, chip word values, eager allow-list

Executor: frontend-developer sub-agent, running the tasks in order (33F.1, 33F.2, 33F.3). No git commands were run, and batches.md and decisions.md were not edited.

## Task 33F.1: dock tabpanels honour `hidden` (D1, #149). Done

- `display-dock.component.ts`: removed the static `flex` class from both `role="tabpanel"` divs. The remaining classes are `min-h-0 min-w-0 flex-1 flex-col`. Each panel now has `[class.flex]="state().activeTab === '<tab>'"` and `[class.hidden]="state().activeTab !== '<tab>'"`. `[id]`, `aria-labelledby`, `[hidden]` and `data-testid` are unchanged. Both panels stay mounted (there is no `@if`).
- `display-dock.component.spec.ts`: added `it.each` over `displays` and `agents` as the active tab.
  - The inactive panel has the `hidden` attribute and class `hidden`, and does not have class `flex`.
  - The active panel has class `flex`, does not have class `hidden`, and has no `hidden` attribute.
  - A comment explains that jsdom does not compute CSS, so this class contract is what guards against `.flex` overriding `[hidden]`.
  - A further test confirms both tabpanels stay mounted across tab switches.
- `display-panel.component.ts` and `dashboard-stat.component.ts` were not touched.

## Task 33F.2: chip word values never break mid-word (D2, #150). Done

- `turn-summary-chip.component.ts`:
  - Added `word: boolean` to `ChipMiniCard`. It comes from `isStatusWord(value)`, which is true for the literal `'unavailable'` or `'pending'` (`TurnSummaryUnavailable`).
  - `miniCards` builds the cards as `Omit<ChipMiniCard, 'word'>` and then maps every card to set `word`.
  - The value span binds `[class]` to one of two constants:
    - `MINI_WORD_CLASS`: `block break-normal text-sm font-medium`
    - `MINI_VALUE_CLASS`: `block break-words text-lg font-semibold tabular-nums`
  - Added `data-testid="turn-summary-chip-card-value"` to the value span.
  - `.ts-mini-grid` stays at 104 px. Text, srSuffix and caption are unchanged.
- `turn-summary-chip.component.spec.ts`:
  - The `model()` helper's `usage` option now also accepts `'pending'`, which gives `{ kind: 'pending' }`.
  - Added a new `value classes (D2, decision #150)` describe with three cases:
    - With tokens, cost and time `unavailable`: those spans have the word classes (`break-normal` and `text-sm`, not `break-words` or `text-lg`) and still read "unavailable". Files `3`, Lines and Tests keep `text-lg`, `break-words` and `tabular-nums`.
    - With usage `pending`: Tokens, Cost and Time take the word classes and read "pending".
    - `?` (counts unavailable) keeps the number classes.

## Task 33F.3: allow-list the two eager tool-preview helpers (#148). Done

- `scripts/eager-closure-gate.js`: added two anchored regexes to `ALLOWED_EAGER_GROWTH_INPUTS`, with a comment saying they are eager because the existing inline tool-call header, input display, diff display and code output import them (#148):
  - `copy-text-button.component.ts`
  - `tool-language.utils.ts`
- Forbidden patterns, `assertNoForbiddenEager` and the CLI are unchanged.
- `eager-closure-gate.spec.ts`:
  - Added both paths to the `allows listed eager growth input %s` table.
  - Added a negative case: `libs/frontend/chat-ui/src/lib/atoms/other-new.component.ts` still throws `unlisted eager input growth: <path>`.

## Verification (run one at a time, output tailed)

All Jest runs used `--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`.

1. `npx jest -c libs/frontend/chat/jest.config.ts .../display-dock.component.spec.ts --coverage=false --maxWorkers=2`
   `Test Suites: 1 passed, 1 total` / `Tests: 21 passed, 21 total`
2. `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/turn-recap --coverage=false --maxWorkers=2`
   `Test Suites: 2 passed, 2 total` / `Tests: 58 passed, 58 total`
3. `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/config/eager-closure-gate.spec.ts --coverage=false --maxWorkers=2`
   `Test Suites: 1 passed, 1 total` / `Tests: 23 passed, 23 total`. ts-jest also printed its `allowJs` warning for `scripts/eager-closure-gate.js`. This comes from the spec's existing JS import.
4. `npx eslint` on the six changed files: no output, exit 0 (0 errors, 0 warnings in these files).
5. `npx nx typecheck @ptah-extension/chat --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/chat`. The template diagnostic it printed (`res.target?.name`, line 181 of another component) is existing noise, not in a changed file.
6. `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: `Successfully ran target typecheck for project @ptah-extension/chat-ui`.

## Notes

- `prettier --check` flags `display-dock.component.ts` and `.spec.ts`. Every line it would change already existed before this batch (imports array, styles block, `<aside>`, icon tags, the `latestDisplaySeq()` comparison, older spec lines). None of the lines added here are affected. I did not reformat them, to keep the diff to the batch. The four other files pass.
- `chat-view.component.ts` was not touched.
- The visual re-check (#154) still needs user approval of a second build. It was not run.
