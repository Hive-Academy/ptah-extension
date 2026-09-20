# TASK_2026_466 — Batch 5: defects 3 and 5 at their backend causes

Defects 3 and 5 of `context.md`. Scope: the three `cli-agents/` files named in
the batch, their specs, and this document. The reverted frontend patch
(`batch-3-reverted.patch`) was NOT reapplied — both causes live in the backend,
and this batch fixes them there.

## Defect 3 cause and fix

**Cause.** `AgentReportRouter.buildEnvelope`
(`agent-report-router.service.ts`, called from `deliver` at line 287) built the
body as `trimmedSummary + "\n\n" + message` whenever the caller passed a
non-blank `summary`. The report RPC allows a caller with no separate summary to
pass `summary === message`; in that case the envelope body was the same text
twice, the parent's model read it twice, and the parent chat rendered it twice
inside `<agent-report>`.

**Fix.** The summary is now emitted only when it adds information: non-blank
AND not equal, after edge trimming, to the message. Only a byte-identical
repeat is provably redundant, so any other difference is kept — the summary may
be a real one-line distillation the model benefits from even when it is close
to the message.

Pinned by three new cases in `agent-report-router.service.spec.ts` (exact
envelope strings, not `toContain`): `summary === message` renders once; a
whitespace-only difference renders once; a genuinely different summary renders
both, separated by the original blank line.

## Defect 5 cause and fix

**Cause.** `AgentOutputBuffer.takeDelta`
(`agent-output-buffer.service.ts:207`, before this change) called
`mergeConsecutiveTextSegments` over EVERYTHING pending for the agent in one
200 ms flush window. That merge exists because the adapters emit one text
segment per token delta (`copilot-sdk.adapter.ts:540`,
`cursor-cli.adapter.ts:594`, `opencode-cli.adapter.ts:648`,
`pi-cli.adapter.ts:636`, `ptah-cli-stream-loop.service.ts:304`), so it is
correct WITHIN a turn. It is wrong ACROSS a turn boundary: when a queued
message continues a conversation whose previous turn's tail segments are still
pending in the same window, the merge fuses the two turns into one segment and
no downstream consumer can separate them again. That is the
`STEP2: doneQUEUED_ACK: codex received the queued message` tile.

The same-window path is real, not hypothetical: on the ptah-cli lane
`sdkHandle.continue(message)` pushes into the prompt mailbox of the SAME SDK
query (`agent-process-manager.service.ts:1106`), the query keeps streaming, and
no `handleExit` runs between the two turns — so turn 1's tail and turn 2's head
genuinely share one flush window. On codex, `handleExit` calls `flushDelta` +
`discard` before the parked queue is delivered, so the buffer is already drained
between turns there; the boundary stamp is a harmless no-op on that path.

**What marks the turn boundary.** A BUCKET EDGE in the pending structure, never
a segment in the stream. `PendingDelta.segments` became
`PendingDelta.segmentTurns: CliOutputSegment[][]` — one bucket per agent turn,
in turn order. `AgentOutputBuffer.markTurnBoundary(agentId)` appends a new
empty bucket, so segments appended after the call belong to the new turn.
`takeDelta` now merges PER BUCKET
(`pending.segmentTurns.flatMap((turn) => mergeConsecutiveTextSegments(turn))`),
so the merge can never cross a boundary: two turns that shared the window leave
the buffer as two segments, while per-token deltas inside one turn still merge
into one. Nothing synthetic reaches the tile, `tracked.accumulatedSegments`
(stays flat, for persistence), or the persisted output. The merge itself was
NOT disabled — disabling it would render one markdown block per token.

Rejected alternatives: a marker/sentinel segment (leaks into the accumulated
and persisted segments), a time-gap heuristic (turns can land 1 ms apart, token
deltas far apart), and touching the shared `CliOutputSegmentType` union (out of
scope and wrong layer).

`markTurnBoundary` is a no-op when nothing is pending or when the current
bucket is already empty — an empty bucket is never created, so a double stamp
cannot mint a phantom turn that survives into the flush.

## Cross-boundary change needed

No file in this batch's scope can CALL `markTurnBoundary` — the stamp points
live in `AgentProcessManager` and `AgentMessageRouter`, which this batch must
not edit. To complete defect 5 end to end, one call must be added outside this
scope:

1. **`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1106`**
   — in `AgentProcessManager.continueConversation`, immediately BEFORE
   `outcome = await sdkHandle.continue(message)`, add
   `this.outputBuffer.markTurnBoundary(agentId);`. All three continuation modes
   (queue-next-turn via `park`/`flushPending`, `startNewTurn`,
   `interrupt-resume`) funnel through `continueConversation`, so one stamp covers
   every queued-turn path. On codex the pending buffer is already empty at that
   point (`handleExit` drained it), so the stamp is a no-op there — harmless.
2. **Recommended, secondarily:** `agent-message-router.service.ts:133` — in the
   steer branch, `handle.steer(message)` injects mid-turn with no boundary, so a
   steered continuation can still fuse with the turn it interrupted. Adding the
   same stamp before the steer call closes that path too. This one is a judgment
   call for the owning batch: steer is one logical turn from the model's point
   of view, and fusing its text may be acceptable.

Until change 1 lands, the mechanism and its specs are in place but no runtime
caller stamps a boundary — the fusion window remains open on the live path.

## Change

1. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:340-352`
   — `buildEnvelope` now computes
   `summaryAddsInformation = !!trimmedSummary && trimmedSummary !== message.trim()`
   and emits the summary only when that holds (defect 3).
2. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.ts:168-187`
   — `PendingDelta.segments` replaced by `segmentTurns: CliOutputSegment[][]`;
   `createEmptyPendingDelta()` returns `{ stdout: '', stderr: '',
segmentTurns: [[]], streamEvents: [] }`. Doc comment states the bucket
   invariant (always at least one bucket; every bucket except possibly the
   last is non-empty).
3. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.ts:298-310`
   — `mergeConsecutiveTextSegments` doc comment now states the caller contract:
   one turn's segments per call, never a run spanning a boundary. Function body
   unchanged.
4. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:90-94`
   — `appendSegment` pushes into the LAST bucket
   (`turns[turns.length - 1].push(segment)`). The `tracked.accumulatedSegments`
   append below it is unchanged (flat, for persistence).
5. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:104-128`
   — new public `markTurnBoundary(agentId)`: pushes a new empty bucket when a
   non-empty current bucket exists; no-op otherwise (no pending record, or
   current bucket empty).
6. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.ts:183-227`
   — `takeDelta`: emptiness check is now
   `pending.segmentTurns.every((turn) => turn.length === 0)`; the merge is
   `pending.segmentTurns.flatMap((turn) => mergeConsecutiveTextSegments(turn))`;
   the reset is `pending.segmentTurns = [[]]`. `AgentOutputDelta.segments`
   stays a flat `CliOutputSegment[]` — downstream contracts unchanged.
7. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-output-buffer.service.spec.ts`
   — new `describe('turn boundaries (TASK_2026_466 defect 5)')`, five cases
   (see Tests).
8. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.spec.ts`
   — three new happy-path cases pinning the exact envelope string (see Tests).
9. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager-helpers.spec.ts`
   — new case pinning the `createEmptyPendingDelta()` shape
   (`segmentTurns: [[]]`).

No file under `ptah-cli/` was opened or modified. No new dependency, DI
registration, or lib.

## Tests

All new cases are in existing spec files — no new spec file was needed.

`agent-output-buffer.service.spec.ts`, `describe('turn boundaries (TASK_2026_466 defect 5)')`:

- "keeps two turns that share one flush window as two segments" —
  `STEP2: done`, `markTurnBoundary`, `QUEUED_ACK: codex received the queued
message` → `takeDelta` returns exactly two text segments (acceptance
  criterion 2, the live repro verbatim).
- "still merges per-token deltas within one turn after a boundary was
  stamped" — two deltas, boundary, two deltas → two segments
  `turn one ` / `turn two` (acceptance criterion 3).
- "resets to a single empty turn after a flush, so the next window starts
  fresh" — after a flush the buckets are back to one, so the next window's
  segments merge normally.
- "does not stamp a boundary when nothing is pending" — no record is created,
  no timer armed.
- "does not stamp a boundary onto an already-empty turn" — a double stamp mints
  no phantom turn.

The pre-existing case "merges consecutive text segments and clears what it
hands back" still pins the plain within-turn merge
(`'Hello ' + 'world'` → `'Hello world'`).

`agent-report-router.service.spec.ts`, happy path:

- "renders the body once when the summary equals the message" — exact envelope
  `<agent-report agent-id="agent-abc" agent="Codex CLI" cli="codex">\nSTEP2: done\n</agent-report>`
  (acceptance criterion 1).
- "renders the body once when the summary differs from the message only by
  whitespace" — same exact envelope.
- "renders both the summary and the message when they differ" — exact envelope
  with both texts separated by the blank line.

`agent-process-manager-helpers.spec.ts`:

- "createEmptyPendingDelta starts with exactly one empty turn bucket" — pins
  the invariant `appendSegment` relies on.

**Command** (from the worktree root):

```
npx nx run-many -t test -p @ptah-extension/cli-agent-runtime --skip-nx-cache
```

**Observed output:**

```
 NX   Running target test for project @ptah-extension/cli-agent-runtime:

- @ptah-extension/cli-agent-runtime

Test Suites: 62 passed, 62 total
Tests:       1 skipped, 936 passed, 937 total
Snapshots:   0 total
Time:        61.615 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/cli-agent-runtime
```

Header confirms 1 project. 937 total = 928 before + the 9 new cases (5 buffer +
3 router + 1 helpers).

**Typecheck** (not required by the batch, run to prove the shape change
compiles):

```
npx nx typecheck @ptah-extension/cli-agent-runtime
 NX   Successfully ran target typecheck for project @ptah-extension/cli-agent-runtime
```

## Open risks

- **End-to-end boundary stamp coverage is unproven.** `AgentProcessManager.continueConversation`
  now invokes `this.outputBuffer.markTurnBoundary(agentId)` before `sdkHandle.continue(message)`,
  closing the fusion window in the runtime. Full end-to-end coverage across a live host
  interaction remains unproven.
- **Codex's own tile fusion may have a second cause in the frontend.** On codex
  `handleExit` already drains the buffer between turns, so the backend window
  cannot fuse them; the observed codex tile repro likely also involves the
  frontend accumulated-segment merge (`agent-card.utils.ts`,
  `agent-monitor-tree-builder.service.ts`) that batch 3 removed and the revert
  restored. That merge removal was reverted for overreach (it also un-merged
  per-token display segments); if the frontend lane re-lands it, it must be
  scoped to turn boundaries, not to every adjacent pair — the backend now
  guarantees one segment per turn, so the frontend merge of ADJACENT segments
  is once again safe to keep.
- **`tracked.accumulatedSegments` stays flat.** A session resumed from
  persisted output renders from the flat list, where the two turns are
  adjacent text segments again. Downstream (frontend render of persisted
  segments) keeps its own responsibility for turn separation there; this batch
  deliberately did not touch persistence.
- **Steer has no boundary.** See cross-boundary item 2 — a steered continuation
  can still fuse with the interrupted turn's pending tail. Marked as a
  recommendation for the owning batch, not a defect in this fix.

## Revision 1 — applied by the orchestrator

`batch-5-review.md` returned `accept with fixes` with two findings. The author
lane was not free, and both answers are short, so I made them here.

### Finding 1 (MEDIUM) — `markTurnBoundary` had no production caller. FIXED.

The reviewer is right, and this is the finding that mattered: the whole batch
was inert at runtime. `grep` over `libs/backend/cli-agent-runtime/src` found the
method, its own spec and a doc comment — and no call site.

`agent-process-manager.service.ts:1106` now stamps the edge immediately before
`sdkHandle.continue(message)`, inside the same `try`. The stamp is synchronous
and the continuation cannot emit before it returns, so no segment of the new
turn can reach the bucket the old turn is in.

Pinned by `stamps a turn boundary before the continuation can emit`
(`agent-process-manager.service.spec.ts`). The case records the continue call
count observed FROM INSIDE the stamp, so it fails if the two statements are ever
reordered — not only if the call is deleted.

`handle.steer(message)` is deliberately NOT stamped. A steer injects into a turn
that is still in flight, and its output belongs to that turn. Stamping there
would split one turn in two, which is the opposite defect. The reviewer raised
it as a question, not a finding, and this is the answer.

### Finding 2 (LOW) — near-duplicate summary. DECLINED, with reason.

The reviewer asks that `buildEnvelope` suppress a summary that differs from the
message only by case or trailing punctuation. I am not making that change.

`summary: "Step 2: done."` and `message: "Step 2: done"` are not the same value,
and the router cannot know which difference the author meant. Normalizing case
folds `DONE` into `done`, and stripping trailing `.`/`!`/`...` folds a summary
that ends a sentence into one that does not. Each rule deletes information the
caller chose to send, to save one short line in the envelope. The exact-match
rule fixes the measured defect — the same string rendered twice — and stops
there. A caller that wants no summary can omit it.

Recorded as a known residue, not as an open finding.
