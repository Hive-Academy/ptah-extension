# Batch 13 report

## Files changed

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-session-controls.ts`
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-driver-gate.spec.ts` (new)
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` (fake gate and call-order tests)
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts` (fake gate)
- `libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts` (fake gate required by scoped TypeScript diagnostics)
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`
- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts` (fake gate)
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts` (fake gate)
- `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-native.cross-process.spec.ts` (new)
- `apps/ptah-electron/src/di/codex-runtime-composition.ts`
- `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`
- This report.

## Quality requirements

- Required `driver` port and lock-free gate contract: `codex-chat-adapter.ts:138,153-164`; public exports: `agent-sdk/src/index.ts:197-198`.
- Resume admission follows profile preparation and precedes context open; start admission follows the thread ID and duplicate-session check and precedes staging; opening state is checked after either admission: `codex-chat-adapter.ts:331-370`. Resume identity is checked at `:348-349`.
- The published session stores its lease at `codex-chat-adapter.ts:542`; removal releases it once after context and scope teardown at `codex-chat-session-controls.ts:101-121`. Failed opens release at `codex-chat-adapter.ts:453`; admission errors retain identity at `:438`.
- Host ports omit the gate at `codex-chat-host-ports.ts:77`; Electron supplies it beside `sessions` at `codex-runtime-composition.ts:886-887`, with lazy coordinator resolution at `:773-784`.
- `cli-engine` was untouched. No relative workspace imports or workspace `import()`/`require()` were introduced.

## Tests added

- `codex-chat-driver-gate.spec.ts`: repeated close releases once.
- `codex-chat-adapter.spec.ts:194-258`: start/resume order, close release, failed-open release, unchanged refusal error.
- `session-driver-lock-native.cross-process.spec.ts`: a child process is refused while the native lease is held, then admitted after release.
- `codex-runtime-composition.spec.ts:36-51`: lazy coordinator resolution and forwarding.

## Verification

- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench,degradation-audit`: blocked before checks by Nx daemon/plugin Unix socket `connect EPERM`.
- Scoped ESLint: 0 errors, 4 existing warnings (max-lines, caught-error and unused-variable warnings).
- Degradation audit: exit 0; no new unsuppressed sites.
- Agent SDK Jest: 3 suites, 116 tests passed (109 adapter/gate tests and 7 registration tests).
- RPC handlers Jest: 2 suites, 24 tests passed; native cross-process suite could not acquire a lock because the sandbox denied its control socket (`listen EPERM`).
- Ptah diagnostics: initial calls timed out; a later scoped check found a missing fake gate in `register.codex-runtime.spec.ts:45`, which was added. The final compiler call timed out again; scoped Jest compilation and ESLint passed for that file.
- Electron composition Jest: 1 suite, 16 tests passed.

## Decisions

- Keep the driver gate at the adapter boundary. The existing native lifecycle observer is optional and synchronous, so it cannot refuse an open. The plan specifies the required gate. Reversible.
- Preserve the admission rejection object through cleanup so the coordinator's user error code reaches the RPC layer. The existing `failure()` conversion would replace it. Reversible.
- Release the lease after native context and scope teardown so lock ownership covers cleanup. The coordinator lease release is idempotent. Reversible.
