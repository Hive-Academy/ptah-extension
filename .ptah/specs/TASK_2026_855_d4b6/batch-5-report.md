# Batch 5 — durable chat-session plugin lineage

## Changed paths

- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-session-folder.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/session-metadata-store.lineage.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.lineage.spec.ts`

## Acceptance L behavior

- **Capture:** Child and handoff launches derive the lineage from authoritative source metadata, or the in-flight tab record before SDK-ID binding. They compare the source execution root to the immediate launch root, reject missing/mismatched/malformed source data, canonicalize and deduplicate the ordered roots, exclude the child's execution root, and reject a return to an ancestor. Same-root handoff retains saved ancestors. A launch without a source captures only the validated immediate root. Pending tab lineage is installed before SDK start and removed on bind, session end or launch failure.
- **Durability:** `launchSdkSession` passes `pluginConfigAncestorRoots` to `startChatSession`. New tests exercise R → A → B with real SDK-ID metadata binding, repeated create/save preservation, summary/detail and async split-index round trips, fresh-runtime resume and slash-command query recreation, stored-over-caller precedence, malformed refusal, and B restoration after deleting A's metadata.
- **Restore:** Inactive continuation, explicit activation and rewind use the common resume path. Valid stored roots, including explicit `[]`, are restored; malformed data refuses. Legacy metadata recovers only a distinct saved `workspaceId` as one parent, logs that earlier ancestors are unknown, and upgrades the record after successful activation. A record without a provable parent supplies `[]`. A wholly missing metadata record also supplies `[]` to preserve existing history-only resume behavior; it cannot be upgraded. The adapter re-reads stored roots on query reconstruction.
- **Validation/isolation:** Current launch and restore paths validate lexical absolute roots with existing registered-workspace and unsafe-path helpers. They retain existing RPC refusal shaping, account gates, and spawner rollback. No policy polling or watchers were added. Full physical-path checks belong to Batch 6 below.
- **Account-binding compatibility:** The existing account-binding suite now supplies the required authoritative `workspaceId` and matching `workingDirectory` in its source metadata fixtures. All prior account assertions remain intact. A new child/handoff case proves an unresolvable source refuses before SDK launch, using each API's existing error shape.

## Batch 6 handoff

- In `session-folder.ts`, remove fallback from a distinct saved execution cwd to `workspaceId`; a missing, unsafe, unauthorized or uncheckable distinct cwd must return `SESSION_FOLDER_UNAVAILABLE` before SDK resume, even when the parent is valid. Preserve identical/missing-cwd legacy behavior.
- Validate both supplied and resolved physical execution cwd, local governing config root and every ancestor before launch or query reconstruction. Check filesystem existence/readability/error outcomes, registered-folder authorization, unsafe paths, and symlink escapes/aliases. A valid execution cwd must not authorize an invalid ancestor. Use that same validation for child/handoff, activation, inactive continue, rewind and equivalent restore entries; revalidate when roots change or disappear. Current Batch 5 canonicalization is lexical only.
- Replace contrary fallback tests and add removed/unreadable roots, filesystem errors, symlink escape/alias, duplicate physical identity and corrupt-array refusal coverage. Ensure rejected roots are never read as plugin policy or handed to SDK resume.

## Decisions

| Decision                                                                       | Options                                       | Evidence                                                                                                                                                                                                 | Reversible |
| ------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Prefer durable SDK-ID metadata; use a pending tab map for pre-bind source IDs. | Metadata only, pending map, new registry.     | The plan names durable metadata and the pre-bind gap; the existing ID-resolution callback clears the pending entry.                                                                                      | Yes.       |
| Preserve `[]` for wholly absent resume metadata, with no lazy write.           | Refuse or resume without inherited roots.     | Existing history-only resume tests have no metadata record; no parent can be proven. A supplied source ID with no record still refuses.                                                                  | Yes.       |
| Do not upgrade legacy data lacking a workspace identity.                       | Attempt write or treat as no provable parent. | Such a record cannot establish a parent root; actual metadata records have `workspaceId`.                                                                                                                | Yes.       |
| Keep source-root absence as a refusal and enrich account-binding fixtures.     | Infer from caller workspace or refuse.        | Acceptance L requires an authoritative matching source root; `SessionMetadata.workspaceId` is required, while the old fixtures returned only `accountBinding`. A new missing-source case proves refusal. | Yes.       |
| Run account selection before lineage capture.                                  | Capture first or gate first.                  | Existing typed account refusals must retain their shape; neither order permits SDK launch without lineage capture.                                                                                       | Yes.       |

## Verification

- `npx prettier --write libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-resume-activate.spec.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-session-session-folder.spec.ts libs/backend/agent-sdk/src/lib/session-metadata-store.lineage.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.lineage.spec.ts .ptah/specs/TASK_2026_855_d4b6/batch-5-report.md`: exit 0 in the first pass.
- `npx prettier --write libs/backend/rpc-handlers/src/lib/chat/session/chat-session.account-binding.spec.ts`: exit 0 after the fixture and refusal-case edits.
- `npx prettier --write .ptah/specs/TASK_2026_855_d4b6/batch-5-report.md`: exit 0 after this report update.
- `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`: first pass exit 1; `NX   6 tasks: 5 succeeded, 1 failed`; failed target `@ptah-extension/rpc-handlers:test` before compatibility fixture corrections. Final pass exit 0; `NX   6 tasks: 6 succeeded, 2 cached`. No other rpc-handlers suite required fixture changes.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=chat-session-agent-child`: exit 0 on both runs; `NX   1 task: 1 succeeded` on the final post-edit run.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns=chat-session.account-binding`: initial exit 1; `NX   1 task: 0 succeeded, 1 failed`; 17 failed and 43 passed before the fixture correction. Follow-up exit 1; `NX   1 task: 0 succeeded, 1 failed`; 61 passed, one new handoff expectation failed because the API retains generic refusal shaping. That expectation was corrected before the final full pass.
- `npm run verify -- -t test -p @ptah-extension/rpc-handlers -- --testPathPatterns='(chat-session-resume-activate|chat-session-session-folder|chat-continue-slash-before-resume|chat-session-provider-profile|chat-session-persona-resume|chat-session.ptah-ui-flag)'`: exit 0; `NX   1 task: 1 succeeded`.
- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns='(sdk-agent-adapter.lineage|session-metadata-store.lineage)'`: exit 0; `NX   1 task: 1 succeeded`.
- `npm run verify -- -t lint,typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk`: exit 0; `NX   4 tasks: 4 succeeded` after the final source/spec edits.
- No dependent-host verification was needed because no rpc-handlers public type changed.
- Scoped `ptah_get_diagnostics` was called after edits; the TypeScript compiler worker remained unavailable after its 45-second timeout, so it returned unchecked rather than clean diagnostics. The final scoped verify lint/typecheck run passed.

## Blockers

- None for Batch 5. Full physical-path validation and the distinct-cwd parent-fallback removal remain Batch 6 work.
