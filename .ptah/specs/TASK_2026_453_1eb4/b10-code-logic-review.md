# Code Logic Review — `TASK_2026_453_1eb4` Batch 10

Scope: C7 events read (`libs/backend/agent-sdk`) + C8 history paging RPC
(`libs/backend/rpc-handlers`) + CLI doc (`apps/ptah-cli/docs/jsonrpc-schema.md`)
+ `libs/shared/src/lib/types/rpc.types.ts` registration entries. Reviewed the
uncommitted diff only in these paths; `libs/frontend/chat/**` uncommitted
changes are Batch 12 and are explicitly excluded per instructions.

## Summary

| Metric              | Value                         |
| -------------------- | ------------------------------ |
| Overall score        | 8/10                            |
| Assessment            | APPROVED WITH MINOR             |
| Blocking issues       | 0                                |
| Serious issues        | 0                                |
| Moderate issues       | 1                                |
| Failure modes found   | 2 (both handled correctly)      |

## Five logic questions

### 1. How does this fail silently?

None found that produces a success-looking wrong result. The two absence
paths (`sessionsDir` missing, JSONL file missing/unreadable) both collapse to
`[]` in `readSessionEvents` (`session-history-reader.service.ts:286-300`,
`loadSessionEventData` returns `null` → `loaded?.events ?? []`), and the
caller (`ChatHistoryReadService.readPage`,
`chat-history-read.service.ts:105-113`) turns that empty list into
`HistoryCursorStaleError` via `resolveHistoryCursorEndIndex` (the cursor's
`messageId` cannot be found in an empty array), which the RPC handler maps to
the user-visible `HISTORY_CURSOR_STALE` — not a silent empty-page success.
Verified `resolveHistoryCursorEndIndex` (`libs/shared/.../history-page.utils.ts:81-91`)
throws rather than returning an index for a no-match.

### 2. What user action produces unexpected behaviour?

Requesting `chat:history-page` for a session that has since been fully
compacted past the requested cursor gets `HISTORY_CURSOR_STALE`, which is
correct per the contract, but the doc (`jsonrpc-schema.md`) and the RPC error
message are the only place this is explained to a caller — there is no
distinction surfaced between "stale because the transcript changed" and
"stale because the boundary moved past it" (both map to the same code, which
matches the plan's intent — not a defect, just worth naming since a caller
cannot tell them apart to decide whether retrying makes sense; the doc's
"reopen with chat:resume" guidance covers both cases identically, which is
suffient).

### 3. What input data produces a wrong answer?

Traced `occurrenceFromEnd` end-to-end:
- Sanitizer (`session-rpc.handlers.ts:253-270`) keeps only non-negative
  integers; drops `-1`, `1.5`, `"2"` (string), confirmed against
  `session-rpc.handlers.spec.ts:400-418`.
- Resolver (`session-history-reader.service.ts:793-800`):
  `matches[matches.length - 1 - occurrenceFromEnd] ?? null`. For
  `occurrenceFromEnd = 0` this is the last match (correct "most recent
  duplicate"); for a value large enough to make the index negative, JS array
  indexing with a negative number returns `undefined`, coerced to `null` by
  `??`, which then flows into `resolveNativeMessageId`'s existing
  `if (resolved) return resolved;` / fall-through-to-throw
  (`session-history-reader.service.ts:740-758`) — the "existing throw" the
  plan specifies. This is correct by inspection.
- **Gap**: no test exercises the out-of-range case. `session-history-reader.events-read.spec.ts:143-183`
  covers `occurrenceFromEnd` 0 and 1 (both in range) and legacy `occurrence`
  0/1, but never an out-of-range value (e.g. `occurrenceFromEnd: 99` against
  3 matches) to pin the `null` → throw path. See Moderate issues.

### 4. What happens when a dependency fails?

- `jsonlReader.readJsonlMessages` rejecting (missing/corrupt file): caught in
  `loadSessionEventData`'s try/catch (`session-history-reader.service.ts:321-326`),
  returns `null` → `[]` for the events path; unchanged rethrow-free behaviour
  for `readSessionHistory` (same shared step, same catch). Pinned by
  `session-history-reader.events-read.spec.ts:119-133`.
- `subagentRegistry.getResumableBySession` — read-only, no failure path
  modelled or needed (synchronous in-memory lookup).
- A page-read authorization failure (unauthorized/unsafe workspace) throws
  `RpcUserError` with the exact same message text as `resumeSession`'s
  equivalent checks (verified below), never a raw `error.message`.
- Any error from `readSessionEvents`/`selectHistoryPage` other than the two
  typed cursor errors is not caught in `chat-history-read.service.ts` and
  propagates through `ChatRpcHandlers`'s `wire()` → the generic `error` branch
  in the `chat:history-page` handler (`chat-rpc.handlers.ts:257-268`) just
  does `throw error;` — relying on the shared `runRpc` wrapper (used
  identically by `chat:start`/`chat:continue`, which also just throw) for
  logging/Sentry capture and for stripping the raw message before it reaches
  the client. This is the repo's existing pattern for this file, not a new
  gap introduced by this batch.

### 5. What is missing that the requirements never mentioned?

- No explicit unit test for the out-of-range `occurrenceFromEnd` resolution
  path (see Q3/Moderate below) — the plan's own AC calls this out by name
  ("out of range → null, then the existing throw"), so it is a named
  requirement missed by the spec, not an unstated gap.
- `ChatHistoryReadService`'s own spec (`chat-history-read.service.spec.ts`)
  does not cover the "no workspace folder open" (`WORKSPACE_NOT_OPEN`) or the
  "unsafe workspace path" branches of `readPage` directly — only the
  "unauthorized caller-supplied workspace" branch is asserted
  (`chat-history-read.service.spec.ts:136-149`). Both paths are simple
  guard clauses copied verbatim from the proven `chat-session.service.ts`
  pattern (`rejectIfUnsafeWorkspace`), so the risk is low, but they are
  untested in this new home.

## Failure modes

### Out-of-range `occurrenceFromEnd` — correct by inspection, untested

- Trigger: a fork/rewind `anchorHint.occurrenceFromEnd` larger than the
  number of matching prompts in the loaded window (e.g. a stale client-side
  count after a tab was reloaded with fewer visible duplicates).
- Symptom: `SdkError` "not found in session history" surfaces to
  `session:forkSession` / `session:rewindFiles` callers — same error shape as
  today's "text hint had zero matches" case.
- Evidence: `session-history-reader.service.ts:793-800` (resolution),
  `:755-758` (throw); no test in
  `session-history-reader.events-read.spec.ts` exercises an out-of-range
  value.
- Current handling: correct (negative array index → `undefined` → `null` →
  existing throw).
- Recommendation: add one case to `events-read.spec.ts`
  (`occurrenceFromEnd: 99` against 3 matches) asserting the throw, to pin the
  behaviour the AC named.

### Empty/absent transcript feeding an older-page request

- Trigger: `chat:history-page` called for a session whose JSONL directory or
  file is gone (deleted externally, moved workspace).
- Symptom: `HISTORY_CURSOR_STALE` to the client (never a raw filesystem
  error, never a false "empty page" success).
- Evidence: `session-history-reader.service.ts:286-300` (`[]` return),
  `history-page.utils.ts:81-91` (`resolveHistoryCursorEndIndex` throws
  `HistoryCursorStaleError` on no match), `chat-rpc.handlers.ts:257-268`
  (mapped to `HISTORY_CURSOR_STALE`).
- Current handling: correct, matches the plan's "Missing directory/file → []
  (which the page read turns into stale)".
- Recommendation: none; already covered by
  `chat-history-read.service.spec.ts` implicitly through the shared utility's
  own spec (`history-page.utils.spec.ts`, C6, out of this batch's scope).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **Moderate** — Out-of-range `occurrenceFromEnd` resolution has no pinning
  test, though the AC explicitly names it ("out of range → null, then the
  existing throw"). `libs/backend/agent-sdk/src/lib/session-history-reader.events-read.spec.ts:143-183`.
- **Minor** — `readSessionHistory`'s "session file not found" warn log lost
  its `[SessionHistoryReader]` prefix when the load step was shared
  (`session-history-reader.service.ts:326`, was
  `'[SessionHistoryReader] Session file not found'`). The existing spec still
  passes because it asserts `stringContaining`
  (`session-history-reader.service.spec.ts:276`), so this is not
  byte-identical despite AC 2's claim, though it has no behavioural effect —
  purely a log-message diff a future grep-by-prefix could miss.
- **Minor** — `chat-history-read.service.spec.ts` does not directly cover
  `readPage`'s `WORKSPACE_NOT_OPEN` and unsafe-workspace-path branches (only
  the unauthorized-caller-supplied-workspace branch is asserted). Both are
  copy-verified against `chat-session.service.ts`'s proven
  `rejectIfUnsafeWorkspace`/inline checks, so risk is low, not absent.

## Data flow

1. `chat:history-page` request arrives → `ChatHistoryPageParamsSchema.parse`
   (strict; rejects unknown keys, `maxEvents` outside 1..2000, cursor > 4096
   chars) — OK, pinned by `chat-session-history-page.spec.ts:240-247`.
2. `ChatHistoryReadService.readPage` authorizes the workspace (three guards:
   no-folder-open, caller-supplied-unauthorized, unsafe-path) with the exact
   message text used by `resumeSession`'s equivalent guards — OK by
   inspection (`chat-history-read.service.ts:71-97` vs
   `chat-session.service.ts:779-801`), partially pinned by tests (see minor
   issue above).
3. Resolves the working directory via the moved `resolveResumeWorkingDirectory`
   (now private to `ChatHistoryReadService`, deleted from
   `chat-session.service.ts`) — OK, single copy confirmed by grep (no
   remaining definition in `chat-session.service.ts`), reused for both
   `readForResume` and `readPage`.
4. Calls `SessionHistoryReaderService.readSessionEvents` — OK, never
   `readSessionHistory`, confirmed both by reading `chat-history-read.service.ts:105-108`
   and by the negative assertion in
   `chat-history-read.service.spec.ts:133` /
   `chat-session-history-page.spec.ts` (`registerFromHistoryEvents` receiving
   the full array is the resume-path proof, not the page path, but the page
   path's own spec explicitly asserts `readSessionHistory` was never called).
5. `resolveHistoryCursorEndIndex` decodes and locates the cursor (throws
   invalid/stale as appropriate) → `selectHistoryPage` slices on whole-turn
   boundaries → `getResumableBySession` attaches interrupted-agent markers —
   OK, side-effect-free per AC (no compaction registry, no pricing, no usage
   aggregation touched — confirmed by the negative spies in
   `session-history-reader.events-read.spec.ts:91-116`).
6. Errors surface through `ChatRpcHandlers`'s `wire()` catch, mapping the two
   typed errors to `HISTORY_CURSOR_STALE` / `INVALID_PARAMS`, anything else
   rethrown — OK, pinned by `chat-session-history-page.spec.ts:202-226`.
7. `resumeSession` (unchanged entry, extended reply): full events still feed
   `registerFromHistoryEvents` and `stats`
   (`chat-session.service.ts:826-887`, unsliced), slicing happens only when
   building the reply (`:929-940`) — OK, pinned by
   `chat-session-history-page.spec.ts:158-177`, and the "no `historyPage` key
   when omitted" case is pinned by `:139-156`.
8. Three registration sites (`ChatRpcHandlers.METHODS`, `RpcMethodRegistry`,
   `RPC_METHOD_ENTRIES`) all carry `chat:history-page` — OK, confirmed by
   direct read of `libs/shared/src/lib/types/rpc.types.ts:648`, `:3380` and
   `chat-rpc.handlers.ts:98`. `ALLOWED_METHOD_PREFIXES`
   (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:46`) has no diff
   and already carries the `'chat:'` prefix — OK, no runtime-guard gap.
9. CLI doc (`jsonrpc-schema.md:473-503`) — OK, matches the implemented
   contract: opt-in `historyPage` on resume, full-history default, opaque
   cursor, whole-turn pages, compaction-boundary stop, `HISTORY_CURSOR_STALE`
   → reopen guidance, `session.history` / `session resume` explicitly stated
   unchanged, no new CLI verb.

## Requirements fulfilment

| Requirement                                                                 | Status   | Gap                                                             |
| ---------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| C7 `readSessionEvents` shares load step, no side effects                     | COMPLETE | none                                                              |
| C7 `readSessionHistory` behaviour unchanged                                  | COMPLETE | log-message prefix drift (minor, non-behavioural)                 |
| C7 `occurrenceFromEnd` resolution incl. out-of-range                         | COMPLETE | logic correct; out-of-range case untested (moderate)              |
| C7 file stays within ~+40 lines, no page selection                          | COMPLETE | +39 lines, confirmed                                              |
| C8 `resolveResumeWorkingDirectory` moved not copied                          | COMPLETE | confirmed single definition                                       |
| C8 `readPage` authorization parity with resume                              | COMPLETE | message text and guard order match; partially untested (minor)    |
| C8 `readPage` never calls `readSessionHistory`                              | COMPLETE | confirmed by spec and by reading the method body                  |
| C8 resume passes full events to registry/stats, slices only the reply       | COMPLETE | confirmed by spec and by reading the method body                  |
| C8 three registration sites, no `ALLOWED_METHOD_PREFIXES` diff              | COMPLETE | confirmed                                                          |
| C8 stale/invalid cursor mapping, no raw `error.message`                     | COMPLETE | confirmed                                                          |
| C8 V1 `sanitizeAnchorHint`                                                  | COMPLETE | confirmed against spec cases 0/1/-1/1.5/"2"/legacy                 |
| C8 Zod `.strict()`, `maxEvents` 1..2000, cursor max length                  | COMPLETE | confirmed                                                          |
| CLI doc accuracy                                                            | COMPLETE | none                                                               |

Implicit requirements not addressed: none found beyond the test-coverage gaps
already listed as moderate/minor issues.

## Edge cases

| Case                                                        | Handled | How                                                              | Concern                                   |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Missing sessions directory                                    | YES     | `[]` from `readSessionEvents` → stale cursor error                  | none                                          |
| Missing/unreadable JSONL file                                  | YES     | same as above via try/catch                                          | none                                          |
| Invalid session id                                             | YES     | `validateSessionId` throws `SdkError` before any I/O                 | none                                          |
| Out-of-range `occurrenceFromEnd`                                | YES     | negative index → `null` → existing throw                             | untested (moderate)                          |
| `maxEvents` 0 / 2001 / unknown keys / 4097-char cursor          | YES     | Zod `.strict()` rejects                                              | none                                          |
| Resume without `historyPage`                                   | YES     | full events, no `historyPage` key in reply                           | none                                          |
| Resume with `historyPage`                                       | YES     | tail slice + `olderCursor`, full events still registered/stat'd      | none                                          |
| Unauthorized caller-supplied workspace on `chat:history-page`   | YES     | same message/behaviour as resume                                     | none                                          |
| No workspace open / unsafe workspace path on `chat:history-page`| YES (by code) | same guard clauses as resume                                    | not directly spec-covered in the new service |
| Attachment guard on page read                                   | YES     | explicitly not applied, asserted by spec                             | none                                          |

## Verdict

- Recommendation: APPROVE (minor follow-ups, non-blocking)
- Confidence: HIGH
- Top risk: the untested out-of-range `occurrenceFromEnd` path is correct by
  code inspection but has no regression test, so a future refactor of the
  resolver could silently break it without a failing test to catch it.
- What a robust implementation would add: one spec case for out-of-range
  `occurrenceFromEnd`; direct `readPage` coverage for the `WORKSPACE_NOT_OPEN`
  and unsafe-workspace-path branches in `chat-history-read.service.spec.ts`;
  restore the `[SessionHistoryReader]` log prefix in the shared
  `loadSessionEventData` catch block for consistency with the sibling warn a
  few lines above it.
