# Fix report: P6 visual-review findings (`visual-review-p6.md`)

These are template and class changes only. No behaviour changed and no spec file was edited.

## Changes per finding

1. **Serious 1: the lane Account trigger is 16 px tall.**
   `libs/frontend/chat/src/lib/settings/ptah-ai/claude-lane-account-cell.component.ts:33-37`: added `min-h-6 py-0.5` to `CELL`, so the trigger is now at least 24 px tall. These are unchanged: `max-w-[13rem]`, the inner `truncate` span, `title` and `aria-label`.
2. **Serious 2: the popover header overflows at 245 px and clips Close.**
   `libs/frontend/chat/src/lib/settings/providers/main-agent-reassign-popover.component.ts:100-111`:
   - The header row now has `min-w-0`.
   - The title `h2` now has `min-w-0 flex-1 truncate` and a static `title="Reassign main agent"`.
   - The action group now has `min-w-0`.
   - The Check connection button now has `min-w-0 flex-nowrap`, and its label sits in a `<span class="truncate">`.
   - Close is now `flex-none`, so it always stays in view.

   The text of the title and the Check button is unchanged; the specs read it with `textContent.trim()`.
3. **Moderate 1: the "Used by" chips use 10 px text.**
   `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:216`: added `text-xs` to the chip.
4. **Moderate 2: in the light theme, row cards and chip outlines lose their border.**
   `accounts-tab.component.ts:190` (named row card), `:216` (chip) and `:261` (loading card): `border-base-300` became `border-base-content/15`. The chip also gets an explicit `border-base-content/15`. This reuses the settings border token from `settings/feedback/settings-toast.component.ts:82` (`border-base-content/15`). Other settings cards use `/10` (for example `ptah-ai/session-budget-settings.component.ts:208` and `advanced/advanced-settings-group.component.ts:148`). I chose `/15` because it is closest to the prototype edge (`--edge`: 15 % dark, 18 % light, `prototype/p6/index.html:9-10,50`). Unlike `base-300`, it is derived from the text colour, so it stays visible on the light base.
5. **Moderate 3: the actions wrap left-aligned at 320 and 245 px.**
   `accounts-tab.component.ts:221`: the action group is now `ml-auto flex shrink-0 items-center justify-end gap-2`. The row already uses `flex-wrap`. When the actions wrap to their own line, they stay right-aligned.

## Verification

Command, run once from the worktree:

`node D:/projects/ptah-extension/scripts/verify.mjs -t test -p @ptah-extension/chat -- --output-style=static -- "--testPathPatterns=claude-lane-account-cell|main-agent-reassign-popover|accounts-tab"`

- Test Suites: 3 passed, 3 total
- Tests: 139 passed, 139 total

No rendered re-capture was taken: this lane was limited to unit tests. A visual re-review in Electron at 245, 320 and 520 px, in both themes, should confirm the fixes.

## Decisions

- **Border token.** Options: `border-base-content/10` (the most common in settings) or `/15` (settings toast, closest to the prototype edge). I chose `/15`. Evidence: the prototype's `--edge` alpha is 0.15 and 0.18. This is reversible.
- **Popover header.** Options: truncate or wrap. I chose truncate, as the brief asked. The full title stays available through `title`, and the dialog's `aria-labelledby` text is unchanged. This is reversible.

## Out-of-scope observations

- `providers/accounts/ambient-account-row.component.ts:53` (the "Existing Claude login" row) and `account-detail-view.component.ts:172` and `add-account-form.component.ts:41` still use `border border-base-300`. They have the same light-theme border loss, but these files are not in this lane's ownership. The ambient row also renders chips, which likely need the same `text-xs` and border change.
