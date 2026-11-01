# Batch 6f ADAPTER report

Implemented the assigned native adapter, stream projection and approval fixes. Only the six owned source/spec files and this report were changed.

## Findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B3 / fix 3 frontend contract | Fixed | codex-chat-events.ts:84 emits assistant message_start before the first accepted projection, sharing messageId with all later events; :115 streams final-only text and an unstreamed suffix; :230 completes the message. codex-chat-events.spec.ts asserts start, delta, final suffix, message_delta, complete order and unique event IDs. |
| M1 / fix 4 busy lifetime | Fixed | codex-chat-adapter.ts:445 acquires busy only when the generator starts; :517 releases it in finally. :385 wraps publish with iterator.return in finally; :572 clears state on disposal. Specs cover unconsumed, return-before-next and publish-before-next failure. |
| M2 / fix 5 failed interrupt | Fixed | codex-chat-adapter.ts:519 clears block when a turn finishes; :589 clears block when interrupt finds an idle session. Specs cover rejected and false interrupt replies followed by turn end and another message. |
| M3 / fix 6 approval lifetime | Fixed | codex-chat-approval-sink.ts:87 has no timeout. :197 implements cancel(threadId, requestId), returning false for missing correlation, settling cancel and dismissing. Abort/dispose preserve existing decline decisions. Specs advance 120 seconds with zero timers and exercise cancellation. |
| M4 / fix 7 models | Fixed | codex-chat-adapter.ts:401 implements listSessionModels through that open context, mapping id/displayName/optional description only; unavailable sessions reject with a coded error. The context fake implements listModels. |
| M4 / fix 7 usage | Fixed within available data | codex-chat-events.ts:191 emits message_delta usage, :230 includes reported message_complete usage; codex-chat-adapter.ts:416 reports compaction preTokens from last usage. The live-stats setter remains an explicit refusal at :655: SessionStatsEntry requires cacheCreation and session-wide messageCount that CodexReportedUsage cannot supply honestly. No fabricated values. |
| S3 injected logging | Fixed | codex-chat-adapter.ts:70 requires Logger; :233/:317 log sanitized open/cleanup failures; turn/safe catches log operation without raw errors. codex-chat-approval-sink.ts:84 requires Logger and logs presentation, validation and follow-up failures. |
| S7 open responsibilities | Fixed | codex-chat-adapter.ts:196 now sequences prepareProfile (:241), createScope (:263), openContext (:273), buildSink (:333), persistMetadata (:285), publishSession (:297), and cleanupOpen (:317). |
| Correlation key minor | Fixed | codex-chat-adapter.ts:333 uses sessionApprovalKey(address) for release registration and dismissal. |
| Specific error codes minor | Fixed | codex-chat-adapter.ts:45 adds cancelled and identity-mismatch; open/stream preserve CodexChatAdapterError instead of collapsing it. |
| Transient turn failures moderate | Fixed | codex-chat-adapter.ts:517 releases turn state without closing context; specs retry after rejected startTurn and missing terminal. |
| Undefined resume options minor | Fixed | codex-chat-adapter.ts:186 ignores entries whose value is undefined. |
| Non-null assertions minor | Fixed | buildSink captures the initialized sink and narrowed session; interrupt captures turnId. No non-null assertions remain in adapter source. |
| Approval seen-set pruning minor | Fixed | codex-chat-approval-sink.ts:107 deletes settled correlation; dispose clears remaining entries. |
| SessionId minor | Fixed | codex-chat-approval-sink.ts:80 types owned sessionId as SessionId, as do presentation methods. The external reply remains a string validated by schema and exact correlation. |
| Health minor | Fixed | codex-chat-adapter.ts:148 reports available until disposed, including before any session opens. |
| Metadata title minor | Fixed | codex-chat-adapter.ts:54 documents that title is not persisted until writer contract gains it; parameter retained. |
| Review/worktree/permission aliases | Preserved | /review remains a tracked later-phase gap. Worktree callbacks and SDK permission aliases remain explicit refusals. |

## Wiring contract

WIRING must bind the new required `CodexChatAdapterPorts.logger: Logger` imported from `@ptah-extension/vscode-core`. The adapter passes it as the fifth constructor argument to CodexChatApprovalSink, replacing the former timeout argument. No other new port fields.

## Verification

Formatted all six source/spec files with repository Prettier.

Latest scoped ptah_get_diagnostics result:

> Source: typescript-compiler. Errors: 16 | Warnings: 0. Coverage: clean.
> Requested files: No diagnostics in the requested files.
> Sibling errors: index.ts exports and di/register.ts / register.codex-runtime.spec.ts identity lookup integration, owned by WIRING.

One authorized scoped test command was started:

`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="codex-chat-"`

Its completion result remains pending at handoff; no second run was started. Unified execution session ID: `11662`. The command pipes output to `Select-Object -Last 70`, so output is withheld until completion; no passing-test claim is made. The team-leader owns authoritative verification.

Last execution response:

> session_id: 11662; wall_time_seconds: 60.0151342; output: "" (still running)

The only unverified item is the scoped Jest result; production/spec TypeScript diagnostics are clean for all six owned files. The ongoing run has not been cancelled.

## Decisions

- Acquire busy inside generator execution, instead of a timeout or a reservation needing caller disposal. Evidence: an async generator returned before next never enters finally; no runtime turn exists until next. Reversible: yes. A consumed stream still rejects concurrent starts.
- Preserve session context after transient start/stream failures; abort the turn subscription and release busy. Evidence: P6 fix 11 explicit requirement and core context ownership separate from turn ownership. Reversible: yes.
- Send only the unstreamed suffix of final text into append-only text_delta, while keeping full replacement callback behavior for corrected finals. Evidence: shared frontend delta contract is append-only; final-only text must enter that stream. Reversible: yes.
- Retain liveStats refusal rather than inventing required cacheCreation and session message totals. Evidence: shared agent-adapter.types.ts SessionStatsLivePayload requires SessionStatsEntry, whose required fields exceed CodexReportedUsage. Compaction emits only when preTokens can be determined. Reversible when native usage contract gains the missing fields.
- Keep external approval reply sessionId as string while branding sink ownership and presentation. Evidence: replies enter through unknown/Zod; existing router callers send wire strings. Reversible: yes.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6f-adapter-report.md
