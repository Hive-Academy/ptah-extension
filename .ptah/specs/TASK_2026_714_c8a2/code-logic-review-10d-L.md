# Code logic review 10d-L (batches R, M, N)

Score: 6/10. Verdict: REVISE. Read-only review. I ran no tests and did not run the Claude-vs-Codex peer rendering comparison to the end.

## Batch R (writer registry) - codex-app-server-lane.adapter.ts

- MAJOR: a failed close is cached forever (`close` ~l.304-321, resume path ~l.392-407). `closePromise` memoizes `false`. The resume path restores `previous` and throws `CodexLaneWriterCloseError`, and every later resume gets the same cached `false`. The thread can then never be resumed in this process. Fix: clear `closePromise` when the close fails so a retry is possible, or drop the writer entry after a bounded failure.
- MINOR: a registration can outlive a close. `abort` can fire after `await this.identities.persist(...)` (l.~356) and before `this.writers.set(sessionId, writer)` (l.~362). `close()` has already run with `registeredThreadId` unset, so the writer is registered with `closed = true` and nothing deletes it. `initialTurnPending` is cleared only at l.~518, so if anything throws between there the entry stays "busy" and blocks every later resume. Fix: re-check `closed` / `abort.signal.aborted` right after the `set`, or set `registeredThreadId` before the awaits.
- MINOR: the registry map is never pruned except by `close()`. A completed lane that is never resumed or closed keeps its entry and closure for the process lifetime. That matches the "kept alive" design, but it is unbounded growth.
- OK (traced): two resumes of one thread. The second sees the reservation, whose `isBusy` is always true, and gets `CodexLaneWriterConflictError`. The reservation is deleted on every `openContext` error branch. The replace-then-close ordering stops the old writer's `close()` from deleting the reservation, because its identity check fails.
- OK: all three hosts (Electron, VS Code, CLI) create one registry per factory, as claimed. The registry is per factory, not per process, which is the right scope.
- Lint rules: I found no `any`, `as unknown as` or `eslint-disable` in the diff. The close-failure `catch` now logs the real Error. Two catches still log a fresh `new Error(...)` that drops the cause, at the late-close `catch(() => ...)`. This predates the batch.
- Tests: the four new specs cover close-once, busy refusal, cross-thread isolation and close failure. I found none for abort during reservation, and none for two concurrent resumes. The concurrent-resume spec is the one that would catch the race described above.

## Batch M (MCP approval) - codex-lane-thread-config.ts, codex-lane-events.ts

- OK: `default_tools_approval_mode: 'approve'` is added only inside `ptahServer`, as a strict zod literal. Disabled user servers still use `{enabled:false}`, so the setting does not loosen anything outside the ptah server. MCP is not stripped or disabled.
- MINOR: approval is now blanket for every Ptah MCP tool, including destructive ones. That is intended when `approval_policy` is `never`, but it should be stated explicitly in the report and the docs.
- OK: a failed tool call with `output == null` now maps to `errorText`, with the fixed fallback 'Tool call failed'. `errorText` is not sanitized and may carry a model- or tool-supplied string. This matches the existing event shape, so I did not escalate it.
- Tests: the `codex-lane-events.spec.ts` cases cover both the error-text path and the fallback path. The thread-config spec covers the new field.

## Batch N (lane completion / peer message)

- MAJOR: `resolvedParentSessions` (agent-process-manager.service.ts l.309, set at l.1967) is unbounded and is cleared only on dispose. It also persists after the tab closes. If a tab id is reused for a new session, any lane spawned before the new session resolves (l.820 and l.1033) is parented to the previous session. Spawn-time lookup applies to every request, not only to Codex. Fix: key the entry by the active tab session lifecycle, remove it on tab or session close, bound it (LRU), or only apply it when the tab has no newer session.
- I did not confirm how a Claude main chat supplies `parentSessionId` to lane spawns. Claude relies on the `resolveParentSessionId` remap that runs after the spawn. The new map is a Codex-only workaround added to a shared path. It should be reconciled with the Claude behaviour before merge.
- MINOR: `SessionId.safeParse(info.parentSessionId?.trim()) ?? null` (lane-completion-outcome.ts l.43) only checks UUID format. Tab ids are UUIDs too, so an unresolved tab id is still persisted as a "parent". It does not distinguish the case it was written for.
- MINOR: native Codex peer rendering (codex-chat-turn-stream.ts l.~256-286). The peer branch has priority over the `clientMessageId` branch. It emits a `message_start` with role user and `inboundPeer`, one `text_delta`, and a `message_complete`, all with source 'complete'. `inboundPeer.label` is `name?.trim() || 'peer session'`. I did not verify this against the Claude transformer output, which comes through `user-message.transformer.ts` / `history-event-factory.ts` and uses `source: 'history'`. Event ids and the `source` field differ, so it needs a side-by-side contract test. The messageId (`codex-peer:...`) and event ids are Codex-specific. If the frontend only reads `inboundPeer` there is no special case; the spec at codex-chat-adapter.spec.ts l.~306 asserts only the label.
- The origin schema is `strict`, so it rejects extra keys. A peer message with an extra field (for example `sentAt`) then fails the whole send with a 'messageOptions' failure. Check that Claude's origin shape cannot carry extra keys.
- Tests: the APM specs assert the spawn-time resolution. None covers tab reuse, a stale mapping, or an overwrite. The recorder spec asserts storage only. None uses non-UUID input.

## Portability
I found no path-separator-dependent assertions in the diffs I read. Not exhaustive.

## Verdict
REVISE. No BLOCKER. MAJOR items to fix: the cached failed close (R) and the unbounded, tab-reuse-stale `resolvedParentSessions` (N). Add the missing specs: concurrent resume, abort during reservation, tab reuse, and a Claude/Codex peer-event contract check.
