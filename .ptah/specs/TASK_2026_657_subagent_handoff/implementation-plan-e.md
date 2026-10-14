# Implementation Plan E (revision 3) - TASK_2026_657 (file-backed subagent handoff)

Worktree `D:\projects\ptah-extension\.claude-worktrees\fix-subagent-handoff-notice` (head 74347fc75);
paths relative to it. `C/` = `libs/backend/agent-sdk/src/lib/helpers/compaction/`, `H/` =
`libs/backend/agent-sdk/src/lib/helpers/`. Inputs: `decisions.md` (D1-D6 and "revision 3
decisions", applied here), `plan-review-e.md` 1-12, `plan-review-e-r2.md`, revision 2 (unchanged
parts kept). Out of scope: `compaction.subagentAutoStop`, UI, `.codex/agents/*.toml`. Missing
decision-critical input: none.

## Codebase evidence

| Evidence | Location | Implication |
| --- | --- | --- |
| Stop order: task id → `stopSubagent` → live check → `prepareHandoffFiles` → `handoffMessage` → `deliverHandoff` | `C/subagent-budget-monitor.ts:775-884` | Reorder: files, text, record before `stopSubagent` |
| `stopInFlight` only around `stopSubagent`; observe skips while set | `:791-802`, `:392-394` | Widen over prep + write |
| Failed request's content blocks do not retry; `MAX_STOP_ATTEMPTS = 3`, give-up sets `stopFired`; reason `handoff` before `safety` | `:395-401,928`; `:138,916-947`; `:403-410` | Same gate for a failed write; give-up keeps the record; `recordGaveUp` suppresses only `handoff` |
| `stopSubagent` throws `SESSION_NOT_FOUND` before `stopTask`; any `stopTask` rejection → `TASK_NOT_FOUND` | `H/subagent-message-dispatcher.ts:298-327` | A rejection does not prove "not stopped" (B1) |
| Two stops of one tool id can run across a rekey; the later returns on `stopFired`; registry keyed by tool id alone; `aliases` from→to, `currentSessionId`, `release` drops aliases | `:520-558,808-813`; `:775`; `:520-604` | One record per tool id (S5); alias set = id + aliases resolving to it |
| Monitor session id = SDK `session_id`; release at every stream teardown | `H/session-lifecycle/session-query-executor.service.ts:329-337,351-390` | Same id space as the hook; released owners become foreign |
| Hook `agent_id` absent on main thread; `additionalContext`; payload-first id; early return on empty registry; optional monitor injection | `sdk.d.ts:181-187,9394-9407` (main checkout SDK); `H/hook-session-resolver.ts:48-53`; `H/user-prompt-submit-hook-handler.ts:40-42`; `H/compaction-hook-handler.ts:152-161` | Main-thread gate; pointer independent of the registry |
| Monitor factory + `workspaceOf` | `libs/backend/agent-sdk/src/lib/di/register.ts:495-536`; `H/session-lifecycle-manager.ts:573-575` | Store + index built there |
| `SUBAGENT_HANDOFF_DIR`, timeout, sanitiser `[^A-Za-z0-9_-]`→`_`, race | `C/subagent-handoff-files.ts:29,40,65-66,111-136` | Reuse; extract race |
| Pending-record machinery; push `SEND_TIMEOUT` policy; notice cap 2 000 chars | `C/subagent-handoff-delivery.ts:53,72-114,189-343`; `:346-383`; `H/main-thread-notice-queue.ts:30` | Delete; keep push; record path on text line 2 |
| Shared agent text; agent and skill copies | `libs/shared/src/lib/types/task-spec.contract.ts:516-522,538,564`; `.claude/agents/*.md` line 12 (11 in 3); both `orchestration/SKILL.md:119-128` | Convention edits |
| `.ptah/**` ignored except `.ptah/specs/**` | `.gitignore:135-139` | Records host-only; stubs visible |

## Architecture decision

- Chosen: D1-D6 as in revision 2, plus owner in the file name (S1/S2), a bounded rotating pointer
  (B3/M2), takeover text for foreign records (S3), one record per tool id (S5).
- Rejected: owner in frontmatter (an edit could broadcast it); cross-process liveness; a persisted
  pending index (multi-writer races); handle-safe directory primitives (S4; Node has no `openat`).
- Effect: delivery shrinks to post/send/push; `MainThreadNoticeQueue`, `register.ts:523-524`,
  `.task.md`/notes files unchanged.

### Guarantees (and documented limits)

1. A handoff (context) stop runs only after its record is on disk (D2).
2. **Safety-stop limit (B2, user decision):** "A safety (cost) stop does not wait for a durable
   record: when its record write fails, the handoff travels only through the in-memory send, so it
   is lost only if both the disk write and that send fail." The same sentence goes verbatim into the
   `SubagentBudgetMonitor` class doc comment.
3. Once `stopSubagent` was called with a record, the host never deletes that record (B1).
4. After the index loads, each pending record visible to a session is named within `ceil(C/10)` of
   that session's prompts (`C` = its candidates); every prompt reads at least one head (B3).
5. Not guaranteed: liveness across processes (S3; foreign records carry takeover text); containment
   against a concurrent ancestor-directory swap (S4: the workspace filesystem is trusted local
   state, as for today's writes at `subagent-handoff-files.ts:69-72`); reader/cleanup overlap on a
   resolved record older than 7 days (M1, accepted; only `consumed`/`dismissed` are ever deleted).

### Deviations (decision vs code fact, smallest change)

1. **Withdraw scope (B1).** The monitor sees `dispatcher.stopSubagent`, not `stopTask`; "invoked" =
   `stopSubagent` called. `SESSION_NOT_FOUND` (`H/subagent-message-dispatcher.ts:299-312`) proves non-invocation but is
   still treated as invoked (conservative; the record text says to dismiss). Withdraw only when it
   was never called: late write after timeout, release during prep/write, or `stopFired` before the
   call with no other invocation of the same record.
2. **Publish at invocation (B1).** The index learns the record once `stopSubagent` returns or
   rejects: an ambiguous stop may end the subagent, so no later message drives a retry.
3. **One record per tool-use id (S5).** Two stops can reserve before `rekey` merges their sessions
   (`:520-558`), while alias sets are still disjoint; so the writer map is keyed by tool-use id
   alone, as the registry is (`:775`). Assumption: SDK tool-use ids are unique per subagent across
   sessions; the implementer confirms against `rekey`'s merge by tool id.
4. **Cursor per process, per workspace, per prompting session (B3).** One shared cursor lets one
   session's prompts move past records hidden from it but visible to another.

### Record name grammar and parsers (S1, S2)

- Name `<time>-<owner16>-<tool>-<nonce8>.handoff.md` in `<ws>/.ptah/subagent-handoffs/`:
  `time` = `new Date(now).toISOString()` minus `-`, `:`, `.` (`yyyyMMddTHHmmssSSSZ`); `owner16` =
  first 16 lowercase hex of `sha256(utf8(session id at stop))`; `tool` = tool-use id through the
  `:65` sanitiser, cut to 64 (no `[A-Za-z0-9]` → no path); `nonce8` = `randomBytes(4)` hex
  (injectable). Flag `wx`, written once; `EEXIST` = write failure.
- `parseRecordName(name)` (pure): `/^(\d{8}T\d{9}Z)-([0-9a-f]{16})-([A-Za-z0-9_-]{1,64})-([0-9a-f]{8})\.handoff\.md$/`
  → `{time, owner, tool, nonce}`; fixed-width fields keep `tool` unambiguous. No match → ignored.
- Content: `---\nstatus: pending\n---\n`, then "Ptah subagent handoff record. If its subagent is still
  running or finished normally, set `status: dismissed`.", then the full `handoffMessage` text.
- `parseRecordHead(head)` (first 2 048 bytes): byte 0 is `---` + `\n`|`\r\n`; a closing `---` line
  inside the head; each line between is `key: value`; `status` exactly once in
  `pending|consumed|dismissed`; other keys ignored. Else `malformed` = pending, listed with
  " (frontmatter unreadable)", never deleted. Audience never comes from the head.

### D2 bounds (record before the handoff stop)

- `SubagentState` gains `prepared?: {recordPath?: string; handoff: Handoff}`, `recordFailures`,
  `recordGaveUp`; `failedStopMessageId` → `failedAttemptMessageId` (failed stop or write).
- `MAX_RECORD_ATTEMPTS = 3`, one per subagent request (`:395-401` gate). Failure = no workspace,
  guard refusal, write error, `EEXIST`, or the 5 s timeout (late completion unlinks).
- Exhausted (`handoff`): `recordGaveUp = true`, one warn "Handoff record not saved after 3 attempts;
  subagent left running, no handoff" (ids, `errorType`, `errorCode`); then only `safety` applies.
- `safety`: one write per stop attempt; on failure stop without a path, warn "Safety stop without a
  durable record". Stop retries reuse `prepared` or the writer-map entry (no second write).
- Release during prep/write → withdraw, no stop. Release during/after `stopSubagent` → kept,
  published, no delivery. Give-up → kept, warn "Stopping the subagent failed; giving up, record kept".

## Component specifications

### 1. Handoff record store (CREATE `C/subagent-handoff-record.ts`)

- API: `writeOnce(sessionId, toolCallId, text)` → `Promise<{ok:true, path} | {ok:false, errorType,
  errorCode?}>`; `markInvoked(toolCallId)`; `withdraw(toolCallId, path)` (no-op once invoked);
  `forget(sessionIds)`; `writeStub(prompt, agentType, nonce8, recordPath)`; pure `renderRecord`,
  `parseRecordName`, `parseRecordHead`, `ownerHash(id)`, `taskFolderOf(prompt)` (revision 1 rule).
- Writer map (S5): `Map<toolCallId, {sessionId, path, write, invoked}>`, set before the first
  `await`, so a concurrent stop shares the promise and path; removed on failed write, `withdraw`,
  or `forget` with the released alias set.
- Host-dir guard (write and scan): `mkdir` recursive; `lstat` of `<ws>/.ptah` and the dir are
  directories, not links; `realpath(dir)` inside `realpath(ws)` (win32 case-insensitive). Stub guard
  (D6): `realpath(folder)` a direct child of `realpath(<ws>/.ptah/specs)`; no link among `.ptah`,
  `specs`, folder; name `subagent-handoff-<type>-<nonce8>.md`, `wx`; failure → debug log.
- Dependencies: `fs/promises`, `path`, `crypto`, `Logger`; `workspaceOf`, clock, nonce injected; no
  DI token (`register.ts:506-512` pattern). Never throws; logs ids/`errorType`/`errorCode` only.
  Seam: `C/subagent-handoff-record.spec.ts` (temp dir).

### 2. Handoff index and pointer (CREATE `C/subagent-handoff-index.ts`)

- Per workspace: `loaded?: Promise<void>`, `names: string[]` (sorted, uncapped, names only),
  `published: Set<string>` (merged when a load resolves), `cursors: Map<cursorKey, name>`. Load =
  guarded `readdir` + `parseRecordName`; no head reads; a failed load is retried next prompt.
  Rescan (r3 Blocking 1): `loadedAt` per workspace; a prompt that finds `now - loadedAt >=
  INDEX_RESCAN_MS = 60_000` starts one new names-only load (single flight) and uses the current
  `names` for this prompt; the new list replaces `names` when it resolves (merged with
  `published`), so another host's later records are named within one rescan period.
- `publish(ws, name)`: sorted insert (dedupe), or into `published` while loading.
- `pointerFor(ws, {own, hidden: Set<owner16>, cursorKey})` with `POINTER_BUDGET_MS = 600`:
  1. Load raced against the deadline; not done → timeout line only (load continues).
  2. Candidates = names whose owner is not in `hidden`; none → `undefined`.
  3. Start at the first candidate `> cursors.get(cursorKey)`, wrapping; visit up to
     `MAX_HEAD_READS = 10`; check the deadline before each read except the first.
  4. Read: `lstat` (regular file only) + 2 KB head + parse. `consumed`/`dismissed` → drop; `mtime`
     older than `HANDOFF_RETENTION_MS = 7 d` → `unlink` (D5). Missing/not regular → drop, no delete.
     `pending`/`malformed` → listed, own if `owner ∈ own`, else foreign.
  5. `cursors.set(cursorKey, last visited)`; `N` = candidates not visited this prompt.
- Lines (paths only, never content):
  - Header: "Ptah: subagent handoff records are pending. For each: read it, continue from it, then
    set `status: consumed` in its frontmatter (or `status: dismissed` if you will not continue it,
    or if its subagent is still running or finished normally)."
  - Own: `- <abs path>`; foreign: `- <abs path> (from another or an ended session; continue it only
    if that session is not running, else leave it)`; malformed adds " (frontmatter unreadable)".
  - More (`N > 0`): "Ptah: N more handoff records in `<dir>` are not checked yet; later prompts name them."
  - Timeout: "Ptah: handoff records could not be checked in time; look in `<dir>` for
    `*.handoff.md` files with `status: pending`."
- Read errors are per entry (r3 Blocking 2, r4 Blocking 1): an `lstat`/read/parse error on one
  record counts as a visit, is never deleted (one debug log with `errorCode`), and the cursor moves
  past it. Its path is STILL listed, with the suffix " (could not be read; open it directly)", and
  ownership comes from its name as for any record. So a failing record is named on every prompt
  that visits it, whether or not other records are listed.
- `forgetCursor(cursorKey)`; any other error → the timeout line for this prompt.
- Seam: `C/subagent-handoff-index.spec.ts` (temp dir, `fs.utimes`, injected clock, fake `readdir`).

### 3. Timeout helper and message (MODIFY `C/subagent-handoff-files.ts`, `C/subagent-handoff-message.ts`)

- Export `withinHandoffTimeout<T>(op, onLate?)` from the race at `:111-136` (timer cleared);
  `prepareHandoffFiles` uses it; `onLate` gets a late value (component 1 unlinks). Spec MODIFY.
- `handoffMessage(..., files, recordPath?)`: line 2 "This handoff is saved at `<path>`. Read it,
  continue from it, then set `status: consumed` in its frontmatter (or `status: dismissed` if you
  will not continue it)."; the resume instruction (`:97-105`) repeats it. No path: today's text.

### 4. SubagentHandoffDelivery (REWRITE `C/subagent-handoff-delivery.ts`)

- Keep `PARENT_PUSH_ATTEMPTS`, retry delay, `HandoffDeliveryPort`, `push` + `SEND_TIMEOUT`, `post`
  (`onDropped → send`), `send`; `send` failed ×3 → post once without `onDropped`, warn "handoff not
  pushed; the record stays pending" (or "no durable record").
- DELETE `PENDING_HANDOFF_MAX_RETRIES`, `undeliveredHandoffNotice`, `PendingHandoff`, `pending`,
  `retryPending`, `release`, `sendDropped`, `retryRecord`, `retryIfMissed`, `pushRecord`,
  `postUndeliveredNotice`, `Handoff.notesPath`; rewrite header `:1-44`; `Handoff` gains
  `recordPath?`. Seam: spec REWRITE.

### 5. SubagentBudgetMonitor (MODIFY `C/subagent-budget-monitor.ts`)

- `stop()`: `stopInFlight` → `prepareHandoffFiles` → `handoffMessage` → `records.writeOnce` → live
  check (released → `withdraw`) → `markInvoked` → `stopSubagent` → `index.publish` (any outcome) →
  live check (released → return) → failure: `onStopFailed` (give-up keeps the record) → success:
  `deliverHandoff` with `recordPath` → `writeStub` (bounded, best-effort).
- Class doc comment: Guarantee 2 sentence verbatim; update header `:42-45,67-73`.
- Remove `retryPending` (`:365,374`), `delivery.release()` (`:591`); `release` calls
  `records.forget(stale ∪ {sessionId})` and `index.forgetCursor(ownerHash(sessionId))`.
- `handoffPointer(sessionId, hookCwd)`: `cur = currentSessionId(sessionId)`; workspace
  `workspaceOf(cur) ?? hookCwd`; `own` = hashes of `cur` + aliases resolving to it; `hidden` = hashes
  of every other `sessions` key + its aliases; `cursorKey = ownerHash(cur)`.
- Constructor gains store + index, built in `register.ts:495-536` with `:506-512`. Seam: spec MODIFY.

### 6. UserPromptSubmitHookHandler (MODIFY `H/user-prompt-submit-hook-handler.ts`)

- Inject `@inject(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR) private readonly subagentBudgetMonitor?:
  Pick<SubagentBudgetMonitor, 'handoffPointer'>` (`compaction-hook-handler.ts:160-161`).
- Only when `isUserPromptSubmitHook(input)` and no `input.agent_id`; id `resolveHookSessionId(
  input.session_id, sessionId)`, null → none. Outer race `POINTER_TIMEOUT_MS = 1_000` (cleared) backs
  the 600 ms budget. `:40-42` guard no longer gates the pointer. Output `{continue:true,
  hookSpecificOutput:{hookEventName:'UserPromptSubmit', additionalContext}}`; throw → `{continue:true}`.
  Seam: spec MODIFY.

### 7. Convention text (MODIFY prompts/docs)

Rule (same wording everywhere): "Subagent handoffs: a Ptah line naming a
`.ptah/subagent-handoffs/*.handoff.md` record, or a `subagent-handoff-*.md` stub in your task
folder (it names the record), marks work a stopped subagent left unfinished. If the record's
frontmatter has `status: pending` and it concerns your deliverable: read it, continue from it
instead of redoing it, then set `status: consumed` (or `status: dismissed` if you will not continue
it, or its subagent is still running or finished normally). A record marked as from another or an
ended session: continue it only if that session is not running. Never edit the stub; that status
line is the one write allowed besides your deliverable."

- `task-spec.contract.ts`: specialist block after `:538`; coordinator `:564` gains the exception;
  spec MODIFY (both audiences contain `subagent-handoff`, `consumed`). `.claude/agents/*.md` (15):
  append to the "Task folder" line. Both `SKILL.md` copies, `## Invoking agents`: one bullet — pass
  any pending record path (pointer line or stub) in a re-spawned agent's prompt.

## Integration architecture

- Flow: component 5 `stop()`; prompt → hook → `handoffPointer` → agent edits `status` → next read
  drops it. Disk is the only durable state; index, cursors, writer map are per-process caches with
  release paths. Exit between write and stop leaves `pending` (Assumption: SDK subagents end with
  the host's query; confirm against the `stopSubagent` owner). Logs: info "Handoff record saved";
  warns per failed write, give-up, safety without record, withdraw failure; never handoff text.

## Review findings → revision 3

| # | Finding | Resolution |
| --- | --- | --- |
| 1, 2 | No durable record; ref failure | D2 + Guarantee 2; one record, no ref, index from `readdir` |
| 3, 4 | 60 s grace; first-20 starvation | Every main-thread prompt, pending never aged out; rotating cursor (Guarantee 4) |
| 5, 6 | Id collision; host/agent write race | Time + owner16 + tool + nonce, `wx`; host never rewrites |
| 7, 8 | Containment; cleanup of input | Guards at write and scan, S4 boundary; only resolved > 7 d deleted |
| 9, 10 | "Delivered"; loose parsing | No delivered state; strict name/head parsers, malformed = pending |
| 11, 12 | Hook audience; schedules | `agent_id` gate, payload id, owner from the name; test plan |
| r2-B1 | Withdraw after ambiguous stop | Kept after `stopSubagent`; published at invocation; dismiss text (Dev. 1-2) |
| r2-B2 | Safety stop without record | User decision; Guarantee 2 + class doc comment |
| r2-B3 | Pending never named | Uncapped names; per-session rotating cursor; "N more" names the folder |
| r2-S1 | `a.b`/`a_b` owner | `owner16` sha256 prefix; compared by hashing live alias sets |
| r2-S2 | Malformed header broadcasts | Audience from the immutable name; head carries only status |
| r2-S3 | Two hosts, wrong owner | No death inference; foreign takeover text |
| r2-S4 | Ancestor swap | Trusted-workspace boundary stated; realpath/no-link check + `wx` kept |
| r2-S5 | Second record across rekey | Writer map by tool id, reserved synchronously (Dev. 3) |
| r2-M1 | Cleanup vs reader | Accepted risk; resolved > 7 d only |
| r2-M2 | First scan unbounded | Names-only load; 600 ms budget; timeout line names the folder |
| r3-B1 | Other host's later record never seen | Names-only rescan when the index is >= 60 s old (single flight) |
| r3-B2, r4-B1 | Unreadable record starves or hides | Per-entry handling; cursor moves past it; its path is listed with "(could not be read…)" |

## Test plan (fault schedules)

- Record spec: render/parse round-trip; `parseRecordName` accepts tool ids with `-`/`_`, rejects
  uppercase hex, short nonce, no time; head parser: key order, CRLF, duplicate `status`, `done`, no
  closing fence in 2 KB, leading blank → malformed; `EEXIST` (equal nonce) → failure, first intact;
  `a.b`/`a_b` → different `owner16`; host dir or `.ptah` a link/junction → refused; stub: valid,
  `..`, absolute elsewhere, nested, junctioned, linked `specs` → no stub, no throw; two concurrent
  `writeOnce` for one tool id → one file; `withdraw` after `markInvoked` → kept.
- Index spec (r3 additions): host B loads, a record appears on disk later (other host), clock +60 s
  → a later prompt names it; the first record's head read throws `EACCES` on every prompt → later
  pending records are still named and the cursor moves past it; failing record A + readable
  pending B on repeated prompts → both paths listed every visit, A with "(could not be read…)".
- Index spec: lists a previous run's record; 23 pending → prompts name 10, 10, 3 distinct, then wrap;
  2 050 names (fake `readdir`) → every pending one named eventually; consumed/dismissed dropped; 8 d
  consumed unlinked, 1 d kept; pending 30 d kept; malformed listed "(frontmatter unreadable)", kept
  at 30 d, hidden from another live owner; link entry skipped, kept; owner in `hidden` → not read;
  foreign owner → takeover text; first `readdir` > 600 ms → timeout line, next prompt lists;
  `publish` during load → merged; two cursor keys do not skip each other's records; no body text.
- Monitor spec (fake timers, store, dispatcher): write fails → no `stopSubagent`, retry next request;
  3 failures → one warn, no handoff stop, later safety stop without record; late write → withdrawn,
  no stop; release during write → withdraw, no stop; dispatcher records the call then rejects →
  record kept and published; rejects ×3 → one write, kept, give-up warn; release during a rejecting
  stop → kept, published, no delivery; two in-flight stops for one tool id across `rekey` → one
  file, one index name; write precedes `stopSubagent`/push/post; `handoffPointer` for live `a.b` and
  `a_b` → each sees only its own; owner released → foreign text; other live owner → hidden; A
  rekeyed to A2 → A's record is own.
- Files: helper resolves, times out, clears timer, `onLate` fires. Delivery: sent once;
  `SEND_TIMEOUT` no retry; 3 failures → queued once; drop → send. Hook: main
  thread → `additionalContext`; `agent_id` → none; empty registry still points; throw or > 1 s →
  `{continue:true}`; fan-out unchanged. Shared: both audiences have the rule.

## Team-leader handoff

- Executor: one batch, one Claude backend-developer (single writer; all components meet in the
  monitor's stop seam). Complexity: MEDIUM (fs guards, rotation, spec rewrites).
- Files: CREATE `C/subagent-handoff-record.ts`, `C/subagent-handoff-index.ts` (+specs). REWRITE
  `C/subagent-handoff-delivery.ts` (+spec). MODIFY `C/subagent-handoff-files.ts` (+spec),
  `C/subagent-handoff-message.ts`, `C/subagent-budget-monitor.ts` (+spec),
  `H/user-prompt-submit-hook-handler.ts` (+spec), `libs/backend/agent-sdk/src/lib/di/register.ts`,
  `libs/shared/src/lib/types/task-spec.contract.ts` (+spec), `.claude/agents/*.md` (15), both
  `orchestration/SKILL.md` (`.claude/skills/`, `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`).
- Checks (one at a time, foreground):
  1. `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk @ptah-extension/shared --parallel=1`
  2. `npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/shared --parallel=1 --maxWorkers=2`
     (header must say "Running target test for 2 projects").
  3. `npx jest -c libs/backend/agent-generation/jest.config.ts template-partial-resolver.spec template-sharing.guard.spec --coverage=false --maxWorkers=2`
- Verify: `grep -rn "retryPending\|PENDING_HANDOFF_MAX_RETRIES\|undeliveredHandoffNotice\|handoff-ref\|owner-session" libs/backend/agent-sdk/src`
  is empty; SKILL.md copies byte-identical; `MainThreadNoticeQueue` untouched; the monitor class doc
  comment contains the Guarantee 2 sentence.
