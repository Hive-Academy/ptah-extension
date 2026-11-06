# Review fix report

## Changes

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:53,360`: session receipt map records payload fingerprint and lifecycle state; retries with matching content are idempotent and conflicting or terminal IDs are refused. Removed the obsolete `followUpIds` set from `session-registry.service.ts:89,356`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:27,44,92`: Codex keeps equivalent receipts and consumes uncertain steer outcomes, preventing later FIFO delivery of the same item. `codex-chat-adapter.ts:917` distinguishes a server JSON-RPC refusal from an uncertain transport result; `codex-runtime/src/index.ts:109` exports the verified refusal error. `follow-up-queue.types.ts:42` adds `DELIVERY_UNCERTAIN`.
- `libs/backend/rpc-handlers/src/lib/chat/follow-up/chat-follow-up-queue.service.ts:55,87,128,193`: acceptance now requires a held entry or a delivered receipt. The service tracks pending submissions so Stop waits for their admission before withdrawing. Stop generations fence sends that are still preparing. `chat-session.service.ts:1708,1930,2305` captures and advances that fence and returns a cancelled response for a late send. `rpc-error-codes.types.ts:25` adds `FOLLOW_UP_ID_CONFLICT`.
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:86,116`: queued prompts, file lists, and image attachments are parsed and bounded before the handler starts side effects.
- Regression specs added in neighboring `session-stream-pump.service.spec.ts`, `codex-chat-peer-queue.spec.ts`, `chat-rpc.schema.spec.ts`, `chat-follow-up-queue.service.spec.ts`, and `chat-session.follow-up-queue.spec.ts` for duplicate IDs, uncertain steer, malformed payloads, missing delivery receipts, and Stop racing preparation.

## Tests

- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts` with the pump and Codex peer queue specs: **2 suites, 35 tests passed**.
- `npx jest --runInBand -c libs/backend/rpc-handlers/jest.config.ts` with the schema, follow-up coordinator, and chat session queue specs: **3 suites, 139 tests passed**.
- `ptah_get_diagnostics` was attempted on changed TypeScript files after edits. It returned **unavailable** because the TypeScript check was still running after 45 seconds; the focused Jest runs type-compiled their imported paths successfully. No Nx or `npm run verify` command was run.

## Decisions

- A definite Codex JSON-RPC error leaves the item queued (`TURN_CHANGED`); any other steer failure is treated as uncertain delivery and consumes the item with `DELIVERY_UNCERTAIN`. Evidence: `CodexContext.steer` preserves `CodexRequestRejectedError` and wraps transport failures. Reversible: yes.
- The Stop fence advances at entry to `chat:abort`, before asynchronous host routing. An in-flight provider submission is awaited before the Stop snapshot, preserving the existing rule that an already claimed turn is omitted. Reversible: yes.
