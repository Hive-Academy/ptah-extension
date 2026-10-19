# Implementation Plan - TASK_2026_700_dcce

## Inputs and constraints

- Approved intent: `context.md`, `task.md`, `design-spec.md`, `decisions.md` D1-D9, `design-spec-review-r2.md`, `parity-inventory.md`, `prototype/command-center.html`, `prototype/README.md`, and the dark/light start, speaking, child-session, approval and narrow screenshots. D9 supersedes D3: child sessions are display-only, with no chat-tab navigation or tab availability copy. D4 keeps the context, Crucible plate and child tether fixes; D7 makes the prototype's Resume last slot the existing Start new action. All 39 parity rows are accounted for.
- Repository rule: root `CLAUDE.md` restricts verification to changed projects, one heavy run at a time. No per-library instruction file applies. The approved worktree already exists. No production code, tests, or checks are part of this architecture pass.
- Production constraints for every lane: Angular standalone components, `OnPush`, `inject()`, signal `input()`/`input.required()` and `output()`; no `@Input`, `@Output`, `NgModule`, `any`, or `@ts-ignore`. Import other libraries through public `@ptah-extension/*` aliases. No untrusted `[innerHTML]` or `text-base-content/NN` class. Use Canvas 2D; no 3D dependency. Every listener, observer, timer and animation frame has a release path. **User/project standing rules, D8 and HANDOFF/CLAUDE.md:** degradation audit stays at 294 with no new silent catches; use an injected Logger for any new logging, never a new `console` call; GSAP is allowed, not required. **Architecture choices for this task:** use local Lucide imports; extract the long page template/style into external files and keep components cohesive. The alpha guard scans only `.ts` and `.html`; the new page CSS must also avoid `@apply text-base-content/NN` and alpha text colours.
- Scope of the review fixes still approved by D9: M1 normal context ring below 70%, warning ring at 70% or above; M3 Crucible plate clears its sphere at 900px; M4 child-to-owned-lane tether, plate anchored to its own sphere, and child kind glyph on both plate and rail row. D9 removes the prior child-tab action and its availability copy. Child spheres, plates, rail rows and selected-card real fields remain display-only; execution surfaces only questions and permissions, with no chat transcript feed. Minor review items are acceptance observations: no fabricated idle stats; dense 24-node labels can still be suppressed by the established packing policy.

## Codebase evidence and architectural choice

| Evidence | Location | Consequence |
| --- | --- | --- |
| Page owns shell, stage, dock, rail, current/root/child stats and context warning computed from `sessionContextCue()` at `>=70` | `components/command-center-page.component.ts:35-60,65-143,259-449,451-545` | Keep page as composition root; extract its markup and styles, retain one source of context truth. |
| Page-scoped store has `CommandWorkNode` with `kind`, `parentId`, `providerId`, `state`, `updatedAt`, optional `tabId`; selection/toast signals | `model/command-center.store.ts:26-43,91-145` | Reuse node shape; no new RPC or persistent state. |
| Projection gives live children `tabId`, persisted children `unknown` without a tab, and recursive `parentId` ownership | `model/work-projection.ts:92-190` | Use `tabId` only to distinguish live/persisted visual grammar; nest/order by existing ancestry. No child tab action or invented data. |
| Scene layout owns packing, label placement and overflow; component owns theme ink resolution, DPR cap and lifecycle; renderer owns cached backdrop and active rAF; sprite cache supplies sphere/halo sprites | `scene/scene-layout.ts:56-116,299-440`; `scene/command-scene.component.ts:32-67,177-269`; `scene/command-scene-renderer.ts:45-111,205-292`; `scene/sprite-cache.ts:32-280` | Extend the current Canvas 2D pipeline. Keep pure geometry and DOM plates separate. |
| Overlay already supplies accessible plates, hover timing, pin/escape/focus and shared `ContextRingComponent` with a tone input | `components/command-overlay.component.ts:51-130,181-210,336-515`; `chat-ui/src/lib/atoms/context-ring.component.ts:56-71` | Restyle plates without replacing interaction; pass the page's warning tone to the ring. |
| Start component already reads `ChatSessionSummary`, `knownSubtotalOf`, valid token usage, live phase and recorded ID | `components/command-center-start.component.ts:185-304` | Change presentation and remove six age bars; do not add a recent-session cost field. |
| Lucide usage is per standalone component with `LucideAngularModule` and imported icon values (`[img]`); no app-level icon registry was found in webview or command-center | `components/command-node-detail.component.ts:18,53-57,81-87`; `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:16,77` | Import named Lucide values locally, including a `GitBranch` child glyph. No webview or theme configuration edit. |

**Chosen shape.** Keep `CommandCenterPageComponent` as the sole page composition root. Presentational header, dock, start, rail, overlay and scene components receive real signal inputs and emit narrow existing actions. Child sessions are display-only; the page has no route to their chat tabs and surfaces execution requests only as questions or permissions. Keep root session ownership in `CommandCenterSessionCoordinator`, pending guards in the current controller/provider, and geometry/rendering in the current scene pipeline. The page owns the stats band's responsive CSS and passes its measured reserved height to the scene. The page template and styles move to external sibling files; this is an architecture choice grounded in the existing large inline page and the external-template precedent at `chat-view.component.ts:227`. No library outside `command-center` changes, no new library public export, no host RPC/API change, and no new dependency direction. Existing imports from `@ptah-extension/chat`, `chat-state`, `chat-ui`, `core`, `shared` and `ui` are public aliases; local relative imports remain within `command-center`.

## Component and file map

All paths below are relative to `libs/frontend/command-center/src/lib/`. `M` means modify, `N` create; named specs belong to their source owner. Independent batches have disjoint files. A2a and A2b are an explicitly sequential two-step edit of the page files: mechanical extraction first, then behavior/layout wiring; do not run these lanes concurrently or revert A2a's output. `model/work-projection.ts`, `model/command-center.store.ts`, `scene/sprite-cache.ts`, `apps/ptah-extension-webview/tailwind.config.js`, and the host/chat libraries are evidence and remain unchanged. Keep the existing child projection and silver sprite palette.

| Batch | Production files owned | Purpose |
| --- | --- | --- |
| C1 | M `components/command-node-detail.component.ts` | Selected-card visual grammar and real root/child fields; no action or coordinator change. |
| C2 | M `components/command-work-list.component.ts`, `components/command-pending-input.component.ts` | Nested delegated rail rows, clip cue, warm pending variants. |
| D1 | M `scene/scene-layout.ts` | Bounded scene rectangle, child-owned orbit and collision-safe plates. |
| D2 | M `scene/command-scene.component.ts`, `scene/command-scene-renderer.ts`; N `scene/command-scene-decoration.ts` | Scene rect integration, gold/halo/edge rendering, silver tether and cached decorations. |
| D3 | M `components/command-overlay.component.ts` | Accessible prototype plates, icon/kind cues, context tone. |
| B | M `components/command-session-controls.component.ts`, `components/command-voice-hud.component.ts`; N `components/command-dock.component.ts` | One responsive dock with existing voice and command actions. |
| A1 | M `components/command-center-start.component.ts`, `components/command-session-stats.component.ts`; N `components/command-center-header.component.ts` | Start cards, header, and reserved-band stats presentation. |
| A2a | M `components/command-center-page.component.ts`; N `components/command-center-page.component.html`, `components/command-center-page.component.css` | Mechanical external-template/style extraction, unchanged markup and behavior. |
| A2b | M `components/command-center-page.component.ts`, `components/command-center-page.component.html`, `components/command-center-page.component.css`, `components/command-center-page.controller.ts` | Final wiring and page/stage/rail layout, stats-band measurement and existing theme toggle. Sequential follow-up to A2a. |

### Phase C — selected work and right rail

**C1, one lane, at most 40 tool calls.** In `CommandNodeDetailComponent`, use the spec's selected card typography, badge, provider artwork or raw-ID monogram, state, distinct task preview, elapsed time, phase/freshness and child messages/tokens/cost only when supplied by live stats. Root omits repeated body. A child card renders real fields only: no tab availability copy, button, output or navigation. A persisted child omits unavailable stats without substituting invented values. The overlay pinned detail remains read-only through the same component. Tests: `components/command-node-detail.component.spec.ts` covers root/child fields, absent stats, provider fallback and accessible static detail. Parity rows 17 and 20. Checks: `npx nx typecheck command-center --parallel=1`; `npx nx lint command-center --parallel=1`; `npx nx test command-center --parallel=1 --maxWorkers=2`; and the alpha guard below, sequentially.

**C2, one lane, at most 40 tool calls.** In `CommandWorkListComponent`, retain all non-root nodes and flat keyboard index semantics while rendering visible depth from `parentId`: root children at top level, their agents/lanes/Tribunal groups beneath, including grandchildren with a bounded indent. Preserve `ArrowUp/ArrowDown` wrap, Enter, roving tabindex, `aria-current`, focus return by projection index and the one polite state-change announcement. Add child `GitBranch` kind glyph and full-opacity unknown text. Use a single scroll container on the delegated card; a `ResizeObserver` on that one container (released on destroy) determines `scrollHeight > clientHeight` for scroll cue and last-visible-row fade; no observer per row. Respect `reducedMotion`. Preserve count/off-canvas line and empty guidance. In `CommandPendingInputComponent`, restyle approval/question/Tribunal as the warm middle rail card with scoped copy and icons; keep permission priority, ordinary typed-answer/timeout/rejection behavior, and explicit focused Tribunal Confirm guard and invalid-proposal disable. Preserve `ptah-command-work-list ul button`, `ptah-command-work-list [aria-live="polite"]`, `#pending-title`, `#pending-answer`, and visible row/kind/state text: `integration/accessibility-list.spec.ts`, `delegation-and-status.spec.ts`, `failure-and-fallback.spec.ts`, and `tribunal-confirm-gate.spec.ts` rely on them. Tests: `components/command-work-list.component.spec.ts` for nesting, unknown child, keyboard/focus, clipping cue and one live region; `components/command-pending-input.component.spec.ts` for all three variants and guards. Parity rows 21–23, 25–30, 38–39. Same four sequential checks as C1.

### Phase D — Canvas 2D grammar

**D1, one lane, at most 40 tool calls.** Extend `SceneViewport` with optional `sceneRect?: SceneRect` so current callers and specs still compile until D2; `layoutScene()` uses that explicit rect when present, otherwise its old viewport bounds. For production rects, place root at rect midpoint, clamp each orbital axis to rect half-width/height, preserve the 23-node priority/ancestor budget and overflow counters, and reserve foot clearance. Direct work owned by a child is placed on a dashed roughly 70px child orbit after that child core is packed; a grandchild child sphere orbits its immediate parent child, recursively, while child-owned agents/lanes/Tribunal groups use their owner's local orbit. Every plate candidate starts below its own sphere radius plus at least 8px, with a 12px inter-plate gap, top at `sceneRect.y + 6`, horizontal edges at least 8px, and collision checks against spheres and other plates. At 900px, choose a side position if a below placement would cover the Crucible sphere. Dense plates can be omitted but selected, failed, awaiting and root plates retain priority. Tests: `scene/scene-layout.spec.ts` for 1440, 900, 720, 480 and 24 nodes, Crucible plate/sphere non-overlap, grandchild orbit, child-owned tether coordinates/anchored plate, unknown child and overflow preservation. Parity rows 13, 18, 39. Checks: typecheck, lint and test for `command-center` sequentially; no alpha guard because this batch has no template edit.

**D2, one lane, at most 40 tool calls, after D1.** `CommandSceneComponent` accepts `reservedTop = input<number>(72)`, a stage-local band height supplied by A2b; it computes `sceneRect` from its observed canvas viewport using `reservedTop() + 10` for the scene top and stage height minus 62px for the bottom. It does **not** infer band height or breakpoints from canvas width. The default keeps its isolated specs stable until A2b. Keep ResizeObserver/MutationObserver/media-query teardown, theme ink resolution once per theme, DPR <=2, sprite-cache prune, and hidden-tab/reduced-motion rAF gates. `CommandSceneRenderer` renders approved gold Ptah sphere/ring, dotted voice halo, orbital curves, state rings/elapsed arcs, and a thin silver child-to-owned-work tether terminating on the child. A live child sphere gains a second thin silver ring; a persisted no-tab child is dimmed, has a dashed silver ring and a `CS` monogram. Use cached gradients/backdrop. Extract static backdrop/edge-glow drawing to `scene/command-scene-decoration.ts`; no public abstraction. Preserve hit-test click and hover. Tests: `scene/command-scene.component.spec.ts` sets `reservedTop` explicitly and verifies rect/teardown, with no width-to-band table; `scene/command-scene-renderer.spec.ts` covers both child ring variants, tether endpoint, theme cache invalidation, idle/reduced-motion no perpetual rAF and selection hit tests; `scene/scene-contrast.spec.ts` covers state ring/child silver dark/light contrast. Parity rows 13–14, 18, 39. Checks: the four sequential commands, including alpha guard because the scene component template changes.

**D3, one lane, at most 40 tool calls, after D1.** Restyle `CommandOverlayComponent` plates under their spheres using the scene's `labelRect`s: provider mark or raw-ID monogram, node kind icon, state icon and selected edge; Ptah plate reads `Ptah · HEAD OF ENGINEERING` and displays the verified context ring. Keep `rootContextPercent` null for unknown and pass `rootContextTone` from the page: `normal` below 70%, `warning` at/above 70%. Do not add unconditional orange CSS to `.plate-context .context-ring`. Child plate gets its own provider/state and small silver `GitBranch`; unknown child reads “Child session / Provider unknown · unknown” with full-opacity text. Preserve 150ms/200ms hover, card bridge, pin, Escape, keyboard plate activation, focus restoration and reduced-motion transition gate. Tests: `components/command-overlay.component.spec.ts` for context tones at 62/70/unknown, child glyph/provider fallback, overlay keyboard/timing/focus and reduced motion. Parity rows 4, 15–17, 39. Checks: four sequential commands including alpha guard.

### Phase B — integrated dock

**B, one lane, at most 40 tool calls.** `CommandDockComponent` is the presentational grid owner and composes the existing `CommandVoiceHudComponent` and `CommandSessionControlsComponent`; it owns no voice session state. At 900px it presents mic/title with speaking waveform beside status, Mute/Stop/Status/**Start new**, then a full-width command field. At <=720px it uses four rows: mic/title, Mute/Stop/Status, full-width field, full-width **Start new**. Per D7, that slot uses the existing `newSession` action and never calls `chooseCurrentTab()`; there is no `resumeLast` output or `canResume` input. Modify the two child components' templates so the parent grid can place their distinct regions without nested card borders; preserve their existing signal inputs, outputs and safeguards. Start new, Status, send, mic, mute, stop/interrupt, provider recovery, numeric mic/speaker meter and speaking-only speaker remain. The full-width field cannot collapse; retain draft on failed send and clear only on success. Preserve `ptah-command-voice-hud button`, `ptah-command-session-controls input`, `label[for="command-text"]`, and `ptah-command-session-controls form` because `integration/accessibility-list.spec.ts` and `failure-and-fallback.spec.ts` query them; retain visible **Retry speech** and **Could not send** text. Tests: new `components/command-dock.component.spec.ts` for 900/720 layout hooks and Start new action; update `command-session-controls.component.spec.ts` and `command-voice-hud.component.spec.ts` for actions, draft, recovery and accessible meters. Parity rows 31–36, 38–39. Checks: four sequential commands including alpha guard.

### Phase A — start/header/stats, then page integration

**A1, one lane, at most 40 tool calls.** `CommandCenterHeaderComponent` is a standalone presentational header with signal inputs for session ID/status, voice provider text/aria status, context cue/warning, dark-mode state and mic error; outputs `voiceSettings` and `themeToggle`. It shows Ptah tile, Cinzel title, first eight session-ID characters or “new,” separate status, context warning at >=70%, provider model/readiness chip, Voice settings and theme icon, with 78px desktop height and one-line title. Settings recovery remains accessible. `CommandCenterStartComponent` adopts the approved start hero/current card/recent grid at 480/720/900/1440; current card once, excluded from recent, real current stats and recorded mark only on matching ID. Remove `activityBars()` and its six-bar UI; retain valid relative time, real messages/tokens, live `isActive`/`livePhase`, provider artwork/monogram, per-card `hasTranscript === false` note, list error Retry, loading/empty and choosing disable. `CommandSessionStatsComponent` renders the four reserved-band cells with Lucide icons; omit a cell when its value is unknown rather than showing invented cost/duration, retain provisional `~` and known-subtotal wording. Tests: new `components/command-center-header.component.spec.ts`; update `command-center-start.component.spec.ts` and `command-session-stats.component.spec.ts` for data omissions and all start states. Parity rows 1–5, 7–10, 12, 35. Checks: four sequential commands including alpha guard.

**A2a, mechanical extraction, one lane, at most 40 tool calls, before A2b.** Move the current page markup/styles from `command-center-page.component.ts` to sibling `.html` and `.css`, replacing the inline declarations with `templateUrl` and `styleUrl`; preserve the rendered DOM, selectors, bindings, responsive rules and behavior exactly. Update `components/command-center-page.component.spec.ts` only where its layout test at line 531 reads CSS from the former inline TypeScript source, so it reads the external CSS file; all behavior assertions stay unchanged and green. The six integration specs below remain unmodified gates. Parity rows 1–6, 11–12, 17–20, 24, 31–32, 37–39 are unchanged. Checks: the four sequential commands below, including the alpha guard.

**A2b, final wiring/layout, one lane, at most 40 tool calls, after C1/C2/D1/D2/D3/B/A1 and A2a.** Wire header, dock, selected-card read-only detail, existing pending/list/overlay/scene outputs, and start actions. The dock's Start new output continues to call `page.coordinator.newCommandCenter()`; there is no dock route to `chooseCurrentTab()`. The 1440 layout uses 22px gutters, 78px header, 16px deck gap, 336px rail, >=600px stage and 14px dock gap; at 900 use 260px rail/570px stage; below 720 stack stage then dock then rail; at 480 use 500px stage. Use a two-column grid where the rail spans stage plus dock height, upper cards natural height and delegated work `flex:1; min-height:0`. The page CSS owns an opaque stats/caption band with 72px above 1100px page width, 144px at/below 1100px, and 154px at/below 480px. Measure that band with one page-level `ResizeObserver`, release it on destroy, store its height in a signal and bind `[reservedTop]="statsBandHeight()"` to `CommandSceneComponent`; scene geometry adds the 10px separation. No scene-width breakpoint duplicates this CSS rule. On Canvas failure, show list-only stage guidance while keeping rail/dock usable. Keep pending compact cue/scroll, fixed safe latest reply and record-write-failure notices, root/child stats, existing root-session focus behavior and all current event guards; do not add child chat navigation or an execution message feed. Add `toggleTheme(): void` to the existing page controller, forwarding to its already optional `ThemeService`; header calls this method, and the controller's existing effect updates scene theme. Tests: `components/command-center-page.component.spec.ts` for 1440/900/720/480 structure and band measurement, display-only child selection, context ring threshold, Canvas fallback, pending cue, safe notices and existing start/send/status cases. Preserve the DOM contracts below or update this component spec where the approved design intentionally changes its own selectors. Parity rows 1-6, 11-12, 17-20, 24, 31-32, 37-39. Checks: four sequential commands below including alpha guard.

**Page DOM gates for B, C2, A2a and A2b.** Keep all six integration specs unmodified and run them with the scoped command-center test check: `integration/accessibility-list.spec.ts` needs `canvas`, `ptah-command-work-list`, `ptah-command-voice-hud button`, `ptah-command-session-controls input/form`, `label[for="command-text"]`, `ptah-command-work-list ul button`, `[aria-label="Selected work"]`, `ptah-command-work-list [aria-live="polite"]`, `#pending-title` and `#pending-answer`; `integration/delegation-and-status.spec.ts` needs work-list row buttons, selected-work label, state/kind text and Tribunal council text; `integration/failure-and-fallback.spec.ts` needs Retry speech, failed CLI agent row, Could not send, draft field and both dock child tags; `integration/tribunal-confirm-gate.spec.ts` needs the Confirm Tribunal button; `integration/voice-turn-loop.spec.ts` needs spoken status and visible added-diff text; `integration/session-identity-and-lock.spec.ts` exercises page state/lock rather than a DOM selector. The page component spec additionally depends on `header`, `.stage`, `.rail`, `.pending-cue`, `.page-toast[role="alert"]`, `[aria-label="Command dock"]`, `[aria-label="Selected work"]`, `[aria-label="Delegated work list"]`, `ptah-command-session-controls form`, `ptah-command-voice-hud`, `ptah-command-pending-input`, `ptah-command-center-start`, `[role="meter"][aria-label="Speaker"]`, and context/caption chips. A2a preserves them byte-for-byte; A2b preserves the behavioral selectors, updating only design-specific structure assertions.

**Scoped verification command set for any template batch (run one at a time):**

```text
npx nx typecheck command-center --parallel=1
npx nx lint command-center --parallel=1
npx nx test command-center --parallel=1 --maxWorkers=2
npx jest -c apps/ptah-extension-webview/jest.config.ts apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts --coverage=false --maxWorkers=2
```

Run only changed Jest specs first when useful, using `npx jest -c libs/frontend/command-center/jest.config.ts <spec paths> --coverage=false --maxWorkers=2`. Never run workspace-wide targets, build, serve, dev or e2e. The alpha guard is mandatory for every template change, including extracted templates. Tests should assert behavior and measurable geometry, not mirror CSS implementation.

## Contracts and data flow

| Contract | Exact source and rule | Consumer |
| --- | --- | --- |
| `CommandWorkNode` and `ProjectionResult` | Existing `command-center.store.ts:26-43` and `work-projection.ts:76-79`; `parentId` is the ownership relation and `tabId` distinguishes a live child from a persisted child for display only. No new field required. | scene, overlay, rail, selected card |
| Header inputs/outputs | `sessionId`, `sessionStatus`, `voiceChipText`, `voiceChipAriaLabel`, `voiceChipReady`, `contextLabel`, `contextKnown`, `contextWarning`, `darkMode`, `micDenied`; outputs `voiceSettings`, `themeToggle`. Page supplies all from existing computed/store/controller values. | `CommandCenterHeaderComponent`. |
| Dock inputs/outputs | Existing `voiceState`, `provider`, `muted`, `voiceError`, `inputLevel`, `outputLevel`, `turnAbortable`, `sessionStatus`; existing `newSession`, `requestStatus`, `commandSubmit` and voice outputs only. D7: Start new occupies the prototype Resume last slot. | `CommandDockComponent`, child HUD/controls, page. |
| `SceneViewport.sceneRect?: SceneRect`; `CommandSceneComponent.reservedTop: InputSignal<number>` | D1 optional geometry bridge; D2 uses `reservedTop = input<number>(72)` as stage-local band height. A2b page measures its band with one released `ResizeObserver` and binds the signal; page CSS alone owns 1100/480 breakpoints. | `layoutScene`, scene component, renderer. |
| Context | `sessionContextCue(root?.liveModelStats ?? null)` from marked tab; `known && percent >=70` is the single warning condition. Unknown gives “Context unknown” and no ring. | Header and root plate, same value/tone. |
| Root/current stats | `rootStats/currentStats` read `TabManagerService.tabs().sessionStats` for the marked/current tab. `knownSubtotalOf`, `agentCountOf`, `durationMsOf` and formatters retain their current meaning. Omit unknown cell. | stage band and start current card. |
| Recent session summary | `CommandCenterSessionCoordinator.sessions` from `session:list`; `ChatSessionSummary` supplies name, provider ID, `lastActivityAt`, message count, token usage, `isActive`, `livePhase`, `hasTranscript`. No cost, progress or inferred phase. | Start recent cards. |
| Child stats | Existing page `childStats` maps a projected `node.tabId` to that live tab's `sessionStats`; absent tab/snapshot means absent figures. `updatedAt` only yields freshness if present. | Selected child card. |
| Pending/voice | Existing page controller, `CommandCenterRosterProvider`, coordinator and `CommandVoiceLoop` own guards, priorities, speech and RPC boundaries. | Presentational pending card and dock emit existing actions. |

The root page reads signals; projection supplies nodes/edges; scene layout returns geometry, overflow and labels; renderer draws Canvas 2D while overlay/list expose names and selection. Child sessions remain display-only. No new persistence, cross-host adapter, RPC, public API export, external network call or child-tab navigation is needed.

## Complete parity assignment

Every row is **keep** at capability level. A row listed in multiple batches is preserved by one owner and wired/verified by A2b; it is not a second implementation. Row 9's six decorative age bars are a sub-element marked **remove-proposed, approved D1**; the recent session capability and all real summary fields stay.

| Inventory row | Capability shorthand | Owning batch |
| ---: | --- | --- |
| 1 | Breadcrumb/title | A1, A2b |
| 2 | Voice/provider chip | A1, A2b |
| 3 | Session chip | A1, A2b |
| 4 | Context chip/warning/ring | A1, D3, A2b |
| 5 | Settings/mic recovery | A1, A2b |
| 6 | Dismissible toasts/retries | A2b |
| 7 | Start new/all/recent | A1, A2b |
| 8 | Current start card | A1, A2b |
| 9 | Recent cards and real fields; six age bars: remove-proposed, approved D1 | A1, A2b |
| 10 | Start loading/empty/error/restore | A1, A2b |
| 11 | Stage caption/counts/hint | A2b |
| 12 | Stats strip semantics | A1, A2b |
| 13 | Canvas radial graph/theme/halo | D1, D2 |
| 14 | Canvas click/hover | D2 |
| 15 | Accessible plates | D3 |
| 16 | Hover timing/bridge/Escape | D3 |
| 17 | Pinned detail/focus restore | D3, C1, A2b |
| 18 | Overflow chip/counts | D1, D2, A2b |
| 19 | Canvas fallback | A2b |
| 20 | Selected card fields | C1, A2b |
| 21 | Delegated rows | C2 |
| 22 | Delegated keyboard/focus | C2 |
| 23 | Empty/off-canvas footer | C2 |
| 24 | Compact pending cue/scroll | A2b |
| 25 | Tool permission | C2 |
| 26 | Ordinary question | C2 |
| 27 | Permission priority/scoping | C2 |
| 28 | Tribunal roster | C2 |
| 29 | Tribunal confirm guard | C2 |
| 30 | Tribunal decline/timeout/retry | C2 |
| 31 | Typed command/guards/draft | B, A2b |
| 32 | Start new/Status/reopen | B, A2b |
| 33 | Mic/mute/stop/interrupt | B |
| 34 | Mic/speaker meters | B |
| 35 | Voice recovery states | B, A1 |
| 36 | Status/Tribunal guidance | B |
| 37 | Safe reply/write/send failures | A2b |
| 38 | Live announcements | C2, B, A2b |
| 39 | Reduced motion | C2, D1, D2, D3, B, A2b |

The existing six age bars in row 9 are presentation only; approved spec §Layout/Parity 9 and D1 explicitly remove them while retaining updated time and all summary fields.

## Risks, failure behavior and quality gates

- **Live or persisted child:** `tabId` is visual evidence only: live child gets a second silver sphere ring, while persisted/no-tab child gets a dimmed dashed ring and CS monogram. The plate, rail row and selected card show real fields only. No tab availability copy, navigation action or related error path is added.
- **Ownership and density:** recursive projection can include grandchildren. Use `parentId` for rail nesting and scene tethers, cap visual depth without omitting rows, and retain ancestor-aware 23-node packing plus overflow counts. At 900/480, selected/important plates and the Crucible sphere must remain visible; other dense plates may be suppressed.
- **Canvas/voice failure:** stage fallback explains list-only mode while dock/rail stay usable. Existing pending, send, mic and Tribunal error/Retry paths remain with fixed safe messages; do not surface raw RPC errors or secrets.
- **Motion/performance:** only transform/opacity repeat indefinitely; no per-row timer or observer. Renderer rAF only for voice/running/hover/transitions, canceled when idle/hidden/destroyed. Cache sprites/gradients and resolve inks on theme change; cap DPR at 2. Reduced motion freezes decorative movement while preserving state and hit targets.
- **Light theme/contrast:** use theme tokens from webview Tailwind, `text-base-content-muted`, `secondary-focus` for small light gold labels, and measured state inks. Recheck text >=4.5:1 and control/state graphics >=3:1 on both `anubis` and `anubis-light`, including disabled/hover surfaces. No alpha base-content classes.
- **Accessibility:** Canvas remains `aria-hidden`; DOM plates and list are equivalent selection paths. Keep native pending buttons, focused Tribunal Confirm guard, focus restoration, one polite delegated/status live region plus assertive pending announcement, and numeric meters. Decorative Lucide instances are `aria-hidden` beside text labels.

## Decisions

| Decision | Options considered | Evidence | Reversible? |
| --- | --- | --- | --- |
| Keep current Canvas 2D pipeline and add scene rect/child orbit | Replace scene; extend scene | Approved spec §Canvas; current `layoutScene`, renderer and sprite cache already implement radial graph, packing, cached halo and lifecycle. Replacement risks parity rows 13–18. | Yes |
| Let the page own the responsive stats band and scene reservation | Scene-width breakpoint; page-measured band | Prototype uses page-width 1100px media query; scene canvas is narrower than page by rail/gutters. One observed page band supplies `reservedTop` to scene. | Yes |
| Render Start new in prototype Resume last slot | Wire Resume last to `chooseCurrentTab()`; retain Start new | Binding D7 preserves parity row 32 and avoids switching away from a running marked session. The approved screenshot label is intentionally changed. | Yes |
| Use local Lucide imports; no app registry edit | Global icon provider; per-component named imports | Existing command-center and canvas components import `LucideAngularModule` and icon values directly; no registry found. | Yes |
| Keep root page as composition root; split extraction and wiring sequentially | New page/router layer; inline growth; external template/style | Existing page owns signals/actions and is already 690 lines; extraction reduces file size without changing route or state owner. A2a is mechanical, A2b changes behavior after its green gate. | Yes |
| Apply D9 to the approved design without losing child parity | Keep D3 child navigation; remove only its action/copy | D9 supersedes D3 and expressly keeps child sphere, plate, tether, rail row and selected-card fields display-only; D4 context/plate/tether fixes still apply. | Yes |
| No outside-library or theme-token edits | Modify Tailwind/Chat APIs; use public existing contracts | Theme tokens and existing root-session APIs already exist; all planned changes are presentation or page-local composition. | Yes |

## Clarifications Needed

None. User approval and D1-D9 settle scope, child display behavior, Start new slot and review fixes.
