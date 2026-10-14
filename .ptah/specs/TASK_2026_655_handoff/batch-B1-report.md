# Batch B1 report — TASK_2026_655 (Components 1 + 2)

Commit: `bd4f6257f` on `feat/session-handoff-skill` (worktree
`.claude-worktrees/feat-session-handoff-skill`). Not pushed.

## Files

- CREATED `libs/shared/src/lib/types/messages/session-handoff.ts` — `SessionHandoffOpenedPayload`.
- MODIFIED `libs/shared/src/lib/types/messages/index.ts` — barrel export.
- MODIFIED `libs/shared/src/lib/types/messages/message-constants.ts` —
  `MESSAGE_TYPES.SESSION_HANDOFF_OPENED = 'sessionHandoff:opened'` (beside `AGENT_SESSION_OPENED`).
- MODIFIED `libs/shared/src/lib/types/messages/payload-map.ts` — `'sessionHandoff:opened'` entry.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts` —
  `HandoffChatSessionStartInput`; `IChildChatSessionHost.startHandoffSession(input)`.
- CREATED `.../session-children/session-handoff.port.ts` — request/result/refusal types, `ISessionHandoff`.
- CREATED `.../session-children/session-handoff.service.ts` — `SessionHandoffService`.
- CREATED `.../session-children/session-handoff.service.spec.ts` — 26 tests.
- MODIFIED `.../session-children/index.ts` — barrel exports.
- MODIFIED `.../di/tokens.ts` — `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF = Symbol.for('SessionHandoff')`.
- MODIFIED `.../di/register.ts` — singleton registration after `SESSION_SPAWNER`.
- MODIFIED `.../session-children/session-spawner.service.spec.ts` — fake host gains `startHandoffSession`.

## Names later batches import

From `@ptah-extension/shared`: `SessionHandoffOpenedPayload`, `MESSAGE_TYPES.SESSION_HANDOFF_OPENED`
(`'sessionHandoff:opened'`).

From `@ptah-extension/cli-agent-runtime`:

- B2 (adapter): `HandoffChatSessionStartInput` `{ tabId, workspaceRoot, cwd, prompt, sessionName,
  descriptor: SessionHandoffOpenedPayload, model?, permissionLevel? }`, returns the existing
  `ChildChatSessionStartOutcome`. `uiAnnounced` maps to the result's `tabOpened`.
- B3 (MCP tool): `CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF`, `ISessionHandoff`,
  `SessionHandoffRequest` `{ callerSessionId, handoffPath, prompt, label? }`,
  `SessionHandoffResult`, `SessionHandoffRefusalCode`, `SESSION_HANDOFF_LABEL_MAX` (60).
  `SessionHandoffService`, `SESSION_HANDOFF_HISTORY_SIZE` (64) are also exported.

## Behaviour notes

- Guard order: host + adapter → caller (`SessionId.safeParse` + `lifecycle.find`) → child
  (tab id or SDK id) → MCP port → cwd/root inside open folders → handoff file (absolute,
  inside open folders, regular file) → already handed off → start.
- Beyond the plan: a concurrent second call from the same caller while the first is starting
  is refused `already-handed-off` (in-flight set, cleared in `finally`), so two sessions
  cannot start from one caller. An unexpected collaborator throw is returned as
  `session-start-failed`, so `handoff()` never throws.
- The service does not validate `prompt`/`label` content (no `invalid-arguments` code in the
  plan's closed set): B3's zod schema must require a non-empty prompt. Both the given and the
  default label are truncated to 60 characters (ending in `…`).
- `model` is passed only when `record.currentModel` is non-empty (the registry defaults it to `''`).

## Checks (worktree cwd)

- `npx jest ... session-handoff.service.spec.ts --coverage=false --maxWorkers=2`: 26/26 passed.
- `npx nx test @ptah-extension/cli-agent-runtime --parallel=1 --maxWorkers=2`: 105/106 suites,
  2238 passed, 2 failed, 1 skipped. Both failures are 5 s timeouts in
  `capabilities/claude-approval.reader.spec.ts` (real git subprocess, machine under load; the
  file is not touched by this batch). Rerun alone: 21/21 passed.
- `npx nx typecheck @ptah-extension/shared --parallel=1`: passed.
- `npx nx typecheck @ptah-extension/cli-agent-runtime --parallel=1`: passed.
- `npx nx lint @ptah-extension/cli-agent-runtime`: 0 errors, 46 warnings, all in files this
  batch did not touch. `npx nx lint @ptah-extension/shared`: 0 errors, 6 warnings, none in
  `messages/`.
- `host-source-registry.contract.spec.ts` (shared): 5/5 passed (`sessionHandoff:opened` does
  not match the host-source name pattern, so no baseline change).
- `Symbol.for('SessionHandoff')`: exactly one occurrence in `libs`/`apps`.

## Known intermediate state

`IChildChatSessionHost` now has `startHandoffSession`, so `ChildChatSessionHostAdapter`
(rpc-handlers) does not satisfy the port until B2 lands. rpc-handlers typecheck and the pre-push
gates will fail on this commit alone; B2 must land before any push.

## Assumptions

- A1 (ptah-core disabled removes its workspace skill copies): holds. harness-sync
  `harness-reconciler.capability-policy.spec.ts:228` "a global OFF on an opt-out plugin ...
  reaps its copies" and `:301` "a disabled plugin and its copies stay absent".
- A2 (queued message flushed through `chat:continue`): holds by code reading.
  `message-dispatch.service.ts:222-250` `sendQueuedMessage` →
  `message-sender.service.ts:553` `continueExistingSessionForQueueFlush` →
  `runContinueConversation` (the `chat:continue` path, :692). Manual Electron check still open.
- A3 (`currentModel` accepted as `options.model`): holds. `chat-session.service.ts:708`
  resolves `options?.model || selectedModel || 'default'`; a model string is accepted.
