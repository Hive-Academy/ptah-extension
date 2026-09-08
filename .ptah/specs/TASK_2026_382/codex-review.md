# TASK_2026_382 — Independent review gate

Reviewed commit: `8cf8faec4` — "fix(chat): queue mid-stream sends and order the transcript by time".
Reviewers: Codex CLI (agent `eedd7432-6987-406b-bb7d-7efc5e7b5ca3`, exit 0) + this adjudication.
Task folder read: `task.md`, `research-report.md`. No `implementation-plan.md`, no `batches.md`, no
prior review document exists for this task.

## Acceptance criteria

| # | Criterion (from `task.md` + `research-report.md`) | Verdict | Evidence |
|---|---|---|---|
| AC1 | Busy predicate reconciled with `streamingState`; a mid-stream send is QUEUED, not dispatched | PASS (with a queue-drain gap, see B1/B2) | `message-dispatch.service.ts:126-135` |
| AC2 | The mid-stream user bubble renders BELOW the live streaming bubble | PASS | `chat-transcript.component.ts:50-52`, `:68-87`, `:359-374` |
| AC3 | The chat-error path no longer strands an unfinalizable tree | PARTIAL — fixed only in dead code | `completion-handler.service.ts:14-21`, `:93-95` |
| AC4 | W4: an explicit `tabId` outside the active workspace resolves correctly | PARTIAL — three resolution sites still active-workspace-only | `message-dispatch.service.ts:172`, `message-sender.service.ts:216`, `conversation.service.ts:119` |
| AC5 | Tests pin the behaviour and fail on revert | PARTIAL | see adjudication |

Test run (mine, not Codex's): `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/chat-state @ptah-extension/chat-streaming --skip-nx-cache` → 3/3 projects green, 64+22+… suites, 990 + 449 tests passing, 0 failing. Codex reported its own run produced no output inside its budget; that is a Codex environment limitation, not a repo failure.

## Codex raw verdict

`VERDICT: NEEDS_WORK`. Codex graded AC1 FAIL, AC2 PASS, AC3 PASS, AC4 FAIL, AC5 PARTIAL, and raised
four blockers: `message-dispatch.service.ts:172`, `message-dispatch.service.ts:187`,
`message-sender.service.ts:216`, `chat-lifecycle.service.ts:288`.

## My adjudication

**Confirmed, carried forward:** all three W4 residuals (`message-dispatch.service.ts:172`,
`message-sender.service.ts:216`) and the silent queue-loss on a `{ success: false }` flush
(`message-dispatch.service.ts:189-192` + `message-sender.service.ts:646-658`). I opened each file at
the named line and reproduced the reasoning.

**Downgraded:** Codex's `chat-lifecycle.service.ts:288` blocker. The code fact is real —
`SessionId.from` throws a `TypeError` on a non-UUID (`branded.types.ts:84-89`), the payload is
un-validated (`chat-message-handler.service.ts:461-468`, a bare `as` cast, no Zod) and
`message-router.service.ts:67-73` has no per-handler `try`. But the producer is our own extension
host, the `data.tabId` branch runs first, and nothing in this task touched that path. It is a
pre-existing hardening gap, not a gate blocker. Recorded below as a note.

**Downgraded:** Codex's AC1 = FAIL. The predicate itself is correct and the
`awaiting-background` / `sleeping` exclusion is genuinely load-bearing — I verified both named
drains would stay silent there: the root-turn gate needs a `message_complete` with no
`parentToolUseId` (`streaming-handler.service.ts:305-317`) and `handleSessionStats` returns `null`
whenever `streamingState` is present (`streaming-handler.service.ts:474-492`). AC1 passes; the
drain gap is a separate defect (B1).

**Added by me, Codex missed:**
- B4 — `conversation.service.ts:119` reads the existing queue through `tabs().find`, silently
  overwriting a background tab's first queued message.
- B5 — the Stop button is gated on `isTabStreaming` alone
  (`chat-input.component.ts:406-416`), i.e. on the exact signal the fix declared untrustworthy.
  In the window R2 targets the tab can neither send nor stop.

## Blockers

**B1 — background-workspace queue flush strands the message forever.**
`libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:172`
```ts
const tab = this.tabManager.tabs().find((t) => t.id === tabId);
```
`tabs()` is the active-workspace signal; `findTabByIdAcrossWorkspaces` exists for the rest, and the
dispatch predicate 100 lines above was changed to use it for exactly this reason (`:68-70`).
Scenario: a canvas tile or background-workspace tab is streaming → the user's follow-up is queued by
the new predicate → the root `message_complete` fires and `chat.store.ts:376-378` calls
`sendQueuedMessage(resultTabId, …)` with that background tab id → the lookup misses →
`sessionId` is `undefined` → the code warns and re-queues (`:176-185`). The next flush repeats the
same miss. The message never reaches the agent. This is the "strictly worse than the bug" outcome
the commit message argues against, and R2 makes it more reachable than before.

**B2 — a failed queue flush silently destroys the queued message.**
`libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:189-196`
```ts
this.tabManager.clearQueuedContentAndOptions(tabId);
await this.messageSender.continueExistingSessionForQueueFlush(...);
} catch (error) { ... this.tabManager.setQueuedContent(tabId, content); }
```
`continueExistingSessionForQueueFlush` returns `Promise<SendOutcome>` and does NOT throw on backend
failure — `message-sender.service.ts:646-658` logs, calls `markLoaded`/`markTabIdle` and
`return { success: false, error }`. The `catch` therefore never runs. Scenario: the queue is cleared,
the user bubble is already appended at `message-sender.service.ts:617-620`, `chat:continue` returns
`success: false` (auth expired, session gone), and the transcript now shows a user message the agent
never received, with the queue gone and no error surfaced. The returned `SendOutcome` is discarded
at the call site.

**B3 — `chat:abort` is never dispatched for a background-workspace tab.**
`libs/frontend/chat/src/lib/services/message-sender.service.ts:216`
```ts
const tab = this.tabManager.tabs().find((t) => t.id === tabId);
const sessionId = tab?.claudeSessionId;
if (!sessionId) { return; }
```
This is the abort listener wired by `wireAbortDispatch`. Scenario: a background-workspace tab has a
live stream; the tab is closed or a new send fires `createAbortController` → the signal aborts → the
lookup misses → the handler returns without the RPC. The backend keeps generating. This is the
identical "no abort fired" symptom the research report documents, still live cross-workspace, and it
directly contradicts the commit's claim that "All resolution sites now use
findTabByIdAcrossWorkspaces".

**B4 — a second queued message overwrites the first on a background tab.**
`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:119`
```ts
const targetTab = this.tabManager.tabs().find((t) => t.id === targetTabId);
const existingQueue = targetTab?.queuedContent?.trim() ?? '';
```
The WRITE path is workspace-aware (`tab-manager.service.ts:1022-1070` delegates to
`workspacePartition.updateBackgroundTab`), but this READ is not. Scenario: the user queues two
follow-ups against a background-workspace tab; the second read sees `existingQueue === ''`, takes the
`setQueuedContentAndOptions` branch (`:125-131`) and replaces the first message instead of appending
it. Silent data loss, on the branch R2 now routes into.

**B5 — in the window the fix targets, the tab can neither send nor stop.**
`libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:406-416` and
`:306`
```ts
readonly isActiveTabStreaming = computed(() => { ... this.tabManager.isTabStreaming(tabId) ... });
@if (isActiveTabStreaming()) { <button ... data-testid="chat-stop-btn">
```
The Stop button is gated on `_streamingTabIds` only — the very signal this task declared out of sync
with `streamingState`. Scenario: any writer clears the turn flags while leaving a live tree (the
defect class this task exists for). R2 now queues every message in that state; Stop is hidden because
`isTabStreaming` is false; the queue drains only on a root `message_complete` that already fired. The
tab is a dead end. Before this commit the user could at least still send. The predicate was widened
without widening the recovery affordance that reads the same state.

**B6 (severity: medium, honesty) — AC3 is delivered on dead code, and its live counterpart is untested.**
`libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.ts:14-21` states
"NOT CURRENTLY REACHABLE … nothing injects this class". I verified independently: a repo-wide grep
for `CompletionHandlerService` outside spec files returns only its own declaration, the barrel
export (`chat-store/index.ts:23`) and doc comments. The commit's R1 change and its 74 lines of new
spec therefore exercise a class no runtime path constructs. The task title's second clause — "chat
errors strand an unfinalizable tree" — is closed by an ARGUMENT (the ordered terminal `turn_state`
finalizes first at `turn-state-applier.service.ts:114-131`) and not by a test. The live handler
`chat-lifecycle.service.ts:272-321` deliberately writes no `status`, no finalize. Whether that
ordering actually holds under a dropped or stale-rejected terminal event is exactly the case B5 turns
into a hard lock, and no test covers it.

## Notes (not blockers)

- `chat-lifecycle.service.ts:288` — `SessionId.from(data.sessionId)` throws on a non-UUID; the
  payload is an un-validated `as` cast (`chat-message-handler.service.ts:461-468`) and
  `message-router.service.ts:67-73` isolates no handler. Pre-existing; producer is trusted.
- Test quality (AC5): `message-dispatch.service.spec.ts` "R1 + R2 anti-trap" (the `after the error`
  case) hand-installs `streamingState: null` — it pins the predicate, not the settle, so nothing in
  the suite proves production ever clears the tree. The transcript spec's identity test calls the
  same Angular `computed` twice with no invalidation between, so Angular's own memoization would
  satisfy it without `mergeByTime`'s explicit cache. The `awaiting-background` / `sleeping` exclusion
  test asserts a behaviour the pre-fix code also had.
- What is genuinely well done: `mergeByTime` (`chat-transcript.component.ts:68-87`) is a correct,
  stable linear merge on `streamingState?.startTime ?? timestamp`; `startTime` really is populated on
  root nodes (`message-node.fn.ts:50`), so the unstable-`Date.now()` trap the research report warned
  about is avoided. The `awaiting-background` / `sleeping` exclusion reasoning is correct and I
  verified both drain gates myself. The commit is honest about R1 landing on dead code.

## Final verdict

**NEEDS_WORK.** AC2 is fully delivered and is the fix for the user-visible symptom. AC1's predicate
is correct. But the commit widened the queue path (R2) while leaving three active-workspace-only
resolution sites on that same path (B1, B3, B4) and one silent-failure return (B2), each of which
loses a user message with no surfaced error — and the recovery affordance for the state R2 creates
is gated on the signal the task itself declared untrustworthy (B5). The task title's error-path
clause is closed on dead code with no live-path test (B6).
