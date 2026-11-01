# Implementation Plan - TASK_2026_motion_presets

Child-route and tab-panel motion for Marketplace, Settings and Thoth, plus Settings presets the user can switch without a restart (Electron first).

## Inputs and constraints

- Requirements used: the spawner's brief (user requests 1 to 3, plus the "verified facts" list). `context.md` and `task-description.md` do not exist in this folder; the brief is the only requirements source.
- Code read: the uncommitted motion fixes on `fix/surface-session-motion` (`git diff` of the 14 modified files), `apps/ptah-electron/src/config/motion-preference.ts`, and `.ptah/specs/TASK_2026_motion_preference/implementation-report.md`, whose sections all say "Pending".
- Corrections applied (round 1):
  - `user-decisions.md` (same folder) closes the open questions:
    - default preset `rise`;
    - plain whole-window crossfade at top level for every preset;
    - glass panels get a transform-only entrance and a cut exit;
    - the provider setup wizard steps and the chat session tabs are in scope;
    - no "None" preset.
  - `implementation-plan-review.md` (codex, REVISE): findings 1 and 4-8 are applied below. Findings 2 and 3 are closed by user decisions 2 and 3, recorded as User-accepted.
- Design handoff used: none. The preset values below are this plan's design. They come from the existing tokens and keyframes, not from a designer.
- Missing decision-critical input: none. The user's answers in `user-decisions.md` settle every product choice.
- Hard constraints from `CLAUDE.md`:
  - Electron first.
  - Verify only with `npm run verify -- -p ...`.
  - Never run build, serve or e2e.
  - Keep the VS Code host compiling. This plan adds no VS Code-only work.
- The other lane (Motion preference: always / system / reduce, applied as a Chromium switch at restart) owns:
  - `theme-toggle.component.ts` (the Motion fieldset);
  - `settings-rpc.handlers.ts`, `rpc.types.ts` and `motion-preference.ts`;
  - `apps/ptah-electron/src/main.ts`.

  This plan integrates with that work and does not redesign it.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Motion tokens: `--ptah-ease-soft`, `--ptah-ease-gentle-in`, `--ptah-motion-out` 120ms, `--ptah-motion-in` 200ms, `--ptah-motion-switch` 260ms, `--ptah-stagger-step` 28ms | `apps/ptah-extension-webview/src/styles.css:41-46` | Presets reuse these. No new duration tokens. |
| A top-level surface change is a root-only View Transition. The new root fades in with `ptahPageIn` over `--ptah-motion-switch`. No element inside the window is named. | `styles.css:785-823` (uncommitted) | Root snapshots carry the glass correctly. Presets may only change how the root snapshots are composited, and the chrome must not move. |
| The global `prefers-reduced-motion: reduce` block sets `animation: none` on every VT pseudo and `animation-duration: 0.01ms !important` on everything | `styles.css:830-844` | The Motion preference `reduce` (Chromium `force-prefers-reduced-motion`, `motion-preference.ts` `motionSwitch`) already beats any preset through this block. Presets must never use `!important`. |
| `shouldAnimateSurfaceChange` animates only when the first segment changes. Same-surface navigations get `ptah-vt-none` (no snapshots). | `libs/frontend/core/src/lib/routing/surface-view-transitions.ts:14-24, 104-126` | Child routes need a mechanism that is not the View Transition. Keep this predicate. |
| The tracker adds classes before capture. The comment warns that the new state is captured before any `then()` runs. | `surface-view-transitions.ts:65-68` | A direction attribute for the root VT must be written inside `onViewTransitionCreated`, synchronously, next to `ptah-vt-active`. |
| `SURFACE_ROUTE_IDS` is the ordered surface list | `libs/shared/src/lib/types/webview-surface.types.ts:66-78` | No longer used: top-level surface changes have no direction (`user-decisions.md` item 2). Kept here as evidence only. |
| Blurring glass is only on `[data-glass-surface=chrome|bar|overlay]`, `.modal-box` and `.dropdown-content`, and the blur sits on `::after`. `content`, `tile` and `plate` have no blur. | `styles.css:2896-2930, 2943-2964` | Fading a panel is safe unless it contains a chrome, bar or overlay pane, or a Tailwind `backdrop-blur-*`. |
| `backdrop-filter` stays on `::after` because a filter on the surface turns it into the containing block for fixed popovers | `styles.css:2888-2895` | A `transform` on a panel causes the same containing-block effect for as long as the animation runs. This is a transient risk (see Risks). |
| The configuration surface host that holds Marketplace, Settings and Thoth is itself `data-glass-surface="chrome"` | `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:~442` (diff hunk) | That pane blurs on its own `::after`. A child panel's opacity does not affect it, so only nested blur panes inside a panel matter. |
| Session-tab crossfade: the leaving transcript is `position:absolute; inset:0; z-index:1; pointer-events:none` and fades for 160ms. The enter is `ptahPaneSwitchEnter`: 12px rise plus fade, 260ms. | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css:1-41`; `chat-transcript.component.ts` host bindings (diff) | This is the repository's proven overlap pattern. Generalise it. |
| `animate.enter` / `animate.leave` with static global-ish class strings are the established pattern | `chat-view.component.html:99-100, 146-147, 162-163`; `chat-transcript.component.html:195-196, 214-215`; `canvas-rail-board.component.ts:229` | Reuse native `animate.*`. Do not add `@angular/animations` (it is absent from `package.json`). |
| Angular is 22.2.3 (installed) / `~22.2.0` | `node_modules/@angular/core/package.json`; `package.json:98` | The semantics below are read from this exact runtime. |
| Leave runtime: `animateLeaveClassRunner` adds the classes. On the next rAF it calls `determineLongestAnimation(el)`, which reads `el.getAnimations()` (the element's own animations only). With no animation it removes the element at once; otherwise it removes it on `animationend` / `transitionend`, or on a fallback timer of `duration + 50ms`. | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:14528-14571, 4032-4036` | Animate the panel element itself. A panel whose leave class resolves to `animation: none` is removed immediately, which gives a CSS-only "no leave" switch. |
| A detach (`applyNode` action 2) keeps the node in the DOM until `runLeaveAnimationsWithCallback` completes, then calls `nativeRemoveNode` | `_debug_node-chunk.mjs:4852-4863, 4602-4622` | The old panel and the new panel coexist. New views go in before the container anchor, so the DOM order is `[old][new]`, and the leaving one must be positioned absolutely to avoid a layout jump. |
| `areAnimationSupported` is false when `document.documentElement.getAnimations` is missing (jsdom), and TestBed disables animations by default | `_debug_node-chunk.mjs:4073-4077`; Angular guide (Testing) | Jest cannot observe `animate.*`. Unit tests assert structure and attributes, and the motion itself is verified live in Electron. |
| Leave animations run only for elements in the same template. A child component template's leave does not run when its parent is removed. | angular.dev/guide/animations ("Nested elements") | Put the panel wrapper (with `animate.leave`) in the template that owns the `@switch` or `@if`, or on the routed component's host via `host` metadata. |
| Appearance choices persist through `vscode.setState(key)` plus a `localStorage` hint, and an effect writes `data-*` on `<html>` | `libs/frontend/core/src/lib/services/theme.service.ts:72-76, 257-284, 361-372` (scene); `apps/ptah-extension-webview/src/index.html:129-143` (pre-paint mirror); `apps/ptah-extension-webview/src/app/theme-pre-paint-parity.spec.ts` | Store the motion style exactly the way the scene is stored. |
| `ptah-native-tab-group` renders `role="tabpanel"` with `<ng-content/>` and knows the tab order (`tabs()` and the `activeId` model) | `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:113-122, 136-142` | Tab groups can own the stage and the direction for every consumer. |
| Lib tags: `ui` is `type:ui`. `marketplace`, `chat`, `chat-ui` and `thoth-shell` are `type:feature`. `core` is `type:core`. | each `project.json` | A shared directive in `@ptah-extension/ui` can be imported by every consumer. |
| Marketplace page order is the `MarketplaceRoute` union (overview, connectors, servers+source, skills+source). The shell updates `_route` on `NavigationEnd`. | `libs/frontend/core/src/lib/marketplace/marketplace-route.ts:36-40`; `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts:168-202` | Page order gives the direction index. Because `route()` updates on `NavigationEnd`, which is too late, the index is derived from the pending target URL instead (component 3b). |
| Thoth tab order is `THOTH_TAB_IDS` | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:46` | The direction index for Thoth tabs. |
| Settings tab order: `claude-auth`, `orchestration`, `pro-features`, `tools` | `libs/frontend/chat/src/lib/settings/settings.component.ts:200-207` | The direction index for Settings tabs. |
| `.settings-page` is the scroll owner (`h-full overflow-y-auto`) and its child `space-y-8` div holds the header and the tab `@if`s | `libs/frontend/chat/src/lib/settings/settings.component.html:17-20, 108-241` | The stage must be a non-scrolling wrapper inside the scroller (see the Stage contract). |
| The Marketplace `<main>` is the scroll owner, and `<router-outlet />` is its direct child | `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.html:100-106` | Wrap the outlet in a stage div inside `<main>`. |

External sources:
- Backdrop Root, Filter Effects Level 2 §3 ([drafts.csswg.org/filter-effects-2](https://drafts.csswg.org/filter-effects-2/)).
  - These form a Backdrop Root: the root element; `filter`; `opacity < 1`; `mask`, `mask-image`, `mask-border` or `clip-path`; `backdrop-filter`; `mix-blend-mode` other than `normal`; and `will-change` naming any of these.
  - The spec states that a Backdrop Root is **not** formed by elements with transforms applied, by z-index, or by fixed or sticky positioning. **Verified.**
  - `view-transition-name` is **not** in the spec list.
  - The Chromium-authored WPT `css/css-view-transitions/view-transition-name-is-backdrop-filter-root.html` (author vmpstr@chromium.org) asserts that a non-`none` `view-transition-name` behaves as a backdrop root ([searchfox](https://searchfox.org/mozilla-central/source/testing/web-platform/tests/css/css-view-transitions/view-transition-name-is-backdrop-filter-root.html)).
  - So the brief's claim is accurate for Chromium/Electron, with the caveat that it comes from that test, not from the Filter Effects text.
- Angular `animate.enter` / `animate.leave` ([angular.dev/guide/animations](https://angular.dev/guide/animations)):
  - Both are compiler-supported on elements and as host bindings.
  - The element is removed after the longest animation.
  - Function bindings must call `animationComplete()` (the default timeout is 4s, `MAX_ANIMATION_TIMEOUT`).
  - Child-component leave animations do not run before a parent is removed.
  - TestBed disables animations (`animationsEnabled: true` re-enables them).
  - Route transitions are not covered.

## Inventory

Mechanism keys:
- **R**: router outlet.
- **S**: signal `@switch` or `@if`.
- **N**: inside `ptah-native-tab-group`.

Glass column: **blur** means a chrome, bar or overlay pane or `backdrop-blur` inside the panel. **fill** means only content, tile or plate (no blur). **none** means neither. Hooks are defined in Component specifications.

### Top level (for completeness; handled by the root VT)

| Row | Route / switch | file:line | Mech | Glass | Hook |
| --- | --- | --- | --- | --- | --- |
| T1 | every top-level surface change (chat, setup-wizard, settings, analytics, harness-builder, setup-hub, thoth, marketplace, tasks, apps, command-center) | `apps/ptah-extension-webview/src/app/app.routes.ts:90-222`; outlets `electron-shell.component.ts:417` and `app-shell.component.html:85` | R + root VT | whole window | No change. Every preset uses the existing plain whole-window crossfade (**User-accepted**, `user-decisions.md` item 2). |
| C1 | chat session tab switch | `chat-view.component.ts` `wireSessionEntrance` (uncommitted); `chat-transcript.component.css:1-41` | signal (tab id) | transcript content | Component 8 (the selected preset; in scope per `user-decisions.md` item 4) |

### Marketplace (`libs/frontend/marketplace`)

| Row | Route / switch | file:line | Mech | Glass | Hook |
| --- | --- | --- | --- | --- | --- |
| M1 | outlet for pages | `shell/marketplace-shell.component.html:105` inside `<main>` :100-104 | R | n/a (stage) | Wrap the outlet in `<div ptahMotionRouteStage [motionRouteKey]="pageMotionKey">` inside `<main>`. The direction is derived before activation (component 3b). |
| M2 | `overview` → OverviewPageComponent | `routes/marketplace.routes.ts:125-130` | R | blur when an inspector is docked (`ui/docked-inspector.component.ts:39` chrome) | host `animate.enter/leave` (routed host) |
| M3 | `connectors` → ConnectorsPageComponent | `marketplace.routes.ts:131-136` | R | blur when docked; `native-drawer.component.ts:74` `backdrop-blur-[2px]` when the drawer is open | routed host |
| M4 | `servers/smithery`, `/registry`, `/custom-url` → ServerSourceHostComponent | `marketplace.routes.ts:140-142` (factory :103-109) | R (separate route configs, so not reused) | none found | routed host |
| M5 | `servers` → InstalledServersPageComponent | `marketplace.routes.ts:143-148` | R | fill (`installed-servers-page.component.ts:256` content) + blur when docked | routed host |
| M6 | `skills/ptah-plugins`, `/community`, `/marketplaces` → SkillSourceHostComponent | `marketplace.routes.ts:154-156` (factory :111-117) | R | none found | routed host |
| M7 | `skills` → InstalledSkillsPageComponent | `marketplace.routes.ts:157-162` | R | blur when docked | routed host |
| M8a | `overview/:serverRef` docked | `marketplace.routes.ts:86-100` (`listWithDetail`: list component plus children `''` and `:param` → detail; the same route config for every param value, so A→B **reuses** the detail component); outlet `pages/servers/provider-list-view.component.html:137` inside `ptah-docked-inspector` | R (nested) | the inspector is chrome; the detail has none | **Local stage** wrapping the outlet: `<div ptahMotionRouteStage [motionRouteKey]="detailMotionKey">`. It handles list→detail enter (new host), detail→list leave (host leave, or the A1 fallback) and A→B replay. Key: `detailRef()` (`provider-list-view.component.ts:357`). |
| M8b | `overview/:serverRef` drawer | `provider-list-view.component.html:147` inside `ptah-native-drawer`; the drawer body is `overflow-y-auto` at `ui/src/lib/native/drawer/native-drawer.component.ts:110-115`, the header at :91-108 | R (nested) | the drawer backdrop is `backdrop-blur` (:74); the detail has none | The same local stage directly around `<router-outlet />`, inside the drawer body. The stage is the containing block, so the absolute leave stays inside the body and **cannot cover the drawer header**. |
| M9a | `connectors/:connectorId` full page | `pages/connectors/connectors-page.component.html:16` (inside the `fullPageDetail()` branch, `connectors-page.component.ts:238-239`) | R (nested) | none | Local stage around the outlet, keyed by `detailId()` (`connectors-page.component.ts:236`). List→full page swaps the whole `@if` branch: the page host is the list component, so that swap is a branch change. The `@if`/`@else` branches at :1 and :18 get panel wrappers (leave/enter), and the detail stage replays on A→B. |
| M9b | `connectors/:connectorId` drawer | `connectors-page.component.html:298` (inside `@if (detailOpen())` in `ptah-native-drawer`, :287-300) | R (nested) | drawer backdrop blur | Local stage around the outlet, keyed by `detailId()` |
| M10a/b | `servers/:serverRef` docked / drawer | the same `provider-list-view` outlets :137 / :147 (wrapped by `installed-servers-page.component.ts:250`) | R (nested) | as M8 | Covered by the M8a/M8b stages (one template) |
| M11a | `skills/:skillRef` docked | `pages/skills/installed-skills-page.component.ts:397` | R (nested) | inspector chrome | Local stage keyed by `openRef()` (:503) |
| M11b | `skills/:skillRef` drawer | `installed-skills-page.component.ts:413` (after the `drawer-header` `<h2>` at :406-412) | R (nested) | drawer backdrop blur | Local stage around the outlet only, not around the `<h2 drawer-header>`. Keyed by `openRef()`. |
| M12 | redirects `''` → restore, `**` → overview | `marketplace.routes.ts:124, 165` | — | — | none (no view) |
| M13 | server detail tabs (`targets` / `config` / overview `@default`) | `pages/servers/server-detail.component.html:249` (`@switch (activeTab())`), group :242-247; signal `server-detail.component.ts:183` | N + S | none | Panel wrapper per `@case`; the tab group owns stage and direction |
| M14 | server source band | `pages/servers/server-source-host.component.ts:119-135` `@switch (band().surface)` | S (route-driven `source` input :144) | none | none needed: the host is re-created per route (M4), so the routed-host enter already covers it |
| M15 | skill source panel | `pages/skills/skill-source-host.component.ts:119-135` `@switch (source())` | S (route data) | none | none needed (M6 covers it) |
| M16 | detail placement docked vs drawer | `provider-list-view.component.html:130-149`; `installed-skills-page.component.ts:391-415`; `connectors-page.component.html:1, 287` | S (layout tier) | docked chrome / drawer blur | out of scope: this is a layout change on resize, not a navigation. It stays a cut (see Open questions). |

### Settings (`libs/frontend/chat/src/lib/settings`)

| Row | Route / switch | file:line | Mech | Glass | Hook |
| --- | --- | --- | --- | --- | --- |
| S1 | `settings` route (no children) | `app.routes.ts:114-118` | R top level | — | T1 |
| S2 | top tabs `claude-auth` / `orchestration` / `pro-features` / `tools` | `settings.component.html:108, 213, 224, 235` (`@if` chain); nav :70-102; signal `settings.component.ts:205-207`, `setActiveTab` :291-303 | S | fill: `providers-settings.component.ts:165` tile, `claude-builtins-config.component.ts:80` content; matrix `cli-orchestration-matrix.component.ts:812` (`:host-context` only, unverified as blur); `add-cli-instance-modal.component.ts:93` overlay (modal, only while open) | Wrap the four `@if` blocks in one stage, and each body in a panel wrapper |
| S3 | connection detail drawer tabs (accounts / overview / credentials / models / advanced) | `providers/connection-detail-drawer.component.ts:84-118` `@switch (activeTabId())`, group :81-120; signals :191, :202-203 | N + S | none found | Panel wrapper per `@case`; the tab group owns the stage |
| S4 | voice details drawer `stt` / `tts` | `ptah-ai/voice-details-drawer.component.ts:61, 71` (`@if` / `@else if`), group :58-83; `direction` model :110 | N + S | none found | Panel wrapper around each direction branch (not around the inner provider `@switch` at :62/:72, which is not user-tabbed) |
| S5 | output-style Edit / Preview | `output-style/output-style-instructions-field.component.ts:83` `@if (showPreview())`; group :75-80; `activeTab` computed :129 | S next to N | none found | Stage on the field's panel container, with a panel wrapper per branch. The index is 0 for edit and 1 for preview. |
| W1 | provider setup wizard steps `provider` / `credential` / `verify` / `models` / `scope` | `providers/provider-setup-wizard.component.ts:437` `@switch (step())` (cases at :438, :636, :1018, :1155 and scope); `_step` :1486, `step` :1537; `STEP_ORDER` / `stepIndex()` used by `goForward` / `goBack` :2018-2026; Back button :1367 (`goBack()`), Continue ~:1397 (`goForward()`); `goToStep` :2011-2016 also accepts direct step clicks | S | none found | In scope (`user-decisions.md` item 4). The stage goes on the container of the `@switch`, with `[motionIndex]="stepIndex()"`, so Continue gives forward, Back gives back, and a direct step jump takes its direction from the index difference. Each `@case` body is wrapped. |
| W2 | wizard auth-mode sub-panel `apiKey` / `oauth` / `cli` / `local-native` / `local-proxy` / `custom` | `provider-setup-wizard.component.ts:647-945` (nested `@switch` inside the `credential` step) | S | none found | A user-driven sub-panel switch: a stage with no index (forward only) and one panel wrapper per `@case` |
| S6 | (excluded) load-state switches | `advanced-settings-group.component.ts:98`, `lane-guards-settings.component.ts:66`, `session-budget-settings.component.ts:191`, `credentials-tab.component.ts:125/252` | S | — | Out of scope: these are loading or error state, not user switches. |

### Thoth (`libs/frontend/thoth-shell`)

| Row | Route / switch | file:line | Mech | Glass | Hook |
| --- | --- | --- | --- | --- | --- |
| H1 | `thoth` → `THOTH_ROUTES` `''` → ThothShellComponent | `app.routes.ts:164-172`; `thoth-shell/src/lib/thoth.routes.ts:38-39` | R top level | — | T1 |
| H2 | `thoth/:tab` (component-less, `children: []`, `canMatch thothTabSegment`) plus redirects `''` and `**` | `thoth.routes.ts:41-43` | route that drives a signal (no outlet, `thoth-shell.component.ts:75`) | — | H3 does the work. Same-surface navigation already gets `ptah-vt-none`. |
| H3 | Thoth tab body `memory` / `skills` / `cron` / `gateway` | `thoth-shell.component.ts:223-236` `@switch (activeTab())` inside `<section role="tabpanel" class="flex-1 overflow-y-auto">` :215-221; `activeTab` computed :389-391; order `THOTH_TAB_IDS` :46 | S | none found (`surface-1/3` are fill, `styles.css:389-406`) | Stage on the inner `<div class="w-full px-3 py-6 ...">` (:222, a non-scrolling child of the scroller) and a panel wrapper per `@case` |
| H4 | internal sub-tabs of the four tab libs | none found | — | — | none |

### Shared primitive

| Row | Item | file:line | Hook |
| --- | --- | --- | --- |
| U1 | `ptah-native-tab-group` tabpanel | `libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts:113-122` | The tabpanel div becomes the stage. Its direction comes from the index of `activeTabId()` in `tabs()`. This covers M13, S3 and S4. |

## Mechanism decision

Requirement: every child route and every tab or sub-panel switch animates, with the user-chosen preset, and the glass stays correct.

### (a) View Transitions for child routes

- **Root snapshot**: drop the first-segment check, so every navigation crossfades the whole window.
  - The glass stays correct, because the root is already the Backdrop Root.
  - But only opacity is usable. Translating or scaling the root moves the navbar, rails and dock, which are identical in both snapshots, so a slide preset would shake the chrome.
  - It covers only router navigations: `withViewTransitions` hooks the router (`surface-view-transitions.ts:98`). Settings tabs (S2), every native tab group (M13, S3, S4) and the Thoth `@switch` (H3, whose route has no outlet) are signal-driven, so they still need a second mechanism.
  - Every switch would also block input for the VT duration (`::view-transition { pointer-events: none }`, `styles.css:791-793`) and skip on pointerdown (`surface-view-transitions.ts:43`).
- **Named content element** (`view-transition-name` on the content area): this allows a real slide. But the named element is a backdrop root in Chromium (the WPT above), so a nested chrome pane (the docked inspector, M2/M5/M7) loses its blur for the whole transition and snaps back at the end. That is the exact bug the uncommitted fix removed (`styles.css:785-790`).
- **Cost**: two mechanisms, input blocking, and a slide that is either impossible (root) or glass-breaking (named). **Rejected for child routes.** It stays for top-level surfaces only.

### (b) Native `animate.enter` / `animate.leave` on live DOM

- Animates the real elements, so a backdrop-filter inside a transformed panel keeps sampling the scene. A transform does not form a Backdrop Root (Filter Effects 2 §3).
- Opacity on a panel is a Backdrop Root only for that panel's descendants. The surface host's own blur (`electron-shell` chrome) is outside the panel and is unaffected.
- Overlap, from the runtime read above:
  - The detached old element stays in the DOM until its longest animation ends (`_debug_node-chunk.mjs:4852-4863, 14528-14571`).
  - The new element is inserted after it, so the order is `[old][new]`.
  - The old element must take `position:absolute; inset:0` inside a positioned stage, or the new one renders below it for 120ms. This is the transcript's proven recipe (`chat-transcript.component.css:25-31`).
- One mechanism for both routes and signals:
  - Signal switches put a wrapper with `animate.enter/leave` in the owning template.
  - Routed components put the same classes in their `host` metadata, which angular.dev documents as supported for host bindings.
- **Cost**:
  - A wrapper element per panel, or a host entry per routed page, across about 14 sites.
  - Jest cannot observe the motion (`areAnimationSupported` is false in jsdom), so it needs live Electron verification.
  - **Assumption A1**, leave on a router-created host, is resolved by hard gate G1 (below).

### (c) A shared directive or component that every switcher uses

- A `ptahMotionPanel` directive that carries `animate.enter/leave` as host bindings would remove the repetition. But whether a *directive's* host binding can carry `animate.leave` is not proven by any code in this repository, and the docs only show components and elements.
- A wrapper *component* is worse:
  - Its own template's leave would not run when the parent removes it (the "Nested elements" rule).
  - It adds a host element.
- What genuinely needs sharing is the **stage**: positioning, the direction attribute, and replay on a key change. That has no animation-API dependency.

### Router-host leave: a hard gate, with a concrete fallback (review finding 6)

How router deactivation reaches the leave:
- `RouterOutlet.deactivate()` calls `this.activated.destroy()` and only then emits `deactivateEvents` (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:1516-1522`). The outlet itself never keeps the old view.
- Whether core keeps the host node for a `host`-metadata `animate.leave` is Assumption A1.

**Gate G1** (the first item of the Marketplace batch, before any other page edit):
- **Change**: add the host entry to OverviewPage and ConnectorsPage only.
- **Check in Electron** (Motion = Always, preset `fade`, a non-glass theme): navigate overview→connectors and back. In DevTools, record that:
  - (1) the outgoing host is still in the DOM with `ptah-motion-leave` for about 120ms;
  - (2) it is absolutely positioned over the incoming host;
  - (3) it is removed after the animation.
  - Repeat with a nested detail outlet (list→detail→list).
- **Pass**: keep the host entries for the remaining pages.
- **Fail**: implement the **leave clone** in `ptahMotionRouteStage` (component 3b), and do **not** accept enter-only:
  - The full lifecycle (pending → running → disposed, one clone per stage, replacement, hard time bound, every exit path) is specified in component 3b, "Leave clone lifecycle".
  - In short:
    - the clone is created **paused** on `GuardsCheckEnd`, and only when the target replaces this outlet's component;
    - it is started on the same navigation's `NavigationEnd`, which is emitted synchronously right after `ActivateRoutes` (`_router-chunk.mjs:4019-4029`), so no frame is painted in between;
    - it is always disposed by 1500ms at the latest.
  - **Limits**: the clone is static (canvas, iframe and form state are not copied). That is acceptable for 120ms.
  - **Host entries**: the real host leave stays declared. If it later starts working, the clone path is switched off by a single input (`motionLeaveClone`, default `false`; G1 failure sets it `true` at the Marketplace call sites). The clone is never used together with a working host leave.
- **Signal `@switch`/`@if` panels** do not depend on G1: wrappers in the owning template run the leave on the element itself (`_debug_node-chunk.mjs:14488-14520, 14528-14571`).
- **G1 also checks OnPush/zoneless**: the app is zoneless by default, with a zone fallback (`app.config.ts:185-187`, `useZoneChangeDetectionFallback()`). Run G1 in the default zoneless mode, and confirm that one Thoth tab switch (OnPush) shows the overlap.

### Recommendation: (b) for panels and child routes, plus a small (c) for the stage only, plus (a) unchanged for top-level surfaces

- Panels use the literal `animate.enter="ptah-motion-enter" animate.leave="ptah-motion-leave"` with `class="ptah-motion-panel"`, the same form as `chat-view.component.html:99-100`.
- Routed pages use `host: { class: 'ptah-motion-panel', 'animate.enter': 'ptah-motion-enter', 'animate.leave': 'ptah-motion-leave' }`.
- `ptahMotionStage` (in `@ptah-extension/ui`) is the shared stage for signal switches. It has many uses: Settings tabs, the native tab group, Thoth, the wizard.
- `ptahMotionRouteStage` composes it through `hostDirectives` for router outlets. It drives the stage through the stage's **public imperative methods** (`setIndex`, `replay`, `captureState` / `restoreState`), not through its inputs (component 3). It is needed because direction must be known before activation, reused components must replay, and gate G1 may require the leave clone. It has 7 uses: the shell outlet plus six nested outlets.
- Top-level surfaces keep the root VT unchanged, as a plain crossfade for every preset (User-accepted, `user-decisions.md` item 2).
- Because the classes are global (`styles.css`), view encapsulation does not matter, and each preset is one attribute on `<html>`, so switching is instant.

## Presets

### Identity and storage

- `MotionStyleName = 'fade' | 'rise' | 'slide-left' | 'slide-right' | 'scale' | 'directional'`.
- `MOTION_STYLES` (ordered, for the picker) and `DEFAULT_MOTION_STYLE = 'rise'` live in `theme.service.ts`, next to `SceneName`, `SCENES` and `DEFAULT_SCENE` (:69-71).
  - Why `rise`: it matches the session-tab entrance already shipped (`ptahPaneSwitchEnter`, a 12px rise) and the removed `ptahPageRiseIn`.
- Storage follows the scene exactly (`theme.service.ts:361-372`):
  - state key `ptah-motion-style` via `vscode.setState`;
  - `localStorage` hint `ptah-motion-style`;
  - boot reads state, then the hint, then the default;
  - `setMotionStyle(x)` validates, sets the signal, writes state and the hint;
  - the constructor effect (:257-284) sets `data-motion-style` on `<html>` and removes it for the default.
- The pre-paint script in `index.html` (scene block :137-143) mirrors it, so the attribute is right even before ThemeService is first injected. `theme-pre-paint-parity.spec.ts` covers parity.
- **No RPC**: the preset is renderer-only and instant. The Motion preference needs the RPC only because the main process must read it before `app.ready`.

### CSS contract (in `styles.css`, MOTION section after :823)

All motion values are custom properties. The keyframes read them on the animated element (custom properties in keyframes are substituted with the element's computed values). A preset is therefore only a block of variables, and switching `data-motion-style` restyles the next animation with no restart.

Variables:
- `:root` defaults (= `rise`):
  - `--ptah-motion-enter-x: 0px; --ptah-motion-enter-y: 8px; --ptah-motion-enter-scale: 1; --ptah-motion-enter-opacity: 0`
  - `--ptah-motion-leave-x: 0px; --ptah-motion-leave-y: -4px; --ptah-motion-leave-scale: 1; --ptah-motion-leave-opacity: 0`
  - `--ptah-motion-back-sign: 1` (only `directional` sets it to -1)
- Preset blocks use the selector `[data-motion-style='<id>']`, not `html[...]`, so the picker's preview tiles can carry their own attribute:

| Preset | enter x / y / scale / opacity | leave x / y / scale / opacity | back-sign |
| --- | --- | --- | --- |
| `fade` | 0 / 0 / 1 / 0 | 0 / 0 / 1 / 0 | 1 |
| `rise` (Slide + fade) | 0 / 8px / 1 / 0 | 0 / -4px / 1 / 0 | 1 |
| `slide-left` (content travels left) | 24px / 0 / 1 / 0 | -24px / 0 / 1 / 0 | 1 |
| `slide-right` | -24px / 0 / 1 / 0 | 24px / 0 / 1 / 0 | 1 |
| `scale` | 0 / 0 / 0.97 / 0 | 0 / 0 / 1.02 / 0 | 1 |
| `directional` | 24px / 0 / 1 / 0 | -24px / 0 / 1 / 0 | -1 |

Direction:
- `.ptah-motion-stage { position: relative; --ptah-motion-sign: 1; }`
- `.ptah-motion-stage[data-motion-dir='back'] { --ptah-motion-sign: var(--ptah-motion-back-sign); }`
- The sign resolves on the stage, where both inputs are known, and the nearest stage wins by inheritance, so nested stages work.
- For every preset except `directional`, back-sign is 1, so direction does nothing.

Keyframes:
- `@keyframes ptahMotionEnter`:
  - `from { opacity: var(--ptah-motion-enter-opacity); transform: translate(calc(var(--ptah-motion-enter-x) * var(--ptah-motion-sign, 1)), var(--ptah-motion-enter-y)) scale(var(--ptah-motion-enter-scale)); }`
  - No `to` block: the animation ends on the element's own values.
- `@keyframes ptahMotionLeave`: the mirror image, with a `to` block using the leave variables.

Classes:
- `.ptah-motion-enter { animation: ptahMotionEnter var(--ptah-motion-in) var(--ptah-ease-soft) backwards; }`
  - `backwards`, so no transform remains once Angular removes the class.
- `.ptah-motion-leave`:
  - `position: absolute; inset: 0; z-index: 1; overflow: hidden; pointer-events: none;`
  - `animation: ptahMotionLeave var(--ptah-motion-out) var(--ptah-ease-gentle-in) forwards;`
  - The stage is the positioned ancestor, and the old panel paints over the new one, as in the transcript.
- `.ptah-motion-panel`: a layout-neutral marker used by the glass rule. Panels keep their own display classes.

### Glass behaviour (User-accepted, `user-decisions.md` item 3)

Glass detector:
- `:root[data-glass='on'] .ptah-motion-panel:has(:is([data-glass-surface='chrome'], [data-glass-surface='bar'], [data-glass-surface='overlay'], [class*='backdrop-blur']))`
- `.modal-box` and `.dropdown-content` are left out on purpose:
  - DaisyUI keeps a closed `.dropdown-content` in the DOM (and it is invisible);
  - the theme picker's own dropdown is a top-layer popover (`theme-toggle.component.ts:47-68`), and top-layer content does not inherit ancestor opacity.
  - Including them would downgrade almost every panel.

On a glass-bearing panel, the **user accepted "move without fade"** for the Fade preset (`user-decisions.md` item 3). This plan applies the same rule to every preset on such a panel, because the cause is the same: opacity below 1 on an ancestor of the `::after` blur makes that ancestor the Backdrop Root (`styles.css:2888-2918`; Filter Effects 2 §3).
- **Enter is transform-only**: `--ptah-motion-enter-opacity: 1`.
  - For `fade` and `scale`, which would then barely move, also set `--ptah-motion-enter-y: 6px`.
- **Leave is a cut**: `.ptah-motion-leave` gets `animation: none`. Angular then finds no animation and removes the element at once (`_debug_node-chunk.mjs:14558-14563`).
- **Verification**: the Electron matrix row "glass panel" checks the blur on every frame of the entrance (no snap at the end) for all six presets.

Non-glass themes, and panels with only fill surfaces (content, tile, plate), get the full preset including opacity.

### Top-level surfaces (User-accepted, `user-decisions.md` item 2)

- Every preset uses the existing plain whole-window crossfade: `::view-transition-new(root)` runs `ptahPageIn` (`styles.css:815-823`). This is unchanged.
- Slides, rises and scales apply only inside surfaces (child routes, tabs, wizard steps, session tabs). The navbar and rails never move.
- `surface-view-transitions.ts` is unchanged, so the former component 4 (root VT direction) and its batch are removed.

### Reduced motion

- The Motion preference `reduce` maps to `force-prefers-reduced-motion` (`motion-preference.ts`). `system` with OS reduce maps to the same media result.
- The existing `@media (prefers-reduced-motion: reduce)` block (`styles.css:830-844`) gives `0.01ms` durations and no VT animation, and presets never use `!important`, so `reduce` always wins (`user-decisions.md` item 5).
- Add `.ptah-motion-leave { display: none; }` and `[data-motion-clone] { display: none; }` inside that block, mirroring `chat-transcript.component.css:38-40`.
- Outside the media block (component 1 CSS contract), add `[data-motion-clone='pending'] { animation-play-state: paused; }` for the G1 fallback clone (component 3b, "Leave clone lifecycle").
- `always` maps to `force-prefers-no-reduced-motion`, so presets play even when Windows reduce is on. That is the user's current setup.

## Settings UI

- **Placement**:
  - A new `ptah-motion-style-picker` component, rendered in `theme-toggle.component.ts` directly after the Motion fieldset, inside the same `@if (isElectron)` block (diff hunk at :298-320).
  - It uses the same `fieldset` and `legend` styling. Legend: "Animation style".
  - It goes in its own component because the Motion lane is editing the theme-toggle file and its 6-tile grid is self-contained. The embed is one line plus one import.
- **Control**:
  - A radio group (`input type=radio` with `sr-only peer`, the pattern of the Backdrop picker at `theme-toggle.component.ts:281-296`) in a 3×2 grid of tiles.
  - Each tile has a 48×32 preview frame with `[attr.data-motion-style]="option"` and a small chip inside it, plus a label.
  - Labels: Fade, Rise, Slide left, Slide right, Scale, Direction-aware.
  - There is no "None" option (`user-decisions.md` item 4).
  - Selecting a tile calls `themeService.setMotionStyle(option)`. It applies instantly, with no "Restart" note.
- **Live preview (CSS only)**:
  - The chip gets `ptahMotionEnter` when its tile is hovered, focus-visible, or just checked.
  - "Just checked" is a `previewing` signal cleared on the chip's own `animationend` / `animationcancel`, with a target check. The listener goes through an Angular template event binding, so it is released with the view.
  - When `matchMedia('(prefers-reduced-motion: reduce)')` matches, show a one-line note: "Motion is reduced, so animation styles do not play." Remove the media-query `change` listener through `DestroyRef`.
- **Accessibility**:
  - `fieldset` and `legend` name the group.
  - Each input has `aria-label` set to the preset label.
  - Focus ring: the same `peer-focus-visible:outline` classes as the Backdrop tiles.

## Component specifications

### 1. Motion CSS system

- Purpose: the global preset variables, keyframes, panel, stage, clone and glass rules.
- Responsibilities:
  - everything under "CSS contract", "Glass behaviour" and "Reduced motion" above;
  - the existing VT rules and `ptahPageIn` are unchanged.
- Verified contracts: `styles.css:41-46` (tokens), `:780-844` (VT and reduced motion), `:2896-2964` (glass roles).
- Dependencies: none. It is consumed through class names and attributes.
- Failure behaviour:
  - An unknown `data-motion-style` matches no block, so the `:root` default (rise) applies.
  - A missing stage leaves the sign at 1 and positions the leave against the nearest positioned ancestor. Every adoption site has a stage (verification point).
- Quality:
  - Only `opacity` and `transform` are animated.
  - No infinite animations.
  - `:has()` matches only while the enter or leave class is present.
- Verification seam: new `apps/ptah-extension-webview/src/app/motion-presets.spec.ts` (pattern: `elevation-tokens.spec.ts`), which reads `styles.css` text and asserts:
  - a `[data-motion-style='<id>']` block per `MOTION_STYLES` id;
  - `.ptah-motion-leave` and `[data-motion-clone]` inside the reduced-motion block;
  - the glass `:has` rule sets the enter opacity to 1 and the leave to `animation: none`;
  - no `!important` outside the reduced-motion block;
  - the VT root rules are unchanged (`ptahPageIn` only).
- Files: MODIFY `D:/projects/ptah-extension/.claude-worktrees/surface-session-motion/apps/ptah-extension-webview/src/styles.css`; CREATE `.../apps/ptah-extension-webview/src/app/motion-presets.spec.ts`.

### 2. Motion style state (ThemeService) and the pre-paint mirror

- Purpose: own, persist and apply the preset.
- Responsibilities:
  - `MotionStyleName`, `MOTION_STYLES`, `DEFAULT_MOTION_STYLE = 'rise'` (`user-decisions.md` item 1);
  - the `motionStyle` readonly signal;
  - `setMotionStyle`;
  - the boot read (state, then hint, then default; read-only at boot, like `initializeScene` :361-365);
  - the `data-motion-style` attribute in the constructor effect (removed for the default);
  - core barrel exports;
  - the `index.html` pre-paint block.
- Verified contracts: `theme.service.ts:72-76, 257-284, 361-372`; `index.html:129-143`.
- Dependencies: `VSCodeService` (already injected, :213).
- Failure behaviour:
  - An invalid value is ignored (as `setScene` does).
  - `localStorage` failure falls back silently.
- Verification seam:
  - extend `libs/frontend/core/src/lib/services/theme.service.spec.ts` (the scene tests at :121-157 are the template);
  - extend `apps/ptah-extension-webview/src/app/theme-pre-paint-parity.spec.ts`.
- Files: MODIFY `.../libs/frontend/core/src/lib/services/theme.service.ts`, `.../theme.service.spec.ts`, `.../apps/ptah-extension-webview/src/index.html`, `.../apps/ptah-extension-webview/src/app/theme-pre-paint-parity.spec.ts`. Check the core `index.ts` barrel re-exports the new names; MODIFY it only if the barrel lists names explicitly.

### 3. `ptahMotionStage` directive and the native tab group

- Purpose: the positioned container of a switch. It gives the direction and replays the entrance. It has two entry points: template inputs for signal switches, and public imperative methods for `ptahMotionRouteStage` (review round-1 finding 2).
- Why not inputs only:
  - `InputSignal` is read-only from code: Angular updates it only from a binding (`node_modules/@angular/core/types/core.d.ts:96-106`).
  - `hostDirectives: [MotionStageDirective]` with no `inputs:` mapping gives no binding.
  - So the route stage cannot drive the stage through `motionIndex` / `motionReplayKey`.
  - The stage therefore keeps its state in **plain private fields and writes the DOM itself**. Template inputs and the imperative methods both funnel into the same methods.
- Contract (`libs/frontend/ui/src/lib/motion/motion-stage.directive.ts`, `standalone: true`, selector `[ptahMotionStage]`, `exportAs: 'ptahMotionStage'`):
  ```ts
  export type MotionDirection = 'forward' | 'back';
  export interface MotionStageState { readonly index: number | null; readonly direction: MotionDirection; }

  @Directive({ selector: '[ptahMotionStage]', exportAs: 'ptahMotionStage', host: { class: 'ptah-motion-stage' } })
  export class MotionStageDirective implements OnChanges {
    readonly motionIndex = input<number | null>(null);
    readonly motionReplayKey = input<unknown>(undefined);
    private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
    private readonly renderer = inject(Renderer2);
    private readonly injector = inject(Injector);
    private state: MotionStageState = { index: null, direction: 'forward' };
    ngOnChanges(changes: SimpleChanges): void;  // motionIndex → setIndex; motionReplayKey (not firstChange) → replay
    setIndex(index: number | null): void;       // derive direction from state.index, write data-motion-dir now
    captureState(): MotionStageState;
    restoreState(state: MotionStageState): void; // rewrite the attribute and fields
    replay(): void;                               // see Replay
  }
  ```
  - Every member is a plain method or a readonly field. There are no writes to an `InputSignal`, so strict mode typechecks it as an ordinary class API.
  - **`ngOnChanges` with signal inputs is supported**: the `NgOnChangesFeature` setter records a `SimpleChange` and then applies the value to the input signal node (`_debug_node-chunk.mjs:115-127`). `writeToDirectiveInput` routes signal inputs through `def.setInput` when the feature is present (`:5456-5485`).
- Direction, written with `renderer.setAttribute(host, 'data-motion-dir', …)` at call time, not through a host binding:
  - `forward` when the index grows, `back` when it shrinks;
  - unchanged when it is equal or null;
  - `forward` initially.
  - Writing the attribute immediately makes it independent of change-detection scheduling. That matters for route-driven calls, which happen in a router event, outside a template pass.
- Signal switches: `ngOnChanges` runs in the owning template's update pass, before the `@switch` / `@if` later in that template swaps views. The enter and leave classes are queued until after change detection (`_debug_node-chunk.mjs:14476-14477, 14504`). So the attribute is in place first.
- Replay (round-0 finding 5): `replay()` schedules one `afterNextRender({ write: … }, { injector })` and keeps its `AfterRenderRef`. On run, the target is the first element child that has `ptah-motion-panel`:
  1. Cancel any pending replay: destroy the previous `AfterRenderRef`, then run the cleanup.
  2. Remove `ptah-motion-enter`, force a style flush (`void target.offsetWidth`), add `ptah-motion-enter`.
  3. Listen for `animationend` and `animationcancel` on the target. The handler acts only when `event.target === target` **and** `event.animationName === 'ptahMotionEnter'`.
  4. On the next rAF, if `target.getAnimations()` has no running `CSSAnimation` named `ptahMotionEnter`, clean up at once.
  5. Cleanup removes the class and both listeners, and cancels the rAF and the `AfterRenderRef`. It runs on a matching event, on the no-animation check, on the next replay, and on destroy (`DestroyRef.onDestroy`).
  6. At most one pending replay per stage.
- `NativeTabGroupComponent` (`native-tab-group.component.ts:113-122`):
  - put `ptahMotionStage [motionIndex]="activeIndex()"` on the tabpanel div;
  - `activeIndex` is a new computed: the index of `activeTabId()` in `tabs()`.
- Dependencies: `@angular/core` only. Export through `libs/frontend/ui/src/index.ts`.
- Verification seam: `motion-stage.directive.spec.ts`. A test host template binds `[motionIndex]` and `[motionReplayKey]`, and a second host drives the stage only through `setIndex` and `replay` (it gets the instance via `exportAs` or `viewChild(MotionStageDirective)`). Assertions:
  - forward/back/initial through both paths;
  - `captureState` and `restoreState` round-trip;
  - replay adds the class;
  - **a bubbling child `animationend` (name `ptahMotionEnter`) leaves the class in place, and a following panel `animationend` removes it**;
  - a panel event with another `animationName` is ignored;
  - `animationcancel` from the panel cleans up;
  - `getAnimations` stubbed to `[]` cleans up on the next rAF;
  - two `replay()` calls leave one listener set;
  - destroy cleans up.
  - `tsc` under the lib's strict config (the B2 typecheck) proves the API compiles.

  `native-tab-group` spec: the tabpanel carries `ptah-motion-stage`, and `data-motion-dir` follows tab order.
- Files: CREATE `.../libs/frontend/ui/src/lib/motion/motion-stage.directive.ts`, `.../motion-stage.directive.spec.ts`, `.../libs/frontend/ui/src/lib/motion/index.ts`; MODIFY `.../libs/frontend/ui/src/index.ts`, `.../libs/frontend/ui/src/lib/native/tab-group/native-tab-group.component.ts` and its spec (CREATE if absent).

### 3b. `ptahMotionRouteStage` directive (round-0 findings 1, 6, 8; round-1 findings 1-4)

- Purpose: the stage for a `<router-outlet>`. It derives key and direction from the **pending navigation's target snapshot before activation**, replays the entrance when the router reuses the component, and (only after a G1 failure) owns the leave clone.

#### Router event order (verified in `node_modules/@angular/router/fesm2022/_router-chunk.mjs`)

The order is:
1. `RoutesRecognized` (:3896);
2. `GuardsCheckStart` (:3932);
3. `ChildActivationStart` / `ActivationStart`, emitted *during* `checkGuards` (:2585-2600);
4. **`GuardsCheckEnd(id, url, urlAfterRedirects, state, shouldActivate)`** (:3944-3945), emitted for every navigation that reaches the guard phase;
5. `ResolveStart` / `ResolveEnd` (:3956-3967), **skipped when `canActivateChecks.length === 0`** (:3953-3955);
6. `createViewTransition` (:4012);
7. the internal `BeforeActivateRoutes`, which is not public (:2087-2089);
8. `ActivateRoutes` (:4019);
9. `NavigationEnd`, synchronously in the same `tap` (:4029).

What each event can be used for:
- A guard that returns a `UrlTree` throws a redirect before `GuardsCheckEnd` (:3941-3943). That yields `NavigationCancel` (redirect), and the redirect target runs its own full pipeline.
- `shouldActivate === false` cancels right after `GuardsCheckEnd` (:3949-3951).
- **Chosen pre-activation hook: `GuardsCheckEnd` with `shouldActivate === true`**. It is public, always emitted before activation, and carries `state: RouterStateSnapshot` (class at :1955-1965).
- Everything set on it is **provisional** until the same id's `NavigationEnd`.

#### Contract

```ts
export interface MotionRouteKey { readonly key: string; readonly index: number | null; }
export type MotionRouteKeyFn = (target: RouterStateSnapshot) => MotionRouteKey | null;

@Directive({ selector: '[ptahMotionRouteStage]', hostDirectives: [MotionStageDirective] })
export class MotionRouteStageDirective {
  readonly motionRouteKey = input.required<MotionRouteKeyFn>();
  readonly motionLeaveClone = input(false);
  private readonly stage = inject(MotionStageDirective, { self: true }); // host directive instance, same node
  private readonly router = inject(Router);
  private readonly outlet = contentChild.required(RouterOutlet);
  ...
}
```

- A host directive is instantiated on the same element and is injectable from it, so `inject(MotionStageDirective, { self: true })` returns the instance.
- No inputs are forwarded (no `inputs:` mapping). The route stage is the sole writer, and it writes through `setIndex`, `replay`, `captureState` and `restoreState`.

State:
- `committed: MotionRouteKey | null`, initialised from `router.routerState.snapshot`.
- `pending: { id: number; key: MotionRouteKey; prior: MotionStageState; outletInstance: object | null; replaces: boolean } | null`.

Events, subscribed with `takeUntilDestroyed`:
- **`GuardsCheckEnd` with `shouldActivate`**:
  - Compute `next = motionRouteKey()(event.state)`. Pure; it parses the **target snapshot**, never component signals (round-1 finding 3).
  - If `next` is null, or `next.key === committed?.key`, do nothing.
  - Otherwise:
    1. dispose any previous `pending` and its clone (supersession);
    2. `prior = stage.captureState()`, then `stage.setIndex(next.index)`;
    3. compute `replaces`: the target snapshot node at this outlet's depth has a different `routeConfig` than `outlet.activatedRoute.routeConfig`. The default `shouldReuseRoute` is `future.routeConfig === curr.routeConfig` (:4254-4256), and the app has no custom `RouteReuseStrategy` (`app.routes.ts:47`, `app.config.ts:326`);
    4. if `replaces && motionLeaveClone()`, create the clone (lifecycle below);
    5. store `pending` with `outletInstance = outlet.isActivated ? outlet.component : null`.
- **`NavigationEnd` with `id === pending.id`**:
  - `committed = pending.key`;
  - if `!pending.replaces` and `outlet.isActivated` and `outlet.component === pending.outletInstance` (reuse, `listWithDetail` A→B), call `stage.replay()`;
  - start the clone if one exists;
  - `pending = null`.
- **`NavigationCancel`, `NavigationError` or `NavigationSkipped` with `id === pending.id`**:
  - `stage.restoreState(pending.prior)`, dispose the clone, `pending = null`.
  - A redirect arrives as `NavigationCancel` (redirect code) followed by a new navigation, so the restore happens first and the redirect target then gets its own `GuardsCheckEnd`.
- **Events of other ids**: ignored, except that a new `GuardsCheckEnd` supersedes (step 1). A superseded navigation's later `NavigationCancel` carries the old id, so it is ignored because `pending.id` has already moved on.
- **Destroy**: dispose `pending` and the clone.

#### Key functions (round-1 finding 3)

These are pure functions of the target snapshot, exported from `libs/frontend/ui/src/lib/motion/motion-route-keys.ts`:
- `detailParamKey(listRoute: ActivatedRoute, param: string): MotionRouteKeyFn`:
  - walk `target.root` down the primary chain (`firstChild`) to the node whose `routeConfig === listRoute.routeConfig` (the `listWithDetail` list route, `marketplace.routes.ts:86-100`); if absent, return `null` (this list is being left);
  - otherwise return `{ key: node.firstChild?.paramMap.get(param) ?? '', index: null }`, where `''` is the list state.
  - Snapshot params are already percent-decoded by the router, so `a%2Fb` and `a/b` refs compare equal to the value the page uses.
  - Call sites:
    - `provider-list-view` (`serverRef`; inject its `ActivatedRoute`);
    - `connectors-page` (`connectorId`);
    - `installed-skills-page` (`skillRef`).
  - These replace the round-1 wording that read `detailRef()`, `detailId()` and `openRef()`. Those signals update on `NavigationEnd` (`provider-list-view.component.ts:399, 456-460`; `connectors-page.component.ts:224-229`; `installed-skills-page.component.ts:539-542`), which is too late, so they are not used for keys.
- Shell: `marketplacePageKey(router)`:
  - `marketplaceRouteOfUrl(router, target.url)` (`shell/marketplace-route-url.ts:31-41`, which parses the URL with the router's serializer);
  - key `page[/source]`, index `page order × 10 + (source index + 1)`;
  - `null` outside `/marketplace`.
  - This helper lives in `libs/frontend/marketplace/src/lib/shell/` (it needs the marketplace parser), not in `ui`.

#### Leave clone lifecycle (only when `motionLeaveClone` is true; round-1 finding 4)

- **Cardinality**: at most one clone per stage, ever. Creating a clone first disposes any existing one (**replace, never stack**).
- **Create** (at `GuardsCheckEnd`, when `replaces`):
  1. `cloneNode(true)` of the current `.ptah-motion-panel` child;
  2. set `aria-hidden="true"`, `inert`, `data-motion-clone="pending"`;
  3. append it to the stage and add `ptah-motion-leave`.
  - CSS: `[data-motion-clone='pending'] { animation-play-state: paused; }`. The paused clone sits exactly over the still-live old page with `pointer-events: none`, so it is visually identical and does not block input.
  - Start the **hard cap timer**: `setTimeout(dispose, CLONE_MAX_MS)` with `CLONE_MAX_MS = 1500`. That is far above the leave (120ms) plus a typical guard-to-activation gap. Disposing a pending clone is invisible, because the live page is still under it.
- **Start** (the same id's `NavigationEnd`, synchronously after `ActivateRoutes`, so no frame shows the old page removed without the clone):
  1. set `data-motion-clone="running"`;
  2. on the next rAF, read `clone.getAnimations()`. If no running `ptahMotionLeave` exists (reduced motion, or the glass cut sets `animation: none`), dispose now. Otherwise arm a **completion fallback** `setTimeout(dispose, duration + 50)`, mirroring Angular's own runner (`_debug_node-chunk.mjs:14554-14569`).
- **Dispose** removes the node, both listeners, the rAF, the fallback timer and the cap timer. It is idempotent. Every exit path calls it:
  - `animationend` / `animationcancel` with `target === clone` and `animationName === 'ptahMotionLeave'`;
  - the no-animation rAF check;
  - the completion fallback;
  - the hard cap;
  - a superseding `GuardsCheckEnd`;
  - `NavigationCancel` / `NavigationError` / `NavigationSkipped` for its id;
  - directive destroy.

#### Failure behaviour

- A key function that returns `null` changes nothing.
- An outlet that is not activated never clones.
- A navigation that never reaches `GuardsCheckEnd` (skipped, or redirected before guards) leaves the stage untouched.

#### Verification seam (`motion-route-stage.directive.spec.ts` and `motion-route-keys.spec.ts`, using `RouterTestingHarness`, `listWithDetail`-shaped config with **no resolvers**, so `ResolveEnd` is absent)

- **Event-order proof**: subscribe to `router.events` and record `data-motion-dir` at the first `ActivationEnd` (emitted inside `ActivateRoutes`, `_router-chunk.mjs:2309`). It is already the new direction, and no `ResolveEnd` was emitted.
- list→detail: `forward`, no replay (new component, `replaces` true).
- **detail A→B**:
  - `detailParamKey` returns different keys from the two target snapshots at `GuardsCheckEnd` (asserted inside a `GuardsCheckEnd` subscriber);
  - the same component instance;
  - exactly one `replay()`.
- Encoded params: `/x/a%2Fb` and `/x/a%2Fc` give distinct decoded keys `a/b` and `a/c`.
- **list→detail→list**: the final key is `''`, no replay is pending, and there is no clone.
- A guard that returns `false` restores the captured state. A guard that returns a `UrlTree` restores, and then the redirect target applies its own key.
- With `motionLeaveClone`:
  - (a) one paused clone after `GuardsCheckEnd`, running after `NavigationEnd`, removed on its own `animationend`, and a child's bubbling `animationend` is ignored;
  - (b) **two route changes before the first clone finishes leave exactly one clone** (the second), and the first node is detached;
  - (c) a cancelled navigation removes its clone;
  - (d) with fake timers, a clone whose `animationend` never fires is removed by the completion fallback, and a pending clone whose navigation hangs is removed at `CLONE_MAX_MS`;
  - (e) `getAnimations()` returning `[]` removes the clone on the next rAF;
  - (f) destroying the stage removes the clone and clears all timers (`jest.getTimerCount()` is 0).
- Files: CREATE `.../libs/frontend/ui/src/lib/motion/motion-route-stage.directive.ts`, `.spec.ts`, `.../motion-route-keys.ts`, `.spec.ts`; MODIFY `.../libs/frontend/ui/src/lib/motion/index.ts`; CREATE `.../libs/frontend/marketplace/src/lib/shell/marketplace-motion-key.ts` (+ spec) for `marketplacePageKey`.

### 4. Root View Transition (no change)

Removed by `user-decisions.md` item 2. `surface-view-transitions.ts` and its spec are not touched.

### 5. Marketplace adoption

- Purpose: rows M1-M11 and M13.
- Responsibilities:
  - **G1 gate first** (Mechanism decision). Its result decides `motionLeaveClone` at every route stage below.
  - **Shell**:
    - in `<main>`, `<div ptahMotionRouteStage class="min-h-full" [motionRouteKey]="pageMotionKey">` around `<router-outlet />`;
    - `pageMotionKey = marketplacePageKey(router)` (component 3b, "Key functions"). It parses the **pending target** `RouterStateSnapshot.url` with `marketplaceRouteOfUrl` (`shell/marketplace-route-url.ts:31-41`), so the shell's `route()` signal, which updates on `NavigationEnd` (:188-202), is not involved;
    - key: page plus source;
    - index: `page order × 10 + (source index + 1)`, with page order overview, connectors, servers, skills (`marketplace-route.ts:36-40`) and source order from the core source lists.
  - **Routed pages**: add `class: 'ptah-motion-panel'`, `'animate.enter': 'ptah-motion-enter'` and `'animate.leave': 'ptah-motion-leave'` to the `host` metadata of these components, merged with any existing `host` entries:
    - OverviewPage, ConnectorsPage, ServerSourceHost, InstalledServersPage, SkillSourceHost, InstalledSkillsPage;
    - the details ServerDetail, ConnectorDetail, SkillDetail.
  - **Nested detail stages** (finding 1). Each nested `<router-outlet />` gets its own `ptahMotionRouteStage` wrapper directly around the outlet. That wrapper is the containing block for the absolute leave, so the leave cannot cover a drawer header or the inspector title bar. Its key function is `detailParamKey(inject(ActivatedRoute), '<param>')` (component 3b), held in a component field. It reads the decoded param from the **pending target snapshot** under this list's own route config, with `index: null`. It never reads `detailRef()`, `detailId()` or `openRef()`, which update on `NavigationEnd`. Sites:
    - `provider-list-view.component.html:137` (docked) and `:147` (drawer). This covers overview and installed servers (M8, M10). Param `serverRef`.
    - `connectors-page.component.html:16` (full page) and `:298` (drawer). Param `connectorId`.
    - `installed-skills-page.component.ts:397` (docked) and `:413` (drawer). Param `skillRef`. The `<h2 drawer-header>` at :406-412 stays outside the stage.
  - **Connectors full-page branch swap** (M9a): wrap the `@if (fullPageDetail())` branch (:1-17) and the `@else` list branch (:18-...) each in a panel div, so list↔full-page detail animates as a branch change.
  - **M13**: in `server-detail.component.html:249-...`, wrap each `@case` and `@default` body in `<div class="ptah-motion-panel" animate.enter="ptah-motion-enter" animate.leave="ptah-motion-leave">`. The tab group gives the stage.
  - Drawer and inspector open/close keep their own motion (`native-drawer`). Removing the whole `@if (detailOpen())` block tears down the outlet with its container. Angular does not run leave animations inside child component templates on parent removal (angular.dev "Nested elements"), so detail→list inside a closing drawer is the drawer's own close, not a panel leave.
- Dependencies: components 3 and 3b; component 1 (visual).
- Failure behaviour: a G1 failure switches on the leave clone. Enter-only is not an accepted end state.
- Verification seam:
  - `marketplace-motion-key.spec.ts`: page and source keys and indices from target URLs; `null` outside `/marketplace`.
  - `marketplace-shell.component.spec.ts`: the outlet's parent has `ptah-motion-stage`. Skills→overview gives `data-motion-dir="back"` when read in the first `ActivationEnd` subscriber, which is inside `ActivateRoutes`, after `GuardsCheckEnd`. The assertion does **not** use `ActivationStart`, which is emitted during guards (`_router-chunk.mjs:2585-2600`), before the stage is updated.
  - `provider-list-view` spec (create it if absent), `connectors-page` spec and `installed-skills-page` spec, for each placement (docked, drawer, full page):
    - the outlet's direct parent is a `ptah-motion-stage`, and in the drawer case that parent is inside `[data-testid=native-drawer-body]`;
    - **A→B params**: inside a `GuardsCheckEnd` subscriber, the page's key function returns B's key while the page's `detailRef()` / `detailId()` / `openRef()` still return A; after navigation the same detail instance has had exactly one replay;
    - **list→detail→list** leaves no stage replay pending and no clone.
  - One routed-page spec asserts the host has `ptah-motion-panel`.
  - The server-detail spec asserts each tab body is wrapped.
- Files (MODIFY, under `.../libs/frontend/marketplace/src/lib/`):
  - `shell/marketplace-shell.component.html`, `.ts`, `.spec.ts`; CREATE `shell/marketplace-motion-key.ts` (+ spec);
  - `pages/servers/provider-list-view.component.html`, `.ts` (+ spec);
  - `pages/connectors/connectors-page.component.html`, `.ts` (+ spec);
  - `pages/skills/installed-skills-page.component.ts` (+ spec);
  - the page host files `overview-page`, `connectors-page`, `server-source-host`, `installed-servers-page`, `skill-source-host`, `installed-skills-page`;
  - `server-detail.component.ts` and `.html`, plus the connector detail and skill detail component files.

  Resolve the exact paths with `ptah_search_files` on `libs/frontend/marketplace/src/lib/pages/**`. `ui/docked-inspector.component.ts` is no longer modified, because the stage sits around the outlet in the owning template.

### 6. Settings adoption

- Purpose: rows S2-S5, W1 and W2.
- Responsibilities:
  - **S2**:
    - In `settings.component.html`, wrap lines 105-241 in `<div ptahMotionStage [motionIndex]="settingsTabIndex()">`.
    - Each tab body becomes a panel. Add the `settingsTabIndex` computed (order :200-203; `providers` maps to `claude-auth`, :295).
  - **`@defer` panels** (S2 tabs 1-4; finding 4). The outer wrapper is `class="ptah-motion-panel space-y-8" animate.leave="ptah-motion-leave"` with **no** `animate.enter`. The enter goes on an inner `<div class="ptah-motion-panel" animate.enter="ptah-motion-enter">` placed **inside** the `@defer` main block, around the deferred components (for Providers, the security line stays in the outer wrapper and enters with it, via a second inner wrapper).
    - So on the first visit the `min-h-24` placeholder appears without motion and the real body enters when its chunk resolves. On later visits the body enters once.
    - **First-visit check** (Electron matrix row "first-visit deferred"): with a fresh renderer, open Settings and click each tab once.
    - **Pass**: the real body animates in, and nothing jumps after the animation.
    - **Remedy if the body still pops** (for example, the inner wrapper's enter is skipped because the `@defer` block renders in a later frame than its parent's animation queue flush): replace the inner `animate.enter` with `ptahMotionStage [motionReplayKey]="deferLoaded()"` on the outer wrapper. `deferLoaded` is set from the deferred component's first render via an `(ngAfterViewInit)`-style output, or via an `afterNextRender` in the `@defer` content. The replay (component 3) animates the loaded body.
  - **S3, S4 and S5**: as in round 0. Wrap each `@case` or branch body. S5 has a `ptahMotionStage` with `[motionIndex]="showPreview() ? 1 : 0"`.
  - **W1, the provider setup wizard** (`provider-setup-wizard.component.ts`):
    - put `ptahMotionStage [motionIndex]="stepIndex()"` on the element that contains `@switch (step())` (:437);
    - wrap each step `@case` body (:438, :636, :1018, :1155, scope) in a panel div.
    - `goForward` (Continue) and `goBack` (Back) move `stepIndex` by ±1 (:2018-2026), so Continue is forward and Back is back. Direct jumps through `goToStep` take their direction from the index difference.
    - Focus handling (`#stepHeading`, tabindex -1, :441) is unchanged. The leaving step is `pointer-events: none`, and the entering step's heading receives focus as today.
  - **W2**: a `ptahMotionStage` with no index on the container of the auth-mode `@switch` (:647), and one panel wrapper per case.
- Failure behaviour: as in component 1. The wizard's validation gates (`canVisitStep`, :2003-2009) are unchanged.
- Verification seam:
  - settings spec: the stage exists, the index follows tab order, and each deferred tab has the outer leave wrapper and the inner enter wrapper;
  - drawer specs: each tab body is wrapped;
  - **wizard spec**: Continue sets `data-motion-dir="forward"`, Back sets `back`, a direct jump from step 3 to step 1 sets `back`, and each step body is wrapped.
- Files (MODIFY, under `.../libs/frontend/chat/src/lib/settings/`): `settings.component.html`, `settings.component.ts`, `providers/connection-detail-drawer.component.ts`, `ptah-ai/voice-details-drawer.component.ts`, `output-style/output-style-instructions-field.component.ts`, `providers/provider-setup-wizard.component.ts`, and their specs.

### 7. Thoth adoption

- Purpose: row H3.
- Responsibilities:
  - Put `ptahMotionStage [motionIndex]="activeTabIndex()"` on the inner div at `thoth-shell.component.ts:222`, a child of the scroller.
  - Wrap each `@case` body in a panel div.
  - Add the `activeTabIndex` computed over `THOTH_TAB_IDS` (:46).
  - Thoth tab changes are router navigations (`thoth/:tab`). The index comes from `activeTab()`, which reads the route param signal (:389-391), and the panel swap is a signal `@switch`, so the same-pass binding rule of component 3 applies. No route-stage is needed.
- Verification seam: `thoth-shell.component.spec.ts`. memory→cron gives `forward`, cron→skills gives `back`, and each body is wrapped.
- Files: MODIFY `.../libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`, `.../thoth-shell.component.spec.ts`.

### 8. Session tabs follow the preset (chat transcript)

- Purpose: the session switch uses the selected preset instead of the fixed crossfade (`user-decisions.md` item 4).
- Responsibilities:
  - in `chat-transcript.component.css`, point `.ptah-pane-switch-enter` at the global `ptahMotionEnter` (duration `--ptah-motion-switch`) and `:host(.ptah-pane-switch-leave)` at `ptahMotionLeave` (`--ptah-motion-out`);
  - delete the local `ptahPaneSwitchEnter` and `ptahPaneSwitchLeave`;
  - keep `LEAVE_WINDOW_MS` (200) at or above the leave duration plus margin. With `--ptah-motion-out` at 120ms it needs no change.
  - `directional` on session tabs: the transcript host has no stage index, so the sign is 1 (forward). Tab order is not a navigation order the user reasons about.
  - The glass detector applies, because the transcript host gets `ptah-motion-panel`.
- **No coupling to the later per-message stagger** (user request 3):
  - the preset classes sit only on the transcript host (`:host(.ptah-pane-switch-leave)`) and on its single `.ptah-pane-switch-enter` content root;
  - message rows get no motion classes and no new wrappers;
  - `--ptah-stagger-step` (`styles.css:46`) and the `ENTER_WINDOW_MS` window in `chat-view.component.ts` are not changed;
  - a later stagger can add its own row-level classes (and read the same preset variables if wanted) without touching this work.
- Dependencies: component 1.
- Verification seam: `chat-view.session-enter.spec.ts` still passes, plus a CSS-text assertion that the transcript CSS references `ptahMotionEnter` and `ptahMotionLeave` and no longer defines the old keyframes.
- Files: MODIFY `.../libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.css` (and `chat-view.component.ts` only if a window constant must change).

### 9. Motion style picker

- Purpose: the Settings UI above.
- Contract: `ptah-motion-style-picker` (standalone, OnPush) in `libs/frontend/chat-ui/src/lib/atoms/motion-style-picker.component.ts`. It injects `ThemeService` and has no inputs.
- Integration: one element plus one import in `theme-toggle.component.ts`, after the Motion fieldset inside `@if (isElectron)`.
- Verification seam: `motion-style-picker.component.spec.ts`. It renders six radios with no "None", the checked state follows `motionStyle()`, a change calls `setMotionStyle`, the reduced-motion note toggles with a mocked `matchMedia`, and the listener is removed on destroy.
- Files: CREATE `.../libs/frontend/chat-ui/src/lib/atoms/motion-style-picker.component.ts` and `.spec.ts`; MODIFY `.../libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts`.

## Integration architecture

- **Data flow**:
  1. Picking a tile calls `ThemeService.setMotionStyle`. The effect writes `html[data-motion-style]`, state and the hint.
  2. Router-driven stages compute the key from the pending target snapshot on `GuardsCheckEnd` (`shouldActivate`). This event always precedes activation; `ResolveEnd` can be skipped. They write the direction provisionally through `MotionStageDirective.setIndex`, commit on the same id's `NavigationEnd`, and restore on cancel, error or skip. Signal-driven stages set their index from `ngOnChanges` in the same template pass as the swap.
  3. Angular inserts the new panel and detaches the old one, and the animation queue adds `ptah-motion-enter` and `ptah-motion-leave`.
  4. The keyframes resolve the variables: the preset on `<html>`, the sign on the nearest stage, and the glass override on the panel.
  5. Angular removes the old node after its animation.
  6. A reused routed component replays its entrance on `NavigationEnd`.
  7. A top-level surface change runs the unchanged root crossfade.
- **State**:
  - the preset is in the webview state plus `localStorage`;
  - index, key and a pending replay or clone live per stage, for the directive's lifetime.
- **External boundaries**: none new. The preset is validated against `MOTION_STYLES` on read and write.
- **Failure and rollback**:
  - Every failure degrades to a cut or to the default preset.
  - `reduce` removes all motion.
  - Revert is pure; a stale storage key is ignored.
- **Observability**: not applicable (visual). The evidence is the Electron matrix.

## Architecture-level quality requirements

- **Functional**:
  - with Motion = Always, every hooked Inventory row animates in Electron with each of the six presets;
  - a preset change applies on the next switch with no reload;
  - top-level surface changes crossfade for every preset;
  - with Motion = Reduce (after restart), nothing animates.
- **Glass**: on glass-bearing panels the blur is correct on every frame (transform-only entrance, cut exit; User-accepted). Fill-only panels fade normally.
- **Performance**:
  - only opacity and transform are animated;
  - there are no per-item listeners or timers;
  - at most one pending replay and one clone per stage (a new clone replaces the old one);
  - every clone is gone within 1500ms (`CLONE_MAX_MS`), and every timer, listener and rAF has a release path.
- **Accessibility**:
  - leaving panels and clones are `pointer-events: none`, and clones are also `inert` and `aria-hidden`;
  - focus behaviour is unchanged;
  - the reduced-motion path is honoured.
- **Maintainability**:
  - no `@angular/animations`;
  - the two stage directives are the only new abstractions;
  - presets are CSS variables.
- **Testability**:
  - unit tests cover direction (including before `NavigationEnd`), replay-listener filtering and cleanup, param reuse, persistence and parity, CSS text, and the wrappers;
  - motion is proven live in Electron.

## Batches

B1 and B2 are the foundation and run in parallel. B4 to B7 need B2 to compile and B1 to look right. B8 needs B1, and must **wait until the Motion-preference lane's files (`theme-toggle.component.ts` above all) are no longer being edited**. No commit is required as a gate.

Verify commands follow `scripts/verify.mjs` (finding 7):
- focused runs: `npm run verify -- -t test -p <project> -- --testPathPatterns=<pattern>`;
- one full `npm run verify -- -p <projects>` per batch (lint, test and typecheck);
- verifies that share a project run one after the other.

| Batch | Components | Files | Focused test run | Full verify |
| --- | --- | --- | --- | --- |
| B1 CSS and state | 1, 2 | `styles.css`, `motion-presets.spec.ts` (new), `index.html`, `theme-pre-paint-parity.spec.ts`, `theme.service.ts` (+ spec), core barrel (if needed) | `npm run verify -- -t test -p ptah-extension-webview -- --testPathPatterns="motion-presets\|theme-pre-paint-parity"`; `npm run verify -- -t test -p @ptah-extension/core -- --testPathPatterns=theme.service` | `npm run verify -- -p ptah-extension-webview,@ptah-extension/core` |
| B2 Stage directives | 3, 3b | `ui/src/lib/motion/*` (new), `ui/src/index.ts`, `native-tab-group.component.ts` (+ spec) | `npm run verify -- -t test -p @ptah-extension/ui -- --testPathPatterns="motion-\|native-tab-group"` | `npm run verify -- -p @ptah-extension/ui` |
| B4 Marketplace | 5 | **B4.0 gate G1 first** (OverviewPage and ConnectorsPage host entries plus the shell stage, then the Electron check). Then the files in component 5, with `motionLeaveClone` set from the G1 result. | `npm run verify -- -t test -p @ptah-extension/marketplace -- --testPathPatterns="marketplace-shell\|marketplace-motion-key\|provider-list-view\|connectors-page\|installed-skills-page\|server-detail"` | `npm run verify -- -p @ptah-extension/marketplace` |
| B5 Settings and wizard | 6 | the settings and wizard files in component 6 | `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="settings\|provider-setup-wizard\|connection-detail-drawer\|voice-details-drawer\|output-style"` | `npm run verify -- -p @ptah-extension/chat` (after B7's focused run, sequential) |
| B6 Thoth | 7 | `thoth-shell.component.ts` (+ spec) | `npm run verify -- -t test -p @ptah-extension/thoth-shell -- --testPathPatterns=thoth-shell` | `npm run verify -- -p @ptah-extension/thoth-shell` |
| B7 Session tabs | 8 | `chat-transcript.component.css` (and possibly `chat-view.component.ts`) | `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="chat-view\|chat-transcript"` | shared with B5's full `@ptah-extension/chat` verify |
| B8 Picker | 9 | `motion-style-picker.component.ts` (+ spec, new), `theme-toggle.component.ts` | `npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns=motion-style-picker` | `npm run verify -- -p @ptah-extension/chat-ui` |

(The former B3 is removed with component 4.)

Final gates:
- `npm run verify -- -p ptah-extension-webview,ptah-electron`, which typechecks the host apps;
- then the Electron visual matrix below.
- No build, serve or e2e targets.

### Electron visual matrix (finding 7)

- Run in Electron only, with Motion = Always.
- Run every row for **each of the six presets** (fade, rise, slide-left, slide-right, scale, directional).
- Run each row with a non-glass theme and with `ptah-glass`.
- Record pass/fail per cell in the visual review.

| Row | Path to exercise | Pass condition |
| --- | --- | --- |
| Top level | chat → settings → marketplace → thoth and back | Plain whole-window crossfade for every preset; navbar and rails static; glass blur unchanged |
| Child route | marketplace overview → connectors → servers/smithery → skills/community and back | Preset motion; `directional` slides back on the return; old page overlaps then disappears (G1 result or the clone) |
| Param reuse | open server A in the docked inspector, then server B; the same in the drawer (narrow window); connector A→B full page and drawer; skill A→B docked and drawer | One replayed entrance per change, inside the inspector or drawer body; the drawer header never covered |
| List→detail→list | each of the three lists, in docked, drawer and full-page placements | Detail enters; on close the list is intact; no stray leaving node |
| Tab | settings top tabs; connection drawer tabs; voice stt/tts; output-style edit/preview; server-detail tabs; thoth tabs | Preset motion with the right direction for `directional` |
| Wizard | provider setup: Continue ×4, Back ×2, direct step click; auth-mode switch | Continue forward, Back back; focus lands on the step heading |
| Session tab | switch between three chat sessions, one still loading history | Preset motion; no empty-then-pop |
| Glass panel | overview with the docked inspector open, ptah-glass theme | Inspector blur correct on every frame; entrance transform-only; exit cut |
| Reduced motion | Motion = Reduce, restart, repeat the rows above | No motion anywhere; no frame shows two panels |
| Rapid switching | click four tabs or pages within about 300ms, in each surface | No stacked leaving panels left behind; final panel correct and interactive |
| First-visit deferred | fresh renderer, each settings tab once | Real body animates in, no pop after the animation; otherwise apply the component 6 remedy |

## Risks

- **R1**: transform as a containing block. For ≤200ms, fixed popovers inside an entering panel are positioned against it (`styles.css:2888-2895`). This is transient. The matrix checks that no popover misplaces itself.
- **R2**: scroll clamping. A shorter new panel clamps the scroller, and the leaving panel shifts for ≤120ms. Mitigated by putting stages inside the scrollers.
- **R3**: glass downgrade. On glass-bearing panels every preset becomes transform-only with a cut exit. The user accepted this for Fade (`user-decisions.md` item 3), and this plan extends it to all presets for the same cause.
- **R4**: `@defer` first visit. Mitigated by the inner-enter design, with a remedy defined in component 6.
- **R5**: router-host leave (A1). This is hard gate G1. The leave-clone fallback is fully specified.
- **R6**: `:has()` cost. It is limited to panels that carry the enter or leave class.
- **R7**: the Motion-lane conflict. B8 waits until that lane stops editing `theme-toggle.component.ts`.

## Assumptions

- **A1**: Angular 22.2.3 keeps a `host`-metadata `animate.leave` node when `RouterOutlet.deactivate()` destroys the component (`_router-chunk.mjs:1516-1522` → core detach `_debug_node-chunk.mjs:4852-4863`). **Resolved by gate G1**; on failure, the leave clone (component 3b).
- **A2** (designed out, round-1 finding 1): router stages take key and direction from `GuardsCheckEnd.state` (a public event, always emitted before `ActivateRoutes`, `_router-chunk.mjs:3944-3945, 4019`). `ResolveEnd` is not used, because it is skipped without activate checks (:3953-3955). Proven by the `ActivationEnd`-time assertion in the route-stage and shell specs, plus the matrix row "Child route".
- **A5**: `inject(MotionStageDirective, { self: true })` from a directive that lists it in `hostDirectives` returns the same-node instance, because host directives are created on the host's node injector. **Check**: the route-stage spec drives direction through it, and the B2 typecheck compiles it.
- **A3**: Chromium resolves `var()` in `@keyframes` against the animated element. **Check**: the matrix (slide-left and slide-right differ).
- **A4**: the cli-orchestration-matrix `:host-context([data-glass='on'])` rule (`cli-orchestration-matrix.component.ts:812`) adds no `backdrop-filter`. **Check**: read it in B5. If it blurs, add its selector to the glass detector.

## Team-leader handoff

- **Recommended executors**:
  - frontend-developer for every batch;
  - visual-reviewer for G1 and the final matrix;
  - code-logic-reviewer for the two stage directives (listener filtering, replay and clone lifecycle, cancel paths).
- **Complexity**: MEDIUM-HIGH. The pattern repeats, but the route stage (pre-activation direction, reuse detection, clone fallback) and gate G1 add real logic.
- **Dependencies and ordering**:
  - B1 ∥ B2;
  - B4 to B7 after B2;
  - B4 starts with gate G1;
  - B8 after B1, and once the Motion-preference lane's files are no longer being edited.
- **Parallel-safe work**: B1 ∥ B2; then B4 ∥ B5 ∥ B6 ∥ B7. B5 and B7 share the `@ptah-extension/chat` project, so their verifies run one after the other.
- **Files affected**:
  - CREATE:
    - `apps/ptah-extension-webview/src/app/motion-presets.spec.ts`;
    - `libs/frontend/ui/src/lib/motion/{index.ts, motion-stage.directive.ts, motion-stage.directive.spec.ts, motion-route-stage.directive.ts, motion-route-stage.directive.spec.ts, motion-route-keys.ts, motion-route-keys.spec.ts}`;
    - `libs/frontend/marketplace/src/lib/shell/marketplace-motion-key.ts` (+ spec);
    - `libs/frontend/chat-ui/src/lib/atoms/motion-style-picker.component.ts` (+ spec);
    - `native-tab-group.component.spec.ts` and `provider-list-view` spec if absent.
  - MODIFY:
    - `apps/ptah-extension-webview/src/styles.css`, `index.html`, `app/theme-pre-paint-parity.spec.ts`;
    - `libs/frontend/core/src/lib/services/theme.service.ts` (+ spec);
    - `libs/frontend/ui/src/index.ts`, `native-tab-group.component.ts`;
    - the marketplace shell, list pages (provider-list-view, connectors-page, installed-skills-page), routed page and detail hosts, and server-detail;
    - settings `settings.component.*`, `connection-detail-drawer`, `voice-details-drawer`, `output-style-instructions-field`, `provider-setup-wizard` (+ specs);
    - `thoth-shell.component.ts` (+ spec);
    - `chat-transcript.component.css`;
    - `chat-ui/.../theme-toggle.component.ts`.
  - Not modified (removed from round 0): `surface-view-transitions.ts` and its spec, and `docked-inspector.component.ts`.
- **Verification points**:
  - G1 recorded with evidence;
  - every nested outlet's direct parent is a route stage;
  - no motion wrapper around drawer headers;
  - the root VT is unchanged;
  - no `!important` in preset rules;
  - the per-batch focused and full verifies;
  - the host typecheck;
  - the full Electron matrix.

## Open questions

None. `user-decisions.md` answers every round-0 question.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Native `animate.*` plus stage directives; root VT only for top level | VT for child routes; a directive carrying `animate.*` | Backdrop Root list and WPT; leave runtime `_debug_node-chunk.mjs:14528-14571`; pattern `chat-view.component.html:99-100` | yes |
| **User-accepted**: top level is a plain crossfade for every preset | Per-preset clip-path wipes (round 0) | `user-decisions.md` item 2 | yes |
| **User-accepted**: glass-bearing panels use a transform-only entrance and a cut exit (stated for Fade; applied to all presets for the same cause) | A true fade (the blur snaps) | `user-decisions.md` item 3; `styles.css:2888-2918` | yes |
| Router key and direction from `GuardsCheckEnd.state` (the pending target snapshot): provisional, committed on `NavigationEnd`, restored on cancel, error or skip | `ResolveEnd` (round 1; can be skipped); a `NavigationEnd` signal (round 0; too late); `onViewTransitionCreated` `to` (ties motion to the VT feature) | `_router-chunk.mjs:2585-2600, 3932-3967, 4012-4029` | yes |
| Stage composition through public imperative methods on `MotionStageDirective`, injected via `hostDirectives` + `inject(..., { self: true })` | Writing `InputSignal`s (impossible); a wrapper component | `core.d.ts:96-106`; `ngOnChanges` with signal inputs `_debug_node-chunk.mjs:115-127, 5456-5485` | yes |
| Detail keys from target-snapshot params under the list's own `routeConfig` | Page signals (`NavigationEnd`-driven) | `provider-list-view.component.ts:399, 456-460`; `connectors-page.component.ts:224-229`; `installed-skills-page.component.ts:539-542` | yes |
| Leave clone: one per stage, replaced not stacked, paused until `NavigationEnd`, completion fallback plus a 1500ms hard cap | Unbounded clones | `_debug_node-chunk.mjs:14554-14569` (Angular's own fallback) | yes |
| Router-host leave is gated by G1, with the leave clone as fallback | Accept enter-only | review finding 6; `_router-chunk.mjs:1516-1522` | yes |
| Store the preset like the scene | RPC like Motion | `theme.service.ts:361-372` | yes |
| The picker is its own component embedded in theme-toggle | Inline | the Motion lane is editing that file | yes |
| Session-tab presets touch only the transcript host and content root | Row-level classes now | user request 3 (later stagger) | yes |
