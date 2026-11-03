# Code logic review: fallback-thread fix (PR #900, uncommitted)

Implementer family: codex
Review family: Claude subagent (lanes at limit)
Verdict: APPROVED

Scope: `git diff HEAD -- libs apps` read in full for the lane adapter, codex-context, codex-runtime, select-codex-executable, chat stream/adapter and the three composition roots. Specs were not executed (read-only review). Consumers in `agent-process-manager.service.ts` were read for the identity propagation question.

## Answers to the review questions

- Zero-turn vs history detection: correct.
  - Lane: `hasTurnHistory = resume !== undefined` (adapter:261) and set `true` only after a receipt (adapter:516). `retryConfig` runs before any turn and never touches the flag. The fallback is one-shot (`fallbackUsed`), so the flag cannot go stale between the failed `startTurn` and the reopen.
  - A resumed lane keeps `previous.identity` and uses `thread/resume`. After an accepted receipt, the fallback is no longer reachable because the receipt branch is skipped.
  - Runtime: `turnHistory` is set in `open(resume)` (context:255) and after the receipt is stored (context:698). `startTurn` throws before that line when the method is rejected, so a rejected `turn/start` leaves it unchanged.
- Writer re-registration: adapter:361-363 removes the old entry only if it is owned by this writer, before `set`. `close()` deletes only the current `registeredThreadId`, so there is no double registration and no leak. If the new open fails before that block, the old entry stays and is removed by `close()`.
- Runtime identity update: `open(profile, undefined, ...)` gives a new `context.identity`, which `retryFirstTurnOnBundle` returns.
- Snapshot version key: `markUnsupported` stores `parseCodexVersion(version) ?? version`. `selectForOpen` looks up `selected.version`, which is already the parsed value (select-codex-executable:77-82), so the keys match.
- `markUnsupported` is reached only for installed sources: the chat stream guards on `error.source === 'installed'` and `!admitted`, and `CodexRuntime.markUnsupported` and `CodexSelectionSnapshot.markUnsupported` each re-check `source === 'installed'`.
- Snapshot memory: one Map entry per distinct installed version string, per host-scope snapshot. Growth is bounded in practice.
- Port implementers: all ports are updated. This covers the Electron runtime composition, both Electron lane wrappers (`selectedFallback`, `boundSnapshot`), the cli-engine composition (two wrappers) and the specs touched by the diff. `CodexSelectionSnapshot` implements it directly.
- No `any`, `as unknown as`, non-null `!` or `console.*` appear in the added lines.

## Findings

1. Moderate - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:983-987,1092-1096` with `codex-app-server-lane.adapter.ts:558`.
   - Scenario: the fresh-lane fallback changes `sessionId` after spawn. The process manager captures `getSessionId()` once at spawn and puts it in `agent:spawned` info and `cliSessionId`. It refreshes only on a later output segment (agent-process-manager:1308-1312). The lane adapter has no `onSessionResolved`.
   - Effect: between spawn and the first segment, `laneRecordsForSession` and resume handles use the abandoned thread id. A lane that finishes without emitting a segment keeps the stale id.
   - Fix: call a session-resolved notification from `openContext` when `sessionId` changes, or emit an info segment right after the fallback re-open.
2. Moderate - `codex-app-server-lane.adapter.ts:357,377`. The abandoned thread's identity stays persisted via `identities.persist`, and `onAccountBinding` is called for both thread ids. Neither is cleaned up. These are orphan records for a thread that was never used. This is harmless for resume (the id is not handed out) but is store clutter. Fix: remove or skip the persist and binding for a thread that gets replaced, or document it.
3. Moderate (accepted trade-off) - `codex-chat-turn-stream.ts:513-519`. The first chat message on an installed Codex without `turn/start` now fails and retires the session instead of silently retrying on the bundle. The user must resend. The memory is in-process only, so it repeats after each host restart for that version. The message states "The next session will use bundled Codex", which matches the behavior. This is a UX regression against the old retry but is justified by the published Ptah session id, as the report explains.
4. Minor - `codex-runtime.ts:404`. `retryFirstTurnOnBundle` now has no non-spec callers. It also treats any context that is not a `RuntimeContext` as zero-turn and would start a new thread. Contexts with a selection are always `RuntimeContext` today. Fix: remove it, or fail closed for other context types.
5. Minor - `electron/codex-runtime-composition.ts:168`. `markUnsupported` is forwarded without `logSelection`, so a remembered downgrade produces no log line until the next `selectForOpen`. This is observability only.
6. Minor - `select-codex-executable.ts:146-156`. `activateFallback` calls `markUnsupported` before checking for a bundled executable. With no bundle the version is recorded and the call then throws. This is harmless because `selectForOpen` requires a bundled fallback before applying it.

No Blocking or Serious issues found.
