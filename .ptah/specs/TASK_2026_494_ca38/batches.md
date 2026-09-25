# Batches - TASK_2026_494

Total tasks: 19 | Batches: 19 | Complete: 1/19

Source: `implementation-plan.md` Revision 2 (Gate 2 approved 2026-09-25), "Team-leader handoff" groups G1-G19, re-ordered
where the code requires it (see Plan validation, defects D-1 to D-4). Branch `feat/task-494-apps-page` at `9afac1aa2`.
Worktree root (all paths below are absolute under it):
`D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`

Recorded defaults (the plan fixes the ordering, so no clarification was needed):

- One task per batch, one batch per plan group. Batches are committed one at a time behind review. File-disjoint
  tracks that the orchestrator MAY run concurrently (commits still land one by one): renderer track B4-B9, Apps-state
  track B10-B13, and B18 (harness) at any point after B1.
- File count: a `+spec` counts as a file. A lib scaffold produced by one `nx g` generator run counts as ONE generator
  unit (plan handoff convention); B2 is the only batch that relies on this.
- Executors never name a vendor here. "CLI lane" means one lane from what `ptah_agent_list` reports at spawn time.
  If no lane is available or a lane's quota is exhausted, the fallback executor runs the batch.
- Reviewer rule: a lane never reviews its own work. Every batch gets the code-logic-reviewer subagent. Batches marked
  "+ CLI review lane" also get a second review from a lane of a DIFFERENT vendor than the one that executed it.
- Every verification command is scoped with `-p`; output is tailed, never pasted in full.

## Plan validation

Status: PASSED WITH RISKS

Spot-checks performed against `9afac1aa2` (all confirmed unless listed as a defect):

- Apps slot comment is `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:136`, inside
  `@if (layout.hasWorkspaceFolders())` `:123`, between Chat `:125-135` and Tasks `:137-147`.
- Tags: `chat-routing` = `scope:webview`,`type:feature`; `core` = `type:core`; `shared` = `scope:shared`,`type:util`;
  `chat-state` = `type:data-access`. `eslint.config.mjs:364-381`: `type:feature` may import `type:core`; `type:ui` may
  import only `type:ui`/`type:util`, so the renderer (`type:ui`) may import `shared` and all its subpaths and may NOT
  import `core`, `chat*` or RPC. Nothing under `libs/frontend/core/src` imports `chat-routing` (no cycle for the
  inbox). `MessageHandler`/`MESSAGE_HANDLERS` are exported from core (`libs/frontend/core/src/lib/services/index.ts:21`).
  `chat-routing` has no `build` target (non-buildable), so `enforceBuildableLibDependency` is not triggered.
- `checkDynamicDependenciesExceptions` (`eslint.config.mjs:249-254`) needs no edit: the Apps lib is only imported
  dynamically from `app.routes.ts`, the eager inbox lives in the already-eager `chat-routing`.
- `@ptah-extension/shared/mcp-apps-contracts/surface` (`tsconfig.base.json:183-184`) exports every symbol the plan
  uses: `validateSurfaceDocument`, `applySurfaceOps`, `checkSurfaceSelection`, `readSurfacePath`, `checkDraftValue`,
  `collectSubmitScope`, `checkSubmitValues`, `findSurfaceAction`, `renderSurfaceText`, `describeSurfaceSelection`,
  `SURFACE_LIMITS`, `SURFACE_STORE_LIMITS` (`maxSurfacesPerRoutingId: 8`, `maxOperationClockSkewMs: 300_000`),
  `SURFACE_OPERATION_ID_PATTERN` (`/^op-[0-9]{13}-[A-Za-z0-9]{8,40}$/`, `surface-catalog.ts:76`),
  `SURFACE_INPUT_EMPTY_VALUES`.
- `@ptah-extension/shared/testing` (`tsconfig.base.json:178`) does not export the v2 fixtures yet
  (`libs/shared/src/testing/fixtures/surface.ts:10,26,42,157`); B9 adds them.
- Trust-boundary fixture `'<img src=x onerror=alert(1)><script>alert(2)</script>'` at
  `libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts:605`.
- Harness prompt filters still use `hasSurfaceTargets`/`hasSurfaceQuestionTargets`
  (`harness-builder-view.component.ts:613-623`); `targetTabsFor` `:360` and `questionTargetTabsFor` `:575` exist in
  `permission-handler.service.ts`; `_surfaceId` signal at `harness-workflow.service.ts:127`.
- `navigateToSurface` returns `'navigated'` whenever `router.navigateByUrl` resolves true, so a `canMatch`-refused
  `apps` redirected by `**` to `/chat` reports `'navigated'` (`surface-router.service.ts:116-143`); the existing
  `bootWithInitialView` helper's `surfaceNavigationLanded` assertion therefore still holds for the VS Code case.
- No prototype exists (`.ptah/specs/TASK_2026_494_ca38/prototype/` and `TASK_2026_492_0bcc/prototype/` absent); the
  visual source is `TASK_2026_492_0bcc/design-spec.md` only. See risk R10.

Plan defects found (none is a BLOCKER; each is carried by a task below, no redesign):

- D-1 `webview-routing.spec.ts` existing cases break when `'apps'` is appended. `JEST_RESOLVABLE_SURFACE_IDS`
  (`:77`) feeds (a) "never calls window.history while navigating every surface" (`:163-176`), which asserts the LAST
  surface is `'tasks'`, and (b) `it.each` "lands a %s deep link on its route" (`:261-270`), which expects `/${id}`.
  `VSCodeService` defaults `isElectron: false` (`vscode.service.ts:82`), so `apps` lands on `/chat` in both. The plan
  only says "lock-step still passes". Carried by Task 16.1.
- D-2 Component 2 is not independent of Component 1. The tab template compares `appState.currentView() === 'apps'`
  under `strictTemplates` and calls `setCurrentView('apps')`; both fail typecheck until `'apps'` is in `ViewType`.
  B17 runs after B16.
- D-3 G15 (focus-memory directive) is listed after G14, but `AppsPageComponent` (G14) hosts the directive. B14 (focus)
  now precedes B15 (page).
- D-4 The Apps-state batches import renderer types (`SurfaceRenderable`, `SurfaceInteractionState`,
  `SurfaceViewState`) from `@ptah-extension/declarative-dashboard`, but the plan exports the renderer's `src/index.ts`
  only in G8. B3 exports its types from `src/index.ts`; B8 adds the component exports.

Assumptions:

- A1 `import('@ptah-extension/mcp-apps-page')` resolves under the webview jest transform (plan verification point) —
  unverified; checked by Task 16.1 (fallback: add `apps` to `JEST_UNRESOLVABLE_SURFACES` `:75` with a justification
  like `tribunal`'s, and prove resolution elsewhere).
- A2 `globalThis.crypto.getRandomValues` exists in the jest environment — unverified; checked by Task 10.1 (fallback:
  inject the random source).
- A3 `@angular/build:application` honours `statsJson` and writes `dist/apps/ptah-extension-webview/stats.json` —
  unverified; checked by Task 19.1 (fallback: string search in initial chunks, plan D7).
- A4 jsdom render timings are a relative signal only — accepted; the report in Task 9.1 says so.
- A5 CLI lane availability: `ptah_agent_list` (2026-09-25) shows several installed CLI lanes and one ptah-cli lane;
  quota state is not reported by the list. Unverified per spawn; the fallback executor applies.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Existing webview routing loops fail once `apps` is appended (D-1) | MEDIUM | Task 16.1: drive Electron-only surfaces with `isElectron=true` in the deep-link and history loops, keep the VS Code refusal as its own test; do not delete or weaken the existing assertions |
| R2 Tab batch typechecks only after `'apps'` joins `ViewType` (D-2) | MEDIUM | B17 depends on B16 |
| R3 Page needs the focus directive (D-3) | LOW | B14 before B15 |
| R4 Apps-state needs renderer types before G8 (D-4) | MEDIUM | Task 3.1 exports types from `declarative-dashboard/src/index.ts` |
| R5 Recursive render: `SurfaceLayoutComponent` and `SurfaceNodeComponent` would import each other (ES module and standalone `imports` cycle) | MEDIUM | Task 6.1: the layout component must NOT import `SurfaceNodeComponent`; it renders its chrome and projects children (`<ng-content>`) or takes a child template. Task 8.1 composes. Reviewer checks there is no module cycle |
| R6 `trust-boundary.spec.ts` scans `mcp-apps-page/src`, which is only a scaffold at B8 (vacuous pass) | LOW | The spec is re-run in B15's and B16's verification and at completion |
| R7 VS Code host now accepts `initialView: 'apps'` (`ACCEPTED_INITIAL_VIEWS` is derived; `webview-html-generator.initial-view.spec.ts:79,142` iterates it) | LOW (intended, D2) | Task 16.1 verification includes `ptah-extension-vscode` and `@ptah-extension/core` tests |
| R8 Zod or a new lib leaks into the initial bundle | HIGH | Only the two lazy libs import `mcp-apps-contracts*`; inbox is zod-free; gate in B19 compares against `9afac1aa2` |
| R9 Reconciliation state machine (Rules 1-4, six cases) is the highest logic risk | HIGH | B11-B13 executed by a sub-agent developer, double-reviewed (code-logic-reviewer + CLI review lane), fake-timer specs |
| R10 No approved prototype exists for a NEW surface; Mode 3 requires rendered evidence against one | HIGH | Needs the user: accept `TASK_2026_492_0bcc/design-spec.md` as the visual source of truth, or commission a prototype before completion. Visual review (dark + light) runs after B17 regardless |
| R11 CLI lane quotas run out mid-batch | MEDIUM | Each CLI-lane batch names a sub-agent fallback; a lane that times out is resumed once via `resume_session_id`, then handed to the fallback |
| R12 `chat-routing/src/index.ts` doc comment understates outbound deps (already imports `chat-streaming`, `chat-types`) | LOW | Task 1.1 corrects the comment while adding `@ptah-extension/core` |

Edge cases:

- Inbox: non-object payload, missing/non-string/empty `routingId`, unclaimed id, released id, duplicate claim throws — Task 1.1
- Refused `canMatch` on VS Code for both `initialView` and `SWITCH_VIEW`, `loadComponent` never called, `currentView()==='chat'` — Task 16.1
- Tab absent without workspace folders — Task 17.1
- Unknown `schemaVersion`/`catalogVersion`, oversize by one byte, malformed, invalid selection cleared fail-closed — Task 11.1
- Eviction delete at an EQUAL revision is terminal and tombstoned; snapshot above tombstone recreates; 9th surface → read — Task 11.1
- `applyRead` never lowers a materialized revision; keeps entries pushed after the read was sent — Task 11.1
- Reconciliation cases 1-6 (result-before-echo, echo-before-result, non-conflicting agent write gap, newer push then older result, lost echo 1,500 ms, older overlay settles while newer pending) — Tasks 11.1 (1-5 at reducer level), 12.1 (5 timer level), 13.1 (all six end-to-end)
- Submit: waits for queue and echo; 30 s timeout → polling, never a second `surface:action`; 150 s / 3 failures → `unknown` — Task 13.1
- `stale-revision`: select re-sends once with a new id, change never re-sends — Task 13.1
- Op id matches `SURFACE_OPERATION_ID_PATTERN` for a fixed clock; one id per attempt — Task 10.1
- Text input: no commit per keystroke; commit on blur/Enter/600 ms; invalid draft never committed; timer cleared on destroy — Task 7.1
- Markup in every v1 and v2 text field renders literally; no `img`/`script` element — Task 8.1
- Budgets at exactly each limit (v1 six, v2 six) render without `renderFailed` — Task 9.1
- View-model builder throws → mono fallback, transcript intact — Task 15.1
- Sort/filter/page → zero RPC and zero `postMessage` calls — Task 15.1
- Workspace switch shows the other slice; state survives component destroy/re-create — Tasks 12.1, 15.1

## Batch 1: SurfaceUpdateInbox (eager) — COMPLETE

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer (eager path, drop rules, Req 3.2/3.3)
- Execution mode: sequential
- Rationale: small, fully specified, self-contained contract (D3 code block); one prompt can carry it.
- Tasks: 1 | Depends on: none

### Task 1.1: Generic routing-id inbox and its eager registration — COMPLETE

- Files (5):
  - CREATE `.../libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts`
  - CREATE `.../libs/frontend/chat-routing/src/lib/surface-update-inbox.service.spec.ts`
  - MODIFY `.../libs/frontend/chat-routing/src/index.ts`
  - MODIFY `.../apps/ptah-extension-webview/src/app/app.config.ts`
  - CREATE `.../apps/ptah-extension-webview/src/app/surface-message-routing.spec.ts`
  (`...` = the worktree root above)
- Plan reference: implementation-plan.md:174-214 (D3), 359-385 (Component 3)
- Pattern to follow: `libs/frontend/chat-routing/src/lib/workflow-session-claim.service.ts:4-29`; registration
  `app.config.ts:170`; routing spec precedent `apps/ptah-extension-webview/src/app/thoth-message-routing.spec.ts`
- Quality requirements: zod-free; imports only `@angular/core`, `MessageHandler` type from `@ptah-extension/core`,
  `MESSAGE_TYPES` from `@ptah-extension/shared`; listener receives `unknown`; plain `Map`, no signal, no timers.
- Validation notes: R12 (fix the index doc comment's outbound-deps line); R8 (no zod import).
- Implementation details: `@Injectable({providedIn:'root'}) SurfaceUpdateInbox implements MessageHandler` with
  `handledMessageTypes = [MESSAGE_TYPES.SURFACE_UPDATED] as const`, `claim/release/isClaimed`; add
  `{ provide: MESSAGE_HANDLERS, useExisting: SurfaceUpdateInbox, multi: true }` beside `:170`.

### Batch 1 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat-routing ptah-extension-webview`
- Specs pin: every drop rule calls no listener; claimed id calls exactly its listener with the same object; release
  drops; duplicate claim throws; app-level: the inbox is the ONLY `surface:updated` handler and NO handler exists for
  `dashboard:spec-proposed`.

### Batch 1 outcome

- Executor: CLI lane (1 round, no fix rounds). Reviewer: code-logic-reviewer, APPROVED 8/10, 0 blocking
  (`code-logic-review.md`, Batch 1 revision).
- Verification re-run by team-leader with `--skip-nx-cache`: 6/6 targets green.
- Non-blocking spec-rigor notes carried forward (no production defect): (M1) non-string/empty `routingId` drop tests
  cannot falsify their guard because a `Map` miss yields the same outcome; (M2) the matcher self-test in
  `surface-message-routing.spec.ts:286-296` does not call `handlerDeclarationsFor`; (M3) the source sweep reads
  `libs/frontend/**`, outside the webview test target's Nx cache inputs. Revisit when B12 adds the first consumer.

## Batch 2: Lib scaffolds and path mapping — IN_PROGRESS

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-style-reviewer (tags, boundaries, strict tsconfig, non-buildable, naming) + code-logic-reviewer
- Execution mode: sequential
- Rationale: generator run plus tag/tsconfig decisions that set module boundaries for everything after it.
- Tasks: 1 | Depends on: none

### Task 2.1: Scaffold `declarative-dashboard` and `mcp-apps-page` — IN_PROGRESS

- Files (2 generator units + 1):
  - CREATE `.../libs/frontend/declarative-dashboard/` (`project.json`, `tsconfig.json`, `tsconfig.lib.json`,
    `tsconfig.spec.json`, `jest.config.ts`, `eslint.config.mjs`, `src/test-setup.ts`, `src/index.ts`)
  - CREATE `.../libs/frontend/mcp-apps-page/` (same file set)
  - MODIFY `.../tsconfig.base.json` (two paths; NO `/services` path)
- Plan reference: implementation-plan.md:263-276 (D6), 872-885 (Component 12)
- Pattern to follow: `libs/frontend/harness-builder/{project.json,tsconfig.json,jest.config.ts,eslint.config.mjs}`
- Quality requirements: names `@ptah-extension/declarative-dashboard` (`scope:webview`,`type:ui`,`platform:angular`)
  and `@ptah-extension/mcp-apps-page` (`scope:webview`,`type:feature`,`platform:angular`); `"strict": true`; no
  `build` target; `test`, `lint`, `typecheck` (ngc `--noEmit`) targets like harness-builder; `eslint.config.mjs` at
  the root NOT edited.
- Validation notes: R8. `platform:angular` is an existing tag (e.g. `libs/frontend/dashboard/project.json`).
- Implementation details: `src/index.ts` of each starts empty (`export {};`). Delete any generator sample component.

### Batch 2 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page --passWithNoTests`
- `npx nx show projects --projects "@ptah-extension/declarative-dashboard,@ptah-extension/mcp-apps-page" --json` shows both.

## Batch 3: Renderer view-state, interaction types and v1 view model — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: pure types and a pure builder with a spec; well specified by Revision 1 behaviour.
- Tasks: 1 | Depends on: Batch 2

### Task 3.1: Types and `buildDashboardViewModel` — PENDING

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/`: `surface-view-state.ts`,
  `surface-interaction.ts`, `view-model/view-model.types.ts`, `view-model/dashboard-view-model.ts` (+ `.spec.ts`);
  MODIFY `.../libs/frontend/declarative-dashboard/src/index.ts` (type exports)
- Plan reference: implementation-plan.md:725-750, 263-270
- Pattern to follow: pure-module style of `libs/shared/src/mcp-apps-contracts/surface-bindings.ts`
- Quality requirements: node union `LayoutNode | InputNode | DisplayNode`, each with `selectable` (true only with
  `dashboard.select`); v1 `children` up to `DASHBOARD_LIMITS.maxTreeDepth`; `SURFACE_PAGE_SIZE = 25`;
  `SurfaceRenderable` mirrors `SurfaceContent` (`surface.types.ts:187-196`).
- Validation notes: D-4/R4 — export `SurfaceRenderable`, `SurfaceViewState`, `SurfaceComponentViewState`,
  `SurfaceInteractionState`, `SurfaceInputCommit`, `SurfaceActionInvoke`, `SurfaceSelectionChange`,
  `SURFACE_PAGE_SIZE` now.
- Implementation details: imports only `@ptah-extension/shared` and `@ptah-extension/shared/mcp-apps-contracts`.

### Batch 3 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 4: Table rows, chart geometry, chart component — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: two pure modules plus one component; independent of the Apps track.
- Tasks: 1 | Depends on: Batch 3

### Task 4.1: `table-rows.ts`, `chart-geometry.ts`, `DashboardChartComponent` — PENDING

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/`: `table/table-rows.ts` (+ spec),
  `charts/chart-geometry.ts` (+ spec), `components/dashboard-chart.component.ts` (+ spec)
- Plan reference: implementation-plan.md:258-261 (D5), 776-786; task-description Req 4.1, 4.4, 5.1-5.3, 7.3, 7.4
- Pattern to follow: OnPush standalone signal components in `libs/frontend/harness-builder/src/lib/components/`
- Quality requirements: hand-rolled inline SVG, no chart dependency; polylines only for 5,000 points; chart-as-table
  toggle with `aria-pressed`; each series has a direct label or pattern; sort cycles asc/desc/original; filter over
  visible text; `data` reference shows the "not available" notice with `rowCount`; no `text-base-content/NN`.
- Validation notes: CSP — inline SVG only, no `style` injection that the shell CSP would refuse.

### Batch 4 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 5: Stat, list and pager — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 4

### Task 5.1: `DashboardStatComponent`, `DashboardListComponent`, `DashboardPagerComponent` — PENDING

- Files (5): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/components/`: `dashboard-stat.component.ts`
  (+ spec), `dashboard-list.component.ts` (+ spec), `dashboard-pager.component.ts`
- Plan reference: implementation-plan.md:776-779; Req 4.1, 4.5, 5.2, 5.3, 7.1, 7.2, 7.5
- Quality requirements: list `ordered`, `detail` secondary line, `url` as plain text (not a link); pager prev/next
  keyboard-reachable with "page X of Y" text; selection affordance only when `selectable`; expansion via icon button
  "Expand/Collapse {title}" with `aria-expanded`, `Escape` returns focus; coloured text on neutral surface only.

### Batch 5 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 6: v2 view model, table component, layout component — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: carries the recursion design decision (R5) and the v2 data binding.
- Tasks: 1 | Depends on: Batch 5

### Task 6.1: `buildSurfaceViewModel`, `DashboardTableComponent`, `SurfaceLayoutComponent` — PENDING

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/`: `view-model/surface-view-model.ts`
  (+ spec), `components/dashboard-table.component.ts` (+ spec), `components/surface-layout.component.ts` (+ spec)
- Plan reference: implementation-plan.md:749-763, 776-779
- Quality requirements: host value from `readSurfacePath`; read failure → `SURFACE_INPUT_EMPTY_VALUES` + draft error;
  table scroll viewport, ≤ 25 rows in DOM, `aria-sort`; layout section/card/stack/grid per the plan (grid ≤ 4 cols,
  one column below `sm`); `surface.submit` renders as `btn btn-primary btn-sm` disabled while `submitDisabled` or
  pending, with state text in `role="status"`.
- Validation notes: R5 — `SurfaceLayoutComponent` must not import `SurfaceNodeComponent`; children arrive by content
  projection or a template input.
- Spec pins: missing path → empty value; shared path → same value; `selectable` only with `dashboard.select`.

### Batch 6 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 7: Input components — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: three sibling components with an exact behavioural spec (commit rules, a11y attributes).
- Tasks: 1 | Depends on: Batch 6

### Task 7.1: Text, choice and checkbox inputs — PENDING

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/components/`:
  `surface-text-input.component.ts` (+ spec), `surface-choice-input.component.ts` (+ spec),
  `surface-checkbox-input.component.ts` (+ spec)
- Plan reference: implementation-plan.md:764-775
- Quality requirements: `<label for>`, `aria-required`, `aria-invalid`, `aria-describedby`; displayed value
  `drafts[id] ?? pendingValues.get(path) ?? hostValue`; `checkDraftValue` gate; one debounce timer per instance,
  cleared on commit and in `DestroyRef`; select has an empty "—" option mapping to `null`; radio-group uses
  `fieldset` + `legend`; `data-apps-focus-key` on every control.
- Spec pins (fake timers): no `inputCommit` per keystroke; commit on blur, Enter and 600 ms; invalid draft never
  committed; unchanged value not committed; timer cleared on destroy.

### Batch 7 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 8: Node, renderer, public API, trust boundary — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane (security half of the trust boundary)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 7

### Task 8.1: `SurfaceNodeComponent`, `SurfaceRendererComponent`, exports, `trust-boundary.spec.ts` — PENDING

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/`: `components/surface-node.component.ts`
  (+ spec), `components/surface-renderer.component.ts` (+ spec), `trust-boundary.spec.ts`; MODIFY
  `.../libs/frontend/declarative-dashboard/src/index.ts`
- Plan reference: implementation-plan.md:727-740, 753-818
- Quality requirements: `@switch` over all 13 kinds, `@default` renders nothing and emits `renderFailed`;
  `SURFACE_VIEW_MODEL_BUILDER` root token defaulting to the pure builder; builder throw → empty subtree +
  `renderFailed`; only `surface.submit` and `dashboard.select` are controls; no `innerHTML`, `bypassSecurityTrust`,
  `DomSanitizer`, `<iframe`, or `@ptah-extension/markdown` import.
- Validation notes: R5 (node composes layout; verify no import cycle); R6 (scan of `mcp-apps-page/src` is vacuous now).
- Spec pins (trust boundary, R8): the 538 fixture rendered into surface title/description, section and card
  title/description, input label, option labels, placeholder, text description, action label, a bound data-model
  string in a text input, every v1 display text field, submit issue messages and `detail` notices — each literal,
  with zero `img` and `script` elements; comment-stripped source scan of both new libs; every non-submit, non-select
  action renders no enabled control.

### Batch 8 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`

## Batch 9: Budget confirmation — PENDING

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: measurement plus a contract-doc decision; the tester owns the evidence.
- Tasks: 1 | Depends on: Batch 8

### Task 9.1: `budget-render.spec.ts`, v2 fixtures on the testing barrel, budget doc comments, report — PENDING

- Files (5): CREATE `.../libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts`; MODIFY
  `.../libs/shared/src/testing/index.ts`, `.../libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts`,
  `.../libs/shared/src/mcp-apps-contracts/surface-catalog.ts`; CREATE
  `.../.ptah/specs/TASK_2026_494_ca38/budget-render-report.md`
- Plan reference: implementation-plan.md:841-870; Req 8
- Quality requirements: v1 cases (200 components, depth 8, 1,000 rows, 50 columns, 5,000 points, exactly
  `maxSpecBytes`) and v2 cases (`maxInputs` 100, `maxOptions` 50 on select and radio-group, `maxChildrenPerNode` 50,
  `maxGridColumns` 4, `maxDataModelBytes`, `maxSurfaceBytes`); each first accepted by its validator (at, not over, the
  limit), then rendered with no `renderFailed`, timings logged.
- Validation notes: A4. A budget that fails is lowered in its one constant with the measurement as reason; the
  renderer is not special-cased. `surface-budgets.spec.ts` and `dashboard-budgets.spec.ts` pass unchanged.

### Batch 9 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/shared`

## Batch 10: Apps pure state — operation ids and overlays — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 3

### Task 10.1: `surface-operation-id.ts`, `apps-operation-overlays.ts` — PENDING

- Files (4): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/state/`: `surface-operation-id.ts` (+ spec),
  `apps-operation-overlays.ts` (+ spec)
- Plan reference: implementation-plan.md:523-531, 574-582
- Quality requirements: `op-${now}-${16 alnum}` from `crypto.getRandomValues`, matches
  `SURFACE_OPERATION_ID_PATTERN` for a fixed clock; overlays keyed by operation id in send order; displayed value =
  latest unretired overlay per path; `retire`, `retireSettledUpTo`, retire-all-settled on read.
- Validation notes: A2 (inject the random source if jest lacks `crypto.getRandomValues`).

### Batch 10 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`

## Batch 11: Intake, reducer, system prompt — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: the revision state machine (R9); needs judgment on edge ordering.
- Tasks: 1 | Depends on: Batch 10

### Task 11.1: `apps-surface-intake.ts`, `apps-surface-reducer.ts`, `apps-system-prompt.ts` — PENDING

- Files (6): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/`: `state/apps-surface-intake.ts` (+ spec),
  `state/apps-surface-reducer.ts` (+ spec), `apps-system-prompt.ts` (+ spec)
- Plan reference: implementation-plan.md:404-453, 482-494, 236-244, 504-505; handoff-494.md (a) item 2, (c)
- Quality requirements: pure, never throws; structural zod-free guard; whole-document re-validation fail-closed;
  selection cleared (not surface rejected) when `checkSurfaceSelection` fails; `console.warn` without payload values.
- Spec pins: guard accept/reject; v2 and v1 accepted and rejected (unknown versions, oversize by one byte, malformed);
  snapshot atomic replace and view-state reset; ops from matching `fromRevision`; ops failure → `needsRead`;
  post-ops re-validation failure → fallback; gap → `needsRead`; eviction at EQUAL revision terminal + tombstone;
  later snapshot above tombstone recreates; agent delete; 9th surface → `needsRead`; `applyRead` never lowers a
  revision and keeps entries pushed after the read; reconciliation cases 1-5 at reducer level; prompt names
  `ptah_surface_update`, `ptah_surface_get_state`, `ptah_dashboard_propose_spec` and does not contain
  `SYSTEM CONTEXT - DASHBOARD SELECTION`.

### Batch 11 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`

## Batch 12: Session facade, workspace slices, surface sync — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 1, 11

### Task 12.1: `apps-workspace-slice.ts`, `AppsSurfaceSync`, `AppsSessionService` — PENDING

- Files (5): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/services/`: `apps-workspace-slice.ts`,
  `apps-surface-sync.ts` (+ spec), `apps-session.service.ts` (+ spec)
- Plan reference: implementation-plan.md:142-158 (D1), 174-214 (D3), 387-513
- Pattern to follow: `libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:271-471`;
  `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:144-168`
- Quality requirements: `inbox.claim` before `chat:start`; rollback and `discard()` release inbox, claims, surface and
  sync; one read in flight per slice with coalescing; 10 s read timeout; one grace timer per slice (1,500 ms),
  cleared on catch-up and `dispose()`; each file ≤ 700 lines.
- Spec pins: `isInteractive` true after start; `getAdapter` null and inbox released after `discard()`; no
  `TabManagerService` mutation; workspace switch shows the other slice; push for another routing id never reaches the
  slice; state survives destroy/re-create; sync: coalescing, grace read fires exactly once (case 5), no timer after
  `dispose()`.

### Batch 12 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`

## Batch 13: UI mutations and submit flow — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: Rules 1-4, polling and all six reconciliation cases (R9).
- Tasks: 1 | Depends on: Batch 12

### Task 13.1: `AppsSurfaceOperations`, `AppsSubmitFlow` — PENDING

- Files (4): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/services/`: `apps-surface-operations.service.ts`
  (+ spec), `apps-submit-flow.ts` (+ spec)
- Plan reference: implementation-plan.md:514-646
- Quality requirements: never throws; one in-flight mutation per surface; base = materialized revision; queue
  coalescing; transport failure vs host refusal distinguished by `errorCode`; never resends; one poll timer per slice
  (3 s, 10 s per call, stop at 150 s or 3 failures → `unknown`); no `chat:*` call from any mutation.
- Spec pins (real reducer, scripted `MockRpc` and pushes): reconciliation cases 1-6; submit waits for queue and
  echo; 30 s timeout → polling, no second `surface:action`; `stale-revision` select re-sends once with a new id,
  change does not; Req 6.6 unsynced selection notice; zero `chat:start`/`chat:continue`.

### Batch 13 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`

## Batch 14: Focus-memory directive — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 12

### Task 14.1: `apps-focus-memory.directive.ts` — PENDING

- Files (2): CREATE `.../libs/frontend/mcp-apps-page/src/lib/components/apps-focus-memory.directive.ts` (+ spec)
- Plan reference: implementation-plan.md:142-158, 654, 687; Req 7.6
- Quality requirements: records `data-apps-focus-key` of the last focused control in the slice; on init restores to
  that control if it exists and is focusable, else focuses the host (`tabindex="-1"`).

### Batch 14 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`

## Batch 15: Apps page components and public API — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + code-style-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 8, 13, 14

### Task 15.1: `AppsPageComponent`, `AppsTranscriptComponent`, `AppsSurfacePanelComponent`, `src/index.ts` — PENDING

- Files (6): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/components/`: `apps-page.component.ts` (+ spec),
  `apps-transcript.component.ts`, `apps-surface-panel.component.ts` (+ spec); MODIFY
  `.../libs/frontend/mcp-apps-page/src/index.ts` (export `AppsPageComponent`, `AppsSessionService`)
- Plan reference: implementation-plan.md:648-693
- Pattern to follow: `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:297-313, 566-600`
- Quality requirements: holds no state; prompts filtered with `targetTabsFor(id).includes(surfaceId)` and the
  question twin; transcript via `ExecutionTreeBuilderService.buildTree(state, 'apps:' + surfaceId)`; switcher
  `role="tablist"` when > 1 surface; rejected → `font-mono` "This app could not be shown." + reason; `renderFailed` →
  `renderDashboardSpecText` (v1) or `renderSurfaceText` (v2); notices `role="status"`.
- Spec pins: empty state; only this surface's prompts; rejected → mono fallback with transcript; builder override
  throws → mono fallback, no renderer subtree; destroy/re-create restores transcript, surfaces, view state, overlays;
  sort/filter/page → zero `ClaudeRpcService.call` and zero `VSCodeService.postMessage`; switcher with two surfaces;
  agent snapshot activates its surface; eviction notice.

### Batch 15 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page @ptah-extension/declarative-dashboard`
  (re-runs `trust-boundary.spec.ts` against the now-populated Apps lib, R6)

## Batch 16: Surface id, route and Electron-only guard — PENDING

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: restructures existing routing specs (D-1) without weakening them; resolves A1.
- Tasks: 1 | Depends on: Batch 15

### Task 16.1: `'apps'` id, `apps` route, `electronOnlySurface` guard, routing specs — PENDING

- Files (5): MODIFY `.../libs/shared/src/lib/types/webview-surface.types.ts`,
  `.../libs/shared/src/lib/types/webview-surface.types.spec.ts`,
  `.../apps/ptah-extension-webview/src/app/app.routes.ts`,
  `.../apps/ptah-extension-webview/src/app/webview-routing.spec.ts`; CREATE
  `.../apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts`
- Plan reference: implementation-plan.md:160-172 (D2), 306-333
- Quality requirements: `'apps'` appended after `'tasks'` in `ViewType` and `SURFACE_ROUTE_IDS` only (no second
  list); route after `tasks`, before fallbacks, with `canMatch: [electronOnlySurface]`, `SURFACE_ACTIVE`, lazy
  `loadComponent`; doc-comment line for `apps`.
- Validation notes: D-1/R1 — `:163-176` and `:261-270` must keep covering every surface: run Electron-only ids with
  `isElectron=true` (or split the loop), never drop `apps` silently; A1 (jest resolvability); R7.
- Spec pins: lock-step and host allow-list tests pass; `isElectron=false`: `initialView='apps'` and
  `SWITCH_VIEW {view:'apps'}` land on `/chat`, `currentView()==='chat'`, `loadComponent` spy never called;
  `isElectron=true`: both land on `/apps`.

### Batch 16 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/shared ptah-extension-webview @ptah-extension/core ptah-extension-vscode`

## Batch 17: Electron shell Apps tab — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer (then visual-reviewer on the running Electron build, dark + light, before completion)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 16 (D-2)

### Task 17.1: Apps tab button — PENDING

- Files (2): MODIFY `.../libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`; CREATE
  `.../libs/frontend/chat/src/lib/components/templates/electron-shell.apps-tab.spec.ts`
- Plan reference: implementation-plan.md:335-357
- Pattern to follow: Tasks button `electron-shell.component.ts:137-147`; spec stubs
  `electron-shell.config-gate.spec.ts:74-129`
- Quality requirements: replace ONLY the comment at `:136`; add `AppWindow` icon import and `openApps()`; nothing
  else moves.
- Spec pins: order Chat, Apps, Tasks, Tribunal, Analytics; absent without workspace folders; click calls
  `setCurrentView('apps')`; `aria-selected` follows `currentView`; existing config-gate and activity-placement specs
  green.

### Batch 17 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/chat`

## Batch 18: Harness prompt isolation — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: independent of every other batch; may run at any time.
- Tasks: 1 | Depends on: none

### Task 18.1: Filter harness prompts by its own surface id — PENDING

- Files (3): MODIFY `.../libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`,
  `.../libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`; CREATE
  `.../libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts`
- Plan reference: implementation-plan.md:712-723
- Quality requirements: expose `readonly surfaceId = this._surfaceId.asReadonly()`; replace `hasSurfaceTargets` /
  `hasSurfaceQuestionTargets` filters at `:613-623` with `targetTabsFor(id).includes(surfaceId)` /
  `questionTargetTabsFor`; a null surface id shows no prompts.
- Spec pins: a prompt targeted at another surface id does not render in the harness view; existing
  `harness-builder-view.component.spec.ts` green.

### Batch 18 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-builder`

## Batch 19: Lazy-load gate — PENDING

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer (evidence review of the gate file)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 1-18

### Task 19.1: `lazy-load-gate.md` — PENDING

- Files (1): CREATE `.../.ptah/specs/TASK_2026_494_ca38/lazy-load-gate.md`
- Plan reference: implementation-plan.md:278-302 (D7)
- Quality requirements: production build on this branch and in a throwaway worktree at `9afac1aa2` (removed after);
  both "Initial total" lines and initial chunk tables; `--stats-json` attribution: no input from the two new libs,
  `libs/shared/src/mcp-apps-contracts/surface*.ts`, `dashboard-spec.schemas.ts`, `dashboard-spec.validator.ts`,
  `dashboard-text-fallback.ts` in any initial output; `node_modules/zod` initial inputs identical to base; every
  eager byte attributed to the named additions only; Req 9.2 Electron DevTools screenshot.
- Validation notes: A3 (string-search fallback); R8.

### Batch 19 verification

- `npx nx build ptah-extension-webview --configuration=production` (both trees)
- Also green: `apps/ptah-electron/src/windows/shell-csp.spec.ts` unchanged and
  `apps/ptah-extension-webview/src/app/no-alpha-base-content.spec.ts`
  (`npx nx run-many -t test -p ptah-electron ptah-extension-webview`)

## Completion prerequisites (Mode 3)

- Parity: N/A — no existing surface is replaced, consolidated, rebuilt or redesigned (the Apps page is new; the
  shell edit replaces one comment).
- Write-path trace: N/A for persisted settings — 494 writes no settings or storage; host surface state is in-memory
  and written through 538's existing RPCs.
- Rendered visual evidence (dark + light) from visual-reviewer on the Electron build, against the visual source of
  truth the user confirms (R10).
- Manual QA items A2 (surface-tool permission prompt), Req 9.2 screenshot, tool-result rendering, and the
  `ptah_surface_get_state` follow-through (plan "Open manual QA items").
