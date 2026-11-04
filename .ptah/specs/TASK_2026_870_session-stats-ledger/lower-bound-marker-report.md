# Lower-bound spend marker

Spend on the no-workspace welcome and the chat empty state now uses the same rule as the usage totals: a known cost with unpriced usage is a lower bound, and a missing cost stays unknown.

## Files changed

- `libs/frontend/chat/src/lib/services/vitals/usage-vitals.model.ts` — `formatSpendAmount` and `UNPRICED_SPEND_NOTE`
- `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.view.ts` — `toSpendCell` sets `text` and `note`
- `libs/frontend/chat/src/lib/services/vitals/welcome-vitals.view.spec.ts` — fully priced, lower bound, no known cost
- `libs/frontend/chat/src/lib/components/templates/electron-welcome.component.ts` — binds `note` as `title`, `aria-label`, and `role="group"`
- `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state-screen.component.ts` — same rule and the same bindings on Spend 7d

## Behavior

| Case | Condition | Shown | `note` |
| --- | --- | --- | --- |
| Fully priced | finite `costUsd`, `unpriced` omitted | `$12.40` (unchanged `formatUsd`) | `null` |
| Lower bound | `unpriced: true` and a finite known cost, including `0` | `≥ $2.50` or `≥ $0.00` | `Some usage has no price` |
| No known cost | `costUsd: null` (with or without `unpriced`) | empty cell; the stat cell draws its dash. Text stays `''` | `null` |
| No usage | load status `empty` | `$0.00` and seven flat bars | `null` |

`note` is bound on the spend numeral as `title` and `aria-label`. `role="group"` is set only while `note` is present, so the accessible name is actually exposed. A null cost is never passed to `formatUsd`.

## Decisions

- Shared `formatSpendAmount` in `usage-vitals.model.ts`. The chat empty state cannot import `toSpendCell` from `welcome-vitals.view.ts`: that module is welcome-only (`electron-welcome.lazy-boundary.spec.ts`). Options were a second copy of the prefix rule, or one function next to `formatUsd`. The shared function is reversible.
- The dash stays the existing empty stat-cell placeholder, not a ready numeral of `"—"`. That is the cell the previous null-cost path already used.
- A known zero with `unpriced: true` is `≥ $0.00`. Zero is a known cost. Only `null` and non-finite values are unknown.

## Verification

Command (one run):

`npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="welcome-vitals|usage-vitals"`

Observed: exit code 0. Nx reported `Successfully ran target test for project @ptah-extension/chat` for `@ptah-extension/chat:test --testPathPatterns=welcome-vitals|usage-vitals`. Duration 39.1s, cache 0/1. Jest's per-test list was not printed (`Output of 1 successful task was not shown`).

`ptah_get_diagnostics` on the edited files returned unavailable three times: `TypeScript check still running after 45s`. No compiler errors were returned. The symbol index (`ptah_code_search_symbols`) was empty (`symbolCount: 0`); file search used `ptah_search_files`, and the spend call sites were found with Grep after that empty index.

Loaded `plugins/ptah-angular/skills/angular-frontend-patterns/SKILL.md` before the edit. No new component. The empty-state spend figure stays a `computed` on the existing standalone OnPush view.

Not done: no browser render (serve and e2e were out of scope). `electron-welcome.component.spec.ts` and `chat-empty-state.component.spec.ts` are outside the allowed test pattern, so those templates were not executed in this run.
