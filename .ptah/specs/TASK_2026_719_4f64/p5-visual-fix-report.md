# P5 visual fix report (one round)

Source: `visual-review-p5.md` "Findings by severity" (Breaking 1, Breaking 2, Serious 3, Moderate focus box).
Not changed on purpose: 10 px chip/badge text (recorded as later guidance).

## Files changed (6)

All under `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/frontend/chat/src/lib/settings/providers/accounts/`:

- MODIFIED `accounts-tab.component.ts`: fixes 1 and 3
- MODIFIED `account-detail-view.component.ts`: fix 2
- MODIFIED `ambient-account-row.component.ts`: Moderate focus box
- MODIFIED `accounts-tab.component.spec.ts`: 2 new tests, 2 existing tests updated
- MODIFIED `account-detail-view.component.spec.ts`: 1 new test
- MODIFIED `ambient-account-row.component.spec.ts`: 1 new assertion

## What each fix does

1. **Breaking 1, rows at 245 px / 200% zoom** (`accounts-tab.component.ts`)
   - The row `li` already had `flex-wrap`, but the body used `flex-1` (`flex-basis: 0%`), so the actions could never wrap. The body is now `flex-1 basis-40 min-w-0`. When the row is narrower than 10rem plus the actions, the Sign in / Manage group (`ml-auto`, `data-testid="accounts-tab-row-actions"`) moves to its own right-aligned line below the text. At 245 px this happens for every row. At 320 px it happens only when both buttons are shown.
   - The name keeps `break-words` and now has `[title]="row.account.label"` (`data-testid="accounts-tab-row-name"`).
   - The status line gets `min-w-0`. The chip container (`data-testid="accounts-tab-row-chips"`) is `flex min-w-0 flex-wrap`. Each chip gets `h-auto max-w-full whitespace-normal break-words text-left`. The DaisyUI `.badge` has a fixed height and no wrapping, which is why a wrapped "Used for: ..." chip overlapped the status line.
2. **Breaking 2, inner tablist** (`account-detail-view.component.ts`). The tablist was `tabs tabs-bordered flex-wrap`. DaisyUI 4.12 (root `package.json`) makes `.tabs` a single-row `display: grid`, so `flex-wrap` did nothing. The added `flex` utility comes later in the cascade than the component layer, so it switches the strip to flex and Overview / Access / Profile wrap instead of making `native-drawer-body` scroll sideways. Added `data-testid="account-detail-tablist"`.
3. **Serious 3, Use for above the detail** (`accounts-tab.component.ts`)
   - New `useForShown = computed(() => model() !== null && detailAccount() === null)`. `ptah-account-use-for` renders only when it is true. The "Accounts" heading was already rendered only in the list branch, so the detail now starts directly under the drawer tab strip with "All accounts". Only rendering changed: the `ProviderAccountsStateService` view, the snapshot, the `model` computation and the ambient read stay alive (test checks `accounts.open` is still called only once).
   - The region's `aria-labelledby` (Use for heading) now follows `useForShown()`. While the detail is open it falls back to `aria-label="Claude accounts"`, so it never points at a missing id.
   - Focus: going back to the list still lands on the exact `Manage <label>` trigger (covered by the existing test and the new one).
4. **Moderate, focus box on `[data-testid=ambient-status]`** (`ambient-account-row.component.ts`). The element already had `outline-none`, but the glass theme's global `:root[data-glass='on'] :focus-visible { outline …; box-shadow … }` (`apps/ptah-extension-webview/src/styles.css:3138-3140`) is more specific. Added `focus:!outline-none focus:!shadow-none` to this programmatic-only target (tabindex -1) only. Interactive controls keep their `focus-visible` rings.

## Tests

- New tests in `accounts-tab.component.spec.ts`:
  - "hides Use for while the detail is open …": checks that Use for is absent, the heading is absent, the region is labelled "Claude accounts", `open` is called once, Use for comes back with `aria-labelledby` after Back, and focus returns to "Manage Work".
  - "reflows rows at narrow width …": checks the name `title` on a 56-char label, `break-words`, `min-w-0` / `basis-40` on the body, `ml-auto` on the actions, `flex-wrap` on the chip row and `whitespace-normal` on each chip.
- Updated in `accounts-tab.component.spec.ts`: "a saved sign-out announces … focus stays where the user moved it" and "keeps focus where the user moved it while the removal ran". Both used to focus the Use-for `<select>`, which is no longer rendered in the detail view. They now focus a control outside the tab (a stand-in for the drawer tab strip, removed in `afterEach`). The behaviour checked is the same (B-2: focus elsewhere is not moved).
- `account-detail-view.component.spec.ts`: the tablist has both `flex` and `flex-wrap`.
- `ambient-account-row.component.spec.ts`: the focused status carries `focus:!outline-none focus:!shadow-none`.

Command (from the worktree, run under the verify lock):
`node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --testPathPatterns=accounts`

- Run 1: `1 task: 0 succeeded, 1 failed`, with `Tests: 2 failed, 2 skipped, 4793 passed` (273 suites ran; the path filter did not narrow the run). The 2 failures are the two focus tests above, which depended on the Use-for select inside the detail. Both were fixed as described.
- Run 2: `NX 1 task: 1 succeeded`, `lock released … exit code 0`.

Not run: lint, typecheck, build and e2e (outside the brief). Not checked again in Electron at 245 px / 200% zoom; the visual reviewer should re-measure `accounts-tab-row` geometry and `native-drawer-body` scrollWidth.

## Decisions

- Row wrap point: `basis-40` (10rem) on the text column instead of a viewport breakpoint. The drawer width, not the viewport, decides the layout, so a container-relative flex basis matches the prototype's reflow without a container query. Reversible by changing the basis.
- Used `!important` utilities for the ambient status. A plain `focus:outline-none` loses to the glass `:focus-visible` rule's specificity (0,3,0), so it would not remove the box. The change is limited to the one tabindex -1 element.
