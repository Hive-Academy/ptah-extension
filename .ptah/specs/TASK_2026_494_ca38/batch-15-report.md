# Batch 15 report: Apps page components and public API (Task 15.1)

Executor: frontend-developer subagent. Nothing was committed and no git state was changed.
Paths below are relative to `libs/frontend/mcp-apps-page/src/lib/` unless a path says otherwise.

## Files

| Status | File | Lines | Purpose |
| --- | --- | --- | --- |
| CREATED | `components/apps-page.component.ts` | 254 | Host, composer and the 3-column grid with the splitter slot. Carries the `AppsFocusMemoryDirective`. |
| CREATED | `components/apps-page.component.spec.ts` | 693 | Page-level pins. Uses the real `AppsSessionService`, `AppsSurfaceOperations`, `PermissionHandlerService` and `SurfaceRendererComponent`. |
| CREATED | `components/apps-transcript.component.ts` | 228 | Transcript: typed bubbles, submitted bubbles and `buildTree` nodes merged by time. Also this surface's permission and question prompts. |
| CREATED | `components/apps-surface-panel.component.ts` | 413 | Switcher, renderer, mono fallbacks, notices and the validated `lastSubmit` line. |
| CREATED | `components/apps-surface-panel.component.spec.ts` | 384 | Panel pins. The session is a signal stub driven by the real reducer. |
| MODIFIED | `../index.ts` | 2 | Exports `AppsPageComponent` and `AppsSessionService`. |
| MODIFIED (outside the list, see Deviations) | `state/apps-surface-reducer.ts` | 501 | Adds the pure `setSurfaceViewState` (:455) and `activateSurface` (:472). |
| MODIFIED (outside the list) | `services/apps-session.service.ts` | 683 | Adds `setSurfaceViewState` (:409), `activateSurface` (:420) and the private `patchActiveSurfaces` (:633). |
| MODIFIED (outside the list) | `libs/frontend/declarative-dashboard/.../dashboard-chart.component.ts` | 175 | Adds the client-only chart Expand/Collapse control, with Escape to collapse and focus return. |
| MODIFIED (outside the list) | `libs/frontend/declarative-dashboard/.../dashboard-chart.component.spec.ts` | 141 | Adds one Expand/Escape test. |
| MODIFIED (outside the list) | `libs/frontend/declarative-dashboard/.../surface-layout.component.ts` | 147 | "Sent" gets `text-success`, as in the prototype. Every other status stays `text-base-content`. |
| MODIFIED (outside the list) | `libs/frontend/declarative-dashboard/.../surface-layout.component.spec.ts` | 166 | Pins the Sent color and the uncolored rejected status. |

Every file is 700 lines or less. `mcp-apps-page` (type:feature) imports `@ptah-extension/chat` and `chat-streaming`, the same imports harness-builder uses. Lint reports no boundary error.

## Quality requirements

| Requirement | Where |
| --- | --- |
| The page holds no state | `apps-page.component.ts:210` is the only local value: the composer's uncommitted draft. The class doc explains why. Surfaces, the active id, view states and overlays live in the slice. The panel's only signal is `failedRenderable` (`apps-surface-panel.component.ts:283`). It records the render outcome by content identity, not any surface state. |
| Prompts filtered with `targetTabsFor(id).includes(surfaceId)` and the question twin | `apps-transcript.component.ts:184-207`. Both read `routingTargetRevision()` first, as the harness does. |
| Transcript comes from `ExecutionTreeBuilderService.buildTree(state, 'apps:' + surfaceId)` | `apps-transcript.component.ts:152`. Pinned: `apps-page.component.spec.ts:485` asserts that exact cache key. |
| Transcript consumes `AppsSurfaceOperations.submittedBubbles` (B13) | `apps-transcript.component.ts:164-171`, merged with typed bubbles and nodes by `at`. A user bubble wins a tie (harness precedent). |
| Switcher is `role="tablist"` when there is more than one surface | `apps-surface-panel.component.ts:164`. It uses `role="tab"`, `aria-selected`, `aria-controls` and a roving `tabindex`, and the body becomes `role="tabpanel"` labelled by the active tab. Arrow keys, Home and End are handled at `:386`. |
| Rejected → `font-mono` "This app could not be shown." + reason | `appsFallbackText` at `apps-surface-panel.component.ts:100`. |
| `renderFailed` → `renderDashboardSpecText` (v1) or `renderSurfaceText` (v2) | Same function. It never throws; if the text step throws, it falls back to a reason line only. |
| Notices use `role="status"` | `apps-surface-panel.component.ts:197`. Three sources: the eviction notice, `syncNotice`, and the Req 6.6 selection notice from `operations.notice(id)`. The composer error is a `role="alert"` (`apps-page.component.ts:133`), because it is a failure and not a notice. |
| OnPush, standalone, signal state, no timers | All three components. Transcript auto-scroll uses `afterRenderEffect` (`apps-transcript.component.ts:212`), which runs in the render phase and uses no timer. |
| Markdown only through the chat lib | The transcript renders agent output only through `ExecutionNodeComponent`. User text is plain interpolation. There is no `innerHTML`, `bypassSecurityTrust` or `DomSanitizer`, and `trust-boundary.spec.ts` stays green (see Verification). |
| No `text-base-content/NN` | None added. Secondary text uses `text-base-content-muted`. |

## Carry-overs

| Carry-over | What I did |
| --- | --- |
| Put `AppsFocusMemoryDirective` on the page host and pin restore at page level (B14) | `hostDirectives: [AppsFocusMemoryDirective]` at `apps-page.component.ts:46`. The host gets `tabindex="-1"` (asserted at spec :359). Composer, send, stop and new-conversation carry `data-apps-focus-key="apps:*"`, and switcher tabs carry `apps:switcher:<id>`. Pin: spec :579 focuses the composer, destroys the page, re-creates it, and checks `document.activeElement` is the composer. |
| B12 N4: keep the draft on a failed `start()` and on a send-before-resolve | `send()` (`apps-page.component.ts:235-243`) clears the draft, awaits `session.send`, and puts the typed text back when `session.error()` is set. If the user has typed something new in the meantime, that new text is kept. Pins: spec :394 (failed `chat:start`) and spec :411 (send before resolve). |
| B11: validate `lastSubmit` before rendering it | `readLastSubmit` (`apps-surface-panel.component.ts:67`) accepts a record only with `status` of `applied` or `indeterminate` and a finite, non-negative numeric `submittedAt`. Anything else renders nothing. This also keeps `DatePipe` from throwing on a malformed time. Pins: panel spec :340 (8 malformed shapes) and :359 (valid shown, malformed hidden). |
| B11/B12: eviction notice UX | Decision: show the latest notice (single slot). See Decisions. Pin: panel spec :251. |
| B6: a throwing builder override and a default `renderFailed` must behave the same | Both reach the panel through the renderer's single `(renderFailed)` output (`apps-surface-panel.component.ts:236` → `markRenderFailed` :381). The `fallback` computed (:316) then replaces the renderer with the mono block. The renderer subtree is removed, and the transcript and composer stay. Pin: page spec :507 is one `it.each` over both cases with identical assertions: no `ptah-surface-renderer`, text starting with "This app could not be shown.\nReason:" and ending with `renderSurfaceText(view)`, transcript intact. |
| B8: bind `interaction` through a computed, no second input | `interaction = computed(() => operations.interaction(active.surfaceId))` (`apps-surface-panel.component.ts:325`), bound at :231. Host rejections reach the inputs only through `interaction.issues`. |
| B8 fix 1: store the emitted `viewState` verbatim and synchronously | `(viewStateChange)="storeViewState(id, $event)"` calls `session.setSurfaceViewState` directly, with no copy and no deferral. The reducer stores the same object (`apps-surface-reducer.ts:455`). Pin (page spec :550): typing into a real text input stores the object synchronously, before any change detection (`stored === emitted[0]`). After change detection, `renderer.viewState()`, `renderer.state()` and the text input's `drafts()` are that same object or record. Panel spec :320 repeats it at component level. |
| B8/R6: re-run `trust-boundary.spec.ts` | Runs inside the declarative-dashboard test target (Verification). It now scans the populated `mcp-apps-page/src`. None of my sources or specs contain a sink token. |
| B13: the lane's first-tick read can be late by one grace period | Timing only; nothing to do in the page. |
| Chart Expand is client-only; sort, filter, page and Expand make zero RPC and zero postMessage | The chart had no Expand control (only the table did), so I added one (Deviation 2). Pin: page spec :634 uses a real table (30 rows, so the pager is shown) and a real chart. After `mockClear` it runs sort, then Next (asserting page 1), table Expand, chart Expand, then filter. It checks the stored view state and `aria-expanded`, then `rpc.call` and `VSCodeService.postMessage` not called. |
| The table always shows the pager (`SURFACE_PAGE_SIZE` 25) | Already true in `DashboardTableComponent` (the pager is unconditional). The zero-RPC pin clicks its Next button. |
| Prototype (a): below ~480px and in the embedded sidebar, stack the columns and collapse grids to one column | The page is an `apps-page` inline-size container (`apps-page.component.ts:55-94`). At 480px or less the grid becomes one column, the conversation gets `max-height: 260px` with a bottom border, the splitter slot is hidden, and the surface gets `min-height: 480px`. These values come from the prototype's `app.css`. The panel is its own `apps-surface` container (`apps-surface-panel.component.ts:143-160`). At 480px or less it forces `.grid` in the renderer to one column, so stat and chart grids collapse even when the window is wide but the panel is narrow. Container queries cover both a narrow viewport and the embedded sidebar. Tailwind 3.4 here has no container-queries plugin, so this is component CSS (precedent: `git-review-panel.component.ts:45-51`). |
| Prototype (b): rejected color on the icon and spine only | The mono fallback block has a `border-l-2 border-warning` spine and an `AlertTriangle` icon in `text-warning` (`aria-hidden`). The text stays `text-base-content`. The panel spec asserts no `text-error`/`text-warning` on the text. The submit status in `surface-layout` stays uncolored for every rejection (asserted). |
| Visual gate: the "Sent" color follows the prototype | The prototype shows "Sent" with `text-success` (`prototype/index.html:589-592`, `states.html:53`). `surface-layout.component.ts` binds `text-success` only for `applied` (Deviation 3). |

## Spec pins

| Pin | Test |
| --- | --- |
| Empty state | page spec :359 (with the composer and no conversation controls); panel spec :156 |
| Only this surface's prompts | page spec :431: a permission and a question for this surface render; ones for another surface or `tab-live` do not |
| Rejected → mono fallback with the transcript | page spec :485; panel spec :290 |
| Builder override throws → mono fallback, no renderer subtree | page spec :507 (and the `renderFailed` twin in the same `it.each`); panel spec :305 (v1 → `renderDashboardSpecText`) |
| Destroy/re-create restores transcript, surfaces, view state, overlays (and focus) | page spec :579: user bubble and agent node, `renderer.viewState()` is the same object, the filter input shows `x`, `pendingValues` has the overlay and the text input shows it, focus is on the composer |
| Sort/filter/page/Expand → zero `ClaudeRpcService.call` and zero `VSCodeService.postMessage` | page spec :634 |
| Switcher with two surfaces | panel spec :166 (none with one surface; tablist, tabs, `tabpanel` wiring and roving tabindex with two); keyboard at :220 |
| An agent snapshot activates its surface | panel spec :195: an agent snapshot activates; a user pick sticks through a `ui`-origin write; the next agent snapshot activates its surface again |
| Eviction notice | panel spec :251: `role="status"`, latest only, the empty state stays hidden, the notice clears on rebuild |
| viewState verbatim and synchronous | page spec :550; panel spec :320 |

## Decisions

1. **Eviction notice: show the latest, no queue.** The reducer already keeps one `notice` slot. A new eviction replaces the old notice, and the notice clears when its surface comes back (`clearNoticeFor`). A queue would need new state and a dismiss flow. Each eviction carries the same copy ("removed to free memory, ask the agent to rebuild it"), and the switcher already shows which surfaces remain, so a queue would add no information.
2. **The composer draft is local to the page.** It is an uncommitted form-control value, not conversation state. Putting it in the slice would widen the session contract for one input. It does not survive a tab switch; nothing requires that.
3. **Render failure is recorded by content identity** (`failedRenderable`), not as a surface flag. A new push or read produces a new content object and retries the render. Switching back to a surface that failed shows its fallback without mounting the renderer again. The panel does not pre-build: both failure modes go through the renderer's own `attemptBuild`, so they are identical by construction and the model is not built twice.
4. **One renderer per surface.** The renderer sits in `@for (id of [entry.surfaceId]; track id)`, so a surface switch mounts a fresh renderer. No draft bindings or local overlays cross surfaces, and `viewStateChange` always belongs to the surface it was created for.
5. **"New conversation" aborts a running agent first, then calls `discard()`**, because `discard()` does not abort (its doc says so). The button, and Stop, are hidden until a conversation exists, which matches the empty-state prototype.
6. **The `lastSubmit` line** reads "Last submitted at {shortTime}." for `applied`, and "... may have been sent. Do not resend." for `indeterminate` (plan copy). It is muted secondary text.
7. **Copy.** Switcher labels are the surface title text, or "Untitled app", or "App not shown" for a rejected document. The renderFailed reason reads "this page could not draw it. Its text follows."

## Deviations (files outside the batch's six)

1. **`state/apps-surface-reducer.ts` and `services/apps-session.service.ts`.** B8 fix 1 requires storing the emitted view state, the Req 2.4 pin requires it to survive re-create, and "the page holds no state" rules out keeping it in the page. The reducer already had `entry.viewState` and `activeSurfaceId`, but nothing could write them. I added two pure transitions plus two thin session methods, each patching only the shown conversation and never throwing. Neither moves `seq`, a revision or an overlay. Side effect: every draft keystroke now changes `session.surfaces()`, so the `AppsSurfaceOperations` effect re-runs `reconcile`. That is cheap, idempotent and sends nothing (the zero-RPC pin covers it). No existing B11/B12 spec changed.
2. **`dashboard-chart.component.ts` (+spec).** The batch requires a client-only chart Expand, but only the table had one. The new button follows the table's pattern: `aria-expanded`, `aria-controls`, an `aria-label` of "Expand/Collapse {title}", a focus key `…:expand`, and Escape to collapse with focus returned. Collapsed caps the SVG at `max-h-64` and the table view at `max-h-96`; expanded removes the cap. It sits after the chart/table toggle, so the existing specs that take the first button still pass. It emits only `viewStateChange`.
3. **`surface-layout.component.ts` (+spec).** Required by the "Sent" visual gate. It is a one-class change; rejected, indeterminate and unknown statuses stay `text-base-content`.

## Verification (tails)

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2`: exit 0. "Successfully ran targets lint, typecheck, test for 2 projects".
  - mcp-apps-page tests: 13 suites, 233 passed (211 at B13, plus 11 page and 11 panel tests).
  - declarative-dashboard tests: 17 suites, 214 passed, including `trust-boundary.spec.ts` (22 tests; its `mcp-apps-page has no HTML sink` case now scans the populated lib).
  - Lint: 0 errors. mcp-apps-page has 0 warnings. declarative-dashboard has 64 warnings, all pre-existing `no-non-null-assertion`; my added spec lines add none.
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`: exit 0, no output.
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`: exit 2. **All 12 errors are in files this batch did not touch.** I fixed the one error in my own spec.
  - 4 × `core/src/testing/mock-rpc-service.ts`
  - 4 × `git-ui/.../monaco-loader.service.ts` (TS2352)
  - `apps-submit-flow.spec.ts:333`, `apps-surface-lanes.spec.ts:149` and `apps-surface-sync.spec.ts:319`: `'INTERNAL_ERROR'` is not an `RpcUserErrorCode`
  - `apps-surface-reducer.spec.ts:229`: `.surface` on the `SurfaceContent` union

  These come from B11-B13 and shared libs. The "include tsconfig.spec.json in typecheck" enhancement in context.md exists because of this gap. Out of scope; reported here.
- Both `tsconfig.spec.json` files exist.

## Notes for B20 (splitter)

- **Slot:** `<div class="apps-split-handle-slot" data-testid="apps-split-handle-slot">` is the second child of `.apps-layout` (`apps-page.component.ts:196`). It is empty and sits in the `auto` grid column, so the handle's own width sets it. Put `ptah-electron-resize-handle` inside it, or replace it.
- **Columns:** `.apps-layout` is `grid-template-columns: var(--apps-conversation-width, 360px) auto minmax(0, 1fr)` (`:62-69`). Bind the width by setting `--apps-conversation-width` on `.apps-layout` or the host (for example `[style.--apps-conversation-width.px]="layout.appsSplitWidth()"`). The surface column is `minmax(0, 1fr)`; the ≥360px clamp is B20's job.
- **Offset:** the host `<ptah-apps-page>` is the container whose `getBoundingClientRect().left` to subtract. The grid starts at the host's left edge with no padding.
- **Stacked mode:** in the `@container apps-page (max-width: 480px)` block the slot is `display: none`, so B20's "handle absent when stacked" pin can rely on the same block. jsdom has no layout, so a spec can only assert the CSS rule or an explicit state.
- **Spec size:** `apps-page.component.spec.ts` is 693 lines. Put the splitter pins in a separate spec file, or trim, to stay under 700.

## Notes for visual review

- Compare against `prototype/index.html` and `states.html` in both themes, wide and at 420px or less (embedded sidebar and a narrow window).
- Check the stacked layout (conversation max 260px above, surface min 480px) and that stat/chart grids collapse when the panel is 480px or less.
- Check the rejected and render-failure blocks: warning spine and icon, plain mono text.
- Check the eviction notice, which is inline (spine and icon) and not the centred block in `states.html`. It sits above the remaining surface, or alone when none remains.
- Check that "Sent" is green and every other submit status is uncolored.
- Check the chart Expand (text button "Expand"/"Collapse" after "Show as table") and Escape returning focus.
- The shell tab (B17) is not in this batch.
