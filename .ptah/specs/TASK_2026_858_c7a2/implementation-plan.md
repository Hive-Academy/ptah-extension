# Implementation Plan - TASK_2026_858_c7a2

Stagger enter and leave animations for chat messages (motion plan item 4). Electron first.

## Inputs and constraints

- Requirements used: `task.md`, `context.md`, the task brief (requirements 1-6, lessons from #880).
- Prior decisions reused: `.ptah/specs/TASK_2026_motion_presets/user-decisions.md` (default Rise, glass = transform-only entrance and cut exit, Reduce motion wins over every preset, no "None" preset), `implementation-plan.md` of that task (no new duration tokens, native `animate.*`, no `@angular/animations`).
- Corrections applied: none. Design handoff: none (CSS reuses the B1-B8 preset variables).
- Missing decision-critical input: none. Two runtime facts stay assumptions (A1, A2) with checks.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| `selectVisibleEntrance` picks the newest intersecting slots from DOM rects. Only its spec calls it; no production code imports it. | `transcript/transcript-entrance.ts:2-17`, `transcript-entrance.spec.ts:1` (grep: no other caller) | Today no message has an entrance. Replace this dead helper; do not keep it next to the new one. |
| Today the only transcript entrance is the pane class `ptah-pane-switch-enter` on the scroller while `entering() && workActive()` | `chat-transcript.component.html:3`, `chat-transcript.component.css:1-16` | The stagger must not run while this class is set (requirement 5). |
| `chat-view` owns the tab-edge window: `pendingTabId` (local variable) waits for content, then `startEnter` sets `enteringTabId` for `max(60 + 6*stagger + in, switch) + 44` ms | `templates/chat-view.component.ts:1064-1124` | A tab edge has a pending phase before `entering` turns true. The transcript cannot see that phase today. |
| Transcript inputs from chat-view: `entering`, `leaving`, `overlapping`, `active`, `historyReplaying` | `chat-view.component.html:57-67` | Add one input here for the pending phase. |
| `@for (slot of vm().slots; track slot.id)`; each item renders `.chat-msg-slot` plus sibling artifact / summary-chip / change-set divs as direct children of `.chat-scroll-content` (flex column, `gap: 0.75rem`) | `chat-transcript.component.html:36-172`, `.css:82-93` | A leave on the slot alone leaves the siblings to vanish at once (a jump). One item wrapper must own enter and leave. |
| `.chat-msg-slot` height must equal the bubble height; the render window observes it; placeholders keep the height | `chat-transcript.component.css:99-113`, `transcript-render-window.ts:246-264` | Do not put padding, animation or containment on `.chat-msg-slot`. Animate a new outer wrapper. |
| Render window: last `ALWAYS_MOUNTED_TAIL = 6` slots and all streaming slots are always mounted | `transcript-render-window.ts:25`, `:192-216` | Cap N = 6 matches the always-mounted tail: every staggered item is mounted. |
| Slot ids are stable: streaming rows use `tree.id`; finalized rows drop out of the streaming list by the same id | `chat-transcript.component.ts:511-535`, `:603-607` | A streaming chunk never creates a new `@for` item. A diff on ids is a sufficient streaming guard. |
| `TranscriptPrependAnchorDirective.ngOnChanges` reads the old DOM and writes a signal before Angular reconciles the child `@for`; the template reads that signal (`isForcedMounted`) | `transcript-prepend-anchor.directive.ts:63-101`, html `:44-47` | Precedent for a directive on the scroller that diffs ids, marks old DOM, and feeds per-item bindings in the same pass. |
| `isStrictHeadPrepend` (private) detects an older-history page | `transcript-prepend-anchor.directive.ts:150-160` | Move it to `transcript-entrance.ts` and share it. |
| Motion suppression already exists: `motionSuppressed = historyReplaying || replayMotionHold || isFinalizingTransition` | `chat-transcript.component.ts:443-451`, `:1217-1236`, `:1274-1296` | Reuse `replayMotionHold` and `isFinalizingTransition` as suppress signals. Do not reuse `motionSuppressed`: it includes raw `historyReplaying`, which would block the open batch. |
| Compiler: `animate.enter` / `animate.leave` ops go in the **creation** block; a bound value is wrapped as a function | `node_modules/@angular/compiler/fesm2022/*.mjs:10405-10424, 10821-10844` | `[animate.enter]="expr"` is queued once per created element, never on update. The function runs later, when the animation queue flushes in `afterNextRender` (`_debug_node-chunk.mjs:4539-4545, 14418`), not at creation. |
| `areAnimationSupported = typeof document.documentElement.getAnimations === 'function'`, read at module load; when false `ɵɵanimateEnter` returns at once | `_debug_node-chunk.mjs:4073, 14398` | jsdom never adds the enter class. Specs assert the directive output (`enterClass`, `index`) and `--ptah-msg-i`, not the class. |
| `cancelLeavingNodes`: when a new `@for` element is created and a leaving node is its previous sibling, the leaving node is removed at once | `_debug_node-chunk.mjs:4133-4172` | "Remove tail, then append within the leave" ends the leave early. Known limit (see Risks). |
| Replay hold: motion stays suppressed 300 ms after `historyReplaying` falls | `chat-transcript.component.ts:1215-1235`, `motionSuppressed` `:443-451` | Add `replayMotionHold()` to the suppress input. Raw replay stays a separate input (planner rule 5). |
| Presentation path slot id = `message.id` | `libs/frontend/chat/src/lib/services/stream-presentation-store.service.ts:199` | Stream to finalize keeps the id on both paths. |
| `transcriptOrder` reads direct children of `.chat-scroll-content` for `data-testid="chat-turn-summary"` | `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts:156-167` | The wrapper breaks it silently. Required B3 edit. |
| Runtime: the class list is read lazily (`getClassListFromValue` calls the function); empty list = no animation; enter class removed on `animationend` of the longest animation; leave removes the node on `animationend` or a `duration + 50 ms` fallback; no animation = removal on the next rAF | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:4200-4210, 14396-14457, 14488-14571` | `''` disables one item's enter. A leave that resolves to `display: none` is a cut. |
| Preset variables, `ptahMotionEnter`, `ptahMotionEnterGlass`, `ptahMotionLeave`; default Rise when `data-motion-style` is absent | `apps/ptah-extension-webview/src/styles.css:41-56, 848-956`; `libs/frontend/core/src/lib/services/theme.service.ts:295-296` | Reuse the keyframes and variables. No new tokens. |
| `--ptah-stagger-step: 36ms`, `--ptah-motion-in: 320ms`, `--ptah-motion-out: 180ms` | `styles.css:43-46` | Stagger step and durations. |
| `html.ptah-vt-active :is(.ptah-motion-enter, .ptah-pane-switch-enter, .inspector-stats-enter)` near-zero duration | `styles.css:840-844` | Add the message enter class to this list. |
| Reduced motion: global `0.01ms !important` durations, but delays are not zeroed; `.ptah-motion-leave { display: none }` | `styles.css:1003-1017`; comment `chat-view.component.css:137` | Zero the stagger delay explicitly. Leave = cut. |
| Electron "Reduce motion" is the Chromium `force-prefers-reduced-motion` switch, so the media query covers it | `TASK_2026_motion_presets/implementation-plan.md:37` | No extra JS check. |
| Existing per-item custom property binding `[style.--i]` | `session-inspector.component.html:205-221` | `[style.--ptah-msg-i]` is an accepted form. |
| Glass scrim selectors use `.chat-scroll-content:has(> .chat-msg-slot)`; `glass-scrim.spec.ts` asserts them | `styles.css:3787-3796`; `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts:185-188` | The wrapper breaks the direct-child match. Update both selectors and the spec. |
| `.message-enter` is defined but not used anywhere | `styles.css:711-713` (grep: no other match) | Delete it. |
| Specs read `.chat-scroll-content` direct children | `chat-transcript.change-set.spec.ts:146-158`, `chat-transcript.display.spec.ts:353-365` | Update both helpers to read the item children. |
| e2e: slot queries use `.chat-msg-slot` and `data-ptah-transcript-message-id` (kept); `chat-user-message` / `assistant-message` test ids | `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts:154`, `perf/nav-session-motion.perf.spec.ts:131-250`, `task-382-late-post-turn-event.spec.ts:75`, `webview-e2e-harness/.../streaming-response.e2e.spec.ts:64-125` | None of these remove messages, so none sees a leaving node. Add a shared rule: exclude `[data-ptah-leaving]`. |
| Electron `^44.4.3` | `package.json:264` | Chromium supports `interpolate-size` (A2 check below). |

## Current behaviour

1. No transcript message animates on enter or leave. `selectVisibleEntrance` is unused.
2. A tab edge: chat-view keeps the old transcript as an absolute overlay (`ptah-pane-switch-leave`), waits until the new tab has content, then sets `entering` for one window. The scroller then plays `ptahMotionEnter` with the preset (`chat-transcript.component.css:1-16`).
3. A surface change (chat to settings) is a whole-window View Transition. `html.ptah-vt-active` forces enter classes to near-zero duration.
4. Inside bubbles, `isFinalizing` (`motionSuppressed`) stops internal fade keyframes during replay and the finalize burst.

## Architecture decision

- Chosen approach: a new scroller directive `ptahTranscriptMotion` diffs slot ids in `ngOnChanges` (same timing as the prepend anchor). It (a) plans the entrance batch with a pure function and publishes `id -> index` in a signal, and (b) marks removed items `inert`, `aria-hidden="true"` and `data-ptah-leaving` before Angular detaches them. Each `@for` item gets one wrapper `.chat-msg-item` with `[animate.enter]="motion.enterClass(slot.id)"`, `[style.--ptah-msg-i]="motion.index(slot.id)"` and the static class leave `animate.leave="ptah-msg-leave"`. CSS reuses the preset keyframes.
- Scope of the stagger (requirement 1 vs 5): a session opened through a tab edge (new tab, or a tab in its pending phase) shows only the pane-switch motion. The stagger shows for the first load into the active tab, a same-tab session replace, and appended turns. The visual reviewer must not report a missing stagger on a tab edge.
- Rationale: Angular queues the enter class once per created element (creation-mode op) and adds it in the `afterNextRender` flush, before the first paint of that element, so there is no flash and no measurement. Angular removes it on `animationend` (no timers). The directive must never remove or rewrite a map entry for an id that is still present, because the lazy class function reads the map at flush time. Leave is class-based (lesson 1) and pre-marked inert (lesson 2, wizard precedent in `TASK_2026_motion_presets/batch-B5-code-logic-review.md:160`).
- Rejected alternatives:
  - DOM measurement with `selectVisibleEntrance` in `afterNextRender`: needs a pending hidden class plus a second pass before paint (Assumption on tick looping), and reads layout for each batch. The tail rule gives the same visible set when pinned, with no reads.
  - Function-valued `(animate.leave)` to set `inert`: forbidden by lesson 1.
  - Absolute positioning of a leaving item: `.chat-scroll-content` is a flex column, so an absolute child's static position is the container start, not its slot. A correct `top` needs a measurement per leave. Rejected.
  - Animation on `.chat-msg-slot`: breaks the slot-height contract and leaves the sibling chips to snap.
- Effect on existing code: `selectVisibleEntrance` and `.message-enter` are deleted. `isStrictHeadPrepend` moves. Pane-switch, VT and bubble-internal suppression stay as they are. The lane transcript (`lane-transcript.component.ts`) is not changed.
- Assumptions:
  - A1: chat-view effects that set `pendingEntranceTabId` / `enteringTabId` run before chat-view's template passes inputs in the same change detection. Check (fails if the order is wrong): in `chat-view.session-enter.spec.ts`, switch to a new tab, then in one `detectChanges` give it its first messages. Read the child transcript's directive through `By.directive(TranscriptMotionDirective)`; assert `paneSwitching` was `true` at its first non-empty `ngOnChanges` (spy on `planEntrance` input or read a `lastSuppressed` getter) and `index(id) === null` for every id. A wrong order gives non-null indexes and the spec fails.
  - A2: Electron 44 Chromium supports `interpolate-size: allow-keywords` in keyframes. Check: `process.versions.chrome >= 129` in the Electron run. If not, the height step is discrete at the end (same as today). No code fallback.

## Component specifications

### 1. Entrance planner (pure functions)

- Purpose: decide which added ids animate and their stagger index.
- Responsibilities: `planEntrance(input): ReadonlyMap<string, number>`; exported `isStrictHeadPrepend` (moved, unchanged); `ENTRANCE_CAP = 6`.
- Contract (input fields, all readonly): `previousIds: readonly string[]`, `nextIds: readonly string[]`, `suppressed: boolean`, `replaying: boolean`, `pinned: boolean`, `cap: number`.
- Rules, in order:
  1. `suppressed` -> empty map.
  2. `isStrictHeadPrepend(previous, next)` -> empty map (older-history page, requirement 6).
  3. `added` = ids in `nextIds` not in `previousIds`, reading order. None -> empty map.
  4. Open batch = `previousIds` is empty, or no id of `previousIds` is in `nextIds` (session replaced in the tab). Otherwise an append.
  5. `replaying` and not an open batch -> empty map (replayed pages after the first paint do not animate).
  6. Append and not `pinned` -> empty map (the new rows are below the viewport).
  7. Keep only added ids whose position is in the last `cap` positions of `nextIds` (mounted tail, near the bottom). Index = order among them, 0..cap-1.
- Why N = 6 and max delay 180 ms: 6 = `ALWAYS_MOUNTED_TAIL` and the six steps in `chat-view` `enterWindowMs`. Max delay = 5 x 36 ms = 180 ms; last row ends at 180 + 320 = 500 ms, inside one pane-switch window. CSS also clamps the index to 5.
- Failure behaviour: pure; empty input gives an empty map.
- Verification seam: `transcript-entrance.spec.ts` (rewrite): open batch of 20 -> indexes 0..5 on the last 6; single append -> `{id: 0}`; streaming update with the same ids -> empty; head prepend -> empty; append when not pinned -> empty; replaying append -> empty, replaying open batch -> staggered; suppressed -> empty; replacement batch -> staggered; `isStrictHeadPrepend` cases moved from the anchor spec if any.
- Files: REWRITE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts`, REWRITE `transcript-entrance.spec.ts`; MODIFY `transcript-prepend-anchor.directive.ts` (import `isStrictHeadPrepend`, delete the local copy).

### 2. `TranscriptMotionDirective` (`[ptahTranscriptMotion]`, exportAs `ptahTranscriptMotion`)

- Purpose: own the per-pass id diff for message motion on the scroller.
- Inputs (signal `input()`): `ptahTranscriptMotion: readonly { id: string }[]` (required), `active: boolean` (required), `suppressed: boolean`, `historyReplaying: boolean`, `pinnedToBottom: boolean`.
- Public API: `enterClass(id: string): string` ('ptah-msg-enter' or ''); `index(id: string): number | null`. Both read one private `signal<ReadonlyMap<string, number>>`.
- `ngOnChanges` (not an effect, same reason as `transcript-prepend-anchor.directive.ts:64-65`):
  1. `suppressed` for this pass = input `suppressed` OR activation edge (`!wasActive && active`) OR `!active`.
  2. `next = planEntrance(...)`. New map = previous entries whose id is still present, plus `next`. Old entries keep their index, so a running delay never changes. Entries for removed ids are evicted (map size <= slot count).
  3. Removed ids (in previous, not in next): one pass over `host.querySelectorAll('.chat-msg-item[data-ptah-msg-item]')`; for each item whose `data-ptah-msg-item` is removed: set `inert`, `aria-hidden="true"`, `data-ptah-leaving`. Set `data-ptah-leave-cut` (CSS cut) when any of these is true: the pass is a replacement; `suppressed`; more than `ENTRANCE_CAP` (6) items leave in this pass; the item rect does not intersect the scroller rect (one `getBoundingClientRect` per removed item, read in this same pass, no timer). So only visible leaves collapse, and nothing above the viewport animates height. Run step 3 only when at least one id was removed. O(items) per removing pass.
  4. Store `previousIds`, `wasActive`.
- Dependencies: `ElementRef` via `inject()`. No services.
- Failure behaviour: an item not found (unmounted race) is skipped; Angular still removes it.
- Quality: no timers, observers or listeners. Standalone. Under 120 lines.
- Verification seam: `transcript-motion.directive.spec.ts` with a host test component. Assert only directive output (`enterClass(id)`, `index(id)`), never the Angular-applied class (jsdom has no `getAnimations`, so Angular never adds it). Cases: batch gives `'ptah-msg-enter'` and indexes; same ids twice gives no new entries and keeps old indexes unchanged; activation edge gives none; removed item gets `inert`, `aria-hidden`, `data-ptah-leaving` (assert on a node reference captured before the change, because jsdom removes leave nodes at once); replacement, more than 6 removed, and an item outside the scroller rect (stub `getBoundingClientRect`) add `data-ptah-leave-cut`.
- Files: CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-motion.directive.ts`, CREATE `transcript-motion.directive.spec.ts`.

### 3. Transcript wiring and message motion CSS

- Template (`chat-transcript.component.html`): add `#motion="ptahTranscriptMotion"` and its inputs on the scroller: `[ptahTranscriptMotion]="vm().slots"`, `[active]="workActive()"`, `[suppressed]="paneSwitching() || entering() || replayMotionHold() || isFinalizingTransition()"` (not `motionSuppressed()` and not `historyReplaying`: during replay the planner must still stagger the open batch; the raw `[historyReplaying]` input below carries rule 5 only), `[historyReplaying]="historyReplaying()"`, `[pinnedToBottom]="isPinnedToBottom()"`. Wrap the whole `@for` item body (slot, artifacts, summary chip, change sets) in one `<div class="chat-msg-item" [attr.data-ptah-msg-item]="slot.id" [animate.enter]="motion.enterClass(slot.id)" [style.--ptah-msg-i]="motion.index(slot.id)" animate.leave="ptah-msg-leave">`. `.chat-msg-slot` keeps its attributes and stays unchanged inside.
- Component (`chat-transcript.component.ts`): add `readonly paneSwitching = input(false)`; change `replayMotionHold` (`:444`) from `private` to `protected readonly` so the template can read it; import `TranscriptMotionDirective`.
- CSS (`chat-transcript.component.css`), after the pane-switch block:
  - `.chat-msg-item { display: flex; flex-direction: column; gap: 0.75rem; }` (keeps today's spacing between a slot and its chips).
  - Enter: `.chat-msg-item.ptah-msg-enter { animation: ptahMotionEnter var(--ptah-motion-in) var(--ptah-ease-soft) backwards; animation-delay: calc(min(var(--ptah-msg-i, 0), 5) * var(--ptah-stagger-step)); }`.
  - Glass enter: `:host-context([data-glass='on']) .chat-msg-item.ptah-msg-enter { animation-name: ptahMotionEnterGlass; }` plus the same Fade (`--ptah-motion-enter-y: 18px`) and Scale (`6px`) overrides as `.css:10-16`.
  - Leave: `.chat-msg-item.ptah-msg-leave { overflow: hidden; pointer-events: none; interpolate-size: allow-keywords; animation: ptahMotionLeave var(--ptah-motion-out) var(--ptah-ease-gentle-in) forwards, ptahMsgCollapse var(--ptah-motion-out) var(--ptah-ease-gentle-in) forwards; }` with `@keyframes ptahMsgCollapse { from { height: auto; } to { height: 0; margin-block-start: -0.75rem; } }` (the negative margin removes the item's share of the column gap, so the end of the leave does not jump).
  - Cuts (`display: none`, so Angular removes on the next rAF): `.chat-msg-item.ptah-msg-leave[data-ptah-leave-cut]`; `.chat-msg-item.ptah-msg-leave:has(> .chat-msg-slot > .chat-msg-placeholder)` (offscreen, unmounted); `:host-context([data-glass='on']) .chat-msg-item.ptah-msg-leave`.
  - Reduced motion: `@media (prefers-reduced-motion: reduce) { .chat-msg-item.ptah-msg-enter { animation-duration: 0.01ms; animation-delay: 0s; } .chat-msg-item.ptah-msg-leave { display: none; } }`. Never `animation: none` (lesson 3).
- Failure behaviour: if the enter class is missing, the item shows at once (today's behaviour). If a leave animation never ends, Angular's `duration + 50 ms` fallback removes the node.
- Verification seam: new `chat-transcript.stagger.spec.ts` (reuse `testing/transcript-spec-harness.ts`). Assert through the exported directive (`By.directive(TranscriptMotionDirective)`: `enterClass(id)`, `index(id)`) and the inline `--ptah-msg-i` style on `.chat-msg-item`; never the `ptah-msg-enter` class (jsdom: Angular skips enter animations). Cases: session open into an empty active tab gives indexes 0..5 and `--ptah-msg-i` 0..5 on the last six items; streaming chunk updates give no new entries; stream then finalize with the same id (legacy and presentation paths) creates no new `.chat-msg-item` node (same element reference) and no new entry; `paneSwitching` or `entering` true gives none; an open batch that arrives while `historyReplaying` is true (empty tab, first replay page) gives indexes 0..5 (requirement 1); a later replay page while `historyReplaying` is true gives none (rule 5); the 300 ms replay hold after `historyReplaying` falls gives none for a page that lands in that window; older-history prepend gives none; activation catch-up gives none; a removed item is `inert` / `aria-hidden` / `data-ptah-leaving`. Update `contentChildren` helpers in `chat-transcript.change-set.spec.ts` and `chat-transcript.display.spec.ts` to flatten `.chat-msg-item` children. Existing transcript specs must stay green.
- Files: MODIFY `chat-transcript.component.html`, `chat-transcript.component.ts`, `chat-transcript.component.css`; CREATE `chat-transcript.stagger.spec.ts`; MODIFY `chat-transcript.change-set.spec.ts`, `chat-transcript.display.spec.ts`.

### 4. Pane-switch signal in chat-view

- Purpose: tell the transcript about the pending phase of a tab edge (requirement 5).
- Change: turn the local `pendingTabId` in `wireSessionEntrance` (`chat-view.component.ts:1066-1083`) into `protected readonly pendingEntranceTabId = signal<string | null>(null)`, written where the local is written today. Bind `[paneSwitching]="tabId === pendingEntranceTabId() || tabId === enteringTabId()"` on `ptah-chat-transcript` (`chat-view.component.html:57`).
- Failure behaviour: the existing 1000-2000 ms safety timer in `startLeave` clears the leave; `pendingEntranceTabId` clears on `startEnter` or on `tabId === null`, as the local does today.
- Verification seam: `chat-view.session-enter.spec.ts`: pending tab gets `paneSwitching` true until `startEnter`; the A1 ordering spec (see Assumptions) fails when any `index(id)` is non-null for the pane-switching tab.
- Files: MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`, `chat-view.component.html`, `chat-view.session-enter.spec.ts`.

### 5. Global CSS touch points

- `styles.css:840`: add `.ptah-msg-enter` to the `html.ptah-vt-active :is(...)` near-zero list (no stack on the whole-window crossfade).
- `styles.css:711-713`: delete unused `.message-enter`.
- `styles.css:3787` and `:3793`: change `:has(> .chat-msg-slot)` to `:has(> :is(.chat-msg-slot, .chat-msg-item))` (the lane transcript keeps direct slots). Update `glass-scrim.spec.ts:185-188` regexes.
- Verification seam: `glass-scrim.spec.ts`; Electron glass visual check.
- Files: MODIFY `apps/ptah-extension-webview/src/styles.css`, `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts`.

### 6. e2e structure and locator update (required)

- Purpose: keep e2e readers correct with the new wrapper, and keep locators off leaving nodes.
- Required change: `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts:156-167` `transcriptOrder` reads `content.children`. Change it to flatten each `.chat-msg-item` into its own children (slot, `chat-turn-summary`, artifact, change set) in DOM order, and skip `[data-ptah-leaving]` items.
- Audit 1 (structure), done at plan time and repeated by the lane: every `.chat-scroll-content`, `.children` and `:scope >` query in `apps/ptah-electron-e2e/src` and `libs/frontend/webview-e2e-harness/src`. Plan-time result: only `change-set-card.spec.ts` depends on transcript children; `canvas/canvas.spec.ts:8` `:scope > [data-pane-side]` is the canvas pane container, not the transcript. In unit specs, only `chat-transcript.change-set.spec.ts` and `chat-transcript.display.spec.ts` (B2) read those children.
- Audit 2 (leaving nodes): every message locator that runs after a removal (rewind, clear, session replace) excludes leaving items with a CSS scope such as `.chat-msg-item:not([data-ptah-leaving]) [data-testid="chat-user-message"]`. Plan-time result: no listed spec removes messages.
- Re-check `perf/nav-session-motion.perf.spec.ts:131-250`: it samples slot rects during a tab switch. The stagger is suppressed on a tab edge, so the rects must not move. Record this in the batch report; no edit is expected.
- Files: MODIFY `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`; plus any spec the lane's repeat audit finds.

## Integration architecture

- Data flow: tab store -> `vm()` (gated) -> scroller bindings -> `TranscriptMotionDirective.ngOnChanges` (diff, plan, mark leaving DOM) -> `@for` reconcile -> creation op `animate.enter` reads `enterClass` lazily -> CSS animation with `--ptah-msg-i` delay -> Angular removes the class on `animationend`. Leave: `@for` detach -> `ptah-msg-leave` class -> CSS animation or cut -> node removed.
- State: one map signal in the directive, component-scoped, lifetime = transcript.
- External boundaries: none (no new input from outside the webview).
- Failure and rollback: every failure falls back to "no animation". Removing the wrapper bindings restores today's behaviour.
- Observability: not applicable (pure UI). Electron visual run is the evidence.

## Architecture-level quality requirements

- Functional (acceptance):
  - R1: open a session into an empty active tab: the last <= 6 items enter one after another, 36 ms apart, total delay <= 180 ms. A turn that adds 2+ items staggers them.
  - R2: clear, filter or rewind: mounted visible items fade/move and collapse in 180 ms; no layout snap at the end; leaving nodes are inert and aria-hidden; offscreen items cut.
  - R3: a streamed message enters once; text chunks never re-run its animation; finalize does not re-run it.
  - R4: motion follows `data-motion-style` (default Rise); glass: transform-only enter, cut exit; OS reduced motion and Electron "Reduce motion" give no visible motion and no delay.
  - R5: tab switch shows only the pane-switch motion; surface change shows only the window crossfade.
  - R6: older-history prepend, appends while scrolled up, unmounted items: no animation.
- Performance: at most 6 enter animations per batch; enter is compositor-only; collapse is a one-shot 180 ms layout animation only on mounted leaving items; no per-item timer, observer or listener.
- Maintainability: no new tokens; no `!important` in new rules; no `@angular/animations`; standalone, OnPush, `inject()`, signal inputs; no `any`.
- Testability: unit specs listed per component; motion itself is proven only in Electron.

## Visual verification checklist (real Electron, after batches 1-3)

Run with the `visual-reviewer` in Electron only. Record each item with a short screen recording or frame captures.

1. Themes dark, light, glass on; each with presets Fade, Rise (default), Slide left, Slide right, Scale, Direction-aware.
2. PASS/FAIL. Open a long session (200+ messages) into the current empty tab, once with no saved scroll and once with a saved scroll position. PASS only if the rows that stagger are the rows on screen at the first painted frame (frame captures), there is no flash before the entrance, and the view ends at the bottom (or at the restored position, where no row animates). FAIL if the staggered rows are off screen while visible rows appear without motion. A FAIL means the planner must also require that stick-to-bottom ran before the batch (team-leader routes this back to the architect).
2b. A tab edge (new tab) shows the pane switch only; this is correct, not a missing stagger.
3. Tab switch to a loaded tab and to a tab that must replay history: pane switch only, no item stagger.
4. Chat -> settings -> chat: window crossfade only.
5. Send a message and stream a long reply: user message enters once, reply enters once, no re-entry on chunks or on finalize.
6. Scroll up, load older history: no animation, the anchor row does not move.
7. Rewind (removes trailing messages) and clear: items leave without a snap at the end; Tab key does not focus a leaving item; empty state fades in over the column; rows above the viewport do not animate height.
7b. Rewind, then send a new message at once (within 230 ms): the leave may end early (known limit, Risks). Record the result; it is not a FAIL unless the new message is hidden or doubled.
8. Glass: enter has no opacity change; leave is a cut; glass blur does not flicker.
9. Electron Motion setting "Reduce motion" and OS reduced motion: no motion, no delayed rows.
10. DevTools Performance during step 2: no long tasks caused by the stagger; animations on `transform` / `opacity` only for enter.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Cap N = 6, step 36 ms, max delay 180 ms | N 4/6/8; separate max-delay token | `ALWAYS_MOUNTED_TAIL = 6`; chat-view six-step window; "no new duration tokens" | Yes (constant + CSS clamp) |
| Select by tail position, no DOM measurement | `selectVisibleEntrance` in `afterNextRender`; tail rule | Tail is always mounted; measurement needs a second pass before paint | Yes |
| One `.chat-msg-item` wrapper owns enter/leave | slot only; wrapper; per-sibling leaves | Slot height contract; siblings snap otherwise | Yes, with spec/glass selector edits |
| Leave = in-flow fade/move + height collapse | absolute overlay; in-flow collapse; plain fade then snap | Flex static position puts absolute items at the top | Yes |
| Inert/aria-hidden set in `ngOnChanges` before detach | function `animate.leave`; pre-mark | Lesson 1; prepend-anchor timing; wizard B5 precedent | Yes |
| Replacement batch: old items cut, new items stagger | collapse old + stagger new | Two motions in one column look like a stack | Yes |
| Glass rules apply to every message item (no `:has` glass test) | per-item `:has(backdrop-blur)`; all items | Brief: glass themes = transform-only, cut; `:has` per item costs style work | Yes |
| Presets reuse page distances (slide 32 px) | smaller message distances | User decision: reuse presets, no new tokens | Yes (CSS variables) |
| Lane transcript unchanged | include lane slots | Scope: chat transcript; Electron main transcript | Yes |
| Delete `selectVisibleEntrance` and `.message-enter` | keep | Both unused | Yes (git) |

## Risks

- A1 timing: if chat-view's effect runs after the input pass, the first batch of a new tab staggers under the pane switch. Mitigation: the A1 spec; fallback is to set `pendingEntranceTabId` from a `computed` on `resolvedTabId` edges.
- Progressive history replay: if replay paints many intermediate frames, only the first painted batch staggers and later pages pop in. Visual item 2 confirms; acceptable.
- Height collapse is layout work per frame. Bounded: only items inside the scroller rect, at most 6 per pass, collapse; all other leaves are cut (directive step 3).
- Known limit (requirement 2): `cancelLeavingNodes` (`_debug_node-chunk.mjs:4133-4172`) removes a leaving item at once when a new `@for` item is created right after it (tail removed, then a new message within about 230 ms). The leave then ends with a snap. Accepted: the new item usually takes the same place, so the shift is small. Visual item 7b records it. No workaround in this task.
- A focused control inside a leaving item loses focus to `body` (as in B5). Not a regression.
- jsdom has no `getAnimations`, so Angular removes leave nodes at once in specs; specs cannot prove the leave. Only the Electron run proves it.

## Team-leader handoff

- Recommended executors: codex CLI lanes (frontend). Batch 1 and 2 are frontend-developer work; batch 3 is small and also fits a frontend lane. Visual check: visual-reviewer in Electron.
- Complexity: MEDIUM (one new directive, a template wrapper, CSS; timing-sensitive but no new services).
- Dependencies and ordering: Component 1 before 2; 2 before 3/4; 5 with 3; 6 last.
- Parallel-safe work: none across batches 1-2; batch 3 can run after 2.

### Proposed batches (file-disjoint, max 3)

| Batch | Components | Files | Verify |
| --- | --- | --- | --- |
| B1 | 1, 2 | `transcript-entrance.ts`, `transcript-entrance.spec.ts`, `transcript-prepend-anchor.directive.ts`, `transcript-motion.directive.ts` (new), `transcript-motion.directive.spec.ts` (new) | `npm run verify -- -p @ptah-extension/chat` |
| B2 | 3, 4, 5 | `chat-transcript.component.{html,ts,css}`, `chat-transcript.stagger.spec.ts` (new), `chat-transcript.change-set.spec.ts`, `chat-transcript.display.spec.ts`, `chat-view.component.{ts,html}`, `chat-view.session-enter.spec.ts`, `apps/ptah-extension-webview/src/styles.css`, `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts` | `npm run verify -- -p @ptah-extension/chat,ptah-extension-webview` |
| B3 (required) | 6 | `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`, plus any spec the repeat audit finds in `apps/ptah-electron-e2e/src/**`, `libs/frontend/webview-e2e-harness/src/**` | `npm run verify -- -t typecheck -p ptah-electron-e2e,@ptah-extension/webview-e2e-harness` (both projects show a `typecheck` target and no explicit `lint` target in `project.json`; confirm the header says "Running target typecheck for 2 projects"; if Nx infers `lint`, add it). Do not run e2e targets. |

All lanes: work only in `D:\projects\ptah-extension\.claude-worktrees\chat-message-stagger`; follow the CLAUDE.md memory-safe verify rules; never run build, serve or e2e targets; no git.

- Files affected:
  - CREATE: `transcript-motion.directive.ts`, `transcript-motion.directive.spec.ts`, `chat-transcript.stagger.spec.ts` (all in `libs/frontend/chat/src/lib/components/organisms/transcript/`).
  - REWRITE: `transcript-entrance.ts`, `transcript-entrance.spec.ts`.
  - MODIFY: `transcript-prepend-anchor.directive.ts`, `chat-transcript.component.{html,ts,css}`, `chat-transcript.change-set.spec.ts`, `chat-transcript.display.spec.ts`, `templates/chat-view.component.{ts,html}`, `templates/chat-view.session-enter.spec.ts`, `apps/ptah-extension-webview/src/styles.css`, `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts`, `apps/ptah-electron-e2e/src/specs/git/change-set-card.spec.ts`, plus any spec the repeat audit finds.
- Verification points: the cited `file:line` contracts above; the three verify commands; the Electron checklist; the A1 and A2 checks.

## Revision 1

Source: `implementation-plan-review.md` (REVISE).

1. Serious, jsdom enter class: all specs now assert `enterClass(id)`, `index(id)` and `--ptah-msg-i`, never the Angular-applied class (evidence row for `_debug_node-chunk.mjs:4073, 14398`). A1 now has a spec that fails when a pane-switching tab gets a non-null index.
2. Serious, e2e structure: B3 is required. `change-set-card.spec.ts` `transcriptOrder` flattens `.chat-msg-item`. The structural audit is recorded in component 6. The perf spec gets a re-check note.
3. Replay hold: `suppressed` includes the 300 ms replay hold (corrected in Revision 2). A spec covers the hold.
4. Leave cancel: written as a known limit in Risks, with visual item 7b.
5. Collapse above the viewport: directive step 3 cuts leaves outside the scroller rect and passes with more than 6 leaves. Spec cases added.
6. Lazy class timing: the evidence row and Rationale now say the flush runs in `afterNextRender`, with the rule that entries for present ids never change.
7. First-paint scroll: visual item 2 is now PASS/FAIL, with and without scroll restore.
8. Req 1 vs 5: one scope sentence in Architecture decision, plus visual item 2b.
9. B3 verify: `-t typecheck`, with the header check.
10. Id stability: presentation-path evidence row and a stream-to-finalize spec.

## Revision 2

Source: reviewer finding N1 (Serious).

- N1: `motionSuppressed()` includes raw `historyReplaying`, so binding it to `suppressed` blocked the open batch during replay (requirement 1). Fix: `suppressed` = `paneSwitching() || entering() || replayMotionHold() || isFinalizingTransition()`. `replayMotionHold` becomes `protected readonly` in `chat-transcript.component.ts`. `historyReplaying` stays its own directive input with rule 5 semantics (open batch staggers; later replay pages do not). Updated: the evidence rows, component 3 template and component bindings, the stagger spec cases (open batch during replay staggers, later replay page does not, hold window gives none), and Revision 1 item 3.

## Clarifications Needed

None. No decision here is user-reserved: no capability is removed, nothing is outward-facing, and all choices follow the motion-preset decisions already approved.
