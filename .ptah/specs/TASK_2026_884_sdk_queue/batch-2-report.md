# Batch 2: Claude runtime follow-up queue

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-follow-up-queue.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

## Behaviour

Claude follow-ups with `queueIntent: 'next-turn'` and a client message ID are held in the session record's existing FIFO. The pump emits `queued`, `delivered` when claimed, `withdrawn`, or `failed` when the owning record is removed or replaced. A held item carries its registration token; an old stream cannot consume a replacement registration. Accepted IDs are deduplicated for that record. The adapter exposes subscribe, withdraw and list operations. The pump retains its one-message-per-turn gate; ordinary messages and require-idle admission retain their existing paths. No Claude steer operation was added.

## Decisions

- Store follow-up snapshots beside SDK turns in the existing record queue, and accepted IDs on the record. This follows the fixed contract and the existing pump ownership pattern; reversible within this module.
- Keep withdrawn IDs in the accepted set for the lifetime of a registration, so a repeated client message ID cannot silently re-enqueue. This is an idempotent receipt decision; reversible if the contract changes.

## Verification

- Confirmed project name `@ptah-extension/agent-sdk` in `project.json`; official command `npm run verify -- -p agent-sdk` selected one project but failed when Nx plugin subprocesses returned `spawn EPERM`. It was not retried.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/agent-sdk/tsconfig.lib.json`: failed on `libs/backend/codex-runtime/src/lib/codex-context.ts:882`, a concurrent batch 3 edit (`"Codex turn changed before steer"` type mismatch). No agent-sdk errors reported.
- `node node_modules/typescript/bin/tsc --noEmit -p libs/backend/agent-sdk/tsconfig.spec.json`: same unrelated error.
- `ptah_get_diagnostics` scoped to changed files after edits: zero errors or warnings.
- `node node_modules/jest/bin/jest.js --runInBand -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-follow-up-queue.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.spec.ts`: 2 suites, 27 tests passed. Covers FIFO, no SDK yield while busy, state order, withdrawal before/after claim, duplicate ID, replacement, and session end.

## Open issues

- The coordinator must run official verification outside this sandbox once the concurrent Codex type error is resolved.
