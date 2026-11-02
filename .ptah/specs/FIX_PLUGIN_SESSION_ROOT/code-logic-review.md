# Code Logic Review: FIX_PLUGIN_SESSION_ROOT

**Verdict**: APPROVED
**Score**: 8/10
**Findings**: 0 Critical, 0 Serious (Major), 2 Moderate, 1 Minor
**Failure Modes**: 2

---

## Executive Summary

The three commits on `fix/plugin-session-root` (`63ee81910`, `4de60afe3`, `0a80ecca1`) implement read-only session policy-root inspection (`ChatSessionService.readSessionPolicyRoots`), nearer-layer plugin/skill override detection (`PluginLoaderService.getSessionPluginNotice`), an optional `sessionId` parameter on `plugins:get-config` (`PluginRpcHandlers.registerGetConfig` / `sessionNoticeFor`), and session-root + post-save notices in `PluginCatalogPanelComponent` and `SkillSelectionCardComponent`.

The core design decisions from `implementation-plan.md` are faithfully implemented:
- `plugins:save-config` remains completely untouched and continues writing strictly to the project's `PluginConfigHome` record (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:404-460`).
- `ChatSessionService.readSessionPolicyRoots` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-547`) is strictly read-only and does not trigger `upgradeLegacyLineage` or `saveResumeState`.
- `PluginLoaderService.getSessionPluginNotice` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1031-1097`) walks `[sessionFolder, ...ancestorRoots]` using the same `PluginConfigHome.harnessRootFor(root)` and `realpathSync.native` canonicalization as `getEffectivePluginConfig` (`plugin-loader.service.ts:1241-1309`), stops at `projectKey`, and flags `incomplete: true` when `restoreLineage` marks `lineageComplete === false` or when any nearer layer fails to read.

No blocking or serious defects were found. Two moderate issues (a transient stale `sessionNotice` across session-to-session tab switches while the new RPC is in flight, and un-realpathed `folder` return from `resolveSessionFolder` before lexical marker ascent) and one minor issue (repeated warning logs when inspecting a legacy session before it is resumed) are documented below.

---

## Five Logic Questions

1. **Where does an empty / null / undefined input travel?**
   - **Omitted or `undefined` `params` / `sessionId` in `plugins:get-config`**: `GetConfigParamsSchema` (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts:18-24`) accepts `{ sessionId?: NonEmptyString }.optional()`. In `PluginRpcHandlers.registerGetConfig` (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:328, 357-363`), `params?.sessionId` is passed to `sessionNoticeFor(sessionId, contextRoot)`: when `!sessionId || !this.chatSession`, it returns `undefined` immediately without calling `chatSession` or `pluginLoader.getSessionPluginNotice`, and `sessionNotice` is omitted from the response (`plugin-rpc.handlers.ts:346`).
   - **Unknown, corrupt, or non-existent `sessionId` / `workingDirectory`**: `ChatHistoryReadService.resolveSessionFolder(sessionId)` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:49-65`) delegates to `resolveSessionFolder` (`libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:61-81`). Missing metadata (`null`), empty `workingDirectory` and `workspaceId`, non-existent path on disk (`fs.realpath` rejection), or non-directory returns `null`. `readSessionPolicyRoots` (`chat-session.service.ts:541-543`) returns `null`, `sessionNoticeFor` (`plugin-rpc.handlers.ts:365-372`) returns `undefined`, and `plugins:get-config` still succeeds with project config and no `sessionNotice`.
   - **Null `activeTabSessionId()` on the frontend**: `PluginCatalogPanelComponent` (`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:800-808`) increments `this.sessionNoticeRequestId` and calls `this.sessionNotice.set(null)` synchronously inside `untracked()` when `sessionId === null`, preventing any late in-flight RPC from repopulating `sessionNotice`.

2. **Where does the collection size, index, or boundary break?**
   - **Empty `ancestorRoots`**: When `ancestorRoots` is `[]` and `sessionRoot` equals `projectRoot` (`keyOf(sessionFolder) === projectKey`), `getSessionPluginNotice` (`plugin-loader.service.ts:1049-1059`) sees `key === projectKey` on the first iteration of `[sessionFolder, ...ancestorRoots]`, sets `inheritsProjectSettings = true`, and `break`s immediately. With `!differsFromProject && overrides.length === 0 && !incomplete`, line `1082` returns `null`.
   - **Duplicate or nested paths inside the same worktree/harness root**: `seenRoots` (`plugin-loader.service.ts:1048, 1054-1061`) keys each entry by `canonicalRootKey(home.harnessRootFor(layer))`, deduplicating multiple subdirectories that resolve to the same harness root before reading `readWorkspaceLayer(layer, true)`.
   - **Deterministic ordering**: `overrides` are sorted by `root` then `kind` (`'plugin'` before `'skill'`) via `localeCompare` (`plugin-loader.service.ts:1075-1078`), and `ids` within each entry are sorted via `[...ids].sort()` (`plugin-loader.service.ts:1074`).

3. **Which two callers can overlap on the same state?**
   - **Initial `loadPlugins()` vs `effect()` watching `tabs.activeTabSessionId()` in `PluginCatalogPanelComponent`**: `ngOnInit` calls `loadPlugins()` (`plugin-catalog-panel.component.ts:848, 1192-1279`), which calls `rpcService.call('plugins:get-config', undefined)` and updates `this.plugins`, `this.enabledIds`, `this.disabledIds`, `this.enabledSkills`, `this.disabledSkills`, and `this.configHome`, without touching `this.sessionNotice`. Concurrently, the constructor `effect()` (`plugin-catalog-panel.component.ts:800-823`) calls `rpcService.call('plugins:get-config', { sessionId })` and updates only `this.sessionNotice` guarded by `requestId === this.sessionNoticeRequestId`. The two callers write to disjoint signals, so `loadPlugins()` cannot clobber `sessionNotice` and `effect()` cannot clobber user-edited checkbox selections.
   - **Rapid tab switches (`Session A -> Session B`)**: Sequence counter `this.sessionNoticeRequestId` (`plugin-catalog-panel.component.ts:687, 802, 813, 818`) drops late responses from earlier tabs. However, when switching from `Session A` (with a non-null `sessionNotice`) to `Session B` (non-null `sessionId`), `this.sessionNotice` is not cleared before starting `Session B`'s RPC call (see **M-1**).
   - **Read vs write path on `SessionMetadata`**: `readSessionPolicyRoots` (`chat-session.service.ts:540-547`) only reads `sessionMetadataStore.get(sessionId)` and validates paths via `fs.realpath`/`fs.stat`; it never writes to `SessionMetadataStore`, so it cannot race with `resumeSession`, `runSlashCommand`, or `saveResumeState`.

4. **What happens when a dependency fails partway through?**
   - **`readSessionPolicyRoots` throws**: Caught in `PluginRpcHandlers.sessionNoticeFor` (`plugin-rpc.handlers.ts:365-371`), logged at `warn` with `{ sessionId, error }`, and returns `undefined` so `plugins:get-config` still returns the project's plugin configuration.
   - **Nearer `PluginConfigHome` layer unreadable or corrupt**: `readWorkspaceLayer(layer, true)` (`plugin-loader.service.ts:1173-1223`) returns `{ config: null, ok: false }`. `getSessionPluginNotice` (`plugin-loader.service.ts:1062-1065`) sets `anyUnreadable = true` and `continue`s, resulting in `incomplete: true` (`plugin-loader.service.ts:1080, 1094`) so the user sees the incomplete-lineage warning banner (`plugin-catalog-panel.component.ts:266-270`).
   - **`getSessionPluginNotice` throws unexpectedly**: Caught in `sessionNoticeFor` (`plugin-rpc.handlers.ts:378-398`), logged at `warn`, and returns `undefined`.
   - **Frontend RPC rejection or timeout**: `.catch()` in `PluginCatalogPanelComponent` (`plugin-catalog-panel.component.ts:817-821`) clears `this.sessionNotice.set(null)` if `requestId === this.sessionNoticeRequestId`.

5. **Does the caller enforce the trust boundary?**
   - **RPC boundary**: `GetConfigParamsSchema` (`plugin-rpc.schema.ts:18-24`) validates `sessionId` with `NonEmptyString` (`z.string().trim().min(1)`) under `validateParams(GetConfigParamsSchema, params)` (`plugin-rpc.handlers.ts:322-326`). The renderer passes only `sessionId` (never filesystem paths); all filesystem paths (`folder`, `ancestorRoots`, `contextRoot`) are resolved server-side from `SessionMetadataStore` and `WorkspaceContextService` and validated through `validateSessionPolicyRoot` (`session-folder.ts:44-59`, rejecting device roots and verifying directory existence).

---

## Failure Modes

### FM-1: Session-to-session tab switch leaves previous tab's `sessionNotice` visible while new RPC is in flight
- **Trigger**: User has the Plugins panel open on Tab A (a worktree session with a rendered `sessionNotice`) and clicks Tab B (a main-project session or a different worktree session) while the backend takes >0 ms (up to the 10,000 ms timeout) to resolve `plugins:get-config` for Tab B.
- **Location**: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:800-823`
- **Symptom**: Until Tab B's `plugins:get-config` call settles, the banner in `PluginCatalogPanelComponent` continues to display Tab A's `sessionRoot` and nearer overrides under Tab B.

### FM-2: Symlinked `workingDirectory` pointing into a worktree subdirectory misses worktree marker during lexical walk
- **Trigger**: `SessionMetadata.workingDirectory` is a symlink `/tmp/wt-subdir-link` pointing to `/repo/.claude-worktrees/wt1/packages/app` (a subdirectory inside a worktree where `.git` is at `/repo/.claude-worktrees/wt1/.git`, not above `/tmp`).
- **Location**: `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:75-81`, `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-547`, `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1039`
- **Symptom**: `resolveSessionFolder` validates `/tmp/wt-subdir-link` with `validateSessionPolicyRoot` (which resolves `realpath`), but discards the returned physical path and returns the un-realpathed `candidate`. `home.harnessRootFor(sessionFolder)` then runs `resolveHarnessWorkspaceRoot('/tmp/wt-subdir-link')` (`libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:71`), which walks parent directories lexically (`/tmp/wt-subdir-link` -> `/tmp` -> `/`) before `canonicalRootKey` calls `realpathSync.native`, missing `/repo/.claude-worktrees/wt1/.git`.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### [M-1] MODERATE — `sessionNotice` is not cleared when switching directly between two persisted session tabs
- **File & Line**: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:800-823` (and test in `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.spec.ts:567-601`)
- **Scenario**:
  1. Tab 1 (`sessionId = 'session-wt-a'`) resolves `plugins:get-config` with a `sessionNotice` for `/repo/.claude-worktrees/wt-a`, and the amber banner renders.
  2. The user switches to Tab 2 (`sessionId = 'session-main'`).
  3. In the `effect()` at `plugin-catalog-panel.component.ts:804-810`:
     ```ts
     untracked(() => {
       if (sessionId === null) {
         this.sessionNotice.set(null);
         return;
       }

       void this.rpcService
         .call('plugins:get-config', { sessionId }, { timeout: 10000 })
     ```
     `this.sessionNotice` is only cleared when `sessionId === null`. When `sessionId` transitions from `'session-wt-a'` to `'session-main'`, the old `sessionNotice` from `'session-wt-a'` remains set until the new RPC promise settles (up to 10s).
  4. In `plugin-catalog-panel.component.spec.ts:567-601`, the test `"re-queries on a session switch and ignores the earlier late reply"` switches from `FIRST_SESSION_ID` to `SECOND_SESSION_ID` before `firstDeferred` resolves, so it does not cover switching away after a notice has already rendered.
- **Impact**: Stale session-root banner from the previous tab remains visible under the new tab while the RPC is in flight.
- **Concrete Fix**: Clear `this.sessionNotice.set(null)` unconditionally at the start of `untracked()` before checking `if (sessionId === null) return;`, and add an assertion in `plugin-catalog-panel.component.spec.ts` that switching from a resolved session tab to another session tab clears the previous banner immediately while the second RPC is pending.

### [M-2] MODERATE — `resolveSessionFolder` / `readSessionPolicyRoots` returns un-realpathed `folder` string despite JSDoc contract
- **File & Line**: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-547` and `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts:75-81`
- **Scenario**:
  1. `readSessionPolicyRoots` (`chat-session.service.ts:540`) is documented as `/** Read the session's physical folder and validated policy ancestors without changing metadata. */`.
  2. However, `resolveSessionFolder` (`session-folder.ts:75-80`) calls `await validateSessionPolicyRoot(candidate, workspaceProvider, platformInfo)` (which returns the `fs.realpath`-resolved `physical` path at `session-folder.ts:54-59`) and discards the return value, returning `candidate` instead.
  3. Meanwhile, `restoreLineage` (`chat-session.service.ts:360-388, 491-525`) uses the `physical` return value of `validateSessionPolicyRoot` for every entry in `ancestorRoots`.
  4. When `getSessionPluginNotice(sessionFolder, ancestorRoots, projectRoot)` (`plugin-loader.service.ts:1039`) calls `home.harnessRootFor(sessionFolder)`, `resolveHarnessWorkspaceRoot` (`workspace-root.ts:71`) walks upward lexically (`path.dirname(path.resolve(cwd))`) before `canonicalRootKey` applies `fs.realpathSync.native`. If `sessionFolder` is a symlink to a subdirectory inside a worktree, lexical ascent walks the symlink's parent directory rather than the physical worktree's parent directory.
- **Impact**: Symlinked session working directories pointing to a subdirectory of a worktree can fail to resolve to the enclosing worktree root and display the un-realpathed path in `sessionNotice.sessionRoot`.
- **Concrete Fix**: Have `resolveSessionFolder` return the `physical` string returned by `await validateSessionPolicyRoot(candidate, workspaceProvider, platformInfo)` (or apply `realpath` before `resolveHarnessWorkspaceRoot`).

### [m-1] MINOR — Inspecting a legacy worktree session logs a `[RPC] Legacy session policy lineage has unknown earlier ancestors` warning on every tab switch
- **File & Line**: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:530-537, 540-547`
- **Scenario**: For a pre-lineage session where `metadata.pluginConfigAncestorRoots === undefined` and `workingDirectory !== workspaceId`, `readSessionPolicyRoots` calls `restoreLineage(sessionId, folder)`. Because `readSessionPolicyRoots` intentionally does not upgrade metadata, `restoreLineage` hits line `531` (`this.logger.warn('[RPC] Legacy session policy lineage has unknown earlier ancestors', { sessionId })`) every time the user switches tabs with the Plugins panel open until that session is actually resumed or runs a slash command.
- **Impact**: Repeated warning log noise during read-only UI inspection of legacy sessions; no functional or state corruption.
- **Concrete Fix**: Pass an optional `{ quiet?: boolean }` or `{ logIncompleteWarning?: boolean }` flag from `readSessionPolicyRoots` to `restoreLineage`, or log at `debug` on the read-only inspection path.

---

## Data Flow

1. **Active session tab -> RPC request**:
   - `PluginCatalogPanelComponent` (`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:660, 800-823`) reads `this.tabs.activeTabSessionId()` inside an Angular `effect()`.
   - When `sessionId === null`, `sessionNotice` is set to `null` (`:805-807`).
   - When `sessionId` is non-null, it calls `this.rpcService.call('plugins:get-config', { sessionId }, { timeout: 10000 })` (`:810-811`), guarded by monotonic `this.sessionNoticeRequestId` (`:687, 802, 813, 818`).
2. **RPC validation & handler dispatch**:
   - `PluginRpcHandlers.registerGetConfig` (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:316-355`) validates `params` against `GetConfigParamsSchema` (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts:18-24`), resolves `contextRoot = this.workspaceContext.WorkspaceRoot`, fetches project-level `getEffectivePluginConfig(contextRoot)` and `getPluginConfigHomeInfo(contextRoot)`, and calls `this.sessionNoticeFor(params?.sessionId, contextRoot)` (`:328`).
3. **Read-only session lineage resolution**:
   - `sessionNoticeFor` (`plugin-rpc.handlers.ts:357-399`) returns `undefined` if `!sessionId || !this.chatSession || !contextRoot`.
   - Otherwise it calls `this.chatSession.readSessionPolicyRoots(sessionId)` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-547`), which calls `this.historyRead.resolveSessionFolder(sessionId)` and `this.restoreLineage(sessionId, folder)` without mutating `SessionMetadataStore`.
4. **Nearer-layer notice calculation**:
   - `PluginLoaderService.getSessionPluginNotice(roots.folder, roots.ancestorRoots, contextRoot, { lineageComplete: roots.lineageComplete })` (`libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1031-1097`) computes `sessionRoot = home.harnessRootFor(sessionFolder)` and `projectKey = canonicalRootKey(home.harnessRootFor(projectRoot))`.
   - It iterates `[sessionFolder, ...ancestorRoots]`, deduplicating by `canonicalRootKey(home.harnessRootFor(layer))`, stopping when `key === projectKey` (`inheritsProjectSettings = true`), and reading each nearer layer via `readWorkspaceLayer(layer, true)`.
   - Enabled and disabled plugin and skill IDs at each nearer layer are collected into `PluginSessionOverride` entries (`plugin-loader.service.ts:1069-1078`).
   - If `!differsFromProject && overrides.length === 0 && !incomplete`, it returns `null` (`:1082`); otherwise it returns `PluginSessionNotice` (`:1085-1096`).
5. **UI rendering & post-save notice**:
   - `PluginCatalogPanelComponent` renders the `data-testid="plugin-session-notice"` callout (`plugin-catalog-panel.component.ts:228-273`), resolving plugin display names via `sessionPluginName(id)` (`:840-845`) and listing overrides and incomplete warnings.
   - On save (`saveConfiguration`, `plugin-catalog-panel.component.ts:975-1033`), `plugins:save-config` writes to the project config home as before, and `this.savedNotice.set(true)` (`:1018`) displays `PLUGIN_SAVE_APPLIES_NOTICE` (`:82-83, 593-601`).
   - `SkillSelectionCardComponent` (`libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts:62-63, 125-133, 226-234`) listens to `(saved)="onPluginsSaved()"` on `<ptah-plugin-catalog-panel>`, sets `savedNotice = signal(false)` to `true`, renders `data-testid="skill-card-save-applies-notice"`, and resets `savedNotice` when the dialog is reopened (`onPickerOpened()`).

---

## Requirements Fulfilment

| Requirement (`implementation-plan.md` / `batches.md`) | Status | Evidence |
| --- | --- | --- |
| Keep `plugins:save-config` targeting the open project's `PluginConfigHome` record (no worktree writes from project panel) | Met | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:404-460` unchanged in diff |
| Extend `plugins:get-config` with optional `{ sessionId?: string }` and optional `sessionNotice?: PluginSessionNotice \| null` on `PluginConfigStateWithHome` | Met | `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:610-657`, `libs/shared/src/lib/types/rpc.types.ts:674, 1383-1386`, `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts:18-24` |
| Add read-only `ChatSessionService.readSessionPolicyRoots(sessionId)` without calling `upgradeLegacyLineage` or writing metadata | Met | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:540-547`, verified in `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-policy-roots.spec.ts:221-229` |
| Add `PluginLoaderService.getSessionPluginNotice` walking `[sessionFolder, ...ancestorRoots]` up to `projectRoot`, reporting all nearer IDs (D1) and `incomplete` when lineage or a nearer layer is unreadable | Met | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:1031-1097`, verified in `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.session-notice.spec.ts:52-196` |
| Inject `CHAT_TOKENS.SESSION` optionally in `PluginRpcHandlers` without DI cycle or host bootstrap breakage | Met | `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:240-244`; verified across Electron (`apps/ptah-electron/src/di/phase-4-handlers.ts:95, 107`), VS Code (`apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:68, 82`), and CLI (`libs/backend/cli-engine/src/lib/container.ts:886, 973`) |
| Render `sessionNotice` banner in `PluginCatalogPanelComponent` reactive to `tabs.activeTabSessionId()` with stale-reply protection | Met (with M-1 on session-to-session transition) | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:228-273, 687, 800-823` |
| Render `PLUGIN_SAVE_APPLIES_NOTICE` in `PluginCatalogPanelComponent` footer and `SkillSelectionCardComponent` after save | Met | `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/plugin-catalog-panel.component.ts:82-83, 593-601, 1018`, `libs/frontend/dashboard/src/lib/components/skill-selection-card/skill-selection-card.component.ts:125-133, 226-234` |

---

## Edge Cases

| Edge Case | Handled? | Notes & Location |
| --- | --- | --- |
| `plugins:get-config` called with `undefined` params | Yes | `GetConfigParamsSchema` is `.optional()`; returns project config without `sessionNotice` (`plugin-rpc.handlers.ts:328, 346`) |
| Session runs in the project root with no nearer overrides and complete lineage | Yes | `getSessionPluginNotice` returns `null` (`plugin-loader.service.ts:1082`); `PluginCatalogPanelComponent` renders no banner |
| Session runs in the project root (`differsFromProject === false`) with `lineageComplete === false` | Yes | Returns `PluginSessionNotice` with `inheritsProjectSettings: true, overrides: [], incomplete: true` (`plugin-loader.service.ts:1082-1095`), and template renders generic header `"This session has an incomplete settings lineage."` (`plugin-catalog-panel.component.ts:241-243`) |
| Session runs in a worktree that inherits project settings and has nearer plugin/skill overrides | Yes | Returns `inheritsProjectSettings: true` and sorted `overrides` (`plugin-loader.service.ts:1066-1095`) |
| Session runs in an external directory that does not contain `projectRoot` in its lineage (`inheritsProjectSettings === false`) | Yes | Loop completes without hitting `projectKey`; returns `inheritsProjectSettings: false, overrides: []` (`plugin-loader.service.ts:1088-1093`) |
| Nearer worktree layer has corrupt/unreadable storage | Yes | `readWorkspaceLayer(layer, true)` returns `ok: false`; sets `anyUnreadable = true` -> `incomplete: true` (`plugin-loader.service.ts:1062-1065, 1080`) |
| Active tab switches from session to draft tab (`null`) while RPC is in flight | Yes | Increments `sessionNoticeRequestId` and sets `sessionNotice.set(null)` immediately (`plugin-catalog-panel.component.ts:802-808`) |
| Active tab switches from Session A (with rendered notice) to Session B while Session B RPC is in flight | Partial (M-1) | Late replies from Session A are ignored via `sessionNoticeRequestId`, but Session A's banner remains visible until Session B's RPC resolves (`plugin-catalog-panel.component.ts:804-816`) |
| `SessionMetadata.workingDirectory` is a symlink to a subdirectory inside a worktree | Partial (M-2) | `resolveSessionFolder` returns un-realpathed `candidate` (`session-folder.ts:79`) before `resolveHarnessWorkspaceRoot`'s lexical ascent |

---

## Review Family, Tooling, and Skill Notes

- **Review Family**: Code Logic Review (`code-logic-reviewer`).
- **Skill Availability**: The workspace instructions reference `angular-frontend-patterns` and `nx-workspace-architect`; neither skill is present in the host's skill catalogue (which lists only `agy-customizations` and `antigravity-guide`). Per the role's Skill Use policy, those absent skills were not reconstructed from memory and the review proceeded using the repository's own instruction files and code conventions.
- **Ptah Tool Notes**: `ptah_search_files` was used for file discovery. `ptah_code_search_symbols` returned 0 hits (`symbolCount: 0` in the worktree index), so targeted `read_file` inspections were used as the fallback.
