# Fix C2 report: TASK_2026_629_c0b3 (F-A, F-B, F-C from recheck-s12-report.md)

Worktree W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`, HEAD b648b6e57.
No git operation was run. `libs/frontend/canvas/src/lib/canvas-detail/*` was not touched (its diff belongs to the codex writer).

## Verdict

All 3 findings fixed in component styles only. The global `styles.css` and theme config are unchanged. Both changed specs pass.

## Files

- MODIFIED `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts`: F-A (per-theme focus frame) and F-B (pill ink)
- MODIFIED `W\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.spec.ts`: the focused-frame assertions now expect the new variable; new F-A and F-B assertions; the CSS-source parser now drops the decorator text in front of the first rule
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.ts`: F-C (scoped quiet-tier rule)
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-focus-header.component.spec.ts`: new F-C case

## Method for the ratios

I computed every ratio with WCAG 2 relative luminance (culori 4.0.2 `wcagContrast`, the repo's own dependency, the same one
`apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts` uses). Token values come from
`apps/ptah-extension-webview/tailwind.config.js:80-189`. `color-mix()` is reproduced with culori `interpolate` in the
same space (oklch uses the shorter hue arc, oklab is linear). The computed "before" values match the Electron measurements in
`recheck-s12-report.md` (for example #222339 focused surface, 1.40 / 1.25, 4.18 / 4.08 / 3.18, 15.92 / 14.21), so the
model reproduces the live app. The one exception: light `primary-content` #004a45 on #faf7f5 computes to 9.80:1. The
running app measured 9.53:1 for the split-header bar (the sub-pixel blend of an inset shadow).

| Token | anubis (dark) | anubis-light |
|---|---|---|
| base-100 (page) | #131317 | #faf7f5 |
| base-200 (unfocused card) | #1a1a20 | #efeae6 |
| base-300 | #242430 | #e7e2df |
| base-content | #e8e6e1 | #291334 |
| base-content-muted (`--bcm`) | #989291 | #745665 |
| primary | #2563eb | #44ebd3 |
| primary-content | #f8f7f4 | #004a45 |
| focused surface `color-mix(in oklch, p 14%, b2)` (unchanged) | #222339 | #f0e5d5 |

## F-A: focused Rail card frame in anubis-light (Serious)

**Change.** `compact-rail-card.component.ts:52-63` adds a component variable, `--rc-focus-frame: oklch(var(--p))` on `:host`
and `oklch(var(--pc))` under `:host-context([data-theme='anubis-light'])`. This is the same per-theme pattern Fix H used in
`canvas-focus-header.component.ts:23-24`. `:host(.rc-focused)` at `:166-172` now paints `border-color` and the
`inset 0 0 0 1px` ring from `var(--rc-focus-frame)`. The primary tint (`background-color`), the 1 px border plus 1 px inset
ring geometry and the rule order after `:host(:hover)` are unchanged, so there is still no size change.

| Theme | Frame | vs page b1 | vs unfocused card b2 | vs focused surface (inside) |
|---|---|---|---|---|
| anubis-light, before | #44ebd3 (primary) | 1.40 | 1.25 | 1.20 |
| anubis-light, after | #004a45 (primary-content) | **9.80** | **8.75** | 8.40 |
| anubis, before = after | #2563eb (primary) | 3.59 | 3.35 | 2.97 |

Both themes now clear 3:1 against the page and the adjacent unfocused card. The tint stays a secondary cue (1.04:1 light,
1.13:1 dark against the unfocused card).

## F-B: state pill text on the focused surface (Serious)

**Change.** `compact-rail-card.component.ts:190-196`: `.rc-pill { color: color-mix(in oklab, var(--rail-state-ink) 70%,
oklch(var(--bc))); }`. The pill text is pulled 30% toward base-content. That lightens it in dark and darkens it in light, so
one rule raises the contrast in both themes. I mixed in OKLab, not OKLCH. An OKLCH mix would rotate hue along the shorter arc
toward base-content's hue: dark err (hue ~25) would drift toward orange (~46) and collide with `need`, and run blue would drift
toward cyan. OKLab keeps each hue and only moves lightness and chroma.

The left stripe, the status dot, the hover border, the focus outlines and the callout still use the raw `--rail-state-ink`.
Those are UI marks under the 3:1 rule (D13), so they are unchanged.

Pill text after the fix (10 px, needs 4.5:1). Before values are the raw inks.

| Theme / state | Before ink | Before: focused / b2 | After ink | After: focused / b2 / b1 |
|---|---|---|---|---|
| anubis run | #3b82f6 | 4.18 / 4.71 | #71a3f3 | **6.02** / 6.79 / 7.27 |
| anubis need | #f97316 | 5.48 / 6.18 | #f89966 | **7.12** / 8.03 / 8.59 |
| anubis err | #ef4444 | 4.08 / 4.60 | #f47e74 | **5.91** / 6.67 / 7.13 |
| anubis done | #16a34a | 4.66 / 5.25 | #6bb878 | **6.40** / 7.22 / 7.72 |
| anubis idle | #6b7280 | 3.18 / 3.58 | #8f939c | **4.99** / 5.63 / 6.02 |
| light run | #2a56c6 | 5.20 / 5.42 | #304297 | **7.17** / 7.48 / 8.37 |
| light need | #8f5200 | 5.00 / 5.21 | #6e4026 | **6.96** / 7.25 / 8.12 |
| light err | #b4232a | 5.25 / 5.47 | #872433 | **7.24** / 7.55 / 8.45 |
| light done | #13713a | 4.89 / 5.10 | #28553c | **6.87** / 7.16 / 8.02 |
| light idle | #6b6570 | 4.54 / 4.73 | #564b5e | **6.58** / 6.86 / 7.68 |

Minimum after the fix: 4.99:1 (dark idle on the focused tint). On the unfocused surface (b2) the minimum is 5.63:1. The same
rule also lifts the dark idle pill on b2 from 3.58 to 5.63 (pre-existing M5). The states stay distinguishable: hues are
unchanged and the smallest pairwise OKLab distance between the five pill inks drops from 0.104 to 0.073 (dark) and from
0.116 to 0.081 (light). Both values are well above a just-noticeable difference (about 0.02). The pill also carries the
state word itself.

For reference I also checked 75%: dark idle on the focused tint would be 4.67, too close to 4.5 given the 0.27 gap between
the computed and measured values for the light frame. 70% leaves about 0.5 of headroom.

## F-C: inactive split header not quieter in anubis-light (Moderate)

**Change.** `canvas-focus-header.component.ts:28-34`: `.pane-quiet .text-base-content-muted { color: oklch(var(--bcm,
var(--bc))); }`. This is the same value the `text-base-content-muted` utility emits, written the way
`declarative-dashboard/.../surface-renderer.component.ts:105` already reads the token. With Angular's emulated encapsulation the
selector compiles to `.pane-quiet[_ngcontent-x] .text-base-content-muted[_ngcontent-x]` (specificity 0,4,0). That beats the
global `[data-theme='anubis-light'] .truncate` (0,2,0, `styles.css:2071`), which is left unchanged.

The rule needs no theme check. In dark it resolves to the color the utility already paints, so nothing changes there. It
reaches only elements that carry the muted class inside a quiet header: the title `strong`, the branch and model chips, and
the inactive marker, which already rendered muted. The state chip keeps its state ink, and the active header has no
`.pane-quiet`.

| Theme | Element | Before (inactive = active) | After (inactive) | Active (unchanged) |
|---|---|---|---|---|
| anubis-light | title on base-100 | #291334 15.92 | #745665 **6.03** | #291334 15.92 |
| anubis-light | chips on base-200 | #291334 14.21 | #745665 **5.39** | #291334 14.21 |
| anubis | title on base-100 | #989291 6.06 (already muted) | #989291 6.06 | #e8e6e1 14.86 |
| anubis | chips on base-200 | #989291 5.66 (already muted) | #989291 5.66 | #e8e6e1 13.89 |

The inactive text is now clearly quieter than the active one in both themes and stays at or above 5.39:1, above 4.5:1.

## Specs

- `compact-rail-card.component.spec.ts`
  - `marks only the focused card…` now asserts `border-color: var(--rc-focus-frame)` and
    `box-shadow: inset 0 0 0 1px var(--rc-focus-frame)`, `:host` frame `oklch(var(--p))` and the anubis-light
    `:host-context` frame `oklch(var(--pc))`. It still checks paint-only properties, no hex, and the rule placed after hover.
  - New case `F-B: the 10px state pill…` asserts the `.rc-pill` color-mix rule.
  - Parser fix (`:66-72`): the first rule's selector chunk also held the decorator text up to the `styles` backtick. It is now
    stripped so the `:host` rule can be found by its selector. Existing selector-order assertions are unaffected.
- `canvas-focus-header.component.spec.ts`
  - New case `F-C: the quiet tier restates the muted token…` asserts the scoped rule in the component source. The match is
    whitespace-tolerant, because Prettier would wrap it. It also asserts that the quiet title and both chips carry
    `truncate` and `text-base-content-muted` inside `.pane-quiet`.

## Verification (through the lock, from W, one spec per command)

| Command | Result |
|---|---|
| `node .ptah/tmp/check-run.mjs c2-chatui-railcard -- npx nx test @ptah-extension/chat-ui --testFile=libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. Test Suites 1 passed. Tests 21 passed, 21 total |
| `node .ptah/tmp/check-run.mjs c2-canvas-header2 -- npx nx test @ptah-extension/canvas --testFile=libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | exit 0. Test Suites 1 passed. Tests 19 passed, 19 total (re-run after making the regex whitespace-tolerant; the first run, `c2-canvas-header`, was also 19/19) |
| `ptah_get_diagnostics` on the 4 changed files | 0 errors in the requested files. The 11 errors it listed are in sibling files I did not touch (`orchestra-canvas.rail.spec.ts`, `streaming-quotes.component.spec.ts`, `compact-session-activity.component.spec.ts`, `compact-session-metrics.spec.ts`, `core/testing/mock-rpc-service.ts`, `shared/capability-id-codec.ts`) and exist at HEAD |
| `npx prettier --check` on the 4 files | warns on all 4, but the HEAD versions of all 4 already fail `--check`. I did not reformat them, to keep the diff to the 3 findings. Prettier's output for the new lines keeps the spec assertions valid (only the F-C rule would wrap, and that regex tolerates it) |

Not run: lint, typecheck targets and any build or serve, per the bounded scope and CLAUDE.md. Rendered colors in Electron
were not re-measured here. The ratios above are computed, and the orchestrator's scoped visual re-measure confirms them live.

## Kept

The row-110 ⋮ actions stay inside the card. The row-77 display dock, `canvas-rail-card.component.ts` and the row 80/82/83/85/86
Rail split focus behavior are not touched. The card geometry is unchanged (no padding, border-width or height change).

## Decisions

1. **F-A per-theme variable on the compact card, not in the canvas wrapper.** `rc-focused` and its frame live in
   `compact-rail-card.component.ts` (chat-ui), so the variable is declared there. The `:host-context([data-theme='anubis-light'])`
   pattern copies Fix H and the repo precedents it cited (`git-ui/.../open-in-button.component.ts:48`,
   `declarative-dashboard/.../surface-renderer.component.ts:121`). The light tint is left on `primary`. It is a secondary cue,
   and darkening it toward `primary-content` would lower the muted-text contrast on the focused card.
2. **F-B: one rule for every pill, not only `:host(.rc-focused) .rc-pill`.** A focused-only rule would make a card's pill
   change color when it is focused. It would also leave dark idle at 3.58:1 on unfocused cards, which fails the brief's
   "unfocused stays >= 4.5" check. The global pill rule fixes both. It changes pill text only. The `--state-ink-*` tokens and
   every UI mark (stripe, dot, hover border, outlines, callout border) stay on the raw inks and under D13's 3:1 rule, so this
   does not reopen M5 for those marks.
3. **F-B mix space OKLab at 70%.** OKLCH rotated err toward orange and run toward cyan. 75% left only 0.17 of headroom on dark
   idle. 70% gives at least 4.99:1 with every hue kept.
4. **F-C theme-agnostic scoped rule instead of `:host-context([data-theme='anubis-light'])`.** It restates the same muted token
   the utility already applies, so it is a no-op in dark and in any theme without the `.truncate` override. In any theme with
   such an override, it wins. That is one rule, and no per-theme list to keep in sync.

## Out-of-scope observations (not touched)

- `canvas-focus-header.component.ts:12-16`: the header state chip (`text-xs` on `bg-base-200`) uses the raw state inks. Dark
  idle is 3.58:1 and dark err 4.60:1 on b2, so the same M5 text tier applies there. Owner: C-headers, or the M5 follow-up.
- `canvas-rail.component.ts:51-63` colors text with the raw `--state-ink-*` values. If any of that is text below 18.66 px
  bold or 24 px regular, the same 4.5:1 gap applies. It needs a check by its owner.
- The pre-existing Prettier drift in all 4 files (HEAD already fails `--check`) will be reformatted by lint-staged at commit.
