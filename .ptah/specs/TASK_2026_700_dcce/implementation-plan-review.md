# Implementation plan review (Gate 2) - TASK_2026_700_dcce

Verdict: **REVISE** (0 Blocking, 3 Serious, 4 Moderate, 7 Minor)

Scope: `implementation-plan.md` (all 164 lines), `decisions.md` D1-D6, `design-spec.md`, `design-spec-review-r2.md`,
`parity-inventory.md`, `prototype/command-center.html`, and the code under `libs/frontend/command-center/src/lib/`
plus the chat, chat-state and core files cited below. I read files only. I ran no nx, jest or build.

## 1. Codebase evidence table check

| Plan claim | Result | Evidence |
| --- | --- | --- |
| Page computes `contextWarning` at `>=70` from `sessionContextCue` | Correct | `command-center-page.component.ts:500-507`; the threshold is in the page, not in `session-stats-view.ts:39-57` |
| `CommandWorkNode` shape, optional `tabId` | Correct | `command-center.store.ts:26-38` |
| Live child has `tabId`, persisted child has none | Correct | `work-projection.ts:132-150` |
| Coordinator already switches root tabs | Correct | `session-coordinator.ts:162,188,196,241,255` |
| `switchTab()` "silently" returns when the tab is absent | Mostly correct: it returns, but it logs `console.warn` | `tab-manager.service.ts:1668-1676` |
| The focus flow "sets chat view then switches a tab" | **Incomplete**: it sets chat view, sets `grid` layout and calls `requestCanvasFocus`. It calls `switchTab` only on the `cap-reached` fallback. See S1. | `notification-focus-coordinator.service.ts:43-57` |
| `AppStateManager` is a public `@ptah-extension/core` export | Correct; the controller already uses it | `core/src/lib/services/index.ts:7`; `command-center-page.controller.ts:15,58` |
| `ContextRingComponent` has a `tone` input | Correct; it is already wired. The page passes `rootContextTone` (`command-center-page.component.ts:319`) and the overlay forwards it (`command-overlay.component.ts:106,190`). The overlay has no orange CSS. M1 needs verification only. | `context-ring.component.ts:59,68-72` |
| No app icon registry; Lucide imports are per component | Correct | `command-node-detail.component.ts:18,56`; `orchestra-canvas.component.ts:16` |
| Scene lifecycle: ResizeObserver, MutationObserver, media query, DPR cap 2, cached backdrop | Correct | `command-scene.component.ts:155-156,212,331,346,357`; `command-scene-renderer.ts:68-69,182-185` |
| Start component has `activityBars`, `knownSubtotalOf`, `livePhase`, `hasTranscript` | Correct | `command-center-start.component.ts:145,209-216,249,289-290` |

Module boundaries: there is no problem. `command-center` is `scope:webview, type:feature` (`command-center/project.json`). It already imports `core` (`type:core`), `chat-state` (`type:data-access`) and `chat` (`type:feature`) (`session-coordinator.ts:2-10`). A child route adds no new dependency direction.

`--maxWorkers=2` through `npx nx test command-center` is fine: the `@nx/jest:jest` executor schema has a `maxWorkers` option (`node_modules/@nx/jest/dist/src/executors/jest/schema.json:102`). Every command is scoped to one project, uses `--parallel=1` and runs in sequence. The commands are memory-safe.

## 2. Findings

### Blocking

None.

### Serious

**S1. Open tab ignores the default grid layout, so the child tab may not be focused.**
- What the plan says: `openChildTab` calls `setCurrentView('chat')` and then `switchTab(tabId)`.
- Why that is not enough: the default layout is `grid` (`app-state.service.ts:403`). In grid layout, every existing open or focus path goes through the canvas:
  - `session-open-bridge.service.ts:42-45`
  - `session-row-actions.service.ts:56-66`
  - `notification-focus-coordinator.service.ts:43-50`
- `CanvasStore` reads `activeTabId` only as a fallback when a workspace loads (`canvas.store.ts:496-499`). So `switchTab` alone does not focus a tile in an open grid. In grid mode the button can land on the chat canvas without bringing the child forward.
- Fix:
  - Delegate to the existing router `NOTIFICATION_FOCUS_ROUTER`. It is exported at `core/src/index.ts:45` and provided by both shells (`app-shell.component.ts:135-138`, `electron-shell.component.ts:86`). Call `focus({ workspacePath, tabId, sessionId: tab.claudeSessionId })`. That call already chains requests, switches the view and handles both grid and single layouts, including `cap-reached`.
  - Make `openChildTab` `async` and return `Promise<boolean>`.
  - Inject the router with `{ optional: true }`.
  - Keep the plan's pre-checks: the node is still a child, the workspace matches, and the tab still exists.
  - On `success: false`, show the fixed toast.
  - Test grid mode, single mode and a router failure in `session-coordinator.spec.ts`.
  - Correct evidence row 18.

**S2. D2 bases the stats-band breakpoint on the wrong width.**
- What the plan says: D2 has `CommandSceneComponent` choose a 72, 144 or 154px band "from its observed viewport" at the 1100px breakpoint.
- Why that is wrong: the prototype's breakpoints are page-width media queries (`@media(max-width:1100px)` in `prototype/command-center.html`). The scene observes its own canvas (`command-scene.component.ts:331`). At a 1440px window the stage is about 1044px wide (1440 - 2x22 gutters - 336 rail - 16 gap). The scene would therefore pick the 144px band while A2's CSS draws a 72px band, and the scene would lose about 72px at every width from 1100 to about 1500. The band's breakpoints would also be defined twice: in the D2 TypeScript and in the A2 CSS.
- Fix: the band is owned by A2's template.
  - Give `CommandSceneComponent` a `reservedTop = input<number>(…)` input with a sensible default for D2's tests.
  - A2 supplies that value from the band element's measured height (one ResizeObserver on the band, released on destroy) or from the page container width.
  - Make D2's tests take `reservedTop` as an input instead of a width table.

**S3. "Resume last" is a new capability with unsafe behaviour.**
- What the prototype shows: one session button whose label toggles (`$('sessionBtn').textContent=s==='idle'?'Start new':'Resume last'`, in `prototype/command-center.html`).
- What exists today: the dock has only Start new and Status (`command-session-controls.component.ts:58,81-83`). Parity row 32 "reopen" means reopening for Status (`parity-inventory.md` row 32). `design-spec.md` "Proposed additions" and review r2 list exactly one addition, Open tab.
- What the plan adds: a working `resumeLast` output routed to `chooseCurrentTab()`.
- Why that is unsafe: `currentTabId` is set only in `openStart` (`session-coordinator.ts:62,77`). Inside a session chosen from the recent list, or after Start new, `chooseCurrentTab()` (`227-245`) switches the page to a different recorded tab. That abandons the marked session, possibly while a turn is running.
- Fix: drop `resumeLast` and keep the existing Start new action in that cell. If the user wants Resume last, raise it with the orchestrator as a second proposed addition, with defined semantics: shown only when `currentTabId() !== store.markedTabId()`, disabled while a turn can be aborted or while `choosing()`.

### Moderate

**M1. The `openChildTab` failure path and its guards are under-specified.**
- The coordinator's `fail()` sets `sessionStatus` to `'error'` (`session-coordinator.ts:377-380`). A stale child tab must not mark the root session as failed. Call `store.setToast({ message, tone: 'error' })` directly, and assert that the root status is unchanged.
- `setCurrentView` returns without doing anything when `!canSwitchViews()` (`app-state.service.ts:725,1003`), so the planned `true` result can be false. Check `canSwitchViews()` first. This is moot if S1's router is used.
- Follow the controller's DI precedent (`controller.ts:58`, optional inject). Provide a mock in `session-coordinator.spec.ts`; its providers at `:80-88` have none today.

**M2. The child-sphere grammar is incomplete in D2.**
- `design-spec.md:65` and review r2 check (d) require:
  - a second thin silver ring on a live child;
  - a dimmed sphere, a dashed silver ring and a "CS" monogram for a persisted child.
- Today the renderer has only the silver palette (`command-scene.component.ts:76`) and no child ring. The plan lists only the tether and the orbit.
- Fix: add both ring treatments to D2's scope and to `command-scene-renderer.spec.ts`.

**M3. A2 does not fit one 40-call lane.**
- A2 includes:
  - extracting about 400 template lines from a 691-line page;
  - wiring the header, dock, rail and Open tab;
  - four breakpoints;
  - updating a 1004-line DOM-coupled `command-center-page.component.spec.ts`;
  - plus S2's band input.
- Fix: split it in two:
  - A2a: a mechanical move to `.html`/`.css` with no markup change, and the existing specs green.
  - A2b: wiring and layout.
- D2 (690-line renderer, a new helper and three specs) is borderline. Keep it, but do not add work to it beyond M2.

**M4. Integration-spec DOM contracts are not listed for batches B and C2.**
- Four integration specs depend on page DOM. The plan names two, and only for A2:
  - `ptah-command-voice-hud button` (`accessibility-list.spec.ts:17,38`)
  - `label[for="command-text"]` and `ptah-command-session-controls form` (`:85,92`)
  - `[aria-label="Selected work"]` (`:146`)
  - `#pending-title` and `#pending-answer` (`:186-189`)
  - row text and button text in `failure-and-fallback.spec.ts:134,221`
  - plus `delegation-and-status.spec.ts` and `tribunal-confirm-gate.spec.ts`
- B moves the voice HUD and controls into the dock, and C2 restyles the pending card.
- Fix: list these selectors as contracts that B, C2 and A2 must preserve, and keep all six integration specs unmodified gates.

### Minor

- m1. Evidence row 17: `switchTab` warns rather than staying silent (`tab-manager.service.ts:1670-1672`). The conclusion still holds.
- m2. "Remove 'Live tab available'": that string exists only in the prototype; no source contains it. Rephrase as "do not add".
- m3. The overlay's pinned card (`role="region"`, `command-overlay.component.ts:150-165`) also renders the detail. Excluding the button there follows D3's wording ("selected card"). Record this as a decision so the reviewer does not reopen it.
- m4. The alpha guard scans only `.ts` and `.html` (`no-alpha-base-content.spec.ts:102-115`). The new `command-center-page.component.css` is not covered. Forbid `@apply text-base-content/NN` and alpha text colours in it.
- m5. Theme toggle: the controller already owns an optional `ThemeService` (`controller.ts:57,193`), yet the plan freezes the controller and has the page inject `ThemeService` again. Either add `toggleTheme()` to the controller (unfreeze it in A2) or inject `{ optional: true }` in the page.
- m6. Parity row 9 ("six age bars"): the removal is justified by D1 and the approved spec. Write `remove-proposed, approved D1` against that sub-element rather than calling the whole row `keep`.
- m7. "Nested child spheres remain on their parent/root hierarchy" (D1) is unclear for grandchild children. Say that a grandchild child sphere orbits its parent child, or that it stays on the root orbit. The spec does not show one.

## 3. Batches, parity, data and design coverage

- **File-disjoint:** yes. No file appears in two batches (table at plan lines 30-39). Each spec belongs to the batch that owns its source file.
- **Order:** C → D → B → A2 works. `allowOpenTab` defaults to false, `sceneRect` is optional and D3 needs only D1's `labelRect`, so nothing before A2 depends on A2. With S2, A2 also supplies `reservedTop`, and D2's default keeps D2 green.
- **Tests:** the named existing specs exist. New specs (`command-dock`, `command-center-header`) have sensible names.
- **Parity:** all 39 rows are assigned (plan lines 98-138; the numbering matches the order of `parity-inventory.md`). None was removed silently; row 9 is explained.
- **Data honesty:** every value has a real source:
  - stats: `command-center-page.component.ts:453-496`
  - recent cards: `ChatSessionSummary`
  - unknown cells are omitted (review r2 m3)
  - the only invented action is S3.
- **Design and decision coverage:** covered, apart from S2, M2 and S3. The covered items are:
  - stats band and scene rect clamp (D1/D2)
  - rail scroller that fills the height (C2/A2)
  - dock rows at 900, 720 and 480 (B)
  - start view without age bars (A1)
  - one context value (header and plate from the page `contextCue`)
  - D4 M3 and M4: plate below the radius plus 8px, tether, `GitBranch` glyph on plate and row
  - reduced motion, light theme, and the alpha guard.

## 4. Lane-introduced constraints

These rules are in the plan but are neither user requests nor project rules:

1. "Degradation audit stays 294". The number has no source: it is not in `tools/degradation-audit`. Cite `baseline.json` and a command, or drop it.
2. "Use Logger, never console". No Logger is used anywhere in `command-center` today.
3. "Lucide and GSAP are allowed". Nothing needs GSAP, and the line invites a new dependency.
4. The page template and styles must move to external files. This is reasonable (`chat-view.component.ts:227` is precedent) but is the lane's own choice.
5. The integration specs must stay unmodified. See M4: useful, but it must be stated for every batch.
6. The "Resume last" semantics (S3).
7. The 70px child orbit, the 8px and 12px plate gaps, and `sceneRect.y + 6` come from the spec. They are not lane-introduced.
