# Batch 19 report — Stats tiles and stats summary integration

Executor: frontend-developer. No git was run. `batches.md` was not edited. Only `libs/frontend/chat-ui/**` was touched.

## Files

Root: `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-ui\src\lib\molecules\session\`

- CREATED `plan-limits\plan-limit-tile.component.ts` — `ptah-plan-limit-tile`. Shows a window, evidence, cooldown or status tile.
- CREATED `plan-limits\plan-limit-tile.component.spec.ts` — 9 cases.
- CREATED `plan-limits\lane-usage-tile.component.ts` — `ptah-lane-usage-tile`. One tile per CLI + role. Its panel shows the subgroups.
- CREATED `plan-limits\lane-usage-tile.component.spec.ts` — 9 cases, including `it.each` over null and absent `usageTotals`.
- CREATED `plan-limits\lane-subtotal-tile.component.ts` — `ptah-lane-subtotal-tile`.
- CREATED `plan-limits\limits-alert.component.ts` — `ptah-limits-alert`, `role="status"`, variant A.
- CREATED `plan-limits\plan-window-detail.component.ts` — `ptah-plan-window-detail`. Shows full window detail with a `role="meter"` bar. Not in the batch file list (see Plan deviations).
- CREATED `plan-limits\stats-tile.styles.ts` — class strings and the panel-id generator shared by the tiles. Not in the batch file list (see Plan deviations).
- MODIFIED `session-stats-summary.component.ts` — adds the `limits` and `sessionId` inputs, the alert slot, the LANES pill and the tile slots, and injects `StatsTileExpansionState`.
- MODIFIED `session-stats-summary.component.spec.ts` — the 11 existing cases are unchanged. A new `describe('… limits')` adds 10 cases.

## Stack observed

- Angular 22.1.7 (`package.json:95`): standalone, OnPush, signal `input()`/`output()`, `inject()`. Pattern copied from `session-stats-summary.component.ts` and `atoms/expandable-content.component.ts`.
- Tailwind 3.4 and daisyUI 4.12 (`package.json:261,283`).
- `lucide-angular` is used for the chevrons, as in `expandable-content.component.ts:7`.
- Tailwind content includes dependency `.ts` files (`apps/ptah-extension-webview/tailwind.config.js:6-8`), so class strings in `stats-tile.styles.ts` are compiled.
- Text-colour rule: `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`.

## Per-task evidence

### Task 19.1 — tile and alert components

- All four components are standalone, OnPush and use signal inputs.
- Plan and lane tiles: the face is a `<button type="button" [attr.aria-expanded] [attr.aria-controls]>`.
  - The panel is the `nextElementSibling`, with `[hidden]` while closed. Detail content renders only while the tile is open.
  - Panel ids are document-unique (`ptah-stats-tile-panel-N`).
  - Enter and Space come from the native button. No key handler is added. The spec asserts it is a `BUTTON` of `type=button`.
- Focus ring: `focus-visible:outline-2 outline-offset-2 outline-info` (2px info, offset 2px).
- An open tile adds `col-span-full` to its host, which spans the 2/3/4-column container grid. The squared bottom joins it to the `border-t-0` panel.
- `role="status"` is on the alert. `role="meter"` bars carry `aria-valuenow`, min/max, `aria-valuetext` and the name "<window> used".
  - The fill is neutral (`bg-base-content/70`) with a tick at `NEAR_LIMIT_PERCENT` from shared. Stripes on error/warning are decoration.
  - With no percent there is no meter. The row reads "Used: unknown".
- Glyphs and chevrons are `aria-hidden`. The glyph text comes from the view model (design §4 glyphs).
- Semantic colour is used only for borders and 15% tints. All text is `text-base-content` or `text-base-content-muted`. A spec asserts no `text-(error|warning|success|info)`.
- Lane tiles carry the caption "lane · not in totals" (`LANE_CAPTION`), `border-dashed` and `bg-base-300/40`. Source chips for the Unofficial and `~ Estimate` labels are dashed and italic; the match is keyed off `PLAN_LIMIT_SOURCE_LABELS`.
- The live run chip has a `motion-safe:animate-pulse` dot (opacity only, respects reduced motion).
- Notes in the lane panel use their model tone: `info` gives an info left rule and `neutral` a neutral rule. They never get warning or error styling. A spec covers this.
- Tiles start closed: the `open` input defaults to `false`, and the host owns the state.

### Task 19.2 — `SessionStatsSummaryComponent`

- `limits = input<StatsLimitViewModel | null>(null)` and `sessionId = input<string | null>(null)`.
- The expansion state is `inject(StatsTileExpansionState, { optional: true }) ?? new StatsTileExpansionState()`. Keys go through `expansion.isOpen/toggle(sessionId ?? '', tile.id)`, which gives `${sessionId}::${tileId}`.
- Collapsed view: `ptah-limits-alert` sits above the scrolling strip. It is outside `.overflow-x-auto`, and the spec checks this. The LANES pill comes directly after the Cost pill and is titled "Lane runs are counted separately from session totals".
- Expanded view: plan tiles, then lane tiles, then the subtotal, all after the existing cards in DOM order. There is no `dense`; the spec asserts both the class and the style.
- With `limits` null, the spec checks that the collapsed `innerHTML` is the same whether `limits` and `sessionId` are left unset or set to null. It also checks that the expanded grid order is exactly today's: Context, Tokens, Cost, Agents, Models, Collapse.
- "Context" is kept, and a spec asserts there is no "Main context".
- F57 at component level: the spec opens a plan tile and a lane tile, then pushes a new `limits` object. Both stay open. A collapse/expand re-render destroys and recreates the tiles, and they are still open afterwards.
- Session keying: switching to session-2 shows the tile closed, and switching back to session-1 shows it open.
- With a provided `StatsTileExpansionState`, the open state is shared with the view in both directions.

## Carry-forwards handled

- **Unknown is never 0.**
  - A `null` or absent `usageTotals` renders "unknown tokens", "cost unknown", "Tokens unknown" and "Cost unknown" (`it.each`).
  - An unknown used value draws no meter.
  - No text is synthesised by the components; all of it comes from the Batch 18 view model.
- **`model-scope-unknown` and `estimated-limit` are informational.** Notes render with their own `info` or `neutral` tone, never as warnings (spec "renders informational notes as info, never as a warning").
- **Time zone and locale are explicit.** The components format no times. Specs build the view model with `{ timeZone: 'UTC', zoneNameLocale: 'en-GB' }` and assert "today 15:10 UTC".
- **A3:** covered by the `StatsTileExpansionState` keying in Task 19.2 above.
- **The harness-builder host passes no `limits`, so its output is unchanged.** See the null-`limits` spec.
- **Req 8 / User Gate 1.7:** plan windows and lanes are tiles in the same card grid, each expandable, one tile per lane. Lane totals are never added to the Tokens or Cost cards; a spec checks that Tokens stays at the snapshot value.
- **`text-base-content/NN` is not used.** The design's `/70` and `/80` text was replaced with `text-base-content-muted` (secondary text) and `text-base-content` (chips), as the guard requires. The guard passed in `ptah-extension-webview:test`.
- **Boundaries:** chat-ui imports only `@angular/*`, `lucide-angular`, `@ptah-extension/shared` and local files. No orchestrator lib and no settings files.

## Verification

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat-ui ptah-extension-webview` (foreground, no extra flags), final run after prettier: all 6 targets passed ("Successfully ran targets typecheck, test, lint for 2 projects").

Counts from direct jest runs of the same configurations:

| Project | Suites | Tests |
| --- | --- | --- |
| chat-ui | 45/45 | 497/497 |
| ptah-extension-webview (includes the no-alpha guard) | 15/15 | 397/397 |

Lint has 0 errors and 1 warning: `max-lines` on `session-stats-summary.component.ts` (826 counted lines, limit 700, warn level). I estimate the file was already about 750 counted lines before this batch (it was 874 raw lines), so the warning predates this batch. The batch adds about 75 lines.

## Plan deviations

1. **Two helper files outside the listed four components.**
   - `plan-window-detail.component.ts`: the same window-detail markup, with its meter, is needed by the plan tile panel and by different-owner lane subgroups. Keeping one copy keeps meter accessibility consistent.
   - `stats-tile.styles.ts`: the tone-to-class maps are shared by three components.
   - Neither is exported from the lib barrel. Both are internal to `plan-limits/`.
2. **The subtotal tile is not a disclosure.** The view model has no detail for it beyond its face, and the prototype's `.tile.sub` has no chevron. A button with an empty panel would be noise. The `lanes-subtotal` id stays unused for expansion.
3. **The tiles are inserted before the existing "Collapse stats" button card**, not after it, so the collapse control stays last as it is today. Every session card still precedes the tiles.
4. **Text tokens.** Design §3.2/§8 asks for `text-base-content/70` and the chip `text-base-content/80`. Both are banned by the guard and the batch instructions. I used `text-base-content-muted` and `text-base-content`. The light-theme contrast concern is the same one already carried to the Phase 6 visual review for Batch 21.
5. **Alert text spacing.** The alert puts `&ngsp;` between "Limits" and the state, so `role="status"` announces "Limits Near · …" rather than "LimitsNear". The existing pills keep their adjacent-span pattern.

## Out-of-scope observations

- The view model's alert text reads "resets today 15:10 UTC". The design example is "resets 15:10". This comes from Batch 18 `indicatorFor`. It was not changed here.
- `session-stats-summary.component.ts` was already over the 700-line `max-lines` warning before this batch. A future split of the per-model table template would clear it.
