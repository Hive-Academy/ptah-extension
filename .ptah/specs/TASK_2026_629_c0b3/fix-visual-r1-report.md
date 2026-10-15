# Fix report: PR #730 visual review, fix round 1 (F-1, F-2, F-3, M-2)

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5` (W). Source: `visual-review-pr730-fixes.md`.
No git state was changed. `decisions.md` and the other task-folder files were not touched; this report is the only task-folder write.

## Results

| Finding | Cause | Fix (file:line) | Test / measurement | Result |
| --- | --- | --- | --- | --- |
| F-1 setup card contrast | The card itself, not the host. On `main`, `canvas-empty-state.component.ts` gave the card no surface either (only `class="w-full mt-8"` on a plain `p-8` column), so the empty board did not remove a backdrop. The card used raw hues as ink: `text-warning`, `btn-primary btn-outline` (primary text on a light box) and `text-primary`. In anubis-light, `primary` is a bright teal (`#44ebd3`) and `warning` is `#f77f00`, both near the cream. In anubis, primary `#2563eb` on the dark glass is about 3.2:1. The `chat-empty-state` (`showProjectSetup`) use had the same failure. | `libs/frontend/chat/src/lib/components/molecules/setup-plugins/project-setup-card.component.ts`: `:42` warning icon and `:46` warning title now use `text-state-need`, the per-theme warning ink with fallback `--wa`. The `:55` button is a filled `btn btn-xs btn-primary` (outline removed). The `:73` icon tile is `bg-primary text-primary-content` (was `bg-primary/10 text-primary`). The `:83` title is `text-base-content`. The class JSDoc `:23-28` records why. | `node .ptah/tmp/fix-visual-r1-contrast.cjs` reads the literal theme tokens from `apps/ptah-extension-webview/tailwind.config.js` (culori `wcagContrast`) and composites over the real surfaces: the warn box is `base-200/50` on `base-100`, and the glass is `.glass-panel` rgba on `base-100`. Its "before" values match the reviewer's measurements (light 1.44 / 1.33 / 2.33; dark 3.16 / 3.49). See the contrast table below. | PASS: every text is at least 4.82:1 in both themes. No spec was added (the lib has no spec for this card); the measurement script is the evidence. |
| F-2 "No sessions yet" clipped in the 56 px Rail | `canvas-rail.component.ts` had one paragraph (`px-3 text-sm`) for both widths. At 56 px the inner width is 55 px with `overflow-x: hidden`, so it wrapped and clipped. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:177-195`. When collapsed, it shows a centred `aria-hidden` "—" plus an `sr-only` "No sessions yet". This matches the collapsed Rail's glyph-only content (`›`, `+`, card numbers). When expanded, the paragraph is unchanged. Both forms have `data-testid="rail-empty"`. | `canvas-rail.component.spec.ts:113` "shows a compact zero state in the collapsed 56 px rail…": expanded text, collapsed visible "—", the sr-only text, and no `px-3`. The existing "shows the zero state…" test still passes. | PASS |
| F-3 every card named "…, in focus" | `selectName` in `compact-rail-card.component.ts` appended `, in focus` unconditionally. | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts:438` now appends it only when `this.focused()`. This is the same input that sets the `rc-focused` frame, `aria-current` and `tabIndex`, and the same rule as the collapsed button in `canvas-rail-card.component.ts:113`. | `compact-rail-card.component.spec.ts:238` "names only the focused card…": unfocused gives `Session A, done` with no `aria-current`; focused gives `Session A, done, in focus` with `aria-current="true"`; back to unfocused gives the unfocused label. | PASS |
| M-2 toggle 15x24 px | `btn btn-xs` with one glyph. styles.css `.btn-xs` sets `padding-inline: var(--sidebar-spacing-xs)`, which gave a 15 px width. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:110` adds `min-h-6 min-w-6` (24 px; the same utilities `memory-pause-switch` and `go-vet-consent-config` use for 24 px targets). | `canvas-rail.component.spec.ts:125` checks that both classes are present, expanded and collapsed. Geometry: collapsed header inner width is 56 − 16 (`px-2`) = 40 px, which holds 24. When expanded, the extra 9 px comes out of the `flex-1 truncate` "Sessions" label, so the row does not reflow. The height stays 24 px from daisyUI `.btn-xs` `height: 1.5rem`. `min-h-6` is a floor, and the unlayered styles.css `.btn-xs { min-height: 20px }` may win over it, so 24 px is not guaranteed by it alone. jsdom has no layout, so the rendered 24x24 still needs a visual re-check. | PASS (unit); rendered size not re-measured |

### F-1 contrast from the theme token values (WCAG 2)

| Element | anubis before | anubis after | anubis-light before | anubis-light after |
| --- | --- | --- | --- | --- |
| "Skills Not Configured" title (text) | `#f97316` on `#16161c` 6.43 | `text-state-need` `#f97316` 6.43 | `#f77f00` on `#f4f1ee` **2.33** | `#8f5200` on `#f4f1ee` **5.53** |
| Warning icon (UI, 3:1) | 6.43 | 6.43 | 2.33 | 5.53 |
| "Open Marketplace Skills" (11 px text) | outline: `#2563eb` on box **3.49** | fill: `#f8f7f4` on `#2563eb` **4.82** | outline: `#44ebd3` on box **1.33** | fill: `#004a45` on `#44ebd3` **6.99** |
| "Intelligent Project Setup" title (text) | `#2563eb` on glass `#1f1f29` **3.16** | `#e8e6e1` on glass **13.09** | `#44ebd3` on glass `#fefaf5` **1.44** | `#291334` on glass **16.33** |
| Scan icon in tile (UI) | `#2563eb` on primary/10 2.89 | `#f8f7f4` on `#2563eb` 4.82 | `#44ebd3` on tint 1.38 | `#004a45` on `#44ebd3` 6.99 |
| Card body (`base-content-muted`) | unchanged (reviewer 5.86) | unchanged | unchanged (5.69) | unchanged |

Note on the filled button: in anubis-light its fill against the box is 1.33:1, the same as every `btn-primary` in the app, including the board's own "New session" and the card's "Configure". Under WCAG 1.4.11 a button's boundary is not needed when its text label (6.99:1) identifies it, so this passes.

## Decisions

- **The card is fixed, not the board.** The old `canvas-empty-state` supplied no surface (checked with `git show main:…/canvas-empty-state.component.ts`), so the failure belonged to the card. That means `chat-empty-state` (`showProjectSetup`) is fixed by the same change and gets no new styling. No board change was needed.
- **The warning ink is `state-need`, not `warning`.** `state-need` is a theme colour in `tailwind.config.js:33` (`var(--state-ink-need, oklch(var(--wa)))`). It is measured per theme (dark `#f97316`, light `#8f5200`) and guarded by `state-ink-contrast.spec.ts`. It keeps the orange warning hue, unlike `text-base-content`. No new token or global CSS was added. The alternative, a `[data-theme='anubis-light'] .text-warning` override in styles.css, would have changed every `text-warning` in the app, which is out of scope.
- **Title is base-content, button and tile are primary fills.** A primary-coloured title fails in both themes (3.16 and 1.44). Filled `btn-primary` and `bg-primary`/`text-primary-content` pairs are the app's tested ink-on-fill tokens (primary-content is documented in `tailwind.config.js` as 6.99:1 on the light primary).
- **Collapsed zero state is "—" plus sr-only text.** This follows the collapsed Rail's glyph language and the card's own "—" for an unknown value. It needs no new icon import in the Rail (it imports no lucide icons today). The accessible text "No sessions yet" is unchanged, so screen readers are unaffected.
- **Toggle target uses `min-w-6` (with `min-h-6`)**, not padding, so the glyph stays centred and the visible layout changes only by the 9 px the truncating title absorbs.

## Checks (all via `node .ptah/tmp/check-run.mjs`, sequential, one at a time)

- Changed spec, `npx nx test chat-ui --testFile=…/compact-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`, `Tests: 24 passed, 24 total`.
- Changed spec, `npx nx test canvas --testFile=…/canvas-rail.component.spec.ts …`: `Test Suites: 1 passed, 1 total`, `Tests: 14 passed, 14 total`.
- `npx nx test chat-ui --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 73 passed, 73 total`, `Tests: 1437 passed, 1437 total`. No `●` failures.
- `npx nx test canvas …`: `Test Suites: 23 passed, 23 total`, `Tests: 369 passed, 369 total`.
- `npx nx test chat …`: `Test Suites: 209 passed, 209 total`, `Tests: 2 skipped, 3936 passed, 3938 total`.
- `npx nx typecheck chat-ui|canvas|chat --parallel=1 --skip-nx-cache`: each "Successfully ran target typecheck".
- `npx nx lint chat-ui|canvas|chat --parallel=1 --skip-nx-cache`: 0 errors (7 / 31 / 51 warnings, all existing). The only warnings in a changed file are existing `no-non-null-assertion` warnings at `canvas-rail.component.spec.ts:62,101,110`, in existing tests.
- Not run: build, serve, e2e, workspace-wide checks, and a rendered re-shot of the four surfaces. The rendered contrast and the 24x24 toggle size need the next visual pass.

## Files changed

- MODIFIED `W\libs\frontend\chat\src\lib\components\molecules\setup-plugins\project-setup-card.component.ts`
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.ts`
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.spec.ts`
- MODIFIED `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts`
- MODIFIED `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.spec.ts`
- CREATED (scratch, git-ignored tmp) `W\.ptah\tmp\fix-visual-r1-contrast.cjs`, the F-1 measurement script
