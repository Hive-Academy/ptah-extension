# Implementation report — restored Command Center provider

## Files changed

| Project | Files |
| --- | --- |
| agent-sdk | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, `sdk-agent-adapter.ts`, and their colocated specs |
| shared | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`, `rpc-chat.types.spec.ts`, `types/execution/node.ts`, `schemas.ts`, `schemas.spec.ts` |
| rpc-handlers | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`, `chat-session-provider-profile.spec.ts`, `handlers/session-rpc.handlers.ts`, `session-rpc.handlers.spec.ts` |
| chat-types | `libs/frontend/chat-types/src/lib/chat-types.ts` |
| chat-state | `libs/frontend/chat-state/src/lib/tab-manager.service.ts`, `tab-persistence.ts`, `tab-manager.persistence.spec.ts` |
| chat | `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`, `session-loader.service.spec.ts` |
| command-center | `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`, `command-center-projection.source.spec.ts` |

## Acceptance criteria

1. `SessionMetadata.providerId` is optional (`session-metadata-store.ts:77`). The Electron migration summary includes it (`:207`); unrelated and stale saves preserve a known ID (`:648`, `:662`); `create` accepts a known ID (`:1356`, `:1396`); and `updateProvider` serializes an existing-record change (`:1415`). The adapter passes the executed query's profile ID or capacity route at new SDK init (`sdk-agent-adapter.ts:1012`, `:1453`), after a validated resumed init (`:1298`, `:1317`), and after slash-command query creation (`:1698`). Empty and null IDs leave existing metadata alone. Older records remain unknown.
2. Successful `chat:resume` replies copy metadata identity (`chat-session.service.ts:1232`); `session:list` rows copy it (`session-rpc.handlers.ts:482`). The shared list-row type and Zod schema accept an optional nonempty ID (`types/execution/node.ts:233`, `schemas.ts:113`). `ChatResumeResult` already had `providerId` for auth failures; its existing field now also documents the success meaning (`types/rpc/rpc-chat.types.ts:363`). No RPC method, token, registration, stats payload, or guard fixture changed.
3. `TabState.providerId` is optional (`chat-types.ts:614`). The loader seeds a matching list row (`session-loader.service.ts:978`, `:1054`) and applies a successful resume reply after ownership, replay-claim and stale-snapshot checks (`:1022`, `:1060`), including when stats are absent. The tab manager clears identity on fresh reset and cross-session rebind (`tab-manager.service.ts:1537`, `:2746`), guards accepted updates by the bound session (`:2879`), and sanitizes restored IDs with a bounded nonempty Zod string (`tab-persistence.ts:257`). The projection uses persisted identity only after live capacity and model-matched usage (`command-center-projection.source.ts:42`, `:50`), including when no model is known.
4. Focused coverage includes metadata persistence (`session-metadata-store.spec.ts:118`), executed route capture (`sdk-agent-adapter.spec.ts:1338`), resume identity (`chat-session-provider-profile.spec.ts:238`), list pagination (`session-rpc.handlers.spec.ts:580`), optional schema validation (`schemas.spec.ts:6`), tab restore/reset/rebind (`tab-manager.persistence.spec.ts:134`), accepted and stale replies (`session-loader.service.spec.ts:1810`, `:2065`), and projection precedence (`command-center-projection.source.spec.ts:111`). Check results follow.

## Checks

| Check | Result |
| --- | --- |
| Typecheck, all seven changed projects | Passed. The final repeat for agent-sdk, rpc-handlers, chat-state, chat, and command-center also passed; agent-sdk passed again after the stale-save fix. |
| Lint, all seven changed projects | Passed, with repository warnings and no errors; agent-sdk passed again after the stale-save fix. |
| Focused Jest, agent-sdk | 2 suites, 212 tests passed after the stale-save regression assertion. An initial run had one test expectation failure for the null-route case; fixed and reran successfully. |
| Focused Jest, shared | 2 suites, 6 tests passed. |
| Focused Jest, rpc-handlers | 2 suites, 138 tests passed after the direct resume-reply case was added. |
| Focused Jest, chat-state | 1 suite, 25 tests passed. |
| Focused Jest, chat | 1 suite, 108 passed, 2 skipped. |
| Focused Jest, command-center | 1 suite, 9 tests passed. An initial combined-test setup failed; split the cases and reran successfully. |
| Full `nx test agent-sdk` | Repeated after the stale-save fix: 163 suites passed, 2 skipped; 3,491 tests passed, 3 skipped. |
| Full `nx test chat-state` | 33 suites, 614 tests passed. Jest reported a worker teardown warning, with exit code 0. |
| Full `nx test command-center` | 40 suites, 430 tests passed. |
| Scoped `ptah_get_diagnostics` | Unavailable: the TypeScript service was still running at its 45-second limit. Project typechecks above completed successfully. |
| Degradation audit | Passed: `degradation-audit: TOTAL 294 unsuppressed site(s)` (ceiling 294). |

## Decisions

- Reused the existing `ChatResumeResult.providerId` field for successful metadata identity. It previously described the provider needing authentication on error; the success and error branches are disjoint. Options were a second field or this existing field. The approved contract calls for `providerId`, and the change is reversible.
- Serialized known-provider updates through `SessionMetadataStore.enqueueWrite`. Options were direct `get`/`save` or a queued mutation. Existing store writes use the queue (`session-metadata-store.ts:1530`), so the queued mutation prevents stale writes. Reversible.
- Kept the latest known root query's canonical ID, with profile first and capacity route second. The approved plan and the query-result contract establish this priority. Unknown routes leave old metadata unchanged. Reversible.

## Not done

- No host-specific DI or RPC guard edits were needed. No files outside the approved source and spec list were changed.
