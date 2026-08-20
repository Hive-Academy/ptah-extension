# Context — TASK_2026_182

## Origin

Split out of TASK_2026_181 at the Batch 6 gate, on the team-leader's ruling. The
one-line symptom was fixed inside TASK_2026_181; **this task is the durable fix**
and is deliberately allowed to be red while it triages what it uncovers.

## The defect

`scripts/test-native.mjs:50`:

```js
const DEFAULT_PROJECTS = ['persistence-sqlite', 'task-specs'];
```

The comment above it claims these are "the projects whose suites self-skip." That
claim is **false**.

`better-sqlite3` on disk is built for Electron's ABI (143). The Jest runner is
Node (ABI 137). Suites that need the native module therefore guard themselves
with `nativeAvailable ? describe : describe.skip` — and **a skipped suite still
reports green**. `npm run test:native` exists to run Jest under Electron's
ABI-matched Node so those suites actually execute.

Projects carrying that same pocket with **no** coverage from the runner:

| Project              | Status                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rpc-handlers`       | Uncovered — **already hid a real defect**, see below                                                                                                |
| `messaging-gateway`  | Uncovered, untriaged                                                                                                                                |
| `skill-synthesis`    | Uncovered, untriaged                                                                                                                                |
| `apps/ptah-electron` | **Unreachable by construction** — the script resolves configs at a hardcoded `libs/backend/<project>/jest.config.ts`, so no app can be named at all |

## Why this is worth its own task

It has already cost something. During TASK_2026_181 Batch 6, `rpc-handlers` was
found failing under `test:native` **at HEAD**: a SQLite block seeded `:memory:`
with migration `0029` only, while `SqliteTaskIndexStore.insertSql()` had carried
the five `0031` columns since TASK_2026_181 Batch 1 (`3e93069fd`). Every insert
threw and the board came back empty. It was invisible for three batches because
the block self-skips under plain `nx test` **and** `rpc-handlers` is not in
`DEFAULT_PROJECTS`.

That is the same shape as TASK_2026_181's gating note G1 — in a project G1 never
examined. G1 was declared discharged while this one survived.

Adding `rpc-handlers` to the list was considered and **rejected**: it fixes one
pocket of four and re-commits to the hand-maintained list that caused the problem,
which buys false confidence. This repo already has the general principle on
record in `CLAUDE.md` — never hand-maintain an exclusion list.

## Scope

1. **Derive** the project list rather than hardcoding it — discover the suites
   that guard on native availability, so a new one is covered the day it is
   written.
2. **Fix app-path resolution** so `apps/*` projects are nameable at all.
3. **Triage what turns red.** `messaging-gateway` and `skill-synthesis` have
   never executed their native paths. Either could be broken exactly as
   `rpc-handlers` was. This is the unbounded part, and the reason this work must
   not gate a feature batch.

## Also worth folding in — `ptah-cli:test` flakiness has TWO distinct causes

Nx independently flagged `ptah-cli:test` flaky during the same gate. Two separate
mechanisms were observed, and they need different fixes. Do not treat them as one.

**Cause 1 — a test bug.** The known `NO_COLOR` failure (`HumanFormatter › writes a
colored notification by default`) did **not** reproduce across three later runs.
`formatter.spec.ts:251-277` mutates a process-global, which is a far likelier
explanation than a deterministic environment failure. This has been reported as
"pre-existing and environmental" in several TASK_2026_181 batch reports on the
assumption it was deterministic — that assumption looks wrong.

**Cause 2 — runner cache isolation, and this one is nastier.** Observed once
during the Batch 6 gate: an entire suite failed to _collect_, taking the run
total down by 16 tests while reporting a single failure.

```
FAIL  ptah-cli  apps/ptah-cli/src/cli/commands/cron-extended.spec.ts
  ● Test suite failed to run
    jest: failed to read cache file: C:/Users/abdal/AppData/Local/Temp/jest/
      jest-transform-cache-…/4b/resultmessagetransformer_…
    Failure message: EPERM: operation not permitted, open '…'
      at readCacheFile (@jest/transform/build/index.js:744:21)
```

A Windows `EPERM` on Jest's **shared** transform cache in `%TEMP%` — concurrent Nx
targets writing one cache directory, or a scanner holding the file. The immediate
re-run was clean.

This is not a `ptah-cli` problem; it would reproduce on **any** project, and the
stack is entirely third-party (`cron.ts` → `cli-engine` → `agent-sdk`). It is
also the more dangerous of the two: a collection failure **reduces the reported
total** rather than showing a red assertion, so a run that silently drops a whole
suite can be mistaken for a smaller-but-green run. That is the same failure mode
as the self-skip problem above — evidence quietly disappearing rather than
announcing itself — which is why it belongs in this task rather than elsewhere.

**Cause 3 — a wall-clock assertion that flakes under load.**

`libs/shared/src/lib/types/task-filter.spec.ts:959` —
`filterTasks — scale › filters 1 000 tasks on every facet at once well inside a
frame` asserts `expect(elapsed).toBeLessThan(16)`.

Observed failing once during the TASK_2026_181 Batch 8 gate (`shared: 1 failed,
627 passed, 628 total`), and passing in the run immediately before and the two
after. The batch that hit it had made only a type-level edit to `libs/shared`,
erased at runtime and incapable of affecting `filterTasks`. Concurrent activity
in this repo is the likely trigger.

The assertion itself is legitimate — it is TASK_2026_181's NFR-10 budget, and
the measured figures are 1–4 ms, an order of magnitude clear. The problem is the
_form_: a wall-clock threshold on a shared machine will flake regardless of how
much headroom it has, and a flaky red is corrosive in a different way to a silent
green — it trains people to re-run rather than read.

Worth considering: keep the budget but make the failure meaningful under load
(median of N runs, or a generous CI-only ceiling with the tight one local). Do
**not** simply delete it — the structural half of that test, asserting
`store.graph()` is the same object reference across a filter change, is what
actually proves the signal graph is not coupled, and it is not timing-dependent.

> ## ✅ RESOLVED during TASK_2026_181 Batch 9 — root cause was NOT machine load
>
> Both assertions were fixed inline during Batch 9 because the flake rate had
> reached **1 in 2 at 4× budget** (62.07 ms against 16 ms, with Nx flagging both
> `shared:test` and `tasks-ui:test`), which would have handed the remaining
> batches a gate that fails half the time.
>
> **The real cause was a Windows timer artifact, not load.**
> `task-filter.spec.ts` used `Date.now()`, whose tick granularity on Windows is
> **~15.6 ms**. A ~1 ms operation therefore measures **0 or 15.6, with nothing in
> between** — a coin flip against a 16 ms budget, which is precisely a 1-in-2
> failure rate. It also explains why generous headroom never helped: the
> measurement had no resolution to express the headroom with.
>
> Fixed by switching to `performance.now()` and taking the **median of 9 timed
> runs after an untimed warm-up**. The 16 ms ceiling was deliberately **kept** —
> the budget was never the problem, and loosening a budget to hide a measurement
> artifact stops it catching the regressions it exists for. Measured warm medians
> are 0.34 ms and 0.38 ms (47× and 42× headroom), while the two regressions worth
> catching — a quadratic predicate, and the graph rebuilt per call — cost tens to
> hundreds of milliseconds at n=1000 and trip it immediately.
>
> Verified: dropping both ceilings to 0.05 ms turns both red; then 8 consecutive
> runs of each previously-flaky suite passed, and three consecutive full gates
> showed byte-identical totals with **no Nx flaky-task warning**.
>
> **The lesson generalizes and is why this stays on file**: before loosening or
> deleting a timing assertion, check the resolution of the clock it uses. Also
> preserved unchanged was the structural half of that test —
> `expect(store.graph()).toBe(warmGraph)` — which is what actually proves the
> signal graph is uncoupled and is not timing-dependent.

**There are TWO wall-clock assertions in this family, in different projects.**
Both observed flaking (history retained below):

| Test                                                                                   | File                                                                      | Observed                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `filterTasks — scale › filters 1 000 tasks on every facet at once well inside a frame` | `libs/shared/src/lib/types/task-filter.spec.ts:959`                       | failed once at the Batch 8 gate; did not reproduce across four later uncached runs                  |
| `TasksStore › filter and sort › recomputes 1 000 tasks in under 16 ms`                 | `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts:575` | reported **30.8 ms** on one Batch 9 gate run; three consecutive uncached runs afterwards were clean |

In the Batch 9 case the file under test and its spec both had **zero diff** in
that batch. Fix both together — they are the same defect in two places, and
fixing one would leave the reflex it trains fully intact.

A note on why this matters more than its severity suggests, from the Batch 8
team-leader: _a test that is red for reasons unrelated to the change teaches
people that red means "run it again" — which is precisely the reflex that lets a
real regression through._ Several agents on TASK_2026_181 explicitly reported a
flake rather than re-running past it, and that behaviour is what a wall-clock
assertion erodes. Generous headroom (1–4 ms measured against a 16 ms bound) does
not fix this; it only makes the flake rarer and therefore more surprising.

## Constraints

- `.ptah/**` is gitignored — no git undo for anything written there.
- Do not weaken or delete a self-skip guard to make a suite pass. The guard is
  correct; the runner's coverage is what is wrong.
- A suite that cannot run is not a suite that passes. Report skipped as skipped.
