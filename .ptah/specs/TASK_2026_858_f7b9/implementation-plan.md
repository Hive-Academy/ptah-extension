# Implementation Plan - TASK_2026_858_f7b9

Remote workers and a mobile-first Ptah PWA. Phase 0 and Phase 1 are batch-ready. Phases 2-4
are at component and contract level. The plan follows the **recommended** answers to U1-U5
(option 1 each). "What changes under each U1-U5 alternative" lists the deltas, and nothing in
Phase 1 rules out an alternative. Revision 1 answers `implementation-plan-review.md`; the
mapping is in the "Revision log" at the end.

Verdict headline: build a worker service as a `ptah worker` command group on the existing CLI
composition root. It gets a new loopback WebSocket protocol with its own small method table, a
log-before-send event log, and a fail-closed cross-process driver lock. The lock is held by the
kernel as a per-session local socket, so it needs no native module and is released when its
process dies. Electron's main process reaches the worker over `ssh -W`, and the renderer keeps
`ClaudeRpcService` over IPC. Revision 2 answers the "Round 1 re-review"; revision 3 answers the "Round 2 re-review" and records the Gate 2 answers; revision 4 is the post-approval drift amendment; revision 5 applies the user's answer (decisions.md row 14) that the driver lock also protects native Codex sessions (AD-25), and locks the rewind path (see the Revision log).

> **Round 6 (2026-11-04) supersedes every `apps/ptah-cli`, `ptah-tui`, `ptah-extension-vscode`,
> `platform-vscode`, `ptah-video-studio`, `ptah-license-server` and `ptah worker …` reference
> below.** Those hosts were removed on `main` (1cee6fafe); the worker is now a headless,
> node-mode process of the desktop package (`ptah-worker` launcher → `worker-host.mjs` on
> cli-engine; decisions.md row 19). Read "Round 6 — headless Electron worker host" at the end
> first; its R6.0 table maps each superseded line to its replacement.

## Inputs and constraints

- Requirements used: `task-description.md` (Gate 1 approved), `task-description-review.md`
  (round 2 Minor: local grant extension), `context.md`, `decisions.md`.
- Corrections applied: the review Minor gets the local command
  `ptah worker grants add <tokenId> <workspace...>` (C6/C7, AD-12). The Gate 2 review
  `implementation-plan-review.md` round 1 is applied throughout (see "Revision log").
- Design handoff used: `design-spec.md`, `design-spec-review.md` (one Minor), `prototype/README.md`.
- Council inputs: `../council-remote-machines/HANDOFF.md`, `P1-critique.md`, `P2-critique.md`.
- Missing decision-critical input:
  - Phase 0 numbers (resource budget). This plan proposes formulas and default caps; the user
    approves the numbers after Phase 0.
  - Design 4.9 (a remotely answerable permission block on a session that the worker's desktop
    app drives) needs a capability that Phase 1 does not have. The plan does not change the
    approved design on its own: the user chooses at Gate 2 between a revised design (watch-only)
    and a desktop-to-worker bridge (C11). Answered 2026-11-01: (a) watch-only. C10 waits for the
    designer's revision of 4.9 and screen 9 and its review (Clarifications Q1).
  - U1-U5, the attempts-count copy, and fleet consent are open (Clarifications Needed).

## Project rules (bind every batch, repeat in every lane prompt)

> Round 6: the worktree is `/home/amun/ptah-extension/.claude-worktrees/remote-workers-v2`
> (branch `feat/remote-workers-v2`). The TUI and VS Code hosts no longer exist; the compile rule
> for them lapses. Shared-lib changes verify ptah-electron, ptah-extension-webview and mcp-bench
> as the Nx graph requires (R6.5).

- Electron first. Build and verify for `apps/ptah-electron` first. No feature or polish work for
  the TUI (`apps/ptah-tui`) or the VS Code extension. Keep every host compiling; when a shared
  lib changes, run typecheck and tests for each dependent host.
- Verification only with `npm run verify -- -p <changed projects>` (extra Nx/Jest flags after a
  second `--`). Never workspace-wide checks, never `nx run-many` across unchanged projects,
  never `build`, `serve`, `dev`, `e2e` or `package` targets. The Phase 0 *measurement run* is a
  separate read-only command, not a verification.
- Git: only the coordinating agent commits, pushes and manages the PR, in the task worktree
  `/home/amun/ptah-extension/.claude-worktrees/remote-workers`. Lanes never run git.
- No code changes before the user approves this plan at Gate 2.
- No fleet operation (installing software on a worker, copying config, rebinding Ollama) without
  the user's answer (O1-O6, Clarifications Q4).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Verified: the CLI container builds the full backend graph headless and registers the RPC surface through `registerRpcSurface(container, createCliRpcHostProfile(host))` | `libs/backend/cli-engine/src/lib/container.ts:405-430,974-984` (`registerRpcSurface(container, createCliRpcHostProfile(host))` at :984) | The worker reuses this composition root. |
| Verified: `CliBootstrapOptions` takes `pushAdapter`, `host: 'cli' \| 'tui'`, `bootstrapMode` | `container.ts:170-205` | Add one option, `hostProfile`. |
| Verified: `withEngine` forwards `pushAdapter`, defaults Thoth to `'off'`, and starts cron/gateway/memory only when Thoth is on | `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:258-270,379-391`; `thoth-runtime.ts:145-160` | With `thoth: 'off'` the worker does not start a second cron or gateway beside the desktop app. |
| Verified: `withEngine` switches permissions to `yolo` on `--auto-approve` / `PTAH_AUTO_APPROVE=true` | `with-engine.ts:353-372` | The worker refuses to start in that mode. |
| Verified: CLI profile = backend parity, UI capabilities off | `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:17-49` | The worker's in-process surface copies it; remote exposure is a separate table. |
| Verified: Electron profile turns every capability on | `apps/ptah-electron/src/rpc-host-profile.ts:19-91`; call at `apps/ptah-electron/src/activation/wire-runtime.ts:336-339` | The capability document (1.2) lists each Electron capability. |
| Verified: `HostProfile.host` union; host-owned handlers keyed `host.*` | `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:41-64`; `manifest.ts:543,550` | Add `'worker'`; add `host.remoteMachines`. |
| Verified: `deriveRpcSurface` is pure and returns the in-process partition; host handlers are resolved, `register()` is called, and a failure only warns | `register-rpc-surface.ts:57-70,141,183-196` | The drift tests use `deriveRpcSurface` for the in-process surface only (Minor 1). |
| Verified: one capability per subsystem; omitted keys default to `false` | `rpc-handlers/src/lib/host-profile/capabilities.ts:1-18` | `remoteMachines` is off everywhere except Electron. |
| Verified: `RpcHandler.handleMessage` returns `success: true` whenever a handler returns, and maps a thrown `RpcUserError` | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:199-260` | Success at this layer does not mean the chat operation succeeded (S3). |
| Verified: `ChatSessionService` catches errors and returns `{ success: false, error, errorCode? }` from start/continue/resume; `chat:start` success carries no `sessionId` | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1119-1135,1743-1770,1967-1994` (catch blocks of `startSession` :986, `continueSession` :1531, `resumeSession` :1778); `ChatStartResult` `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:151-159`; `ChatContinueResult` `:207-216` | The worker needs a per-method result adapter. The session ID arrives by `session:id-resolved`. |
| Verified: `chat:resume` gates the account, reads metadata and hydrates subagent state before returning history | `chat-session.service.ts:1785-1790,1822-1840` | Not usable as a read-only transcript (A3 withdrawn). |
| Verified: `ChatHistoryReadService.readForResume(sessionId)` resolves the folder and calls `SessionHistoryReaderService.readSessionHistory` → `{ events, stats, staleSnapshot? }` | `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:31-77`; `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:17,346` | Read-only history source for baselines and watch-only snapshots. |
| Verified: the CLI push adapter de-batches and emits synchronously | `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:64-80,111-124` | The tap is synchronous. The ordering guarantee lives in the worker's capture queue, not in the tap (S2). |
| Verified: the CLI chat bridge drives turns by `chat:start`/`chat:continue` and listens to `chat:chunk`/`chat:complete`/`chat:error` keyed by `tabId` | `apps/ptah-cli/src/cli/session/chat-bridge.ts:104-140,381-383` | The worker drives sessions the same way with worker-owned tab IDs. |
| Verified: permission requests carry `id`, `toolName`, `toolInput`, `timeoutAt` (0 = none), optional `sessionId`/`tabId`; answers go to `ISdkPermissionHandler.handleResponse` | `libs/shared/src/lib/types/permission.types.ts:30-81,89-115`; `libs/backend/cli-engine/src/lib/transport/cli-fire-and-forget-handler.ts:27-45` | Pending index by request ID; the handler is process-local. |
| Verified: session registry removal points | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:356-390` (rebind), `:444-455` (`remove`), `:676-690` (`evictStale`), `:775-790` (`displaceExisting`); `onSessionEvicted` covers only idle sweeps (`session-lifecycle-manager.ts:581-587`); `endSession`/`disposeAllSessions`/`disposeAllSessionsForShutdown` at `:736-795` | The lock is released through one new registry-removal notification fired at every removal point (B1). |
| Verified: the native Codex adapter owns its sessions outside `SessionRegistry`, opens through one path and removes through one path | `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:141` (own map), `:257-322` (`open`: `prepareProfile` :283, `openContext` :286, thread ID :287, `sessions.opened` :293, `persistMetadata` :295, `publishSession` :299, first turn :301, catch :305-317), `:117-137` (optional synchronous `CodexChatSessionLifecycle`); `codex-chat-session-controls.ts:87-105` (`close`, the only removal); `routing-agent-adapter.ts:87-117,218-232` | The native lifecycle points are an async gate on `open` and a release in `close` (W10 "Native Codex runtime", C4c). |
| Verified: CLI and worker have no native runtime | `apps/ptah-cli/src/di/expected-resolvable.ts:20-35` (native chat tokens and identity lookup `null`, `nativeCodex: false`); `libs/backend/agent-sdk/src/lib/di/register.ts:1003-1015,1086-1091` | The worker refusal of native sessions is a capability limit; it must read session metadata, not the `null` lookup (C6). |
| Verified: `sessions.sqlite` is a file of its own; Electron and the CLI both open it; registered by `registerSessionStoreServices` from `apps/ptah-electron/src/di/phase-1-infra.ts` and `libs/backend/cli-engine/src/lib/container.ts` | `libs/backend/persistence-sqlite/src/lib/session-store/session-store-db-path.ts:5-31`; `session-store-database.ts:13-27` | The worker reads sessions through this store. The worker therefore needs `better-sqlite3` loadable no matter how the lock is built (next row). |
| Verified: `better-sqlite3@13.0.3` declares `engines.node >=22`; the CLI declares `node >=20.12` and depends on `^13.0.3`; the binding is loaded by a lazy `require` | `node_modules/better-sqlite3/package.json` (`{"node":">=22"}`); `apps/ptah-cli/package.json:44-45,61`; `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:792-800` | The lock must not depend on it (round-2 Blocking). The worker's real runtime floor is Node 22, because of the session store. The published `engines` floor was a user decision (Q6), answered 2026-11-01: raise to `>=22` (C0). |
| Verified: Electron rebuilds native modules against its own ABI for the listed projects | `scripts/native-abi-projects.json` (`persistence-sqlite`, …, `ptah-electron`) | Unchanged by this plan; the new lock has no native binding, so it adds no ABI concern. |
| Verified: null-object defaults for host-optional ports are registered in `vscode-core` only when absent | `libs/backend/vscode-core/src/di/register-platform-agnostic.ts:80-90` | VS Code gets a null lock (no session store there); Electron/CLI smoke specs assert the real lock is bound. |
| Verified: `chat:resume` consults `ISessionAttachmentGuard` | `chat-rpc.handlers.ts:278-283`; `session-attachment-guard.interface.ts:22-29` | Precedent for a platform-core port checked by the shared chat path. |
| Verified: `AttachedSessionRegistry` is in-memory | `libs/backend/messaging-gateway/src/lib/attached-session-registry.ts:1-44` | Not a cross-process guard; left unchanged. |
| Verified: `IHttpServerProvider` has no upgrade hook | `libs/backend/platform-core/src/interfaces/http-server-provider.interface.ts:48-75` | The worker owns its `http.Server` (AD-4). |
| Verified: `ws@8.21.0` resolves but is undeclared ("extraneous") | `npm ls ws` | C0 declares it in root and `apps/ptah-cli/package.json` (`thirdParty: false`, `apps/ptah-cli/project.json`). |
| Verified: CLI = npm package `@hive-academy/ptah-cli`, bin `ptah`, `engines.node >=20.12` | `apps/ptah-cli/package.json` | Phase 1 install is `npm i -g`; Horus has Node 20. |
| Verified: `ISecretStorage`; Electron uses safeStorage and falls back to plain text without a keyring | `platform-core/src/interfaces/secret-storage.interface.ts:9-26`; `platform-electron/src/implementations/electron-secret-storage.ts:1-12`; `PLATFORM_TOKENS.SECRET_STORAGE` (`tokens.ts:22`) | Client tokens live there; the fallback is risk AR5. |
| Verified: `ClaudeRpcService` posts through `VSCodeService` | `libs/frontend/core/src/lib/services/claude-rpc.service.ts:108-118,247-266` | Reused unchanged over IPC (AD-6). |
| Verified: `MESSAGE_HANDLERS` multi-provider | `libs/frontend/core/src/lib/services/message-router.types.ts:5-46` | Machines feed. |
| Verified: surface IDs; Tasks lazy route and navbar tab | `libs/shared/src/lib/types/webview-surface.types.ts:48-62` (`ViewType`, which still carries the legacy aliases), `:71-81` (`SURFACE_ROUTE_IDS`), `:92-122` (legacy alias map); `apps/ptah-extension-webview/src/app/app.routes.ts:142-147` (Tasks route, `SURFACE_ACTIVE` from `surfaceActiveFor('tasks')`); `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:233` (navbar `hasWorkspaceFolders()` guard), `:385-388` (welcome branch), `:431` (second no-folder branch) | Machines surface copies Tasks. Both files were reworked after the plan base; executors re-read them (Round 4; anchors re-checked Round 5). |
| Verified: module boundaries | `eslint.config.mjs:293-450` | Tags in "Library placement". |
| Verified: `type:tool` projects with a Jest `test` target exist | `tools/mcp-bench/project.json` (`tags: ["type:tool"]`, targets `test`, `typecheck`, `lint`) | The Phase 0 sampler becomes a `type:tool` project, so it verifies through `npm run verify -- -p` (S6). |
| Verified: `interact.ts` rejects only an overlapping turn | `apps/ptah-cli/src/cli/commands/interact.ts:292,414-418` | 4.7. |

## Architecture decision

> Round 6: the host process below is superseded by R6.2 (node-mode desktop process,
> `ptah-worker serve`, cli-engine composition in `@ptah-extension/worker-host`). Protocol, lock,
> log and client design are unchanged.

- Chosen approach (U1 option 1): the worker runs as `ptah worker serve`, built on
  `withEngine`/`CliDIContainer` with a worker host profile. It has one loopback HTTP server
  (`127.0.0.1`, default port 41873) with a WebSocket endpoint `/rpc` and a versioned protocol
  that has its own method table. Each remote method is authorized against the token grant. It
  then calls the in-process handlers through an `InProcessRpc` adapter that validates nested
  results and maps errors safely. Session events are captured into an ordered per-session queue,
  appended to a JSONL log, and only then sent. A fail-closed, kernel-held driver lock keeps one
  driver per session across processes. On Linux it is an abstract-namespace socket and on
  Windows a named pipe; both use only `node:net`. Electron main is the Phase 1 client. It runs the WebSocket over
  an `ssh -W` child's stdio, and the renderer uses new `machines:*` methods over IPC.
- Rationale: requirements 1-6 need a long-lived, multi-session, authenticated server with
  replay, which `ptah interact` cannot provide (`interact.ts:229-239,387-391,516-571`). The CLI graph
  is the Electron backend minus UI (`cli-host-profile.ts:1-14`). A separate remote table makes
  1.3, 2.2-2.4 and 2.9 hold by construction.
- Rejected alternatives:
  - Forwarding `RpcMessage` with an allow list. It exposes internal names and shapes and couples
    the protocol to internal RPC changes.
  - A new `apps/ptah-worker`. It duplicates the composition root and distribution.
  - A WebSocket inside `ClaudeRpcService`. The token would live in the renderer, it could not
    use `ssh -W`, and it would mix registries.
  - HTTP + SSE. `EventSource` cannot send an auth header.
  - `ssh -L`. It opens a local listener and has a free-port race (kept as the A1 fallback).
  - A file-based driver lock with pid/heartbeat staleness. Stale takeover cannot be made atomic
    across competing reclaimers with plain `rename`/`unlink`, and heartbeat age can steal from a
    live, paused holder (review B1). Rejected.
  - A SQLite lock table (revision 1). `better-sqlite3@13` needs Node ≥ 22, so the lock would fail
    closed on the documented Node 20 floor. A crashed holder also leaves a row that must be
    reclaimed by pid proof, and a failed `DELETE` strands a row (round-2 items). Replaced by
    the kernel-held lock: the kernel frees the name when the process dies, and two binders cannot
    both succeed.
  - Building transcripts from `chat:resume`. It has side effects (`chat-session.service.ts:1785-1840`).
- Assumptions (each with its check):
  - A1: `ws` accepts a `createConnection` that returns a Duplex built from the `ssh -W` child's
    stdio. Automated check: the C8 Duplex-pair integration spec. **Final acceptance** is the real
    `ssh -W` step of the Phase 1 exit runbook, recorded before ship (Minor 3). Fallback: `ssh -L`
    with `ExitOnForwardFailure`.
  - A2: `chat:start`/`chat:continue` with a `workspacePath` other than the boot `cwd` run in that
    workspace after the worker adds it through `IWorkspaceLifecycleProvider`. Check: C6
    session-driver integration spec with two folders; grep `UNAUTHORIZED_WORKSPACE` throw sites.
  - A3 (replaces the withdrawn one): the SDK session JSONL contains every completed message once
    no process holds a live record for that session, so `readForResume` taken while the worker
    holds the driver lock, before its own first turn, is complete. Check: read
    `SessionHistoryReaderService.readSessionHistory` (`session-history-reader.service.ts:346`) to
    confirm it reads the JSONL directly with no in-memory buffer. Spec: a fixture JSONL written
    turn by turn compared with the rendered baseline.
  - A5: history events and live events of the same message are idempotent when both are applied
    (`complete`/`history` replace by message and block, `chat-bridge.ts:114-118`). This now only
    matters inside one baseline + log stream. Check: C10 renderer spec.
  - A6: the lock name depends only on the OS user ID and the session ID, never on Electron's
    userData, so Electron and the CLI on one machine compute the same name. The control-key
    directory is `os.homedir()/.ptah/session-drivers/`. Check: `phase-1-infra.ts:137-170` (userData
    differs and is not used).
  - A8: on Linux, `net.createServer().listen('\0<name>')` binds an abstract-namespace socket
    with no filesystem entry. A second bind of the same name fails with `EADDRINUSE`, and the
    kernel frees the name when the holding process exits by any means. On Windows the same holds
    for `\\.\pipe\<name>`. This holds on Node 20, Node 22+ and Electron 44 main (no native
    addon). Check: the C4a cross-process spec binds twice, SIGKILLs the holder and rebinds
    immediately (Jest on the repository's Node in CI Linux). The runtime smoke check on each
    supported host is `ptah worker locks --self-test`, which forks two children that bind, refuse,
    kill and rebind. It runs on the worker's Node (≥ 22 per Q6, answered: `engines.node >=22`)
    and, as Electron main's equivalent, the Machines view's lock self-test, which the Phase 1
    exit runbook step "lock smoke" records. Electron's main
    process is not sandboxed and shares the user's network namespace. Packaging that isolates
    the network namespace (snap or flatpak) is unsupported for the worker, and the runbook checks
    the deb install.
- Effect on existing code: additive. Changes to existing files: one option in `cli-engine` and a
  tap on its push adapter; one capability, one manifest entry, the host label and lock
  enforcement in `rpc-handlers`; a method prefix and a null lock default in `vscode-core`; two
  registry notifications in `agent-sdk`; the kernel lock in `platform-core`, bound by
  `platform-electron` and `platform-cli`; new `libs/shared` types; the Electron shell tab.
  `persistence-sqlite` is not changed. Left alone: `ptah interact` (D8), `messaging-gateway`, `gateway-chat-bridge`,
  `AttachedSessionRegistry`, the `ipc-bridge.ts` delivery flag (D6), `IHttpServerProvider`,
  existing SQLite schemas.

### Reuse verdicts

| Piece | Verdict | Why |
| --- | --- | --- |
| `ClaudeRpcService` | Reuse unchanged (renderer → Electron main over IPC) | Token stays in main (AD-6). The browser-capable `WorkerClient` sits in `worker-protocol` for the PWA. |
| `registerRpcSurface()` + profiles | Reuse; `createWorkerRpcHostProfile()`; `remoteMachines` capability for Electron | Same derivation drives the in-process drift test. |
| Electron `rpc-host-profile.ts` | Extend (`remoteMachines: true`, `hostHandlers['host.remoteMachines']`) | Precedent `host.fileOpen` (`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:553`). |
| HTTP server providers | Leave | No upgrade hook (AD-4). |
| `messaging-gateway` / `AttachedSessionRegistry` | Leave; follow its port pattern | Process-local by design. |
| `gateway-chat-bridge` | Leave | It drives `IAgentAdapter` with chat-platform mapping; the worker needs the desktop stream. |
| `apps/ptah-cli` | Extend with `ptah worker` | Already shipped to workers. |
| `CliWebviewManagerAdapter` | Extend with an optional synchronous tap | Event capture without copying the de-batch logic. |
| `persistence-sqlite` | Leave | The lock must work where `better-sqlite3` cannot load (Node 20); kernel locks need no store. |

## Library placement and boundaries

> Round 6: worker-runtime is consumed by `@ptah-extension/worker-host` (`scope:cli`, new), not
> `apps/ptah-cli`; remote-machines is consumed by `apps/ptah-electron` only (R6.3).

| Project (name / path) | Tags | Template | Depends on | Consumed by |
| --- | --- | --- | --- | --- |
| `@ptah-extension/worker-protocol` / `libs/worker-protocol` | `scope:shared`, `type:util` | `libs/showcase-manifest` + jest/eslint files from `libs/backend/gateway-chat-bridge` | `@ptah-extension/shared` (types), `zod` | worker-runtime, remote-machines, machines-ui, later the PWA |
| `@ptah-extension/worker-runtime` / `libs/backend/worker-runtime` | `scope:extension`, `type:feature` | `libs/backend/gateway-chat-bridge` | platform-core, vscode-core, rpc-handlers, agent-sdk, auth-providers, worker-protocol, `ws` | `apps/ptah-cli` |
| `@ptah-extension/remote-machines` / `libs/backend/remote-machines` | `scope:extension`, `type:feature` | same | platform-core, vscode-core (handler file only), shared, worker-protocol, `ws` | `apps/ptah-electron`; `apps/ptah-cli` in Phase 2 |
| `@ptah-extension/machines-ui` / `libs/frontend/machines-ui` | `scope:webview`, `type:feature`, `platform:angular` | `libs/frontend/tasks-ui` | core, shared, worker-protocol (reducer), chat-ui / chat-execution-tree | `apps/ptah-extension-webview` |
| `process-sampler` / `tools/process-sampler` | `type:tool` | `tools/mcp-bench` (jest `test`, `typecheck`, `lint`) | Node built-ins | operator (Phase 0, every phase review) |

Boundary reasoning (`eslint.config.mjs:293-450`):
- `worker-protocol` is `scope:shared` so that `scope:webview` and `scope:extension` can both import
  it. It imports `@ptah-extension/shared` types; `libs/shared` never imports it.
- `worker-runtime` is `scope:extension`, not `scope:cli`, and never imports `cli-engine`, so a
  `scope:electron` host can compose it later (U4 option 1). The app wires them.
- `remote-machines` is `scope:extension` (Electron now, `ptah fleet` in Phase 2).
- `process-sampler` is `type:tool`, which may depend on anything, and is itself never imported.
- No new scope. Aliases use `@ptah-extension/<name>` in `tsconfig.base.json`. New commit scopes
  go into `.commitlintrc.json`. Both are owned by C0.

## Verified and new contracts

### W1. Wire envelope (`libs/worker-protocol`, new)

JSON text frames, validated with zod at both ends:

```ts
type ClientFrame = { v: 1; kind: 'req'; id: string; method: WorkerMethod; params: unknown };
type WorkerFrame =
  | { v: 1; kind: 'res'; id: string; ok: true; result: unknown }
  | { v: 1; kind: 'res'; id: string; ok: false; error: { code: WorkerErrorCode; message: string; ref?: string; detail?: unknown } }
  | { v: 1; kind: 'evt'; sessionId: string; epoch: string; seq: number; type: string; ts: number; payload: unknown }
  | { v: 1; kind: 'ctl'; type: 'resync-required' | 'session-state' | 'goodbye'; payload: unknown };
```

- `id` is client-generated (≤ 64 chars). Event ID = `${epoch}:${seq}`.
- Limits: `maxPayload` 4 KiB before authentication, 1 MiB after; ≤ 64 requests in flight per
  connection; a connection must authenticate within 10 s.
- Close codes: 4400 malformed, 4401 not authenticated, 4403 method not allowed before
  authentication, 4409 version mismatch, 4429 throttled, 4410 revoked (Phase 2).
- Liveness: client ping every 20 s, pong timeout 10 s; one timer per connection.
- `WorkerErrorCode`: `NOT_FOUND_OR_FORBIDDEN`, `INVALID_PARAMS`, `TURN_IN_FLIGHT`,
  `SESSION_DRIVEN_ELSEWHERE`, `DRIVER_LOCK_UNAVAILABLE`, `NO_PROVIDER_READY`, `WORKER_BUSY`,
  `ALREADY_ANSWERED`, `TRANSCRIPT_UNAVAILABLE`, `SESSION_LOG_FAILED`, `VERSION_MISMATCH`,
  `PAIRING_REJECTED`, `INTERNAL`.
- Error messages on the wire are fixed product copy per code (see W12). Raw in-process messages
  never reach a client.

### W2. Handshake and version skew

- The first frame must be `hello` `{ protocol: { min, max }, client: { name, version } }`. The
  reply is `{ protocol: chosen, worker: { machineId, displayName, ptahVersion } }`, or
  `VERSION_MISMATCH { worker: { min, max, ptahVersion }, client }` followed by close 4409.
  Phase 1 uses `PROTOCOL_VERSION = 1`. The `hello` reply never says whether a pairing window is
  open (S4).
- Before authentication only `hello`, `pair.exchange` and `auth` are accepted. Any other method
  name, including every in-process method name, closes 4403 without calling a handler (2.2,
  2.3.4).

### W3. Pairing bootstrap (2.3, 2.4)

- The window is opened only over the local admin channel (W5) by `ptah worker pair
  [--workspace <id|path> ...] [--ttl <seconds>] [--json]`. `--json` prints one line
  `{ code, expiresAt, workspaces }` and exits; the window stays open in the service. Electron's
  "Pair automatically via SSH" runs `ssh <alias> ptah worker pair --json` (2.3.1).
- Code: 8 Crockford base32 characters (no `I L O U`), 40 bits, shown `XXXX-XXXX`; either form
  is accepted. Only a salted SHA-256 is kept, in service memory, never persisted or logged.
- Lifetimes: the code and window last 300 s (`--ttl` 60-900), with one window at a time and one
  expiry timer.
- Grant snapshot (2.10): the default grant is every workspace registered **when the window
  opens**, or the `--workspace` subset. It is fixed at window open and not recomputed at
  exchange.
- Attempts: 5 failed exchanges while a window is open close it. Per connection, the next
  attempt waits 1 s, 2 s, 4 s, and the connection closes 4429 after 3 failures, whatever the
  cause.
- **Indistinguishable result (S4):** a wrong code, an expired code, a used code and "no window
  open" all return exactly
  `{ ok: false, error: { code: 'PAIRING_REJECTED', message: <one fixed string> } }`, with no
  `detail`, no attempts count and the same throttle path. Timing: every rejection is answered no
  earlier than 250 ms after receipt, and the code hash comparison always runs (against a random
  dummy hash when no window is open). Logs record `{ connectionId, windowOpen, attemptsLeft }`
  locally without the code (2.8).
- Remaining-attempts display: the unauthenticated protocol never reveals it. If the user picks
  "show the count" (Clarifications Q2), Electron reads it over the user's SSH login with
  `ssh <alias> ptah worker status --json` (field `pairing: { open, expiresAt, attemptsLeft }`).
  That path is already authenticated by the OS account.
- Success: `pair.exchange { code, clientName }` → `{ token, tokenId, grant }`. The window closes,
  and the client then sends `auth`.

### W4. Token format and storage (worker-owned)

- Format `ptw1.<tokenId>.<secret>`: `tokenId` is 12 base32 characters, `secret` is 32 random
  bytes in base64url. Never logged; the redactor masks `ptw1.<id>.***`.
- Worker store `~/.ptah/worker/tokens.json` (dir 0700, file 0600, atomic tmp+rename):
  `{ tokenId, secretHash, clientName, createdAt, lastUsedAt, grant: { machineId, workspaceIds },
  revokedAt? }`. `auth` looks up by `tokenId` and compares with `crypto.timingSafeEqual`. Unknown,
  bad and revoked tokens all get the same 4401.
- Client store (Electron): `ISecretStorage` key `remoteMachines.token.<machineId>`.
- `token.revokeSelf`: revokes the caller's token and closes its connections. "Remove machine"
  calls it (AD-13). General list/revoke is Phase 2 (2.6).

### W5. Admin channel (local operator)

- `ptah worker serve` writes `~/.ptah/worker/admin.key` (32 random bytes, 0600, new on each start)
  and `endpoint.json` `{ host, port, pid, protocol, ptahVersion, startedAt }` (0600, no secret).
- Local commands authenticate with `auth { admin: <key> }`. Admin connections accept only
  `admin.pairing.open`, `admin.grants.list`, `admin.grants.add`, `admin.status`.

### W6. Remote method table (Phase 1) and authorization point

`WORKER_METHODS` rows are `{ method, params, result, resources, handler, licensed? }`. The
gateway order is fixed: schema → (U5 gate, only if chosen) → `WorkerAuthorizer.check(grant,
resources)` → handler. A failed check returns `NOT_FOUND_OR_FORBIDDEN` before the handler, the
same for a missing ID and an excluded ID.

| Method | Params | Result | Resource checks | In-process call (via `InProcessRpc`, W12) |
| --- | --- | --- | --- | --- |
| `machine.info` | `{}` | `{ machineId, displayName, ptahVersion, protocol, grant, readiness }` | token's machine | readiness |
| `workspaces.list` | `{}` | `[{ workspaceId, name, path }]` | filtered to grant | registry |
| `sessions.list` | `{ workspaceId }` | `[{ sessionId, title, state, driver?, updatedAt, provider, logged: boolean }]` | workspace ∈ grant | `session:list` + worker state + lock holder |
| `session.attach` | `{ sessionId, afterSeq?, epoch? }` | `{ mode: 'log', epoch, fromSeq, headSeq }` then `evt` frames, or `{ mode: 'snapshot', events, live: false }` | session ∈ grant | event log / `ChatHistoryReadService.readForResume` |
| `session.detach` | `{ sessionId }` | `{}` | session ∈ grant | none |
| `session.start` | `{ workspaceId, prompt, name? }` | `{ sessionId, turnId }` | workspace ∈ grant | `chat:start` (worker tab ID), awaits `session:id-resolved` |
| `session.continue` | `{ sessionId, prompt }` | `{ turnId }` | session ∈ grant | lock, baseline (W8), `chat:continue` |
| `session.stop` | `{ sessionId }` | `{ stopped }` | session ∈ grant | `chat:abort` |
| `permission.respond` | `{ sessionId, requestId, decision: 'allow' \| 'deny', reason? }` | `{ applied: true }` | request pending on that session, session ∈ grant | `ISdkPermissionHandler.handleResponse` |
| `token.revokeSelf` | `{}` | `{}` | caller's token | token store |

- Machine check (2.9.1): `grant.machineId` must equal this worker's ID. Otherwise `auth` rejects.
- Session → workspace: `WorkerSessionIndex.workspaceOf(sessionId)` scans `session:list` **only
  for granted workspaces** (cached, one refresh on a miss), so an outside-grant session is
  "not found" by construction.
- `always_allow` is `INVALID_PARAMS` in Phase 1 (design D4). An unknown method is
  `INVALID_PARAMS` and no handler runs (1.3).
- `session.start`: the result returns after `session:id-resolved` for the worker tab (timeout
  30 s → `INTERNAL` with a ref). Tab-keyed events that arrive before resolution are queued under
  the tab and moved into the session's log in arrival order once the ID is known.

### W7. Event capture and log (4.1-4.4) — log before send

- File per session: `~/.ptah/worker/events/<sessionId>.jsonl` (0600). The header line is
  `{ "h": 1, "epoch": "<uuid>", "sessionId", "createdAt" }`. Records are
  `{ "s": <seq>, "t": "<type>", "ts", "p": <payload> }`, with `seq` starting at 1 and rising by 1.
- Ordered boundary (S2): the push tap is synchronous and only calls
  `WorkerEventCapture.capture(type, payload)`. That classifies the event, assigns nothing yet, and
  pushes it onto the session's **ordered capture queue**. One `SessionLogWriter` per session
  drains the queue serially. It assigns `seq = head + 1`, then runs `await fileHandle.write(line)`.
  **Only after the write resolves** does it set `head`, hand the frame to the fan-out, and take
  the next item. No code path sends an `evt` frame except the writer's post-append callback, so
  4.1 holds by construction. `fdatasync` runs at each turn end and at most once per second during
  a turn. The guarantee is "survives a worker process crash", not power loss (documented).
- Failure signal: an append rejection calls `onAppendFailed(sessionId, error)`. It stops the
  session's writer (queued and later events are discarded and never sent), calls `chat:abort`
  for that session's in-flight turn, sends subscribers
  `ctl session-state { sessionId, degraded: 'log-write-failed' }`, and makes later
  `session.continue` calls fail `SESSION_LOG_FAILED` until the worker restarts and the log reopens
  cleanly. The capture queue is bounded (10,000 items); overflow is treated as an append failure.
- Open/recovery: a torn last line is truncated, and `head` = last complete record. A log that
  ends in `worker:turn.begin` without `worker:turn.end` gets `worker:turn.interrupted { turnId }`
  appended (1.6).
- Logged types (`SESSION_EVENT_TYPES`): `chat:chunk`, `chat:complete`, `chat:error`,
  `permission:request`, `permission:auto-resolved`, `permission:session-cleanup`,
  `session:turnEnded`, `session:turnFailed`, `session:id-resolved`, `chat:sessionEnded`,
  `session:stats`. Worker records: `worker:baseline`, `worker:history-mark`, `worker:turn.begin`,
  `worker:turn.end`, `worker:turn.interrupted`, `worker:permission.answered`. Routing uses
  `payload.sessionId`, else `payload.tabId` through the tab map (pre-resolution queue, W6), else
  the event is dropped with a debug counter. Worker records are produced by the worker itself and
  enqueued directly with their session ID; they skip tap routing.
- Worker record serialization (round-3 item 1). Each worker record type has a zod schema in
  `worker-protocol` (`WORKER_RECORD_SCHEMAS`). The writer validates against it before append; the
  log reader validates on open and replay. `SESSION_EVENT_TYPES` is the single list that the
  writer, the reader and the reducer use.
  - `HistoryMark = { count: number (int ≥ 0); lastEventId: string | null }`.
  - `worker:baseline` → `p = { events: FlatStreamEventUnion[], historyMark: HistoryMark }`.
  - `worker:history-mark` → `p = { historyMark: HistoryMark, turnId: string }`. It is appended
    and replayed like any record and takes a `seq`, so `afterSeq` arithmetic is unchanged. It is
    sent to clients (it keeps the client's `seq === last + 1` rule gap-free), and the reducer
    advances `last` past it without changing the rendered view.
  - The attach freshness check (W8) reads the **latest** `worker:baseline.historyMark` or
    `worker:history-mark.historyMark`, whichever has the higher `seq`. Each record is tracked in
    memory by the writer as `latestMark` and rebuilt by the reader on open.
  - A record whose type is not in `SESSION_EVENT_TYPES`, or whose payload fails its schema, is an
    append failure on write (`onAppendFailed`). On read it marks the log corrupt: the reader keeps
    the records before it, and attach answers `TRANSCRIPT_UNAVAILABLE` for that session.
- Replay: `session.attach { afterSeq, epoch }` with a matching epoch streams records with
  `s > afterSeq` from the file. The connection is registered with the fan-out **in the same
  synchronous step** in which the writer's `head` is read (`replayTo = head`). Live frames with
  `seq > replayTo` are buffered for that connection until the file replay reaches `replayTo`. An
  epoch mismatch → `ctl resync-required` → the client re-attaches with no `afterSeq`. Phase 1 keeps
  the whole log (4.3 is Phase 2).
- Client (`SessionEventReducer`, pure, `worker-protocol`): apply only `seq === last + 1`; drop
  `seq ≤ last`; on a gap, hold and request replay from `last` (4.4); a `worker:baseline` record
  replaces the rendered view.

### W8. Transcript: baseline + log (5.1-5.3)

- **Logged sessions** (the worker has driven them at least once): the transcript is the log. Each
  time the worker acquires the driver lock for a session (W10), it reads
  `ChatHistoryReadService.readForResume(sessionId)` **before** writing `worker:turn.begin`. That
  is the moment when no process holds a live record for that session (A3). It appends
  `worker:baseline { events, historyMark }` through the writer.
  `historyMark = { count: events.length, lastEventId }` identifies the history state.
  `session.attach` with no `afterSeq` starts at the latest baseline's `seq`. The client renders
  baseline + later records, so no history read happens while a turn is in flight and no cut
  computation is needed. History lag cannot drop events: completed events after the baseline
  are in the log, and the baseline is read only while no process is driving.
- **History marks at worker turn end.** After each `worker:turn.end`, while the worker still
  holds the lock (its session record is live), the worker reads `readForResume` once and appends
  `worker:history-mark { historyMark }`. This record is never rendered. The latest mark is
  therefore exactly the history the log already represents.
- **Freshness check at attach (round-2 item 3: a desktop turn between remote turns).**
  `session.attach` on a logged session, with or without `afterSeq`, first establishes a proven
  idle boundary and then compares marks:
  1. If this worker process holds the session's lock (it is driving now), the log is current,
     because nobody else could have driven since the worker acquired it. No read is needed.
  2. Otherwise the worker takes the driver lock for the read only (`purpose: 'refresh'`), reads
     `readForResume`, and compares its `historyMark` with the latest mark in the log. If they
     differ (someone else drove in between), it appends a fresh `worker:baseline` **before**
     answering. Then it releases the lock. The attach then replays from that new baseline, and a
     client that sent an older `afterSeq` receives the baseline record, which replaces its view
     (W7 reducer rule). Holding the lock during the read proves no turn runs elsewhere, so the
     read is complete (A3).
  3. If the lock is held by another process (desktop driving now), the answer is
     `{ mode: 'snapshot', events, live: false, drivenBy: holder.label }` from `readForResume`,
     labelled "last saved state". This is the 4.9 case and follows Q1. Under Q1 (b), C11 makes it
     a live logged session.
  4. If the lock is unavailable, the answer is `DRIVER_LOCK_UNAVAILABLE` (fail closed).
     Freshness cannot be proven without the lock.
- **Unlogged sessions** (driven only elsewhere so far): `session.attach` returns
  `{ mode: 'snapshot', events, live: false }` from `readForResume`. The UI labels it "last saved
  state" with a refresh. There is no live stream to join, so no overlap or gap claim applies. When
  the worker later drives it, the first baseline turns it into a logged session.
- A corrupt or missing session → `TRANSCRIPT_UNAVAILABLE { sessionId }` (5.3), never an empty success.
- Tests (S1): history reader returns a lagging history while a turn is in flight → log mode never
  calls the reader; an event completes during `attach` → rendered exactly once; worker restart
  between attach and re-attach → same render; desktop drives between two worker turns → new
  baseline replaces the view and matches a fresh read.
- Round-2 tests (item 3), in C6 with a fake history reader and a real second-process lock holder:
  - worker turn, then a desktop turn (fixture history grows while another process holds and then
    releases the lock), then `session.attach` **before** any new worker turn. The rendered
    transcript contains the desktop turn, equals a fresh `readForResume` render, and the log
    gained exactly one baseline.
  - The same with `afterSeq` from a client that saw the old log: it receives the new baseline and
    its view is replaced.
  - Attach with no intervening turn: no new baseline (marks equal).
  - **History-mark append and replay (round-3 item 1).** One worker turn appends exactly one
    `worker:history-mark` after `worker:turn.end`. Its `seq` is `turn.end.seq + 1` and its
    `historyMark` equals the fixture history. After a worker restart (log reopened from disk),
    `session.attach { afterSeq: <turn.end seq> }` replays the mark record. The client reducer
    advances `last` with no gap request and no change to the rendered view. The following
    no-change attach compares against the mark read from disk (`latestMark` rebuilt on open),
    not against the older baseline mark, and appends no baseline. A log line of type
    `worker:history-mark` with a malformed payload makes attach answer `TRANSCRIPT_UNAVAILABLE`.
  - Attach while another process holds the lock: snapshot mode with `drivenBy`.
  - Attach while this worker drives: no history read.
  - Lock unavailable: `DRIVER_LOCK_UNAVAILABLE`.

### W9. Approval semantics (6, 4.6)

- `PendingPermissionIndex`: add on `permission:request` (session from payload or tab map);
  remove on auto-resolved, session cleanup or answer. The first answer removes the entry
  synchronously and calls `handleResponse`; a later answer → `ALREADY_ANSWERED`. The worker logs
  `worker:permission.answered { requestId, decision, by }`.
- Timeout and default (6.3): unchanged local behaviour; `timeoutAt: 0` waits indefinitely
  (`permission.types.ts:66`); documented.

### W10. Cross-process driver lock (1.5, R3) — fail closed, kernel-held

- Port `ISessionDriverLock` (`platform-core/src/interfaces/session-driver-lock.interface.ts`),
  token `PLATFORM_TOKENS.SESSION_DRIVER_LOCK`. Asynchronous API:
  - `acquire(sessionId, owner, purpose?: 'drive' | 'refresh')` returns
    `Promise<{ ok: true; nonce } | { ok: false; holder: DriverHolder } | { ok: false; unavailable: string }>`;
  - `annotate(sessionId, nonce, label)`;
  - `release(sessionId, nonce): Promise<'released' | 'stranded'>`;
  - `holder(sessionId)`;
  - `held()`, which lists this process's locks with their state `held | releasing | stranded`;
  - `dispose()`.

  `DriverHolder = { kind: 'desktop' | 'worker' | 'cli'; hostname; pid; label; acquiredAt;
  responding: boolean }`.
- Implementation `KernelSessionDriverLock` (`platform-core`, Node `net` only, no native addon,
  same code on Node 20, Node 22+ and Electron main):
  - Lock name: `ptah-driver-<uid>-<sessionId>`. `<uid>` is `os.userInfo().uid`, or the user SID
    hash on Windows. On Linux the endpoint is the abstract socket `'\0' + name`; on Windows it is
    `\\.\pipe\` + name (A8).
  - `acquire`: `server.listen(endpoint)`. Success means this process now holds the lock, and the
    kernel is the arbiter, so two binders cannot both succeed.
    - `EADDRINUSE` → connect to the endpoint and read one JSON line (the holder's
      `DriverHolder`, 500 ms timeout). A holder that does not answer in time (paused or hung) is
      reported as `{ label: 'another Ptah process (not responding)', responding: false }`. It is
      **still refused**; liveness is never inferred from time.
    - Any other error (`EACCES`, `EMFILE`, unsupported platform) → `{ ok: false, unavailable }`.
  - Re-entrant: this process's own held name returns its existing nonce.
  - The holder's per-session server answers every connection with its `DriverHolder` line and
    then closes. It accepts no commands; all control goes through the per-process control
    endpoint (below), so a per-session name is never a command surface.
  - Crash or kill of the holder: the kernel frees the name immediately. No stale state, no pid
    checks, no reclaim race, nothing left on disk.
  - `release`: `server.close()`, after which the name is free. It also deletes the in-memory
    entry. `dispose()` and a synchronous `process.on('exit')` close every held server.
- **Release failure and recovery (round-2 item 2).** A failed `close()` keeps the entry in
  `held()` with state `releasing`, and `release` retries up to 3 times (100 ms, 400 ms, 1.6 s)
  before it returns. The lock is not reported free until `close()` succeeds. After the last
  failure the state becomes `stranded`. The process logs
  `[driver-lock] stranded session=<id> pid=<pid>` and keeps answering `holder` queries with
  `label: '<label> (release pending)'`. Any later `acquire`/`release` call in that process retries
  stranded entries first. Live-holder protection is unchanged: no other process can take a name
  the kernel still holds.
  - **Holder discovery (round-3 item 2): per-process control endpoint.** A key file alone holds
    no session IDs, so session names cannot be derived from it. Each lock-aware process
    therefore opens one control endpoint on its first `acquire` and keeps it until `dispose()`:
    - Name `ptah-ctl-<uid>-<pid>`, with the same `<uid>` rule as the session names. On Linux it
      is the abstract socket `'\0' + name`; on Windows it is the named pipe `\\.\pipe\` + name.
      The same `node:net` code serves both (A8).
    - Discovery file `~/.ptah/session-drivers/<pid>.key` (dir 0700, file 0600, written before
      the endpoint listens, removed in `dispose()` and the synchronous `exit` handler) holds
      `{ pid, kind, key }`. `key` is 32 random bytes, base64url. The file names the pid, the pid
      gives the endpoint name, and the endpoint gives the session list.
    - Protocol: one JSON request line, one JSON response line, then close; 500 ms timeout; 4 KiB
      request cap. Every request carries `key`, compared in constant time
      (`crypto.timingSafeEqual`). A wrong key gets `{ ok: false, code: 'BAD_KEY' }`.
      - `{ cmd: 'list', key }` → `{ ok: true, pid, kind, hostname, locks: [{ sessionId, state:
        'held' | 'releasing' | 'stranded', label, acquiredAt, hasLiveRecord }] }`. The list is
        taken from the process's in-memory `held()` map, so it is exactly what the kernel holds
        for that process.
      - `{ cmd: 'release', sessionId, key }` → `'released' | 'stranded' | 'in-use' | 'not-held'`.
    - Why this option and not a session inventory file: the list then has one source of truth,
      the holder's own memory, and the kernel already bounds it. An inventory written on every
      acquire and release adds a disk write on the turn path, a write that can fail, and a file
      that can disagree with the kernel after a crash. The pid file changes only at process start
      and exit, and the endpoint verifies it.
    - Stale discovery files: a file whose endpoint refuses the connection (`ECONNREFUSED`,
      `ENOENT`) belongs to a dead process. The command deletes it and does not list it. With pid
      reuse, a live process with the same pid that is not Ptah has no such endpoint; a new Ptah
      process with the same pid has overwritten the file. A file whose endpoint times out is
      listed as `responding: false` and kept.
  - Operator recovery: `ptah worker locks [--json]` reads every `<pid>.key`, sends `list` to each
    endpoint, and prints pid, kind, label, session ID and state per lock. Electron main, the CLI
    and the worker all run the same `KernelSessionDriverLock`, so each one is listed.
    `ptah worker locks release <sessionId>`:
    1. connects to the session endpoint `ptah-driver-<uid>-<sessionId>` and reads `holder.pid`;
       a free name answers "not held" and nothing else happens;
    2. reads `<holder.pid>.key` and sends `release` to that pid's control endpoint with its key.
    Release is therefore keyed to the process that the kernel says holds the name, never to a
    listing that may be stale.
  - The holder honours that release only when it has **no live session record** for that
    session (its registry has no record, so no turn can be running), which keeps the live-holder
    rule. Otherwise it answers `in-use` and nothing changes.
  - The command shows the holder label, pid and state and asks for confirmation (`--yes` for
    scripts). It needs the holder's control key, which only the same OS user can read (0700/0600),
    so another user cannot list or release. Assumption: Node creates Windows pipes with the
    default named-pipe DACL, which may let other local accounts connect. So the key check, not
    the pipe ACL, is the access control on both platforms. The key file sits under the user
    profile, whose ACL keeps other users out. Check: the Windows A8 self-test confirms that a
    request without the key gets `BAD_KEY`.
  - `ptah worker status` (readiness check 7) and the Machines view banner show stranded locks with
    this command as the fix.
- **Fail closed:** `unavailable` refuses the turn with
  `RpcUserError(<message naming the cause and fix>, 'SESSION_DRIVER_LOCK_UNAVAILABLE')`. No
  turn starts without a lock on either chat runtime. The scope of enforcement is Clarifications
  Q3 with decisions.md row 14: every Electron/CLI host on Linux and Windows, for `claude-sdk`
  sessions and native Codex (`codex-app-server`) sessions (see "Native Codex runtime" below).
  macOS gets `NullSessionDriverLock`, because it has no abstract namespace, workers are
  unsupported on macOS in this task, and the behaviour there stays as it is today (documented).
- Squatting: a process of another local OS user in the same network namespace could bind a name
  it guesses (it would need the session UUID). The result is a refusal (denial of service, not a
  second driver). Documented; the uid in the name prevents accidental collisions between users.
- **Native Codex runtime (Round 5, AD-25; decisions.md row 14).** The lock covers native Codex
  (`codex-app-server`) sessions too. This replaces Round 4's `claude-sdk`-only scope and its
  `sessionDriverLockScope` filter, which came from an auto-picked answer (row 13).
  - Why a separate seam: packaged win32/x64 Electron always admits native Codex chat
    (`apps/ptah-electron/src/di/codex-electron-admission.ts:15-19`), and
    `RoutingAgentAdapter.startChatSession` sends such sessions to the native adapter
    (`libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:87-117`); later
    calls route by session (`:218-232`). The native adapter keeps its own `sessions` map
    (`codex-chat-adapter.ts:141`) and never uses `SessionRegistry` (grep under
    `codex-app-server` and `codex-runtime/src`: 0 files), so the registry notifications never
    fire for it.
  - Chosen seam: a driver gate port on the native adapter, `CodexChatAdapterPorts.driver:
    CodexChatDriverGate`, declared next to the existing host observer `sessions?:
    CodexChatSessionLifecycle` (`codex-chat-adapter.ts:117-123,131-137`).
    - Rejected, register native sessions in `SessionRegistry`: a record is a Claude query
      record (`query`, `abortController`, `messageQueue`, `awaitingEcho`;
      `session-registry.service.ts:289-310`). A native entry would be visible to `evictStale`
      and `displaceExisting` (`:676-690`, `:775-790`), to `find()`, which Electron uses for tab
      lookup and the legacy controls (`apps/ptah-electron/src/di/codex-session-binding.ts:54,93,106`),
      and to `endSessionIfTokenMatches`, which by design never closes a native thread
      (`codex-chat-adapter.ts:649-663`). Each of those would treat a Codex thread as a Claude
      query.
    - Rejected, reuse `CodexChatSessionLifecycle.opened/closed`: `opened` returns `void`
      synchronously (`:131-137`) and fires after the thread is open (`:293`), so it cannot
      refuse an open; the field is optional (`sessions?`), so a missing binding would fail open.
  - Contract (agent-sdk, exported from `libs/backend/agent-sdk/src/index.ts` next to
    `CodexChatSessionLifecycle`, :160-166):

    ```ts
    export interface CodexChatDriverGate {
      admit(
        sessionId: SessionId,
        context: { tabId?: string; consumer: 'chat' | 'gateway'; kind: 'start' | 'resume' },
      ): Promise<CodexChatDriverLease>;
    }
    export interface CodexChatDriverLease {
      release(): void;
    }
    ```

    `admit` resolves only when this process holds the kernel lock for `sessionId`. It rejects
    with the coordinator's `RpcUserError` (`SESSION_DRIVEN_ELSEWHERE` naming the holder, or
    `SESSION_DRIVER_LOCK_UNAVAILABLE`) and holds nothing after a rejection. `release()` is
    idempotent, never throws and returns at once; its outcome (released or stranded) is the
    lock's own state (W10 stranded rule). The port is **required**, so the only host that binds
    native chat (Electron, `codex-runtime-composition.ts:617`) cannot omit it. CLI and VS Code
    bind `CODEX_CHAT_ADAPTER_PORTS` to `null` (`agent-sdk/src/lib/di/register.ts:1003-1004`;
    `apps/ptah-cli/src/di/expected-resolvable.ts:20-29`), and then no native adapter exists
    (`register.ts:1086-1091`).
  - The three lifecycle points, mapped:
    1. **Real session ID bound → `admit`.** Resume of a thread that is not open
       (`resumeSession`, `codex-chat-adapter.ts:228-256`, → `open(config, id)`):
       `admit(resumeId, { kind: 'resume' })` right after `prepareProfile` (`:283`) and before
       `openContext` (`:286`), so a refused resume never starts the app-server thread. Start:
       the thread ID exists only after `openContext` (`:286-287`), so `admit(id, { kind:
       'start' })` runs after the `sessions.has(id)` check (`:288-290`) and before `buildSink`,
       `stagedId` and `sessions.opened` (`:291-293`), `persistMetadata` (`:295`),
       `publishSession` (`:299`) and the first turn (`:301`). `checkOpening` runs again after
       `admit`; a cancel during `admit` releases the lease. No native turn can start before
       `admit` resolves: the first turn is `:301`, and every later turn needs a published
       session (`sendMessageToSession`, `:563-630`; active `resumeSession`, `:232-254`).
    2. **Rebound → none, by construction.** A native thread ID never changes for a session:
       `prepareProfile` refuses a resume identity that names another thread (`:330-333`), the
       adapter adds `id !== resumeId → identity-mismatch` after `:287`, and the native adapter
       has no fork path (grep `fork` under `codex-app-server`: 0 files). The rebind handoff and
       `pendingHandoff` never run for native sessions. A native session has no handoff entry,
       so the wait in continue, resume, `sendMessage` and `permission:respond` finds nothing and
       does not block.
    3. **Record removed → `lease.release()`.** `publishSession` (`:384-409`) stores the lease
       on the `TrackedSession` (`codex-chat-session-controls.ts:14`). Every removal goes through
       `CodexChatSessionControls.close` (`:87-105`): `endSession`, `closeSession`, `dispose`
       (`codex-chat-adapter.ts:217-221`), `reset` (`:209-216`), the refused-interrupt and error
       closes (`codex-chat-session-controls.ts:136,141`) and the turn stream's `close`
       (`codex-chat-adapter.ts:538-562`). `release()` is called at the removal point, next to
       `sessions.closed` (`codex-chat-session-controls.ts:89-91`); after that line the session
       cannot drive (aborted, sink disposed). In `open`'s catch (`codex-chat-adapter.ts:305-317`)
       an admitted lease that was never published is released before `cleanupOpen`.
  - Error identity: `open`'s catch wraps errors through `failure()` (`:306`, `:728-744`) into
    `CodexChatAdapterError('runtime-failed')`, which would drop the lock code. The adapter keeps
    the `admit` rejection and rethrows that object unchanged after the same cleanup, so
    `ChatSessionService` returns `errorCode: 'SESSION_DRIVEN_ELSEWHERE' |
    'SESSION_DRIVER_LOCK_UNAVAILABLE'` as it does for a `claude-sdk` refusal (evidence row
    "`ChatSessionService` catches errors", :64).
  - Fail closed (as S3): an `admit` rejection, or a throw from the lock port inside the gate
    (the coordinator treats it as `unavailable`), ends the open before `persistMetadata`,
    `publishSession` and the first turn. `cleanupOpen` closes the context and scope
    (`:411-431`), and no lease is held. A host that runs native chat has no "gate absent" mode
    (required port; the Electron composition spec asserts it).
  - Acquire and release per entry point (native):
    - start (`ChatSessionService.startSession`, gateway starts): `admit` acquires fresh;
    - continue on an inactive thread, `chat:resume` activate, rewind: `beginDrive` acquires
      upfront (provisional), then `autoResumeIfInactive` → `RoutingAgentAdapter.resumeSession`
      → native `open(config, id)` → `admit` adopts the provisional entry (no second acquire);
      a failure before adoption releases it through `abandonDrive`;
    - continue on a live thread (`sendMessageToSession`) and active `resumeSession`: the lease
      from the open already holds the lock; `beginDrive` is re-entrant and stores nothing;
    - release: `lease.release()` at removal, or in `open`'s catch.
  - Host side (C4b, C4c): `SessionDriverLockCoordinator.admitNative(sessionId, context)`
    implements the gate. It returns a lease bound to a fresh owner key `native:<uuid>`. Its
    `release` removes that owner; the kernel name is closed only when the session has no owner
    left ("Acquisition ownership" below), so a reopen of the same thread while the old session
    is still closing keeps its lock. Electron composition passes `driver` next to `sessions`
    (`apps/ptah-electron/src/di/codex-runtime-composition.ts:602`) and resolves the coordinator
    lazily through `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` (new;
    `libs/backend/rpc-handlers/src/lib/chat/tokens.ts:10`), as `lifecycle()` is resolved lazily
    in `codex-session-binding.ts:40-43`. Native sessions use the desktop label.
  - Worker side (C6), a **capability limit, not a lock gap**: the CLI pins `nativeCodex: false`
    (`apps/ptah-cli/src/di/expected-resolvable.ts:32-35`) and binds the native chat tokens and
    the runtime-identity lookup to `null` (`:20-29`; `register.ts:1007-1015`), so on a worker
    every chat call routes to the Claude adapter, which cannot run a Codex thread. The worker
    therefore keeps refusing native sessions. `session.continue` and the W8 lock-taking refresh
    read the session's metadata (`SessionMetadataStore.get`, `session-metadata-store.ts:1424`)
    and refuse `codexExecution?.runtime === 'codex-app-server'` (field `:263`) with the W12
    mapping of `CODEX_UNAVAILABLE` (`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:31`),
    with no in-process call and no lock call. A metadata read error refuses the call through the
    W12 in-process failure mapping. `session.attach` answers in snapshot mode. Round 4's
    `sessionDriverLockScope` read `SESSION_RUNTIME_IDENTITY_LOOKUP`, which is `null` on the CLI,
    so it answered `'locked'` for every session and could never have refused a native one; it
    is removed. A native session that Electron drives on the worker's machine is now held by
    Electron's kernel lock, so `ptah worker locks` lists it.
- Enforcement (C4b, `rpc-handlers`, both runtimes):
  - `ChatSessionService.continueSession` and `resumeSession` with `activate: true` acquire
    **before** any SDK call (`beginDrive`). On refusal they throw `SESSION_DRIVEN_ELSEWHERE`
    naming `holder.label`, or `SESSION_DRIVER_LOCK_UNAVAILABLE`.
  - `startSession`: a `claude-sdk` start acquires on the new `SessionRegistry` notification
    `onRealSessionIdBound`; a native start acquires in the gate's `admit` (C4c). A refusal ends
    the new session with the same error on its tab.
  - Release goes through one new `SessionRegistry` notification `onRecordRemoved(record)`. It is
    fired from **every** removal point: `remove` (`session-registry.service.ts:444-455`),
    `evictStale` (`:676-690`) and `displaceExisting` (`:775-790`). That covers `endSession`,
    `endSessionIfTokenMatches`, `disposeAllSessions` and `disposeAllSessionsForShutdown`.
    The rebind branch is **not** a removal (see the next item). Native sessions release through
    their lease (see "Native Codex runtime").
  - The coordinator keeps the held lock per record, keyed by `record.token`:
    `heldByRecord: Map<token, { sessionId, nonce }>`. Every release, including the one triggered
    by `onRecordRemoved`, releases the entry's `sessionId` and `nonce`. It never uses
    `record.realSessionId`, which can have changed since the acquire.
  - **Acquisition ownership (Round 5, both runtimes).** Each session ID has an owner set:
    registry records (`heldByRecord`), native leases (`native:<uuid>`) and at most one
    provisional entry `{ tabId, nonce }` from `beginDrive`. `beginDrive(sessionId, tabId)`
    acquires (re-entrant, W10); when the session already has an owner nothing new is stored,
    otherwise a provisional entry is. The provisional entry is adopted by `onRealSessionIdBound`
    for the same session ID (`claude-sdk`) or by `admitNative` (native). It is released by
    `abandonDrive` on the caller's failure path, or by `onRecordRemoved` for a record with its
    `tabId` that never bound. The kernel `release(sessionId, nonce)` runs only when the owner
    set becomes empty. Operations on one session ID run one at a time (a per-session promise
    chain), so an acquire never races a release of the same name.
  - **Rewind path (Round 5).** `session:rewindFiles` (`session-rpc.handlers.ts:1472-1590`)
    reactivates an inactive session through `ChatSessionService.ensureSessionActiveForRewind`
    (`chat-session.service.ts:2139-2188`), which calls `autoResumeIfInactive` (`:2170`) and so
    starts an SDK query with no lock today. Fix: `ensureSessionActiveForRewind` calls
    `beginDrive(sessionId, tabId)` after `gateAccount` (`:2155-2165`) and before
    `hasLiveSessionStream` (`:2166`). A refusal throws the lock `RpcUserError`; the handler's
    catch rethrows `RpcUserError` unchanged (`session-rpc.handlers.ts:1584`), so the tab gets
    `SESSION_DRIVEN_ELSEWHERE` or `SESSION_DRIVER_LOCK_UNAVAILABLE`, not `session-not-active`.
    `{ alreadyActive }` holds nothing new (re-entrant); `{ resumed: false }` calls `abandonDrive`.
    The handler's already-active branch (`:1503` false → `rewindFiles` at `:1527`) needs no
    acquire: a live record in this process exists only under this process's lock.
  - **Structural guard (Round 5).** `autoResumeIfInactive` (`:2228`) is the single funnel for
    continue (`:1614`), resume-activate (`:1891`) and rewind (`:2170`). Right before its SDK
    call (`sdkAdapter.resumeSession`, `:2437`) it calls `assertDriveHeld(sessionId)`, which
    throws `SESSION_DRIVER_LOCK_UNAVAILABLE` and logs `[driver-lock] resume without lock
    session=<id>` when this process has no owner for the session. A future caller that skips
    `beginDrive` fails closed instead of driving unlocked.
- **Rebind handoff (round-3 item 3).** Verified: `bindRealSessionId`
  (`session-registry.service.ts:356-394`) takes the `'rebound'` branch when the caller's
  `ownerToken` equals `rec.token` (`:380`). It deletes the old `bySessionId` key, mutates the same
  record's `realSessionId` to the new ID and re-indexes it (`:386-393`). No record is removed, and
  after it returns the old ID cannot be read from the record. A resume with `forkSession` reaches
  this path.
  - New notification `onRealSessionIdRebound(event: { tabId, oldSessionId, newSessionId,
    ownerToken })`. It fires synchronously inside the `'rebound'` branch, after the maps are
    updated and before `return 'rebound'`. `ownerToken` is `rec.token`. The `'already-bound'`,
    `'stale-mismatch'`, `'invalid'` and `'no-record'` outcomes never fire it. Listener exceptions
    are caught per listener, as for the other notifications. `SessionLifecycleManager`
    re-exposes it.
  - The coordinator's handler starts the handoff and stores it as `pendingHandoff.set(ownerToken,
    promise)`. Order:
    1. Look up `heldByRecord.get(ownerToken)`. It must hold `oldSessionId`; a mismatch is logged
       and handled as step 4 (refuse).
    2. `acquire(newSessionId, owner)` with the old entry's label.
    3. On `ok`: set `heldByRecord` to `{ newSessionId, newNonce }`, **then**
       `release(oldSessionId, oldNonce)`. A `'stranded'` result is handled per the stranded rule;
       the new lock is kept either way.
    4. On refusal (`holder`) or `unavailable` (fail closed): the old lock is **kept**. The
       coordinator aborts the in-flight turn on that tab (`chat:abort`) and ends the record through
       `endSessionIfTokenMatches(newSessionId, ownerToken)`. Verified signature
       `(sessionId, token): Promise<boolean>` (`sdk-agent-adapter.ts:1592-1595`,
       `session-lifecycle-manager.ts:752-757`). The registry indexes the record under
       `newSessionId` after the rebind, and the token check keeps a later record safe. The tab gets `SESSION_DRIVEN_ELSEWHERE`
       (naming the holder) or `SESSION_DRIVER_LOCK_UNAVAILABLE`. Ending the record fires
       `onRecordRemoved`, which releases the entry still holding `oldSessionId`. The old lock is
       therefore released only once no record can drive under either ID, and the new ID is never
       driven without its lock.
  - "No further driving before the handoff completes": `continueSession`, `resumeSession`
    (activate), `sendMessage` into a live query and `permission:respond` for that tab first await
    `pendingHandoff.get(record.token)`. Events of the turn that produced the fork keep streaming;
    they belong to the turn the old lock already authorised. When the handoff refuses, those
    awaiting calls fail with the same error. The pending entry is deleted when the handoff
    settles.
  - Cross-process effect: between steps 2 and 3, this process holds both names. Another process
    sees the old ID as held until step 3 and the new ID as held from step 2. No moment exists in
    which the record drives an unlocked ID.
  - Failure paths of start/continue/resume that never register a record release directly.
  - `SessionLifecycleManager` re-exposes all three notifications. A release that ends `stranded` is
    handled as above; the listener does not swallow it silently.
  - The worker annotates `label = "<clientName> via Ptah worker"`; the desktop uses
    `"<hostname> keyboard"`. The worker maps the error to `SESSION_DRIVEN_ELSEWHERE` with
    `detail.holder`.
  - The W8 `refresh` acquisitions use the same lock and release in a `finally` block.
- Bindings: `platform-electron/src/registration.ts` and `platform-cli/src/registration.ts` bind
  `KernelSessionDriverLock`, or `NullSessionDriverLock` when `process.platform === 'darwin'`.
  That branch is in host registration, not in the runtime-agnostic lib.
  `vscode-core/register-platform-agnostic.ts` registers `NullSessionDriverLock` only when the
  token is absent (VS Code; known limitation, documented). Electron and CLI container smoke specs
  assert the resolved instance is `KernelSessionDriverLock` on Linux.
- Version skew: builds without the lock (e.g. desktop 0.1.70 on a worker) do not take it.
  Readiness check 7 warns when a desktop app older than the first lock-aware version is
  installed on the worker.
- Tests (cross-process, two real Node processes via `child_process.fork`):
  - acquire, then refuse naming the holder, then release, then acquire;
  - the holder is SIGKILLed → immediately acquirable;
  - a holder paused with SIGSTOP → refused with `responding: false`, never acquired, and
    acquirable after SIGCONT and release;
  - two concurrent acquirers → exactly one wins;
  - a release by an old nonce or another process has no effect;
  - **an injected `close()` failure leaves the holder alive in state `releasing`, and the retry
    succeeds** (name free, second process acquires);
  - three failures → `stranded`, visible in `held()`;
  - `ptah worker locks release` with the right control key releases it while the holder stays
    alive;
  - **operator listing and release across processes (round-3 item 2)**: child A (kind
    `desktop`, standing in for Electron main) holds S1, and child B (kind `cli`) holds S2 and a
    stranded S3 (injected `close()` failure). From the test process, `listLocalDriverLocks()`
    returns S1 under A's pid and S2 and S3 under B's pid, with their states.
    `requestRelease(S3)` resolves B as the holder through S3's session endpoint and releases it
    through B's control endpoint, and a third child can then acquire S3. A and B stay alive, and
    S1 and S2 stay held. Next, A is SIGKILLed: its `<pid>.key` is reported stale, deleted and not
    listed. A request with B's pid and a wrong key gets `BAD_KEY`. The endpoint-name builder is
    unit-tested for both `linux` (`\0ptah-ctl-<uid>-<pid>`) and `win32`
    (`\\.\pipe\ptah-ctl-<sid-hash>-<pid>`). The Windows runtime path is covered by the A8
    self-test, which also runs `list` and `release` against a forked child;
  - **rebind handoff (round-3 item 3)**, real `SessionRegistry` plus coordinator plus
    `KernelSessionDriverLock` in child A, and a second child B:
    - A holds old ID O for tab T, then `bindRealSessionId(T, N, ownerToken)` returns
      `'rebound'`. The event carries `{ tabId: T, oldSessionId: O, newSessionId: N, ownerToken }`.
      After the handoff settles, B is refused N (naming A) and acquires O.
    - A `continueSession` on T issued during the handoff runs its SDK call only after N is held
      (the call order is recorded).
    - B pre-binds N (squatter), then A rebinds: A's handoff refuses, the in-flight turn is
      aborted, T gets `SESSION_DRIVEN_ELSEWHERE`, and the record is ended. O stays held by A until
      the record is removed and is then free (B acquires O). A never drives N.
    - The same with an `unavailable` fake gives `SESSION_DRIVER_LOCK_UNAVAILABLE`, with the same
      ordering.
    - A rebind with a wrong token (`'stale-mismatch'`) and an idempotent `'already-bound'` fire no
      event, and O stays held;
    - after a rebind, ending the session releases N (from `heldByRecord`), not the stale O;
  - the same with a live session record → `in-use`, still held;
  - a wrong key → refused;
  - each registry removal path → lock released;
  - `endSession`, `disposeAllSessions` and shutdown → released;
  - `process.exit` → released;
  - an unsupported or erroring endpoint → `unavailable`, no turn started;
  - **native Codex seam (Round 5, AD-25)**, agent-sdk unit specs
    (`codex-chat-driver-gate.spec.ts`, real `CodexChatAdapter`, fake ports, recording fake gate):
    - start: call order `openContext → admit(threadId, 'start') → sessions.opened →
      persistMetadata → publishSession → first turn`;
    - resume of a closed thread: `admit(resumeId, 'resume')` before `openContext`; a refused
      resume never calls `openContext` or the runtime factory;
    - refusal (`SESSION_DRIVEN_ELSEWHERE` or `SESSION_DRIVER_LOCK_UNAVAILABLE`): `open` rejects
      with the gate's error object unchanged (same instance, same `errorCode`); no
      `persistMetadata`, no `publishSession`, no turn; context and scope closed; nothing
      released;
    - a failure after `admit` (persist throws, cancel during `admit`, `busy` race) releases the
      lease exactly once;
    - each removal path (`endSession`, `closeSession`, `dispose`, `reset`, refused interrupt,
      turn-stream close) releases exactly once; a second `close` releases nothing;
      `endSessionIfTokenMatches` releases nothing (the thread stays open);
    - a resumed thread whose ID differs from `resumeId` → `identity-mismatch`, nothing held;
    - a live session's follow-up (`sendMessageToSession`, active `resumeSession`) calls no
      `admit`.
  - **coordinator, both runtimes (Round 5)**, C4b unit specs with the contract fake lock:
    - `admitNative` adopts the provisional entry from `beginDrive` (one `acquire` in total),
      acquires fresh otherwise, rejects with the holder-naming or unavailable error, and holds
      nothing after a rejection; a throwing lock port → unavailable;
    - native continue (live and inactive), resume-activate and rewind call `beginDrive` before
      the SDK call; inactive ones adopt at `admitNative`; a failing call releases its
      provisional entry;
    - the kernel `release` runs only when the last owner (record, lease, provisional) of a
      session ID goes; a native reopen while the old session is still closing keeps the lock
      (old lease release does not free it); operations on one session ID are serialized;
    - an unadopted provisional entry is released when its tab's record is removed before bind;
    - the Round 3 `claude-sdk` specs above pass unchanged.
  - **rewind (Round 5)**: `session:rewindFiles` on an inactive session that another process
    holds → `SESSION_DRIVEN_ELSEWHERE` naming the holder (not `session-not-active`), no
    `sdkAdapter.resumeSession`, no `rewindFiles`; with an `unavailable` fake →
    `SESSION_DRIVER_LOCK_UNAVAILABLE`; a free session → `acquire` before `resumeSession`, adopted
    at bind, released at removal; an already-live session → no new owner;
    `autoResumeIfInactive` reached without `beginDrive` (direct call in the spec) → throws
    `SESSION_DRIVER_LOCK_UNAVAILABLE`, no SDK call;
  - **native cross-process (Round 5)**: child A runs the coordinator, `KernelSessionDriverLock`
    and a `CodexChatAdapter` with fake runtime ports and opens native thread T; child B is refused
    T naming A; A ends T; B acquires T. B holding T first → A's resume of T is refused and never
    opens a context;
  - Electron composition: with packaged win32/x64 input the bound `CODEX_CHAT_ADAPTER_PORTS`
    has `driver`, and `driver.admit` reaches the coordinator (`codex-runtime-composition.spec.ts`);
  - the runtime smoke check on each supported host (`ptah worker locks --self-test` on the
    worker's Node; Electron main's self-test), recorded in the exit runbook (A8).

### W11. Electron renderer contract (`machines:*`, libs/shared)

`libs/shared/src/lib/types/rpc/rpc-machines.types.ts`, registered in `RpcMethodRegistry`:
`machines:list`, `machines:sshAliases`, `machines:add { alias }`,
`machines:pair { machineId, code }`, `machines:pairViaSsh { machineId }`,
`machines:remove { machineId }`, `machines:retry`, `machines:readiness`, `machines:workspaces`,
`machines:sessions`, `machines:session.attach { machineId, sessionId }`,
`machines:session.detach`, `machines:session.replay { machineId, sessionId, afterSeq }`,
`machines:session.start`, `machines:session.continue`, `machines:session.stop`,
`machines:permission.respond`. There are two push types. `machines:event` carries
`{ machineId, sessionId, epoch, seq, type, payload }`. `machines:state` carries
`{ machineId, state: 'connected' | 'offline' | 'reconnecting' | 'version-mismatch' | 'unpaired',
nextRetryAt?, versions?, lastSeenAt? }`. New `RpcUserErrorCode` values:
`SESSION_DRIVEN_ELSEWHERE`, `SESSION_DRIVER_LOCK_UNAVAILABLE`, `MACHINE_UNREACHABLE`,
`MACHINE_VERSION_MISMATCH`, `MACHINE_NOT_FOUND_OR_FORBIDDEN`, `MACHINE_PAIRING_REJECTED`.
`ViewType` gains `'machines'`.

### W12. In-process RPC adapter and safe errors (S3)

- `InProcessRpc.call(method, params, spec)`, where `spec = { result: zod schema, nested?: (data) =>
  { ok: true, value } | { ok: false, errorCode?, error? } }`, runs these steps in order:
  1. `rpcHandler.handleMessage`.
  2. `success: false` → map `errorCode`.
  3. `success: true` → parse `data` with `spec.result`. A parse failure → `INTERNAL`.
  4. For `chat:start`, `chat:continue` and `chat:abort`, `spec.nested` reads `data.success`,
     `data.errorCode` and `data.error`. A nested failure is a failure, never a remote success.
  5. `chat:continue` with `enqueued: true` maps to `{ turnId, queued: true }`.
- Error mapping is an allow list from `RpcUserErrorCode` to `WorkerErrorCode`: `AUTH_REQUIRED` →
  `NO_PROVIDER_READY`, `UNAUTHORIZED_WORKSPACE` → `NOT_FOUND_OR_FORBIDDEN`,
  `SESSION_DRIVEN_ELSEWHERE` → same, `SESSION_DRIVER_LOCK_UNAVAILABLE` →
  `DRIVER_LOCK_UNAVAILABLE`, `SESSION_ATTACHED_TO_GATEWAY` → `SESSION_DRIVEN_ELSEWHERE`. Every
  other code, and a missing code, → `INTERNAL`.
- Wire messages are fixed copy per `WorkerErrorCode`, kept in `worker-protocol`. Only structured,
  allow-listed `detail` fields pass: `holder.label`, `turnId`, `providerId`, `sessionId`. The raw
  message is logged locally through the redactor with a random `ref`, which the client receives.
- Tests: nested `{ success: false }` from each chat method → remote failure; an unknown error
  text containing a path or provider message → fixed copy plus `ref`; redaction of tokens in
  logged errors.

## Component specifications

### Phase 0

#### P0-1. `tools/process-sampler` (new `type:tool` project) and the measurement report

- Purpose: the Phase 0 report (10.1, 10.2) and a repeatable tool for every phase review.
- Responsibilities: sample `/proc/<pid>/stat` and `statm` every 2 s for a duration, group by tree
  root using command-line classes (Electron/`ptah-desktop`, CLI lanes `codex|kimi|grok|claude|gemini`,
  Nx/Jest, Ollama clients, `ptah worker`/`ptah interact`, other), and report mean, p95 and max
  CPU (% of one core) and RSS per group. Output is JSON plus a Markdown table.
- Contracts: Linux `/proc` only. The source is CommonJS JavaScript (`tools/perf/*.js`
  precedent) so it runs unbuilt on Node 20 workers.
- Dependencies: Node built-ins only; read-only; no network.
- Failure behaviour: a process that exits mid-sample is skipped; a non-Linux host exits 2.
- Quality: sampler overhead < 1% of one core, self-reported.
- Verification seam: Jest specs for `parseStat`, `buildTrees`, `aggregate` with fixture text.
  `npm run verify -- -p process-sampler` (S6).
- Measurement run (not a verification): `node tools/process-sampler/src/sampler.js --duration
  1800 --out <file>` on amun-PC under normal work. On the proxy worker (Horus; consent Q4), it
  runs against `ptah interact` (same `withEngine({mode:'full'})` graph) idle 10 min, then one
  scripted session with one tool permission for 10 min. Phase 1 review re-runs it against
  `ptah worker serve`.
- Files: CREATE `tools/process-sampler/{project.json,jest.config.ts,tsconfig.json,README.md}`,
  `tools/process-sampler/src/sampler.js`, `tools/process-sampler/src/sampler.spec.ts`; CREATE the
  deliverable `.ptah/specs/TASK_2026_858_f7b9/phase-0-measurement.md`. All paths are under
  `/home/amun/ptah-extension/.claude-worktrees/remote-workers/`. No shared file is touched.

### Phase 1

#### C0. Scaffold (single owner of shared workspace files)

- Purpose: one batch owns every workspace-wide file, so later batches are file-disjoint (S6).
- Responsibilities: create the four project skeletons (worker-protocol, worker-runtime,
  remote-machines, machines-ui). Each gets `project.json` with tags, tsconfigs, `jest.config.ts`,
  `eslint.config.mjs`, `package.json` where the template has one, and `src/index.ts` exporting
  nothing yet. C0 also adds the four aliases to `tsconfig.base.json`; declares `ws` (^8.21.0)
  and `@types/ws` in the root `package.json` and `ws` in `apps/ptah-cli/package.json`
  `dependencies`; adds `ws` to `apps/ptah-electron/package.json` if
  `apps/ptah-electron/scripts/validate-deps.js` requires it; and adds commit scopes to
  `.commitlintrc.json`. Q6 (answered 2026-11-01): C0 also changes `apps/ptah-cli/package.json`
  `engines.node` from `>=20.12` to `>=22` (`apps/ptah-cli/package.json:44-45`). This matches
  the floor of its own dependency `better-sqlite3@13.0.3`. No other `engines` field changes.
  Assumption: no CI job or script in the repository runs the CLI on Node 20. Check: grep
  `.github/workflows` and `scripts/` for `node-version` values below 22, and report any hit to
  the team-leader before C0 lands.
- Failure behaviour: none at runtime.
- Verification: `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui`
  (empty projects pass lint/typecheck; tests `passWithNoTests` as in `tasks-ui/project.json`).
- Files: CREATE skeleton files under `libs/worker-protocol/`, `libs/backend/worker-runtime/`,
  `libs/backend/remote-machines/`, `libs/frontend/machines-ui/`; MODIFY `tsconfig.base.json`,
  `package.json`, `apps/ptah-cli/package.json`, `apps/ptah-electron/package.json` (conditional),
  `.commitlintrc.json`. No later component edits these files.

#### C1. `worker-protocol` sources

- Purpose: wire contract and isomorphic client.
- Responsibilities: W1 frames and zod schemas; W2/W3/W6 method types; error codes with fixed
  copy (W12); close codes; `PROTOCOL_VERSION` and `negotiateProtocol`; `WorkerClient` (req/res
  correlation, in-flight cap, ping, callbacks, `WebSocketLike` factory, no Node/DOM import);
  `SessionEventReducer` (W7 rules, baseline replace, history-mark advance with no view change);
  `SESSION_EVENT_TYPES`, `HistoryMark` and `WORKER_RECORD_SCHEMAS` (W7 worker record
  serialization); pairing-code normalization.
- Contracts: `FlatStreamEventUnion` (`rpc-chat.types.ts:356`), `PermissionRequest`
  (`permission.types.ts:30`), type imports.
- Failure behaviour: malformed inbound → close 4400, `protocol-error`; per-call timeout (30 s).
- Verification seam: specs for schemas, negotiation, client over in-memory `WebSocketLike`, and the
  reducer (duplicates across reconnect, gap → replay, epoch reset, baseline replace).
  `npm run verify -- -p @ptah-extension/worker-protocol`.
- Files: CREATE `libs/worker-protocol/src/lib/{frames,methods,errors,version,pairing-code}.ts`,
  `src/lib/client/{worker-client,session-event-reducer}.ts` (+ specs); MODIFY
  `libs/worker-protocol/src/index.ts`.

#### C2. Shared contracts (`libs/shared`)

- Purpose: W11 renderer contract and error codes.
- Responsibilities: `rpc-machines.types.ts`; registry entries; `MESSAGE_TYPES`; new
  `RpcUserErrorCode` values; `'machines'` in `ViewType`/`SURFACE_ROUTE_IDS`.
- Contracts: `rpc-error-codes.types.ts:7-27`; `rpc.types.ts:3687`; `message-constants.ts`;
  `webview-surface.types.ts` (`ViewType` :48, which also carries the legacy aliases;
  `SURFACE_ROUTE_IDS` :71; `LEGACY_SURFACE_ALIASES`/`LEGACY_SURFACE_TARGETS` :92-108).
  Round 4: this file and `apps/ptah-extension-webview/src/app/app.routes.ts` were reworked after
  the plan base (onboarding surface, legacy alias map, `ACCEPTED_INITIAL_VIEWS`). The executor
  re-reads both before adding `'machines'`; do not rely on the earlier line ranges.
- Dependencies: none; must not import `worker-protocol`.
- Verification: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`.
- Files: CREATE `libs/shared/src/lib/types/rpc/rpc-machines.types.ts`; MODIFY
  `libs/shared/src/lib/types/rpc.types.ts`, `rpc/rpc-error-codes.types.ts`,
  `messages/message-constants.ts`, `webview-surface.types.ts`, barrel if needed.

#### C3. RPC surface (`rpc-handlers`, `vscode-core` prefix)

- Purpose: `machines:*` as a host-owned capability, worker host label.
- Responsibilities: `remoteMachines` in `capabilities.ts`;
  `{ key: 'host.remoteMachines', methods: [...W11], requires: ['remoteMachines'] }` in
  `manifest.ts`; `'worker'` in `HostProfile.host` (`host-profile.ts:46`); `'machines:'` in
  `ALLOWED_METHOD_PREFIXES` (`vscode-core/src/messaging/rpc-handler.ts:44`); `remoteMachines` in
  `cli-engine/src/lib/rpc/expected-absent.ts` and `apps/ptah-extension-vscode/src/di/expected-absent.ts`;
  baseline updates in `cli-engine/src/lib/rpc/rpc-surface.spec.ts` and
  `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`. The Electron spec is C9's.
- Dependencies: C2.
- Verification: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/host-profile/{capabilities.ts,manifest.ts,host-profile.ts}`,
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts`,
  `libs/backend/cli-engine/src/lib/rpc/{expected-absent.ts,rpc-surface.spec.ts}`,
  `apps/ptah-extension-vscode/src/di/{expected-absent.ts,rpc-surface.spec.ts}`.

#### C4a. Driver lock port, kernel lock and lifecycle notifications

> Round 6 (R6.3 component 4): the vscode-core default registration and the
> `apps/ptah-extension-vscode` file are out of scope; verify lists per R6.5.

- Purpose: W10 port, `KernelSessionDriverLock`, null lock, bindings, the `ptah worker locks`
  control protocol (library side), and registry notifications.
- Responsibilities: interface and token, `KernelSessionDriverLock`, `NullSessionDriverLock` and
  the control-key files (platform-core); contract suite in
  `platform-core/src/testing/contracts/run-session-driver-lock-contract.ts`; bindings in
  `platform-electron` and `platform-cli` registrations (darwin → null); the vscode-core default
  registration (null when absent); `SessionRegistry.onRecordRemoved` from every removal point,
  `onRealSessionIdBound` from `bindRealSessionId`, and `onRealSessionIdRebound({ tabId,
  oldSessionId, newSessionId, ownerToken })` from its `'rebound'` branch (agent-sdk), all
  re-exposed on `SessionLifecycleManager`; the per-process control endpoint
  (`ptah-ctl-<uid>-<pid>`, `list` and `release`, W10) and its discovery file; and the
  `listLocalDriverLocks()` and `requestRelease(sessionId)` client helpers used by C7's
  `ptah worker locks`. `requestRelease` resolves the holder pid from the session endpoint and
  reads that pid's key itself. The registry notifications fire only for `claude-sdk` sessions,
  because only the legacy adapter uses `SessionRegistry`. The native Codex lifecycle points are
  C4c's driver gate, not registry notifications (Round 5, AD-25).
- Contracts: `platform-core/src/di/tokens.ts:120` pattern; `register-platform-agnostic.ts:80-90`;
  `libs/backend/platform-{electron,cli}/src/registration.ts`; registry lines in W10.
- Dependencies: Node `net`, `os`, `fs` only. No native module, so there is no Electron ABI step
  and no Node floor beyond 20.
- Failure behaviour: fail closed (W10); stranded release handling (W10). Listener exceptions in
  registry notifications are caught per listener; a lock release error is reported through the
  lock's own stranded state, not swallowed.
- Verification seam: contract suite; the W10 cross-process specs (forked children, precedent
  `file-settings-manager.cross-process.spec.ts`); registry specs per removal path; Electron and
  CLI smoke specs assert the bound class.
  `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-electron,@ptah-extension/platform-cli,@ptah-extension/agent-sdk,@ptah-extension/vscode-core,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Files: CREATE `libs/backend/platform-core/src/interfaces/session-driver-lock.interface.ts`,
  `libs/backend/platform-core/src/session-driver-lock/{kernel-session-driver-lock.ts,null-session-driver-lock.ts,control-keys.ts,control-endpoint.ts,endpoint-names.ts,local-lock-client.ts}`
  (+ `.spec.ts`, `kernel-session-driver-lock.cross-process.spec.ts`),
  `libs/backend/platform-core/src/testing/contracts/run-session-driver-lock-contract.ts`;
  MODIFY `libs/backend/platform-core/src/{di/tokens.ts,index.ts}`,
  `libs/backend/platform-electron/src/registration.ts`, `libs/backend/platform-cli/src/registration.ts`,
  `libs/backend/vscode-core/src/di/register-platform-agnostic.ts`,
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts` (+ spec),
  `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`,
  `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`, the Electron and CLI container smoke
  specs (`apps/ptah-electron/src/di/surface-composition.spec.ts`, new
  `libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts`).

#### C4b. Driver lock enforcement (`rpc-handlers`)

- Purpose: W10 enforcement in the shared chat path, for both chat runtimes.
- Responsibilities: `SessionDriverLockCoordinator` in
  `libs/backend/rpc-handlers/src/lib/chat/session/` acquires (`beginDrive` for continue,
  resume-activate and rewind; real-ID bound for `claude-sdk` starts), releases
  (`onRecordRemoved`, failure paths through `abandonDrive`) through the owner set per session
  ID (`heldByRecord` keyed by record token, native leases, provisional entries; W10
  "Acquisition ownership"), runs the rebind handoff on `onRealSessionIdRebound` (acquire new,
  then release old; fail closed by abort plus end-record, W10), gates further driving on
  `pendingHandoff`, implements `admitNative` (the host side of `CodexChatDriverGate`, W10
  "Native Codex runtime") and `assertDriveHeld`, and throws the two user errors. It has no
  runtime filter (Round 4's `scopeOf`/`sessionDriverLockScope` removed, Round 5).
  `ChatSessionService` calls it in `startSession` (`chat-session.service.ts:986`; bound
  handler), `continueSession` (`:1531`; after the `ptahCli` passthrough at `:1542-1545`, before
  `gateAccount` at `:1546`), `resumeSession` (`:1778`; before the activate branch at `:1889`),
  `ensureSessionActiveForRewind` (`:2139`; after `gateAccount` at `:2155-2165`, before
  `hasLiveSessionStream` at `:2166`) and `autoResumeIfInactive` (`:2228`; `assertDriveHeld`
  right before `sdkAdapter.resumeSession` at `:2437`). These line numbers moved after the plan
  base; re-read the methods before editing. Registers the coordinator under the new
  `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` (`libs/backend/rpc-handlers/src/lib/chat/tokens.ts:10`)
  through `registerChatServices` and exports the class type from the barrel for C4c.
- Dependencies: C2 (error codes), C4a.
- Failure behaviour: W10 fail closed; `admitNative` rejects with the user error and holds
  nothing; a throw from the lock port inside `admitNative` is treated as `unavailable`.
- Verification seam: unit specs with the contract fake: refusal names the holder, unavailable →
  no SDK call, release on each removal notification and each failure path; the W10
  "coordinator, both runtimes" and "rewind" specs; also the W10 rebind handoff cross-process
  spec (forked children, real `SessionRegistry`, real `KernelSessionDriverLock`).
  `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Files: CREATE `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts`
  (+ spec, + `session-driver-lock-coordinator.cross-process.spec.ts`); MODIFY
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ spec, including
  the `ensureSessionActiveForRewind` cases), `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
  (rewind refusal cases; the handler source needs no change because its catch already rethrows
  `RpcUserError`, `session-rpc.handlers.ts:1584`), `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`,
  `libs/backend/rpc-handlers/src/index.ts` (export the coordinator type),
  the chat services registration file that `registerChatServices` uses.

#### C4c. Native Codex driver gate (`agent-sdk` native adapter + Electron wiring)

- Purpose: make the native Codex runtime emit the lock's lifecycle points (W10 "Native Codex
  runtime", AD-25, decisions.md row 14).
- Responsibilities: `CodexChatDriverGate` and `CodexChatDriverLease` types next to
  `CodexChatSessionLifecycle` (`codex-chat-adapter.ts:131-137`), added as the **required**
  `driver` field of `CodexChatAdapterPorts` and exported from `agent-sdk/src/index.ts`
  (:160-166); in `CodexChatAdapter.open` (`:257-322`): `admit(resumeId, resume)` after
  `prepareProfile` (`:283`) and before `openContext` (`:286`), or `admit(threadId, start)` after
  `:287-290` and before `:291-293`, then `checkOpening`; the `id !== resumeId` identity check;
  the lease stored on the published `TrackedSession` (`publishSession`, `:384-409`;
  `TrackedSession` type `codex-chat-session-controls.ts:14`); `lease.release()` at the removal
  point of `CodexChatSessionControls.close` (`:89-91`) and in `open`'s catch for an admitted,
  unpublished lease; the `admit` rejection rethrown unchanged instead of through `failure()`
  (`codex-chat-adapter.ts:306`). Electron composition passes `driver` next to `sessions`
  (`apps/ptah-electron/src/di/codex-runtime-composition.ts:602`) and resolves the coordinator
  lazily through `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` (precedent: lazy `lifecycle()`,
  `codex-session-binding.ts:40-43`). Every spec that builds `CodexChatAdapterPorts` gets a fake
  gate.
- Dependencies: C4b (`admitNative`, the token). Direction: agent-sdk declares the port and
  knows nothing of the lock; rpc-handlers implements it; the Electron app wires them. CLI and
  VS Code are untouched (they bind `CODEX_CHAT_ADAPTER_PORTS` to `null`, `register.ts:1003-1004`).
- Failure behaviour: W10 "Native Codex runtime" fail closed: a refused or failed `admit` ends
  the open before `persistMetadata`, `publishSession` and the first turn, cleans up the context
  and scope, and holds nothing.
- Verification seam: the W10 "native Codex seam" agent-sdk specs, the native cross-process
  spec and the Electron composition assertion.
  `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
- Files: CREATE `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-driver-gate.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-native.cross-process.spec.ts`;
  MODIFY `libs/backend/agent-sdk/src/lib/codex-app-server/{codex-chat-adapter.ts,codex-chat-session-controls.ts}`,
  `libs/backend/agent-sdk/src/index.ts`, the port fakes in
  `libs/backend/agent-sdk/src/lib/codex-app-server/{codex-chat-adapter.spec.ts,codex-chat-turn-lifecycle.spec.ts}`,
  `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts`,
  `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts`,
  `apps/ptah-electron/src/di/codex-runtime-composition.ts` (+ `codex-runtime-composition.spec.ts`).

#### C5. CLI engine hooks (`cli-engine`)

- Purpose: worker profile injection and push observation.
- Responsibilities: `CliBootstrapOptions.hostProfile?` used instead of
  `createCliRpcHostProfile(host)` at `container.ts:984`; `WithEngineOptions.hostProfile`
  forwarded (`with-engine.ts:258-266`); `CliWebviewManagerAdapter` constructor option
  `tap?: (type, payload) => void`, called synchronously in `dispatch` for each de-batched event
  **before** the emit. A throwing tap is caught and logged by error name, so local listeners
  still run. The tap contract is "observe synchronously, never perform I/O". The ordering and
  failure semantics are W7's, not the adapter's.
- Verification seam: `cli-webview-manager-adapter.spec.ts` (tap sees batch members in order;
  tap error isolated); `surface-composition.spec.ts` with an injected profile.
  `npm run verify -- -p @ptah-extension/cli-engine,ptah-cli,ptah-tui`.
- Files: MODIFY `libs/backend/cli-engine/src/lib/container.ts`, `bootstrap/with-engine.ts`,
  `transport/cli-webview-manager-adapter.ts` (+ spec), `surface-composition.spec.ts`.

#### C6. `worker-runtime` sources

> Round 6 (R6.3 component 3): readiness checks 2, 3, 6 wording, native-limit evidence, and drift
> spec (a) moved to worker-host. Behaviour otherwise unchanged.

- Purpose: everything the worker service does.
- Responsibilities (one file per unit, under `libs/backend/worker-runtime/src/lib/`):
  - `paths.ts`, `workspace-registry.ts` (`workspaceId = 'ws_' + sha256(realpath)[0..12]`),
    `token-store.ts` (W4), `pairing-window.ts` (W3), `admin-key.ts` (W5).
  - `worker-server.ts`: `http.createServer` on a loopback literal only (`127.0.0.1`/`::1`, any other
    host refused at start); `ws.WebSocketServer({ noServer: true })` on `upgrade` for `/rpc`;
    `Host` must be `127.0.0.1:<port>` or `localhost:<port>`; a request with an `Origin` header is
    refused in Phase 1 (AD-14); other paths 404.
  - `connection.ts` state machine (W2/W3), timers released on close.
  - `worker-methods.ts` (W6), `worker-authorizer.ts`, `worker-session-index.ts`.
    `session.continue` and the W8 refresh first read the session's metadata
    (`SessionMetadataStore.get`, `session-metadata-store.ts:1424`); `codexExecution?.runtime ===
    'codex-app-server'` (`:263`) is refused with the W12 mapping of `CODEX_UNAVAILABLE` and
    `session.attach` falls back to snapshot mode (W10 "Native Codex runtime", worker side). This
    is a capability limit: the CLI has no native runtime. It is not a lock gap.
  - `in-process-rpc.ts` (W12) with per-method specs for `session:list`, `chat:start`,
    `chat:continue`, `chat:abort`.
  - `session-driver.ts`: tab map and pre-resolution queue, turn tracking (`TURN_IN_FLIGHT`),
    `maxActiveTurns` (`WORKER_BUSY`), provider gate (`NO_PROVIDER_READY`), lock acquisition via
    the C4 coordinator path (worker turns go through `chat:continue`, so enforcement is the same
    code), baseline (W8), turn markers.
  - `event-capture.ts` + `session-log-writer.ts` + `session-event-log.ts` (W7), `fan-out.ts`.
  - `pending-permissions.ts` (W9), `transcript.ts` (W8 snapshot mode via
    `CHAT_TOKENS.HISTORY_READ` → `ChatHistoryReadService.readForResume`).
  - `readiness.ts`: (1) OS, (2) Node ≥ 22 **and** `better-sqlite3` loads and opens an in-memory
    database (the session store needs it; `better-sqlite3@13` declares `node >=22`). On failure
    the check names the installed Node version and the fix (install Node 22+ or rebuild the
    module), and `ptah worker serve` refuses to start, (3) Ptah CLI and protocol versions, (4) listener
    address, (5) ≥ 1 registered existing workspace, (6) ≥ 1 provider ready (sources as
    `apps/ptah-cli/src/cli/commands/doctor.ts`: `ClaudeCliDetector`, `resolveEffectiveAuthRoute`),
    (7) driver lock self-test passes and no lock is stranded, plus a desktop-app version
    warning; its detail text states the scope, "applies to Claude and native Codex sessions;
    this worker drives Claude sessions only" (AD-25). It also reports grants (2.10)
    and the pairing window state for the SSH-authenticated `status --json`.
  - `capabilities/worker-capabilities.ts` (1.2): rows for every `RPC_CAPABILITIES` key and a
    "core chat/session" row, each `supported | deferred(phase) | unsupported-remotely(reason) |
    not-applicable(reason)`, each with the remote methods it covers. It follows "Phase 1 minimum
    capability set" (a)/(b).
  - `worker-host-profile.ts`: CLI capabilities, `filePicker: false`, `host: 'worker'`,
    `platform: 'cli'`, `assertOnDrift: false`.
  - `redact.ts`; `worker-service.ts` (start: open logs, recover turns, register workspaces (A2),
    bind, write `endpoint.json`; SIGTERM: `ctl goodbye`, flush, release locks, remove `endpoint.json`).
- Failure behaviour: `EADDRINUSE` names the port; append failure per W7; in-process failures
  per W12; the lock store unavailable → readiness fails check 7 and turns are refused.
- Verification seam (`npm run verify -- -p @ptah-extension/worker-runtime`), specs:
  - Security: every `RPC_METHOD_NAMES` entry sent before authentication runs no handler spy and
    sends no session data. Outside-grant per method with an existing outside resource, an
    inside resource and a nonexistent ID (2.9.4). Loopback bind (LAN address refused).
    Host/Origin refusal. Redaction.
  - Pairing: wrong, expired, used and closed-window responses are byte-identical with the same
    minimum delay. 5-attempt close and per-connection throttle. The code is never logged.
  - Grants (Minor 2): the default grant snapshots workspaces registered at window open; a
    workspace added later is refused until `admin.grants.add`, then allowed.
  - Log: seq order, torn tail, interrupted recovery. **No `evt` frame with `seq > head`** under an
    injected slow write. **Append failure mid-turn** → no later frame, `chat:abort` called,
    `ctl degraded` sent, `SESSION_LOG_FAILED` afterwards.
  - Transcript: the W8 cases.
  - Approvals and turns: first-answer-wins, `TURN_IN_FLIGHT`, `WORKER_BUSY`, pre-resolution
    tab queue order.
  - W12 nested failures.
  - Native capability limit (Round 5): `session.continue` on a session whose metadata has
    `codexExecution.runtime === 'codex-app-server'` → `CODEX_UNAVAILABLE`, no `chat:continue`
    call, no lock call; a metadata read error → refused (W12 mapping), no call;
    `session.attach` → snapshot, no lock call; a `claude-sdk` session and one without
    metadata go through the normal lock path.
  - Drift (Minor 1), two specs: (a) **capability mapping**: every `RPC_CAPABILITIES` key and
    every capability on in `createElectronRpcHostProfile` has a row with a status and a reason
    or phase; `deriveRpcSurface(createWorkerRpcHostProfile()).registered` equals the CLI profile's
    surface (in-process parity). (b) **Remote surface**: the set of methods the document marks
    supported equals `Object.keys(WORKER_METHODS)` exactly. `docs/worker.md`'s capability table
    is generated from the same module and compared.
- Files: CREATE the files above (+ specs); MODIFY `libs/backend/worker-runtime/src/index.ts`.

#### C7. `ptah worker` command group (`apps/ptah-cli`)

> **SUPERSEDED by Round 6** (R6.3 components 1 and 2): `apps/ptah-cli` no longer exists. The
> commands live in `@ptah-extension/worker-host`, run as `ptah-worker <command>`, bundled into the
> desktop package. The text below is kept for history only.

- Purpose: worker composition root and operator commands.
- Responsibilities: `worker serve [--port 41873] [--max-active-turns N]`,
  `worker status [--json]`, `worker pair [--workspace ...] [--ttl 300] [--json]`,
  `worker workspace add|remove|list`, `worker grants [list] [--json]`,
  `worker grants add <tokenId> <workspace...>`, `worker locks [--json]`,
  `worker locks release <sessionId> [--yes]` (confirmation prompt, W10 recovery),
  `worker locks --self-test` (A8 smoke). `serve` calls `withEngine({ mode: 'full', thoth:
  'off', hostProfile: createWorkerRpcHostProfile(), pushAdapter: new CliWebviewManagerAdapter({
  tap }) })`. It refuses auto-approve (AD-16).
- Docs `apps/ptah-cli/docs/worker.md`: install procedure (1.8: Linux Mint 21.3+/Ubuntu 22.04+,
  Node ≥ 22 (worker runtime floor and the CLI's published `engines.node`, Q6), `npm i -g @hive-academy/ptah-cli@<ver>`, one provider CLI signed in,
  `worker workspace add`); start (`systemd-run --user --unit=ptah-worker ptah worker serve` or a
  terminal), stop (`systemctl --user stop ptah-worker`), uninstall (`npm rm -g`,
  `rm -rf ~/.ptah/worker`); lifetimes and attempt limits (2.3.5); durability; permission timeout
  (6.3); lock behaviour and known limitations (VS Code, older desktop builds, other hostname,
  and native Codex sessions, which the desktop locks but a worker cannot drive because the CLI
  has no native Codex runtime, AD-25);
  the Node ≥ 22 requirement for the whole CLI (Q6), stated as a breaking change for users on
  Node 20;
  the generated capability table; the Phase 1 exit runbook including A1's real-SSH acceptance.
  The doc is added to the package `files` list (`apps/ptah-cli/package.json:32-43`). **This
  `package.json` edit is in C0's file set: C0 adds both `ws` and `docs/worker.md` to the
  `files` list.**
- Contracts: router pattern `apps/ptah-cli/src/cli/router.ts:590-600`; `with-engine.ts:149-250`.
- Failure behaviour: no running service → `pair`/`grants` exit with "worker service is not running".
- Verification seam: command specs with a fake engine (`doctor.spec.ts`, `interact.spec.ts`
  patterns); auto-approve refusal; `grants add` round trip; `locks release` asks for
  confirmation, sends the control key, reports `in-use` and refuses without `--yes` in non-TTY;
  `serve` refuses on Node < 22 or when `better-sqlite3` fails to load (injected); `serve` integration with a stub
  bootstrap and a real `ws` client. `npm run verify -- -p ptah-cli`.
- Files: CREATE `apps/ptah-cli/src/cli/commands/worker.ts` (+ spec), `apps/ptah-cli/docs/worker.md`;
  MODIFY `apps/ptah-cli/src/cli/router.ts`.

#### C8. `remote-machines` sources (Electron main client)

> Round 6 (R6.3 component 5): remote command = `WORKER_REMOTE_COMMAND`
> (`/opt/Ptah/resources/bin/ptah-worker`), not `ptah worker`.

- Purpose: registry, tokens, SSH transport, connections, `machines:*` handlers.
- Responsibilities: `machine-registry.ts` (`~/.ptah/remote-machines.json`, atomic write, AD-11);
  `machine-token-store.ts`; `ssh-alias.ts` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, `~/.ssh/config`
  `Host` listing); `ssh-worker-commands.ts` (`ssh -o BatchMode=yes -o ConnectTimeout=10 -- <alias>
  ptah worker status|pair --json`, `spawn` with argument arrays and `shell: false`, 15 s timeout,
  zod-parsed output); `ssh-stdio-transport.ts` (`ssh -o BatchMode=yes -o ServerAliveInterval=15
  -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -W 127.0.0.1:<port> -- <alias>` → Duplex);
  `machine-connection.ts` (`WorkerClient` over `ws` with `createConnection`; states; backoff 1,
  2, 5, 10, 30 s ±20%, one timer per machine; reconnect re-attaches open sessions with
  `afterSeq`); `machines-service.ts` (broadcast `machines:event`/`machines:state` via
  `TOKENS.WEBVIEW_MANAGER`, replay by re-attach, no main-side buffer); `machines-rpc.handlers.ts`
  (`machines:readiness` also returns a `local` section with Electron main's in-process lock
  self-test: bind, second bind refused, close, rebind; A8 Electron smoke)
  (`MachinesRpcHandlers` with `register()` (`register-rpc-surface.ts:183-190`), zod params, worker
  codes → W11 codes, never returns tokens).
- Contracts: `ISecretStorage`; `TOKENS.WEBVIEW_MANAGER` (`vscode-core/src/di/tokens.ts:33`);
  `RpcHandler.registerMethod` (`rpc-handler.ts:161`).
- Failure behaviour: pairing failure stores nothing. Remove: `token.revokeSelf` (5 s), delete the
  token and registry entry, kill the transport. It completes even when offline (3.6).
- Verification seam (`npm run verify -- -p @ptah-extension/remote-machines`): alias validation
  (rejects `-oProxyCommand=…`), argument arrays, registry atomic write, state machine/backoff.
  **Online removal** (Minor 2): `revokeSelf` sent, the worker closes the connection, the token is
  deleted and the ssh child killed. Offline removal. The A1 integration spec runs a real `ws`
  server (`createWorkerServer` from `@ptah-extension/worker-runtime`'s public entry) over a
  Duplex pair.
- Files: CREATE `libs/backend/remote-machines/src/lib/*.ts` (+ specs); MODIFY
  `libs/backend/remote-machines/src/index.ts`.

#### C9. Electron host wiring

- Responsibilities: register C8 singletons in `apps/ptah-electron/src/di/phase-4-handlers.ts`.
  In `rpc-host-profile.ts` set `remoteMachines: true` and
  `hostHandlers['host.remoteMachines']: MachinesRpcHandlers`. Dispose `MachinesService` on quit.
  Update `apps/ptah-electron/src/di/rpc-surface.spec.ts`.
- Failure behaviour: host-handler registration failure only warns
  (`register-rpc-surface.ts:183-196`); the Machines view shows "unavailable".
- Verification: `npm run verify -- -p ptah-electron`; pre-push `validate-deps`.
- Files: MODIFY `apps/ptah-electron/src/rpc-host-profile.ts`, `src/di/phase-4-handlers.ts`,
  `src/di/rpc-surface.spec.ts`, the quit/dispose site used by `wire-runtime.ts`.

#### C10. Machines view (`machines-ui`, shell, webview app) — waits for Q1

- Purpose: the Phase 1 UI per `design-spec.md` sections 3, 4.1-4.10, 5, 6, using the designer's
  component names. Q1 is answered: (a) watch-only. **C10 starts only after the designer's revision
  of 4.9 and screen 9 has passed review**, so that the design and the plan agree on 4.9 (S5).
- Responsibilities: `MachinesViewComponent`, `MachineListComponent`, `machine-status` atom,
  `AddMachinePaneComponent` (alias datalist, 8-cell code with paste, "Pair automatically via SSH",
  4.3 banners), `ReadinessPanelComponent` (seven checks), `RemoteSessionListComponent`,
  `RemoteSessionViewComponent` (reuses the local transcript presentational components; "Claude on
  <Machine>"; composer rules 4.6; snapshot mode labelled "last saved state"),
  `RemoteApprovalBlockComponent` (Allow once / Deny, untruncated args, 7c neutral denial),
  reconnect/replay banners (4.8). `MachinesStore` (signals; per-session `SessionEventReducer`),
  `MachinesFeed` (`MESSAGE_HANDLERS`), `MachinesApi` (wrapper over `ClaudeRpcService`). Shell:
  Machines tab between Tasks and Analytics, rendered outside the `hasWorkspaceFolders()` guard
  (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:233`); the
  welcome branch yields to `'machines'` (`:385-388`, which now also tests
  `appState.openConfigurationSurface() === null`, and the second no-folder branch
  `} @else if (!layout.hasWorkspaceFolders()) {` at `:431`; D12); welcome "Machines (N connected)" button; approval count badge (D11); Electron-only.
  4.9 follows Q1. Under option (a) it uses the revised design. Under option (b) the permission
  block is answerable through C11.
- Round 4 drift note: `webview-surface.types.ts` (legacy aliases in `ViewType` :48,
  `SURFACE_ROUTE_IDS` :71) and `app.routes.ts` (Tasks route now `:142-147` with a
  `SURFACE_ACTIVE` provider from `surfaceActiveFor('tasks')`) were reworked after the plan base.
  The executor re-reads both, plus the shell's welcome branch, before copying the Tasks pattern.
- Assumption A7: chat-ui transcript components render without the chat TabManager. Check their
  inputs. Otherwise build trees with `@ptah-extension/chat-execution-tree` pure builders
  (`src/index.ts:16-31`).
- Failure behaviour: offline never marks sessions failed (3.4). Version mismatch shows both
  versions. A gap shows "Fetching missing events" and calls replay. `SESSION_DRIVER_LOCK_UNAVAILABLE`
  shows the fix text.
- Verification seam: component specs per state; store spec for 4.2 (duplicates and a gap across
  a simulated reconnect → render equals no-disconnect render); A5 spec; shell no-folder spec.
  `npm run verify -- -p @ptah-extension/machines-ui,@ptah-extension/chat,ptah-extension-webview,ptah-electron`.
  Electron visual review.
- Files: CREATE `libs/frontend/machines-ui/src/lib/**` (+ specs); MODIFY
  `libs/frontend/machines-ui/src/index.ts`, `apps/ptah-extension-webview/src/app/{app.routes.ts,app.config.ts}`,
  `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (+ spec), the
  welcome component, `libs/frontend/core/src/lib/routing/surface-routes.ts` if it enumerates IDs.

#### C11. Desktop-driver bridge — only if the user picks Q1 option (b)

- Purpose: meet design 4.9 as approved. A remote client watches live and answers permission
  requests of a session that the worker's desktop app drives.
- Contract: the Electron desktop on the worker, while it holds a session's driver lock and a
  local worker is running (`endpoint.json` present, same OS user), connects to the worker's admin
  channel as a `producer`. It forwards that session's `SESSION_EVENT_TYPES` events. The worker
  logs them through W7 under the desktop holder's label, and remote clients get them as usual.
  A remote `permission.respond` for a producer-owned request is relayed to the producer. The
  producer applies first-answer-wins against its own UI with a local pending set and returns
  `applied` or `ALREADY_ANSWERED`.
- Components: worker-runtime `producer-channel.ts` (+ admin method `admin.producer.attach`);
  remote-machines `local-worker-producer.ts`; an Electron wiring hook on the desktop's push
  stream.
- Cost and risk: adds Electron-on-worker work and two-answerer semantics in Phase 1, which the
  plan otherwise brings in Phase 2. One extra HIGH batch plus tests: producer detach mid-turn,
  answer races, and the producer not running.
- Files (if chosen): CREATE `libs/backend/worker-runtime/src/lib/producer-channel.ts`,
  `libs/backend/remote-machines/src/lib/local-worker-producer.ts` (+ specs); MODIFY
  `apps/ptah-electron/src/di/phase-4-handlers.ts` (after C9, same owner as C9).

Design notes resolved without changing the approved design: the no-folder count Minor (the count
comes from store state; rows come from the registry); code length 8 and lifetime 5 min (W3);
`ptah worker grants` name confirmed; "Pair automatically via SSH" = `ssh <alias> ptah worker
pair --json`. The attempts-count copy is Q2.

### Phases 2-4 (component and contract level)

Phase 2 — Fleet:
- `ptah fleet add|list|remove|doctor <alias>` on `remote-machines`. Install a user systemd unit
  with `loginctl enable-linger` (7.1). Electron pairs on first open via `pairViaSsh`, so each
  client has its own token. The doctor extends `readiness.ts` with 7.6.1-7.6.7 and never copies
  credentials (7.3).
- Scoped tokens (2.5): `scope[]` in the token record; each W6 row declares its scope; remote
  `tokens.list`/`tokens.revoke` for `admin` (2.6); revocation closes connections with 4410.
- Origin allow list (2.7) replaces "refuse any Origin".
- Multi-client (4.5, 4.6): fan-out exists; add two-client tests, "N viewers", design 7b.
- Snapshot fallback (4.3): `worker:baseline` records double as snapshots. The retention bound
  keeps the last 20,000 events or 64 MB per session and compacts older lines into the latest
  baseline. Attaching below the floor → `ctl resync-required { snapshot: true }`.
- Tailscale (8.2, 8.3): `tailscale serve` → `127.0.0.1:41873`; a second transport
  `DirectWssTransport`, at which point a `WorkerTransport` interface is extracted. The `Host`
  allow list gains the tailnet name.
- Multi-machine view (3.5); VPS/headless install; C11 if not built in Phase 1.

Phase 3 — PWA (after researcher-expert on the browser floor and Web Push):
- `apps/ptah-remote-pwa` (Angular, `scope:webview`, `type:app`), served by `worker-server.ts` at
  `/` (U4 option 1). It uses `WorkerClient` with the browser `WebSocket`. `MachinesApi` becomes an
  interface (IPC and direct implementations). The token lives in IndexedDB; pairing is by code.
- Web Push with worker-owned VAPID keys. Subscriptions are per token and deleted on revoke
  (9.6). The payload follows U3.

Phase 4 — From anywhere (U2 options 1 and 3):
- `ptah worker expose cloudflare --hostname <h>` / `--off` (8.5); `cloudflared` →
  `http://127.0.0.1:41873`; Cloudflare Access outside; Ptah token always (8.4, 8.6). The worker
  optionally validates `Cf-Access-Jwt-Assertion` (research first). Runbook and `review-security` (R4).

## Integration architecture

- Data flow (start, Phase 1):
  1. Renderer → `ClaudeRpcService.call('machines:session.start')` → IPC.
  2. `MachinesRpcHandlers` → `MachineConnection.request('session.start')` → `ws` over the
     `ssh -W` Duplex → worker `/rpc`.
  3. Worker: schema → authorizer → session driver → provider gate → `InProcessRpc('chat:start')`.
     Nested-result validation follows. The worker awaits `session:id-resolved`, and the lock is
     acquired on real-ID bind.
  4. SDK pushes → adapter tap → capture queue → writer appends → fan-out `evt`.
  5. Electron main → `machines:event` → `MachinesFeed` → reducer → render.
  6. Approvals: renderer → `machines:permission.respond` → worker pending index → `handleResponse`.
- State: the worker owns `~/.ptah/worker/{tokens.json, workspaces.json, admin.key,
  endpoint.json, events/*.jsonl}`. Electron owns `~/.ptah/remote-machines.json` and secret-stored
  tokens. Driver locks are kernel-held names per OS user and session (no store). Control keys
  live in `~/.ptah/session-drivers/<pid>.key`. Session JSONL, `sessions.sqlite` and `ptah.sqlite` are
  unchanged.
- External boundaries: frames (zod, size and rate caps); SSH alias (regex, `--`, argument arrays);
  `ssh` output (zod); files at start (zod; a world-readable `tokens.json` refuses start).
- Observability: `[worker] conn=<id> method=<m> outcome=<ok|code> ref=<ref> ms=<n>` without
  params; pairing failures with `windowOpen`/`attemptsLeft` locally; `[driver-lock] refused|unavailable`;
  `[event-log] append failed session=<id>`; Electron main state transitions. `ptah worker status
  --json` shows readiness, pairing state, grants and held locks.

## Failure behaviour

| Situation | Worker | Electron main | Renderer |
| --- | --- | --- | --- |
| SSH drop / Wi-Fi loss | Sessions keep running and logging | ssh exit or ping timeout (≤ 45 s / ≤ 30 s) → `reconnecting`, backoff | "Reconnecting"; sessions "Running (last known)" (3.4) |
| Reconnect | hello/auth; `attach {afterSeq}` replays then live | Re-attaches with last forwarded seq | Reducer drops duplicates, fills gaps; banner 4.8 |
| Worker restart / crash | `turn.interrupted` appended; epoch kept; locks of the dead process reclaimable (pid dead) | Reconnects | "Interrupted"; idle sessions listed (1.6) |
| Log append failure | Writer stops, turn aborted, `ctl degraded`, `SESSION_LOG_FAILED` | Forwards | Banner with the cause; composer disabled |
| Lock store unavailable | Turn refused (`DRIVER_LOCK_UNAVAILABLE`), readiness check 7 fails | Maps | Fix text |
| Epoch changed | `ctl resync-required` | Forwards | Re-attach from latest baseline |
| Version mismatch | 4409 with both versions | `version-mismatch`, retry on user action or after 10 min | Banner with both versions and update command |
| No `ptah worker` (Chappie 0.1.60) | n/a | `status --json` fails → `version-mismatch` "no worker service" | Same banner |
| Two clients (Phase 2 tested) | First answer wins; later `ALREADY_ANSWERED` | Forwards | Final state on both |
| Second turn in flight | `TURN_IN_FLIGHT { turnId }` | Maps | Composer disabled (4.7) |
| Keyboard user drives | Desktop holds lock → `SESSION_DRIVEN_ELSEWHERE { holder }` | Maps | Banner "Driven locally"; 4.9 per Q1 |
| Remote drives, keyboard user tries | Worker holds lock | n/a | Desktop shows the error naming "<client> via Ptah worker" (1.5) |
| Holder paused (SIGSTOP) | Never displaced | Maps refusal | Owner shown until it ends |
| Nested chat failure | W12 mapping, fixed copy + ref | Maps | Message per code |
| Wrong/expired/used code, no window | Identical `PAIRING_REJECTED` | Nothing stored | Banner 4.3 (count per Q2) |
| Worker busy | `WORKER_BUSY` | Maps | "Machine is at its session limit (N)" |

## Resource budget (proposal for Gate 2)

Numbers come from Phase 0 and are approved by the user:

- B1 Idle service: mean CPU ≤ 2% of one core over 10 min. RSS ≤ 1.2 × the measured idle RSS of
  `ptah interact` on the proxy worker. Thoth off (`with-engine.ts:379-391`).
- B2 Per active session: service RSS growth ≤ 1.2 × the measured one-session delta. Provider CLI
  children are reported separately.
- B3 Cap: `maxActiveTurns = max(1, min(cores − 2, floor((MemTotal − 2 GB − ollamaResident −
  desktopPtahRss − idleRss) / perSessionRss)))`. Default 2 on 4-core workers until measured. On
  Chappie, `d3:4b`'s 7.1 GB is subtracted if O4 moves it. Enforced by `WORKER_BUSY`; override
  with `--max-active-turns`.
- B4 Disk: readiness warns when `~/.ptah/worker/events` > 1 GB or free disk < 5 GB.
- B5 Phase 2 unit limits: `CPUQuota=(cores−1)×100%`, `MemoryHigh` = B1 + B3 × B2.
- Each phase review re-runs P0-1 against B1-B3.

## What changes under each U1-U5 alternative

| Decision | Answer | Plan delta |
| --- | --- | --- |
| U1 | 1 (recommended) | As written. |
| U1 | 2 `ptah interact` spike | Phase 1a runbook plus a throwaway script (`ssh <alias> ptah interact`, one `task.submit`), measured with P0-1. Nothing merged under `libs/`/`apps/`. C0-C10 become Phase 1b. |
| U1 | 3 SSH stdio lane spike | Phase 1a spike branch that may reuse C8's `ssh-stdio-transport.ts` (built first) to run one lane; not merged as a capability. C0-C10 unchanged. |
| U2 | 1 (recommended) | Tailscale Phase 2, Cloudflare Phase 4. |
| U2 | 2 Tailscale only | Phase 4 dropped; Host/Origin lists gain only tailnet names. No Phase 1 change. |
| U2 | 3 Cloudflare for everything | Phase 4 moves to Phase 2 with `review-security`; no Tailscale transport. No Phase 1 change. |
| U3 | 1 or 2 | Only the Phase 3 push payload builder. |
| U4 | 1 (recommended) | PWA static route on `worker-server.ts` (Phase 3). |
| U4 | 2 Ptah-hosted static site | No `/` route; Origin allow list includes the Ptah origin; pairing asks for the endpoint; publishing is a Phase 3 delivery item. No Phase 1 change. |
| U5 | 1 or 3 | No licensing code. |
| U5 | 2 Gate from Phase 1 | **Coverage is the user's choice** (Clarifications Q5): which of pairing, attach/watch, transcripts, start/continue/stop, approvals and the PWA are paid. Enforcement is on the server in every case. A `WorkerLicenseGate` checks the worker machine's license through the existing `LicenseService` (registered in the CLI container). The checks run at `pair.exchange` and `auth` (connection state) when the covered set includes pairing or any access, and then per `WORKER_METHODS` row marked `licensed: true` before the authorizer, so every covered method on every connection state is enforced. The result is a new `LICENSE_REQUIRED` code with fixed copy. The Electron view only reflects the state (no client-side gate). Tests: each covered method and each connection state (pre-auth, authenticated, admin is exempt) refused without a license and allowed with one; uncovered methods are unaffected. One extra Phase 1 batch after C6. |

## Architecture-level quality requirements

- Scope of 1.5 (Round 5, AD-25): "single owner per session across local and remote" is enforced
  for `claude-sdk` and native Codex (`codex-app-server`) sessions on every Electron and CLI host
  (Linux and Windows). A worker never drives native sessions (capability limit, C6).
- Functional: Phase 1 exit scenario (install → ready → add by alias → pair → start → stream →
  approve → drop and restore network → gap-free, duplicate-free render → desktop keeps working).
- Performance: B1-B3; append + frame adds ≤ 50 ms to the first event on the worker; O(1) per
  event in the renderer.
- Security: 2.1 bind test; 2.2-2.4 every-method pre-auth spec; 2.3.3 identical rejections; 2.8
  redaction; 2.9 outside-grant spec; W12 error copy; 8.1 port scan in the runbook;
  `review-security` before Phase 1 ships (R9).
- Correctness: 1.5 fail-closed lock (both runtimes) with the W10 cross-process, native-seam
  and rewind specs; 4.1 log-before-send spec;
  5.1-5.2 W8 specs.
- Maintainability: new libs import `vscode-core` only in handler files; boundaries per the
  table; two drift specs (Minor 1).

## Test strategy and verify commands

> Round 6: this table lists removed projects and is superseded by R6.5. The runbook moves to
> `libs/backend/worker-host/docs/worker.md`.

Jest only, scoped, inside the worktree. Dependent hosts are in the same command.

| Component | Verify command |
| --- | --- |
| P0-1 | `npm run verify -- -p process-sampler` |
| C0 | `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui` |
| C1 | `npm run verify -- -p @ptah-extension/worker-protocol` |
| C2 | `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview` |
| C3 | `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` |
| C4a | `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-electron,@ptah-extension/platform-cli,@ptah-extension/agent-sdk,@ptah-extension/vscode-core,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` |
| C4b | `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` |
| C4c | `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui` |
| C5 | `npm run verify -- -p @ptah-extension/cli-engine,ptah-cli,ptah-tui` |
| C6 | `npm run verify -- -p @ptah-extension/worker-runtime` |
| C7 | `npm run verify -- -p ptah-cli` |
| C8 | `npm run verify -- -p @ptah-extension/remote-machines` |
| C9 | `npm run verify -- -p ptah-electron` |
| C10 | `npm run verify -- -p @ptah-extension/machines-ui,@ptah-extension/chat,ptah-extension-webview,ptah-electron` |
| C11 (if chosen) | `npm run verify -- -p @ptah-extension/worker-runtime,@ptah-extension/remote-machines,ptah-electron` |

The specs per component are listed in each component's "Verification seam". The Phase 1 exit
runbook (in `apps/ptah-cli/docs/worker.md`) runs on a preprovisioned worker after O3, or on Horus
with consent (Q4). It covers the exit scenario, **A1's real `ssh -W` acceptance (recorded result)**,
a port scan of non-loopback addresses (8.1), `pkill -f "ptah worker serve"` mid-turn (1.6), and a
desktop session on the worker during a remote session (1.4/1.5). Visual review in Electron only.

## Risks

> Round 6: AR8 is closed (bundled runtime, AD-31). New risks: A10 node mode on the packaged
> app (fallback: bundle outside the asar), A12 watcher degrade only (R6.2).

| ID | Risk | Mitigation |
| --- | --- | --- |
| AR1 | A1 fails | `ssh -L` fallback; Duplex spec first; real-SSH acceptance in the runbook. |
| AR2 | A2 fails | Workspaces registered through the lifecycle provider at start; if still refused, one engine per workspace (budget impact reported at the gate). |
| AR3 | A holder that is alive but hung blocks a session indefinitely | Intended (never steal from a live holder). `ptah worker status` lists held locks with pid and label; the refusal names the holder; the operator ends it. |
| AR4 | Fail-closed lock blocks local chat when the platform refuses the lock endpoint (e.g. a sandbox without the abstract namespace) | No native module is involved. The refusal names the cause and fix; readiness check 7; `--self-test`. Q3: every Electron and CLI host, for `claude-sdk` and native Codex sessions (AD-25, Round 5). |
| AR11 | A native Codex open or close path that bypasses the gate would drive or hold unlocked (Round 5) | The gate is a required port (compile error when absent); `admit` sits on the only open path (`open`, used by start and inactive resume) before the first turn, and `lease.release()` on the only removal path (`CodexChatSessionControls.close`). C4c specs pin the call order and exactly-once release per removal path. The worker cannot drive native sessions at all (no native runtime on the CLI) and refuses them with `CODEX_UNAVAILABLE`; documented in `worker.md` as a capability limit. |
| AR10 | Lock squatting by another local OS user who knows a session UUID | Refusal only (no second driver); uid in the name; documented. |
| AR5 | Linux without keyring stores client tokens in plain text | Warning after pairing; file 0600. |
| AR6 | A3 false (history incomplete after release) | Baseline spec with fixture JSONL; if false, the worker also writes a baseline after its own turn end and compares `lastMessageId` before the next turn, refusing with a retry when they differ. |
| AR7 | Shared-lib batches widen verify runs | Small early batches; verify lock serializes. |
| AR8 | Worker on Node 20 (Horus) while `better-sqlite3@13` needs Node 22 | Readiness check 2 refuses below 22 with the fix; Q6 (answered) raises the published `engines.node` to `>=22` in C0, so npm warns at install (or refuses under `engine-strict`); Q4 includes installing Node 22+ on the proxy worker. The lock itself needs only `node:net`. |
| AR9 | Older lock-unaware desktop builds on a worker | Readiness warning; documented; the version-skew NFR covers the upgrade (O3). |
| R1-R9 | As in task-description | Unchanged; R9 tests in C6. |

## Team-leader handoff

> Round 6: C7 rows, `apps/ptah-cli/**` files and the VS Code files are superseded by R6.6.

- Recommended executors: C0 → devops-engineer (workspace config, deps, scaffolding); P0-1 →
  devops-engineer for the tool, with the measurement run coordinated by the orchestrator after Q4;
  C1, C4a, C4b, C4c, C5, C6, C8, C11 → backend-developer; C2, C3 → backend-developer; C7, C9 →
  backend-developer; C10 → frontend-developer. senior-tester pins the C6 security specs, the W10
  cross-process specs and the C10 4.2 comparison. `review-security` before Phase 1 ships.
- Complexity: HIGH overall. P0-1, C0 LOW; C1, C2, C5 MEDIUM; C3 MEDIUM; C4a, C4b, C4c, C6, C8, C10, C11 HIGH;
  C7, C9 LOW-MEDIUM.
- Dependencies and ordering (component level):
  - P0-1 is independent of everything (own files only).
  - C0 comes first among Phase 1 work.
  - C1, C2, C5 need only C0. C4a needs C0.
  - C3 needs C2. C4b needs C2 and C4a. C4c needs C4b.
  - C6 needs C1, C3, C4b, C5. C7 needs C5, C6. C8 needs C1, C2, C6 (public `createWorkerServer`
    for its spec). C9 needs C3, C8.
  - C10 needs C2 and the reviewed revision of design 4.9 and screen 9 (Q1 (a), answered). It can
    use a fake `MachinesApi` before C8/C9. C11 is Phase 2 under Q1 (a). When it is built, it needs
    C6, C8, C9.
- Parallel-safe work (file-disjoint after C0):
  - {P0-1} at any time;
  - {C1, C2, C4a, C5};
  - {C3, C4b} — they touch different `rpc-handlers` files: C3 owns `host-profile/*`, C4b owns
    `chat/session/*` (except `chat-continue-codex-resume-once.spec.ts`, which is C4c's), the
    chat `tokens.ts`/`di.ts` and the barrel `src/index.ts`;
  - {C4c} after C4b (it consumes the coordinator's `admitNative`); it is file-disjoint from C3
    and C6;
  - {C6, C10};
  - {C7, C8};
  - {C9} then {C11}.

  C0 alone touches `tsconfig.base.json`, the root `package.json`, `apps/ptah-cli/package.json`,
  `apps/ptah-electron/package.json` and `.commitlintrc.json`. Each spec file has one owner:
  Electron `rpc-surface.spec.ts` → C9; CLI/VS Code `rpc-surface.spec.ts` → C3;
  `surface-composition.spec.ts` (cli-engine) → C5; Electron `surface-composition.spec.ts` → C4a.
  C9 must not edit it; its Electron spec is `rpc-surface.spec.ts`.
- Files affected:
  - CREATE: `tools/process-sampler/**`; `libs/worker-protocol/**`;
    `libs/backend/worker-runtime/**`; `libs/backend/remote-machines/**`;
    `libs/frontend/machines-ui/**`; `libs/shared/src/lib/types/rpc/rpc-machines.types.ts`;
    `libs/backend/platform-core/src/interfaces/session-driver-lock.interface.ts`;
    `libs/backend/platform-core/src/testing/contracts/run-session-driver-lock-contract.ts`;
    `libs/backend/platform-core/src/session-driver-lock/**`;
    `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts`;
    `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-driver-gate.spec.ts`;
    `libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts`;
    `apps/ptah-cli/src/cli/commands/worker.ts` (+ spec); `apps/ptah-cli/docs/worker.md`;
    task-folder `phase-0-measurement.md`.
  - MODIFY: as listed per component (C0-C11). No file appears in two components.
  - REWRITE: none.
- Verification points: A1-A7 at their seams (A1's final check is the runbook). Every command in
  the verify table (no workspace-wide runs, no build/serve/dev/e2e/package). `review-security` on
  C6/C8. Electron visual review of C10. Pre-push `validate-deps` after C0.

## Decisions

> Round 6: AD-1 and AD-21 are superseded by AD-26 and AD-31; AD-12 keeps its meaning under
> `ptah-worker grants add` (R6.7).

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| AD-1 | Worker = `ptah worker` on `withEngine`/`CliDIContainer` | new app / extend `interact` / CLI command | `container.ts:403-1009`; CLI ships to workers | yes, before C7 |
| AD-2 | Own remote method table (W6) | forward with allow list / own table | 1.3, 2.2-2.4, 2.9 by construction | yes, protocol v2 |
| AD-3 | WebSocket via declared `ws` (MIT) | `ws` / hand-rolled / HTTP+SSE | `npm ls ws`; SSE lacks auth header | yes |
| AD-4 | Worker owns its `http.Server` | extend `IHttpServerProvider` / own | No upgrade hook; one consumer | yes |
| AD-5 | Electron transport = `ws` over `ssh -W` | `-W` / `-L` | No local listener; A1 | yes |
| AD-6 | Renderer keeps `ClaudeRpcService` over IPC | WS in renderer / IPC | Token in main | yes |
| AD-7 | Event log = per-session JSONL with an ordered writer; crash-durable | SQLite / JSONL | No coupling to existing DBs | yes |
| AD-8 | `hello` (versions only) is part of the pre-auth exchange and says nothing about pairing | auth first / hello first | Version-skew NFR; S4 | yes |
| AD-9 | Design 4.9 is not changed by the plan; user picks revised design (a) or C11 bridge (b) | (a) / (b) | `design-spec.md:109-113`; process-local permissions (`cli-fire-and-forget-handler.ts:27-45`) | yes |
| AD-10 | Driver lock = platform-core port + kernel-held local socket (Linux abstract namespace, Windows named pipe, macOS null); fail closed; never displaces a live holder; release retried, stranded state visible, operator release with control key and confirmation; release on every registry removal | file lock / SQLite table / kernel-held name | Review B1 and round-2 items; `better-sqlite3` `engines >=22`; `session-registry.service.ts` removal points | yes |
| AD-21 | Worker runtime floor = Node 22, enforced by readiness and `serve`; C0 raises `apps/ptah-cli/package.json` `engines.node` from `>=20.12` to `>=22` (user answer Q6, 2026-11-01; breaking public change, release notes in C7 docs) | keep 20.12 / raise to 22 | `better-sqlite3@13.0.3` `engines.node >=22`; session store needed by the worker; decisions.md row 10 | yes (a later release can lower it) |
| AD-23 | Lock holder discovery = per-process control endpoint `ptah-ctl-<uid>-<pid>` (key-authenticated `list`/`release`) found through owner-only `<pid>.key` files; release resolved through the session endpoint's holder pid | per-process endpoint / lifecycle-managed session inventory file | Round-2 re-review Serious 2; holder memory is the single source of truth; no disk write on the turn path | yes |
| AD-24 | Rebind = `onRealSessionIdRebound` handoff (acquire new, then release old); on failure keep the old lock, abort the turn and end the record, so the old lock is released through `onRecordRemoved` | release old in a removal notification / handoff event | `session-registry.service.ts:380-394` mutates the record, does not remove it | yes |
| AD-25 | Driver lock covers both runtimes (Round 5). `claude-sdk`: `SessionRegistry` notifications. Native `codex-app-server`: a required `CodexChatAdapterPorts.driver: CodexChatDriverGate` that the adapter calls at thread-ID bind (`admit`, before any turn) and at removal (`lease.release()`); no rebind exists for native threads. The coordinator owns both, with one owner set per session ID. The worker refuses native sessions from session metadata `codexExecution.runtime` as a capability limit; `sessionDriverLockScope` removed | register native sessions in `SessionRegistry` / reuse `CodexChatSessionLifecycle.opened/closed` / new gate port | User decision 2026-11-02 (decisions.md row 14, superseding row 13); `codex-chat-adapter.ts:117-137,283-317`, `codex-chat-session-controls.ts:87-105`; registry records are Claude query records (`session-registry.service.ts:289-310`) and feed `evictStale`/`displaceExisting` (`:676-690,775-790`) and Electron's tab map (`codex-session-binding.ts:54`); `opened` is synchronous and optional, so it cannot refuse an open; CLI binds native ports and the identity lookup to `null` (`register.ts:1003-1015`, `apps/ptah-cli/src/di/expected-resolvable.ts:20-35`) | yes |
| AD-22 | Attach refreshes the baseline at a lock-proven idle boundary using history marks | baseline only on next worker turn / refresh at attach | Round-2 item 3; A3 | yes |
| AD-11 | Machine registry file `~/.ptah/remote-machines.json`; per-client tokens | Electron state / shared file | Phase 2 `ptah fleet add` | yes |
| AD-12 | Grant extension `ptah worker grants add` | re-pair only / local command | 2.10 | yes |
| AD-13 | `token.revokeSelf` in Phase 1 | Phase 2 only / now | 3.6 should not leave a valid worker token | yes |
| AD-14 | Phase 1 refuses any `Origin` header; checks `Host` | Phase 2 only / now | No browser client yet; DNS rebinding | yes |
| AD-15 | Code 8 Crockford chars, 300 s, 5 failures per window; all rejections identical | design placeholders | 2.3.3-2.3.5, 2.4 | yes |
| AD-16 | Worker refuses auto-approve | allow / refuse | `with-engine.ts:353-372` | yes |
| AD-17 | Worker libs `scope:extension`, no `cli-engine` import | `scope:cli` / `scope:extension` | eslint constraints; U4 open | yes |
| AD-18 | Transcript = latest baseline + log for logged sessions; read-only snapshot otherwise | cut by head seq / baseline + log | S1; `chat-session.service.ts:1785-1840`; `chat-history-read.service.ts:63-77` | yes |
| AD-19 | `InProcessRpc` validates nested results and maps errors through an allow list with fixed copy | pass-through / adapter | S3; `rpc-handler.ts:199-225`; `chat-session.service.ts:1119-1135` | yes |
| AD-20 | C0 owns every workspace-wide file; Phase 0 sampler is a `type:tool` Nx project | scripts/ + `test:scripts` / tool project | S6; `tools/mcp-bench/project.json` | yes |

## Clarifications Needed

> Round 6: Q4 (Node 22 + CLI on Horus) and Q6 (CLI `engines.node`) are obsolete — the desktop
> package carries its runtime (AD-31). New open points are R6-Q1 and R6-Q2 in R6.8.

User-reserved points. The user answered all seven at Gate 2 (2026-11-01; decisions.md row 10;
context.md "Gate 2 user answers"). The plan follows those answers: C10 waits for the designer's
revision of 4.9 and screen 9 and its review; C11 is not in Phase 1 (Q1 (a)); the U5 batch is not
built (U5 = 1). No new clarification is open. Fleet operations O1-O6 stay unanswered outside this
plan.

1. Design 4.9 (a session the worker's desktop app drives, seen from a remote client):
   - (Recommended) (a) Revise the design for Phase 1. The remote client sees it watch-only:
     last-saved transcript with refresh, owner chip, composer disabled, and a permission block that
     says "Answer at <Machine>". Live watch and remote answering come in Phase 2 (C11 there). The
     designer updates 4.9 and screen 9, and the revised design goes back through review before
     C10.
   - (b) Keep 4.9 as approved and build the desktop-to-worker bridge (C11) in Phase 1. That adds
     one HIGH batch and brings two-answerer semantics forward.
   Answered (2026-11-01): (a) watch-only in Phase 1. C11 moves to Phase 2. C10 starts only
   after the designer's revision of 4.9 and screen 9 and its review have passed.
2. Pairing failure banner, remaining attempts (security copy):
   - (Recommended) Show the count, obtained only over the user's SSH login (`ptah worker status
     --json`). The unauthenticated protocol never reveals it.
   - Show "a few attempts left" without a number (same SSH source).
   - Hide the count; only say when the window closed.
   Answered (2026-11-01): recommended. Show the count, read only over SSH.
3. Driver-lock enforcement scope (fail closed in every case):
   - (Recommended) Every Electron and CLI host that includes the lock enforces it.
   - Only machines where the worker is installed (`~/.ptah/worker/` exists) enforce it. Other
     machines keep today's behaviour.
   Answered (2026-11-01): recommended. The lock is enforced on every Electron and CLI host.
   Round 4 narrowed this to `claude-sdk` sessions on an auto-picked answer (decisions.md row 13,
   not the user's). User answer (2026-11-02, decisions.md row 14): hook native Codex too. The lock
   is enforced on every Electron and CLI host for sessions on **both** runtimes: `claude-sdk`
   through the `SessionRegistry` notifications and native `codex-app-server` through the
   `CodexChatDriverGate` (W10 "Native Codex runtime", AD-25). The worker still refuses to drive
   native sessions because the CLI has no native runtime (a capability limit, not a lock gap).
4. Installing Ptah CLI on a worker for Phase 0 and the Phase 1 exit (fleet operation):
   - (Recommended) On Horus (`claude` present), install Node 22+ next to its Node 20 (for
     example with a per-user version manager) and `npm i -g @hive-academy/ptah-cli`.
   - Wait for O3 and use Chappie only.
   - Phase 0 on amun-PC only; measure the worker in the Phase 1 review.
   Answered (2026-11-01): recommended. Install Node 22+ and the CLI on Horus.
5. Only if U5 = option 2 (gate from Phase 1): which remote capabilities are paid?
   - Everything remote (pairing and every client method).
   - Driving and approvals only (start/continue/stop/permission.respond); watching stays free.
   - The PWA only (no Phase 1 gate; the U5 batch moves to Phase 3).
   No recommendation: pricing is the user's decision.
   Answered (2026-11-01): not applicable, because U5 = option 1.
6. Worker Node floor and the CLI's published `engines` field (breaking public change):
   - (Recommended) Raise `apps/ptah-cli/package.json` `engines.node` to `>=22`. Its own
     dependency `better-sqlite3@13.0.3` already declares `>=22`, so the current `>=20.12` promises
     a floor the package does not meet. Readiness check 2 and `serve` enforce it for the worker.
   - Keep `>=20.12` for the CLI as a whole and enforce Node ≥ 22 only in `ptah worker` commands
     (readiness check 2 and `serve` refusal). The mismatch for other commands stays as today.
   Either way, Horus needs Node 22+ before Phase 0's worker measurement (Q4).
   Answered (2026-11-01): raise `engines.node` to `>=22`. C0 makes the change (AD-21).
7. U1-U5 themselves (task-description "User decisions (reserved)"). This plan assumes option 1
   for each; the deltas are in "What changes under each U1-U5 alternative".
   Answered (2026-11-01): U1-U5 all option 1 (decisions.md row 10). U5 is decided again before
   Phase 3; Phase 1 builds ungated.

## Revision log

Round 1 (2026-11-01), answering `implementation-plan-review.md` (Verdict REVISE).

| Review item | Change |
| --- | --- |
| Blocking 1: lock can fail open, steals after heartbeat delay, no proven release | W10 rewritten. SQLite store in a separate file with `BEGIN IMMEDIATE` atomic acquire and reclaim. Liveness by pid and process start time only (no heartbeat, no time-based steal). Nonce-checked release. **Fail closed** on any store error (AD-18 old "fail open" removed). Release via a new `onRecordRemoved` fired at every registry removal point (`remove`, `evictStale`, `displaceExisting`, rebind) covering `endSession`/`disposeAllSessions`/shutdown. Exit-handler release. Cross-process specs for I/O failure, paused live holder, competing reclaimers, pid reuse, late release, each removal path. Component split C4a/C4b; Q3 for enforcement scope; old A4 removed. |
| Serious 1: transcript cut / A3 / A6 / AR6 | W8 rewritten to baseline + log. Baseline is read with `ChatHistoryReadService.readForResume` only while the worker holds the lock, before its turn. Snapshot mode for unlogged sessions. `chat:resume` no longer used (evidence `chat-session.service.ts:1648-1690`). A3 replaced; A6 pins the lock path; AR6 rewritten; tests for history lag, completion during attach, restart, interleaved desktop turns. |
| Serious 2: tap not awaited | W7 defines the ordered capture queue and writer. Frames are sent only from the post-append callback. The append-failure signal aborts the turn, stops sending, sends `ctl degraded`, then `SESSION_LOG_FAILED`. The queue is bounded. C5 tap is synchronous observe-only. Specs for slow write and append failure mid-turn. |
| Serious 3: nested RPC failures and raw errors | New W12 `InProcessRpc`: result schemas, nested `success` unwrapping, `enqueued` handling, `session.start` awaits `session:id-resolved`. Allow-listed code mapping, fixed copy, local `ref` logging. Specs. |
| Serious 4: pairing responses distinguishable | W3: identical `PAIRING_REJECTED` with no detail for wrong/expired/used/no-window; minimum response delay and dummy hash; `hello` no longer reports `pairingOpen`. The attempts count is available only via SSH-authenticated `status --json`, subject to Q2. Byte-identity spec. |
| Serious 5: design 4.9 conflict | The plan no longer changes the design. AD-9 and Q1 offer a revised design (a) or the C11 bridge (b), with C11 specified. C10 gated on the answer. |
| Serious 6: overlapping files; Phase 0 command | New C0 owns `tsconfig.base.json`, root and app `package.json`, `.commitlintrc.json`, project skeletons. Spec-file ownership assigned (Electron `rpc-surface.spec.ts` → C9 only). Parallel groups recomputed. P0-1 becomes `tools/process-sampler` (`type:tool`, `tools/mcp-bench` precedent), verified with `npm run verify -- -p process-sampler`; the measurement run is separate. |
| Serious 7: U5 delta incomplete | U5-2 row rewritten: coverage left to the user (Q5), server-side enforcement at connection states and per licensed method, no client-side gate, tests per covered method and state. |
| Minor 1: drift test conflates surfaces | C6 now has two specs: capability mapping (+ in-process parity via `deriveRpcSurface`) and remote surface (`WORKER_METHODS` equals document). |
| Minor 2: missing success-path tests | C6 grant snapshot and `grants add` spec; C8 online-removal spec (revoke, close, token delete, ssh child killed). |
| Minor 3: A1 stops short of SSH | A1's final acceptance is the real `ssh -W` runbook step, recorded before ship. |

Round 2 (2026-11-01), answering "Round 1 re-review" in `implementation-plan-review.md`.

| Review item | Change |
| --- | --- |
| New Blocking: SQLite lock binding needs Node ≥ 22 (`better-sqlite3@13.0.3`) | The lock no longer uses SQLite. W10 rewritten to `KernelSessionDriverLock`: a kernel-held per-session name (Linux abstract socket, Windows named pipe) on `node:net` only. It has no native module, so no Electron ABI step; it works on Node 20, 22+ and Electron main; macOS binds the null lock (no worker there). A8 added with Jest cross-process tests and a per-host runtime smoke (`ptah worker locks --self-test`, Electron main self-test in `machines:readiness`). Separately, the worker's session store still needs `better-sqlite3`, so readiness check 2 and `serve` require Node ≥ 22 with a load check; the published `engines` change is user decision Q6 (alternative: enforce only in `ptah worker`). C4a no longer touches `persistence-sqlite`; evidence rows, AR4, AR8, AR10, C7 docs and Q4 updated. |
| New Serious: failed release strands a live-PID lock | Release retries 3 times with backoff and keeps the entry `releasing` until `close()` succeeds. After that it becomes `stranded`: logged, shown in `held()`, readiness check 7 and the Machines banner, and retried on the next lock call. Operator recovery is `ptah worker locks [--json]` / `locks release <sessionId> [--yes]`. It uses a per-process control key (0600), asks for confirmation, and is honoured only when the holder has no live session record, so the live-holder rule is not weakened. Tests: injected `close()` failure with a successful retry while the holder stays alive; stranded after 3 failures; operator release; `in-use` refusal; wrong key. |
| Not resolved: transcript after a desktop turn between remote turns | W8 adds `worker:history-mark` at each worker turn end (under the lock) and a freshness check at every attach. The worker takes the lock for a read-only refresh, compares marks, and appends a fresh baseline before answering when they differ. If the lock is held elsewhere, the answer is snapshot mode with `drivenBy`; if it is unavailable, fail closed. Tests: attach right after an intervening desktop turn (fresh render equal to a new history read, exactly one new baseline), stale `afterSeq` client gets the baseline, no-change attach, lock held elsewhere, worker driving, lock unavailable. AD-22 added. |


Round 3 (2026-11-01), answering "Round 2 re-review" in `implementation-plan-review.md` and recording
the Gate 2 user answers (decisions.md row 10; context.md "Gate 2 user answers").

| Review item | Change (plan lines) |
| --- | --- |
| Serious 1: `worker:history-mark` missing from the logged types | W7 lists it in `SESSION_EVENT_TYPES`. It adds the worker-record serialization contract (`HistoryMark`, `WORKER_RECORD_SCHEMAS`, `latestMark` rebuilt on open, reducer advances with no view change, malformed record → `TRANSCRIPT_UNAVAILABLE`) at :338-361. W8 adds the append/replay attach test at :423-430. C1 owns the schemas at :760-762. |
| Serious 2: lock holders not discoverable from `<pid>.key` | W10 adds a per-process control endpoint `ptah-ctl-<uid>-<pid>` (Linux abstract socket and Windows named pipe; key-authenticated `list`/`release`), found through owner-only discovery files. Stale files are checked against the live endpoint. Release is resolved through the session endpoint's holder pid. The per-session server no longer accepts commands. See :470-472, :486-534, and the cross-process listing/release test at :626-636. C4a scope and files at :811-818, :830. AD-23 at :1307. The inventory-file alternative is rejected with its reason at :504-508. |
| Serious 3: rebind loses the old session ID | The rebind branch is removed from the `onRecordRemoved` list. The coordinator tracks `heldByRecord` by record token. New `onRealSessionIdRebound { tabId, oldSessionId, newSessionId, ownerToken }` fires from the `'rebound'` branch (`session-registry.service.ts:380-394`). Handoff order: acquire the new ID, then release the old. Driving is gated on `pendingHandoff`. Fail closed: keep the old lock, abort the turn and end the record (`endSessionIfTokenMatches(newSessionId, token)`), so the old lock is released through `onRecordRemoved`. See :550-597 and the cross-process rebind test at :637-651. C4b at :847-861. AD-24 at :1308. |
| Minor: "Q7" for the Node-floor question | All references now say Q6 (:72, :149, :955, :1238, :1306, :1397). |
| Gate 2 answers | Each Clarifications item is marked answered at :1321-1372 (Q1 (a), Q2-Q4 recommended, Q5 not applicable, Q6 `>=22`, U1-U5 option 1). Q6 is a firm C0 step (`apps/ptah-cli/package.json` `engines.node` `>=20.12` → `>=22`) at :740-745, with the docs note at :960-961 and AD-21/AR8 updated. C10 waits for the designer's revision of 4.9 and screen 9 and its review (:31-32, :1018-1021, team-leader ordering). |

Round 4 (2026-11-02), post-approval drift amendment (decisions.md rows 12-13). Base moved from
12a482782 to main 8ca24c134. Targeted amendment, not a redesign; Gate 2 approval stands for
everything not listed here.

| Trigger | Change (plan lines) |
| --- | --- |
| Blocker from decomposition: packaged win32/x64 Electron admits native Codex chat (`codex-electron-admission.ts:15-19`); `RoutingAgentAdapter` sends it to the native adapter (`routing-agent-adapter.ts:87-117,218-232`), which never uses `SessionRegistry`; W10's acquire/release would never fire or would leak | User decision (row 13): the lock covers `claude-sdk` sessions only. W10 "Runtime scope" (:545-604) names the decision field (session runtime identity via `SESSION_RUNTIME_IDENTITY_LOOKUP` and `resolveSessionRuntimeIdentity`, the same field the routing adapter uses), the single rule `sessionDriverLockScope`, the decision point per entry point (continue after the `ptahCli` passthrough, resume before the activate branch, start bound-handler guard, sendMessage/permission), and that native calls skip acquire, `heldByRecord` and the `pendingHandoff` wait. Fail-closed text scoped (:535-541); enforcement heading scoped (:605). New AD-25 (:1415) and AR11 (:1339). |
| Worker must not drive a lock-free session | C6 (:979-981, :1027-1029): `session.continue` and the W8 refresh check the scope first; native → refused with the W12 mapping of `CODEX_UNAVAILABLE`, attach → snapshot. C7 docs list native Codex as a known limitation (:1054-1055). |
| Tests | W10 test list (:719-731): "native Codex start/continue/resume takes no lock and never registers a holder", "claude-sdk path unchanged", routing-error rethrow. C4b seam references them (:940-942). |
| "Every host" wording | Q3 answer narrowed (:1457-1460); readiness check 7 detail text (:997-999); quality requirements scope of 1.5 and Correctness (:1288-1290, :1298-1299); AR4 (:1338). C4a states the notifications fire only for `claude-sdk` (:896-898); C4b owns the rule and its export (:931-937, files :946-948). |
| Moved anchors (each re-verified on 8ca24c134) | `endSessionIfTokenMatches` `sdk-agent-adapter.ts:1592-1595` (:643); `createCliRpcHostProfile` `container.ts:984` (:54, :955); `chat-session.service.ts` `startSession` :986, `continueSession` :1531, `resumeSession` :1778 and catch blocks (:64-65, :120, :931-937, AD-18/AD-19); `electron-shell.component.ts` guard :233, welcome branch :384-388 and :431 (:83, :1128-1130); `manifest.ts` `host.fileOpen` :553 (:170). `session-registry.service.ts` anchors (:356-394, :444, :676, :775) and `session-lifecycle-manager.ts:752-757` are unchanged. |
| Reworked UI contracts | C2 (:852-857) and C10 (:1133-1136): `webview-surface.types.ts` (`ViewType` :48 with legacy aliases, `SURFACE_ROUTE_IDS` :71, alias map :92-108) and `app.routes.ts` (Tasks route :142-147, `SURFACE_ACTIVE`) were reworked; executors re-read them. |

Round 5 (2026-11-02), user answer on the native Codex lock (decisions.md row 14, superseding the
auto-picked row 13). Base unchanged (main 8ca24c134). Targeted amendment; Gate 2 approval stands
for everything not listed here.

| Trigger | Change (plan lines) |
| --- | --- |
| Row 14: hook native Codex too | W10 "Native Codex runtime" (:547-666) replaces "Runtime scope". Seam: required `CodexChatAdapterPorts.driver: CodexChatDriverGate` with `admit` (thread ID bound: resume before `openContext`, start after the thread ID and before staging, persist, publish and the first turn) and `lease.release()` at the single removal point `CodexChatSessionControls.close` and in `open`'s catch; no rebind for native threads (immutable ID, no fork path). `SessionRegistry` registration and `CodexChatSessionLifecycle` reuse rejected with evidence. Error identity preserved past `failure()`. Fail closed as S3. Fail-closed paragraph (:537-543) and evidence rows (:71-72) updated. |
| Acquire/release for start, continue, resume | "Acquisition ownership" (:684-693): owner set per session ID (records, native leases, one provisional entry), adoption by `onRealSessionIdBound` or `admitNative`, release by `abandonDrive`/unbound record removal, kernel release only when the set is empty, per-session serialization. Per-entry-point native table inside :547-666. Enforcement heading now covers both runtimes (:667-683). |
| Rewind path unlocked | "Rewind path" (:694-704): `beginDrive` in `ensureSessionActiveForRewind` after `gateAccount`, refusal surfaces through the handler's `RpcUserError` rethrow (`session-rpc.handlers.ts:1584`). "Structural guard" (:705-710): `assertDriveHeld` before `sdkAdapter.resumeSession` (`chat-session.service.ts:2437`) in the single funnel `autoResumeIfInactive`. |
| C6 worker refusal | Kept as a capability limit (CLI binds native ports and the identity lookup to `null`, `nativeCodex: false`). Detection moves from the `null` lookup (Round 4 bug: it could never refuse) to session metadata `codexExecution.runtime` (:1148-1152, spec :1199-1203, readiness text :1169-1170, C7 docs :1227-1229). `sessionDriverLockScope` and its barrel export removed. |
| Tests | W10 test list (:810-852): native seam (call order, refusal identity, exactly-once release per removal path), coordinator both runtimes, rewind, native cross-process, Electron composition assertion. Round 4 runtime-scope specs removed. |
| Components | C4a note (:1017-1019); C4b rewritten without the runtime filter, with rewind, guard and `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` (:1044-1082); new C4c native gate in agent-sdk plus Electron wiring (:1083-1119). Handoff: executors, complexity, C4c needs C4b, parallel sets, verify row, files (:1491-1492, :1526-1568). |
| Scope wording | Q3 (:1632-1642), AD-25 (:1595), AR4/AR11 (:1514-1515), quality scope and Correctness (:1463-1474), header (:14). |
| Round 4 drift anchors re-checked | `electron-shell.component.ts` is `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`; guard :233, first welcome branch :385-388 (was cited :384-388), second no-folder branch :431. Tasks route `app.routes.ts:142-147` with `surfaceActiveFor('tasks')`. Updated at :85 and C10 (:1301-1305). |

## Round 6 — headless Electron worker host (2026-11-04)

Trigger: `main` commit 1cee6fafe removed `apps/ptah-cli`, `apps/ptah-tui`,
`apps/ptah-extension-vscode` (+ e2e) and `libs/backend/platform-vscode`; `ptah-video-studio` and
`ptah-license-server` are no longer Nx projects. `cli-engine` and `platform-cli` stay as the
headless engine (mcp-bench). User decision (decisions.md row 19): the remote worker is a headless
mode of the installed desktop package, built on cli-engine, not `ptah worker serve` from the
removed CLI. Branch `feat/remote-workers-v2` (row 18). Targeted amendment: Gate 2 approval stands
for everything this section does not supersede. Where an earlier section and this one disagree,
this one wins.

### R6.0 Inventory of superseded references

84 lines of this plan (above this section) and 30 lines of `batches.md` name a removed host or the
`ptah worker` CLI command; 14 plan verify commands and 12 batch verify commands list removed
projects (8 of them in Batches 8-26). Superseded parts, by plan section (`:N` line numbers are
the Round 5 file, before the Round 6 marker blocks were inserted; each marked section now starts
with a "> Round 6" or "> SUPERSEDED" note):

| Plan section (earlier rounds) | What is superseded | Replacement |
| --- | --- | --- |
| Header verdict (:9-15), Inputs (:21) | "`ptah worker` command group on the existing CLI composition root"; `ptah worker grants add` | R6.2: `ptah-worker` launcher → `worker-host.mjs` on `withEngine`; `ptah-worker grants add` |
| Project rules (:37-46) | TUI / VS Code compile rule; worktree `remote-workers` | Those hosts no longer exist; worktree `.claude-worktrees/remote-workers-v2` |
| Codebase evidence rows :68, :72, :74, :80, :81, :88 | Citations into `apps/ptah-cli/**` (chat-bridge, expected-resolvable, package.json engines, interact) | R6.1 evidence (native-null proof now `cli-engine/src/lib/codex-runtime-composition.spec.ts:57-77`) |
| Architecture decision (:92-93, :150-153, :160) | "worker runs as `ptah worker serve`"; A8 smoke via `ptah worker locks --self-test` on the worker's Node | R6.2; smoke is `ptah-worker locks --self-test` on the desktop's bundled Node |
| Reuse verdicts row `apps/ptah-cli` (:176) | "Extend with `ptah worker`" | New lib `@ptah-extension/worker-host` (R6.3 component 1) |
| Library placement (:185-186) | worker-runtime consumed by `apps/ptah-cli`; remote-machines by `apps/ptah-cli` in Phase 2 | worker-runtime → `@ptah-extension/worker-host`; remote-machines → `apps/ptah-electron` only |
| W3 (:241-244, :264), W5 (:283), W10 operator recovery (:516-535), W10 worker side (:594, :654-666), :776, :853 | `ptah worker pair|status|locks …`; "the CLI" as lock holder kind; `apps/ptah-cli/...expected-resolvable.ts` citations | Same commands under `ptah-worker`; lock holders are Electron main, the worker host and mcp-bench (all bind `KernelSessionDriverLock`) |
| C2 (:980), C3 (:992-1000) | VS Code `expected-absent.ts`/`rpc-surface.spec.ts`; verify lists | Batches 5 and 7 are complete; the VS Code files were dropped in the cherry-pick (row 18) |
| C4a (:1004-1043) | vscode-core null default; `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`; verify list | R6.3 component 4 |
| C4b, C4c, C5 verify lists (:1073, :1110, :1132) | `ptah-extension-vscode,ptah-cli,ptah-tui` | R6.5 |
| C6 readiness (:1162-1170) | "`ptah worker serve` refuses"; check 3 "Ptah CLI version"; check 6 "sources as `apps/ptah-cli/src/cli/commands/doctor.ts`" | R6.3 component 3 |
| C6 drift spec (a) (:1204-1206) | worker-runtime spec compares with the CLI profile (needs a `scope:extension` → `scope:cli` import, a boundary violation in any round) | Moves to worker-host (R6.3 component 1) |
| C7 (:1211-1245) entire | `apps/ptah-cli` command group, `docs/worker.md`, `npm i -g`, Node ≥ 22 install | R6.3 components 1 and 2 |
| C8 (:1252), failure row :1419 | `ssh <alias> ptah worker status|pair --json`; "No `ptah worker`" | R6.3 component 5 |
| Phases 2-4 (:1350, :1380) | `ptah worker grants`, `ptah worker expose cloudflare`; `ptah fleet` | Same verbs under `ptah-worker`; `ptah fleet` (Phase 2, CLI) has no host — re-plan in Phase 2 |
| Observability (:1405) | `ptah worker status` | `ptah-worker status` |
| Test strategy table (:1488-1495), runbook (:1502-1504) | Verify lists with removed projects; runbook in `apps/ptah-cli/docs/worker.md`; `pkill -f "ptah worker serve"` | R6.5; runbook in `libs/backend/worker-host/docs/worker.md`; `pkill -f "worker-host.mjs serve"` |
| Risks AR3, AR8, AR11 (:1513-1515) | `ptah worker status`; Node 20 on Horus; "no native runtime on the CLI" | AR8 closed (R6.4); AR3/AR11 wording via `ptah-worker`, worker cli-engine composition |
| Team-leader handoff (:1555-1570), Files affected | `apps/ptah-cli/package.json`, `apps/ptah-cli/src/cli/commands/worker.ts`, `docs/worker.md` | R6.6 |
| Decisions AD-1, AD-12, AD-21 (:1582, :1592, :1598) | Worker = `ptah worker`; Node floor via CLI `engines` | AD-26 … AD-31 (R6.7) |
| Clarifications Q4, Q6 (:1643-1660) | Node 22 + CLI install on Horus; CLI `engines.node` | Obsolete: the desktop package carries its runtime (R6.4) |

### R6.1 Codebase evidence (re-read at this branch)

| Evidence | Location | Implication |
| --- | --- | --- |
| Verified: Electron main takes the single-instance lock at module load and quits when it is held | `apps/ptah-electron/src/main.ts:67-70` | A second Electron *main* process (GUI already running) quits; worker mode cannot be a branch of `main.ts` that shares this path |
| Verified: the preparing window is created before DI boot, and the boot takes the window getter | `main.ts:210-213`, `:238` (`bootstrapElectron(() => mainWindow, coordinator)`), `:351-357` (`wireRuntimePreWindow`), `:363-374` (post-window, update interval), `:386-401` (tray) | The Electron boot is window-coupled end to end; a headless path through it would fork most of `activation/` |
| Verified: two worker-backed workspace stores on one `<userData>/workspace-storage/default` root raced and hung boot | `apps/ptah-electron/src/di/workspace-state-storage-single-instance.spec.ts:1-15` | A second process on the GUI's Electron DI graph and userData is unsafe |
| Verified: desktop secrets are `<userData>/secrets.json` through `safeStorage`; without encryption an encrypted value cannot be read | `libs/backend/platform-electron/src/registration.ts:148-152`; `implementations/electron-secret-storage.ts:49`, `:67-69` | A headless process without an unlocked keyring could not read the desktop's secrets anyway |
| Verified: `scope:electron` may depend only on `scope:shared`, `scope:electron`, `scope:extension`; `scope:cli` may depend on `scope:shared`, `scope:cli`, `scope:extension` | `eslint.config.mjs:311-326`; tags `libs/backend/cli-engine/project.json` (`scope:cli`), `apps/ptah-electron/project.json` (`scope:electron`) | `apps/ptah-electron` cannot import cli-engine. The worker composition must live in a `scope:cli` project |
| Verified: ptah-electron already builds extra Node bundles whose entry lives in a lib | `apps/ptah-electron/project.json` targets `build-voice-worker`, `build-integrity-worker`, `build-workspace-watch-host`, `build-state-storage-worker` (each `main` under `libs/backend/**`, output beside `main.mjs`); `build` `dependsOn` lists them | Precedent for a `build-worker-host` target bundling a `scope:cli` lib entry into the desktop package |
| Verified: a headless cli-engine bundle already exists, with the `vscode` shim alias and the `reflect-metadata`/`require` banner | `tools/mcp-bench/project.json:99-125` (`build-host-bundle`); boot `tools/mcp-bench/src/transport/bench-host-boot.ts:417` (`withEngine`) | Copy that esbuild shape |
| Verified: `withEngine` forwards `pushAdapter` and `hostProfile` (Batch 6), reads `PTAH_CONFIG_PATH`, awaits workspace readiness, then initializes the SDK; `bootstrap` is an injectable test hook | `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:204`, `:273-278`, `:298`, `:339`; `PTAH_AUTO_APPROVE` `:366` | Worker serve = one `withEngine` call; auto-approve must be refused before it |
| Verified: CLI container defaults `userDataPath` to `~/.ptah`, `appPath` to the bundle dir, forks the watch host beside the bundle, registers the shared session store as host `cli`, and file settings under `userDataPath` | `libs/backend/cli-engine/src/lib/container.ts:423-427`, `:437-440`, `:493`, `:853`, `:999` (`options.hostProfile ?? createCliRpcHostProfile(host)`) | Worker data lives under `~/.ptah`, not Electron userData; settings and sessions are the files the GUI already shares with headless hosts |
| Verified: CLI secrets are `~/.ptah/secrets.enc` | `libs/backend/platform-cli/src/registration.ts:76-77`; `implementations/cli-secret-storage.ts:61` | Worker and desktop do not share API-key secrets (Clarification R6-Q1) |
| Verified: the session store file is `~/.ptah/state/<db>` for every host | `libs/backend/persistence-sqlite/src/lib/session-store/session-store-db-path.ts:21-31`; `register-session-store.ts:34-42` | GUI and worker list the same sessions |
| Verified: the CLI watcher forks `workspace-watch-host.mjs` from the bundle's own directory; Electron's watch-host entry also accepts a `child_process.fork` IPC channel | `libs/backend/platform-cli/src/implementations/cli-workspace-watcher.ts:49-52`, `:91-95`; `libs/backend/platform-electron/src/workspace-watch/workspace-watch-host.entry.ts:5-6` | `worker-host.mjs` placed beside Electron's `workspace-watch-host.mjs` gets a working watcher (A12) |
| Verified: Electron host repairs `PATH` for GUI launches with `fixPath()` | `apps/ptah-electron/src/activation/bootstrap.ts:319`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/fix-path.ts:1-20`, `:100` (lib tags `scope:extension`) | A systemd user service has the same minimal `PATH`; the worker calls `fixPath()` before boot |
| Verified: cli-engine binds every native-chat token to `null` and `RUNTIME_HOST_CAPABILITIES` to `{ nativeCodex: false }` | `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:57-77` | Replaces the deleted `apps/ptah-cli/src/di/expected-resolvable.ts` citation: the worker still cannot run native Codex (C6 `CODEX_UNAVAILABLE` unchanged) |
| Verified: Electron 44.4.3; `better-sqlite3` is rebuilt for the Electron ABI and unpacked; Linux targets AppImage and deb; no `electronFuses` configuration (RunAsNode fuse left at Electron's default, enabled) | `apps/ptah-electron/electron-builder.yml:4`, `:17-23`, `:198-205`; grep for `fuses` in `package.json`, `apps/ptah-electron/{package.json,electron-builder.yml,electron-builder.local-production.cjs}`: no match | `ELECTRON_RUN_AS_NODE=1 ptah-desktop <script>` runs plain Node with the Electron ABI, so the packed `better-sqlite3` loads (A10) |
| Verified: package name `ptah-desktop` (deb installs `/opt/Ptah/ptah-desktop`, as `pgrep -f /opt/Ptah/ptah-desktop` in G-M assumes) | `apps/ptah-electron/package.json:2` | Launcher path |
| Verified: `validate-deps` scans only `main.mjs`; packaged dependencies are exactly `apps/ptah-electron/package.json`; `implicitDependencies: ["ptah-extension-webview"]` is the build-edge precedent | `apps/ptah-electron/scripts/validate-deps.js:24`, `:84-97`; `scripts/prune-dist-deps.js:4-11`; `apps/ptah-electron/project.json` `implicitDependencies` | The worker bundle needs its own scan; its externals must already be Electron deps (`tsyringe`, `cross-spawn`, `gpt-tokenizer`, `ws`, `@parcel/watcher` all are) |
| Verified: `registerVsCodeCorePlatformAgnostic` callers are Electron and cli-engine only | `apps/ptah-electron/src/di/phase-1-infra.ts:94`; `libs/backend/cli-engine/src/lib/container.ts:486` | No host needs a vscode-core "null lock when absent" default |
| Verified: provider readiness sources | `ClaudeCliDetector` `libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:130`; `resolveEffectiveAuthRoute` `libs/backend/auth-providers/src/lib/auth/effective-route.ts:55` | Replaces the deleted `doctor.ts` citation in C6 check 6 |
| Verified (Nx graph at this branch): app dependents — platform-core, agent-sdk, rpc-handlers, vscode-core → ptah-electron, mcp-bench; platform-electron → ptah-electron; platform-cli, cli-engine → mcp-bench; shared → ptah-electron, ptah-extension-webview, mcp-bench; chat, core → ptah-electron, ptah-extension-webview; worker-protocol/worker-runtime/remote-machines/machines-ui → no app yet | `npx nx graph --file` (read-only) | R6.5 verify lists |

### R6.2 Architecture decision

- Chosen approach: the worker is a **node-mode process of the installed desktop package**. A
  launcher shipped in the Linux package, `/opt/Ptah/resources/bin/ptah-worker`, runs
  `ELECTRON_RUN_AS_NODE=1 exec /opt/Ptah/ptah-desktop /opt/Ptah/resources/app.asar/worker-host.mjs "$@"`
  (paths derived from the launcher's own location). `worker-host.mjs` is a new bundle built by
  ptah-electron from a new `scope:cli` lib, `@ptah-extension/worker-host`, which composes
  cli-engine (`withEngine` + `CliWebviewManagerAdapter` tap + `hostProfile`) with
  `@ptah-extension/worker-runtime` (`createWorkerServer`). Commands: `ptah-worker serve|status|pair|
  workspace|grants|locks` with the C7 options unchanged.
- Worker-mode detection: Electron reads `ELECTRON_RUN_AS_NODE` before Chromium starts, so the
  process never loads `main.ts`. Skipped by construction, not by guards: single-instance lock
  (`main.ts:67`), crash reporter (`:139`), preparing window and every `BrowserWindow`
  (`:210`, `:422-441`), renderer, IPC bridge, `wireRuntimePreWindow`, post-window boot, update
  checks (`:373-374`), tray (`:386-401`), Sentry flush on quit. Booted (inside `withEngine`):
  the cli-engine DI container, file settings (`container.ts:853`), the shared session store
  (`:493`), settings and auth migrations (`with-engine.ts` before `:339`), the SDK adapter
  (`:339`), `SessionRegistry` (agent-sdk via `registerSdkServices`), CLI agent runtimes and
  detectors (after `fixPath()`), `KernelSessionDriverLock` (platform-cli binding, Batch 11), and
  then `createWorkerServer`.
- Rationale: requirement fit is the same as U1 option 1 (Round 1 rationale stands); the change is
  only the host process. cli-engine is the graph built for headless use (mcp-bench already ships
  it); every Phase C/D contract (lock port bound per platform, push tap, host profile) was built
  against it. Node mode needs no display server (workers are reached over SSH and run as a
  systemd user service), no keyring, and no window, and it brings the Electron ABI and Electron's
  bundled Node (≥ 22, A10) so `better-sqlite3` loads with no Node install on the worker.
- Rejected alternatives:
  - Electron DI container booted headless inside Electron main. `bootstrapElectron` and
    `wireRuntimePreWindow` take the window getter and run renderer-facing steps
    (`main.ts:238`, `:351-357`); sharing the GUI's userData means two writers on the workspace
    store root that already hung boot once (`workspace-state-storage-single-instance.spec.ts:1-15`);
    a separate userData loses the only advantage (shared safeStorage secrets), which in any case
    needs an unlocked keyring that a systemd service or an SSH session lacks
    (`electron-secret-storage.ts:67-69`). It would also need a display or an unverified
    `--ozone-platform=headless`. Its one gain, native Codex on the worker, is out of Phase 1 scope.
  - cli-engine inside Electron main behind a `main.ts` argv flag (`ptah-desktop --worker-serve`).
    Forbidden import (`eslint.config.mjs:311-318`); widening the rule lets all Electron code reach
    platform-cli implementations. Electron still initialises Chromium (display) and the flag
    check would have to precede the single-instance lock in a module whose static imports already
    load the desktop graph.
  - Worker composition inside `cli-engine`. It adds a cli-engine → worker-runtime edge to
    mcp-bench's graph and mixes a host (argv, operator commands, docs) into the engine.
  - A new `apps/ptah-worker` application. It would need its own build and a copy step into the
    desktop dist; ptah-electron's existing pattern for extra bundles is a lib entry plus a
    ptah-electron esbuild target.
- Assumptions (each with its check):
  - A10: on the packaged 44.4.3 deb, `ELECTRON_RUN_AS_NODE=1 /opt/Ptah/ptah-desktop
    /opt/Ptah/resources/app.asar/worker-host.mjs status --json` runs, resolves
    `app.asar/node_modules` (and the unpacked `better-sqlite3`), and `process.versions.node` is
    ≥ 22. Check: G-R step "node mode" on the worker, plus the Batch 19 packaging spec that fails if
    any electron-builder config disables the RunAsNode fuse. Fallback: ship `worker-host.mjs` and
    its externals outside the asar via `extraResources`.
  - A11: an `implicitDependencies` entry from ptah-electron to the `scope:cli` lib is a build
    edge only and does not trip `@nx/enforce-module-boundaries` (it checks imports). Check: Batch
    19 verify (`ptah-electron` lint). Fallback: list the lib's sources in the
    `build-worker-host` target `inputs` instead.
  - A12: the CLI watcher's fork of Electron's `workspace-watch-host.mjs` works in node mode (fork
    inherits `ELECTRON_RUN_AS_NODE`; the entry takes the fork IPC transport). Check: G-R boot log.
    Failure degrades the watcher only (`container.ts:434-436` comment), never the boot.
  - A13: A6 still holds: the lock name depends on uid and session ID only, so Electron main and
    the worker (and mcp-bench) compute the same name. No change from Round 5.
- Effect on existing code: Batches 1-7 unchanged. Phase C (8-13) unchanged in design; file lists
  lose the VS Code host files and verify lists lose removed projects. Phase D: C6 wording only,
  C7 replaced. Phase E: one constant and the remote command string. Phase F: three copy strings.

### R6.3 Component specifications (deltas)

#### 1. `@ptah-extension/worker-host` (replaces C7's command group)

- Purpose: worker composition root and operator commands, as a lib whose entry is bundled into
  the desktop package.
- Responsibilities: argv parsing with `node:util` `parseArgs` (no new dependency: packaged deps
  are exactly ptah-electron's); the C7 command set under `ptah-worker`; `serve` = `fixPath()` →
  refuse auto-approve (`--auto-approve` or `PTAH_AUTO_APPROVE=true`, AD-16) → readiness check 2
  (refuse) → `withEngine({}, { mode: 'full', thoth: 'off', hostProfile: createWorkerRpcHostProfile(),
  pushAdapter: new CliWebviewManagerAdapter({ tap, logger }) }, fn)` where `fn` starts
  `createWorkerServer` and resolves on SIGTERM/SIGINT after the worker-service shutdown;
  package version read from the `package.json` beside the bundle (build-main emits it) and passed
  to worker-runtime for readiness check 3 and `endpoint.json.ptahVersion`; `locks` uses the
  platform-core `listLocalDriverLocks`/`requestRelease` (Batch 9); the C6 drift spec (a)
  in-process parity (`deriveRpcSurface(createWorkerRpcHostProfile())` vs
  `createCliRpcHostProfile('cli')`, `cli-engine/src/lib/rpc/cli-host-profile.ts:18`) lives here,
  because only a `scope:cli` project may import both; `docs/worker.md` with the generated
  capability table compared by spec.
- Tags `scope:cli`, `type:feature` (`eslint.config.mjs:319-326`: may import cli-engine,
  platform-cli, worker-runtime, worker-protocol, cli-agent-runtime, rpc-handlers, platform-core).
  Never exported to Electron code.
- Failure behaviour: as C7 (no service → "worker service is not running"; `locks release`
  refuses without `--yes` in non-TTY); `EADDRINUSE` names the port (second instance); boot
  failure exits non-zero with one stderr line (systemd restarts with backoff).
- Verification seam: command specs with an injected `bootstrap` (`with-engine.ts:204`); `serve`
  integration with a stub bootstrap and a real `ws` client; auto-approve refusal; Node < 22 /
  `better-sqlite3` failure refusal (injected); parity drift spec; doc table spec.
- Files: CREATE `libs/backend/worker-host/**` (project files, `src/index.ts`,
  `src/worker-host.entry.ts`, `src/lib/**`, `docs/worker.md`); MODIFY `tsconfig.base.json`
  (alias), `nx.json` (lint/test include lists, as Batch 3 did for the four libs),
  `.commitlintrc.json` (scope `worker-host`).

#### 2. Desktop packaging of the worker host (`apps/ptah-electron`)

- Purpose: ship `worker-host.mjs` and the `ptah-worker` launcher in the desktop package.
- Responsibilities: target `build-worker-host` (shape of `build-workspace-watch-host` plus the
  mcp-bench `vscode` alias and banner, `tools/mcp-bench/project.json:99-125`; output
  `dist/apps/ptah-electron/worker-host.mjs`, beside `workspace-watch-host.mjs`); add it to
  `build.dependsOn` and `build-dev` commands; `implicitDependencies` += `@ptah-extension/worker-host`
  (A11); `tsconfig.worker-host.json` (precedent `tsconfig.voice-worker.json`); launcher script
  and systemd unit template under `apps/ptah-electron/worker-host/`, shipped by
  `linux.extraResources` to `resources/bin/` (outside the asar so it can be executed);
  `validate-deps.js` scans `worker-host.mjs` as well as `main.mjs`.
- Launcher contract (POSIX `sh`): resolve its real path, `appdir = ../..`, then
  `ELECTRON_RUN_AS_NODE=1 exec "$appdir/ptah-desktop" "$appdir/resources/app.asar/worker-host.mjs" "$@"`.
  `exec` keeps the systemd main PID equal to the worker. Linux deb only in Phase 1 (workers are
  Linux; AppImage and other OSes: unsupported, documented).
- systemd user unit template `ptah-worker.service`:
  `ExecStart=/opt/Ptah/resources/bin/ptah-worker serve --port 41873`, `Restart=on-failure`,
  `RestartSec=5`, `KillSignal=SIGTERM`, `TimeoutStopSec=20`, `WantedBy=default.target`. Operator:
  copy to `~/.config/systemd/user/`, `systemctl --user enable --now ptah-worker`; start without a
  login needs `loginctl enable-linger <user>` (Clarification R6-Q2).
- Failure behaviour: a missing bundle → launcher exits 127 with the path; the client maps it
  (component 5).
- Quality: no `build`/`package` run by executors (CLAUDE.md); the shape is pinned by a spec in
  `apps/ptah-electron/src/config/` (target present, output name, `extraResources` entry, launcher
  text, no RunAsNode-disabling fuse), precedent `packaged-deps.spec.ts`.
- Files: MODIFY `apps/ptah-electron/project.json`, `apps/ptah-electron/electron-builder.yml`,
  `apps/ptah-electron/scripts/validate-deps.js`; CREATE `apps/ptah-electron/tsconfig.worker-host.json`,
  `apps/ptah-electron/worker-host/{ptah-worker,ptah-worker.service}`,
  `apps/ptah-electron/src/config/worker-host-packaging.spec.ts`.

#### 3. C6 `worker-runtime` (wording deltas only)

- Readiness check 2: "Node ≥ 22 and `better-sqlite3` loads" stays; the runtime is the desktop's
  bundled Node, so the fix text is "update the Ptah desktop package", not "install Node 22".
- Check 3: "Ptah package version (injected by worker-host) and protocol version".
- Check 6 sources: `ClaudeCliDetector` and `resolveEffectiveAuthRoute` (R6.1), not `doctor.ts`.
- Native capability limit: unchanged behaviour; evidence is
  `cli-engine/src/lib/codex-runtime-composition.spec.ts:57-77`.
- Drift spec (a) in-process parity moves to worker-host; spec (b) remote surface stays here.
- worker-runtime never imports cli-engine or Electron (unchanged; `scope:extension`).

#### 4. C4a host bindings (Phase C delta)

- Drop the vscode-core "null when absent" default and the VS Code `expected-resolvable.ts`
  edit: the only callers of `registerVsCodeCorePlatformAgnostic` are Electron and cli-engine
  (R6.1), and both bind the lock in their platform registration. A container without a binding
  fails at resolve, which the Electron and cli-engine smoke specs catch.
- Everything else in Phase C (W10, C4a-C4c) is unchanged. Coexistence with the GUI is the lock's
  existing cross-process case: GUI Electron main and the worker are two processes of one user.

#### 5. C8 remote command (Phase E delta)

- `libs/worker-protocol/src/lib/worker-command.ts`: `WORKER_REMOTE_COMMAND =
  '/opt/Ptah/resources/bin/ptah-worker'` (absolute, because a non-interactive SSH shell does not
  read the user's profile). Consumed by remote-machines (ssh argv) and machines-ui (copy).
- `ssh-worker-commands.ts`: `ssh -o BatchMode=yes -o ConnectTimeout=10 -- <alias>
  /opt/Ptah/resources/bin/ptah-worker status|pair --json` (argument array, `shell: false`).
  Exit 127 or "not found" → `version-mismatch` with "This Ptah build on <Machine> has no worker
  mode. Update the Ptah desktop app there." (replaces failure row :1419).
- Transport unchanged: `ssh … -W 127.0.0.1:41873 -- <alias>`; the worker's sshd opens the
  loopback connection on the worker, so nothing listens on a LAN address (8.1). Requires sshd
  `AllowTcpForwarding` not `no` (default `yes`); readiness check 4 already reports the listener.

#### 6. C10 copy (Phase F delta; design-handoff conflict resolved)

- `design-spec.md:56` copyable command `ptah worker pair`, `:71` footer `ptah worker doctor`
  `[TBC by architect]`, `:123` `ptah worker locks release <session id>`: the plan changes the
  command name, not the design. Resolution: the copy keeps the designer's layout and wording and
  substitutes `WORKER_REMOTE_COMMAND` + `pair`, `status`, `locks release <session id>`. The
  readiness row "Node version" keeps its label (it reports the bundled runtime).
  `design-spec.md` itself is not edited by the plan.

### R6.4 Coexistence with a GUI instance on the same machine

| Shared thing | Behaviour | Failure behaviour |
| --- | --- | --- |
| Electron single-instance lock (`main.ts:67`) | Not taken by the worker (main.ts never runs) | GUI starts and stops freely while the worker runs, and vice versa |
| Electron userData (`~/.config/Ptah`), workspace stores, safeStorage secrets | Not opened by the worker (`userDataPath` = `~/.ptah`, `container.ts:423-424`) | none |
| `~/.ptah/settings.json` | Both processes read and watch it (as GUI + CLI did) | Known whole-cache write risk (`file-settings-manager.ts` `persist()`, HANDOFF): a worker write can revert a concurrent GUI edit. The worker writes settings only through migrations at boot; no new writer is added. Not fixed here (user decides) |
| Session store `~/.ptah/state/<db>` | Shared, host-stamped (`cli` for the worker) | Same as GUI + CLI today |
| Driver lock (Phase C) | Same kernel name per session in both processes | GUI drives → worker turn refused `SESSION_DRIVEN_ELSEWHERE` naming the desktop; worker drives → GUI refused naming the worker label; lock endpoint unavailable → fail closed in that process |
| Port 41873 | Worker only | A second `serve` fails `EADDRINUSE` naming the port; systemd keeps one |
| Provider CLIs (`~/.claude`, `~/.codex`) | Shared logins | none |
| API-key secrets | Not shared (`secrets.enc` vs `secrets.json`) | Worker readiness check 6 fails with the provider named (R6-Q1) |

### R6.5 Verify lists (valid projects only)

| Component | Verify command |
| --- | --- |
| Batches 1-7 re-verification on this branch | `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui,process-sampler,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/vscode-core,ptah-electron,ptah-extension-webview,mcp-bench,ptah-landing-page` |
| C4a-1, C4a-2 (platform-core) | `npm run verify -- -p @ptah-extension/platform-core,ptah-electron,mcp-bench` |
| C4a-3 (agent-sdk) | `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench` |
| C4a-4 bindings | `npm run verify -- -p @ptah-extension/platform-electron,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,mcp-bench` |
| C4b | `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,mcp-bench` |
| C4c | `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench` |
| C6 | `npm run verify -- -p @ptah-extension/worker-runtime` |
| Worker host + packaging | `npm run verify -- -p @ptah-extension/worker-host,ptah-electron` |
| C8 (with the worker-protocol constant) | `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui,@ptah-extension/worker-host` |
| C9 | `npm run verify -- -p ptah-electron` |
| C10 shell/route | `npm run verify -- -p @ptah-extension/shared,@ptah-extension/machines-ui,@ptah-extension/chat,@ptah-extension/core,ptah-extension-webview,ptah-electron,mcp-bench,ptah-landing-page` |

### R6.6 Team-leader handoff (delta)

- Executors: worker-host commands → backend-developer; worker-host scaffold and desktop packaging
  → devops-engineer capability (build targets, builder config, scripts); rest unchanged.
- Ordering: worker-host needs C5 (Batch 6), C4a-2 (Batch 9) and C6 (Batch 18). The C8 constant
  lands with Batch 20, after worker-host, so worker-host's usage text uses the literal name and
  does not import the constant.
- Files affected (replaces the C7 rows): CREATE `libs/backend/worker-host/**`,
  `apps/ptah-electron/tsconfig.worker-host.json`, `apps/ptah-electron/worker-host/{ptah-worker,ptah-worker.service}`,
  `apps/ptah-electron/src/config/worker-host-packaging.spec.ts`,
  `libs/worker-protocol/src/lib/worker-command.ts`; MODIFY `tsconfig.base.json`, `nx.json`,
  `.commitlintrc.json`, `apps/ptah-electron/{project.json,electron-builder.yml,scripts/validate-deps.js}`,
  `libs/worker-protocol/src/index.ts`. Removed from scope: every `apps/ptah-cli/**`,
  `apps/ptah-extension-vscode/**` file and `libs/backend/vscode-core/src/di/register-platform-agnostic.ts`.
- Gated steps: G-M on Horus no longer installs Node or the CLI; it needs a desktop build with
  worker mode (fleet op, consent as before). G-R follows `libs/backend/worker-host/docs/worker.md`
  and adds A10 (node mode) and the systemd unit start/stop.

### R6.7 Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| AD-26 | Worker = cli-engine composition in a node-mode process of the desktop package (supersedes AD-1) | Electron DI headless / cli-engine in Electron main / node-mode cli-engine | `main.ts:67`, `:238`; `workspace-state-storage-single-instance.spec.ts:1-15`; `electron-secret-storage.ts:67-69`; `eslint.config.mjs:311-326`; user row 19 | yes, before Batch 19 |
| AD-27 | Mode selected by the `ptah-worker` launcher (`ELECTRON_RUN_AS_NODE=1`), not a `main.ts` argv flag | argv flag / launcher | `main.ts:67`, `:210`; Chromium never starts in node mode | yes |
| AD-28 | New lib `@ptah-extension/worker-host` (`scope:cli`, `type:feature`) bundled by a ptah-electron target | in cli-engine / new app / new lib | `eslint.config.mjs:311-326`; ptah-electron extra-bundle targets | yes |
| AD-29 | Phase 1 worker install = Linux deb at `/opt/Ptah`; `WORKER_REMOTE_COMMAND` absolute | PATH lookup / absolute | `package.json:2`; `electron-builder.yml:198-205` | yes |
| AD-30 | Drop the vscode-core null lock default | keep / drop | R6.1 `registerVsCodeCorePlatformAgnostic` callers | yes |
| AD-31 | Node floor handled by the bundled runtime; AD-21, Q4 and Q6 obsolete | — | `electron-builder.yml:4`; A10 | n/a |

### R6.8 Clarifications needed (user-reserved)

- R6-Q1 Provider auth on workers. The worker reads API keys from `~/.ptah/secrets.enc`, not the
  desktop's safeStorage file, and the `ptah provider set-key` command left with the CLI host.
  - (Recommended) Phase 1 workers use provider CLI logins only (`claude` / `codex` signed in on
    the worker); readiness check 6 says so. No key command.
  - Add `ptah-worker auth set-key <provider>` (writes `~/.ptah/secrets.enc`).
- R6-Q2 Start at boot (fleet operation on Horus, Anubis, Chappie).
  - (Recommended) `loginctl enable-linger <user>` plus the user unit, so the worker runs without a
    login session.
  - Run the unit only while the user is logged in (no system change).
