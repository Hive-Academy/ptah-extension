# Context — TASK_2026_337

## Where this came from

The TASK_2026_333 implementer found it while deepening the equivalence oracle,
and deliberately did not act on it. Widening a production reuse key on their own
judgement, inside a bugfix, would have been scope creep on a change that had
already been through one review round. Filing it instead was correct.

Full record: `.ptah/specs/TASK_2026_333/implementation-report.md`.

## The gap

`fingerprintNode`
(`libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:629-656`)
is the per-node reuse key. If the fingerprint matches, the node object is reused
verbatim and whatever it holds is what renders.

Folded today: `cost`, `duration`, `model`, `tokenUsage`, `agentDescription`,
`error`, `status`, content.

Not folded, but rendered: **`summaryContent`** and **`toolCount`**.

Also not folded: `startTime`, `endTime`, `parentToolUseId`, `agentModel`,
`agentPrompt`, `isCollapsed`, `isHighlighted`.

## Which omissions are decisions and which are accidents

**Keep excluding the timestamps.** Folding `startTime` or `endTime` would
invalidate node identity on every history replay, because a `complete` or
`history` event legitimately supersedes a `stream` event with a fresh timestamp
under the same id. That would force the whole-tree re-render the incremental
rebuild exists to avoid, and would undo TASK_2026_323 Phase 3. This is a real
design decision and it should be stated in the code, not merely implied.

**`isCollapsed` and `isHighlighted`** are view state, not model state. Check
where they are owned before touching them — if a component owns them, they do not
belong in a builder's reuse key at all.

**`summaryContent` and `toolCount` look like accidents.** Both render. Neither
has a reason to be excluded that the other folded fields do not also have.

## Why it is low risk today, and why that is not reassuring

Both unfolded fields currently move together with `cost`, `duration` and
`tokenUsage`, which are folded. So in practice a stale summary is usually
accompanied by a changed cost that invalidates the node anyway.

That is a property of today's producers, not an invariant. Any future path that
updates a summary or a tool count without touching the token or cost totals
reintroduces a silently stale card. The whole lesson of TASK_2026_333 is that a
reuse key which happens to be right is not the same as one that is right.

## The work

1. Fold `summaryContent` and `toolCount` into `fingerprintNode`.
2. Leave the timestamps out, and write the reason down at the exclusion site so
   the next reader does not "fix" it.
3. Decide `isCollapsed` / `isHighlighted` explicitly — fold, or document as view
   state owned elsewhere. Either is fine; silence is not.
4. Re-check the perf budget. `fingerprintNode` runs per node per rebuild, and
   `mixNumber` is signed on purpose (see the lib's `CLAUDE.md` — an unsigned fold
   leaves V8's small-integer range and boxes every intermediate). Two more string
   folds is not free. The budget assertion at
   `execution-tree-builder.service.spec.ts:495` is where a regression shows,
   though note it is load-sensitive and Nx flags it flaky, so confirm any failure
   by running that project alone.

## The test that is currently blocked on this

TASK_2026_333's oracle has no case for a **same-id replacement carrying a new
timestamp** — late tool metadata attaching, or a `complete` event superseding a
`stream` event. With the oracle's all-fields shape that case fails today, and it
fails on _intended_ behaviour, precisely because `fingerprintNode` does not fold
`startTime`.

Adding it would have forced either weakening the shape or widening the reuse key.
Once this task settles what the key should contain, add that oracle case — it is
the one that pins the replacement path, which is otherwise uncovered.

## Verification

The oracle in `execution-tree-builder.service.spec.ts` already calls the
production `fingerprintNode` over both trees, so a widened key is exercised by
every existing case for free. Add one case that moves `summaryContent` alone,
and one that moves `toolCount` alone, and confirm each fails before the fix.
