# Code Logic Review - D9 12c-1 (native Codex history projector)

Score: 6/10. Verdict: APPROVE WITH FIXES. Blocking: 0. Moderate: 5. Minor: 4.

Scope: read in full `codex-history-projector.ts`, its spec, `codex-chat-events.ts`, the relevant parts of
`codex-event-translator.ts` (item switch, `emit`, `toolStatus`), the history types and the 12b hydrator
(`codex-session-history.ts:173`). Nothing was executed (read-only instruction). Spec correctness at
typecheck/runtime is unverified by me.

## What holds up

- Reuse is real: tool start/result presentation, text and reasoning block handling go through the live
  `CodexEventTranslator` and `CodexChatEvents`. Tool shape parity is asserted against the live path
  (spec:75-93).
- Ids are deterministic and built from thread/turn/item, so they are stable across reloads. The assistant
  `message_start` id (`[thread,turn]:start`, from the mapper) is deliberately identical to the live id.
  Per-turn translators and mappers mean no cross-turn collisions that I could find. Item type and method
  are part of the tool and text ids.
- `itemEntries` is index-aligned with `turn.items` (`codex-session-history.ts:173`, both come from `entries`),
  so `itemTime` indexing is valid.
- Unknown or malformed items surface as `skippedItems` with only the fixed error code, deduplicated across
  started and completed (projector:102-107). Spec covers it (spec:95-103).
- Sequence guard: the terminal uses `MAX_SAFE_INTEGER`, which the mapper accepts. The terminal is emitted
  only if an assistant message was started. No `any`, `as unknown as` or suppressions in the source.
- `export { CodexEventTranslator }` (codex-runtime index.ts:33) is needed, because agent-sdk cannot
  deep-import. agent-sdk already depends on codex-runtime through the public alias, so no boundary break.
  It does widen the public API by one class; acceptable.

## Moderate findings

M1. Ordering bug when `itemEntries` is partial or non-monotonic. projector:29-31 and :128-129 fall back to
`turnStart` per item. The global sort (:64) is by timestamp. If item A has `startedAtMs` 120500 and a later
item B has no entry (fallback 120000), B sorts before A, which breaks chronological order inside a turn.
Same for any entry earlier than a prior item. Fix: carry a running max, `timestamp = max(prev, entry ?? prev)`,
or sort per turn and only interleave child threads by turn start. The spec never exercises `itemEntries`
(no fixture sets them), so the timestamp path is untested.

M2. Child threads not spawned via `spawnAgent` lose their parent link. `parentTool` is built only from
`collabAgentToolCall` with `tool === 'spawnAgent'` (:52-54). Any other collab tool that creates or resumes a
child, or a missed receiver id, leaves `parentToolUseId` undefined, so the child's whole transcript appears as
top-level root content, interleaved by timestamp. `thread.parentThreadId` is available and unused as a
fallback. Silent misattribution with no `skippedItems` entry.

M3. Async questions are silently dropped. For `agentMessage` with `delivery: 'async'` and questions, the
translator emits `userInputAsync` without `presentation` because `streamed` is always false in replay
(translator:329-340). The mapper returns `[]` for it (chat-events:127, 202-205). The assistant text and the
question card vanish from history, with no `skippedItems` record. Violates "missing or partial items must be
recorded, not hidden". Fix: in the projector, treat the replay as streamed (or detect `userInputAsync` and
emit its text as `textFinal`), or record a skip reason.

M4. Divergence from the live contract for child cards. Replay emits `agent_start` with `agentType: 'Codex agent'`
(:118-125), but the live path emits only a generic `tool_start` with `isTaskTool: false`. This is a
Codex-only presentation the live stream does not produce (the report admits no parity evidence). Either the
frontend has a nesting dependency on it (then live is wrong) or history shows different UI from live. It also
has `source: 'history'` while all mapped events carry `source: 'stream'`. Needs a decision, and the spec only
asserts presence (spec:69), not shape against the frontend consumer.

M5. Spec gaps for the stated requirements. No assertion of: unique event ids (`new Set(ids).size`), assistant
`message_start` fields (`role`, `messageId`, `sessionId`), `itemEntries` timestamps and ordering (M1),
interrupted or failed or `inProgress` turn statuses (:166 mapping and `stopReason`), empty reasoning, async
questions (M3), user-only turns, parent-link fallback (M2), nested spawn from a child thread, or
`localImage`/unsupported user content skip reasons (:135-137). Reasoning is covered only in the happy case
(spec:66). The parity test (spec:75) compares only tool fields, not ids/messageIds/sessionId.

## Minor findings

m1. An empty reasoning item still opens an assistant `message_start` (the mapper prepends start before
returning `[]`), producing an empty assistant message. The terminal then closes it. Cosmetic.

m2. Failed turns: the terminal is passed `status: 'failed'` but no error text. A failed turn becomes
`message_complete{stopReason:'failed'}` with no user-visible error, unlike live (which signals an error).
`contextCompaction` items translate to `compaction` events that the no-op callback discards, so no marker
appears in history either (:94). Record or document both.

m3. `millis()` (:24-27) uses a `< 1e11` seconds heuristic. Correct for current epochs, but a missing
`createdAt`/`startedAt` yields 0, putting the turn first in the global sort (unlikely, but silent).

m4. Fragile structure: the `completeContent` side channel (:82-95, 117) relies on the callback firing
synchronously inside `projection.map`, and it hardcodes thinking_delta even though the callback type allows
`kind: 'text'` (currently never invoked for text). It is correct today; add a guard or comment so a future
text kind does not become mislabeled thinking. Note `thinking_delta` id `reasoning-final` is unique per item,
so no collision.

## Five logic questions (brief)

1. Silent failure: M3 (async question dropped), M2 (child misattribution), m2 (failed turn error, compaction).
2. User action: reload of a session with a partially timestamped turn (M1) shows items out of order.
3. Wrong answer from data: partial `itemEntries` (M1); secondary: spawn children via non-spawn tools (M2).
4. Dependency/shape: unknown or malformed items are handled and recorded; hydrator output is trusted
   (acceptable, 12b validates).
5. Missing: usage is absent by design (`stats: null`); image bytes are not projected (counted only);
   compaction/error markers (m2).

## Verdict

APPROVE WITH FIXES: fix M1-M3 and add spec assertions for them (M5) before commit. M4 needs a one-line
decision recorded in the plan (keep `agent_start` vs generic tool card only). No blocking defects. No
data-loss/security issue found; the export change is safe.

---

# Re-review (after fixes report batch-D9-12c1-fixes-report.md)

Score: 7.5/10. Verdict: APPROVE WITH FIXES (one moderate, small). Blocking: 0. Moderate: 1 (new). Minor: 4.
Read-only; nothing executed. Read the full projector, the spec and `HistoryEventFactory.createAgentStart`.

## Previous findings

| Finding | Status | Evidence |
| --- | --- | --- |
| M1 ordering | FIXED | `itemTime` = max(previous, entry) (projector:30-33); turn start clamped to carried time (:97); `projectTurn` returns the final timestamp and the thread loop carries it (:56,80). Spec has a partial/non-monotonic entries case asserting A,B,C at 120500. |
| M2 child link | FIXED, with a design trade-off (see N2) | Any collab receiver links, spawn preferred (:59-65); a missing link keeps a synthetic id plus an `unresolvedParentTool` skip (:70-78). Spec covers non-spawn plus grandchild and the orphan. |
| M3 async questions | FIXED for text | `presentation: 'text'` injected for `userInputAsync` (:142). Question titles/options are still not presented and not recorded as skipped (minor N4). |
| M4 agent_start | FIXED per coordinator decision | `createAgentStart` (history-event-factory:261) with stable id override (:155-156). `agentType` becomes `'unknown'` (see N3). Only receivers whose linked tool is this item emit a card (:154), and every collab tool qualifies, not only spawn. |
| M5 spec | MOSTLY FIXED | Unique ids, assistant start fields, live id/messageId/sessionId parity, partial entries, failed/interrupted/inProgress, empty reasoning, async, unsupported content/compaction, orphan, non-spawn/nested are all present. Gap: failed turn with no assistant item (the :183-190 branch) and a failed turn with no `error.message` are untested. |
| m1 empty reasoning | FIXED | :135 |
| m2 compaction / failure | FIXED, but see N1 | compaction recorded as `compactionNotPresented` (:136-139). |
| m3 missing time | FIXED | min of known times as fallback (:50-56); `Math.min(...[])` is Infinity and is guarded by `isFinite`. |
| m4 content kind | FIXED | `kind` switch (:110-120). |

## New findings

N1 (moderate). Failed-turn text is raw native `turn.error.message` shown as an assistant `text_delta`
(projector:195-210; the added block is at the end of `projectTurn`). The live path deliberately shows only the
fixed string "Codex reported a runtime error." (chat-events `error()`), and the translator never echoes
native error text (`safeError`). Native messages can contain file paths, request ids or provider details,
and they persist into the transcript. This diverges from live and from the repo rule that errors carry fixed
text. Fix: emit the fixed live string (or a code-based fixed phrase), not `turn.error.message`; keep the raw
message out of events. Also mark the text `source: 'complete'`/id stable as now.

N2 (minor, trade-off). Unresolved children now get a synthetic `parentToolUseId` that points at no tool
(:74-75). The UI behavior for a parent id with no matching card is unconfirmed by the lane. If the frontend
groups children only under existing tool cards, the whole child transcript becomes invisible, which is
worse than the earlier top-level fallback. Also the check `linked.parentId === thread.parentThreadId`
(:72,77) treats a known tool from a different sender as unresolved even though a usable card exists. Suggest
using the found tool when `thread.parentThreadId` is missing or mismatched, and keeping the synthetic id only
when no tool exists, after confirming the frontend handles it. The `unresolvedParentTool` skip is a
single entry per thread, correct.

N3 (minor). `agentType: 'unknown'` will display literally (createAgentStart default with `{}` input). It is
consistent with Claude history for missing input, but a nicer label could be set by the projector
(`agentType` is readonly on the returned object, so spread-override works). Decision belongs to the
coordinator; not a correctness bug.

N4 (minor). Dropped async question cards/options leave no skip record; a failed turn with no
`error.message` and no assistant output yields no event at all, and the manual failed-start branch
(:183-190) is only reached with `error.message` present.

N5 (minor, ok). Timestamp carry across turns monotonic-clamps a later turn whose `startedAt` is earlier than
the previous completion; acceptable and deterministic. The failure-text `blockIndex = turn.items.length`
cannot collide with mapper blocks (bounded by item count).

## Verdict

7.5/10, APPROVE WITH FIXES: fix N1 (use fixed text) and add a spec for failed turns with no assistant item.
N2-N4 may be deferred if recorded in the plan. No blocking issues. The tests were not run by me.

---

# Re-review 2 (after batch-D9-12c1-fixes2-report.md)

Score: 8/10. Verdict: APPROVE WITH FIXES (one moderate, small; otherwise ready). Blocking: 0. Moderate: 1. Minor: 2.
Read-only; nothing executed. Re-read the full projector and the failure/N2/N4 specs.

## Confirmed

- N1 FIXED. The raw `turn.error.message` is no longer referenced anywhere in the projector. Every failed turn
  now gets a `message_start` (when none was open) and a fixed `text_delta` (`source: 'complete'`) with
  `FAILURE_NOTICE` (projector:24, 197-215), followed by the terminal `message_complete{stopReason:'failed'}`.
  Specs assert the raw messages (including a path) never appear, for failure with items, with no items and
  with no message. Remaining nit (minor): the constant is duplicated, not reused. The same literal now lives
  in `codex-chat-turn-stream.ts:58`, `codex-chat-events.ts:305,354` and the projector:24. Prefer exporting one
  constant (parity drift risk); the lane's reason (private) is valid only because nobody exported it.
- N4 FIXED. A replayed async question with questions records `asyncQuestionsNotPresented` (projector:142-143),
  deduplicated by `skip`. The failed-with-no-output case is covered by N1.
- Compile fixes: no non-null assertions, no `any`, no casts. `threadTime` is now declared in the projection
  loop where it is used (:71) and the dead declaration in the pre-scan is gone. `linked` is a plain string.
  Behavior is otherwise unchanged: timestamp carry across turns, item clamp, agent_start, async hint, and
  compaction skip are all intact.

## New finding

R1 (moderate). N2 over-corrected: the guard that tied a link to `thread.parentThreadId` was removed.
`parentTool` (projector:50-64) now maps any receiver id to its tool across the whole snapshot, and
`parentToolUseId = linked ?? synthetic` (:72-76) applies even when `thread.parentThreadId` is null. Non-spawn
collab tools whose receivers include a thread that is not a child (a child messaging or waiting on the root
or a sibling, `receiverThreadIds: ['root']`) would set `parentTool['root']`. The whole root transcript then
nests under a tool card that sits inside a child. That creates a parent/child cycle, and the UI would
likely hide all root content. The first writer also wins for non-spawn tools, so ordering of threads decides
the link. Fix: only link when `thread.parentThreadId` is non-null (and ignore a tool whose own thread is the
receiver or a descendant of it); keep spawnAgent preference. Add a spec where a child's tool lists `root` as
receiver and assert root events have no `parentToolUseId`. The cross-thread spec at spec:207-218 still passes
under that fix because `cross-child` has a parent.

## Minor

- Constant duplicated (above).
- UI handling of the synthetic unresolved parent id is still unconfirmed (carried from N2 earlier); the skip
  record documents it.

## Verdict

8/10, APPROVE WITH FIXES: fix R1 (small guard plus one spec); the rest is acceptable to commit. Tests were
not run by me; the coordinator verify must confirm the spec assertions and strict compile.

---

# Re-review 3 (after batch-D9-12c1-fixes3-report.md)

Score: 8.5/10. Verdict: APPROVE (commit-ready; one low-probability residual noted). Blocking: 0. Moderate: 0. Minor: 1.
Read-only; nothing executed. Re-read the projector link logic, both specs for R1, the diffs of
`codex-chat-events.ts` and `codex-chat-turn-stream.ts`.

## R1: FIXED

- A receiver is linked only when it exists in the snapshot, has a `parentThreadId`, is not `rootThreadId`, and
  the tool's owner thread is neither the receiver nor a descendant of it (`createsParentCycle`, projector:33-45,
  usage at ~:68). The walk has a `visited` guard, so malformed parent loops terminate.
- At projection time the root is forced to `parentThreadId = null` (~:84), so `linked` is only read for
  threads with a parent. The root can never get a `parentToolUseId`, and self/ancestor receivers are rejected.
  Spawn preference and the cross-thread lookup are retained. The unresolved fallback and skip record still
  apply to children without a valid tool.
- Specs: the root/self case (spec:219-238) asserts root events carry no `parentToolUseId` and the child falls
  back to the synthetic id with a skip record. The ancestor-under-descendant case (:240-253) asserts no
  `agent_start` for the ancestor. The cross-thread spec (:207-218) is still valid: its receiver has a parent
  and the owner is not the receiver or its descendant.

## Constant change: no live behavior change

`CODEX_FAILURE_NOTICE` is exported from `codex-chat-events.ts:9` with the identical text. The live uses
(`codex-chat-events.ts:307,356`, `codex-chat-turn-stream.ts:82,405`) only swap the literal for the constant;
the removed private `FAILURE_NOTICE` is fully replaced. The projector imports it from the same module
(no new cycle). No new `any`, casts, non-null assertions or unused identifiers are visible; `threadsById`,
`createsParentCycle` and `parentThreadId` are all used. Existing live specs still assert the literal text, so
they would catch drift. Strict compile is not verified by me (the coordinator verify must confirm).

## Residual (minor)

Two sibling threads can each hold a non-spawn tool naming the other as receiver. Neither is an ancestor of
the other, so both links pass, giving A under b-tool and B under a-tool (a two-node cycle). Both transcripts
would then nest under each other's cards and could disappear. Low probability. Suggested guard: for a
non-spawn tool require `owner.id === child.parentThreadId`, or reject a link whose resulting chain returns to
the child. Not a blocker.

## Final verdict

8.5/10, APPROVE. All earlier moderate findings (M1-M5, N1, N2, N4, R1) are fixed with specs. Remaining
UNCONFIRMED items: pinned-binary thread/read shape, UI handling of the synthetic unresolved parent id, and
that the tests pass.
