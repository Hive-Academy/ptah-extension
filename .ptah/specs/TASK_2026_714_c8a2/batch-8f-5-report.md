# Batch 8f-5 report

Implemented S2 and S3 with specs. M6 and missing-tab delivery require shared-library work outside this batch. Verification is deferred to the team leader under the machine-wide lock; no tests, builds, lint, typecheck, diagnostics, package-manager commands or git commands were run.

## Changes by item

### S2 ? implemented

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:276`: named helpers now own binding resources, host dependencies, scope ports, host adapter ports, disposal and DI registration.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:604`: composition entry point wires those helpers and retains failure cleanup. No adapter is resolved early. Binary inspection remains asynchronous and deferred until profile preparation; scope shutdown still precedes record, identity and map cleanup.
- `apps/ptah-electron/src/di/codex-session-binding.ts:29`: per-session maps and lazy adapter/lifecycle lookups moved to an Electron-local sibling.
- `apps/ptah-electron/src/di/codex-session-binding.ts:56`: native and legacy control wiring remains based on the existing rpc-handlers factories, including createLegacyCodexSessionSettings.
- `apps/ptah-electron/src/di/codex-session-binding.ts:117`: creates one lifecycle object, runs record hooks first, then Electron map/identity/control effects. No record hook mutation; controls exist before lifecycle construction.
- Spec: `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:525`. Frozen record hooks assert pre-effect map contents; assertions prove prepared-tab transfer, cleanup and record ? identity ? controls order. Existing composition cases remain in place.

### S3 ? implemented

- `apps/ptah-electron/src/di/codex-runtime-composition.ts:441`: host adapter port factory explicitly returns CodexChatHostPorts, preserving the permission responder through the spread.
- `apps/ptah-electron/src/di/codex-runtime-composition.ts:586`: registration is generic over the actual host contract. The value was already a spread of createCodexChatHostPorts, not a narrowed agent-sdk-only object. No new token or DI census entry is needed.
- `apps/ptah-electron/src/ipc/ipc-bridge.ts:434`: resolves the nullable typed responder with the existing inherited-registration guard. Removed unknown resolution and method duck typing; Codex-first routing and Claude fallback remain.
- Specs: `apps/ptah-electron/src/ipc/ipc-bridge.codex-permission.spec.ts:27` uses a typed fixture; covers all four decisions, null default, absent registration, unowned request fallback, invalid decision rejection and real Error logging. The composition registration assertion now resolves CodexChatHostPorts directly.

### M6 ? not implemented: upstream source flag is unavailable

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts:26`: callback factory already accepts surfaceMode; no missing factory parameter.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:975`: the broadcaster gets input.surfaceMode from the RPC request. The preceding startChatSession config does not pass it into the native adapter. The continue path likewise uses params.surfaceMode for broadcaster delivery.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:105`: callback contract carries only sessionId and native turn identity. The profile result and lifecycle observer also carry no surfaceMode. The Electron host callback wiring at `apps/ptah-electron/src/di/codex-runtime-composition.ts:510` therefore has no honest source for the flag.
- Required follow-up: propagate per-turn surfaceMode from ChatSessionService through the native adapter/callback contract (including continue/resume semantics), then pass it into createCodexChatEventCallbacks in Electron. Do not infer it from a tab id, hard-code true, or wrap/mutate the shared broadcaster to intercept unrelated calls.
- No libs files edited; no misleading spec asserting a guessed surface mode added.

### Minor (a) ? not implemented: callers require shared contract changes

- The fallback remains, now at `apps/ptah-electron/src/di/codex-session-binding.ts:50`.
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:61`, `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts:16`, and native/legacy control dependencies in `libs/backend/rpc-handlers/src/lib/chat/codex-host/native-session-controls.ts:51` require string tab ids.
- Host ports use it for approval presentation and broadcaster publication; native compact and legacy slash controls pass it directly into the broadcaster. Changing only Electron to string | undefined would violate these contracts. Required follow-up: make the shared contracts optional and define skip behavior at all tab-scoped delivery sites, including callbacks, without silently discarding non-tab cleanup or approval ownership.

### Minor (b) ? retained as permitted

- `apps/ptah-electron/src/ipc/ipc-bridge.ts:132` resolves RpcHandler and state storage, but has no Logger dependency/property. Existing console logging is used throughout the bridge. Left the new console.warn calls unchanged per the explicit instruction to retain them if the bridge does not already have a Logger.

### Minor (c) ? retained as permitted

- bindElectronCodexChat already returns a disposable handle; that remains true. The registry stays in its separate module so shutdown does not import the runtime rpc-handlers surface.
- `apps/ptah-electron/src/activation/shutdown.ts:293` and `apps/ptah-electron/src/activation/shutdown.ts:445`: global binding presence participates in both bounded disposal and the deferred-quit decision, including cancellation during background bootstrap. Replacing ownership entails BootRefs/coordinator initialization, late-boot disposal and shutdown-spec changes, not just retaining the local bootstrap return. Kept the existing scheme rather than broaden this style fix into shutdown lifecycle redesign without verification.

## Specs and verification

- Added lifecycle ordering regression coverage to codex-runtime-composition.spec.ts.
- Updated typed registration coverage in that spec and nullable/unregistered permission routing coverage in ipc-bridge.codex-permission.spec.ts.
- No verification commands executed, as instructed. Passing results are not claimed. Team leader should run the scoped Electron/settings-core verification under its lock.
- Source discovery used ptah AST/file search first. ptah_code_search_symbols returned zero hits for CodexChatTurnIdentity (empty index), so native targeted source search was used for that contract.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Extract Electron session helpers and compose lifecycle once | Named local helpers; mutation in oversized closure | S2, existing record lifecycle and lazy DI pattern | Yes |
| Reuse typed existing token | CodexChatHostPorts generic; new local responder token | Registered object retains host factory responder; SDK default is null | Yes |
| Report M6 as upstream dependency | Propagate request flag through shared contracts; guess/intercept flag locally | RPC broadcaster has flag; native callback contract does not | Yes; no behavior change |
| Preserve tab fallback pending upstream fix | Optional shared contracts and skip handling; uncompilable Electron-only change; empty-string substitute | Host, callback and both control contracts require string | Yes; no behavior change |
| Keep console warnings | Existing bridge console convention; add Logger dependency | Bridge has no Logger member | Yes |
| Keep binding registry | Existing global ownership; BootRefs/shutdown ownership migration | Deferred quit and bounded disposal rely on registry presence | Yes |

## Files created or modified (absolute paths)

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.ts (modified)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-session-binding.ts (created)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts (modified)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/ipc/ipc-bridge.ts (modified)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/ipc/ipc-bridge.codex-permission.spec.ts (modified)
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8f-5-report.md (created report)
