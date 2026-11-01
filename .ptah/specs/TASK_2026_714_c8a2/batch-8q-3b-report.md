# Batch 8q-3b report

The Codex chat approval sink now reads the runtime turn permission snapshot. `setSessionPermissionLevel` is unchanged. The thread identity store already accepts a new profile fingerprint for the same thread, so it was not edited. No verification ran.

## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:474` — `buildSink` passes `() => context.turnPermissionLevel` into `CodexChatApprovalSink`. It previously read `getSession()?.settings.permissionLevel`, which updates as soon as the level is toggled. The sink still fail-closes in `codex-chat-approval-sink.ts:123`: a level other than `'ask'` falls through to the approval card.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:722-736` — `setSessionPermissionLevel` left as it is. It still rejects `default`, `acceptEdits`, and `bypassPermissions`, calls `context.updateNextTurn({ permissionLevel: level })`, then stores the level on `session.settings` for the next turn. The open-thread call no longer throws, so a different level resolves.
- `libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.ts` — no code change. `persist` (`:96-111`) already writes `identity.profileFingerprint` when the context matches and the generation is not stale. A different context is still `context-mismatch` (`:97-98`). A lower generation is still `stale-generation` (`:99-103`).

## Specs added

- `keeps the active turn permission level in the sink until the next turn` — `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:669`. Replaces `uses the live session permission level for chat read approvals`, which required the sink to follow `session.settings` immediately. The new spec asserts: a read-only command auto-accepts at `'ask'`; `setSessionPermissionLevel(id, 'plan')` resolves (`:685`) and calls `updateNextTurn` (`:686`); while `context.turnPermissionLevel` stays `'ask'` the sink still auto-accepts (`:690-696`); after that property becomes `'plan'` the same sink presents the card (`:697-701`).
- `stores a new profile fingerprint for the same thread and still refuses a different context` — `libs/backend/agent-sdk/src/lib/wiring/codex-thread-identity-store.spec.ts:160`. A second `persist` of the same thread, context, and generation with `profileFingerprint: 'fingerprint-2'` resolves and is what `read` and `codexThread` return (`:163-171`). A persist of that revision with `contextId: 'context-2'` is refused as `context-mismatch` and the stored fingerprint stays `fingerprint-2` (`:172-175`).

`resumes native identity, supports settings and compaction without SDK aliases` (`codex-chat-adapter.spec.ts:511`) already asserts that `setSessionPermissionLevel(id, 'yolo')` resolves and calls `updateNextTurn`. It was not edited.

`codex-chat-turn-lifecycle.spec.ts` was not edited. It has no permission-level assertion. The sink gate lives in the adapter spec.

## Decisions

- Decision: the sink reads the `context` argument's `turnPermissionLevel`. Options: keep `session.settings.permissionLevel`; read `getSession()?.context.turnPermissionLevel`; read `context.turnPermissionLevel`. Evidence: batch 8q-3a exposes `turnPermissionLevel` as the current-turn snapshot, else the stored next-turn level (`libs/backend/codex-runtime/src/lib/codex-context.ts:207-215`). The approval bridge already uses that getter (`codex-context.ts:273`). `buildSink` is called with that same `context` (`codex-chat-adapter.ts:283`). `session.settings` still changes at once in `setSessionPermissionLevel` (`:735`), which is what made the sink and the bridge disagree. Reversible: yes, the getter is one expression.
- Decision: do not change the identity store. Options: drop a fingerprint equality check inside `persist`, or pin the current write. Evidence: the thread updater copies `identity.profileFingerprint` on every accepted persist (`codex-thread-identity-store.ts:104-111`) and does not compare the old fingerprint. `sameBinding` compares the fingerprint only for `markInactive` (`:46`), which is unchanged. A different context on the same thread is the refusal the store already has (`:97-98`). A different `threadId` is a different session key and is stored, not refused. Reversible: yes, the pin is a spec only.
- Decision: the adapter spec models the next turn by assigning the mock's `turnPermissionLevel`. Options: reimplement the runtime snapshot inside the mock, or assign the property the sink reads. Evidence: the adapter does not advance the snapshot. `updateNextTurn` on the mock does not change `turnPermissionLevel`, so a call during the open session leaves the sink on `'ask'` until the spec sets the property to `'plan'`. That is the runtime's idle-or-next-turn value. Reversible: yes.

## Not done

- No verification ran. Tests, lint, `nx`, `tsc`, and diagnostics were not run.
- `codex-chat-turn-lifecycle.spec.ts` was not changed.
- `setSessionPermissionLevel` was not changed.
- The approval sink class, Claude path, frontend, `rpc-handlers`, and `ptah-electron` were not changed.
- Nothing was committed or pushed.
