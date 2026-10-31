# Implementation Plan - FIX_PLUGIN_SESSION_ROOT (revision 2: "Notice only")

## Inputs and constraints

- Requirements used:
  - The revision brief from the coordinator. The user chose the scope "Notice only".
  - `.ptah/specs/INVESTIGATE_SKILL_OVERRIDES/report.md`, for the background to the reported failure.
  - `.ptah/specs/TASK_2026_855_d4b6/` (PR #857, `0547874dc`, already on `main`). It implements live ancestor layering of plugin config for worktree sessions.
- Corrections applied. Revision 1 of this file is superseded:
  - Removed: copy-on-launch (old components 2 and 4), session-targeted saves (old component 3, write half) and panel retargeting (old component 5, write half). With live ancestor layering on `main`, a copy or a write to the worktree root would freeze inheritance. Any id recorded at the worktree root shadows the parent forever (`plugin-loader.service.ts:224-260`).
  - Kept, but as read-only: the `sessionId` param on `plugins:get-config` and the post-save notice.
- Design handoff used: none. The change is two small notices in an existing panel and reuses its existing classes.
- Missing decision-critical input: there is no `context.md` or `task-description.md`. The brief is the requirement, and it settles scope. The open choices are recorded under `## Decisions`. None of them is reserved for the user.
- Repository rules applied (`CLAUDE.md`):
  - Electron first. VS Code and the TUI/CLI must compile and may omit the notice.
  - Verify only with `npm run verify -- -t <targets> -p <projects>`, including the host projects that depend on a changed shared lib.
  - Never run build, serve, e2e or package targets.

## Codebase evidence

All citations were checked against `a7036819e`.

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `plugins:get-config` takes `Record<string, never>` and returns `PluginConfigStateWithHome`. | `libs/shared/src/lib/types/rpc.types.ts:1360-1364` | Add an optional params field. Callers that send `{}` stay valid. |
| `PluginConfigStateWithHome = PluginConfigState & { configHome? }`, with precedent for an optional, Electron-only notice field. | `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:616-619` | Add `sessionNotice?` beside `configHome?`, with the same "absent when no notice applies" rule. |
| `plugins:save-config` params and result. | `rpc.types.ts:1365-1383` | Unchanged (requirement 1). |
| Callers of `plugins:get-config`: the shared catalog sends `{}`, and the CLI sends `{}` five times. | `libs/frontend/core/src/lib/services/plugin-catalog.service.ts:219`; `apps/ptah-cli/src/cli/commands/plugin.ts:143,199,247,276,340` | An optional field needs no caller change. The catalog stays workspace-scoped. |
| Rule: "a webview can never address a policy outside the workspace it is showing". | `libs/shared/src/lib/types/rpc/rpc-capability.types.ts:9-15` | The webview sends a session id, never a path. The backend resolves and authorizes it. |
| The handler always reads the active root: `harnessRoot()` → `resolveHarnessWorkspaceRoot(getWorkspaceRoot())`. | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:1137-1145`; get-config at `:305-341` | The project root of the notice is `harnessRoot()`. The config body read is unchanged. |
| Zod precedent and `RpcUserError('…','INVALID_PARAMS')`. | `plugin-rpc.handlers.ts:1085-1092`; `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts:76` | Same file and schema style. Decision D3 below explains why an invalid `sessionId` does not throw here. |
| Live ancestor layering: nearer layers win per id. Agent disables are not inherited. | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:224-260` (`layerAncestorConfigs`) | The notice computes "first layer that records the id wins", with the same precedence. |
| `getEffectivePluginConfig(root, { stateRoot, ancestorRoots })` reads each ancestor with `readWorkspaceLayer(root, true)`, where an error means the policy is unknown. | `plugin-loader.service.ts:1170-1252`; `readWorkspaceLayer` `:1104-1151` | The new read reuses `readWorkspaceLayer` (strict), so it never shows a layer as empty when it could not be read. |
| `storageFor(root)`: with the config home, it is the home view of `harnessRootFor(root)`. Without the home, VS Code and CLI fall back to one storage for any root. | `plugin-loader.service.ts:981-1003`; home created only when options are given and storage is workspace-scoped, `:585-612` | Only a host with a config home can read another root honestly. The new API returns `null` without a home, so VS Code and the CLI omit the notice. |
| Only Electron passes config-home options. | `apps/ptah-electron/src/activation/plugin-activation.ts:273-284` (`harnessRootOf` at `:279`) | The notice is Electron-only with no host branching. |
| Root identity: `harnessRootFor` resolves a folder to its harness root, and `canonicalRootKey` realpaths it (lower-case on win32). | `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts:320-333`, `:164-174` | Compare the session, ancestor and project roots by `canonicalRootKey(harnessRootFor(x))`, the same key the home uses (`:612-614`). |
| `pluginConfigLayer` maps lists to per-id `'on'/'off'`. A deny beats an enable. | `libs/shared/src/lib/types/capability-toggle.types.ts:259-283`; already imported by the loader at `plugin-loader.service.ts:43` | Reuse it. Do not re-derive list semantics. |
| Session lineage persists in metadata: `pluginConfigAncestorRoots`, nearest first. | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:202-203`, reader `:262-272` | The session's ancestors are durable. The panel can ask about any persisted session. |
| `ChatSessionService.restoreLineage(sessionId, executionRoot)` gives the roots that resume uses. It handles `valid`, `missing` and the `legacy` fallback (`[workspaceId]` when distinct), validates every root and rejects cycles. It does not write: the legacy upgrade is a separate step (`upgradeLegacyLineage`, `:2154`). | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:480-532` | Expose it read-only through one public method. Do not write a second lineage reader. |
| Resume and the slash path resolve the folder with `historyRead.resolveSessionFolder`, then `restoreLineage`. | `chat-session.service.ts:1347-1349,1396`; `:2008,2026` | The new method composes exactly these two calls, so the notice shows what the session's next query will resolve. |
| `resolveSessionFolder` returns the saved cwd, else `workspaceId`, after authorization, safety and existence checks. It throws `SESSION_NOT_FOUND` or `SESSION_FOLDER_UNAVAILABLE`. | `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:60-104`; `validateSessionPolicyRoot` `:21-57`; wrapper `chat-history-read.service.ts:47-60` | An unauthorized or missing folder throws, and the handler then omits the notice. A root outside the open workspaces is never read. |
| `CHAT_TOKENS.SESSION` and precedent for a handler injecting it. | `libs/backend/rpc-handlers/src/lib/chat/tokens.ts:13`; `session-rpc.handlers.ts:74,199-200` | Same token. Inject it as optional, because the CLI registers chat services inside a `try` (`libs/backend/cli-engine/src/lib/container.ts:972-973`). |
| Optional-injection precedent `@inject(TOKEN, { isOptional: true })`. | `chat-history-read.service.ts:44` | Pattern for the new trailing constructor parameter. |
| `PluginRpcHandlers` is registered in all hosts. Its spec constructs it positionally. | Electron `apps/ptah-electron/src/di/phase-4-handlers.ts:107`; VS Code `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:82`; CLI `container.ts:886`; spec `plugin-rpc.handlers.spec.ts:497-518` | Add a trailing optional parameter, so existing specs compile unchanged. No new token, so `expected-resolvable.ts` is untouched. |
| Policy is resolved once per `executeQuery`. | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1748-1754,2012-2025` | A save reaches a running session only when that session creates a new query. |
| `executeQuery` runs for: a new session (`sdk-agent-adapter.ts:1049`), a resume (`:1453`) and a slash command (`session-lifecycle-manager.ts:891-904`). A plain follow-up goes into the live query and does not re-resolve (`sdk-agent-adapter.ts:1801-1823` → `session-lifecycle-manager.ts:844-857`). A send to an inactive session auto-resumes (`chat-session.service.ts:1936,2008-2026`). | as listed | The verified trigger for the post-save copy: "the next time it starts, resumes or runs a slash command". |
| The panel never calls `plugins:get-config` itself. It reads the shared catalog (`ensureLoaded`, `catalog.config()`). | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:1080-1121` | The notice needs one extra call, made only when a session is selected. The catalog is left alone. |
| The panel's save path and success branch. | `plugin-catalog-panel.component.ts:865-921` (`saved.emit` `:906`) | Set the post-save notice where `saved` is emitted. |
| Header count and footer save area. | `plugin-catalog-panel.component.ts:210-218`, `:528-560` | Session notice under the header. Post-save notice beside `saveError`. |
| `TabManagerService.activeTabSessionId`: a computed that holds the active tab's `claudeSessionId` or `null`. Its injectable is `providedIn: 'root'`. | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:227-228,516-521`; `TabState.claudeSessionId` `libs/frontend/chat-types/src/lib/chat-types.ts:573` | "Selected session" = `activeTabSessionId()`. A draft tab gives `null`, so no notice. |
| `chat-ui` already depends on `chat-state` (`TabManagerService`). | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/setup-status.store.ts:2,58`; spec stub `setup-status.store.spec.ts:74` | No new library edge. A spec stub precedent exists. |
| `TabManagerService` injects many collaborators. | `tab-manager.service.ts:241-267` | Specs that render the real panel must stub it: the panel spec (`plugin-catalog-panel.component.spec.ts:122,432`) and the dashboard card spec (`libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts:99`). `skill-source-host.component.spec.ts:119-130` and `marketplace.routes.spec.ts:305-312` replace the panel with a stub, so they need no change. |
| The dashboard card closes its modal on `saved`. | `skill-selection-card.component.ts:147` (`(saved)="onPickerClosed()"`) | An in-panel post-save notice is destroyed at once there. The card must show the notice itself (Decision D6). |
| The e2e fixture answers `plugins:get-config` with a plain config. | `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace.fixtures.ts:968` | No `sessionNotice` in the reply means no notice. No fixture change. |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | **An override is any plugin or skill id recorded at the session's own harness root, or at an ancestor nearer than the project root.** The project's value for the id is not compared. Each override carries its value and the root that records it. | (a) Recorded nearer. (b) Recorded nearer AND different from the project's current value. | Under first-layer-wins (`plugin-loader.service.ts:237-251`), a nearer record shadows the project for that id now and for every later project save, even when the values match today. (b) would hide exactly the ids whose project edits will not reach the session, which is the confusion this notice exists to remove. | Yes. Display only. |
| D2 | **The notice API is one read-only loader method plus one read-only `ChatSessionService` method.** Existing loader APIs are reused inside them (`readWorkspaceLayer`, `harnessRootFor`, `canonicalRootKey`, `pluginConfigLayer`). | (a) A loader method `getSessionPluginNotice`. (b) The handler calls `getWorkspacePluginConfig(root)` per root and diffs it itself. | (b) cannot tell a host without a config home: `storageFor` returns the active storage for any root there (`:981-1003`), so VS Code would show the open folder's config under the session root's name. (b) also uses the lenient read (`:1078-1089`), which shows an unreadable layer as "no overrides". The loader owns home presence, root keys and layer precedence, so the method belongs beside `layerAncestorConfigs`. | Yes |
| D3 | **An invalid `sessionId` (not a UUID, wrong type) is ignored with a warning.** The config reply is returned without a notice and no error is thrown. | (a) Ignore. (b) Throw `INVALID_PARAMS` as `plugins:resolve-config-home` does. | The brief requires that an unresolvable session never breaks the panel. The field cannot change what config is read. It only adds a hint. The value is still zod-validated at the boundary and never reaches storage or the file system when invalid. | Yes |
| D4 | **When the project root is not in the session's lineage, the notice says the project's settings do not reach this session** (`inheritsProjectSettings: false`, `overrides: []`). | (a) This flag. (b) No notice. | A session started outside the project (a legacy session with no lineage, or a separate repository) reads only its own layers (`restoreLineage` `missing` → `[]`, `chat-session.service.ts:490-493`). Silence would imply that project edits reach it. | Yes |
| D5 | **Reachability is resolved through `ChatSessionService` (`historyRead.resolveSessionFolder` + `restoreLineage`).** The handler does not read metadata itself. | (a) A public read method on `ChatSessionService`. (b) Inject `SessionMetadataStore` into `PluginRpcHandlers` and re-implement the legacy fallback. | (b) duplicates the lineage rules from `:480-532` (valid, missing, legacy, cycle). The notice would drift from what resume does. (a) adds one public method of two calls. | Yes |
| D6 | **The post-save notice is shown where the user is after the save.** The panel shows it inline. The dashboard card, which closes the panel on `saved`, shows the same copy in the card. One exported constant is the single source of the text. | (a) Panel and card. (b) Panel only. | `skill-selection-card.component.ts:147` destroys the panel on `saved`. `NotificationService.upsert` drops `info`/`success` items (`libs/frontend/core/src/lib/services/notification.service.ts:71-73`), so no toast path exists. | Yes |
| D7 | **The notice follows the selected tab while the panel is open.** It is re-read when `activeTabSessionId()` changes, and a stale reply is dropped. | (a) Re-read on change. (b) Read once on load. | The panel is the marketplace's inline Skills tab (`skill-source-host.component.ts:121`), which can stay mounted while tabs change. One RPC per change, with nothing else kept alive. | Yes |
| D8 | Out of scope: copy-on-launch, session-targeted saves, `harness:set-skill-selection`, recreating idle queries, and the VS Code and TUI notice. | | Brief | |

No decision needs the user. D1 changes only what is displayed. If the user prefers (b), the change is one filter in the loader method.

## Architecture decision

- **Chosen approach.**
  1. `plugins:get-config` accepts an optional `sessionId`. It answers with the same config as today, plus an optional `sessionNotice` when the selected session reads a different harness root than the project.
  2. `ChatSessionService.readSessionPolicyRoots(sessionId)` returns the session's execution folder and ancestor roots, exactly as its next resume resolves them. It is read-only.
  3. `PluginLoaderService.getSessionPluginNotice(sessionFolder, ancestorRoots, projectRoot)` answers `null` when there is no config home or when the roots are the same. Otherwise it returns the session root, whether the project is inherited, and the shadowing ids.
  4. The panel asks for the notice for `activeTabSessionId()` and renders it read-only. After a successful save, the panel shows the "running sessions" notice inline, and the dashboard card shows it after closing the panel.
- **Rationale.**
  - It honours live inheritance: nothing is written outside the project's root.
  - It tells the user the one thing ancestor layering hides: which ids the session's folder decides for itself.
  - It states, accurately, when a running session picks up a save.
- **Rejected alternatives.** See D2, D5 and D6. Also rejected: making `PluginCatalogService` session-aware. It is shared with the chat empty state and the dashboard counts (`plugin-catalog.service.ts:17-55`).
- **Assumptions.**
  - A1: Session ids in `TabState.claudeSessionId` are SDK UUIDs, so `SessionId.validate` (`libs/shared/src/lib/types/branded.types.ts:73-75`) accepts them. Check: the panel spec feeds a UUID. A non-UUID only loses the notice (D3).
  - A2: Mapping a physical (realpathed) lineage root through `harnessRootFor` gives the same harness root as mapping the workspace path. Check: the loader spec includes a symlinked-alias case, mirroring `plugin-loader.service.capabilities.spec.ts:330-340`.
- **Effect on existing code.**
  - Unchanged: `plugins:save-config`, the shared catalog, the CLI, the resolver, policy layering, and VS Code/TUI behaviour (they get no notice).
  - Added: optional types, one loader method, one `ChatSessionService` method, one optional handler dependency, two notices in the panel, and one notice in the dashboard card.

## Component specifications

### 1. Shared contract (`sessionId` param, `sessionNotice` result)

- **Purpose.** The wire shape of the read-only session notice.
- **Responsibilities.** In `rpc-misc.types.ts`, next to `PluginConfigStateWithHome` (`:616-619`):
  - `PluginsGetConfigParams { sessionId?: string }`. Document it as: "The selected session (SDK id). Read-only hint; never changes which configuration is returned."
  - `PluginSessionOverride { kind: 'plugin' | 'skill'; id: string; value: 'on' | 'off'; root: string }`. `root` is the harness root that records the id.
  - `PluginSessionNotice` has these fields:
    - `sessionRoot: string`: the session's own harness root.
    - `inheritsProjectSettings: boolean`.
    - `overrides: PluginSessionOverride[]`, sorted by `kind`, then by `id`.
    - `incomplete: boolean`: a nearer layer could not be read.
  - `PluginConfigStateWithHome` gains `sessionNotice?: PluginSessionNotice`. It is absent when no notice applies and on hosts without the config home.
  - In `rpc.types.ts:1360-1364`, `'plugins:get-config'.params` becomes `PluginsGetConfigParams`, and the comment names both Electron-only fields.
- **Verified contracts.**
  - `PluginConfigStateWithHome`: `rpc-misc.types.ts:616-619`.
  - Barrel re-export: `rpc.types.ts:24`.
  - The method entry: `rpc.types.ts:1360`.
- **Dependencies.** None new. `shared` stays a leaf.
- **Integration points.** Handler (component 4), loader (component 2) and panel (component 5). `{}` callers compile unchanged.
- **Failure behaviour.** Not applicable (types).
- **Quality requirements.** Every new field is optional or new. No existing field changes.
- **Verification seam.** `typecheck` of `shared` and of every dependent host (see the handoff).
- **Files.**
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc.types.ts`

### 2. Loader read: `PluginLoaderService.getSessionPluginNotice`

- **Purpose.** Say which plugin and skill choices a session's nearer folders make for themselves, using the layering rules the session's policy uses.
- **Responsibilities.**
  - Signature: `getSessionPluginNotice(sessionFolder: string, ancestorRoots: readonly string[], projectRoot: string): PluginSessionNotice | null`. It is synchronous and never writes.
  - Return `null` when `this.configHome === null`. That is every host without the D14 home (VS Code, CLI/TUI).
  - Compute keys with `key(x) = canonicalRootKey(this.configHome.harnessRootFor(x))`. The keys are `sessionKey`, `projectKey` and one per ancestor.
  - Return `null` when `sessionKey === projectKey`: the session reads the project's own root.
  - Nearer layers:
    - `[sessionFolder, ...ancestorRoots]`, de-duplicated by key, in order.
    - Stop before the first entry whose key equals `projectKey`.
    - When no entry matches, `inheritsProjectSettings = false` and `overrides = []`. The layers are still read to set `incomplete`.
  - For each nearer layer, call `this.readWorkspaceLayer(layer, true)` (the strict read, `:1104`):
    - On error, set `incomplete = true`, log a warning naming the root and skip the layer.
    - On success, walk `pluginConfigLayer(config)`. The first layer that records an id wins, as in `layerAncestorConfigs`. Push `{ kind, id, value, root: harnessRootFor(layer) }`.
  - Agent ids are excluded, because they are not inherited (`:223`).
  - Return `{ sessionRoot: harnessRootFor(sessionFolder), inheritsProjectSettings, overrides (sorted), incomplete }`.
- **Verified contracts and entry points.**
  - `configHome` field: `plugin-loader.service.ts:535`.
  - `readWorkspaceLayer`: `:1104-1151`.
  - `layerAncestorConfigs`, the precedence to mirror: `:224-260`.
  - `harnessRootFor`: `plugin-config-home.ts:320`.
  - `canonicalRootKey`: `plugin-config-home.ts:164`, already imported at `plugin-loader.service.ts:77`.
  - `pluginConfigLayer`: imported at `:43`.
- **Dependencies.** Within `agent-sdk`, plus the `shared` types. No new edge.
- **Integration points.** Called only by `PluginRpcHandlers` (component 4).
- **Failure behaviour.**
  - Never throws for an unreadable layer. It reports `incomplete` instead.
  - `harnessRootFor` already degrades to the folder itself when it fails (`plugin-config-home.ts:321-331`).
  - An unexpected throw propagates. The handler catches it (component 4).
- **Quality requirements.** One synchronous storage read per nearer layer. Lineages are short (one or two roots). No caching.
- **Verification seam.** CREATE `plugin-loader.service.session-notice.spec.ts`. Build the loader with a config home using the setup at `plugin-loader.service.spec.ts:1602-1760` (`harnessRootOf` at `:1726`, options at `:1747`). Cover:
  1. No home → `null`.
  2. Session root equals project root → `null`.
  3. Worktree with no local record and lineage `[project]` → `{ inheritsProjectSettings: true, overrides: [], incomplete: false }`.
  4. Worktree records `pluginA: on`, `skillX: off` → both listed with `root` = worktree. The project's value is irrelevant (an equal value is still listed, D1).
  5. Grandchild with lineage `[child, project]`: child records `skillY`, local records `skillY` → one entry with the local root (nearest wins). The child-only id is listed with the child root.
  6. Project not in lineage → `inheritsProjectSettings: false`, `overrides: []`.
  7. A malformed nearer layer → `incomplete: true`, the other layers are still listed and nothing throws.
  8. `disabledAgentIds` at the worktree → not listed.
  9. An alias or symlinked spelling of the project root in the lineage → treated as the project (A2).
- **Files.**
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
  - CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.session-notice.spec.ts`

### 3. Session reach read: `ChatSessionService.readSessionPolicyRoots`

- **Purpose.** Expose, read-only, the folder and plugin-policy ancestors a persisted session will use on its next query.
- **Responsibilities.**
  - `async readSessionPolicyRoots(sessionId: SessionId): Promise<{ folder: string; ancestorRoots: readonly string[] }>`:
    1. `folder = await this.historyRead.resolveSessionFolder(sessionId)`, as at `:1347-1349` and `:2008`.
    2. `{ roots } = await this.restoreLineage(sessionId, folder)`, as at `:1396` and `:2026`.
    3. Return `{ folder, ancestorRoots: roots }`.
  - It must not call `upgradeLegacyLineage` and must not write metadata. JSDoc states that it is a read.
- **Verified contracts and entry points.**
  - `restoreLineage`: `chat-session.service.ts:480-532`.
  - `historyRead`: `:272-273`.
  - `resolveSessionFolder`: `chat-history-read.service.ts:47-60`.
- **Dependencies.** None new.
- **Integration points.** `PluginRpcHandlers` through `CHAT_TOKENS.SESSION` (`tokens.ts:13`).
- **Failure behaviour.** It throws what the two calls throw: `RpcUserError` `SESSION_NOT_FOUND` / `SESSION_FOLDER_UNAVAILABLE`, or a metadata-store error. It never redirects to a parent folder (`session-folder.ts:59`).
- **Quality requirements.** Security: every returned root has passed `validateSessionPolicyRoot` (authorized, safe, exists).
- **Verification seam.** CREATE `chat-session-policy-roots.spec.ts`, building the service as `chat-session-session-folder.spec.ts:70-160` does. Cover:
  - `valid` lineage → the stored roots, physical;
  - `legacy` with a distinct cwd → `[workspaceId]`;
  - `missing` → `[]`;
  - malformed → rejects `SESSION_FOLDER_UNAVAILABLE`;
  - unknown session → rejects `SESSION_NOT_FOUND`;
  - `upgradePluginConfigAncestorRoots`/`upgradeLegacyPluginConfigAncestorRoots` on the metadata mock is never called.
- **Files.**
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  - CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-policy-roots.spec.ts`

### 4. `plugins:get-config` session notice (`PluginRpcHandlers`)

- **Purpose.** Attach the read-only notice for a selected session, without ever failing the config read because of it.
- **Responsibilities.**
  - **Schema.** In `plugin-rpc.schema.ts`, add `GetConfigParamsSchema = z.object({ sessionId: z.string().refine((id) => SessionId.validate(id)).optional() })`. Import `SessionId` from `@ptah-extension/shared`.
  - **Dependency.** Add an optional trailing constructor parameter:
    - `@inject(CHAT_TOKENS.SESSION, { isOptional: true }) private readonly sessionRoots: Pick<ChatSessionService, 'readSessionPolicyRoots'> | null = null`.
    - Use `import type { ChatSessionService } from '../chat/session/chat-session.service'` (precedent `session-rpc.handlers.ts:78`) and `import { CHAT_TOKENS } from '../chat/tokens'` (precedent `:74`).
  - **`registerGetConfig`** (`:305-341`):
    - Type its params as `PluginsGetConfigParams`.
    - The body read and `configHome` stay exactly as today.
    - Then call `sessionNotice = await this.sessionNoticeFor(params)` and return `{ ...config, ...(configHome && { configHome }), ...(sessionNotice && { sessionNotice }) }`.
  - **Private `sessionNoticeFor(params): Promise<PluginSessionNotice | undefined>`** returns `undefined` in each of these cases, in order:
    1. `params` is absent or has no `sessionId`.
    2. `GetConfigParamsSchema.safeParse(params ?? {})` fails. Log a warning with the issue paths only, not the value (D3).
    3. `sessionRoots` is null.
    4. `harnessRoot()` is undefined (no folder open).

    Otherwise:
    - Inside `try`, read `{ folder, ancestorRoots } = await sessionRoots.readSessionPolicyRoots(SessionId.from(id))`, then return `pluginLoader.getSessionPluginNotice(folder, ancestorRoots, projectRoot) ?? undefined`.
    - On any error, log at debug for an `RpcUserError`, at warn otherwise, and return `undefined`. Do not send it to Sentry: an expected unresolvable session is not a defect.
- **Verified contracts and entry points.**
  - Get handler: `plugin-rpc.handlers.ts:305-341`.
  - `harnessRoot()`: `:1137-1145`.
  - Constructor: `:199-236`.
  - `RpcUserError`: already imported at `:43`.
  - Schema file: `plugin-rpc.schema.ts:15-16,76`.
- **Dependencies.**
  - `handlers` → `chat`, inside `rpc-handlers` (a type plus a token, with precedent).
  - `rpc-handlers` → `agent-sdk` (existing). No new library edge.
- **Integration points.** Registration is unchanged in all hosts (`phase-4-handlers.ts:107`, `phase-3-handlers.ts:82`, `container.ts:886`). VS Code and the CLI get `null` from the loader, so they show no notice.
- **Failure behaviour.**

  | Case | Reply |
  | --- | --- |
  | No `sessionId` | today's reply, byte-identical |
  | Invalid `sessionId` | today's reply, a warning is logged, no throw |
  | `SESSION_NOT_FOUND` / `SESSION_FOLDER_UNAVAILABLE` / malformed lineage | today's reply, no notice |
  | Chat services not registered (CLI failure path) | today's reply, no notice |
  | Host without a config home | today's reply, no notice |
  | Same root as the project | today's reply, no notice |
  | A nearer layer is unreadable | notice with `incomplete: true` |
  | Config body read throws | unchanged: rethrown and reported to Sentry, as today (`:330-340`) |

- **Quality requirements.**
  - Security: the webview sends no path. The session's roots pass `validateSessionPolicyRoot`, and a root outside the open workspaces is never read.
  - Performance: zero extra work when no `sessionId` is sent.
- **Verification seam.** CREATE `plugin-rpc.handlers.session-notice.spec.ts`, which leaves the 2400-line spec untouched. Reuse the construction at `plugin-rpc.handlers.spec.ts:497-518`, plus a trailing `sessionRoots` stub and a `getSessionPluginNotice` mock on the loader. Cover:
  - no `sessionId` → reply equals today's and `readSessionPolicyRoots` is not called;
  - a valid id → `getSessionPluginNotice` gets `(folder, ancestorRoots, harnessRoot())`, and the reply carries `sessionNotice`;
  - the loader returns `null` → no `sessionNotice` key;
  - `readSessionPolicyRoots` rejects with an `RpcUserError` → config returned, no notice, `sentry.captureException` not called;
  - a generic `Error` → config returned and a warning logged;
  - an invalid id (`'x'`, `42`) → config returned, no notice, no throw;
  - `sessionRoots` null → config returned, no notice;
  - no open folder → no notice;
  - `configHome` and `sessionNotice` can be present together.
- **Files.**
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
  - CREATE `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.session-notice.spec.ts`

### 5. Panel and dashboard notices (`chat-ui`, `dashboard`)

- **Purpose.** Show, read-only, which choices the selected session's folder makes for itself, and say when a save reaches running sessions.
- **Responsibilities.**
  - **Copy constant**, exported from the panel file and re-exported from `libs/frontend/chat-ui/src/index.ts`:

    > `PLUGIN_SAVE_APPLIES_NOTICE` = "Saved. New sessions use these settings. A session that is already running keeps its current skills until it starts a new query: when it is resumed or runs a slash command."

  - **Panel state.**
    - `private readonly tabs = inject(TabManagerService)`, as at `setup-status.store.ts:58`.
    - `readonly sessionNotice = signal<PluginSessionNotice | null>(null)`.
    - `readonly savedNotice = signal(false)`.
  - **Notice read (D7).** One constructor `effect` reads `this.tabs.activeTabSessionId()`:
    - `null` → set `sessionNotice` to `null`.
    - Otherwise, increment a request counter and call `rpcService.call('plugins:get-config', { sessionId }, { timeout: 10000 })`. Apply `result.data?.sessionNotice ?? null` only if the counter is unchanged.
    - Any failure or rejection → `null`.
    - Use `untracked` around the RPC so that only the session id is a dependency.
  - **Session notice template.** Put a `role="status"` block under the header (`:210-218`), shown only when `sessionNotice()` is set:
    - If `inheritsProjectSettings` is false: "This session runs in {sessionRoot}. It does not use this project's plugin settings."
    - Else, if `overrides` is empty: "This session runs in {sessionRoot} and uses this project's plugin settings."
    - Else: "This session runs in {sessionRoot}. Its folder sets these itself, so changes here do not reach this session:", followed by a list.
      - Each entry shows the plugin name (looked up in `availablePlugins()` by id, falling back to the id) or the skill id, with "on" or "off".
      - Show the first 10 entries, then "and N more".
    - If `incomplete` is true, add: "Some of this session's folder settings could not be read."
    - Long paths use `break-all`.
    - The block is read-only: no buttons.
  - **Save.** `saveConfiguration` (`:865-921`):
    - Clear `savedNotice` at the start.
    - Set it to true immediately before `this.saved.emit(...)` (`:906`).
    - Render `PLUGIN_SAVE_APPLIES_NOTICE` in the footer next to `saveError` (`:536-538`), with `role="status"`.
    - `loadPlugins` clears it.
    - Payload, endpoint and catalog refresh are unchanged.
  - **Dashboard card (D6).**
    - In `skill-selection-card.component.ts`, change `(saved)` (`:147`) to call a new `onPluginsSaved()`. It runs `onPickerClosed()` and then sets a `savedNotice` signal.
    - The card renders `PLUGIN_SAVE_APPLIES_NOTICE` (`role="status"`) while `savedNotice` is true.
    - Opening the picker again clears it.
- **Verified contracts and entry points.**
  - `ClaudeRpcService.call`: in use at `plugin-catalog-panel.component.ts:883-887`.
  - `activeTabSessionId`: `tab-manager.service.ts:516-521`.
  - `saveConfiguration`: `:865-921`.
  - `loadPlugins`: `:1080`.
  - Header: `:210-218`.
  - Footer: `:528-560`.
  - Dashboard host: `skill-selection-card.component.ts:135-160`.
- **Dependencies.**
  - `chat-ui` → `chat-state`, `core` and `shared` (all existing).
  - `dashboard` → `chat-ui` (existing: it already renders `PluginCatalogPanelComponent`).
- **Integration points.**
  - The marketplace Skills tab (`skill-source-host.component.ts:121`) needs no change.
  - The VS Code webview gets no `sessionNotice`, so only the post-save notice appears. That notice is host-neutral and accurate there too, because the same `executeQuery` funnel is used.
- **Failure behaviour.**
  - The notice RPC fails or times out → no notice. The panel's load and save paths are independent of it.
  - A draft tab or no tab → no notice.
- **Quality requirements.**
  - Accessibility: both notices use `role="status"`, are text-only and need no colour to carry meaning.
  - Runtime: one effect, no timers, no observers, and one RPC per change of the selected session.
- **Verification seam.**
  - `plugin-catalog-panel.component.spec.ts`: add `{ provide: TabManagerService, useValue: { activeTabSessionId: signal<SessionId | null>(null) } }` to both `TestBed` setups (`:122`, `:432`), then cover:
    - `null` session → no `plugins:get-config` call with `sessionId`, and no notice;
    - a UUID → one call with `{ sessionId }`, and each notice variant renders (overrides list, empty, not inherited, incomplete, "and N more");
    - switching the session id re-queries and ignores a late reply from the earlier id;
    - an RPC failure → no notice and the panel still loads;
    - after a successful save, `PLUGIN_SAVE_APPLIES_NOTICE` is shown and the `plugins:save-config` payload is unchanged;
    - after a failed save, no notice is shown.
  - `skill-selection-card.spec.ts`: add the same stub at `:99`, then cover:
    - `saved` closes the modal and shows the notice;
    - the close button does not show it.
- **Files.**
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/index.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`
  - MODIFY `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts`

## Integration architecture

- **Data flow (Electron).**
  1. The panel's effect sees `activeTabSessionId() = S` and calls `plugins:get-config { sessionId: S }`.
  2. The handler reads the config body and `configHome` exactly as today.
  3. The handler validates `S` with zod, then calls `ChatSessionService.readSessionPolicyRoots(S)`:
     - `resolveSessionFolder`: authorized, safe, exists;
     - `restoreLineage`: validated, physical, cycle-free.
  4. The handler calls `pluginLoader.getSessionPluginNotice(folder, ancestors, harnessRoot())`, which compares harness-root keys, reads the nearer layers strictly and applies first-wins.
  5. The reply is `{ ...config, configHome?, sessionNotice? }`. The panel renders the notice, read-only.
  6. The user saves. `plugins:save-config` is unchanged and writes the project root.
  7. The panel shows `PLUGIN_SAVE_APPLIES_NOTICE`. A running session picks up the project change at its next `executeQuery`, through ancestor layering, unless the id is in its overrides list.
- **State or persistence.** None new. Nothing is written. The panel's signals live only as long as the component.
- **External boundaries.** The webview sends only a zod-validated UUID. Every root read on its behalf passes `validateSessionPolicyRoot`.
- **Failure and rollback.** Each notice failure degrades to "no notice". Nothing needs rolling back, because the feature writes nothing.
- **Observability.**
  - The handler logs a warning for an invalid id or an unexpected error.
  - The loader logs a warning for an unreadable nearer layer, naming the root.
  - Expected `RpcUserError`s are logged at debug only.

## Architecture-level quality requirements

- **Functional.**
  - F1: In Electron, with a worktree session selected whose worktree root records `ptah-core: off`, the panel shows `ptah-core` as set by the session's folder, together with the worktree path.
  - F2: A worktree session with no local record shows "uses this project's plugin settings".
  - F3: With no session selected, an unresolvable session, or the VS Code/CLI host, the panel looks and saves exactly as today, apart from the post-save notice.
  - F4: After a successful save, the post-save notice is visible in the marketplace panel and in the dashboard card.
  - F5: No code path writes to any root other than the project's (`plugins:save-config` is untouched).
- **Performance.** One extra RPC per change of the selected session. Zero extra work for `{}` callers.
- **Security.** No webview path. Only validated, authorized roots are read. No secrets or config bodies are logged.
- **Maintainability.**
  - No duplicate lineage reader (D5).
  - Precedence logic lives beside `layerAncestorConfigs`.
  - No new library edges, no new DI tokens, and no `vscode-core` imports in `agent-sdk`.
- **Testability.** Every row of the component 4 failure table, every loader case in component 2, and each panel notice variant has a spec.

## Team-leader handoff

- **Recommended executors.**
  - Components 1 and 2: `backend-developer`. Shared types and agent-sdk logic.
  - Components 3 and 4: `backend-developer`. rpc-handlers DI and zod.
  - Component 5: `frontend-developer`. Angular signals and templates.
- **Complexity:** LOW-MEDIUM. Read-only, additive, no persistence. The only subtle parts are root-key comparison and first-wins precedence.
- **Dependencies and ordering.**
  - Components 3 and 4 and component 5 need component 1's types. Component 4 needs components 2 and 3.
  - Suggested file-disjoint grouping (at most 6 files each). The team-leader owns the final batching.
    - **Group A** (`backend-developer`): components 1 and 2. Four files: `rpc-misc.types.ts`, `rpc.types.ts`, `plugin-loader.service.ts`, `plugin-loader.service.session-notice.spec.ts`.
    - **Group B** (`backend-developer`), after A: components 3 and 4. Five files: `chat-session.service.ts`, `chat-session-policy-roots.spec.ts`, `plugin-rpc.schema.ts`, `plugin-rpc.handlers.ts`, `plugin-rpc.handlers.session-notice.spec.ts`.
    - **Group C** (`frontend-developer`), after A: component 5. Five files: panel `.ts` and `.spec.ts`, `chat-ui/src/index.ts`, dashboard card `.ts` and `.spec.ts`.
- **Parallel-safe work.** Groups B and C are file-disjoint and can run in parallel after A.
- **Files affected.**
  - CREATE:
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.session-notice.spec.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-policy-roots.spec.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.session-notice.spec.ts`
  - MODIFY:
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc/rpc-misc.types.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/shared/src/lib/types/rpc.types.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/chat-ui/src/index.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts`
    - `/home/amun/ptah-extension/.claude-worktrees/plugin-session-root/libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.spec.ts`
  - REWRITE: none.
- **Verification points.**
  - Contracts to honour:
    - `plugins:save-config` and its handler are not touched at all. `git diff` shows no change in `plugin-rpc.handlers.ts:358-525`.
    - `getSessionPluginNotice` uses `readWorkspaceLayer(…, true)`, not `getWorkspacePluginConfig`.
    - `readSessionPolicyRoots` never calls `upgradeLegacyLineage`.
    - The `{}` reply of `plugins:get-config` is unchanged (existing `plugin-rpc.handlers.spec.ts:637-660,1512-1555` stay green).
  - Scoped checks per group:
    - Group A: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk`
    - Group B: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/rpc-handlers`
    - Group C: `npm run verify -- -t test,lint,typecheck -p @ptah-extension/chat-ui,@ptah-extension/dashboard`
  - Host and dependent check, once after all groups, because the shared, agent-sdk, rpc-handlers and chat-ui changes reach every host:
    - `npm run verify -- -t test,lint,typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`
    - `npm run verify -- -t typecheck -p @ptah-extension/cli-engine,@ptah-extension/core,@ptah-extension/marketplace`
    - Confirm each header reads "Running target … for N projects" with the expected N.
  - The pre-push di-lint and Electron `validate-deps` gates must pass. No new DI token is added, so `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` needs no change.
