# Batch B2 report

## Files changed

| File | Change |
| --- | --- |
| `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts` | Optional replay collector records block owners and synthetic Task results by event identity. |
| `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.spec.ts` | Main, correlated subagent, thinking-only, orphan, persisted-result, synthetic-result, and no-collector regressions. |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` | Opt-in collector creation, replay forwarding, and successful-read metadata return. |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` | Successful opt-in and legacy no-metadata cases. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts` | Passes `includeBlockOwners` from resume reads to the reader. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts` | Forwarding regression. |
| `libs/backend/rpc-handlers/src/lib/chat/session/history-block-owners.ts` | Pure page selectors for complete-message owners and delivered synthetic results. |
| `libs/backend/rpc-handlers/src/lib/chat/session/history-block-owners.spec.ts` | Page-edge, unpaged, and synthetic index cases. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` | Opt-in resume metadata on the delivered page only. |
| `libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts` | Paged opt-in and legacy reply regressions. |
| `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts` | `chat:resume` literal-true opt-in and bounded, unique UUID `resyncTabIds`. |
| `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts` | Schema acceptance and rejection cases; corrected the lint-invalid property access in the new assertion. |

## B.2.2 rule locations

| Rule | Code |
| --- | --- |
| One optional collector object, keyed by replay event identity | `session-replay.service.ts:51`, `:88-97` |
| Root assistant text, thinking, and both Task/ordinary tool starts own their API `message.id` when nonempty | `session-replay.service.ts:299-321`, `:330-341`, `:432-443` |
| Correlated subagent text and tool starts use the same collector; other subagent events have no owner | `session-replay.service.ts:366-372`, `:496-501`, `:531-563` |
| Synthetic Task result is marked; persisted parent result is not | `session-replay.service.ts:376-429` |
| Absent collector preserves replay event output and shape | `session-replay.service.ts:92-97`; `session-history-reader.service.ts:470-481` |
| Reader opt-in defaults absent, forwards collector, returns metadata only on successful opted-in read | `session-history-reader.service.ts:193-213`, `:224-245`, `:282-292`, `:470-481` |
| Resume history reader forwards opt-in | `chat-history-read.service.ts:66-80` |
| Owner selector counts full versus delivered blocks and drops every entry for a cut message | `history-block-owners.ts:3-27` |
| Synthetic selector returns delivered `tool_result` indices only | `history-block-owners.ts:30-39` |
| Resume passes opt-in and adds both page-indexed fields only when requested and the read provided metadata | `chat-session.service.ts:949-955`, `:1080-1109` |
| `chat:resume` accepts optional literal `true` while remaining passthrough | `chat-rpc.schema.ts:84-95` |
| Plan component 4 viewport schema accepts at most 128 distinct UUID resync IDs and rejects unknown keys | `chat-rpc.schema.ts:98-122` |

The B.2.2 projection `persistedBlocks` and coordinator `liveSeedBlocks` rules belong to Batch B1 and were outside B2's permitted files.

## Tests

| Acceptance | Coverage |
| --- | --- |
| R-B4 host page edge | `history-block-owners.spec.ts:12` checks cut X and complete Y, plus the unpaged map; `chat-session-history-page.spec.ts:139` checks the paged reply and no opt-in keys. |
| R-B5 agent SDK | `session-replay.service.spec.ts:113`, `:137`, `:198` check unchanged no-collector events, thinking-only and correlated text ownership, and an orphan agent after compaction. `session-history-reader.service.spec.ts:161` checks collector forwarding and legacy absence. |
| R-B6 host record shapes | `session-replay.service.spec.ts:113` checks thinking, text, and tool starts from one API record; full live-batch filtering is Batch F. |
| R-B7 host synthetic result | `session-replay.service.spec.ts:137` compares synthesized versus persisted results; `history-block-owners.spec.ts:29` checks delivered indices; `chat-session-history-page.spec.ts:139` checks reply indices. |
| RPC contracts | `chat-history-read.service.spec.ts:77`, `chat-rpc.schema.spec.ts:117`, `:168-194` cover forwarding, literal-true opt-in, and resync ID acceptance/rejection. |

## Checks

All commands used the shared `.check-lock`, acquired and released by the same PowerShell command. Tail evidence is quoted below; exit codes are from the check command, not from the output filter.

| Check | Tail / outcome |
| --- | --- |
| `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.spec.ts libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts --coverage=false --maxWorkers=2` | **PASS**: `Test Suites: 2 passed, 2 total`; `Tests: 74 passed, 74 total`; `CHECK_EXIT=0` (also passed after the R-B5 fixture edit). |
| `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session/history-block-owners.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-history-page.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts --coverage=false --maxWorkers=2` | **PASS**: `Test Suites: 4 passed, 4 total`; `Tests: 73 passed, 73 total`; `CHECK_EXIT=0` after schema assertion correction. |
| `npx nx typecheck @ptah-extension/agent-sdk --parallel=1` | **PASS**: `Successfully ran target typecheck for project @ptah-extension/agent-sdk`; `CHECK_EXIT=0`. |
| `npx nx lint @ptah-extension/agent-sdk --parallel=1` | **PASS**: `51 problems (0 errors, 51 warnings)`; `Successfully ran target lint`; `CHECK_EXIT=0` after the R-B5 fixture edit. |
| `npx nx lint @ptah-extension/rpc-handlers --parallel=1` | Initial **FAIL**: `51 problems (1 error, 50 warnings)`. Focused `npx eslint` identified `chat-rpc.schema.spec.ts:121` (`no-unexpected-multiline`); corrected it. Final **PASS**: `50 problems (0 errors, 50 warnings)`; `Successfully ran target lint`; `CHECK_EXIT=0`. |

The Jest runner emitted an ES-module warning but completed both suites. Nx reported a disabled Nx Cloud organization (401) after successful local targets. Scoped `ptah_get_diagnostics` was unavailable after its 45-second compiler timeout; the agent SDK typecheck and focused suites supplied the verification above.

## Decisions

- Metadata is attached only when `historyBlockOwners === true` and the reader returned both collections. Successful legacy replies contain neither new key.
- Selectors use event object identity. The history page is a slice of the full replay, so the selector can compare complete-message counts without changing event shape or IDs.
- No agent SDK barrel export was needed: the collector type is used inside that library, and RPC handlers consume the reader's inferred return type through its existing public service.

## Open

- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1` was deliberately deferred to the orchestrator because another lane was editing `libs/backend/rpc-handlers/src/lib/chat/streaming/*` concurrently.
- Batch B1 projection/coordinator and Batch F webview filtering are outside this batch; their integration checks remain with those owners.
