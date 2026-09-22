# Shell design specification — workspace types, Home grid, pin flow, tile states, permission levels

Status: specification only. No product code. Electron only — the VS Code extension keeps one workspace and no spaces (constraint, `context.md`).

Sources read: `.ptah/specs/TASK_2026_490_583c/research-report.md` Revisions 4–6, `.ptah/specs/TASK_2026_490_583c/critique-product.md` section 5, `.ptah/specs/TASK_2026_493_9f58/context.md`, `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`, `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`, `libs/frontend/core/src/lib/services/app-state.service.ts`, `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`, `libs/frontend/canvas/src/lib/canvas-layout.service.ts`, `libs/frontend/canvas/src/lib/canvas-layout-intent.ts`, `apps/ptah-extension-webview/tailwind.config.js`, `libs/shared/src/lib/types/common.types.ts`, `libs/frontend/ui/src/lib/native/card/native-card.component.ts`, `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts`, `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts`, `libs/frontend/dashboard/src/lib/components/session-analytics/session-stats-card.component.html`.

Installed stack, verified against `package.json` rather than the task text (the task text says Angular 21 / Tailwind 3 / daisyui 4; the correct installed versions are Angular 22.1.7, Tailwind 3, daisyui 4, TypeScript 6.0.3, Electron 44.4.3 — every instruction file was deleted in `7917b193a`, so `package.json` is the only version authority). Signals and `ChangeDetectionStrategy.OnPush` are mandatory throughout.

---

## Navigation sets

`WorkspaceInfo` (`libs/shared/src/lib/types/common.types.ts:16-20`) already carries a `type: string` field — no interface change is needed to add a workspace type. This specification assigns it two literal values: `'code'` and `'space'`. Nothing in the shell interface gets a second "workspace" word; `type` is the only new vocabulary.

| Nav set                | Surfaces (in tab order)                          | Landing surface |
| ----------------------- | ------------------------------------------------- | ---------------- |
| Code workspace (`type: 'code'`) | Chat, Apps, Tasks, Tribunal, Analytics | Chat |
| Space (`type: 'space'`)         | Home, Chat, Apps, Schedules            | Home |

Global configuration area — Thoth, Setup hub, Marketplace, Settings — is **not** in either nav row (Revision 5, "Configuration ... moves out of the tab row to one global area"). It lives behind one icon button in the navbar's existing global-actions cluster, next to the theme toggle (`electron-shell.component.ts:223-227`, `no-drag` cluster). The button opens a `ptah-native-dropdown` (`libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts`) listing the four destinations. This cluster is already outside the per-workspace tab row and already renders regardless of `layout.hasWorkspaceFolders()` (`electron-shell.component.ts:218-227` sits above the `@if (!layout.hasWorkspaceFolders())` gate at line 232), so the four configuration surfaces become reachable **before** any workspace or space is open — directly closing Revision 5 problem 2 ("A technical operator without a repository cannot continue past the welcome screen").

Because these four surfaces apply regardless of which workspace is active, their view state must stop being keyed by workspace path. Today every view (including these four) is partitioned through `AppStateManager`'s `_viewSlices` map (`app-state.service.ts:244-262`). The precedent for un-partitioning a signal that must not vary per workspace already exists in the same file: the `layoutMode` signal is "Deliberately NOT workspace-partitioned" (`app-state.service.ts:267-274`). The four global-configuration surfaces need the same treatment: one global "currently open configuration surface" signal, independent of `_activeWorkspacePath`.

**Design decision — Home and Apps share one page.** Scope item 2 defines Home as only "a grid of pinned apps." The code-workspace nav set has no `home` entry at all, so for a code workspace the pinned-apps grid must live on `apps` — there is nowhere else it could live. Making `home` a distinct component from `apps` would mean building the pinned grid twice. Instead: `home` and `apps` render the same component (the Apps page), and `home` is the space's landing route into it. `apps` stays in the nav row for both workspace types so there is always one fixed, explicit way back to it, independent of whichever surface is currently first. This is what makes the task.md goal literal — "include the space workspace type in the design, so that the navigation changes one time only" — the Apps page is built once, for the code-workspace first release, and a space's `home` route is a second address into that same page, not a second UI.

---

## Surface ids and mount policy

Ids are lowercase, URL-safe, ASCII, hyphen-separated — safe as route segments and stable across releases (a rename here breaks every restorable session). Nine of the eleven ids below already exist verbatim in the `ViewType` union (`app-state.service.ts:20-33`); `apps`, `home` and `schedules` are new. Reusing the existing spelling is deliberate: `context.md` states that TASK_2026_524 batch 1 keeps every id in one constant, so remapping the existing ids into the two nav sets defined above is a single edit, not a rewrite.

Mount policy is graded against the mechanism the shell already implements, not a proposed one. Today's `app-shell.component.html` proves both halves of the pattern in the same file:

- **Stays mounted (hidden, not destroyed).** The chat/canvas chrome sits in `<div class="flex h-full" [class.hidden]="isStandaloneView()">` (`app-shell.component.html:135`), rendered unconditionally and only ever `display:none`-toggled. The canvas itself sits inside that block behind a second `[class.hidden]` toggle keyed on `layoutMode()` (`:687,712`), with the surrounding comment stating the reason directly: *"This preserves canvas tile state (CanvasStore is scoped per component instance) across layout toggles."* Nothing in this block is ever torn down by switching to another surface.
- **Destroyed on navigate-away.** Every other surface — `setup-wizard`, `settings`, `analytics`, `harness-builder`, `setup-hub`, `thoth`, `marketplace`, `tribunal`, `tasks` — is an `@switch (currentView())` `@case` (`app-shell.component.html:18-131`). Angular's `@switch` removes the non-matching branch's component from the DOM; re-entering a case constructs it fresh.

| Id | Nav set(s) | Label | Stays mounted? | Why (one sentence) |
| --- | --- | --- | --- | --- |
| `chat` | code, space | Chat | **Yes** | It is the always-mounted chrome plus canvas today (`app-shell.component.html:135,683-715`); leaving it never tears down `CanvasStore`, which is scoped per component instance and holds every session tile's live gridstack position. |
| `apps` | code, space | Apps (also reached via `home`) | **Yes** | A pinned tile can be mid-refresh, mid-filter or mid-selection (UX rule 3: sort/filter/page run in the app, not the model); destroying the page on every tab switch would discard that live client state and restart any countdown to the next scheduled refresh, so it joins `chat` inside the always-mounted chrome rather than an `@switch` case. |
| `home` | space | Home | N/A — alias | `home` is a route into the same mounted `apps` page (see "Navigation sets"), not a second instance; it has no mount state of its own. |
| `tasks` | code | Tasks | No | The `.ptah/specs` board re-reads from disk on mount and carries no draft the user typed into it; a remount is a cheap re-read, matching its current `@switch` case (`app-shell.component.html:120-130`). |
| `tribunal` | code | Tribunal | No | Its state lives in `TribunalStateService`, itself workspace-partitioned already (Revision 5 evidence list), and is unaffected by the view being torn down and rebuilt — same current `@switch` case (`:107-117`). |
| `analytics` | code | Analytics | No | `ptah-dashboard-grid` re-computes session stats from `ChatStore`/persisted session data on mount; there is no in-flight user input to lose (`:40-44`). |
| `schedules` | space | Schedules | No | It lists from the scheduler service on mount and, per Revision 5's own risk note, must share one data source with the Thoth Cron tab — being re-fetched on every entry is what keeps the two views from drifting apart, not a reason to avoid it. |
| `thoth` | global config | Thoth | No | Already deferred behind `@defer (on immediate)` and rebuilt each entry (`:81-91`); its own sub-panels (memory, skills, cron, gateway) each own their persisted state independently of the shell view. |
| `setup-hub` | global config | Setup hub | No | A guided/status surface with no user draft to protect; current `@switch` case (`:59-70`). |
| `marketplace` | global config | Marketplace | No | Browsing/install state lives in its own services, not in view-local component state; current `@switch` case (`:93-104`). |
| `settings` | global config | Settings | No | Settings forms read from and write directly to persisted config; there is nothing transient to lose between visits; current `@switch` case (`:32-37`). |

**How "stays mounted" must be implemented.** This table states intent, and the
intent is correct. Do **not** implement a second `[class.hidden]` block for
`apps`. `TASK_2026_524_1125` batch 3 replaces the CSS hiding with a
workspace-keyed `RouteReuseStrategy`, where a retained surface leaves the DOM
**and** change detection while its instance and its component-scoped DI stay
alive. `display: none` keeps a surface in change detection, so today's
mechanism pays for every retained surface on every signal change. Express
"stays mounted" as `data: { retain: true }` on the route, and pair it with that
task's `SURFACE_ACTIVE` signal so a retained Apps page pauses its refresh
countdown and its chart work while it is not visible. A retained surface
receives no `ngOnDestroy`, so anything periodic must read that signal.

---

## Home grid

Home (and, identically, Apps — see the shared-page decision above) is a grid of pinned tiles built on the gridstack wrapper already in `libs/frontend/canvas`, not a second grid library. Reuse:

- The Angular gridstack bindings already in use: `<gridstack>` / `<gridstack-item [options]="{ x, y, w, h, id }">` from `gridstack/dist/angular`, gridstack v12.6.0 (`orchestra-canvas.component.ts:49-54`).
- The 12-column convention already established for this grid: `GRID_COLUMNS = 12` (`libs/frontend/canvas/src/lib/canvas-layout-intent.ts:5`).
- The responsive-column derivation pattern in `CanvasLayoutService` (`libs/frontend/canvas/src/lib/canvas-layout.service.ts:1-80`): columns derived from measured container width via a `ResizeObserver`, not from fixed pixel breakpoints.
- The persisted-intent pattern in `CanvasLayoutPersistenceService`: store *intent* (order, width/height class), never raw `x`/`y`, so a resize doesn't corrupt a saved layout (`canvas-layout-intent.ts:47-56`).

New, sibling services in the Apps feature lib — `AppsLayoutService` / `AppsLayoutPersistenceService` — mirror this architecture exactly, keyed by pin id instead of session tab id, and persisted per workspace path (the same partition pattern `AppStateManager` already applies for view state, `app-state.service.ts:244-262`). Do not extend `CanvasStore` itself: it is scoped to chat session tiles, and a pinned dashboard tile is a different domain object with a different lifecycle (a schedule, not a chat session).

Default tile footprint by catalog component kind, expressed in the existing 12-column / row-unit vocabulary (`canvas-layout-intent.ts:12-33`, which already defines `FULL_TILE_HEIGHT_UNITS = 6`, `COMPACT_TILE_HEIGHT_UNITS = 2`, span units `third: 4, half: 6, two-thirds: 8, full: 12`):

| Catalog kind | Default width (cols) | Default height (rows) |
| --- | --- | --- |
| stat | 4 (`third`) | 2 (`COMPACT_TILE_HEIGHT_UNITS`) |
| line chart / bar chart | 6 (`half`) | 4 |
| table | 8 (`two-thirds`) | 6 (`FULL_TILE_HEIGHT_UNITS`) |
| list | 4 (`third`) | 4 |

A new pin is placed at the next free cell in reading order (top-left, row-major), matching the existing tile-adoption order used for canvas session tiles. The exact placement algorithm and the maximum pin count per workspace (canvas caps session tiles at `MAX_CANVAS_TILES = 20`, `canvas-layout-intent.ts:15-20` — Apps needs its own cap, not necessarily the same number) are implementation details for TASK_2026_494 / the frontend build, not fixed by this spec; see Open Questions.

The empty-state (zero pins) reuses the `NativeCardComponent` (`libs/frontend/ui/src/lib/native/card/native-card.component.ts`) shell with a single centered call to action ("Pin your first app from a chat answer"), following the same empty-state pattern already used by `CanvasEmptyStateComponent` for zero canvas tiles.

---

## Pin flow

The pin flow starts as a **temporary card inside the chat stream**, styled like the existing hand-built chat cards (`QuestionCardComponent`, `PermissionRequestCardComponent` — `border-l-2`, `bg-base-300/30`, `role="alert"`, `text-[11px]` header row with an icon and a label). It is the rendered output of a dashboard spec (TASK_2026_493's stat/chart/table/list catalog), with one additional footer row this spec adds: a **"Pin to Home"** button (`btn btn-xs btn-primary`, matching the `Allow`/`Submit` button weight in the two existing cards).

Clicking "Pin to Home" does not pin immediately — it expands the same card into a **confirmation step** that a user must see and accept before anything persists, per Revision 5 UX rule 5 ("Before the pin, show the source of the refresh, the schedule and the cost"). The confirmation step shows exactly three facts, each on its own row, each with a label in `text-[10px] uppercase tracking-wider text-base-content-muted` (the label convention already used by `session-stats-card.component.html:53-55`) and a value in `text-sm font-semibold`:

| Row | Content | Source |
| --- | --- | --- |
| Refresh source | The deterministic tool call that will be re-run (never "ask the agent again" — Revision 4 correction 5: refresh is deterministic by default, agent refresh is opt-in with a budget). Rendered as `font-mono`, matching the verbatim-command convention already used for permission cards (`permission-request-card.component.ts:309`, `getFormattedDescription`) and for the plugin-install consent dialog's command-line rendering. | The tool call the chat card's spec was generated from. |
| Schedule | The cadence the user is about to commit to (e.g. "Every 6 hours"), plus the fixed disclosure line "Runs only while Ptah is open" (Revision 5 rule 6). | User-selected cadence + a static disclosure string — not a per-tile computed value. |
| Cost | The same three-tier cost formatting already established by `CostBadgeComponent` (`libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts`): `< $0.01` → 4 decimals, `>= $0.01` → 2 decimals, and an explicit "cost unavailable" state (never a silent `$0.00`) when no per-token pricing is known for the refresh's provider/model. | Estimated cost of one refresh run, using the existing cost-calculation path. |

Two buttons close the confirmation step: `Cancel` (`btn-ghost`, returns to the plain chat card) and `Confirm pin` (`btn-primary`). Confirming is the mutation boundary — this is a **Tier 2 (staged)** action under the permission model below, so it carries an idempotency operation ID (Revision 6 correction 3) and the UI shows a pending state, never a false failure, if the confirmation round-trip is slow.

Once pinned, the temporary chat card gets a small persistent badge ("Pinned to Home", `badge badge-xs badge-ghost`) so re-reading the transcript later still shows the pin happened, and the tile now exists on the Home/Apps grid, in the empty state described above or appended to the existing grid.

---

## Tile states

All six states named in `context.md` use the `NativeCardComponent` `tone` + `spine` treatment (`native-card.component.ts:56-94`, mapping tones to real daisyUI semantic tokens), matching the color-to-tone convention already used across `PermissionRequestCardComponent`'s tool-color mapping. State is never carried by color alone (accessibility rule, see below): every state pairs its tone with an icon and a text label.

| State | Tone / spine | Icon | Text label | Notes |
| --- | --- | --- | --- | --- |
| Loading | `neutral` | none — `loading loading-spinner loading-xs` (existing daisyUI utility, already used at `session-stats-card.component.html:61`) | "Loading…" | Body content is a `SkeletonBlockComponent` (`libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts`) with `rows` sized to the catalog kind, not a blank tile. |
| Fresh | `success` spine | `Check` (lucide) | "Updated {relative time}" | Value rendered as colored text on a neutral tile surface (`text-success` on `bg-base-200/40`/`bg-base-300/30`), not white text on a `badge-success` fill — see the measured-contrast note below for why. |
| Stale | `warning` spine | `Clock` (lucide) | "Stale — last updated {relative time}" banner, matching Revision 5 rule 5 ("Each tile shows 'last update' and a stale banner"). | Banner is a full-width strip inside the tile, `bg-warning/10 text-warning border-t border-warning/30`, not just a corner dot. |
| Failed | `error` spine | `AlertTriangle` (lucide) | "Refresh failed — {reason}" plus a `Retry` button (`btn btn-xs btn-error btn-outline`). | Reason is the plain-text rejection message the deterministic refresh returned, never a raw stack trace. |
| Auth necessary | `warning` spine | `Lock` (lucide, already imported in `orchestra-canvas.component.ts:21`) | "Sign in required to refresh" plus a `Reconnect` button routing to the relevant connector's settings. | Distinguished from Failed by label and action, not by color alone — both use `warning`/`error` tones that must never be the sole signal. |
| Schedule stopped (Ptah closed) | `neutral` spine, dimmed body (`opacity-70`, matching `NativeCardComponent`'s `disabled` treatment at `:194`) | `Clock` with a slash affordance or paired "Paused" badge | "Paused while Ptah was closed — last updated {relative time}" | This is the literal, disclosed consequence of Revision 4's "closed-laptop problem": the copy states the cause, not just "stopped," so the user does not read it as a bug. |

---

## Permission levels

Three tiers, matching `critique-product.md` section 5's "Three-Tier Progressive Trust Model" as corrected by Revision 6 (idempotent operation IDs replace the rejected fixed-timeout revert). These are new, hand-built components in the Apps feature lib — they extend the **visual pattern** already established by `PermissionRequestCardComponent` and `external-consent-dialog.component.ts` (border spine, icon, plain-language copy, no generic dialog/table library), not the components themselves, since those are typed to tool-call permission requests and plugin-install plans, not app actions.

| Tier | Trigger | Visual treatment | Copy pattern |
| --- | --- | --- | --- |
| 1 — Silent read | Listing data, reading files, fetching metrics (idempotent). | No interruption. Logged to a collapsible audit footer at the bottom of the Apps page — same collapsed-badge-then-expand structure as `PermissionBadgeComponent` (`libs/frontend/chat-ui/src/lib/molecules/permissions/permission-badge.component.ts:36-88`), but listing completed reads, not pending requests. | "{tool} read {target} — {relative time}" per row. |
| 2 — Staged change | A draft mutation the user can still discard (e.g. a drafted message, a proposed edit). Also the pin-confirmation step above. | Executes into a "Draft" state inline on the card/tile — `badge badge-xs badge-warning` "Draft" — with an inline `Commit` button (`btn btn-xs btn-primary`) and a `Discard` button (`btn btn-xs btn-ghost`). | "{summary of the staged change}. Not yet applied." |
| 3 — Destructive | Financial, egress, or irreversible actions (Revision 6's example category). | A hand-built modal, high-contrast, blocking. No raw tool name, no JSON. Structurally follows `external-consent-dialog.component.ts`'s precedent of rendering the exact operands verbatim in `<code>` rather than paraphrasing them. | Plain-language template: **"This will permanently {verb} {count} {noun}: {identifiers}. This cannot be undone."** — e.g. "This will permanently delete 2 schedules: Weekly cost digest, Daily standup board." Two buttons: `Cancel` (`btn-ghost`, default focus) and the destructive action itself, named for the action (never a bare "Confirm"), `btn-error`. |

Every Tier 2/3 mutation carries an idempotency operation ID (Revision 6 correction 3). A timeout on the round-trip shows a **pending/unknown** state and re-queries by operation ID — the UI only shows "failed" and offers a rollback when cancellation or compensation is actually guaranteed by the backend, never on timeout alone.

---

## Catalog components

Per `TASK_2026_493_9f58/context.md`, the catalog is exactly: **stat, line chart, bar chart, table, list**, plus a mandatory **text fallback**. This spec defines their visual treatment; the Zod contract, budgets and trust-boundary controls (action allowlist, no `innerHTML`, URL-scheme limits, host-mediated actions) are that task's deliverable and are treated here as fixed constraints, not proposals.

- **Stat.** Extends the pattern already shipping in `session-stats-card.component.html:51-86`: a `bg-base-300/30 rounded px-2 py-1.5 border border-{tone}/20` cell, label `text-[10px] uppercase tracking-wider text-base-content-muted`, value `text-sm font-semibold tabular-nums text-{tone}`. No new component is needed at the visual-primitive level — the catalog "stat" node is this same cell, generalized to accept the spec's label/value/tone instead of session-specific fields.
- **Line chart / bar chart.** No charting library exists in this codebase today (confirmed — no `chart` component under `libs/frontend`). This spec does not select one; that choice belongs to TASK_2026_493/494. What this spec fixes: axis and gridline colors use `text-base-content-muted` / `border-base-content/10` (the app's existing muted/divider tokens, not new chart-specific colors), series must not be distinguished by hue alone (see Accessibility), and every chart ships the row-limited text/table alternative mandated below rather than an image export.
- **Table.** daisyUI `table table-xs`/`table-sm` on the existing base tokens (`bg-base-100`, `border-base-300`), row/column budgets fixed by TASK_2026_493 (max 1,000 rows / 50 columns at the boundary; the visible tile shows a scrollable viewport, not all rows at once).
- **List.** Reuses the existing row pattern from the session sidebar list items (`app-shell.component.html:269-296`): `rounded-md border-l-2 border-transparent`, `hover:bg-base-300/50`, primary line `text-sm font-medium`, secondary line `text-xs text-base-content-muted`.
- **Text fallback.** Already contractually fixed by TASK_2026_493 ("the title, each stat as 'label: value', and each table as a short text table with a maximum of 20 rows" — `TASK_2026_493_9f58/context.md:51`). This spec adds only the typography for where that text renders inside a tile when the catalog fails closed on an unknown version/component: `font-mono`, matching the verbatim/plain-text convention used for permission descriptions and refresh-source display above.

---

## Accessibility

- **Keyboard entry and exit.** Every tile that can expand to a larger/detail view is a `role="button"` activation target reachable by `Tab`, activated by `Enter`/`Space` — the exact pattern `NativeCardComponent` already implements (`native-card.component.ts:111-118, 220-228`: `interactive()`/`onKeydown`, ignoring keypresses that land on a nested control). Escape closes any expanded tile or modal (already the convention in `QuestionCardComponent`'s custom-input field and the session popovers, `(keydown.escape)="handleCancel()"`).
- **Focus return.** Closing an expanded tile, a Tier 3 modal, or the pin-confirmation card returns focus to the control that opened it (the tile's own activation target, or the "Pin to Home" button), not to the page body. This mirrors the existing popover convention (`ptah-native-popover`'s `closed` output) already wired to cancel handlers throughout the chat surface.
- **Table alternative for every chart.** Fixed above under Catalog components and by TASK_2026_493's text-fallback contract; this spec adds that the in-tile toggle between chart and table view must itself be a labeled, keyboard-reachable control (`aria-pressed`), not a hover-only affordance.
- **No color-only encoding.** Enforced throughout this document: every tile state pairs its tone with an icon and a text label (Tile states table), every permission tier is named in the copy, not signaled by border color alone, and chart series must carry a direct label or pattern, not hue alone.
- **Measured contrast.** Criterion: WCAG 2.1 AA (4.5:1 normal text, 3:1 large text/UI components) — the same criterion the project already enforces for `base-content-muted` (`apps/ptah-extension-webview/tailwind.config.js:13-31`, verified by `base-content-muted.spec.ts` against every theme). The ratios below were computed for this specification using the standard WCAG relative-luminance formula against the literal `anubis` (dark, default — `darkTheme: 'anubis'`) token values in that file; they are **not** run through the project's own automated harness, so they are a design-time estimate, flagged accordingly in Open Questions.

  | Pair | Ratio | Verdict |
  | --- | --- | --- |
  | `base-content` (#e8e6e1) on `base-100` (#131317) | ≈14.9:1 | Pass (primary text) |
  | `base-content` on `base-300` (#242430) | ≈12.3:1 | Pass |
  | `base-content-muted` (`--bcm`) on `base-100` | 5.29:1 | Pass — sourced directly from the file's own comment (`tailwind.config.js:20-24`), not recomputed here |
  | `text-success` (#16a34a) on `base-300` | ≈4.65:1 | Pass — the pattern `session-stats-card.component.html` already uses (colored text on a neutral tile, not a filled badge) |
  | `text-warning` (#f97316) on `base-300` | ≈5.47:1 | Pass |
  | `text-error` (#dc2626) on `base-300` | ≈3.17:1 | Pass for large text/UI components only — **do not** set small error-state body text in raw `text-error`; pair with the icon and keep the label at normal-or-larger weight, or lean on the `warning`/`error` spine plus icon instead of the text color to carry meaning |
  | `text-info` (#3b82f6) on `base-300` | ≈4.17:1 | Marginal fail for small normal text (just under 4.5:1); same mitigation as `text-error` |
  | `success-content` (#e8e6e1) text on a solid `badge-success` fill | ≈2.64:1 | **Fail** |
  | `info-content` (#e8e6e1) text on a solid `badge-info` fill | ≈2.95:1 | **Fail** (also fails the 3:1 non-text threshold) |
  | `error-content` (#e8e6e1) text on a solid `badge-error` fill | ≈3.87:1 | Fail for normal text; passes 3:1 large-text/UI-component threshold |
  | `warning-content` (#131317) text on a solid `badge-warning` fill | ≈6.62:1 | Pass |

  Consequence for this spec: tile states and stat values use **colored text on a neutral surface** (the `session-stats-card` pattern), never white-on-color filled badges, for anything that must actually be read — filled `badge-success`/`badge-info` chips measured here fail AA outright and must be treated as decorative accents only (e.g., a small unread-count chip), always duplicated by plain text elsewhere on the tile.

---

## Open questions

1. **Home-vs-Apps content divergence.** This spec resolves Home and Apps as the same page for the buildable first release (see "Design decision" above). If product wants Home to later become a curated subset distinct from a fuller Apps catalog/App-Studio surface, that is a scope decision, not a navigation blocker — `home` is already a separately addressable id — but the resulting content split is undefined here.
2. **Exact pin cap and placement algorithm for the Apps grid.** Canvas caps session tiles at `MAX_CANVAS_TILES = 20`; Apps needs its own cap and a defined tie-breaking placement rule for simultaneous pins. Not fixed by this spec.
3. **Chart rendering library.** No charting library exists in the repository today. Selecting one (and re-verifying its behavior under the webview CSP, OnPush and zoneless change detection — the same class of unknown the parent research flagged for `@a2ui/angular`) is TASK_2026_493/494's decision, not this spec's.
4. **`anubis-light` contrast.** The measured-contrast table above covers only the default `anubis` (dark) theme. `anubis-light`'s badge/semantic-token pairs were not computed in this pass (its values are OKLCH, not hex, and hand-converting them was out of this task's effort budget) and should get the same audit — ideally via an automated check in the style of `base-content-muted.spec.ts` — before the light theme ships this feature.
5. **Global-configuration dropdown vs. a full drawer.** This spec places Thoth/Setup hub/Marketplace/Settings behind one `ptah-native-dropdown` in the navbar cluster. Whether that scales visually once Setup hub/Marketplace gain more sub-destinations (a drawer, per `libs/frontend/ui/src/lib/native/drawer`, is the available alternative primitive) is left to the frontend implementer.
