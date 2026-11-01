# Review 8r-4

Verdict: APPROVE

Score: 9/10

Review family: grok (implementer: codex)

## Members checked

Compared `git diff HEAD` for `codex-chat-adapter.ts` with `codex-chat-session-controls.ts`. Each body matches HEAD after `this.sessions` / `this.opening` / `this.ports` / `this.session` / `this.unsupported` / `this.failure` / `this.safe` become `this.deps.*`. Adapter methods are one-line returns of the controls promise or value.

| Member | Identical | Note |
| --- | --- | --- |
| close | yes | Sync map delete, `closed`, flag clears, `endTurn`, `abort`, `dispose`, then `safe('close')` which awaits `context.close()` before `scope.dispose()` in `finally`. Early return if `session.closing` is set. `codex-chat-session-controls.ts:87-106`, delegate `codex-chat-adapter.ts:593-595`. |
| interruptCurrentTurn | yes | No-turn path sets `pendingInterrupt` and `blocked` from `busy` and returns before any await. With a turn, `blocked = true` happens before `safe('interrupt')`; `blocked` clears only when accepted. `:107-121`, delegate `:596-598`. |
| interruptSession | yes | Opening cancel returns before session lookup. `stopRequested = true` before the interrupt await. Refusal logs the same warn payload, then awaits close. Catch awaits close and rethrows the same error. `:122-144`, delegate `:599-601`. |
| executeSlashCommand | yes | Non-`/compact` throws `unsupported('slashCommand')` before session lookup. Busy throws `CodexChatAdapterError('busy', 'compact')`. In-flight compact is coalesced with the same `finally` clear. Empty async iterable after await. The third `config` argument stays ignored, as on HEAD. `:145-158`, delegate `:602-606`. |
| compact | yes | Private. `notifyCompaction(session, 'manual')` runs before `safe('compact')`. Callback `.error('Codex context compaction failed.')` is awaited, then the original error is rethrown. Completion event is published only after success. `:160-184`. |
| setSessionPermissionLevel | yes | Alias check throws before session lookup. Closed context still becomes `CodexChatAdapterError('unavailable', 'permission', { cause })`. Settings spread runs only after the await. `:186-206`, delegate `:607-611`. |
| setSessionModel | yes | Await `updateNextTurn({ model })`, then settings spread. `:207-215`, delegate `:612-616`. |
| setSessionEffort | yes | Await `updateNextTurn({ effort })`, then settings spread. `undefined` effort is forwarded. `:216-224`, delegate `:617-621`. |
| notifyCompaction | yes | Same debug string and early return when `lastRequestTotalTokens` is missing. Start callback is read at call time via `compactionStart: () => this.compactionStart`. `:35-49`, delegate `:520-522`. |
| owns | yes | `sessions.has` or `opening.has`, shared maps. `:51-53`, delegate `:569-571`. |
| isSessionActive | yes | `sessions.has` or `opening.get(id)?.cancelled === false`. `:54-56`, delegate `:572-574`. |
| canSendFollowUp | yes | Same busy / blocked / closing conjunction. `:57-60`, delegate `:575-577`. |
| getSessionToken | yes | `sessions.get(id)?.token ?? null`. `:61-63`, delegate `:578-580`. |
| endSession | yes | Sets `opening.cancelled` before starting close. `void close().catch` still calls `failure(error, 'cleanup')` then `callbacks(id, undefined).error(...)`. Sync close mutations finish before `endSession` returns. `:64-75`, delegate `:581-583`. |
| closeSession | yes | Cancel opening, then await close only when a session is mapped. `:77-82`, delegate `:584-586`. |
| endSessionIfTokenMatches | yes | Still ignores both arguments and resolves `false` with no side effects. `:84-86`, delegate `:587-592`. |

## Defects

None.

## Notes

- Construction order is safe. `sessions` and `opening` are field-initialized at `codex-chat-adapter.ts:132-133` before the constructor body assigns `controls` at `:152-163`. `ports` is a parameter property. The dependency arrows do not run during construction. `compactionStart` is still undefined until `setCompactionStartCallback` (`:632-636`); the controls getter reads the field when compaction actually starts.
- `close` and `interruptCurrentTurn` inside `interruptSession`, `endSession`, and `closeSession` go through adapter arrows (`:160-161`), then the one-line delegates, then the controls implementation. That is one hop. `CodexChatSessionControls.close` does not call `deps.close`, so there is no cycle. Turn-stream arrows at `:538-540` still call the adapter methods at event time, so they see the current `compactionStart` and the live session maps.
- Session maps and `ports` are passed by reference (`:153-155`). `deps.session`, `deps.unsupported`, `deps.failure`, and `deps.safe` are arrows, so `this` stays the adapter and `failure` / `safe` keep HEAD's error mapping and logger text.
- Public names, parameter types, and return types on `CodexChatAdapter` match HEAD. Promise-returning delegates dropped the `async` keyword and return the controls promise directly, so synchronous throws inside those `async` controls methods stay rejections and there is no extra wrapper. `private close` stays private. `compact` is private on the new class and is only reached from `executeSlashCommand`.
- `libs/backend/agent-sdk/src/index.ts:161-167` exports `CodexChatAdapter` and its port types only. `CodexChatSessionControls` and `TrackedSession` are not on that surface. The lib's `export *` barrels do not include `codex-app-server`. The controls file imports `CodexChatAdapterPorts` as `import type`, so the adapter/controls edge is erased at runtime.
- Both files have no `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, `console`, or bracket access to private members.
- HEAD's block comment on `endSessionIfTokenMatches` (why the method must not close the native thread, and why `false` clears broadcaster turn state) was not moved. Behavior is unchanged. The comment is the reason this stub exists; it should be restored above `codex-chat-session-controls.ts:83` or the adapter delegate at `:587`. That is why the score is 9 rather than 10.
- `codex-chat-adapter.spec.ts` is not in the diff. Runtime, typecheck, and lint were not run; this lane forbids them.
- The bundled `review` skill is a subagent workflow with a different deliverable. This lane forbids extra agents and prescribes this file, so that skill was not launched.
- `ptah_agent_report` was not called: the connected MCP server is `tasks`, and tool search found no `ptah` server and no `ptah_agent_report`.
