# Visual fix report — TASK_2026_658, visual-review Serious 1 + Moderate 3

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-advanced-settings-ui` (not committed).

## Changes

File `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts`:

- `:224-226`: the client error `<p>` now has `role="alert"` and `class="text-error"`. Its `id` stays the same, so the input's `aria-describedby` (`describedBy(setting)`) and `aria-invalid` work as before.
- `:193` and `:268-274`: an invalid number input now gets the new `errorBorder` constant, `'input-error !border-[color:var(--ptah-error-ink,oklch(var(--er)))]'`, where it used to get only `input-error`. A doc comment explains the override.
- `:163-170`: the toggle's `<span>Enabled</span>` is now `{{ booleanValue(setting) ? 'Enabled' : 'Disabled' }}` with `data-testid="advanced-setting-<key>-state"`. `booleanValue` reads the saved value from the host, so the text changes only after a confirmed write.

No changes to badge size, layout, spacing or any other markup.

File `...advanced-settings-group.component.spec.ts`:

- `:325-339` "styles and announces a client error, with a forced error border": before an error the input has no `input-error`. After entering `0`, the error has `role="alert"` and `text-error`, and the input has `input-error` plus the forced border class.
- `:388-401` "the text beside the toggle follows the read-back value": the text reads `Enabled`, then `Disabled` after a confirmed write.
- `:403-417` "the text stays at the saved value when the write fails": the text stays `Enabled` when the write throws.

## Theme evidence

### Why the light-theme border did not show

- `apps/ptah-extension-webview/src/styles.css:2062` opens an unlayered `[data-theme='anubis-light'] { ... }` block. At `:2130-2136` that block sets `.input, .textarea, .select { border-color: oklch(var(--b3)); }`. That selector's specificity is (0,2,0).
- daisyUI 4.12 (`package.json:264`, `^4.12.24`) defines `.input-error` at (0,1,0) in the components layer. The light rule therefore beats it, and the border is `--b3`. Against an input filled with `--b1` that measures 1.20:1, which is effectively invisible.
- Adding `border-error` would not help. Its anubis override at `styles.css:1991` is also (0,2,0), but it comes earlier in the file than `:2134`, so the `.input` rule still wins.
- The anubis dark theme has no such `.input` rule, which is why the reviewer saw a red border there.
- So the border has to be forced with `!`. The codebase already does this: `settings.component.html:82` uses `[class.!border-primary]`, and `tool-call-header.component.ts:115` uses `border-[color:var(--ptah-gold)]` for a token as an arbitrary value.

### Colour choice

I used the measured `--ptah-error-ink` token for the border, falling back to the stock `oklch(var(--er))`. The token is defined at `styles.css:1975-1980` (anubis `#f87171`, anubis-light `oklch(45% 0.22 20)`). `text-error` uses the same token in both anubis themes (`styles.css:1982-1987`), and `apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts:153-167` guards that link. In the other 32 themes the token is undefined, so the fallback gives the same colour as `input-error`.

Contrast below was measured with culori `wcagContrast` against the theme sources in `tailwind.config.js` (same method as `status-badge-contrast.spec.ts`). The section surface is `.surface-1` = `color-mix(b2 88%, b1)` (`styles.css:131`), which lies between b1 and b2.

| Theme | Layer | `--ptah-error-ink` (text-error, new border) | stock `--er` (old `input-error`) |
|---|---|---|---|
| anubis | b1 | 6.70:1 | 3.84:1 |
| anubis | b2 | 6.26:1 | 3.59:1 |
| anubis | b3 | 5.54:1 | 3.17:1 |
| anubis-light | b1 | 7.87:1 | 3.57:1 |
| anubis-light | b2 | 7.03:1 | 3.19:1 |
| anubis-light | b3 | 6.54:1 | 2.97:1 |

- **Error text** (`text-error`, 12 px): at least 6.26:1 on the surface (b1-b2) in both themes. This meets 4.5:1. `text-error` was not failing, so it needed no substitute token.
- **Border**: at least 6.26:1 against both the input fill (b1) and the surface. This meets the 3:1 non-text minimum (WCAG 1.4.11) with margin. The stock `--er` would have passed only narrowly in light (3.19:1 on b2) and fails on b3 (2.97:1).

## Verification (from the worktree)

- `npx prettier --write` on the 2 files: both reported "unchanged" after the edits.
- `npx eslint` on the 2 files: printed no problems.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts --coverage=false --maxWorkers=2`: `Test Suites: 1 passed, 1 total` / `Tests: 35 passed, 35 total` (3 new).
- Not run, as instructed: a rendered or browser re-check and any nx/build target. The CSS reasoning above has not yet been confirmed in a re-capture of the screen. A visual re-review should confirm the red border in light at 360 and 1000 px.

## Decisions

- **Announcement**: `role="alert"` is on the error `<p>` rather than writing into the group `role="status"` line. The message sits next to its field, stays the `aria-describedby` target, and `@if` inserts it into the DOM, so it is announced when it appears. The status line keeps reporting writes only.
- **Error colour**: `text-error` on the whole message. This deliberately differs from the output-style editor, which keeps the text `text-base-content` and colours only an icon. The task asked for an error-coloured message, and `chat-transcript.component.html:101-104` already sets 11 px error text in `text-error`. No icon was added, to stay within "no other changes".
- **Border**: forced with `!` plus `var(--ptah-error-ink, oklch(var(--er)))`. Plain `!border-error` would also override the light `.input` rule, but its `!important` would also beat the anubis `.border-error` ink override and fall back to stock `--er`, which is at most 3.57:1 and 2.97:1 on b3. `input-error` is kept so daisyUI's own error-state styling stays.
- **Not changed (out of scope)**: the light-theme `.input` rule in `styles.css:2130-2136` is the root cause. It also hides `input-error` on the output-style editor inputs (`output-style-editor.component.ts:240,284`). Fixing it globally, for example with `.input:not(.input-error)`, belongs to a styles.css change outside this batch.
