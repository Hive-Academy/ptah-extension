# Code Logic Review — `TASK_2026_704_8918`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

The 8 second lookup deadline is correctly forwarded to the lane lookup, but it starts after an unbounded lane list. It therefore does not guarantee a reply within the renderer's 10 second deadline. A successful response containing timeout rows renders as unknown; the live source can retain those rows indefinitely. Score 5 reflects a valid local lookup fix with the reported cold-start failure still possible; a lower band would require a broken ordinary lookup path, and a higher band would require a bounded end-to-end read.

## Numbered findings

1. **Serious — the RPC still times out on a cold list.** `lane-plan-limits-rpc.handlers.ts:123-127` awaits `agent.list()` before passing `deadlineMs: 8_000`. `agent-namespace.builder.ts:464-465,477-483` awaits CLI detection and optionally the registry. `cli-detection.service.ts:87-104,114-149` runs seven adapter detections sequentially, with no overall deadline. If listing takes over about 2 seconds, even a lookup that uses its full permitted 8 seconds exceeds the renderer's 10 seconds (`ptah-ui-lane-limits.source.ts:17-18,129-135`). A hung detection can leave the backend handler pending indefinitely. Set one end-to-end deadline before listing, bound or cancel the list, and pass only the remaining budget to lookup. The implementation's own comment acknowledges this gap at `lane-plan-limits-rpc.handlers.ts:57-59`.
2. **Moderate — timeout rows can remain current-looking indefinitely.** The lookup turns missed reads into timeout/unknown rows (`lane-limit-lookup.service.ts:152-180,247-255`), and the handler returns them as a successful result (`lane-plan-limits-rpc.handlers.ts:105-110,175-186`). The frontend copies them into an `available` state (`ptah-ui-lane-limits.source.ts:119-125,161-177`) and rereads only on a PlanLimitsStore snapshot change or a new acquire burst (`:93-116`); a new burst preserves an available result at `:93-97`. The resolver renders these rows and an `as of` time (`ptah-ui-resolver.ts:378-394`). If a transient cold read times out and no snapshot changes, the user keeps seeing unknown plan state even after the reader recovers. Add a bounded retry or freshness policy for partial timeout results. The timeout result is not written to the backend plan-usage cache: the timeout is formed after the read race in `lane-limit-lookup.service.ts:247-255`; `plan-usage.service.ts:175-193,347-380` caches provider readings rather than lane timeout rows.
3. **Minor — the deadline spec does not exercise the unresolved list boundary.** `lane-plan-limits-rpc.deadline.spec.ts:96-122` substitutes an immediate `list()` and a timer-based fake `limits()`. Its assertion at `:173-185` proves that the handler forwards a short lookup deadline when listing is immediate, not that the real end-to-end handler meets 10 seconds after slow detection. Add a fake-timer case where `list()` consumes more than 2 seconds, and assert the intended overall deadline behavior. The current spec's timer fires during `advanceTimersByTimeAsync(10_000)` at `:176`; no timer leak is evident from this fake, but `afterEach` at `:154-156` does not assert timer disposal and no real `LaneLimitLookupService` is used.

## Five logic questions

### 1. How does this fail silently?

A per-lane timeout becomes a successful `available` response (`lane-limit-lookup.service.ts:247-255`; `ptah-ui-lane-limits.source.ts:142-148,161-177`). The state cell says “limit lookup timed out” through `agent-limit.formatter.ts:267-275,340-377`, so the row itself is explicit, but its successful live-source status does not cause a retry. It can remain stale as described in finding 2.

### 2. What user action produces unexpected behaviour?

Opening the Plan Limits panel on a cold host initiates the read (`ptah-ui-lane-limits.source.ts:77-81,93-107`). If the sequential list consumes enough time, the 10 second renderer timer logs an RPC timeout and removes the pending correlation (`claude-rpc.service.ts:154-166`), although the handler may later return (`lane-plan-limits-rpc.handlers.ts:123-127`).

### 3. What input data produces a wrong answer?

Slow lanes produce `unknown` rather than false numeric usage, which is correct (`lane-limit-lookup.service.ts:247-255`; `lane-plan-limits-rpc.handlers.ts:180-185`). The wrong *current* answer occurs when those timeout rows remain displayed after the reader recovers without a snapshot event (`ptah-ui-lane-limits.source.ts:93-116,119-125`).

### 4. What happens when a dependency fails?

A rejected list becomes a fixed unavailable error (`lane-plan-limits-rpc.handlers.ts:122-133`); a lane snapshot failure becomes a failed/unknown row (`lane-limit-lookup.service.ts:184-213,247-255`). A list that never settles has no backend timeout at `lane-plan-limits-rpc.handlers.ts:123-127`; only the renderer timer ends its wait (`claude-rpc.service.ts:154-166`).

### 5. What is missing that the requirements never mentioned?

An end-to-end time budget covering detection, optional registry listing, lookup, and response formatting, plus a refresh rule for transient partial timeout rows (`agent-namespace.builder.ts:464-483`; `ptah-ui-lane-limits.source.ts:93-126`).

## Failure modes

### Cold list exhausts the caller deadline

- Trigger: sequential detection or registry listing takes more than the margin left before the 8 second lookup (`agent-namespace.builder.ts:464-483`; `lane-plan-limits-rpc.handlers.ts:123-127`).
- Symptom: the renderer logs `RPC timeout for method: agent:getLanePlanLimits` and drops the late response (`claude-rpc.service.ts:154-166,240-244`).
- Current handling: lookup is capped only after listing.
- Recommendation: start and enforce one handler deadline before listing and pass the remaining duration to lookup.

### Transient timeout row remains on screen

- Trigger: a lane misses the lookup deadline, then recovers with no PlanLimitsStore snapshot change (`lane-limit-lookup.service.ts:152-180`; `ptah-ui-lane-limits.source.ts:98-116`).
- Symptom: unknown state and the original `as of` time remain visible (`ptah-ui-resolver.ts:378-394`).
- Current handling: the result is kept in the frontend signal; it is not persisted as a backend timeout cache entry (`ptah-ui-lane-limits.source.ts:70-75,119-125`; `lane-limit-lookup.service.ts:247-255`).
- Recommendation: retry partial timeout results or expire their live-source freshness.

## Data flow

1. Frontend acquires `$limits` and calls RPC with 10 seconds — OK (`ptah-ui-lane-limits.source.ts:77-81,129-135`).
2. Handler awaits `agent.list()` — **unbounded gap** (`lane-plan-limits-rpc.handlers.ts:123-124`; `agent-namespace.builder.ts:464-483`).
3. Namespace forwards optional lookup options without changing one-argument callers — OK (`types.ts:322-333`; `agent-namespace.builder.ts:531-534`; `protocol-dispatcher.ts:270-273`).
4. Lookup races each lane against 8 seconds and clears its timer — OK for the lookup phase (`lane-limit-lookup.service.ts:152-180`).
5. Handler formats timeout rows and counts them unknown — OK (`lane-plan-limits-rpc.handlers.ts:175-198`).
6. Frontend stores available rows; resolver renders the state cell — **freshness gap** (`ptah-ui-lane-limits.source.ts:119-125,161-177`; `ptah-ui-resolver.ts:378-394`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Root-cause claim | PARTIAL | 12 second slow-lane lookup versus 10 second renderer deadline is a valid failure path (`lane-limit-lookup.service.ts:11-16`; `ptah-ui-lane-limits.source.ts:17-18`), but the report's causal attribution to startup contention is not established by timing evidence. |
| Whole handler within 10 seconds | MISSING | Listing precedes the 8 second cap (`lane-plan-limits-rpc.handlers.ts:123-127`). |
| Partial timeout rows displayed | COMPLETE | Formatter emits timeout wording and frontend resolver renders rows (`agent-limit.formatter.ts:267-275`; `ptah-ui-resolver.ts:378-394`). |
| Timeout failure not persisted | PARTIAL | No backend timeout-row write, but frontend signal can retain it indefinitely (`lane-limit-lookup.service.ts:247-255`; `ptah-ui-lane-limits.source.ts:93-125`). |
| Optional options preserve other callers | COMPLETE | Optional type and forwarding retain old one-argument behavior (`types.ts:330-333`; `agent-namespace.builder.ts:531-534`; `lane-limit-lookup.service.ts:130-160`). |
| Deadline spec proves behavior | PARTIAL | Fake timers prove short lookup phase with immediate list; they omit slow list (`lane-plan-limits-rpc.deadline.spec.ts:96-122,158-185`). |
| `git:info` outside diff | COMPLETE | `git diff --name-only` listed only the four named tracked files; the new untracked deadline spec is lane-only. The unchanged git caller still uses 15 seconds (`session-git-stats.store.ts:23,300-310`). |

The task folder's `context.md` and `task.md` describe an NG0956 warning, while `rpc-timeout-investigation.md:1-5` and the review request describe this RPC change. The review follows the explicitly named diff and investigation. No implementation plan, batch file, or code-style review was present in this task folder.

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Empty lane list | YES | Lookup returns immediately (`lane-limit-lookup.service.ts:133`). |
| Rejected list | YES | Fixed unavailable error (`lane-plan-limits-rpc.handlers.ts:122-133`). |
| Hung list | NO | Backend handler has no deadline (`lane-plan-limits-rpc.handlers.ts:123-127`). |
| Slow lane | PARTIAL | Lookup returns timeout row, but row can remain stale (`lane-limit-lookup.service.ts:152-180`; `ptah-ui-lane-limits.source.ts:93-125`). |
| Concurrent reads | PARTIAL | Detection deduplicates its in-flight promise, but all readers await that same unbounded operation (`cli-detection.service.ts:87-104`). |

## Decisions

- Treat the explicit RPC investigation as review scope despite the task folder's older NG0956 carrier and context. Options were to stop or review the named diff; the request and diff give a concrete scope. Reversible.
- Treat the 8 second value as a lookup budget, not a whole-handler budget, because the handler starts it after `await agent.list()` (`lane-plan-limits-rpc.handlers.ts:123-127`). Reversible.

## Verification and verdict

Read the changed handler, new deadline spec, changed signatures and forwarding, lookup service, detection service, frontend source and resolver, formatter, cache write path, RPC timeout path, and scoped diff. The investigation reports 32 handler tests and 76 namespace tests passing, but those checks do not exercise slow `agent.list()`; I did not rerun them. No build, test, typecheck, lint, serve, or e2e was run, as requested. Diagnostics were not requested because this lane was forbidden from typechecking.

- Recommendation: REVISE
- Confidence: HIGH for the missing end-to-end bound; MEDIUM for user impact of retained timeout rows because it depends on future snapshot events.
- Top risk: the original renderer timeout remains possible on the cold path.
- A robust implementation would bound listing and lookup under one deadline, then refresh transient timeout rows.
