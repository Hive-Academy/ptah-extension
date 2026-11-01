# Batch 8f-2 ? TASK_2026_714_c8a2

Implemented in `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`. Verification and all git mutations are deferred to the team leader as instructed. No build, test, lint, typecheck, Nx, npm, verification or git-mutating command was run. Source reads, grep searches and a read-only barrel diff against main informed the changes.

## D2 / logic S4 ? Retain diagnostic errors

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:42`: added optional native `ErrorOptions`; coded messages remain `Codex chat <operation>: <code>` and wrapped failures retain the original thrown value as `cause`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:659`: central error handling passes the original Error as Logger.error's second argument, normalizing non-Errors with `new Error(String(error))`. Existing coded errors retain their identity. Open, generic safe operations and extracted turn streaming use this helper.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:256`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:350`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:530`: open, lifecycle cleanup, context/scope cleanup and asynchronous end-session failures preserve diagnostics. Lifecycle cleanup failure does not replace the primary open failure or skip native resource disposal.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:124`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:159`: turn errors, detached-turn/context cleanup and event subscription cleanup retain real errors; stream behavior and latch-release ordering are preserved.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:118`: all six approval catch paths (cancellation presentation, dismissal, presentation, replacement validation, follow-up delivery and follow-up reporting) log the caught Error. Log calls add no request, replacement or prompt content.
- Specs: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:239`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:322`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:623`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:641`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:657`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:223`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:240`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:268`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:291`. Assertions cover coded messages, causes, original Error identity and cleanup/delivery behavior. Specs were authored, not executed.

## M2 ? Stage lifecycle before persistence

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:231`: track attempted staging, invoke `sessions.opened` before metadata.save, then retain the existing cancellation and duplicate-publication checks. An opened/record exception cannot write identity metadata.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:258`: release attempted staging when opening fails, including partially throwing observers and persistence/cancellation failures. Do not close lifecycle state owned by an already-published winner of a concurrent open.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:110`: updated lifecycle documentation to describe staging and cleanup semantics.
- Specs: `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:260`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:301`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:787`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:823`. Fresh and resumed opens cover throwing staging; successful open asserts ordering; persistence failure/cancellation and the existing concurrent winner case cover cleanup.

## Style S1 ? Split turn streaming

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:21`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:36`, `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:50`: new cohesive sibling owns session stream state, event projection, usage/stat callbacks, subscription teardown and detached-turn draining with explicit dependencies.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:471`: the same exported CodexChatAdapter delegates to this implementation. Public definitions remain in their original modules; existing direct spec imports remain valid. The extraction adds no barrel export or re-export shim and has only type imports back to the adapter module.
- Final physical line counts (including blank/comment lines): `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` **678**; new `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts` **198**.

## Style S4 ? Document approved exports and remove unused additions

- `libs/backend/agent-sdk/src/index.ts:142`: retained registerCodexChatServices, documenting Electron composition specs and production di/register.ts plus the nullable-port-only override rule.
- `libs/backend/agent-sdk/src/index.ts:154`: retained CodexChatAdapter, documenting its real Electron composition-spec consumer and the same host override rule.
- Compared task-added barrel symbols against `main` using read-only `git diff main -- libs/backend/agent-sdk/src/index.ts`; searched each whole symbol across `apps/` and `libs/` with `rg -l -w <symbol> apps libs --glob '!**/agent-sdk/**'`. The following 21 symbols had zero external matches and were removed from the barrel only; their definitions remain available inside agent-sdk:

- `CodexSessionMetadataError`
- `InitializedSessionRuntimeIdentityLookup`
- `CodexRuntimeCompositionError`
- `CodexRuntimeCompositionErrorCode`
- `CodexThreadIdentityPersistError`
- `CodexThreadIdentityPersistErrorCode`
- `CodexChatAdapterError`
- `CodexChatMetadataPort`
- `NativeChatAdapter`
- `SessionApprovalAddress`
- `SessionApprovalReply`
- `SessionRuntimeRouter`
- `SessionRuntimeRoutingError`
- `LegacySessionControls`
- `LegacySessionControlError`
- `LegacyControlledSession`
- `LegacySessionLookup`
- `LegacySlashCommands`
- `CodexChatApprovalReply`
- `CodexChatApprovalPresentation`
- `CodexChatApprovalFollowUp`

- Retained additions have external consumers: Electron composition uses initializeSessionRuntimeIdentityLookup, createCodexThreadIdentityStore, CodexChatAdapterPorts and CodexChatScope; Electron composition/IPC specs use the concrete adapter/registration. rpc-handlers uses SessionUnavailableError, LegacySessionControlPorts, RuntimeAdmissionPort, SessionApprovalRouter, NativeSessionControls, SessionRuntimeIdentityLookup, LegacySettingsPersistence, CodexChatSessionLifecycle, CodexChatEventCallbacks and CodexChatTurnIdentity. AuthOperationContext has consumers in auth-providers.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Retain causes with ErrorOptions and centralize coded failure logging | Native cause option; custom readonly cause; message-only wrapping | Existing adapter error derives from Error; Node 24 supports ErrorOptions; public message format stays unchanged | Yes: optional constructor argument and a private helper |
| Stage lifecycle before saving metadata and release failed staging | Reorder observer; roll back persisted identity | CodexChatMetadataPort exposes only save, with no rollback method; opened/record is the reported pre-publication failure | Yes: local ordering/cleanup change, covered by authored specs |
| Preserve the published winner during failed-open cleanup | Unconditionally call closed; check current published ownership | Existing spec permits a second open to publish while the first metadata save is pending | Yes: local ownership guard |
| Extract turn streaming with explicit dependencies | Extract session opening; extract stream/drain operations | Stream/drain share busy/interrupt/subscription state; this puts the adapter under 700 lines without moving its public class/types | Yes: local module boundary, no new public barrel API |
| Keep approved concrete/registration exports and prune unconsumed task additions | Keep all widened API; remove all concrete exports; retain approved and consumed symbols | Team-leader decision plus whole-symbol apps/libs grep; 21 symbols have no consumer outside agent-sdk | Yes: definitions remain unchanged, so individual exports can be restored if a consumer is added |

## Every path written

- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts` ? modified
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts` ? created
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts` ? modified
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts` ? modified
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts` ? modified
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/index.ts` ? modified
- `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8f-2-report.md` ? created (this report)

## Not done / handoff

- No verification was executed, as explicitly required. The leader must run appropriate agent-sdk checks and relevant Electron/rpc-handlers consumer checks after combining the parallel lanes; authored specs have no claimed passing result.
- No commit, push, stash, reset, restore, checkout or other git mutation was performed. No files in apps/ptah-electron, libs/backend/rpc-handlers or libs/backend/codex-runtime were edited.
- Metadata already saved before a later cancellation is not rolled back: the current metadata port has no rollback API. The reported M2 opened/record failure now occurs before saving. This change does not promise rollback for all later failures.
- External-consumer grep reflects the parallel workspace at edit time; a later lane introducing a consumer of a removed barrel symbol will need that export retained/restored by the leader.
