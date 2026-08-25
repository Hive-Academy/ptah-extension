# Context

## The observed error

From the Electron log:

```
[ERROR] [SessionHistoryReader] Failed to read history as messages _SdkError: Invalid sessionId format:
    at SessionHistoryReaderService.validateSessionId
    at SessionHistoryReaderService.readHistoryMessages
    at SessionHistoryReaderService.readHistoryForCuration
    at SdkTranscriptReaderAdapter.read
    at CompactionCallbackRegistry.notifyAll
    at PreCompact.hooks
    at RU.handleHookCallbacks (@anthropic-ai/claude-agent-sdk)
[DEBUG] [CompactionHookHandler] PreCompact processed successfully: {"sessionId":""}
```

Note the message ends at `format:` with nothing after it, and the debug line
immediately below prints the empty id. The session id is `''`.

## Root cause

> **Correction (2026-08-19, TASK_2026_295 sweep).** The paragraph originally
> here blamed `sdk-query-options-builder.ts:1198` — `createHooks(sessionId ?? '',
…)` — on the theory that a NEW chat session has no id at options-build time.
> **That was wrong.** `SdkQueryOptionsBuilder.build` has exactly one caller,
> `session-query-executor.service.ts:245`, and it always passes a non-empty
> string: `sdk-agent-adapter.ts:460` sets `const trackingId = tabId as SessionId`.
> On the chat path the closure holds a **tabId**, never `''`. That coercion is
> defensive, not a producer.
>
> The `''` in the reported log came from a different call site:
> `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts:152`
> passes a **hardcoded literal** `''` for every Ptah-CLI-spawned agent. The
> reporter was running a tribunal relay, which spawns exactly those.
>
> Two consequences the original write-up missed, both now owned by TASK_2026_295:
>
> 1. The fix below is still correct and still required, but on that Ptah-CLI path
>    it converts a **loud** failure into a **silent** one — with a hardcoded `''`
>    closure and no `session_id` in the payload, the compaction fan-out is now
>    skipped quietly. The real repair is threading a real parent id into `:152`.
> 2. Because the chat-path closure is a **tabId** rather than the canonical SDK
>    UUID, handlers that fall back to the closure report a tabId while payloads
>    that carry `session_id` report the UUID — two identities for one session.
>
> The mechanism described below (payload-first resolution) is unchanged and
> correct. Only the account of where `''` originates was wrong.

### Most other handlers compensate; PreCompact doesn't

> **Correction (2026-08-19).** This section originally read "Every other handler
> already compensates". The TASK_2026_295 sweep showed that is not true. Twelve
> handlers resolve payload-first, but only five of them then **reject** the
> resulting `''`: `stop`, `stop-failure`, `subagent-stop`, `teammate-lifecycle`
> and (after this task) `compaction`. The other seven — `post-tool-use`,
> `pre-tool-use`, `session-end`, `session-start`, `tool-failure`,
> `user-prompt-submit`, `user-prompt-expansion` — resolve and then fan `''`
> into their callback registries. That is latent rather than live only because
> the downstream memory and skill triggers happen to guard it, and it is one new
> subscriber away from being live. Owned by TASK_2026_295.
>
> The guideline line added to `libs/backend/agent-sdk/CLAUDE.md` by this task
> inherited the same overstatement and is corrected there.

The builder passes `sessionId ?? ''` to thirteen handlers. Twelve of them open
with the same idiom — `pre-tool-use`, `post-tool-use`, `stop`, `stop-failure`,
`session-start`, `session-end`, `subagent-stop`, `tool-failure`,
`user-prompt-submit`, `user-prompt-expansion`, `teammate-lifecycle`:

```ts
const resolved = typeof input.session_id === 'string' && input.session_id.length > 0 ? input.session_id : sessionId;
```

`PostCompact`, in the _same file_ as the bug, does a weaker version of the same
thing (`compaction-hook-handler.ts:284`):

```ts
const resolvedSessionId = input.session_id ?? sessionId;
const resolvedCwd = input.cwd ?? cwd;
if (!resolvedSessionId || !resolvedCwd) {
  /* warn and skip */
}
```

`PreCompact` (`compaction-hook-handler.ts:138-243`) uses the raw closure
`sessionId` in six places and never looks at `input.session_id`:

- `usageTracker.getCumulativeTokens(sessionId)` — an empty key, so `preTokens`
  is whatever that returns for an unknown session (0), not the real
  pre-compaction total the frontend freezes its header stats on
- `callbackRegistry.notifyAll({ sessionId, ... })` — the fanout that breaks
- the `capturedCallback` payload — the `session:compacting` UI notification
- three log statements

The SDK does supply it. `PreCompactHookInput = BaseHookInput & {...}` and
`BaseHookInput` declares `session_id: string`, `transcript_path: string`,
`cwd: string` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:156, 2081`).

### What the empty id costs

`MemoryCuratorService.start()`
(`libs/backend/memory-curator/src/lib/memory-curator.service.ts:93-120`)
subscribes to the registry and does:

```ts
transcript = await this.transcriptReader.read(data.sessionId, cwd);
...
if (!transcript) {
  this.logger.warn('[memory-curator] PreCompact transcript unavailable — falling back to placeholder');
  return this.curate({ sessionId: data.sessionId });
}
```

`SdkTranscriptReaderAdapter.read` → `readHistoryForCuration` →
`readHistoryMessages` → `validateSessionId` throws `SdkError`, which
`readHistoryMessages`' own catch logs at ERROR and converts to `[]`
(`session-history-reader.service.ts:309-315`). The adapter's `catch` never
runs; it just gets an empty array and returns `''`.

So the curator takes the placeholder branch with an empty sessionId. **The
compaction event whose entire purpose is to feed tiered memory feeds it
nothing** — and the only symptom is a stack trace that looks like a read
failure rather than a curation miss.

## Secondary observation (worth fixing in the same pass)

`readHistoryMessages` logs an invalid-input rejection at `logger.error` with a
full stack, then swallows it and returns `[]`. Every caller treats `[]` as a
soft miss. An ERROR-with-stack that no one treats as an error is how a real
read failure gets ignored later. Either log the validation rejection at `warn`
with the offending value, or let it propagate and have callers decide — but not
both. Sibling failure modes in the same method already use `warn` ("Sessions
directory not found", "Session file not found").

## Proposed fix

1. In `CompactionHookHandler.createHooks`, resolve the id once at the top of
   the PreCompact callback, using the same idiom as the twelve other handlers:

   ```ts
   const resolvedSessionId = typeof input.session_id === 'string' && input.session_id.length > 0 ? input.session_id : sessionId;
   const resolvedCwd = input.cwd ?? cwd;
   ```

   Use `resolvedSessionId` for the usage-tracker sample, the registry fanout,
   the captured callback and the logs.

2. Guard the fanout the way PostCompact does: if there is still no id after
   resolution, `warn` and skip the notify rather than publishing `''` to every
   subscriber.
3. Downgrade the `validateSessionId` rejection path in `readHistoryMessages` to
   a warning that names the bad value, consistent with the other soft misses in
   that method.
4. Consider deleting the `sessionId ?? ''` coercions in
   `sdk-query-options-builder.ts` in favour of passing `sessionId` through as
   `string | undefined`. `''` is not a session id, and turning "unknown" into
   "empty string" is what let this reach a path-traversal validator in the
   first place. Larger change — separate batch if it fans out.

## Acceptance criteria

- A new (non-resumed) session that auto-compacts produces no
  `Invalid sessionId format` error, and the curator receives the SDK's real
  session id.
- Memory curation on that compaction reads a real transcript instead of taking
  the placeholder branch.
- `preTokens` on the `session:compacting` notification is the real
  pre-compaction cumulative total, not the unknown-session value.
- A spec pins PreCompact preferring `input.session_id` over an empty closure
  id, mirroring the existing PostCompact spec.
- A spec pins the "no id from either source" case: warn, skip the fanout, still
  return `{ continue: true }` (the hook must never block the SDK).

## Files touched (expected)

| Path                                                                     | Why                                            |
| ------------------------------------------------------------------------ | ---------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.ts`      | the fix — PreCompact id/cwd resolution + guard |
| `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts` | new specs                                      |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`       | validation-rejection log level                 |
| `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`    | item 4, if taken                               |

---

# Outcome

## What was changed

**`compaction-hook-handler.ts`** — two module-private resolvers,
`resolveHookSessionId` and `resolveHookCwd`, encoding one precedence rule:
payload wins, empty from either source means absent. Both compaction hooks now
use them.

- PreCompact resolves the id once, up front, and uses it for all four consumers
  that previously read the closure: `usageTracker.getCumulativeTokens`, the
  registry fanout, the captured UI callback, and the logs.
- When neither source yields an id, PreCompact now warns and skips the fanout
  entirely, still returning `{ continue: true }` — the hook must never block the
  SDK. Publishing `''` is strictly worse than publishing nothing: it is what
  reached the curator's transcript reader as a path-traversal rejection.
- PostCompact was moved onto the same resolvers. Its old `input.session_id ??
sessionId` had the same latent bug in mirror image — an empty-string
  `session_id` in the payload is not nullish, so it would have beaten a
  perfectly good closure id. Pinned by a new spec.

**`session-history-reader.service.ts`** — `validateSessionId` now delegates to a
non-throwing `isValidSessionId` predicate. `readHistoryMessages` checks that
predicate _before_ the try block and returns `[]` with a `warn` naming the bad
value, so a malformed id no longer arrives as an ERROR-with-stack that every
caller then treats as a soft miss. Genuine read failures still hit the ERROR
catch. The two throwing callers (`readSessionHistory`, `resolveNativeMessageId`)
are unchanged — they still want the `SdkError`.

## What was deliberately NOT changed

**Item 4 — the thirteen `sessionId ?? ''` coercions in
`sdk-query-options-builder.ts:1197-1244` — was dropped, not deferred.**

The audit that motivated it came back the other way: of the thirteen handlers
fed that coercion, _every one_ already resolves `input.session_id` first —
eleven with the exact `typeof … && .length > 0` idiom, `subagent-hook-handler`
and `worktree-hook-handler` by reading the payload directly and never consulting
the closure at all. PreCompact was the sole gap, and it is now closed.

Widening the parameter to `string | undefined` would therefore touch thirteen
files and thirteen signatures to produce no behavioural change anywhere. The
real invariant — _the payload is the source of truth, the closure is a fallback_
— now lives at the thirteen places that consume it, which is where a future
handler author will look. It is recorded as a lib guideline instead.

## Verification

| Check                              | Result                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `jest libs/backend/agent-sdk`      | 72 suites, 961 tests passed                                             |
| `jest libs/backend/memory-curator` | 20 suites, 314 tests passed (4 suites / 55 tests skipped, pre-existing) |
| `nx run agent-sdk:typecheck`       | passed                                                                  |
| `nx run agent-sdk:lint`            | 0 errors; 38 pre-existing warnings, none in the touched files           |

New specs (6):

- PreCompact prefers `input.session_id` over an empty closure id, and samples
  `preTokens` under the real id — the assertion is explicitly
  `not.toHaveBeenCalledWith('')`, since the old code's silent damage was a
  plausible-looking `preTokens: 0`.
- PreCompact falls back to the closure id when the payload carries none (the
  resumed-session path, which must keep working).
- PreCompact treats an empty payload `session_id` / `cwd` as absent.
- PreCompact with no id from either source: no fanout, no callback, warn,
  `{ continue: true }`.
- PostCompact treats an empty payload `session_id` as absent rather than letting
  it beat the closure id.
- `readHistoryForCuration('')` warns naming the value and does not call
  `logger.error`.

**Not verified at runtime.** The acceptance criterion "a new session that
auto-compacts produces no `Invalid sessionId format`" needs a live Electron
session driven past its compaction threshold. The unit specs pin the logic;
the end-to-end confirmation is outstanding, which is why this sits in
`in_review` rather than `done`.
