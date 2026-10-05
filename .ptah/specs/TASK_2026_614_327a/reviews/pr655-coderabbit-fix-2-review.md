# Code Logic Review — `TASK_2026_614_327a` / PR #655 CodeRabbit fix 2 (held-start exact-key discard)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 1        |
| Failure modes found | 2        |

Scope: the uncommitted `git diff` (5 files): `subagent-state-store.ts` (+spec), `subagent-registry.service.ts`, `subagent-hook-handler.ts` (+spec). I read the changed functions plus every caller of `discardHeldUnboundStarts` / `holdUnboundStart` in `libs/` (grep across all libs, specs excluded): `subagent-hook-handler.ts:336,467`, `subagent-registry.service.ts:808-908`, `subagent-state-store.ts:332-370,456-463`.

Why 7 rather than 8: the store semantics are now exactly what was asked, and no caller depended on the wildcard. But the production path never holds a start without a session, so the new `undefined` key never matches anything. An unresolved stop now does nothing to the held start that most likely belongs to it (Moderate, below). Also, the handler spec would pass against the old code. Why not 6: no Blocking or Serious path was found, and the trigger needs an unlikely SDK payload asymmetry.

## Five logic questions

### 1. How does this fail silently?

When a SubagentStop resolves no parent session, `subagent-hook-handler.ts:467-471` calls `discardHeldUnboundStarts(agentId, undefined)`. The production path never holds anything under `undefined`:

- The hook only holds when the session resolves (`subagent-hook-handler.ts:278-279`).
- The service refuses a blank session (`subagent-registry.service.ts:813-818`).

So this call is always a no-op that drops nothing, and it logs nothing either, because the debug log fires only when `count > 0` (`subagent-registry.service.ts:902`).

### 2. What user action produces unexpected behaviour?

None is new. A foreground Task runs and stops, then the Task result arrives. With symmetric session ids, the stop discards the start under the same key the hook resolved (payload first, `resolveHookSessionId`). The later `bindHeldStartToToolCall` then returns `no-held-start`, which is correct.

### 3. What input data produces a wrong answer?

Take a SubagentStart whose payload `session_id` is `'A'`, so the start is held under `A`. Its SubagentStop for the same `agent_id` arrives with a blank `session_id`, and the closure parent is also `''` or `undefined`. The stop resolves `null` and becomes `undefined` (`subagent-hook-handler.ts:469-470`). The exact-key discard leaves `A`'s start in place. The Task result then binds it at `subagent-registry.service.ts:874-882` as a **running** record of an agent that has already finished: the zombie class. The old wildcard covered this case and the new code does not. See Moderate M1.

### 4. What happens when a dependency fails?

There is no new I/O. The store is in-memory. TTL cleanup (`subagent-state-store.ts:456-463`) still removes leftover held starts after 24 h, so a leaked held start is bounded.

### 5. What is missing that the requirements never mentioned?

A disambiguation rule for an unresolved stop when exactly one held start names the agent. That start is unambiguous, and leaving it is what produces the zombie in Q3.

## Failure modes

### Unresolved stop leaves the agent's only held start bindable

- Trigger: the SDK sends `session_id` on SubagentStart but a blank one on SubagentStop, and the closure parent is blank or undefined.
- Symptom: after the Task result, the subagent shows as running with no live agent behind it. Stop and steer target a finished agent until the 24 h TTL.
- Evidence: `subagent-hook-handler.ts:467-471`, `subagent-state-store.ts:363-366`, `subagent-registry.service.ts:857-882`.
- Current handling: exact-key discard on `undefined` matches nothing.
- Recommendation: when the stop's key is unresolved and `getHeldUnboundStarts(agentId).length === 1`, drop that single start. Doing so is safe for other sessions: when there are several, bind already returns `ambiguous` (`:861-871`), so no other session's start can be bound wrongly by leaving them.

### `already-registered` with a session-less record no longer clears other sessions' starts

- Trigger: `bindHeldStartToToolCall` finds an existing record whose `parentSessionId` is `undefined` (the type allows it), while held starts for the same agent exist under a resolved id.
- Symptom: those held starts linger. Before this change the `undefined` wildcard dropped them.
- Evidence: `subagent-registry.service.ts:851-855`.
- Current handling: drops only the `undefined` key. The doc comment at `:834-835` was updated to match this.
- Recommendation: acceptable as intended exact-key behaviour. TTL bounds it. Listed for awareness only (Minor).

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **M1 (Moderate):** the residual zombie described in Q3 and under the first failure mode, at `subagent-hook-handler.ts:467-471`. The unresolved-key discard can never match a production-held start, because holds always carry a resolved session (`subagent-hook-handler.ts:278`, `subagent-registry.service.ts:813-818`). The requirement "nothing left behind that could later bind as a running zombie" therefore holds only when the start and stop payloads resolve symmetrically. This is likely but not guaranteed.
- **Minor:** the handler spec (`subagent-hook-handler.spec.ts` +713-764) reimplements the store semantics inside the mock. The handler code itself only changed comments, so this spec passes against the old code and does not pin the fix. The real regression guard is the first new store spec. On the old code `discard(..., undefined)` returned 2, not 1, so that spec fails correctly.
- **Minor:** the second new store spec ("holds a blank parent session under the unresolved key") also passes against the old code. Old: `''` was held under `''`, and the `undefined` wildcard deleted it, returning 1. To make it fail on the old code, hold a second start under `'parent-a'` and assert that it survives.
- **Minor:** in the store, `holdUnboundStart` and `discardHeldUnboundStarts` both normalise through `blankToUndefined` (`subagent-state-store.ts:333,365`), so `''` and `undefined` are one key. The service's own gate makes that branch unreachable in production. This is harmless, but the session-less key exists only for direct store callers and specs.
- **Minor:** the debug log at `subagent-registry.service.ts:902-906` is skipped on a zero-count discard. Logging the unresolved-stop/no-match case once would make M1 observable.

## Data flow

1. SubagentStart without `toolUseId`: `resolveParentSessionId(payload, closure)` (`:249`). If it resolves, `bindStartByAgentId` holds under the resolved id (`:336`). Otherwise nothing is held. OK.
2. Service `holdUnboundStart`: gates blank agent and session ids (`:813-818`), then the store normalises the key and replaces an existing start under the same key (`:333-337`). OK.
3. SubagentStop with no record: discard with the same payload-first resolution (`:469`). OK when symmetric. Gap M1 when the stop resolves to `null` and the start did not.
4. Task result, then `bindHeldStartToToolCall`: `getHeldUnboundStarts` is not session-filtered (`:857`), so it finds a start held under any key, including `undefined`. With exactly one it binds and discards by that start's own key (`:875`). With more than one it returns `ambiguous`. OK.
5. TTL cleanup removes held starts older than 24 h (`state-store:456-463`). OK.

## Requirements fulfilment

| Requirement                                                     | Status   | Gap                                                                    |
| --------------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `discard(X, undefined)` removes only starts held without a session | COMPLETE | —                                                                      |
| `discard(X, 'A')` removes only A's                              | COMPLETE | —                                                                      |
| Hold and discard normalise blank and undefined the same way     | COMPLETE | `blankToUndefined` on both sides (`state-store:333,365`)               |
| Hold and discard use the same payload-first resolver            | COMPLETE | `:249` and `:469` both use `resolveParentSessionId`                    |
| No caller relied on "all sessions"                              | COMPLETE | 3 callers (`hook:467`, `service:853`, `service:875`); none needed the wildcard; `:853` changed meaning for session-less records only (Minor) |
| Bind still finds a start held without a session                 | COMPLETE | `getHeldUnboundStarts` is unfiltered; discard by `start.parentSessionId` (`undefined`) matches |
| Nothing is left behind that could bind as a running zombie       | PARTIAL  | Holds only when start and stop resolve symmetrically (M1)              |
| Specs fail on the old code                                      | PARTIAL  | Only the first store spec does                                         |

Implicit requirements not addressed: a disambiguation rule for an unresolved stop when only one held start exists (M1).

## Edge cases

| Case                                              | Handled | How                                    | Concern                         |
| ------------------------------------------------- | ------- | -------------------------------------- | ------------------------------- |
| Same agentId held in sessions A and B, stop from A | YES     | Exact key `A`                          | —                               |
| Stop is unresolved, start is held under A         | NO      | No-op discard                          | Zombie after Task result (M1)   |
| Blank vs undefined session                        | YES     | `blankToUndefined` in hold and discard | —                               |
| Repeated hold under the same key                  | YES     | Replace-by-key filter (`:336`)         | —                               |
| Two held starts, then Task result                 | YES     | `ambiguous`, no bind                   | Unbound until TTL (pre-existing) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: when start and stop payloads resolve asymmetrically (stop has no session), the agent's only held start survives, and the Task result binds it as a running zombie.
- What a robust implementation would add:
  - On an unresolved stop, drop the held start when exactly one names the agent.
  - A debug log when an unresolved discard matched nothing.
  - Handler and store specs that fail against the pre-fix code.
