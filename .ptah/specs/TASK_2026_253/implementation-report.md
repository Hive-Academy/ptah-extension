# TASK_2026_253 — implementation report

`trigger-eval` spends lane tokens that `TOKEN_SPENDING_STAGES` did not count.
Fixed by **counting it honestly** (user Decision 1), plus the `noPrompts`
skip-reason split (Decision 2). No probe cache was built.

---

## A. Honest accounting — `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts`

| Change                                                                                                                                | Line       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| R3 header no longer names `trigger-eval` as a free stage; states the free list is exactly three and points at `TOKEN_SPENDING_STAGES` | `:37-42`   |
| `TOKEN_SPENDING_STAGES` comment rewritten (see below)                                                                                 | `:463-496` |
| `'trigger-eval'` added to `TOKEN_SPENDING_STAGES`                                                                                     | `:503`     |
| `STAGE_COST_RANK` re-ranked + justification comment                                                                                   | `:509-529` |

### The corrected comment

The old text — _"The complement — prefilter, embedding, clustering,
trigger-eval — is pure local computation (regex prefilter, the local embedder,
cosine math)"_ — is what produced the bug, so the replacement states plainly
which stages are local and **why `trigger-eval` is not**, naming the
`laneRunner.run(...)` call site in `gates/trigger-eval.service.ts` and the
spec that pins it as the single call site. It also records that the spend was
never invisible (`LaneRunnerService` writes it to `SkillBudgetStore` regardless),
so the defect is precisely _counted after the fact, never gated before it_ — the
reason nothing surfaced.

### New `STAGE_COST_RANK` ordering

```
prefilter 0 → embedding 1 → clustering 2 → judge 3 → trigger-eval 4 → digest 5
→ synthesis 6 → cluster-synthesis 7 → judge-panel 8 → replay 9 → archaeology 10
```

Only `judge` and `trigger-eval` swapped (was `trigger-eval` 3 / `judge` 4);
every other stage keeps its number, and the record stays exhaustive over
`SkillQueueStage`. Justification: `trigger-eval` is **one** lane call plus local
embedder arithmetic — dearer than a bare single `judge` call, cheaper than
`judge-panel`'s two calls plus a possible escalation. Only the order matters
(the comment at the head of the table says so); the values are contiguous
because renumbering the neighbours was unnecessary.

### Bookkeeping

No change needed. The per-item gate reads `TOKEN_SPENDING_STAGES.has(row.stage)`
(`:648`) and increments `summary.budgetDeferred` / sets `summary.budgetExhausted`
uniformly, so set membership alone makes `trigger-eval` behave exactly like
`judge`. The accepted behaviour change — an over-budget host stops running
`trigger-eval` rows entirely, leaving them `queued` and eligible next tick — is
pinned by a new test (below).

---

## B. Docs corrected

- `libs/backend/skill-synthesis/CLAUDE.md`, gates bullet (`src/lib/gates/` entry)
  — "zero LLM on the scoring path" now carries the qualifier that one lane call
  per evaluation generates the probe set, so the stage is token-spending.
- `libs/backend/skill-synthesis/CLAUDE.md`, drain-semantics bullet — added the
  full correction: the complement is three stages, `trigger-eval` is not a
  fourth, both consequences (ungated dispatch + inverted rank), why the ledger
  hid it, the new rank position, and that probe caching was **deferred, not
  rejected** so a later agent does not "simplify" it back.
- `libs/backend/skill-synthesis/CLAUDE.md`, the "two gates have no lane-failure
  channel" bullet — the trigger-eval half is marked DONE with the new token
  design; the `JudgePanelResult` half is left open, unchanged.
- `src/lib/gates/trigger-eval.service.ts` header, "Zero LLM cost" section
  (`:16-32`) — added _"'Zero on the SCORING path' is not 'free', and the drain
  must not read it as one"_, naming this section as where the false reading came
  from. This was the upstream source of the wrong invariant.
- `src/lib/queue/skill-drain.budget.spec.ts` header — the spec file repeated the
  claim too; corrected, with a section explaining why the two new guards exist.

---

## C. Skip-reason split — `src/lib/gates/trigger-eval.service.ts`

### Token design

`TRIGGER_EVAL_SKIP_REASONS.noPrompts` (`trigger-eval-prompt-generation-unavailable`)
is **removed**, not aliased — no backwards-compat shim. Three members replace it
(`:167-183`):

| Member          | Token                                | Branch                                                                   | Kind                       |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------ | -------------------------- |
| `noLane`        | `trigger-eval-no-prompt-lane`        | `result.status === 'unavailable'`                                        | **PERMANENT** in this host |
| `laneFailed`    | `trigger-eval-prompt-lane-failed`    | `result.status === 'failed'` **and** the `catch` around `laneRunner.run` | RETRYABLE                  |
| `unusableReply` | `trigger-eval-unusable-prompt-reply` | schema `safeParse` failure                                               | RETRYABLE                  |

The thrown call and the returned failure share `laneFailed` deliberately: they
are the same fact (the host has a lane and it did not answer usably) and
splitting them further would give a consumer a distinction it cannot act on.
Three `return null` branches therefore become four call sites over three tokens.

### Carrying the reason to the call site

`generatePrompts` returned `TriggerPromptSet | null`, which is exactly what
destroyed the distinction. It now returns a small file-local discriminated type
(`:657-661`), with a `skippedGeneration()` helper (`:663`):

```ts
type TriggerPromptGeneration = { readonly status: 'ok'; readonly prompts: TriggerPromptSet } | { readonly status: 'skipped'; readonly reason: TriggerEvalPromptSkipReason };
```

No out-param, no widening of the public `TriggerEvalOutcome` (deliberately not
reused — it would let a generation result escape `evaluate` without passing the
checks below it). Call site at `:405-409`. `TriggerEvalPromptSkipReason` (`:206`)
narrows to the three prompt-stage members.

### The classification, exported once

```ts
export const RETRYABLE_TRIGGER_EVAL_SKIP_REASONS: ReadonlySet<TriggerEvalSkipReason> = new Set([laneFailed, unusableReply]); // :217
```

A set rather than a per-call-site `if`, so every consumer answers
"can a retry get past this" the same way.

### Consumer at `skill-synthesis.service.ts:1108` — what it actually wanted

Its own docblock resolved this: it wanted **permanent → `skipped`, retryable →
`unscored`**, and settled for `unscored` for all three only because one token
gave it no way to say so ("`unscored` is chosen because its failure mode is
bounded and the other's is not"). The new code says it explicitly:

```ts
// skill-synthesis.service.ts:1117
return RETRYABLE_TRIGGER_EVAL_SKIP_REASONS.has(outcome.reason) ? { outcome: 'unscored', reason: outcome.reason } : { outcome: 'skipped', reason: outcome.reason };
```

So `noLane` now joins `disabled` / `noEmbedder` / `noDescription` as `skipped`
(a host with no LLM does not grow one on a retry, exactly like `noEmbedder`),
while `laneFailed` / `unusableReply` stay `unscored` and re-eligible under
`not_before`. The docblock (`:1060-1090`) was rewritten to match and records
that `lane-failed` is still unavailable from here — the gate hands over a reason
token, not a `SkillLaneFailure` — so a timed-out lane still lands on the default
`unscored` backoff rather than the lane's own `retryAfterMs`. That widening was
left out of scope.

Import at `:91` swapped from `TRIGGER_EVAL_SKIP_REASONS` (now unused in that
file) to `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS`. No other change to
`skill-synthesis.service.ts` — TASK_2026_256 owns splitting that file.

### Every consumer found (repo-wide `rg` for the symbol AND the literal string)

| Site                                                            | Action                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/gates/trigger-eval.service.ts:167,178,180,182`         | definition — rewritten                                                                      |
| `src/lib/gates/trigger-eval.service.ts:406` (was `:360`)        | producer — now forwards the specific reason                                                 |
| `src/lib/skill-synthesis.service.ts:91,1117`                    | the only production consumer — updated                                                      |
| `src/index.ts:307`                                              | public export — kept; `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` added at `:311` (additive only) |
| `src/lib/gates/trigger-eval.service.spec.ts`                    | updated (below)                                                                             |
| `src/lib/skill-synthesis.stage-handlers.spec.ts:750-760`        | mapping table updated (below)                                                               |
| `.ptah/specs/TASK_2026_180/CONTINUATION.md:586`, `CLAUDE.md:70` | prose — CLAUDE.md corrected; the historical CONTINUATION note left as history               |

No consumer outside `libs/backend/skill-synthesis` references these tokens.
`rpc-handlers`, `cli-engine`, `thoth-runtime`, `skill-synthesis-ui` and the
frontend Activity surfaces do not import them.

### Is any old token value persisted?

**Yes — and it is display-only.** The reason string is written to
`skill_synthesis_queue.reason` by `SkillQueueStore.markSkipped` (`:464-471`) and
`markUnscored` (`:320-330`), so rows finished before this change can hold the
retired `trigger-eval-prompt-generation-unavailable`. **Nothing reads that column
back for a comparison** — `toQueueRow` surfaces it as `SkillQueueRow.reason`
(`:621`) for display, and a repo-wide search for `.reason ===` against any
`trigger-eval-*` literal returns no matches. So stored rows are not broken; they
are stale history that renders as it always did. No migration is warranted: the
column is free-text and a row's terminal reason is a record of what happened at
the time, not a key. Flagging it here as required rather than acting on it.

---

## D. Tests — extended in place, no new spec files

**`src/lib/queue/skill-drain.budget.spec.ts`** (existing file)

- `defers a trigger-eval row once the budget is exhausted mid-tick` — the
  regression guard for the whole task. A `judge` row exhausts the cap mid-tick;
  asserts the `trigger-eval` row was never claimed, `budgetDeferred: 1`,
  `budgetExhausted: true`, and `markSkipped` not called (deferred ≠ skipped).
- `ranks trigger-eval after judge and before digest under cheap-first` — window
  holds `digest`, `trigger-eval`, `judge` in that enqueue order at 80 % of
  budget; asserts dispatch order `judge-1, trigger-eval-1, digest-1`.
- Header comment corrected.

**`src/lib/gates/trigger-eval.service.spec.ts`** (existing file)

- `makeLane` reworked from `TriggerPromptSet | null` to
  `TriggerPromptSet | LaneOutage`, where `LaneOutage` is
  `'unavailable' | 'failed' | 'throws' | 'unusable'` — so all four branches are
  driven through the **real service**, not asserted against the constant map.
- Replaced the single `noPrompts` case with a 4-row table asserting each branch
  yields its own token, and that all four still write nothing
  (`recordTriggerEval` never called — a host that cannot run the gate must not
  clear a previous measurement).
- `separates the PERMANENT prompt skip from the retryable ones` — pins
  `RETRYABLE_TRIGGER_EVAL_SKIP_REASONS` membership for all six reasons.

**`src/lib/skill-synthesis.stage-handlers.spec.ts`** (existing file)

- The `%s maps to %s` table at `:750` grew from 4 rows to 6: `noLane →
skippedItems`, `laneFailed → unscored`, `unusableReply → unscored`. This is
  the consumer-behaviour guard for the `:1108` change, driven through the real
  drain.

### Mutation check (the guards actually bite)

Temporarily reverted the two production edits (removed `'trigger-eval'` from
`TOKEN_SPENDING_STAGES`, restored `judge: 4` / `'trigger-eval': 3`) and re-ran
`skill-drain.budget.spec.ts`:

```
● SkillDrainService — budget (R3) › defers a trigger-eval row once the budget is exhausted mid-tick
  expect(received).toEqual(expected)   > 268 | expect(ran).toEqual(['judge-1']);
● SkillDrainService — budget (R3) › ranks trigger-eval after judge and before digest under cheap-first
  expect(received).toEqual(expected)   > 309 | expect(ran).toEqual(['judge-1', 'trigger-eval-1', 'digest-1']);
Tests:       2 failed, 9 passed, 11 total
```

Source file restored from backup and re-verified before the final gate run.

---

## E. `context.md` updated

Appended two sections above `## Provenance`, leaving the existing prose
untouched: **Decision taken (2026-08-16)** — "count it honestly", probe caching
deferred-not-rejected, and the list of every place the false premise was written
down — and **The skip-reason split, done in the same pass**.

---

## Verification gate — real output

```
$ npx nx test skill-synthesis --skip-nx-cache
Test Suites: 6 skipped, 62 passed, 62 of 68 total
Tests:       37 skipped, 1268 passed, 1305 total
NX  Successfully ran target test for project @ptah-extension/skill-synthesis

$ npx nx typecheck skill-synthesis
> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
NX  Successfully ran target typecheck for project @ptah-extension/skill-synthesis

$ npx nx lint skill-synthesis
✖ 30 problems (0 errors, 30 warnings)
NX  Successfully ran target lint for project @ptah-extension/skill-synthesis
```

**Lint: 0 errors.** All 30 warnings are pre-existing and in files this task did
not touch (`skill-registry.store.spec.ts`, `spec-harvester.*.spec.ts` — unused
`eslint-disable` directives and `no-explicit-any` in test scaffolding). Filtering
the lint output for the six touched files returns nothing.

`src/index.ts` exports changed (additive), so dependents were checked:

```
$ npx nx run-many -t typecheck -p rpc-handlers cli-engine thoth-runtime
NX  Successfully ran target typecheck for 3 projects

$ npx nx test rpc-handlers --skip-nx-cache
Tests:       31 skipped, 2132 passed, 2163 total
NX  Successfully ran target test for project @ptah-extension/rpc-handlers
```

Nothing red.

---

## Files changed

```
libs/backend/skill-synthesis/CLAUDE.md
libs/backend/skill-synthesis/src/index.ts
libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts
libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.spec.ts
libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts
libs/backend/skill-synthesis/src/lib/queue/skill-drain.budget.spec.ts
libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts
libs/backend/skill-synthesis/src/lib/skill-synthesis.stage-handlers.spec.ts
.ptah/specs/TASK_2026_253/context.md
```

No commit made — the orchestrator owns git. `task.md` was not modified by this
agent (its `status: in_progress` was already set).

## Constraints honoured

No probe cache. No refactor of `skill-synthesis.service.ts` beyond the `:1108`
consumer and its docblock (TASK_2026_256 owns that file). TASK_2026_242 and
TASK_2026_245 untouched. No `@ts-ignore`, no compat alias for the retired token,
no dead code. `catch (error: unknown)` narrowing preserved at the one catch site
touched.
