# Batch 14 Report — Per-host composition and adapter delivery specs

TASK_2026_538_3ccf. Executor: senior-tester subagent. Worktree:
`D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2`
(branch `feat/task-538-surface-contract-v2`).

## Scope discipline

Batch 14 is limited to host apps and `cli-engine`. No file in
`libs/shared/src/mcp-apps-contracts/**` or `libs/backend/vscode-lm-tools/src/lib/surface/**`
was touched. `git status` at the end of this batch shows two files outside my
scope already modified/created by the concurrent Batch 15 tester
(`libs/shared/src/mcp-apps-contracts/dashboard-trust-boundary.spec.ts`,
`libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts`)
— neither is listed below because neither was written by this batch. No
prettier was run on any file this batch did not create or change.

## Task 14.1 — Electron adapter through the broadcast — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\webview-manager-adapter.spec.ts`
  (MODIFY: appended one new `describe` block, 4 cases; the two existing
  `describe` blocks are untouched).
- Evidence: `createDashboardBroadcast(() => adapter, logger)` is exercised
  directly against `ElectronWebviewManagerAdapter`, not a re-implementation
  of the broadcast logic:
  - a live window gives `{ status: 'delivered', surfaces: 1 }` and the exact
    `{ type, payload }` object reaches `sendToRenderer`;
  - no window gives `{ status: 'no-surface' }` (a success);
  - a live-enumerated surface whose send returns `false` gives
    `{ status: 'failed', delivered: 0, surfaces: 1, reason: '1 of 1 attached
    surface(s) did not accept the spec' }` — the exact text
    `dashboard-namespace.builder.ts:181` produces, confirming Req 8.6 ("delivered"
    is never reported for a failed send);
  - a compile-time check that `ElectronWebviewManagerAdapter` satisfies
    `DashboardSurfaceHost` (Req 11.4).
- `npx nx test ptah-electron --testPathPatterns=webview-manager-adapter`:
  10/10 passed (6 pre-existing + 4 new).

## Task 14.2 — CLI adapter through the broadcast — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\transport\cli-webview-manager-adapter.spec.ts`
  (MODIFY: appended one new `describe` block, 2 cases; existing blocks
  untouched).
- Evidence: `createDashboardBroadcast(() => adapter, logger)` against the real
  `CliWebviewManagerAdapter` gives `{ status: 'no-surface' }` and never throws
  (Req 11.2), plus the `DashboardSurfaceHost` compile-time check (Req 11.4).
- `npx nx test @ptah-extension/cli-engine --testPathPatterns=cli-webview-manager-adapter`:
  10/10 passed (8 pre-existing + 2 new).

## Task 14.3 — VS Code composition spec — COMPLETE (with a recorded gap)

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-extension-vscode\src\di\surface-composition.spec.ts`
  (CREATE), pattern `container.smoke.spec.ts:186-212` (hand-built minimal
  container against the real registration function).
- Evidence: builds a container with the REAL `registerVsCodeCorePlatformAgnostic`
  and `registerVsCodeLmToolsServices`, then proves:
  1. `VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE` resolves to one singleton
     per container.
  2. An agent-side write (`SurfaceStateService.applyAgentUpdate`, what
     `buildSurfaceNamespace`'s `update` calls — `surface-namespace.builder.ts:124`)
     is visible to a UI-side read (`.read`, what `SurfaceRpcHandlers.handleRead`
     calls — `surface-rpc.handlers.ts:166`).
  3. A UI-side write (`.change`, what `handleChange` calls — `:175-182`) is
     visible to an agent-side read (`.describeForAgent`, what `getState` calls
     — `surface-namespace.builder.ts:194`).
- `npx nx test ptah-extension-vscode --testPathPatterns=surface-composition`:
  3/3 passed.
- **Recorded gap** (see "Testability finding" below): this spec proves the Req
  7 "one store, two entry points" claim one layer in, at `SurfaceStateService`,
  not through the literal `ptah_surface_update` tool call or the literal
  `surface:read` JSON-RPC envelope, because neither `buildSurfaceNamespace`
  nor `SurfaceRpcHandlers` is exported from its project's public barrel.

## Task 14.4 — Electron composition spec — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\di\surface-composition.spec.ts`
  (CREATE), pattern `container.smoke.spec.ts`.
- Evidence (both cases build the container in the REAL production order —
  `registerVsCodeLmToolsServices` before `TOKENS.WEBVIEW_MANAGER` exists,
  `phase-3-storage.ts:134` vs. `bootstrap.ts:355`):
  1. Assumption A1: a create attempted before any host is registered reports
     `no-surface`, not a throw. `TOKENS.WEBVIEW_MANAGER` is then registered
     through the REAL `createMainWindowHandleGetter` (Task 2.4,
     `bootstrap.ts:131-149`) wrapping a live fake `BrowserWindow`, built into a
     real `IpcBridge` and `ElectronWebviewManagerAdapter`; a second create then
     delivers (`{ status: 'delivered', surfaces: 1 }`) and the exact
     `to-renderer` IPC send is observed on the fake window.
  2. Batch 2 SERIOUS finding, end to end: with the window destroyed
     (`win.isDestroyed.mockReturnValue(true)`) but still referenced by the
     getter's closure — the exact shape that hid the race before Task 2.4 —
     a further create reports `{ status: 'no-surface' }`, never `failed`, and
     `webContents.send` is not called.
- `npx nx test ptah-electron --testPathPatterns=surface-composition`:
  2/2 passed.

## Task 14.5 — CLI composition spec — COMPLETE (with a recorded gap)

- File: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\surface-composition.spec.ts`
  (CREATE).
- Evidence: builds a container in the real CLI order (`TOKENS.WEBVIEW_MANAGER`
  — a real `CliWebviewManagerAdapter` — registered before
  `registerVsCodeLmToolsServices`, matching `container.ts:379-380` vs. `:773`),
  then proves:
  1. State persists and is readable after a commit, while delivery through the
     real CLI adapter honestly reports `no-surface` (the CLI and TUI render no
     surfaces — `cli-webview-manager-adapter.ts:44-53`).
  2. A UI-side write is visible to an agent-side read, same shape as Task 14.3.
- `npx nx test @ptah-extension/cli-engine --testPathPatterns=surface-composition`:
  2/2 passed.
- **Not written, and why**: the batch's "Carried from Batch 11" note asked
  this spec to also cover the defensive "store missing" outcome for the MCP
  tools (`isError: true` text) and for RPC (an error, no throw), and "a submit
  with no submit-turn service settles `rejected: session-unavailable`". These
  specifically exercise the defensive branches INSIDE `buildSurfaceNamespace`
  and `SurfaceRpcHandlers` (`if (!service) return unavailable()`;
  `SurfaceRpcHandlers.state()` throwing `SURFACE_STATE_UNAVAILABLE_MESSAGE`).
  Both are unreachable from `cli-engine` without either the same barrel gap
  below, or standing up the ENTIRE `registerRpcSurface` dependency graph
  (`wireSdkCallbacks`, memory contracts, every other RPC handler class,
  `registerChatServices`, ...) to construct even one manifest entry — which is
  disproportionate to the Req 7 store-composition contract this task is
  about. These three cases are already unit-pinned exactly in
  `surface-rpc.handlers.spec.ts` and `surface-rpc.handlers.submit.spec.ts`
  (Batch 11) and in the vscode-lm-tools `surface-namespace.builder.spec.ts` /
  `surface-tools.spec.ts` (Batch 9-13) — none of them part of Batch 14. I did
  not fabricate a substitute test for these three specific cases; I am
  recording the gap instead, per the instruction not to fix production code to
  make a test pass and not to report a case as covered when it was not
  executed.

## Testability finding for the team-leader / architect (not fixed — production code, out of my scope)

Two library barrels do not export the symbols the plan's own Req 7 test-matrix
row (`implementation-plan.md:796`: "MCP write → RPC read and RPC write → MCP
read on VS Code, Electron and CLI containers") needs to be proven at the wire
level from a host-app composition spec:

1. `@ptah-extension/vscode-lm-tools`'s `src/index.ts` exports
   `SurfaceStateService` and `createDashboardBroadcast`/`DashboardSurfaceHost`
   (Task 8.4), but not `buildSurfaceNamespace` or the `SurfaceNamespace` /
   `SurfaceCaller` types (`surface-namespace.builder.ts`). Only
   `PtahAPIBuilder` (~45 unrelated `@inject`s) constructs it in production.
2. `@ptah-extension/rpc-handlers`'s `src/index.ts` exports about 40 other
   handler classes (`AuthRpcHandlers`, `SetupRpcHandlers`, ...) but never
   `SurfaceRpcHandlers`. Only `registerRpcSurface`'s host-profile engine
   (`register-rpc-surface.ts`) constructs it, and that engine needs the whole
   RPC surface's dependency graph to run even one manifest entry.

Both gaps made it impossible, without a production edit, to drive the literal
`ptah_surface_update` / `ptah_surface_get_state` MCP calls or the literal
`surface:*` JSON-RPC envelope from `apps/ptah-extension-vscode`,
`apps/ptah-electron` or `libs/backend/cli-engine`. Per my role's rule (do not
fix production code to make a test pass; record and report), Tasks 14.3 and
14.5 instead prove the Req 7 "one store, two entry points" claim one layer in,
at `SurfaceStateService` — the object both unexported wrappers are a thin,
already-verified pass-through to (read the source at the line numbers cited
above). Task 14.5's three defensive "store missing" / "no submit-turn service"
cases could not be proven at this layer at all (see Task 14.5 section) and are
NOT covered by this batch's new specs; they remain covered only at the unit
level in Batch 9-11's own files.

Recommended next step: a small, deliberate barrel decision (an architect call,
per the R8 precedent for `mcp-apps-contracts`) — either add named exports for
`buildSurfaceNamespace`/`SurfaceNamespace` and `SurfaceRpcHandlers` to their
projects' public barrels, or accept that the wire-level MCP↔RPC round trip is
proven only through each host's real, full boot (out of unit-test reach) plus
the unit specs on each side.

## Verification

Command (as specified, tailed/filtered — never run workspace-wide):

```
npx nx run-many -t typecheck,test,lint -p ptah-electron ptah-extension-vscode @ptah-extension/cli-engine
```

Result:

- `@ptah-extension/cli-engine:typecheck` — pass.
- `@ptah-extension/cli-engine:lint` — pass.
- `@ptah-extension/cli-engine:test` — pass (includes the new
  `surface-composition.spec.ts`, 2/2, and the appended
  `cli-webview-manager-adapter.spec.ts` cases, 10/10 in that file).
- `ptah-extension-vscode:typecheck` — pass.
- `ptah-extension-vscode:lint` — pass.
- `ptah-extension-vscode:test` — pass (includes the new
  `surface-composition.spec.ts`, 3/3).
- `ptah-electron:typecheck` — pass.
- `ptah-electron:lint` — pass.
- `ptah-electron:test` — 53 of 54 suites ran (1 skipped, pre-existing and
  unrelated), 51 suites passed, 2 failed with exactly the 2 known
  environment-only suites carried from Batch 11: `src/config/better-sqlite3-packaging.spec.ts`
  and `src/windows/shell-csp.spec.ts` (8 tests), both `ENOENT` on
  `<worktree>/node_modules/electron/{package.json,path.txt}` — the worktree has
  no `node_modules`, so packages resolve from the parent checkout and these two
  specs' literal `<workspaceRoot>/node_modules/electron/...` paths cannot
  resolve. Neither file was touched by this batch (or by any batch on this
  branch since `1c1bc7670`, per the Batch 2 record). 829/840 tests passed
  overall in `ptah-electron:test`, including the new
  `webview-manager-adapter.spec.ts` cases (10/10) and the new
  `surface-composition.spec.ts` (2/2).
- Overall `nx run-many` exit code 1, solely because of the 2 pre-known
  environmental Electron suites — the same disposition the task instructed me
  to expect.
- No new lint warnings were introduced in any file this batch touched or
  created (checked by grep against the lint output for each of the 5 file
  names — none matched).

## Files created or modified by this batch

- MODIFY: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\ipc\webview-manager-adapter.spec.ts`
- MODIFY: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\transport\cli-webview-manager-adapter.spec.ts`
- CREATE: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-extension-vscode\src\di\surface-composition.spec.ts`
- CREATE: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\di\surface-composition.spec.ts`
- CREATE: `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\surface-composition.spec.ts`
- CREATE (this report): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\.ptah\specs\TASK_2026_538_3ccf\batch-14-report.md`

No production file was created or modified. No existing spec assertion was
edited; every change to an existing spec file is a new, appended `describe`
block. No stub, TODO or placeholder was written. `batches.md` was not edited.

## Risk / validation-section disposition

- **R7** (this batch's core risk): "Neither `createDashboardBroadcast` nor
  `DashboardSurfaceHost` is exported from `vscode-lm-tools/src/index.ts`" was
  already resolved by Task 8.4 before this batch started; Tasks 14.1 and 14.2
  are exactly the "adapter-through-broadcast cases and the type-level
  `DashboardSurfaceHost` checks" R7 deferred to this batch, and both are done.
- **A1** (Electron resolves `PtahAPIBuilder` before or after `WEBVIEW_MANAGER`
  is registered): resolved by Task 14.4 — proven independent of order because
  the push host is resolved lazily.
- Edge case "CLI `no-surface` with the text result and no throw: Tasks 2.3 and
  14.2" — covered by Task 14.2.
- Edge case "Missing store on a supported host (defensive): Tasks 11.3, 12.2
  and 13.2" (not listed against 14.5 in the plan's own edge-case table,
  distinct from the Batch 14 "Carried from Batch 11" note that additionally
  asked for it here) — could not be reproduced at the composition level; see
  the Testability finding and the Task 14.5 section above.

## Revision 1

Codex review (`code-logic-review-batch-14.md`) returned NEEDS_REVISION, 6/10:
F1 SERIOUS (Req 7.4 composition unproven — both "sides" of every round trip
called `SurfaceStateService` directly, so a broken consumer injection would
not fail the tests) and F2 MODERATE (the CLI's defensive "missing
collaborator" cases from the Batch 11 carry-forward were not reproduced at
host-composition level). The review also judged my round-1 "impossible
without a production edit" framing too strong for the RPC side, and pointed
at the public `RPC_HANDLER_MANIFEST` / `resolveRpcHandlerPlan` seam.

### Scope addition: narrow production export (orchestrator-approved)

`libs/backend/vscode-lm-tools/src/index.ts` (MODIFY) now also exports:
`buildSurfaceNamespace`, `SurfaceNamespace`, `SurfaceCaller`,
`SurfaceUpdateOutcome`, `SurfaceGetStateOutcome` (from
`surface-namespace.builder.ts`); `handleSurfaceToolCall`, `SurfaceToolReply`,
`SurfaceToolName` (from `mcp-core/surface-tool-handlers.ts`); and
`SURFACE_UPDATE_TOOL_NAME`, `SURFACE_GET_STATE_TOOL_NAME` (from
`mcp-core/surface-tools.ts`). This is the ONLY production file this batch
touched, in either round. No `SurfaceRpcHandlers` export was added, per the
orchestrator's explicit instruction — the RPC side is reached instead through
`RPC_HANDLER_MANIFEST` / `resolveRpcHandlerPlan`, both already public via
`@ptah-extension/rpc-handlers`'s `export * from './lib/host-profile'`. A
`registerSurfaceRpc(container, ...)` helper in each of the three composition
specs calls `resolveRpcHandlerPlan(realHostProfile)`, filters to the one
`key: 'surface'` step, and does `container.resolve(step.ctor).register()` —
the exact class, constructed from that container, without touching the other
~40 handlers or `registerRpcSurface`'s full bridge graph. Verified with
`npx nx typecheck @ptah-extension/vscode-lm-tools` (pass) before use.

### F1 fix: real two-consumer round trips on all three hosts

Each composition spec gained a new `describe` block, "real two-consumer round
trip (Req 7.4, F1)", alongside the round-1 collaborator-level tests (kept,
relabelled "collaborator-level" for accuracy — they are still valid, just not
sufficient on their own, which is what the review found):

- Agent side: `handleSurfaceToolCall(SURFACE_UPDATE_TOOL_NAME | SURFACE_GET_STATE_TOOL_NAME, args, buildSurfaceNamespace({ service: <the container-resolved SurfaceStateService>, logger }), { sessionId, toolCallId }, logger)`.
  **Labelled accurately, per the review's request**: this is tool-call /
  namespace level — the same code `protocol-dispatcher.ts:1680` calls into —
  NOT the full JSON-RPC/MCP dispatcher (no `AsyncLocalStorage` caller-scope
  resolution is exercised here; that is `protocol-dispatcher.surface.spec.ts`'s
  job).
- UI side: the real `RpcHandler.handleMessage({ method: 'surface:read' |
  'surface:change', params, correlationId })` against the `SurfaceRpcHandlers`
  instance resolved and `.register()`ed as described above — the full RPC wire
  entry point host apps use.
- Assertions are exact, not just status codes: `routingId`, `surfaceId`,
  `revision` (1 then 2 after one change), and the changed value, read back
  from BOTH directions (e.g. VS Code:
  `apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:246-270`
  asserts `data.routingId === 'tab-1'`, `data.surfaces[0].surfaceId ===
  'profile'`, `data.surfaces[0].revision === 1`; the reverse test asserts
  `revision: 2` and `"name":"Grace"` in the agent-read reply text).
- A regression at `ptah-api-builder.service.ts:481` (the namespace's
  injection) is not what these tests exercise directly, because that specific
  wiring is proven separately below (VS Code only) — but a regression at
  `surface-rpc.handlers.ts:127-128` (the RPC handler's injection), at
  `RPC_HANDLER_MANIFEST`'s `'surface'` entry, at `resolveRpcHandlerPlan`, or a
  disconnected store between the namespace and the RPC handler, now fails
  these tests: they resolve the RPC handler from the SAME container the
  namespace's `state` came from, through the real manifest-selection path, not
  by constructing it by hand with a hand-picked service.

**API-builder wiring check** (F1, "so a manually injected shared service does
not conceal a broken builder injection"): added ONE test, VS Code only
(`apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`, describe
"PtahAPIBuilder wiring check"), that resolves the REAL `TOKENS.PTAH_API_BUILDER`
singleton `registerVsCodeLmToolsServices` registers (`PtahAPIBuilder` itself,
class exported from the barrel already). `PtahAPIBuilder` has ~45 `@inject`s;
all but ~21 are `{ isOptional: true }` and unused by the surface slice, so the
~21 required-but-irrelevant tokens are stubbed with a bare `{}` (safe: every
namespace `.build()` constructs is independently wrapped in
`buildNamespaceSafe`, and this test never calls any namespace but `.surface`).
`builder.build().surface.update(...)` is then asserted visible through the
INDEPENDENTLY container-resolved `SurfaceStateService.read(...)` — proof that
`PtahAPIBuilder`'s own `@inject(VSCODE_LM_TOOLS_TOKENS.SURFACE_STATE_SERVICE,
...)` (`ptah-api-builder.service.ts:481`) reached the shared store, not a
value this test passed in by hand. Not duplicated on Electron/CLI (`PtahAPIBuilder`
is VS Code LM Tools' one class, identically registered on all three hosts by
the same `registerVsCodeLmToolsServices` call; one wiring check on the class
itself, plus the per-host real-RPC-handler resolution above, covers the two
distinct injection points named in the review).

### F2 fix: CLI defensive missing-collaborator cases

`libs/backend/cli-engine/src/lib/surface-composition.spec.ts` gained a new
describe block, "defensive missing collaborators (Req 7.4, F2)":

- **(a) No state registered**: a container that never calls
  `registerVsCodeLmToolsServices` at all, with the real `SurfaceRpcHandlers`
  resolved and registered via the manifest seam (its `SURFACE_STATE_SERVICE`
  injection resolves to `undefined`, the same shape a genuine misconfiguration
  produces) and a `buildSurfaceNamespace({ service: undefined, logger })` for
  the MCP side. Asserts, for BOTH `ptah_surface_update` and
  `ptah_surface_get_state` (via `handleSurfaceToolCall`) and for both
  `surface:read` and `surface:change` (via real `RpcHandler.handleMessage`):
  a non-rejecting response (`resolves.toEqual`, never a thrown/rejected
  promise) carrying the EXACT wording `'surface state unavailable on this
  host'` — the literal string both `buildSurfaceNamespace`'s `unavailable()`
  helper and `SurfaceRpcHandlers`'s `SURFACE_STATE_UNAVAILABLE_MESSAGE`
  produce (confirmed identical by reading both source files; neither constant
  is exported, so the literal is asserted directly rather than imported).
- **(b) State registered, no submit-turn service**: the full-mode-shaped
  container (state + RPC handler real, `CHAT_TOKENS.SURFACE_SUBMIT_TURN` never
  registered because `registerChatServices` is not called). A real
  `surface:action` submit on a surface with a `surface.submit` action settles
  `{ status: 'rejected', reason: 'session-unavailable', detail: 'The chat
  runtime is not available on this host; the submit was not sent.' }` (exact
  object equality, including the operation id). A FOLLOW-UP `surface:operation`
  lookup on that same operation id is then asserted `status: 'rejected'`
  (explicitly not `'pending'` and not `'unknown'`) — the "terminal result" the
  review asked for, proving the ledger settled once and stays settled.

### Verification (Revision 1)

Command (as specified, tailed/filtered):

```
npx nx run-many -t typecheck,test,lint -p ptah-electron ptah-extension-vscode @ptah-extension/cli-engine @ptah-extension/vscode-lm-tools
```

Result:

- `@ptah-extension/vscode-lm-tools:typecheck` — pass.
- `@ptah-extension/vscode-lm-tools:lint` — pass.
- `@ptah-extension/vscode-lm-tools:test` — pass, 65/65 suites, 1,394/1,394
  tests (Nx's cache flagged this task "flaky" once during the combined run;
  re-run twice more, once with `--skip-nx-cache`, both clean 65/65 —
  attributed to Nx's own heuristic/worker-exit warning, not a real failure,
  and no file in this project's test tree was touched, only the barrel).
- `@ptah-extension/cli-engine:typecheck` — pass. `:lint` — pass. `:test` —
  pass, including the rewritten `surface-composition.spec.ts` (6/6:
  2 collaborator-level, 2 real round-trip, 2 F2 defensive) and the unchanged
  `cli-webview-manager-adapter.spec.ts` (10/10).
- `ptah-extension-vscode:typecheck` — pass. `:lint` — pass. `:test` — pass,
  including the rewritten `surface-composition.spec.ts` (6/6: singleton, 2
  collaborator-level, 2 real round-trip, 1 API-builder wiring check).
- `ptah-electron:typecheck` — pass. `:lint` — pass. `:test` — 53 of 54 suites
  ran (1 skipped, pre-existing, unrelated), 51 passed, 2 failed with exactly
  the 2 known environmental suites (`better-sqlite3-packaging.spec.ts`,
  `shell-csp.spec.ts`, 8 tests, `ENOENT` on the missing worktree
  `node_modules/electron`) — unchanged from round 1, untouched by this
  revision. 831/842 tests passed overall (up from 829/840 in round 1: +2 new
  Electron round-trip tests), including the rewritten
  `surface-composition.spec.ts` (4/4: 2 delivery/A1, kept unchanged, + 2 real
  round-trip) and the unchanged `webview-manager-adapter.spec.ts` (10/10).
- Overall `nx run-many` exit code 1, solely from the 2 pre-known
  environmental Electron suites, same disposition as round 1 and as the task
  instructed me to expect.
- No new lint warnings in any file this revision touched (grepped the lint
  output for each of the 6 file names — none matched).

### Files touched in Revision 1

- MODIFY (production, scope addition): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\vscode-lm-tools\src\index.ts`
- MODIFY (test, rewritten): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-extension-vscode\src\di\surface-composition.spec.ts`
- MODIFY (test, rewritten): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\apps\ptah-electron\src\di\surface-composition.spec.ts`
- MODIFY (test, rewritten): `D:\projects\ptah-extension\.claude-worktrees\feat-task-538-surface-contract-v2\libs\backend\cli-engine\src\lib\surface-composition.spec.ts`
- The two adapter specs from round 1 (`webview-manager-adapter.spec.ts`,
  `cli-webview-manager-adapter.spec.ts`) are unchanged in this revision.

### Residual, for the next reviewer

- The dispatcher-level MCP entry (`AsyncLocalStorage` caller-scope resolution
  in `protocol-dispatcher.ts`) is still not exercised by this batch — by
  design and labelled as such; that is `protocol-dispatcher.surface.spec.ts`'s
  responsibility, not a host-composition test's.
- The Electron composition file (`apps/ptah-electron/src/di/surface-composition.spec.ts`)
  does not repeat the PtahAPIBuilder wiring check — see the reasoning above
  (one class, one registration function, identical injection point on every
  host; the per-host value added is the real-RPC-handler resolution, which IS
  repeated on all three hosts).
