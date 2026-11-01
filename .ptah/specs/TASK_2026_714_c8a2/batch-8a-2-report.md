# Batch 8a-2 — Part A done; Part B stopped at the scope limit

Part A (ProviderInfo) is implemented and can be committed on its own. Part B (Electron binding) was
**not implemented**. A correct binding needs at least one lib change and more than six Electron
files, which is the stop condition in the batch brief. No Electron source file was changed. The
gaps below are verified against source and need a team-leader or coordinator decision.

Paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`.

## Part A — ProviderInfo decision

- Decision: add `'codex-app-server'` to the shared `ProviderId`. The name matches the native
  execution runtime value (`routing-agent-adapter.ts:93`, `session-metadata-store.ts:78`,
  `workspace-provider-profile-resolver.ts:129`).
- Ripple audit: the only users of the shared `ProviderId` are `ai-provider.types.ts` itself and
  `sdk-agent-adapter.ts:17,119,131`, which assigns `'claude-cli'`. Nothing builds a
  `Record<ProviderId, …>` value: the only `Record<ProviderId, …>` is the `getAllProviderHealth`
  signature in the same file, with no implementer. `web-search-config.component.ts:27` declares
  its own local `ProviderId`. The `tribunal-run-framing.ts:270` switch is over lane kinds, not
  `ProviderId`. `ai-provider.types.spec.ts` iterates `PROVIDER_IDS`, so it covers the new value
  with no edit.
- Files changed (2, no extra files needed):
  - MODIFIED `libs/shared/src/lib/types/ai-provider.types.ts`: union, `isValidProviderId`,
    `PROVIDER_IDS`.
  - MODIFIED `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.spec.ts`:
    the fixture `info.id` is now `'codex-app-server'` (was `'ptah-cli'`).
- The native adapter's ProviderInfo in the Electron binding should use
  `id: 'codex-app-server'`. That binding is not written yet (Part B).

## Part B — why it stopped

Each item below is required by the 8a acceptance list or by the brief, and each falls outside
"max 6 files, apps/ptah-electron only".

1. **Lib gap: no reviewed executable pin is exported.**
   `createElectronCodexScopeFactory` needs a `CodexExecutableManifestRow`
   (`apps/ptah-electron/src/di/codex-runtime-composition.ts:63`). The only source is
   `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.manifest.json`, which
   has one win32/x64 row. `libs/backend/codex-runtime/src/index.ts` exports the row type only,
   not a value or a lookup. Importing the JSON from a host would be a deep import, which the
   boundary rule forbids. Needed: a codex-runtime export of the reviewed row(s), for example a
   lookup by platform and arch that returns undefined when there is no row.
2. **The binding has to be async, and Electron DI setup is synchronous.**
   `ElectronDIContainer.setup` (`apps/ptah-electron/src/di/container.ts:38-48`) and
   `registerPhase2Libraries` (`phase-2-libraries.ts:186`) are synchronous. The identity lookup
   needs `await initializeSessionRuntimeIdentityLookup(store, logger)`, and the store reads
   session metadata. It can therefore run only after workspace state storage is ready
   (`activation/bootstrap.ts:457`) and before the first resolution of `TOKENS.AGENT_ADAPTER` /
   `ROUTING_AGENT_ADAPTER`. That first resolution happens in `registerRpcSurface`
   (`activation/wire-runtime.ts:332`) or in `startAgentAdapterInitialization`
   (`bootstrap.ts:153-157`). The guard (`agent-sdk/.../codex-runtime-composition.ts:23-70`)
   snapshots the bindings at that point and throws `unstable-binding` on any later change, so a
   late bind is not possible. This needs `activation/bootstrap.ts` (await the bind step after
   :493, where WEBVIEW_MANAGER is registered, because the host-ports factory needs the webview
   manager) and an owner for `lookup.dispose()` and scope close on quit
   (`activation/shutdown.ts`). The batch plan's "phase-2-libraries.ts (awaited identity init)"
   cannot be met as written.
3. **The permission reply route is in batch 8b's file.** Answering Codex approvals through the
   returned `handlePermissionResponse` means changing `apps/ptah-electron/src/ipc/ipc-bridge.ts:416`,
   which today calls `SdkPermissionHandler.handleResponse` directly. Batch 8b owns that file.
   Without the change, a Codex approval reply reaches the Claude handler and is dropped.
4. **G4 cannot be composed from existing observers.** `CodexChatEventCallbacks`
   (`agent-sdk/.../codex-chat-events.ts:30-47`) carries data that never appears in the stream:
   final reasoning content (`:152-160`), compaction phases (`:209-210`), file, image and approval
   live events (`:212-216`), and error text (`:267`). No rpc-handlers observer consumes any of
   these. A grep over `libs/backend/rpc-handlers/src` finds none, and `setResultStatsCallback` /
   `setCompactionStartCallback` have no caller outside the adapters themselves. Composing G4
   therefore means writing new presentation observers, which the brief rules out. Decision
   needed: either (A) a small rpc-handlers batch that maps these callbacks onto existing
   broadcaster messages (reasoning and compaction become stream events, live becomes the
   permission or file messages), or (B) a log-only callback with the gaps recorded. A is
   recommended: with B, native reasoning and compaction disappear from the UI.
5. **G3 needs a host-side record that is not yet designed for inactive sessions.**
   `settings(sessionId)` (`native-session-controls.ts:35`) can be recorded by wrapping
   `ports.profile()`, which returns model, effort, permission and workspace for open sessions.
   The record also needs the provider settings namespace (`authKey`), and the mapping from
   `seed.providerId` to `authKey` is not exposed by the profile result. Inactive sessions have
   only providerId and workspaceId in the identity record, with no model or effort. This is
   feasible in the host but adds a file and a decision about what inactive sessions read.
6. **Account usage.** No concrete `CodexHomeAuthReader` exists. Only the interface exists, in
   `codex-runtime/src/lib/codex-home-auth-reader.ts`. `usage: null` is allowed
   (`codex-runtime/src/lib/di/registration.ts:20-25`), but it leaves "explicit-home auth-file
   invalidation" (carried P5 logic 6) unmet.
7. **Eager throws.** `createElectronCodexScopeFactory` throws at creation time when the bundled
   binary is missing or the binary identity does not match (`codex-runtime-composition.ts:47,
   :51-53, :76-78`). The binary identity also has to be measured (sha256 plus `--version`), which
   is async. Calling the factory during startup would therefore break Electron startup wherever
   the platform package is not bundled. That includes every non-win32-x64 target: Electron
   depends only on `@openai/codex-sdk` (`apps/ptah-electron/package.json:16`), and asar unpacking
   of the platform binary is unverified (R4). The binding must create the scope factory lazily,
   only when `capabilities.nativeCodex` is true, which today means unpackaged plus
   PTAH_CODEX_RUNTIME_DEV=1, because `CodexParityGate.isEnabled` always returns false
   (`codex-parity-gate.ts:193-224`).

Minimum honest scope for the binding: codex-runtime-composition.ts (bind function, lazy scope,
G3 record), its spec, bootstrap.ts, shutdown.ts, expected-resolvable.ts, container.smoke.spec.ts,
rpc-surface.spec.ts and surface-composition.spec.ts. That is 8 Electron files plus the codex-runtime
manifest export (lib), ipc-bridge.ts (8b) and a G4 decision.

### Recommended split

- 8a-2a (lib, codex-runtime): export the reviewed manifest row lookup. Optionally add a binary
  identity measurer on `IProcessSpawner`, or keep it host-side.
- 8a-2b (rpc-handlers, if G4 option A): a callbacks factory over the existing
  `ChatStreamBroadcaster` and webview messages.
- 8a-2c (Electron, the 8 files above): an async `bindElectronCodexChat(container, { isPackaged:
  app.isPackaged, env: process.env, ... })` called from bootstrap after :493, with literal
  `container.register(SDK_TOKENS.X, { useValue })` for SESSION_RUNTIME_IDENTITY_LOOKUP,
  CODEX_CHAT_ADAPTER_PORTS, RUNTIME_ADMISSION_PORT, RUNTIME_HOST_CAPABILITIES,
  NATIVE_SESSION_CONTROLS and LEGACY_SESSION_CONTROL_PORTS; dispose on quit.
- Fold the ipc-bridge `handlePermissionResponse` hop into 8b, which already owns that file.

## 8a acceptance list — status

| Item | Status | Evidence / reason |
| --- | --- | --- |
| Electron passes `app.isPackaged` verbatim to `readCodexDevRouteOverride` (DS1); no other host passes a non-null devRoute | Factory only | `codex-runtime-composition.ts:28-32` passes input verbatim; the `app.isPackaged` call site is not written (Part B blocker 2). |
| Bundled codex binary path (R4) | Factory only | `codex-runtime-composition.ts:42-55`; packaging of the platform binary is unverified (blocker 7); pin unavailable (blocker 1). |
| Router native-off by default | Holds today | Gate is always disabled (`codex-parity-gate.ts:193-224`); `registerCodexChatServices` defaults every port to null (`agent-sdk/src/lib/di/register.ts:990-1008`). |
| `await initializeSessionRuntimeIdentityLookup` before first resolution; bind stable instances | Not done | Blocker 2. |
| Literal `container.register(TOKEN, …)` for every injected token (di-lint) | Not done | Depends on the bind step (blocker 2). |
| Native controls with `canSendFollowUp` and own persistence; exactly one write (FM-R5) | Factory only (8a-1) | `native-session-controls.ts:155-250` (`canSendFollowUp` :238; save queue :75-128); binding and G3 source missing (blocker 5). |
| Build the validated CodexExecutionProfile; no second model notice | Factory only (8a-1) | `codex-chat-host-ports.ts:212-249`; no notice is published there. |
| Bound controls own effort rollback (FM-R2) | Factory only (8a-1) | `native-session-controls.ts:187-206`; not bound. |
| Permission restore scope drift (FM-R6/M2); overlapping model switches; `runtime-admission-mismatch` error code | Not addressed | Outside this batch's files; the error code lives in `libs/shared` rpc-error-codes.types.ts. |
| Audits: direct SDK_AGENT_ADAPTER users, broadcaster cleanup, same session in two tabs, pending-resume cleanup, cancel during `prepare()`, notice `message_complete` vs queued content | Not performed | They audit the bound composition, which does not exist yet. Run them with 8a-2c. |
| Identity store from `createCodexThreadIdentityStore(lookup, metadataStore)` | Not done | Blocker 2 (needs the awaited lookup). |
| CodexChatEventCallbacks from existing observers (G4) | Blocked | Blocker 4. |
| Permission replies via `handlePermissionResponse` | Blocked | Blocker 3 (ipc-bridge.ts is 8b's file). |

## Decisions

- Add `'codex-app-server'` to `ProviderId` rather than reusing `'ptah-cli'`. Options: add the
  value, or reuse the routing adapter's legacy id. Evidence: the ripple audit above (2 files).
  Reversible: yes.
- Stop Part B instead of expanding it. Options: expand to 8+ files plus a lib export, or stop and
  report. Evidence: the brief's stop rule and blockers 1-4. Reversible: yes; nothing was written.

## Verification

- Part A: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers`: 6 tasks,
  6 succeeded (lint, test and typecheck for both projects), exit 0.
- Part A, because the change touches shared: `npm run verify -- -t typecheck -p
  ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`: 4 tasks, 4 succeeded, exit 0.
- Part B: none ran (`-p ptah-electron`, di-lint), because no Part B source changed.
