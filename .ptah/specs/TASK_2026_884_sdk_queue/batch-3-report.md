# Batch 3 report

## Files changed

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts` and spec
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` and spec
- `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts` and spec
- `libs/backend/codex-runtime/src/lib/codex-context.ts`
- `libs/backend/codex-runtime/src/lib/codex-runtime.types.ts`

## Behaviour

- `queueIntent: 'next-turn'` with a client message ID is held in the Codex session object's FIFO while busy. The send resolves after the queue accepts it. The next turn starts only when that session becomes idle. A captured thread ID is checked at admission; closing or replacing the session fails pending entries. Duplicate IDs are ignored for that session object's lifetime.
- State notifications cover queued, delivered, withdrawn, failed, and steered. Failure reasons are fixed safe strings; logs contain no message text.
- List and withdraw apply only to held entries. A claimed entry cannot be withdrawn. Steer reserves a held entry, invokes guarded `turn/steer` against the current turn ID, removes it on success, and preserves its FIFO position on `TURN_CHANGED`. The guarded Codex context rejects a changed turn before RPC admission and never falls back to `turn/start` for this path.
- Routing delegates queue operations to the adapter owning the session and fans in Claude and Codex state listeners. Peer and require-idle behavior remains under the existing paths.

## Decisions

- Kept follow-ups in `CodexChatPeerQueue` because it already owns the per-session-object FIFO and turn-idle transition. Reversible.
- Added an optional `expectedTurnId` to the public `CodexContext.steer` contract and runtime implementation. Existing one-argument callers retain their behavior; the follow-up path passes the active turn ID directly, with no cast. This interface edit was explicitly approved by the coordinator. Reversible.

## Checks

- `npm run verify -- -p agent-sdk`: project name `agent-sdk` confirmed; header reported `verify lint,typecheck (agent-sdk)` then `verify test (agent-sdk)`. Both Nx stages failed on sandbox `spawn EPERM`; no retry.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: passed.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/codex-runtime/tsconfig.lib.json`: passed after the interface edit.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/codex-runtime/tsconfig.spec.json`: passed after the interface edit.
- Agent SDK library typecheck passed again after the interface edit; the Codex chat adapter Jest suite passed again (111 tests).
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/agent-sdk/jest.config.ts` with the peer queue, chat adapter, and routing adapter spec paths: 3 suites, 160 tests passed.
- `ptah_get_diagnostics` on changed source files: unavailable after 45 seconds, reporting unchecked files; the direct scoped TypeScript checks above passed.

## Open issues

- The official Nx verifier remains blocked by sandbox subprocess restrictions; coordinator must run it outside this sandbox.
- No dedicated full app-server integration test ran because the sandbox blocks the native subprocess. The guarded steer path is covered by scoped adapter tests.
