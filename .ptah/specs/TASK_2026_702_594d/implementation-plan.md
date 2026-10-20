# Implementation Plan - TASK_2026_702_594d

## Inputs and scope

Approved inputs: `context.md`, `task-description.md` (AC1–13; amended line 33), `decisions.md` (#1–15), `design-spec.md`, both design revisions, `design-spec-review.md`, `parity-inventory.md`, and `prototype/start-screen.html`. Decision #15 includes a low-opacity Aurora on single-chat. TASK_2026_593_7c2e owns the notification center and bell, and does not edit the canvas shell. Do not edit notification-center files. Repository `CLAUDE.md:3-16` restricts verification to scoped projects and one heavy check at a time.

## Codebase evidence

| Evidence | Location | Effect |
| --- | --- | --- |
| Canvas has an external dock, one named popover, and a viewport; board and rail already emit create requests | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:85-89,144-255,584-628`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:109-166,280-286`; `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:232-270` | Remove dock; preserve creation, cap and history behavior. |
| Popover positions against its internal projected trigger wrapper | `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:84-85,129-182,218-222,247-264` | An optional external anchor is required after dock removal. |
| Query mode ranks pinned before pagination; with no organization, the pin predicate is ignored | `libs/backend/rpc-handlers/src/lib/handlers/session-list-query.ts:77-92,100-119`; `libs/shared/src/lib/types/rpc/rpc-session.types.ts:93-113` | Two bounded reads and deduplication are required for exact top three. |
| Setup card is shared; status widget owns RPC and generation actions | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:166`; `libs/frontend/chat/src/lib/components/molecules/setup-plugins/chat-empty-state.component.ts:82-90`; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status-widget.component.ts:189-284` | Replace presentation and move behavior to shared store. |
| Chat dialog loader spreads current filters; session open action reports opened/failed | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:490-550`; `libs/frontend/chat/src/lib/services/session-list/session-row-actions.service.ts:44-73` | Recent cards need independent read; reuse open action. |
| Native UI umbrella files are pure export barrels; feature libraries may consume UI | `libs/frontend/ui/src/lib/native/index.ts:10-14,33-43`; `libs/frontend/ui/src/lib/native/brand-mark/brand-mark-barrels.spec.ts:92`; `libs/frontend/ui/project.json:2-7`; `libs/frontend/canvas/project.json:2-7`; `libs/frontend/chat/project.json:2-7` | Share Aurora through a native sub-barrel, leaving `ui/src/index.ts` untouched. |
| Brand notice ships through host assets and Electron resource | `apps/ptah-extension-vscode/project.json:48-52`; `apps/ptah-electron/project.json:103-107`; `apps/ptah-electron/electron-builder.yml:120-121` | Ship Omnedia notice on the same path. |

## Component contracts

### Shared Get ready and single-chat

Keep `ProjectSetupCardComponent` standalone/OnPush with its current selector-only input contract; inject `PluginCatalogService` and new signal/computed `SetupStatusStore` from `@ptah-extension/chat-ui`. Provide the store at root scope so canvas and single-chat share workspace-keyed state. Refresh on workspace change, after wizard launch resolves, and explicit retry. Move the widget's `setup-status:get-status` (10s), `setup-wizard:launch` (5s), workspace-open/retry state, and `GenerationWorkflowLauncherService.open` with active-workspace and `independent-start` rules (`setup-status-widget.component.ts:189-284`). Preserve safe failure feedback. Skills is ready only after catalog load and enabled plugins; Agents only on confirmed configured status including update-available (`project-setup-card.component.ts:130-153`). Unknown/loading/error suppress the count and keep the card expanded; Project scan is uncounted. Preserve wizard, Generate agents, Project guidance, retry, route, badges, and Ready strip. Use `surface-3`, `aria-live=polite`, 280px stacking, no `text-base-content/NN` classes (`design-spec.md:43-48,60-84`). Delete widget source/spec and both exports: `chat-ui/src/index.ts:119`, `chat/src/lib/components/index.ts:118-127`; confirm no other literal consumer. `ChatEmptyStateComponent` retains `showProjectSetup`, logo, suggestions and footer.

### Aurora and popover

New standalone/OnPush `AuroraEffectComponent` lives in `libs/frontend/ui/src/lib/native/aurora/`. Export through `aurora/index.ts` then `native/index.ts` using only `export * from` lines; `ui/src/index.ts` remains untouched. Inputs `variant = input<'board'|'brand'>('board')` and `visible = input(true)`; no outputs. Port the approved two CSS repeating gradients and radial mask, with `color-mix` stops from DaisyUI `secondary` and `base-100`. Board is 570px at opacity .24 dark/.33 light; brand is 300px at .14 behind single-chat logo. A bounded host observer and tab/surface visibility pause the animation; reduced motion yields a static gradient, including live preference changes. Release observer/listeners on destroy. Animation may change only transform/opacity in perpetuity; review CPU if visual review runs. Decorative element is `aria-hidden` and pointer-inert; text and controls meet 4.5:1 and 3:1 contrast (`design-spec.md:50-56,60-84`).

Extend `NativePopoverComponent` with optional `anchor = input<HTMLElement | null>(null)`; position from `anchor() ?? triggerRef()?.nativeElement`. Existing projected-trigger consumers retain default behavior and get a regression spec. Shell records the actual invoking element in a signal before opening its single shared named popover; pass it via `[anchor]`, then restore focus on Cancel, Escape, backdrop, and failed create. Keep default name, focus and final cap checks (`orchestra-canvas.component.ts:584-628`).

### Canvas board, notice and history

`CanvasRailBoardComponent` owns the primary hero only when zero tiles, `data-testid="canvas-hero-new-session"`; `CanvasRailComponent` owns the secondary footer `data-testid="canvas-footer-new-session"`. Rail changes `newSession = output<HTMLElement>()` and emits its button; board changes `newSessionRequested = output<HTMLElement>()`, emits its hero button or forwards rail's element; shell receives and anchors popover. Keep focusable `aria-disabled`, reason, title, final cap recheck, and previous-session control. The empty board may put `<main>` before `<aside>` in DOM while rail stays visually left; populated boards retain their current Tab order and shell `onRailKeydown` handler (`orchestra-canvas.component.ts:64`). Board scrolls inside gained viewport.

Shell supplies `notice = input<CanvasBoardNotice | null>(null)` (kind, exact text, source-instance key) and receives `noticeDismissed = output<string>()` (key). Shell ranks write failure, read-only, `headerMessage`; board renders one dismissable in-flow notice before hero or tiles. Dismissal masks only that instance and resets on relevant board entry, workspace change or source refresh even if condition remains. Persistence failures use `role=alert`; cap uses `role=status`—the design-specific split (`design-spec.md:62`) supersedes AC12's generic “status semantics.” No extra snackbar. Shell keeps needs-you chip temporarily in `session-viewport`, in normal flow clear of hero/notice, retaining `@defer (on idle)` and placeholder; do not delete queue files before phase 3.

New `RecentSessionsStore` in chat makes two typed `ClaudeRpcService` `session:list` query-mode calls for active workspace: `{ pinned: true, limit: 3, offset: 0, sort: 'lastActive' }` and the same with `pinned: false`. Merge and deduplicate by session ID (no-organization hosts ignore pinned), sort by `lastActivityAt` descending and stable session-ID tie-break, then take three. Organization query mode excludes archived by default (`session-list-query.ts:115-119`); no-organization host has no archive filter. This deliberately deviates from `task-description.md:44`'s suggested `ChatStore.sessions`/`loadSessions`, because loader filters depend on Previous sessions dialog state and violate AC9. Store has workspace-keyed loading/confirmed/error signals and drops stale results. Board uses public `SessionRowActionsService.openSession` (`chat/src/lib/services/index.ts:122`); failed open announces and leaves card. No invented empty-history text.

### Notice attribution and selector migration

Hand-maintain full Omnedia MIT notice from `prototype/aurora-notices.txt` at `libs/frontend/ui/src/lib/native/brand-mark/aurora-notices.txt`; this is the brand-mark input directory (`scripts/brand-icons.manifest.json:14`), but this notice is not generated. Cite upstream Aurora CSS and MIT in port header. Add asset declarations to VS Code and Electron `project.json` and `electron-builder.yml`; inspect VSIX/builder exclusions statically. Require zero `findScannerTokens` hits using `scripts/brand-icons/scanner-tokens.mjs`; release owner checks produced packages later.

Re-target every `canvas-new-session-anchor` and `title="Add new session tile"` caller to hero or footer test id according to existing empty-board versus populated-board branch; keep a separate `data-testid="canvas-interactive"` startup-TTI marker on ready viewport. Update `Open Marketplace Skills` selector to approved `Open Library`. Delete `ActivityTickerComponent` and its spec/export while retaining `BackOfficeActivityService`; correct the stale canvas-dock comment in `webview-e2e-harness/.../thoth/activity-ticker.e2e.spec.ts:13-17`.

## File-disjoint phases and batches

Within each phase batches own disjoint files and pass their scoped tests. Run 1A before 1B; phase 2 in order **2A → 2B → 2C → 2D → 2E**. Board 2B defines `notice: CanvasBoardNotice | null`, `noticeDismissed: string`, and `newSessionRequested: HTMLElement`; shell 2C supplies/handles those contracts. Only sequential cross-phase revisits: `chat-ui/src/index.ts` (widget then ticker exports), `orchestra-canvas.component.ts` and its two specs (chip removal in gated phase 3). No notification-center file is edited.

| Batch | Owned files (≤8) | Scoped proof |
| --- | --- | --- |
| 1A shared readiness | `chat-ui/.../setup-status.store.ts`, `.spec.ts` new; `chat-ui/.../setup-status-widget.component.ts`, `.spec.ts` delete; `chat-ui/src/index.ts`; `chat/src/lib/components/index.ts`; `chat/.../project-setup-card.component.ts`, `.spec.ts` | `@ptah-extension/chat-ui`, `@ptah-extension/chat`: truth/count, both actions, failures, retry, Ready strip; no widget exports/consumer. |
| 1B Aurora, popover, single-chat | `ui/.../aurora/aurora-effect.component.ts`, `.spec.ts`, `index.ts` new; `ui/src/lib/native/index.ts`; `ui/.../popover/native-popover.component.ts`, `.spec.ts`; `chat/.../chat-empty-state.component.ts`, `.spec.ts` | `@ptah-extension/ui`, `@ptah-extension/chat`: motion, visibility, external/default anchor, conditional content and 280px; `brand-mark-barrels.spec.ts`. |
| 1C notice assets | `ui/.../brand-mark/aurora-notices.txt`; VS Code and Electron `project.json`; Electron `electron-builder.yml` | Static full notice, scanner, assets/exclusions; no packaging run. |
| 2A history | `chat/.../session-list/recent-sessions.store.ts`, `.spec.ts` new; `chat/src/lib/services/index.ts` | `@ptah-extension/chat`: older pinned vs newer unpinned, archived, non-org duplicate responses, filter independence, stale workspace. |
| 2B board and rail | `canvas/.../canvas-rail-board.component.ts`, `.spec.ts`; `canvas/.../canvas-rail.component.ts`, `.spec.ts` | `@ptah-extension/canvas`: hero/footer payload, notice, cards, limits, empty DOM order and populated keyboard behavior. |
| 2C shell and ticker | `canvas/.../orchestra-canvas.component.ts`, `.spec.ts`, `.rail.spec.ts`; `chat-ui/.../activity-ticker.component.ts`, `.spec.ts` delete; `chat-ui/src/index.ts`; `webview-e2e-harness/.../thoth/activity-ticker.e2e.spec.ts` comment | `@ptah-extension/canvas`, `@ptah-extension/chat-ui`: anchor/focus, warnings, ticker/dock absence, temporary chip, rail handler. |
| 2D selectors A | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`; `src/specs/harness/new-project-question-routing.spec.ts`; `src/specs/perf/startup-tti.spec.ts`; `src/support/ui-driver.ts`; `src/specs/chat/compaction-duplicate-session.spec.ts`; `src/specs/task-370-concurrent-session-isolation.spec.ts`; `src/docs-screenshots/sessions.shot.ts` | `ptah-electron-e2e` typecheck/lint and source inspection for hero/footer ids, separate TTI marker. |
| 2E selectors B | `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts`; `src/showcase/chat-code-edit.scene.ts`; `src/showcase/lane-console-review.scene.ts`; `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-servers.e2e.spec.ts` | `ptah-electron-e2e`, `webview-e2e-harness` typecheck/lint; preserve each scene's empty/populated branch; Library name. |
| 3 LAST, merge-gated | After TASK_2026_593 merges, **update this branch from `main` (merge/rebase) and resolve conflicts**, then `canvas/.../orchestra-canvas.component.ts`, `.spec.ts`, `.rail.spec.ts`; delete four `canvas-needs-you-queue*.ts` implementation/spec files | Confirm merged bell coverage for attention, permissions, Allow/Deny and open-session; `@ptah-extension/canvas` scoped tests, queue absence and import search. |

All dock removal except the temporary chip proceeds before the phase 3 gate. If 593 is still unmerged when phases 1–2 finish, open a PR for phases 1–2 with the temporary chip mount; after 593 merges, sync from `main` and ship phase 3 as a second PR. Coordinate likely `chat-ui/src/index.ts` and canvas shell import conflicts. Phase 3 never edits notification-center code.

For each batch/phase run only changed projects: `npx nx run-many -t typecheck,lint,test -p <changed projects> --parallel=1`, with Jest `--maxWorkers=2` (or focused `npx jest -c <lib>/jest.config.ts <changed specs> --coverage=false --maxWorkers=2`), one heavy foreground command at a time. For selector-only projects without a test target run typecheck/lint only; never e2e. After each template batch run `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`. After each phase run `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` and require no increase. Never workspace-wide, build, serve or dev. Before closing selector migration, search for `canvas-new-session-anchor`, `Add new session tile`, `Open Marketplace Skills`, `canvas-dock`, `activity-ticker-host`; require zero hits outside deleted files, including comments.

## Acceptance and preserve-list trace

| AC | Batch | Test/review |
| --- | --- | --- |
| 1–3 create, viewport, caps | 1B, 2B–2D | Popover external/default anchor spec; board/shell/rail specs for one primary hero, secondary footer, gained height, focus/default name/final guards; selector inspection. |
| 4–5 hero/motion | 1B, 2B | Aurora spec for tokens, pause and reduced motion; later Electron theme visual review measures 4.5:1 text/3:1 controls. |
| 6–8 checklist/single-chat | 1A, 1B | Store/card/empty-state specs for truthful count, actions/failures, Ready strip, 280px, `showProjectSetup`. |
| 9 recent sessions | 2A, 2B | Store/board specs for exact top three across pinned and non-org, archived choice, filter independence, workspace switch, failed open. |
| 10 responsive/accessibility | 1A, 1B, 2B, 2C | Keyboard/ARIA specs including unchanged populated rail key handler; later Electron/VS Code visual review at 800px, wide, 280px. |
| 11 attribution | 1B, 1C | CSS/no renderer/no dependency review, full notice/scanner/asset/exclusion checks; release owner inspects packages. |
| 12 warnings/ticker | 2B, 2C | All three exact messages, dismissal/recurrence and populated board; ticker absent, service retained. |
| 13 chip gate | 3 | Merged bell action coverage, shell/rail specs, queue absence, no chip mount/import. |

Preserve `parity-inventory.md:10-37` item by item: name popover/default/focus/caps and rail footer/empty/history (rows 10–18); Skills catalog, Marketplace route, setup explanation/badges, status/retry/workspace handling, wizard and both generation workflows in shared card/store (19–26); single-chat logo/suggestions/footer/condition (27–29); approved dock space/ticker/Thoth target removals while `BackOfficeActivityService` stays (30–31); chip, permissions and queue files until merged bell parity (32–34); all three warning paths move to board notice (35–37).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Shared root-scoped setup store and existing card | Duplicate cards; component-local state | Both surfaces use the card; widget owns RPC/actions (`canvas-rail-board.component.ts:166`; `setup-status-widget.component.ts:189-284`). | Yes |
| Optional external popover anchor, defaulting to projected trigger | Move popover into board; duplicate popover | Existing position uses internal wrapper (`native-popover.component.ts:84-85,218-222`); dock trigger is removed. | Yes |
| Two bounded unfiltered history reads, deduplicate/sort | `ChatStore.sessions`; one sorted limited read | Loader spreads dialog filters (`session-loader.service.ts:529-550`); host ranks pinned first (`session-list-query.ts:82-92`), non-org ignores pin filter (`:100-110`). | Yes |
| Exclude archived on organization host | Explicitly include archived | Existing query-mode default excludes archived (`session-list-query.ts:115-119`); AC9 is silent. | Yes |
| Native UI Aurora barrel | Duplicate CSS; direct umbrella edit | Pure barrel rule (`native/index.ts:10-14`, `brand-mark-barrels.spec.ts:92`). | Yes |
| Temporary shell chip until merged bell | Remove early; retain dock | AC13 and decision #10 preserve attention actions until TASK_2026_593 merges. | Yes |

## Lane-introduced constraints

- The hand-maintained Aurora notice must pass the existing brand scanner-token static check.
- Selector closeout searches five old literals, including comments and non-spec screenshot/showcase callers.

## Gate 2 carry-forward (decision #16)

- 2E also owns `apps/ptah-docs/src/content/docs/canvas/index.md` (line 41 "Add new session tile" step rewritten for the hero and footer buttons).
- 2C removes the cap-state `tabindex`/`role=group`/label attributes from the shell popover element (`orchestra-canvas.component.ts:149-169`), places the popover out of layout flow (`floating-ui.service.ts:180`), and adds specs for both; 2C also runs `npx nx lint @ptah-extension/webview-e2e-harness --parallel=1`.
- The e2e harness Nx project name is `@ptah-extension/webview-e2e-harness`.
- Optional: drop stale comments naming removed components (`boot-progress.e2e.spec.ts:19,170`, `skeleton-block.component.ts:12`) only when the owning batch already edits that file.
