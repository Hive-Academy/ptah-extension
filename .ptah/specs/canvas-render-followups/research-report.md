# Research Report - canvas-render-followups

## Question

- Decision: (A) go/no-go on zoneless change detection; (B) which DOM-size reductions to ship first.
- Bounds: no source edits, no web research. The 755 MB trace was not re-read; its figures are taken from the brief. Per-element counts below are static template counts (inferred), not measured. Checked at HEAD 0a0438384 (Angular 22.1.7, zone.js 0.16.3, Tailwind 3.4.18, DaisyUI 4.12, lucide-angular ^1.0.0).

## Answer

**A: No-go on zoneless as a fix for this lag.** JS is ~6% of main-thread time. The cost is style/layer/paint/layout (~265 s of 404 s), and zoneless does not touch it. Zoneless is also a risky migration here: 38 jest setups use the zone env. The cheapest useful step is to keep zone, add `runCoalescing: true`, and move the hot scroll and pointer listeners out of the zone.
**B: Shrink what each tile mounts and what hover touches.** Ranked wins: cut the transcript render-window margin for non-focused tiles (2000 px per side today), stop rendering hidden-until-hover toolbars on every message, and cut per-tool-row element and icon cost. Then fix hover-recalc and infinite animations, which are the likeliest causes of the Layerize and pointerout costs.

## A. Zoneless

| Evidence | Where |
| --- | --- |
| Zone CD configured with only `eventCoalescing`; `zone.js` polyfilled | `apps/ptah-extension-webview/src/app/app.config.ts:141`, `project.json:15` |
| 387 `@Component` files, 388 files mention OnPush. The only non-OnPush component is the root (`ChangeDetectionStrategy.Eager`) | `apps/.../app/app.ts:39`. The other 2 non-matches are services |
| `async` pipe: 0 uses | grep |
| `detectChanges`/`markForCheck` in prod code: 3 spots | `ui/.../option/option.component.ts:93,106`, `skill-synthesis-ui/.../lazy-diff-view.component.ts:175` |
| `isStable`/`whenStable`/`onStable`/`onMicrotaskEmpty` in prod code: none (test helpers only) | `core/src/testing/surface-router-testing.ts:77`, `marketplace/.../provider-list-view.testing.ts:218` |
| NgZone in 9 prod files, mostly `runOutsideAngular` plus `run` for re-entry | tab-bar:195/393/405, chat-view:149/349/449/492/526/557, electron-resize-handle:75-99, streaming-quotes:103, message-router.service:90/143/180/208, pierre-worker-pool:83, task-worktree-view, overview-tab, marketplace-layout |
| The message router already documents zoneless-safe behaviour ("zoneless host gets the no-op zone") and has a `provideZonelessChangeDetection` spec | `message-router.service.ts:20-24`, `.spec.ts:576` |
| Tests: 38 `test-setup.ts` call `setupZoneTestEnv`; 12 spec files use `fakeAsync` (80 use `tick`/`flush`/`waitForAsync`) | grep |
| 72 prod files use `setTimeout`/`setInterval`; `saveTabState` is a 500 ms trailing debounce with 5 s ceiling | `chat-state/.../tab-manager.service.ts:2558-2574` |
| Third parties: gridstack, @floating-ui/dom, marked, ngx-markdown 22, CDK 22.1.7 | package.json |

**Readiness.** The codebase is already close to zoneless-compatible: OnPush plus signals everywhere, no async pipe, almost no manual CD. Inferred risks:
- Mutable-field state set from callbacks (timers, third-party callbacks, gridstack events) without signals would stop rendering. Static grep cannot prove none exist. I checked only NgZone, markForCheck and timers.
- `toSignal`/`toObservable` appear in only 5 files, so rx-driven UI is minimal.
- ngx-markdown, CDK and floating-ui are not known to need zone, but only floating-ui and ngx-markdown imports were located. gridstack's callback bridge into Angular is unverified.
- Test migration is the real cost: all 38 setups, 12 `fakeAsync` specs, and `ComponentFixture` auto-detect semantics.

**Blast radius.** Prod: `app.config.ts`, `project.json` polyfills, roughly 9 NgZone files, about 72 timer files to audit. Tests: 38 setups plus 12 fakeAsync specs.

**Expected gain: small.** Timers (774 `saveTabState`, 1,156 zero-delay) and listeners each trigger an app tick under zone. With OnPush and signals, that tick is cheap and within the ~6% JS. It does not reduce style recalc, layerize or paint. Zoneless might trim EventDispatch overhead (67 s). That figure includes listener bodies, so the zone share is unknown.

**Cheapest high-value step (keep zone):**
1. Add `runCoalescing: true` next to `eventCoalescing`. This is one line.
2. Move `(scroll)` and pointer handlers that only read or write non-signal state out of the zone. The candidates are `chat-transcript.component.html:11`, `agent-monitor-panel.component.ts:557`, `inline-agent-bubble.component.ts:447`, `compact-session-activity.component.ts:566`, `agent-lane-scroll.directive.ts:13`, and `tab-bar.component.ts:91`. Use `addEventListener` inside `runOutsideAngular` and re-enter only when a signal must change. The pattern already exists in `electron-resize-handle`.
3. Run the `saveTabState` timer outside the zone. It only persists.

**Later, if wanted:** make a build-time flag for zoneless. Start with the Electron renderer only, since the router service already supports it. Do it after the test migration.

## B. DOM size

Static census, inferred, not measured.

**Mounted messages per tile.** `RENDER_WINDOW_MARGIN_PX = 2000` is applied as a vertical `rootMargin` on each side (`transcript-render-window.ts:9`, `:100`). Together with `ALWAYS_MOUNTED_TAIL = 6` (`:17`), this mounts about 4,000 px plus the viewport of bubbles in every tile. That is a large share of a short tile's height. Tile mode renders one transcript per tile (`chat-view.component.ts:625-630`); the main view keeps up to 8 hidden transcripts (`RETAINED_TRANSCRIPT_CAP = 8`, `transcript-retention.service.ts:19`).

**Per tool row** (`tool-call-item` plus `tool-call-header`, collapsed by default, `tool-call-item.component.ts:122`). I count about 20 elements and 3 lucide icons (chevron, tool icon, status). Each icon is a `lucide-angular` host, an `<svg>` and 1-3 path children. The row also has about 8 `@if` comment anchors and a separator of 4 divs (`:103-106`). A turn with 40 tool calls costs roughly 800 elements and 120 SVGs before any expansion.

**Per message.** Assistant bubbles carry an avatar, header, collapse button with chevron, footer with copy button plus icon, and badges. Users have 2 icon buttons. All of it is rendered, and the hover toolbars are only `opacity-0 group-hover:opacity-100`. They are in `message-bubble.component.html` for assistant and user. Every bubble is also wrapped in `.chat-msg-slot` (`chat-transcript.component.html:41`).

**Other contributors:**
- `animate-spin`/`animate-pulse` on running tools, agents and monitor rows (for example `tool-call-header` streaming loader, `agent-execution.component.ts:87,118,161`, `inline-agent-bubble.component.ts:147,260`, `agent-monitor-panel.component.ts:326,362,426`).
- `truncate`/`overflow-hidden` on almost every row span, each a scroll container. This is a likely source of the 2,051 scroll containers (inferred).
- `* { scrollbar-width: thin; scrollbar-color: ... }` on every element (`styles.css:580`). This is cheap per element but universal.

**Hover cost, a hypothesis.** `group-hover` is Tailwind 3 `.group:hover .x`, which should invalidate only the elements carrying those classes. The 430-480 ms recalc over 12k elements therefore points elsewhere. Candidates are transitions on hovered ancestors, `hover:` utilities on many rows, and the universal `*` rules. This is not verified. Recapture with Chrome selector stats and read the top selectors.

### Ranked reductions (layout objects saved x ease)

1. **Smaller render margin for non-focused tiles.** `RENDER_WINDOW_MARGIN_PX` becomes a tile-aware value, for example 600 px for unfocused tiles and 2000 px for the focused one. Estimated savings are the largest of any item, a 50-70% cut of mounted bubbles per unfocused tile, for a small change. Risk: scroll jumps and placeholder height drift (`placeholderHeight`, `PLACEHOLDER_FALLBACK_PX`). Needs visual review of fast scroll in a tile.
2. **Render hover toolbars only when needed.** Assistant footer copy button and the user branch/rewind pair become an `@if` on a pointer-enter/focus-within signal, or one shared floating toolbar. This removes about 2-3 icon buttons per message. Risk: keyboard and screen-reader access and focus order. Keep `focus-within` so the toolbar mounts on focus. Needs a11y review.
3. **Collapse row cost.** Drop the 4-div separator in favour of a border. Fold the tool icon and status into the header with a single icon component. Render the chevron via CSS. Expected saving is about 6-8 elements per row. Low risk, visual diff needed.
4. **Sprite or `<use>` icons for the highest-count icons** (chevron, check, tool icons). This removes path children (2,448 `LayoutSVGPath`) but needs a shared sprite and changes lucide usage. It is a medium-sized change and belongs later.
5. **Pause or limit infinite animations** for tiles that are not focused. `animate-spin` runs per streaming row; the Layerize total is 84 s. Use `SURFACE_ACTIVE` as PR #645 does, or `motion-safe`, to freeze them.
6. **`contain: content`** on `.chat-msg-slot` or bubble roots. PR #645 found `content-visibility` risky. `contain` without `content-visibility` is safer but can clip popovers and anchored overlays. The markdown wrapper must keep its scroll for wide tables. Needs a visual check; try it last.

## Disagreements

- None between sources. The repo comment at `message-bubble.component.css:5` rejects `content-visibility` on bubbles, consistent with the brief about PR #645. `chat-view.component.css:41` still sets `content-visibility: auto` on one selector; I did not check whether it is in the render path.

## Local consequences

- `app.config.ts:141`: add `runCoalescing: true`.
- `transcript-render-window.ts`: make the margin tile-aware.
- `message-bubble.component.html`: lazy hover toolbars.
- `tool-call-item.component.ts` and `tool-call-header.component.ts`: trim element and icon count.
- `styles.css`: audit the universal `*` rules and hover transitions after the selector-stats capture.

## Implementation batches

| Batch | When | Risk | Visual review |
| --- | --- | --- | --- |
| 1. `runCoalescing`, scroll and pointer listeners outside zone, `saveTabState` outside zone | now | Low; a missing re-entry leaves UI stale | Smoke only |
| 2. Tile-aware render margin | now | Medium: scroll jumps | Yes: fast scroll, tile resize |
| 3. Lazy hover toolbars | now | Medium: a11y regression | Yes: keyboard and focus |
| 4. Tool-row slimming and animation pause for unfocused tiles | now | Low-medium | Yes: before/after of tool rows |
| 5. Recapture with selector stats, fix the hover recalc | next | Unknown until captured | After the fix |
| 6. Icon sprite, `contain` trials | later | Medium | Yes |
| 7. Zoneless pilot (Electron only, after test migration) | later or never | High: 38 setups, 12 fakeAsync specs | Full regression |

## Unknowns

- Real per-tile element counts by component. Smallest experiment: run `document.querySelectorAll` per tag inside one tile in a live build (`ptah_browser_evaluate`).
- Whether any non-signal state is set from timers or third-party callbacks (zoneless blocker). Smallest experiment: run the suite with `provideZonelessChangeDetection` in the webview app and watch for stale UI.
- The cause of the pointerout recalc: selector stats from a new trace.
- Whether gridstack's event bridge depends on zone: not read.
