# Code Logic Review — PR #605 CodeRabbit Follow-up Fixes (`TASK_2026_575_74a4`)

> **SAME-SIDE DISCLOSURE**: This review was performed by an in-process
> subagent, not an independent CLI lane. All CLI lanes were unavailable at
> review time (Codex: usage limit; Glm/Ollama: session limit; Antigravity:
> quota; opencode: error). The independence guarantee normally provided by a
> separate vendor lane does not apply to this review.

## Summary

| Metric              | Value                                   |
| -------------------- | --------------------------------------- |
| Overall score        | 6/10                                    |
| Assessment            | NEEDS_REVISION                          |
| Blocking issues       | 0                                       |
| Serious issues        | 1                                       |
| Moderate issues       | 1                                       |
| Failure modes found   | 1 pre-existing failure mode surfaced/amplified by fix 2 |

Fixes 1 and 3 are correct, complete, and cleanly scoped to their reported
CodeRabbit findings, with tests that exercise the actual defect rather than
restating the implementation. Fix 2 solves the specific race it targets
(stats-batch seed vs. in-flight push for the *same* session) but the guard it
adds (`pushGeneration`) is a single global counter that is bumped by a push
for **any** session, not just the active one. Combined with the pre-existing
fact that `handleStats` accepts and displays a push for a session other than
`activeSessionId`, this reintroduces a related race the fix's own commit
message does not claim to close: a background/other-session push arriving
while a seed for the active session is in flight both (a) overwrites
`this.stats` with the other session's numbers and (b) silently drops the
active session's legitimate seed result, leaving the UI showing another
session's cost/tokens under the active session's tab until the next
`loadSession`/push.

## Per-fix review

### Fix 1 — `Object.hasOwn` guard in `lookupPricingEntry`

`libs/shared/src/lib/utils/pricing.utils.ts:332-338`

```ts
for (const id of exactIds) {
  if (id && Object.hasOwn(modelPricingMap, id) && modelPricingMap[id]) {
    return modelPricingMap[id];
  }
}
```

- Both call sites that matter — `findModelPricing` (`pricing.utils.ts:229`)
  and `getModelContextWindow` (`pricing.utils.ts:521`) — funnel through this
  single `lookupPricingEntry`, so the guard is not something a sibling path
  could bypass.
- The date-snapshot partial-match fallback (`pricing.utils.ts:346-362`)
  already iterates `Object.entries(modelPricingMap)`, which was never
  susceptible to prototype pollution (`Object.entries` only ever returns own
  enumerable properties), so it is correctly left untouched — no regression
  there.
- `modelPricingMap` is rebuilt via `{ ...modelPricingMap, ...newPricing }`
  (`pricing.utils.ts:138`), a plain object literal, so `Object.hasOwn` behaves
  as intended for every legitimately registered id, including one that
  happens to collide with an `Object.prototype` member name (verified by the
  spec's "still resolves a registered own entry with a prototype-like name"
  case).
- Tests (`pricing.utils.spec.ts:805-841`) cover `constructor`, `x/constructor`,
  `x/constructor[1m]`, `__proto__`, and `toString` through all three public
  entry points (`findModelPricing`, `calculateMessageCost`,
  `getModelContextWindow`), and assert the previously-vulnerable
  `modelPricingMap[id]` truthy branch is genuinely `undefined` now, not just
  that the caller happens to render something reasonable. These are not
  tautological — running them against the pre-fix line (`if (id &&
  modelPricingMap[id])`) would fail, since `modelPricingMap['constructor']`
  resolves to `Object.prototype.constructor` (the `Object` function), a
  truthy, non-`ModelPricing` value that would then be spread/read as pricing
  fields and produce `NaN`.

No defects found in this fix. It is fully verified: ran green
(`122 passed, 122 total`).

### Fix 2 — `pushGeneration`/`seedSequence` race guard in `SessionController`

`apps/ptah-tui/src/hooks/use-sessions.ts:218-221, 302-328, 356-362`

The four new tests (`use-sessions.spec.ts:433-492`) precisely match the four
scenarios asked for and all pass:

- a) push-then-older-batch → push kept (`:433`)
- b) push-then-batch-rejects → not null, push kept (`:447`)
- c) no push → batch applied (`:462`)
- d) switch A→B, B resolves then stale A resolves → stats stay B (`:476`)

None of these are tautological; each asserts a value that the pre-fix code
(unconditional `this.stats = next`) would have gotten wrong (e.g. test (a)
would have shown the older batch's `costUSD: 5` instead of the push's `20`
without the guard).

**Can a legitimate seed be dropped forever, leaving stats null/stale after a
load with no later push?** No — in the single-load, no-push, no-competing-seed
case, `seed === seedSequence`, `pushGeneration === this.pushGeneration`, and
`activeSessionId === id` all hold, so the seed applies
(`use-sessions.spec.ts:462-474`, passing). A subsequent `loadSession` call
always reseeds, so there is no scenario where the *only* seed for a session is
unconditionally lost with no recovery path other than the one below.

**Is `pushGeneration` incremented only for pushes belonging to the active
session, or could a push for a background/other session suppress the active
session's seed?**

This is the gap. `handleStats` (`use-sessions.ts:356-362`) does not filter by
`activeSessionId` at all:

```ts
private handleStats(payload: unknown): void {
  const next = deriveStats(payload as SessionStatsPush, this.stats);
  if (!next) return;
  this.pushGeneration++;
  this.stats = next;
  this.onChange();
}
```

`deriveStats` uses `payload.sessionId` only to *label* the resulting
`SessionStats.sessionId` (`use-sessions.ts:175-198`); it never compares it to
`this.activeSessionId`. This is pre-existing behaviour — it predates this
diff and is itself asserted by an existing (unmodified) test, "does not carry
one session cost over to another session" (`use-sessions.spec.ts:184-193`),
which explicitly expects `c.stats?.sessionId` to become `'s2'` after a push
for `'s2'` arrives while no session is even marked active via
`setActiveSession`/`loadSession`.

Because `pushGeneration` is a single controller-wide counter bumped on *every*
accepted push regardless of which session it names, the new guard inherits
this scoping gap:

1. `loadSession('A')` is called → `activeSessionId = 'A'`, `seedStats('A')`
   starts: `seed = 1`, captured `pushGeneration = 0`. The `session:stats-batch`
   RPC is in flight.
2. While it is in flight, a `session:stats` push for a **different, background
   session `'B'`** arrives (e.g. a prior session still streaming after the
   user switched tabs/sessions in the TUI). `handleStats` accepts it
   unconditionally: `this.pushGeneration` becomes `1`, and — per the existing,
   unguarded overwrite — `this.stats` is now set to `B`'s data
   (`sessionId: 'B'`), even though `activeSessionId` is still `'A'`.
3. `A`'s seed resolves. The guard checks
   `pushGeneration (0) === this.pushGeneration (1)` → false → the branch is
   skipped, so `A`'s correct, freshly-fetched stats are silently discarded.
4. Net result: `activeSessionId === 'A'`, but `this.stats.sessionId === 'B'`
   with `B`'s cost/token figures, and nothing re-corrects this until the user
   navigates away and reloads session `A` again (or another push for `A`
   arrives). The UI is left showing another session's money under the active
   session's identity — a silent, misleading display, not a crash.

No test in the new suite exercises a push for a session other than the one
being seeded; all four new tests use `pushFor('s1', ...)` while seeding
`'s1'` (`use-sessions.spec.ts:414-492`). The interaction between the new
generation guard and the pre-existing cross-session push acceptance is
therefore unverified and, per the trace above, wrong.

This is a genuine regression risk introduced by pairing a *global* guard
counter with an *unscoped* push handler; the fix does not need to filter
`handleStats` by session to be correct (that would be a larger, out-of-scope
change to existing behaviour the tests pin), but `pushGeneration` should be
scoped per-session — e.g. keyed by `payload.sessionId`, or only incremented
when `payload.sessionId === this.activeSessionId` — so an unrelated session's
push cannot invalidate the active session's in-flight seed. Filed as Serious
below.

### Fix 3 — `costUSD: number | null` through the live-stats pipeline

`libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts:15-16,44-60`,
`libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:34-37`

- `TurnModelUsage.costUSD` is widened to `number | null` and
  `deriveLiveModelStats` now uses `m.costUSD ?? 0` **only** inside the
  `ranked` array built for `pickPrimaryModel` (the ranking key), while the
  returned `primaryModel` is the original `modelUsage` entry with its `null`
  untouched (`session-live-stats.util.ts:52-69`). Verified by
  `session-live-stats.util.spec.ts:210-234, 236-244`: an unpriced row never
  outranks a priced one, and `primaryModel.costUSD` stays `null` even when
  it's the sticky/primary pick.
- The wire type (`libs/shared/src/lib/types/agent-adapter.types.ts:70`,
  `rpc-session.types.ts:238`) already declares `costUSD: number | null`
  upstream, so this change removes a type mismatch that previously forced a
  silent narrowing (or a runtime `NaN`) rather than inventing a new nullable
  case that doesn't exist on the wire.
- `SessionStatsResultEvent.modelUsage` (aggregator service) forwards the
  field unchanged — confirmed by the new test asserting
  `forwarded.modelUsage?.map((m) => m.costUSD)` equals `[null, 0.4]`
  (`session-stats-aggregator.service.spec.ts:394-422`), i.e. the value isn't
  coerced anywhere in the forwarding path.
- **Does any consumer render `primaryModel.costUSD` and now show something
  wrong for `null`?** Traced every consumer of `deriveLiveModelStats`'s
  return value: `session-stats-aggregator.service.ts:166-180` and `:219-229`
  only read `derived.live` (a `LiveModelStatsPayload`, which has no
  `costUSD` field at all — `live` is built from `contextKnown`/`contextUsed`/
  `contextWindow`/`contextPercent`/`model` only, `session-live-stats.util.ts:90-104`)
  and `derived.suppressed`. `derived.primaryModel` itself is not read by any
  production code path outside the utility — only by tests. Separately, the
  UI component's `formatCost(usage.costUSD)` at
  `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:537`
  reads `modelRows()`, which comes from `this.snapshot()?.modelUsageList`
  (`session-stats-summary.component.ts:741-743`), i.e. the backend snapshot's
  own `ModelUsageRow`, an entirely different type from `TurnModelUsage` that
  this fix does not touch. `formatCost` already accepts `number | null`
  (`:831`). No render-path regression found.

No defects found in this fix.

## Five logic questions

### 1. How does this fail silently?

- Fix 2 (Serious, see above): a push for a background/inactive session
  silently overwrites `this.stats` with that session's data and silently
  drops the active session's legitimate seed result — no error, no log, no
  visible signal that the displayed cost belongs to the wrong session
  (`use-sessions.ts:321-327` combined with `:356-362`).
- Fix 1: prior to the fix, a hostile/malformed model id such as
  `x/constructor` would silently resolve to `Object.prototype.constructor`
  and propagate `NaN` cost rather than erroring. The fix converts this to an
  explicit `null` ("unknown"), which is the correct silent-failure posture
  for this codebase (unknown cost must render as unavailable, never $0/NaN)
  — not a residual issue.

### 2. What user action produces unexpected behaviour?

Switching sessions in the TUI while a previous session is still actively
streaming/generating (and therefore still emitting `session:stats` pushes) in
the background, immediately after switching to a new session whose
`stats-batch` seed is still in flight. See fix 2 analysis.

### 3. What input data produces a wrong answer?

None found for fixes 1 and 3 beyond what each fix already closes. For fix 2,
no *data* produces a wrong answer — it is a pure ordering/timing (race)
defect, not a data-shape defect.

### 4. What happens when a dependency fails?

- Fix 2: `session:stats-batch` RPC rejection is handled (`next = null` in the
  `catch`, `use-sessions.ts:318-320`), and the guard still applies correctly
  in that case per test (b). Good.
- Fix 1/3: no new dependency edges introduced; `updatePricingMap` and the
  RPC/event forwarding paths are unchanged apart from the type widening.

### 5. What is missing that the requirements never mentioned?

- A test (and ideally a fix) for the push-for-a-different-session-during-seed
  interaction identified above. The CodeRabbit finding this batch addresses
  was specifically "push vs. seed for the *same* session"; the cross-session
  interaction was out of its stated scope but is a direct consequence of
  pairing the new global counter with the pre-existing unscoped
  `handleStats`, so it is fair to flag here rather than as a wholly separate
  task.

## Failure modes

### Cross-session push suppresses active-session seed

- Trigger: `loadSession('A')` seeds stats for `A` while a `session:stats`
  push for a different session `'B'` arrives before the seed's RPC resolves.
- Symptom: the TUI shows session `B`'s cost/token numbers while
  `activeSessionId === 'A'` and the session list/tab still indicates `A` is
  selected; the correct numbers for `A` are dropped without any error.
- Evidence: `apps/ptah-tui/src/hooks/use-sessions.ts:218-221` (global,
  unscoped `pushGeneration`), `:356-362` (`handleStats` never compares
  `payload.sessionId` to `this.activeSessionId`), `:321-327` (the guard that
  drops the seed once `pushGeneration` has moved).
- Current handling: none — the scenario is untested and the code path
  described above reproduces it deterministically given the trace in Fix 2.
- Recommendation: scope the generation guard to the session being seeded
  (e.g. `if (payload.sessionId !== id) return;` inside the comparison, or
  track `pushGeneration` per-`sessionId` in a `Map`), so a push naming a
  different session cannot invalidate an in-flight seed for the active one.

## Blocking issues

None.

## Serious issues

### `pushGeneration` guard is not scoped to the seeded session

- File: `apps/ptah-tui/src/hooks/use-sessions.ts:218-221, 302-328, 356-362`
- Scenario: background/other-session push arrives while the active session's
  `stats-batch` seed is in flight (full trace under Fix 2 above).
- Impact: the TUI can display a background session's cost and token figures
  as if they belonged to the currently active session, with no error and no
  recovery until another push or session switch occurs — a financially
  misleading display, which is the exact class of bug (`costUSD` shown
  wrong) this whole task exists to eliminate.
- Fix: key `pushGeneration` (or the comparison) by session id so only a push
  for the session being seeded can suppress that seed's application.

## Moderate and minor issues

- Moderate: `apps/ptah-tui/src/hooks/use-sessions.ts:356-362` — `handleStats`
  accepts and displays a push for any session regardless of
  `activeSessionId`, which is pre-existing (not introduced by this batch,
  and pinned by an existing unmodified test at `use-sessions.spec.ts:184-193`)
  but is the root cause that makes the Serious issue above possible. Worth a
  follow-up task to decide whether `handleStats` should also filter by
  `activeSessionId`, independent of the `pushGeneration` scoping fix.

## Data flow

1. `lookupPricingEntry` receives a model id → lowercases/strips variant tags
   → checks exact-id candidates against `modelPricingMap` with
   `Object.hasOwn` before reading → OK, prototype pollution closed.
2. Falls through to the date-snapshot partial-match loop over
   `Object.entries(modelPricingMap)` → OK, was never affected.
3. `SessionController.loadSession(id)` sets `activeSessionId = id`, calls
   `seedStats(id)`, which snapshots `seed`/`pushGeneration` before awaiting
   the RPC → gap: nothing captured here distinguishes "a push happened for
   this session" from "a push happened for any session."
4. `handleStats` on any `session:stats` push bumps the global
   `pushGeneration` and overwrites `this.stats` unconditionally → this is
   where the cross-session leakage/suppression originates.
5. `seedStats`'s continuation re-checks `seed`, `pushGeneration`,
   `activeSessionId` → correctly rejects a stale/duplicate seed for the
   *same* session, but cannot distinguish "a push for me happened" from
   "a push for someone else happened" → gap, per Serious issue above.
6. `deriveLiveModelStats` ranks models with `costUSD ?? 0` as a key only,
   returns the original row (with `null` preserved) as `primaryModel` → OK.
7. `SessionStatsResultEvent` forwards `TurnModelUsage[]` (now nullable
   `costUSD`) unchanged to `streamingHandler.handleSessionStats` and to
   `tabManager.setLiveModelStats` (only `derived.live`, no `costUSD` field)
   → OK, no consumer currently reads the nullable field in a way that could
   mis-render it.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Fix 1: exact-match lookup must not resolve `Object.prototype` members | COMPLETE | None found |
| Fix 2: seed must not clobber a push accepted while it was in flight | COMPLETE for same-session race | Guard is global, not session-scoped; a different session's push can suppress the active session's seed (Serious) |
| Fix 3: `TurnModelUsage.costUSD` must be `number \| null`, never coerced to 0 for display | COMPLETE | None found |

Implicit requirements not addressed: none newly introduced by this batch,
beyond the cross-session scoping gap noted above, which was arguably always
implicit in "the active session's stats must reflect the active session."

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `constructor`/`__proto__`/`toString` as model id | YES | `Object.hasOwn` guard | None |
| Registered pricing entry whose key collides with a prototype member name | YES | `Object.hasOwn` still returns true for own properties | None |
| Push accepted while seed for the *same* session is in flight | YES | `pushGeneration` guard | None |
| Seed rejects while a push for the same session was accepted | YES | `catch` sets `next = null`, guard still applies | None |
| Session switched away from during an in-flight seed | YES | `activeSessionId === id` check | None |
| Push for a *different* session arriving while the active session's seed is in flight | NO | — | Serious issue above: silently shows the wrong session's numbers and drops the legitimate seed |
| Unpriced model (`costUSD: null`) ranked against priced models | YES | ranking uses `?? 0` as key only | None |
| Unpriced primary model rendered downstream | YES (not applicable) | no production consumer reads `primaryModel.costUSD` | None |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a push for a background/inactive session can silently make the
  active session's cost/token display show another session's figures while
  discarding the correct, in-flight seed for the session actually selected —
  exactly the class of "wrong cost shown with no error" bug this task set
  out to close, reintroduced through the interaction of the new guard with
  pre-existing unscoped push handling.
- What a robust implementation would add: scope `pushGeneration` (or the
  seed-invalidation check) to the session id being seeded, and add a test
  that seeds session `A` while a push for session `B` arrives mid-flight,
  asserting `A`'s seed still applies and `this.stats.sessionId` stays `'A'`.
