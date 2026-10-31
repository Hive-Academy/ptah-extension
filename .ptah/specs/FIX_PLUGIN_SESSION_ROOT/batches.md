# Batches - FIX_PLUGIN_SESSION_ROOT

Total tasks: 9 | Batches: 3 | Complete: 0/3

Worktree: `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root` (branch `fix/plugin-session-root`, base `a7036819e`).
Plan: `implementation-plan.md` revision 2 ("Notice only"). Coordinator accepted D1 (list every id recorded nearer than the project, value not compared) and D6 (post-save notice in the panel and in the dashboard skill card).

Execution defaults recorded (implementation-plan.md "Team-leader handoff" specifies the ordering):

- Batch 1 (contracts + loader) first; Batches 2 and 3 are file-disjoint, touch different projects with no dependency edge between them (`rpc-handlers` vs `chat-ui`/`dashboard`), and may run in parallel once Batch 1 is committed.
- One phase ("session notice") covers all three batches. Its code-logic review runs on the combined diff after the last of Batches 2/3 commits. Style review is also due: the phase adds public API (`plugins:get-config` params/result types, `PluginLoaderService.getSessionPluginNotice`, `ChatSessionService.readSessionPolicyRoots`, the exported `PLUGIN_SAVE_APPLIES_NOTICE`). Visual review is due for the rendered notices (Electron only).

## Plan validation

Status: PASSED WITH RISKS

Citations re-checked against the worktree at `a7036819e`: `rpc.types.ts:1360-1364` (`params: Record<string, never>`), `rpc-misc.types.ts:616-619`, `plugin-loader.service.ts` (`pluginConfigLayer` :43, `canonicalRootKey` :77, `layerAncestorConfigs` :224-260, `configHome` :535, `storageFor` :984-1003, `readWorkspaceLayer` :1102-1151, strict mode returns `status: 'error'` on missing storage / unreadable / invalid), `plugin-config-home.ts` (`canonicalRootKey` :164, `harnessRootFor` :320), `CapabilityImportedValue = 'on' | 'off'`, `chat-session.service.ts` (`historyRead` :272-273, `restoreLineage` :480-538 incl. `validatedLineage` :360 — neither writes; `upgradeLegacyLineage` :2154 is a separate caller step at :1440/:2122), `chat-history-read.service.ts:47-60`, `CHAT_TOKENS.SESSION` (`tokens.ts:13`, singleton at `chat/di.ts:94`), `plugin-rpc.handlers.ts` (ctor :199-236 ends with `approvals`, get-config :305-341, `harnessRoot()` :1137-1145), `plugin-rpc.schema.ts` (zod :15), `SessionId.validate` (`branded.types.ts:73`), `TabManagerService.activeTabSessionId` (:516-521), panel (`saveError` :536-537/:614, `saveConfiguration` :865, `saved.emit` :907, `loadPlugins` :1080), panel spec providers :122/:432, dashboard card `(saved)="onPickerClosed()"` (:147), card spec providers :99, `chat-ui/src/index.ts:137`. Nx project names confirmed in each `project.json`.

Data contracts across boundaries: webview sends `{ sessionId?: string }` → zod-validated in handler → `SessionId` → `readSessionPolicyRoots` returns `{ folder, ancestorRoots }` (physical, validated) → `getSessionPluginNotice(folder, ancestorRoots, harnessRoot())` → `PluginSessionNotice` → reply `sessionNotice?` → panel `result.data?.sessionNotice ?? null`. Field names and nullability match end to end; `{}` callers (`plugin-catalog.service.ts:219`, CLI `plugin.ts` x5, e2e fixture) stay valid.

Assumptions:

- A1: `TabState.claudeSessionId` values are SDK UUIDs accepted by `SessionId.validate` — unverified at runtime; Task 3.1 spec feeds a UUID, and Task 2.3 proves a non-UUID only drops the notice (D3).
- A2: a realpathed lineage root and the workspace spelling map to the same `canonicalRootKey(harnessRootFor(x))` — unverified; Task 1.2 spec case 9 (symlinked alias) checks it.
- A3: `tsyringe` passes `undefined` for an unregistered `isOptional` token, so the trailing `= null` default applies (VS Code smoke container and the CLI failure path do not register `CHAT_TOKENS.SESSION`) — verified by precedent `chat-history-read.service.ts:44`; Task 2.3 spec covers `sessionRoots` null, and the host gate runs the VS Code `container.smoke.spec.ts`.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1: Notice computation placed inside the existing get-config `try` would send expected `SESSION_NOT_FOUND`/`SESSION_FOLDER_UNAVAILABLE` to Sentry or fail the config read. | HIGH | Task 2.3: `sessionNoticeFor` runs after the body read with its own `try`; never rethrows; spec asserts `sentry.captureException` not called and config still returned. |
| R2: Injecting `CHAT_TOKENS.SESSION` into `PluginRpcHandlers` constructs the `ChatSessionService` singleton when the plugin handler resolves (possibly earlier than `ChatRpcHandlers`), or creates a resolution cycle. | MEDIUM | Task 2.3: confirm `ChatSessionService`'s constructor graph does not reach `PluginRpcHandlers`; host gate runs Electron + VS Code tests (incl. `container.smoke.spec.ts`) and pre-push `validate-deps`/di-lint. |
| R3: `readSessionPolicyRoots` accidentally upgrades legacy lineage (writes metadata) on a read. | MEDIUM | Task 2.1/2.2: method composes only `resolveSessionFolder` + `restoreLineage`; spec asserts upgrade methods on the metadata mock are never called. |
| R4: Loader uses the lenient read and shows an unreadable layer as "no overrides", or reads the active storage under another root's name on hosts without a config home. | MEDIUM | Task 1.2: `readWorkspaceLayer(layer, true)` only; `null` when `configHome === null`; spec cases 1 and 7. |
| R5: Stale RPC reply from a previous tab overwrites the notice for the current tab. | MEDIUM | Task 3.1: request counter; spec "switching re-queries and ignores late reply". |
| R6: Specs that render the real panel now inject `TabManagerService` (root-provided, heavy collaborators). | MEDIUM | Tasks 3.2 and 3.4 stub it at the panel spec (:122, :432) and card spec (:99); marketplace specs already stub the panel. |
| R7: Legacy-lineage sessions log `Legacy session policy lineage has unknown earlier ancestors` (warn) on every notice read, i.e. per tab switch. | LOW | Accepted (read-only, bounded to one RPC per tab change); reviewer to confirm acceptable. No task. |
| R8: Shared/agent-sdk/rpc-handlers/chat-ui changes break a host compile. | MEDIUM | Host gate (below) after the last batch commit, before the phase review. |
| R9: `plugins:save-config` path changed by accident. | LOW | Batch 2 verification: `git diff` shows no change inside the save handler (`plugin-rpc.handlers.ts:358-525` at base). |

Edge cases:

- No `sessionId` / draft tab (`activeTabSessionId() === null`) → no RPC with `sessionId`, byte-identical reply — Tasks 2.3, 3.1
- Invalid `sessionId` (`'x'`, `42`) → warning with issue paths only, no throw — Task 2.3
- Session folder unauthorized/missing, malformed lineage, unknown session → no notice — Tasks 2.2, 2.3
- Chat services unregistered (CLI failure path) → no notice — Task 2.3
- No open folder (`harnessRoot()` undefined) → no notice — Task 2.3
- Host without config home (VS Code, CLI/TUI) → `null` → no notice — Task 1.2 case 1
- Session root equals project root → `null` — Task 1.2 case 2
- Project not in lineage (legacy/`missing`, other repo) → `inheritsProjectSettings: false`, `overrides: []` — Task 1.2 case 6, Task 3.1 template
- Nearest-wins across grandchild/child/project; agent disables excluded — Task 1.2 cases 5, 8
- Unreadable nearer layer → `incomplete: true`, nothing throws — Task 1.2 case 7, Task 3.1 template
- More than 10 overrides → "and N more" — Task 3.1
- Failed save → no post-save notice; close button in card → no notice — Tasks 3.1, 3.3

## Batch 1: Shared contract and loader notice read — IN_PROGRESS

- Recommended executor: CLI lane, backend TypeScript capability (Nx lib code + Jest)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase review)
- Rationale: types must exist before the loader method that returns them; two small libraries, one dependency chain, one lane.
- Tasks: 2 | Depends on: none
- Phase: session notice | Phase review: code-logic + style (new public API) + visual (Electron) — after the last of Batches 2/3
- Verify: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk` (header must say "for 2 projects")

### Task 1.1: Add `PluginsGetConfigParams`, `PluginSessionOverride`, `PluginSessionNotice`; extend `PluginConfigStateWithHome` and the `plugins:get-config` entry — IN_PROGRESS

- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc.types.ts`
- Plan reference: implementation-plan.md:92-116 (component 1)
- Pattern to follow: `PluginConfigStateWithHome` / `configHome?` at `rpc-misc.types.ts:616-619`
- Quality requirements: every new field optional or new; no existing field changes; `shared` stays a leaf; `{}` callers compile unchanged.
- Validation notes: confirm the new types are reachable through the `rpc.types.ts:24` barrel and `@ptah-extension/shared` index (needed by Batches 2 and 3).
- Implementation details: `PluginsGetConfigParams { sessionId?: string }` (documented as read-only hint); `PluginSessionOverride { kind: 'plugin' | 'skill'; id; value: 'on' | 'off'; root }`; `PluginSessionNotice { sessionRoot; inheritsProjectSettings; overrides (sorted kind, id); incomplete }`; `sessionNotice?: PluginSessionNotice` on `PluginConfigStateWithHome`; `'plugins:get-config'.params` becomes `PluginsGetConfigParams` and its comment names both Electron-only fields.

### Task 1.2: `PluginLoaderService.getSessionPluginNotice` plus spec — IN_PROGRESS

- Depends on: Task 1.1
- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
  - CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.session-notice.spec.ts`
- Plan reference: implementation-plan.md:118-161 (component 2)
- Pattern to follow: precedence of `layerAncestorConfigs` (`plugin-loader.service.ts:224-260`); config-home loader setup in `plugin-loader.service.spec.ts:1602-1760` (`harnessRootOf` :1726, options :1747); alias case in `plugin-loader.service.capabilities.spec.ts:330-340`
- Quality requirements: synchronous, never writes; one strict storage read per nearer layer; no caching; never throws for an unreadable layer.
- Validation notes: R4 (strict read only, `null` without home); A2 (alias case 9); D1 (equal value still listed).
- Implementation details: `null` if `configHome === null`; `key(x) = canonicalRootKey(this.configHome.harnessRootFor(x))`; `null` if session key equals project key; nearer layers = `[sessionFolder, ...ancestorRoots]` de-duplicated by key, cut before the first project-key entry (none → `inheritsProjectSettings: false`, `overrides: []`, layers still read for `incomplete`); per layer `readWorkspaceLayer(layer, true)` — error → `incomplete = true` + warn naming the root; ok → first layer recording an id wins via `pluginConfigLayer`, agent ids excluded; return sorted overrides with `root = harnessRootFor(layer)`. Spec covers plan cases 1-9.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -t test,lint,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk` passes; output tailed
- No per-batch review: the phase review covers this batch in the combined diff
- R4 and A2 addressed by spec cases 1, 7 and 9

## Batch 2: Session reach read and `plugins:get-config` notice — PENDING

- Recommended executor: CLI lane, backend TypeScript capability (tsyringe DI, zod, Jest)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (phase review)
- Rationale: the handler consumes the new `ChatSessionService` method; all five files are in `rpc-handlers`, one lane.
- Tasks: 3 | Depends on: Batch 1 (committed). May run in parallel with Batch 3.
- Phase: session notice | Phase review: as Batch 1
- Verify: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/rpc-handlers` (header must say "for 1 project")

### Task 2.1: `ChatSessionService.readSessionPolicyRoots` — PENDING

- File: `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- Plan reference: implementation-plan.md:163-189 (component 3)
- Pattern to follow: resume path `chat-session.service.ts:2008` + `:2026`
- Quality requirements: read-only; JSDoc says so; every returned root passed `validateSessionPolicyRoot`; never redirects to a parent folder.
- Validation notes: R3 — must not call `upgradeLegacyLineage` or any metadata write.
- Implementation details: `async readSessionPolicyRoots(sessionId: SessionId): Promise<{ folder: string; ancestorRoots: readonly string[] }>` = `resolveSessionFolder` then `restoreLineage(sessionId, folder)`; return `{ folder, ancestorRoots: roots }`; errors propagate.

### Task 2.2: Spec for `readSessionPolicyRoots` — PENDING

- Depends on: Task 2.1
- File: CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-policy-roots.spec.ts`
- Plan reference: implementation-plan.md:181-186
- Pattern to follow: service construction in `chat-session-session-folder.spec.ts:70-160`
- Quality requirements: covers `valid` (physical roots), `legacy` distinct cwd → `[workspaceId]`, `missing` → `[]`, malformed → `SESSION_FOLDER_UNAVAILABLE`, unknown → `SESSION_NOT_FOUND`, upgrade methods never called.
- Validation notes: R3 assertion is mandatory.
- Implementation details: reuse the existing spec's mocks; no change to the existing spec.

### Task 2.3: Zod schema, optional `CHAT_TOKENS.SESSION` dependency, `sessionNoticeFor` in `registerGetConfig`, plus spec — PENDING

- Depends on: Task 2.1
- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
  - CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.session-notice.spec.ts`
- Plan reference: implementation-plan.md:191-252 (component 4)
- Pattern to follow: optional inject `chat-history-read.service.ts:44`; `CHAT_TOKENS`/type import `session-rpc.handlers.ts:74,78,199-200`; zod schemas `plugin-rpc.schema.ts:22-76`; construction `plugin-rpc.handlers.spec.ts:497-518`
- Quality requirements: zero extra work and byte-identical reply without `sessionId`; no webview path; invalid id logged by issue paths only; `RpcUserError` at debug, other errors at warn; never Sentry for notice failures; `plugins:save-config` untouched; no new DI token (`expected-resolvable.ts` untouched).
- Validation notes: R1 (own `try`, outside the Sentry-reporting body read — config body errors still rethrow and report as today); R2 (confirm `ChatSessionService` ctor graph does not depend on `PluginRpcHandlers`; report the check); R9; A3.
- Implementation details: `GetConfigParamsSchema = z.object({ sessionId: z.string().refine((id) => SessionId.validate(id)).optional() })`; trailing ctor param `@inject(CHAT_TOKENS.SESSION, { isOptional: true }) private readonly sessionRoots: Pick<ChatSessionService, 'readSessionPolicyRoots'> | null = null`; `registerMethod<PluginsGetConfigParams, PluginConfigStateWithHome>` handler takes `params`; return `{ ...config, ...(configHome && { configHome }), ...(sessionNotice && { sessionNotice }) }`; `sessionNoticeFor` early-returns `undefined` in plan order (no id → invalid → no service → no root). Spec covers the 9 cases at plan :240-249; existing `plugin-rpc.handlers.spec.ts` stays unchanged and green.

### Batch 2 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -t test,lint,typecheck -p @ptah-extension/rpc-handlers` passes; output tailed
- `git diff a7036819e -- libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` shows no change in the `plugins:save-config` handler (R9)
- R1, R2, R3 addressed with spec evidence

## Batch 3: Panel and dashboard notices — PENDING

- Recommended executor: CLI lane, Angular frontend capability (signals, templates, TestBed)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A (the visual check is the separate phase visual review, not this batch)
- Review family: different from implementer (phase review)
- Rationale: the dashboard card imports the constant the panel exports through the `chat-ui` barrel, so panel → index → card is one ordered chain.
- Tasks: 4 | Depends on: Batch 1 (committed). May run in parallel with Batch 2.
- Phase: session notice | Phase review: as Batch 1
- Verify: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/chat-ui,@ptah-extension/dashboard` (header must say "for 2 projects")

### Task 3.1: Panel session notice, post-save notice, exported `PLUGIN_SAVE_APPLIES_NOTICE` — PENDING

- File: `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
- Plan reference: implementation-plan.md:253-308 (component 5)
- Pattern to follow: `inject(TabManagerService)` at `setup-status.store.ts:58`; `rpcService.call` at panel :884; footer `saveError` at :536-537
- Quality requirements: one effect, `untracked` around the RPC so only the session id is a dependency; request counter drops stale replies; any failure → `null`; both notices `role="status"`, text only, no buttons; long paths `break-all`; first 10 overrides then "and N more"; catalog read, save payload and endpoint unchanged.
- Validation notes: R5; A1; exact copy strings from plan :259 and :271-276.
- Implementation details: signals `sessionNotice` and `savedNotice`; `savedNotice` cleared at the start of `saveConfiguration` and in `loadPlugins`, set true immediately before `this.saved.emit(...)` (:907); plugin names via `availablePlugins()` falling back to id.

### Task 3.2: Panel spec coverage — PENDING

- Depends on: Task 3.1
- File: `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts`
- Plan reference: implementation-plan.md:310-316
- Pattern to follow: `TabManagerService` stub in `setup-status.store.spec.ts:74`
- Quality requirements: stub `{ provide: TabManagerService, useValue: { activeTabSessionId: signal<SessionId | null>(null) } }` in both `TestBed` setups (:122, :432); cover null session, UUID + each notice variant, session switch with late reply, RPC failure, successful save notice with unchanged payload, failed save without notice.
- Validation notes: R6, R5, A1.
- Implementation details: drive the stub signal to switch sessions; resolve RPC promises out of order for the stale-reply case.

### Task 3.3: Re-export constant; dashboard card `onPluginsSaved` and notice — PENDING

- Depends on: Task 3.1
- Files:
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/index.ts`
  - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`
- Plan reference: implementation-plan.md:285-288 (D6)
- Pattern to follow: existing export at `chat-ui/src/index.ts:137`; card template :135-160
- Quality requirements: one source for the copy (the exported constant); notice `role="status"`; reopening the picker clears it; close button and backdrop do not show it.
- Validation notes: D6 accepted by the coordinator.
- Implementation details: `(saved)="onPluginsSaved()"` → `onPickerClosed()` then `savedNotice.set(true)`; opening the picker sets it false.

### Task 3.4: Dashboard card spec — PENDING

- Depends on: Task 3.3
- File: `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts`
- Plan reference: implementation-plan.md:317-319
- Pattern to follow: existing providers at :99
- Quality requirements: add the `TabManagerService` stub; cover `saved` closes the modal and shows the notice; close button does not show it.
- Validation notes: R6.
- Implementation details: emit `saved` from the child panel via `By.directive(PluginCatalogPanelComponent)` or the template event.

### Batch 3 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -t test,lint,typecheck -p @ptah-extension/chat-ui,@ptah-extension/dashboard` passes; output tailed
- R5 and R6 addressed with spec evidence

## Host gate (team-leader, Mode 2, after the last of Batches 2/3 commits, before NEEDS REVIEW)

Shared, agent-sdk, rpc-handlers and chat-ui changes reach every host (R2, R8). Run under the verify lock, one at a time, output tailed:

1. `npm run verify -- -t test,lint,typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` (header "for 5 projects")
2. `npm run verify -- -t typecheck -p @ptah-extension/cli-engine,@ptah-extension/core,@ptah-extension/marketplace` (header "for 3 projects")

A failure becomes a fix batch in this phase; no review request until both pass.

## Completion evidence required (Mode 3)

- UI change with no added or redesigned surface: before/after screenshots, dark + light, in Electron, of the marketplace Skills panel (with a worktree session selected) and the dashboard skill card after save. "Before" from base `a7036819e` (the main checkout), "after" from this branch.
- Parity: N/A (no surface replaced, consolidated, rebuilt or redesigned; additive read-only notices).
- Write-path trace: N/A expected — the feature writes nothing; confirm `plugins:save-config` diff is empty (R9).
