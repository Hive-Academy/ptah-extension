# Batches - TASK_2026_494

Total tasks: 20 | Batches: 20 | Complete: 16/20

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
- The prototype was approved 2026-09-25 (`.ptah/specs/TASK_2026_494_ca38/prototype/`: `index.html`, `states.html`,
  `README.md`, screenshots; committed with Batch 2) and is the visual source of truth. Resolves risk R10.

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
- A2 `globalThis.crypto.getRandomValues` exists in the jest environment — VERIFIED by Task 10.1 (default-source specs
  pass un-injected); the random byte source stays injectable regardless.
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
| R10 No approved prototype existed for a NEW surface; Mode 3 requires rendered evidence against one | HIGH | RESOLVED 2026-09-25: prototype approved (`prototype/`). Visual review (dark + light) against it runs after B17 |
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

## Batch 1: SurfaceUpdateInbox (eager) — COMPLETE (commit c9b6eddd2)

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

## Batch 2: Lib scaffolds and path mapping — COMPLETE (commit b66ee50b6)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-style-reviewer (tags, boundaries, strict tsconfig, non-buildable, naming) + code-logic-reviewer
- Execution mode: sequential
- Rationale: generator run plus tag/tsconfig decisions that set module boundaries for everything after it.
- Tasks: 1 | Depends on: none

### Task 2.1: Scaffold `declarative-dashboard` and `mcp-apps-page` — COMPLETE

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

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard @ptah-extension/mcp-apps-page`
  (the `--passWithNoTests` flag was dropped: `nx.json` targetDefaults for `@nx/jest:jest` already set
  `passWithNoTests: true`, and the CLI flag is forwarded by `nx:run-commands` into `ngc`, failing with TS5023. The
  `typecheck` target therefore stays identical to harness-builder, without `forwardAllArgs: false`.)
- `npx nx show projects --projects "@ptah-extension/declarative-dashboard,@ptah-extension/mcp-apps-page" --json` shows both.

### Batch 2 outcome

- Executor: frontend-developer (copied harness-builder config; no generator sample to delete). 1 fix round.
- Reviews: code-style-reviewer NEEDS_REVISION 7/10 (1 blocking: `typecheck` used `forwardAllArgs: false`), then fixed;
  code-logic-reviewer APPROVED 9/10 (same item as minor). Team-leader ruling: revert to harness-builder's plain
  `command` and drop `--passWithNoTests` from the verification command (`nx.json` targetDefaults already set it).
  Post-fix `project.json` diffs against harness-builder only in the tags; verification re-run with `--skip-nx-cache`:
  6/6 targets green. Style minor (manual copy instead of `nx g`) accepted: output is equivalent and Nx discovers both.
- Prototype (approved 2026-09-25) committed with this batch. B15 notes added; splitter split out as Batch 20.

## Batch 3: Renderer view-state, interaction types and v1 view model — COMPLETE (commit 3bc8fbb4d)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: pure types and a pure builder with a spec; well specified by Revision 1 behaviour.
- Tasks: 1 | Depends on: Batch 2

### Task 3.1: Types and `buildDashboardViewModel` — COMPLETE

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

### Batch 3 outcome

- Executor: CLI lane (1 round, no fix rounds; a first lane failed at spawn and wrote nothing). Reviewer:
  code-logic-reviewer, APPROVED 8/10, 0 blocking (`code-logic-review.md`, Batch 3 section).
- Verification re-run by team-leader with `--skip-nx-cache`: 3/3 targets green, 17/17 tests.
- D-4/R4 resolved: renderer types and `SURFACE_PAGE_SIZE` exported from `declarative-dashboard/src/index.ts`.
- Non-blocking note carried to B6: `mapDisplayNode` (`dashboard-view-model.ts:62-79`) shape-checks `stat`/`table` but
  not `list.items` or chart `series`; the v1 validator is the real boundary. B6 may tighten it when the v2 builder
  reuses the mapper.

## Batch 4: Table rows, chart geometry, chart component — COMPLETE (commit 9c3606bff)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: two pure modules plus one component; independent of the Apps track.
- Tasks: 1 | Depends on: Batch 3

### Task 4.1: `table-rows.ts`, `chart-geometry.ts`, `DashboardChartComponent` — COMPLETE

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
- Result: 3/3 green (re-run by team-leader). code-logic-reviewer APPROVED 7/10. Fix round 1 (codex resume) added
  prototype hue plus pattern: stroke-/fill- series classes, a solid first bar series, per-instance hatch patterns and rect
  bar legends. It also made the mixed-type sort a total order. Re-check APPROVED 8/10 (code-logic-review-batch-4.md).
- Carried forward (non-blocking): duplicate x within one series overlaps (chart-geometry.ts:20-21); in descending sort
  nulls come first (full mirror of ascending). Rendered-fidelity evidence is still owed at the R10 visual gate.

## Batch 5: Stat, list and pager — COMPLETE (commit 62a764f92)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 4

### Task 5.1: `DashboardStatComponent`, `DashboardListComponent`, `DashboardPagerComponent` — COMPLETE

- Files (5): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/components/`: `dashboard-stat.component.ts`
  (+ spec), `dashboard-list.component.ts` (+ spec), `dashboard-pager.component.ts`
- Plan reference: implementation-plan.md:776-779; Req 4.1, 4.5, 5.2, 5.3, 7.1, 7.2, 7.5
- Quality requirements: list `ordered`, `detail` secondary line, `url` as plain text (not a link); pager prev/next
  keyboard-reachable with "page X of Y" text; selection affordance only when `selectable`; expansion via icon button
  "Expand/Collapse {title}" with `aria-expanded`, `Escape` returns focus; coloured text on neutral surface only.

### Batch 5 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`
- Result: 3/3 green (re-run by team-leader). code-logic-reviewer APPROVED 8/10, 0 blocking, no fix rounds
  (code-logic-review-batch-5.md). B3/B4 carry-overs confirmed: defensive list items, per-instance ids, original index
  across paging and filtering.
- Carried to the R10 visual gate: stat density (text-lg/p-3 vs the prototype's compact tile) and delta phrasing. A
  uniform text-primary is correct because the contract has no tone field.
- Optional (non-blocking): Escape in the list filter also collapses the list; list filtering duplicates the table-rows
  filter shape.
- Carried to B8: an IDE-only TS4029 ("DisplayNodeFields cannot be named", view-model.types.ts:14) appears only under
  declaration emit. The lib has no build target today; export DisplayNodeFields if B8 adds one or the public API
  exposes these node types.

## Batch 6: v2 view model, table component, layout component — COMPLETE (commit db10e82aa)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: carries the recursion design decision (R5) and the v2 data binding.
- Tasks: 1 | Depends on: Batch 5

### Task 6.1: `buildSurfaceViewModel`, `DashboardTableComponent`, `SurfaceLayoutComponent` — COMPLETE

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
- Result: 3/3 green (re-run by team-leader), 74 tests. code-logic-reviewer APPROVED 8/10
  (code-logic-review-batch-6.md); Glm review lane APPROVED 8/10 (code-logic-review-batch-6-glm.md). No fix rounds.
  R5 is met: the layout takes children via a TemplateRef input and imports only NgTemplateOutlet.
- Deviations accepted by both reviewers:
  1. A missing path gives the empty value with NO draft error. Only a read failure (ok:false) or a wrong type gives
     one. This is correct per plan:751-753, handoff (c) and surface-data-model.ts:74-97; the B6 brief's pin was
     imprecise.
  2. buildSurfaceViewModel never throws and returns a renderFailed union; v1 content goes to the v1 builder unchanged.
  3. The submit status is neutral text, not the prototype's green "Sent". Table rows use aria-pressed on a Select
     button (the table is not role=grid).
  4. no-non-null-assertion warnings, in the specs only.
- Carried to B8: the renderer must give identical behaviour whether a SURFACE_VIEW_MODEL_BUILDER override throws or
  the default returns renderFailed.
- Carried to the R10 visual gate: the "Sent" status colour.
- Optional: a direct spec for applied -> "Sent"; the unreachable `read.value === undefined` branch at
  surface-view-model.ts:67.

## Batch 7: Input components — COMPLETE (commit 60a2bf643)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: three sibling components with an exact behavioural spec (commit rules, a11y attributes).
- Tasks: 1 | Depends on: Batch 6

### Task 7.1: Text, choice and checkbox inputs — COMPLETE

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
- Result: 3/3 green (the team-leader re-ran it with `--skip-nx-cache`). 12 suites, 125 tests. Lint: 0 errors.
- Round 1:
  - code-logic-reviewer 8/10 (code-logic-review-batch-7.md).
  - codex lane 6/10 NEEDS_REVISION (code-logic-review-batch-7-codex.md): F1-F3.
- Fix round 1 (batch-7-fix-1-report.md):
  - F1: a consumed-draft marker.
  - F2: stale typed text is dropped.
  - F3: validation runs against the sanitized options.
- Round 2, both APPROVED 8/10:
  - code-logic-reviewer (code-logic-review-batch-7-round-2.md).
  - codex lane (code-logic-review-batch-7-round-2-codex.md).
- Carried to B8. These are listed in Task 8.1 validation notes.

## Batch 8: Node, renderer, public API, trust boundary — COMPLETE (commit 6f5321476)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane (security half of the trust boundary)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 7

### Task 8.1: `SurfaceNodeComponent`, `SurfaceRendererComponent`, exports, `trust-boundary.spec.ts` — COMPLETE

- Files (6): CREATE under `.../libs/frontend/declarative-dashboard/src/lib/`: `components/surface-node.component.ts`
  (+ spec), `components/surface-renderer.component.ts` (+ spec), `trust-boundary.spec.ts`; MODIFY
  `.../libs/frontend/declarative-dashboard/src/index.ts`
- Plan reference: implementation-plan.md:727-740, 753-818
- Quality requirements: `@switch` over all 13 kinds, `@default` renders nothing and emits `renderFailed`;
  `SURFACE_VIEW_MODEL_BUILDER` root token defaulting to the pure builder; builder throw → empty subtree +
  `renderFailed`; only `surface.submit` and `dashboard.select` are controls; no `innerHTML`, `bypassSecurityTrust`,
  `DomSanitizer`, `<iframe`, or `@ptah-extension/markdown` import.
- Validation notes: R5 (node composes layout; verify no import cycle); R6 (scan of `mcp-apps-page/src` is vacuous now).
- B6/B7 carry-overs (must be handled in B8):
  - (a) The renderer writes every input `draftChange` (write and removal) into `viewState.drafts` synchronously, before
    it passes the next `drafts` object. The B7 F2 stale guard depends on this. Install the pending overlay before the
    committed draft is discarded.
  - (b) Extract the label/error/issue helpers that the three input components duplicate into one shared helper.
  - (c) Add a channel that surfaces host rejections of a commit to the input, so it is not a silent revert.
  - (d) A throwing `SURFACE_VIEW_MODEL_BUILDER` and a default `renderFailed` behave identically.
  - (e) Fix TS4029 at `dashboard-list.component.ts:81`, `dashboard-stat.component.ts:42` and
    `dashboard-table.component.ts:95`.
  - (f) `@for` tracking must stay correct when the document carries duplicate ids.
  - (g) When a node is swapped to another component, the renderer removes the old draft entry.
- Scope note (team-leader, 2026-09-25): (b) and (e) take B8 past the 6-file cap:
  - one new shared helper file (+ spec);
  - the three input components rewired to it;
  - three TS4029 edits.

  These were directed by the coordinator as B8 carry-overs. Everything stays in one lib, so the batch keeps its one
  verification command. The coordinator confirmed on 2026-09-25 that B8 is not split. The reviewers treat the helper
  move and the TS4029 edits as behaviour-preserving, and check them against the diff. Their review focus is the
  renderer and the trust boundary.
- Spec pins (trust boundary, R8): the 538 fixture rendered into surface title/description, section and card
  title/description, input label, option labels, placeholder, text description, action label, a bound data-model
  string in a text input, every v1 display text field, submit issue messages and `detail` notices — each literal,
  with zero `img` and `script` elements; comment-stripped source scan of both new libs; every non-submit, non-select
  action renders no enabled control.

### Batch 8 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard`
- Result: the team-leader re-ran it with `--skip-nx-cache` and all 3 targets are green. The executor reports 16 suites and 163 tests.
- Diff check by the team-leader (codex did not run git) confirms behaviour is preserved:
  - TS4029: the only change is a `node: InputSignal<...>` annotation plus a type import, in dashboard-list, dashboard-stat and dashboard-table.
  - surface-layout: only the `@for` track key changed (`$index + ':' + id`).
  - The helpers in surface-input-messages.ts match the removed inline code in all three inputs:
    - the `draftError` precedence;
    - the choice input's `checkedNode()` validation (B7 F3);
    - the issue filter;
    - the describedBy order.
- Round 1 reviews:
  - codex lane: NEEDS_REVISION 5/10 (code-logic-review-batch-8-codex.md).
    - Blocking 1: the WeakSet guard keeps every view state it emitted, so it rejects a parent's saved state after a workspace or surface reset.
    - Blocking 2: when a node keeps its id and kind but its path changes, the old draft can commit to the new path.
    - Moderate: the source scan can be bypassed with an HTML comment.
    - Moderate: the list URL has no trust fixture.
    - Minor: a spec has a TS2367 diagnostic.
  - code-logic-reviewer: NEEDS_REVISION 5/10 (code-logic-review-batch-8.md).
    - It confirms the guard blocker. One mounted renderer keeps a WeakSet of references for its whole lifetime
      (surface-renderer.component.ts:168-179,267-271). The reducer stores `viewState` by reference
      (apps-surface-reducer.ts:336-354). Switching away from a surface and back therefore drops that surface's state.
    - Moderate: `attemptBuild` checks only the shape of the builder's result.
    - Minor: TS2367 at trust-boundary.spec.ts:181 is hidden, because typecheck uses tsconfig.lib.json and ts-jest runs
      with isolatedModules.
    - Minor: the token scan can be bypassed with a split string.
    - It confirms carry-overs a, d, f and g, R5, R8, and the behaviour-preserving edits.
- Fix round 1: the frontend-developer handled every finding from both reviews (batch-8-fix-1-report.md).
  - Team-leader re-run: 3/3 targets green, and `tsc -p tsconfig.spec.json` exits 0. The executor reports 198 tests.
  - Coordinator rulings:
    - The echo guard was removed rather than scoped: ACCEPTED. View states carry no revision. The parent must write
      synchronously (a B15 carry-over).
    - Two assertions that pinned bugs were changed: ACCEPTED.
    - Adding spec tsc to project.json: NO. It is now in this batch's verification commands instead.
    - The no-op prune re-run was left as is: ACCEPTED.
  - Round 2 is the last round.
- Round 2:
  - code-logic-reviewer APPROVED 8/10 (code-logic-review-batch-8-round-2.md). Its one residual point is the
    synchronous write-back contract, which is already a B15 carry-over.
  - codex NEEDS_REVISION 6/10 (code-logic-review-batch-8-round-2-codex.md). It confirms all 5 round-1 findings are
    resolved, and raises one new blocker. The B7 F1 consumed-drafts marker (surface-text-input.component.ts:212)
    blocks a consumed drafts object forever. So the sequence type "a", save, blur, host snapshot changes the binding,
    restore the saved state shows "a" and never commits.
- Bounded fix under the round-2 rule (coordinator ruling: a clear correctness bug, so no round 3). The consumed
  reference stays blocked only until a different drafts object arrives. F1 still holds, and codex's reproduction
  becomes a spec. The fix is re-checked narrowly by codex alone (code-logic-review-batch-8-round-2b-codex.md).
  - Fix 2 (batch-8-fix-2-report.md) adds `releaseConsumed`, plus an `it.each` blur/Enter repro. Its red/green result is
    recorded.
  - The team-leader diff check found the fix-1 `reconcileTyped` re-key and both new specs present, and no spec line
    removed. The text-input spec passes 28/28, the lib targets are green, and spec tsc exits 0.
  - Codex round 2b: APPROVED, B8 8/10.
- Final: B8 ACCEPTED. The code-logic-reviewer gave 8/10 (round 2) and codex 8/10 (round 2b).
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`
- Process note: the codex lane wrote over the committed B3 `code-logic-review.md`. The coordinator restored that file and
  moved the review. From now on, every lane prompt names its exact output file and forbids writing `code-logic-review.md`.

## Batch 9: Budget confirmation — COMPLETE (commit 37822b07f)

- Recommended executor: senior-tester
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: measurement plus a contract-doc decision; the tester owns the evidence.
- Tasks: 1 | Depends on: Batch 8

### Task 9.1: `budget-render.spec.ts`, v2 fixtures on the testing barrel, budget doc comments, report — COMPLETE

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
- `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit` (spec type errors; the typecheck target
  covers only tsconfig.lib.json)
- Result:
  - Team-leader re-run with `--skip-nx-cache`: 2 projects green, and spec tsc exits 0.
  - Diff check:
    - The catalog changes are comments only; no constant changed.
    - The testing barrel adds 4 fixture exports.
    - No production source imports `@ptah-extension/shared/testing`.
    - The repo has no `no-console` rule.
  - code-logic-reviewer: APPROVED 8/10 (code-logic-review-batch-9.md).
    - Moderate: `runCase` asserted only that `renderFailed` was false, so an empty render would pass.
    - Coordinator ruling: tighten this before commit. The senior-tester added DOM count assertions to the count-based
      cases. The team-leader verifies them; no reviewer re-run, because the change is test-only.
    - Done. 8 cases now assert DOM counts: 200 components, 1,000 rows (first page and pager), 50 columns,
      100 inputs, 50 select options, 50 radios, 50 children, 4 grid columns.
    - Red run: an empty-builder override kept `renderFailed` false but failed the count assertion (100 expected,
      0 received).
    - The team-leader re-ran both projects: green. Spec tsc exits 0. 213 tests pass.
    - Not count-asserted, because there is no natural N in the DOM: maxTreeDepth, maxSeriesPoints and the three
      byte limits. Each still passes at-limit validation plus a non-empty render.
- Final: B9 ACCEPTED.

## Batch 10: Apps pure state — operation ids and overlays — COMPLETE (commit 4590f8da3)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 3

### Task 10.1: `surface-operation-id.ts`, `apps-operation-overlays.ts` — COMPLETE

- Files (4): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/state/`: `surface-operation-id.ts` (+ spec),
  `apps-operation-overlays.ts` (+ spec)
- Plan reference: implementation-plan.md:523-531, 574-582
- Quality requirements: `op-${now}-${16 alnum}` from `crypto.getRandomValues`, matches
  `SURFACE_OPERATION_ID_PATTERN` for a fixed clock; overlays keyed by operation id in send order; displayed value =
  latest unretired overlay per path; `retire`, `retireSettledUpTo`, retire-all-settled on read.
- Validation notes: A2 (inject the random source if jest lacks `crypto.getRandomValues`).

### Batch 10 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`
- Result: 3/3 targets green (re-run by team-leader), 22/22 tests. code-logic-reviewer APPROVED 8/10, 0 blockers
  (code-logic-review-batch-10.md). A2 verified.
- Accepted deviation: `settle(operationId, ackRevision)` added. It is the plan's Rule 1 "settle the operation" step and
  only records the ack revision on the overlay. The ledger has no materialized-revision concept, so Rules 1-2 hold.
- Carried forward (non-blocking): the rejection-sampling loop has no round cap for a hostile injected byte source
  (unreachable via the default source); `settle` does not assert `ackRevision >= baseRevision`. See B13 note.

## Batch 11: Intake, reducer, system prompt — COMPLETE (commit f042befa2)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: the revision state machine (R9); needs judgment on edge ordering.
- Tasks: 1 | Depends on: Batch 10

### Task 11.1: `apps-surface-intake.ts`, `apps-surface-reducer.ts`, `apps-system-prompt.ts` — COMPLETE

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
- Result: 3/3 green (re-run by team-leader), 97/97 tests. code-logic-reviewer APPROVED 8/10
  (code-logic-review-batch-11.md); Glm review lane APPROVED 9/10 (code-logic-review-batch-11-glm.md).
- Deviations accepted by both reviewers:
  (1) ops on a rejected surface -> needsRead;
  (2) a read retires settled overlays up to the read revision (retireSettledUpTo), not retireAllSettled. This is
      faithful to plan:550/626: a stale read must not drop acked values. It supersedes the plan:582 wording and the
      B10 brief;
  (3) readSeq ordering;
  (4) read-result guard, updateSurfaceOverlays, tombstone cap 64, eviction notice;
  (5) a read keeps the view state of a surface already held.
- Accepted risk F1: the guards are not try-wrapped against throwing getters. This is unreachable because payloads arrive
  via structured clone.
- Open, non-blocking: F2 (use isRevision for fromRevision); the single-slot eviction notice (UX decision, B12/B15);
  lastSubmit shape check (B15).
- Carried to B12: the sync spec must assert at most one surface:read in flight per slice (F7).
- Carried to B13: confirm that pending overlays survive an agent snapshot replace (F5).

## Batch 12: Session facade, workspace slices, surface sync — COMPLETE (commit d9b45302d)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 1, 11

### Task 12.1: `apps-workspace-slice.ts`, `AppsSurfaceSync`, `AppsSessionService` — COMPLETE

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
- Result: 3/3 green (re-run by team-leader), 132/132 tests. code-logic-reviewer APPROVED 8/10
  (code-logic-review-batch-12.md); Glm review lane APPROVED 9/10 (code-logic-review-batch-12-glm.md). No fix rounds.
  Both accepted all 8 deviations:
  1. the grace timer re-arms instead of restarting;
  2. dead expectations are dropped after a read;
  3. dispose() aborts the in-flight read;
  4. B13 hooks (requestSurfaceRead, expectSurfaceRevision, updateOverlays) cannot materialize an ack;
  5. chat:start uses the slice workspace path (D1; the route is Electron-only);
  6. send() before the session resolves shows an error;
  7. a failed start resets the slice fully;
  8. the fake StreamRouter uses the real registry, inbox and claims.
- Carried to B13 (N1): AppsSurfaceSync does not re-arm the grace timer after a failed grace read. The submit flow must
  request its own read. N5: add one spec covering start -> real onSurfaceCreated -> sessionFor resolving, if B13
  touches that path.
- Carried to B14 (same file owner): N2, a boot-window start stranded in APPS_IMPLICIT_WORKSPACE, and N3, discard()
  materializing an empty slice.
- Carried to B15 (N4): the composer keeps the draft text on a failed start and on a send-before-resolve.

## Batch 13: UI mutations and submit flow — COMPLETE (commit a652f510c)

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + CLI review lane
- Execution mode: sequential
- Rationale: Rules 1-4, polling and all six reconciliation cases (R9).
- Tasks: 1 | Depends on: Batch 12

### Task 13.1: `AppsSurfaceOperations`, `AppsSubmitFlow` — COMPLETE

- Files (4): CREATE under `.../libs/frontend/mcp-apps-page/src/lib/services/`: `apps-surface-operations.service.ts`
  (+ spec), `apps-submit-flow.ts` (+ spec)
- Plan reference: implementation-plan.md:514-646
- Quality requirements: never throws; one in-flight mutation per surface; base = materialized revision; queue
  coalescing; transport failure vs host refusal distinguished by `errorCode`; never resends; one poll timer per slice
  (3 s, 10 s per call, stop at 150 s or 3 failures → `unknown`); no `chat:*` call from any mutation.
- Spec pins (real reducer, scripted `MockRpc` and pushes): reconciliation cases 1-6; submit waits for queue and
  echo; 30 s timeout → polling, no second `surface:action`; `stale-revision` select re-sends once with a new id,
  change does not; Req 6.6 unsynced selection notice; zero `chat:start`/`chat:continue`.

- B10 carry-forward: `SurfaceValueOverlayInput` is `{ operationId, path, value, baseRevision }`, one ledger per
  surface; pass exactly that shape to `add()` (the plan's `surfaceId`/`componentId` belong to the send queue, not the
  ledger). `settle()` takes the `applied` ack revision; never write it to `materializedRevision`.

### Batch 13 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`
- Result: 3/3 green (re-run by team-leader with `--skip-nx-cache`), 11 suites / 211 tests.
  - Round 1: code-logic-reviewer 7/10 (code-logic-review-batch-13.md). The antigravity lane gave 8/10 NEEDS_REVISION (code-logic-review-batch-13-antigravity.md).
  - Fix round 1 (batch-13-fix-1-report.md): the stale-base send was replaced by a read plus a drop at 21.5 s; submit/lane serialization is now symmetric (isSubmitting/submitEnded); a new lanes spec; the ownedRoutingIds release.
  - Round 2: code-logic-reviewer APPROVED 9/10 (code-logic-review-batch-13-round-2.md). The antigravity lane APPROVED 9/10 (code-logic-review-batch-13-round-2-antigravity.md). Both reviewers ACCEPT all 4 deviations.
- Carried to B15 (non-blocking):
  - When a lane's queue refills long after an `applied` ack, its wait timer arms late. The "skip the read on the first tick" assumption can then miss by one grace period. This is timing only: the send gate and the drop deadline come from live state.
  - The transcript must consume `submittedBubbles`.

## Batch 14: Focus-memory directive — COMPLETE (commit 4aa79dcfd)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 12

### Task 14.1: `apps-focus-memory.directive.ts` — COMPLETE

- Files (2): CREATE `.../libs/frontend/mcp-apps-page/src/lib/components/apps-focus-memory.directive.ts` (+ spec)
- Scope widened at B12 commit (team-leader, 2026-09-25): the slice had no focus-key field. B14 also MODIFIES
  `services/apps-workspace-slice.ts`, `services/apps-session.service.ts` (+ spec). The same owner fixes the B12 carry-overs
  N2 (a boot-window start stranded in APPS_IMPLICIT_WORKSPACE) and N3 (discard() materializing an empty slice).
  B13 must not edit these three files, so B13 and B14 can run in parallel.
- Plan reference: implementation-plan.md:142-158, 654, 687; Req 7.6
- Quality requirements: records `data-apps-focus-key` of the last focused control in the slice; on init restores to
  that control if it exists and is focusable, else focuses the host (`tabindex="-1"`).

### Batch 14 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page`
- Result: 3/3 green (re-run by team-leader), 199 tests in the lib at commit time. The first review was NEEDS_REVISION
  6/10. Fix round 1 (codex resume) added:
  - a start() success-branch ownership guard with a best-effort chat:abort of an orphaned start;
  - recordFocusKey no longer creates phantom slices;
  - edge-triggered implicit->real drop tracking (replacing the one-shot latch);
  - an early discard() return.
  Re-check APPROVED 8/10 (code-logic-review-batch-14.md). The existing B12 specs are unchanged (additions only).
- Open (minor): the host always carries tabindex="-1". B15 wires the directive on the page host (see the B15 carry-overs).
- Lane pool change (2026-09-25): Glm/Ollama Cloud weekly limit reached; opencode Go exhausted. Executors and second
  reviews now use codex, antigravity and subagents only, and never the batch's own executor.

## Remaining order (team-leader, 2026-09-25, after B9)

1. B15 runs alone. Both B16 and B20 depend on it:
   - B16's lazy `loadComponent` reads `m.AppsPageComponent` from the lib's `src/index.ts`, which B15 creates.
   - B20 modifies `apps-page.component.ts`.
2. B20 and B16 run in parallel after B15. They are file-disjoint:
   - B20: `core/.../electron-layout.service.ts`, `apps-page.component.ts` and their specs.
   - B16: `shared/.../webview-surface.types.ts`, `app.routes.ts`, `webview-routing.spec.ts`, and the guard.

   Their commits still land one at a time. Each batch's verification runs against the combined tree, so a failure
   is attributed by file ownership. B16's `@ptah-extension/core` tests also cover B20's service change.
3. B17 depends on B16 (D-2).
4. B19 depends on B1-B18 and runs last.
5. The R10 visual review (dark and light, against `prototype/`) runs after B17. Its checklist gathers these items:
   - B5: stat density and delta phrasing (see B5).
   - B6: the "Sent" status colour (B15 made it green, per the prototype).
   - B15 round 2: switching between two failed surfaces never flashes, and the new notice and error blocks read
     clearly together.

B15 and B20 are built against the approved prototype.

## Batch 15: Apps page components and public API — COMPLETE

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + code-style-reviewer
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 8, 13, 14

### Task 15.1: `AppsPageComponent`, `AppsTranscriptComponent`, `AppsSurfacePanelComponent`, `src/index.ts` — COMPLETE

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
- Prototype (APPROVED 2026-09-25, `prototype/index.html`, `states.html`, `README.md`, screenshots) is the visual source
  of truth, including both designer proposals: (a) below ~480px, and in the embedded-sidebar container, the
  conversation column and surface panel stack vertically and stat/chart grids collapse to one column; (b) the rejected
  state carries its color on the icon + spine only — no colored small text.
- Chart "Expand" is a client-only view toggle (no RPC; the host returns unsupported for every `dashboard.*` action
  except `select`). Spec pin: toggling Expand makes zero `ClaudeRpcService.call`/`VSCodeService.postMessage` calls.
- The table always shows the pager, page size `SURFACE_PAGE_SIZE` (25).
- Leave a single, clearly named layout slot between the conversation column and the surface panel for the splitter
  handle; the splitter itself is Batch 20 (split out to keep B15 at 6 files).
- Carry-overs gathered for B15 (team-leader):
  - apply `AppsFocusMemoryDirective` (B14, `components/apps-focus-memory.directive.ts`) to the AppsPageComponent host.
    B14 left this undone on purpose; pin restore-after-re-create at the page level;
  - B12 N4: the composer keeps the user's draft text on a failed start() and on a send-before-resolve;
  - B11: validate the `lastSubmit` shape before rendering it; decide the single-slot eviction notice UX (show the
    latest notice, or queue them);
  - B6: the renderer path must behave identically when a SURFACE_VIEW_MODEL_BUILDER override throws and when the
    default returns renderFailed. The "builder override throws" pin depends on it.
  - B8: bind the renderer's `interaction` input through a `computed`, not a template method call. Host rejections
    reach the inputs through `interaction.issues`, which apps-surface-lanes fills, so no second input is needed.
  - B8/R6: re-run `trust-boundary.spec.ts` (its scan of `mcp-apps-page/src`) in B15's verification.
  - B8 fix 1 (the renderer echo guard was removed): store the renderer's emitted viewState verbatim and
    synchronously. Never pass an older state late, because that rolls the drafts back.
  - B13: the transcript consumes `AppsSurfaceOperations.submittedBubbles`. One lane-timer note is timing-only: the
    lane's first-tick read can be late by one grace period.

### Batch 15 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/mcp-apps-page @ptah-extension/declarative-dashboard`
  (re-runs `trust-boundary.spec.ts` against the now-populated Apps lib, R6)
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit` and
  `npx tsc -p libs/frontend/declarative-dashboard/tsconfig.spec.json --noEmit`
- mcp-apps-page spec tsc BASELINE (coordinator ruling, 2026-09-25). These 8 pre-existing TS2352 errors come in
  transitively and are out of scope for this task:
  - `libs/frontend/core/src/testing/mock-rpc-service.ts:54,60,66,69`
  - `libs/frontend/git-ui/src/lib/services/monaco-loader.service.ts:113,151,171,187`

  From now on the gate for this lib is "no new errors beyond these 8", not exit 0. Our own 4 errors must be fixed
  before B15 commits:
  - `apps-submit-flow.spec.ts:333`, `apps-surface-lanes.spec.ts:149` and `apps-surface-sync.spec.ts:319`
    (`'INTERNAL_ERROR'` is not an `RpcUserErrorCode`)
  - `apps-surface-reducer.spec.ts:229` (`.surface` on `SurfaceContent`)

  The fix goes in the review fix round, or in a bounded test-only fix before commit.
- Result:
  - The team-leader re-ran it with `--skip-nx-cache`: 2 projects green, and the declarative-dashboard spec tsc
    exits 0.
  - mcp-apps-page spec tsc shows the 8 baseline errors plus the 4 above.
- Coordinator rulings on batch-15-report.md:
  - Out-of-scope edits are ACCEPTED:
    - `setSurfaceViewState` and `activateSurface` in the reducer and the session;
    - chart Expand/Collapse, client-only, with Escape;
    - green "Sent" in surface-layout, per the prototype.
  - Eviction notice: only the latest is shown.
  - The composer draft is kept on a failed send, but not across tab switches.
  - Reviewers must check the side effect: reconcile in the operations service now re-runs on every keystroke. It
    must send nothing and must not fight the lanes, overlays or echo wait.
- Round 1:
  - code-logic-reviewer: NEEDS_REVISION 7/10, with 0 blocking and 2 moderate findings (code-logic-review-batch-15.md).
    - All 9 focus items pass. Markdown reaches the DOM only through the markdown lib's `SurfaceMarkdownPipe` and
      `<markdown>`.
    - M1: `failedRenderable` is not per surface. Switching back to a failed surface remounts the renderer and builds
      again.
    - M2: `isProcessing()` ignores `slice.turnPending` after the session id resolves. This leaves a double-send
      window on the second turn.
  - codex: NEEDS_REVISION 5/10 (code-logic-review-batch-15-codex.md), with 1 blocking, 2 serious and 1 moderate
    finding:
    - B1 (blocking): "new conversation" awaits abort, then discards whichever workspace is active by then. It also
      discards after a failed abort.
    - S1 (serious): a submitted bubble is stamped when its result arrives, so it can sort after its own response.
    - S2 (serious): agent snapshots override the surface the user picked in the switcher.
    - M (moderate): a `lastSubmit` time that is out of range renders "NaN:NaN".
- PLAN DEVIATION (coordinator ruling, 2026-09-25). This supersedes the plan wording "agent snapshot activates its
  surface":
  - A manual pick in the switcher sticks until that surface is removed or evicted.
  - Agent updates to other surfaces never steal focus.
  - A surface the agent newly creates may auto-activate only if the user has made no manual pick in this slice.
  - No new UI is added.
- Fix round 1 (batch-15-fix-1-report.md):
  - Team-leader re-run: 2 projects green. The mcp-apps-page spec tsc shows exactly the 8 baseline errors. The
    declarative-dashboard spec tsc exits 0.
  - Nothing is staged. The 4 committed files that prettier touched show no diff.
  - Executor counts: 259 tests (mcp-apps-page) and 214 (declarative-dashboard). Red/green evidence is recorded for
    B1, S1, S2, M1 and M2.
  - Coordinator rulings, all ACCEPTED:
    - S2 changed a panel assertion. `implementation-plan.md` now has a revision note at the switcher paragraph.
    - Codex's "real user echo" test was not written; chat-streaming already pins that path.
    - The new files `apps-conversation-claims.ts`, `apps-session-rpc.ts` and `apps-transcript-order.ts` are
      accepted. The reviewers must confirm the extraction is behaviour-preserving.
  - KNOWN LIMIT (M2): if liveness goes idle -> streaming -> idle before the page observes it, "processing" stays on
    until the user presses Stop. Stop is the recovery.
- Round 2 (the last): the code-logic-reviewer subagent, plus codex resumed on its round-1 session.
  - code-logic-reviewer: APPROVED 9/10 (code-logic-review-batch-15-round-2.md). It re-verified all 9 round-1 items,
    found nothing new, and the 8-error baseline holds.
  - codex: APPROVED 8/10, no new findings (code-logic-review-batch-15-round-2-codex.md). It independently checked
    259 Apps tests, 22 trust-boundary tests and the 8-error baseline.
- Final: B15 ACCEPTED. It covers M1 and M2 with specs, the 4 errors in our own specs (spec tsc must then show
  exactly the 8 baseline errors), and every codex finding.

## Batch 20: Apps page splitter (user addition 2026-09-25) — IN_PROGRESS

Runs right after Batch 15 (numbered 20 so existing batch numbers stay stable). B16-B19 do not depend on it; B19's
lazy-load gate and Mode 3 visual evidence must include it.

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer + code-style-reviewer; visual-reviewer at completion (dark + light, wide and <480px)
- Execution mode: sequential
- Rationale: touches a shared core service's persisted state plus the page; write-path correctness needs one hand.
- Tasks: 1 | Depends on: Batch 15

### Task 20.1: Resizable split between conversation column and surface panel — IN_PROGRESS

- Files (4, 2 libs): MODIFY `.../libs/frontend/core/src/lib/services/electron-layout.service.ts` (+ its existing
  `.spec.ts`); MODIFY `.../libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.ts` (+ `.spec.ts`)
- Plan reference: context.md "User addition (B15 scope)" bullet; prototype default width 360px
- Pattern to follow: `ElectronResizeHandleComponent` usage in
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:232,253`; width API shape of
  `setGitRailWidth`/`commitGitRailWidth` in `electron-layout.service.ts:188-196`
- Quality requirements:
  - Reuse `ptah-electron-resize-handle` from `@ptah-extension/chat-ui` (type:feature -> type:feature is allowed); do
    not fork it.
  - The handle emits a viewport-relative pointer X: subtract the Apps container's `getBoundingClientRect().left` before
    use. Clamp (min keeps the conversation column usable, max keeps the surface panel >= ~360px; reject non-finite).
  - Escape/blur restore is built into the handle; keep it working.
  - Keyboard: the separator is focusable, Left/Right arrows resize by a fixed step (Shift = larger step), with
    `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow/min/max` and an accessible label (prototype README
    `[project-rule]` keyboard reachability; no design-spec.md exists in the task folder to override this).
  - Persistence decision (team-leader): extend `ElectronLayoutService` with `appsSplitWidth` + setter/commit, persisted
    in the same `LAYOUT_STATE_KEY` object via `persistLayout()`/`restoreLayout()`, like the other Electron panel widths.
    The page component holds no width state of its own.
  - Hidden (and the columns stack) below ~480px and in the embedded-sidebar container.
- Validation notes: WRITE-PATH RISK — `persistLayout()` writes the whole `LAYOUT_STATE_KEY` object via
  `vscodeService.setState`; `restoreLayout()` also reads `workspaceFolders`/`activeWorkspaceIndex` from that key. Trace
  every writer of `LAYOUT_STATE_KEY` and prove the new field neither drops those fields nor is dropped by another
  writer; a restore with the field missing or non-numeric falls back to the default. Spec pins: offset subtraction,
  clamp bounds, persist on commit only (not on every drag frame), restore round-trip, arrow-key resize, handle absent
  when stacked.
- Implementation details: page binds the handle's width output to `layout.setAppsSplitWidth(width - left)` and its
  drag-end to the commit; CSS grid column uses the service signal.

- B15 note: `apps-page.component.spec.ts` is at 693 lines. Put the splitter specs in their own spec file
  (e.g. `apps-page-splitter.spec.ts`). Use the splitter slot named in batch-15-report.md.

### Batch 20 verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core @ptah-extension/mcp-apps-page`

## Batch 16: Surface id, route and Electron-only guard — IN_PROGRESS

- Recommended executor: frontend-developer
- Fallback executor: CLI lane x 1
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: restructures existing routing specs (D-1) without weakening them; resolves A1.
- Tasks: 1 | Depends on: Batch 15

### Task 16.1: `'apps'` id, `apps` route, `electronOnlySurface` guard, routing specs — IN_PROGRESS

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

## Batch 18: Harness prompt isolation — COMPLETE (commit a3dbaceea)

- Recommended executor: CLI lane x 1
- Fallback executor: frontend-developer
- Reviewer: code-logic-reviewer
- Execution mode: sequential
- Rationale: independent of every other batch; may run at any time.
- Tasks: 1 | Depends on: none

### Task 18.1: Filter harness prompts by its own surface id — COMPLETE

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
- Result: 3/3 green (re-run by team-leader), 132/132 tests. The first review was NEEDS_REVISION 5/10: no
  routingTargetRevision() dependency, and a `typeof surfaceId` production shim.
  Fix round 1 (antigravity resume) resolved both, but rewrote the q-mixed fixture of an existing test. That hid a
  regression: a [harness surface, live tab] prompt would render in both the harness and the tab.
  Fix round 2 made the filter `hasSurfaceTargets(id) && targetTabsFor(id).includes(surfaceId)` (and the question
  equivalent), restored the fixture verbatim and added mixed-target tests. Re-check APPROVED 9/10
  (code-logic-review-batch-18.md).
- Minor coverage gap (non-blocking): a second re-attachment of targets on the same id is not pinned.

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
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit`

## Completion prerequisites (Mode 3)

- Parity: N/A — no existing surface is replaced, consolidated, rebuilt or redesigned (the Apps page is new; the
  shell edit replaces one comment).
- Write-path trace: N/A for persisted settings — 494 writes no settings or storage; host surface state is in-memory
  and written through 538's existing RPCs.
- Rendered visual evidence (dark + light) from visual-reviewer on the Electron build, against the visual source of
  truth the user confirms (R10).
- Manual QA items A2 (surface-tool permission prompt), Req 9.2 screenshot, tool-result rendering, and the
  `ptah_surface_get_state` follow-through (plan "Open manual QA items").
