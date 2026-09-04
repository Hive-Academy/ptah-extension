# Context

## Where this came from

TASK_2026_306's headline finding was that an exhausted provider quota stalled
the whole boot. A cluster of related defects came out of the same log. This one
was recorded and left: it is a throughput problem, not a correctness one, and
the correctness half was fixed there.

## The defect

Two call sites, both acquiring before the work:

```
memory-trigger.service.ts:470   const decision = this.rateLimiter.tryAcquire(…)
memory-trigger.service.ts:657   const decision = this.rateLimiter.tryAcquire(…)
```

`CuratorRateLimitService`
(`libs/backend/agent-sdk/src/lib/helpers/curator-rate-limit.service.ts`) has no
refund. A token acquired is a token spent, regardless of what the pass then
managed to do.

## The failure sequence

1. Provider quota is exhausted.
2. A cue fires. `tryAcquire` succeeds — one token spent.
3. The curate stalls. Nothing is curated.
4. Repeat until `maxCuratesPerHour` is exhausted.
5. Quota comes back. The curator now has the largest backlog it will ever have
   and no budget left to work through it, until the hour rolls over.

The throttle is worst exactly when the need is greatest.

## What this is NOT

**It is not data loss.** TASK_2026_306's Batch 10 (`5dfedc09c`, _"keep a stalled
curation pass's input instead of discarding it"_) fixed the separate defect
where a stalled pass drained and discarded its own episode buffer. The rows now
survive the stall. The live evidence for that one is
`tmp/logs/coldstart-306.log:1232-1260` — fifteen skip-passes in a tight loop.

This task is only about the spent budget.

## The fix, and which shape to prefer

Two options:

**A — move the acquire.** Call `tryAcquire` after the pass is known to have done
real work.

**B — add a refund.** Give `CuratorRateLimitService` an explicit `refund(...)`
and call it from the stall branch.

**Prefer B.** The acquire is early for a reason: it is what stops two concurrent
passes both proceeding. Moving it past the work opens a window where two passes
are in flight and both later acquire. A refund keeps the serialisation property
and only corrects the accounting.

Whichever is chosen, the refund must be conditional on a genuine stall. A pass
that ran, curated little, and returned normally has consumed real provider
capacity and must not be refunded.

## Blast radius — wider than the original finding

`CuratorRateLimitService` is not memory-curator's. It lives in
`agent-sdk/src/lib/helpers/` and is exported from the `agent-sdk` barrel. Three
consumers:

| Consumer        | File                                 |
| --------------- | ------------------------------------ |
| memory-curator  | `triggers/memory-trigger.service.ts` |
| skill-synthesis | `skill-curator.service.ts`           |
| skill-synthesis | `triggers/skill-trigger.service.ts`  |

A refund API is therefore a change to a shared service. The skill-synthesis
consumers have the same stall exposure — TASK_2026_306's whole quota-gate batch
was about the skill lane stalling on an exhausted provider — so consider whether
they should call the refund too, even if the initial implementation only wires
the memory-curator branch.

## Scope

- A refund path on `CuratorRateLimitService`, with its own spec.
- The memory-curator stall branch calling it.
- An explicit decision, recorded, on whether the two skill-synthesis consumers
  call it now or later.
- A spec proving that N stalled passes leave the hourly budget intact, and that
  N successful passes still consume it. The second half matters — a refund that
  fires unconditionally removes the rate limit entirely.

## Ordering with TASK_2026_310

TASK_2026_310 splits `MemoryTriggerService`, which owns rate limiting as one of
its six concerns. Doing this task first is cheaper — a small behavioural fix in
the current structure, rather than a behavioural change rebased onto a moved
file. Do not run both at once.
