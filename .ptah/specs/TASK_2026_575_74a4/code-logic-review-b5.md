# Code Logic Review — `TASK_2026_575_74a4` Batch 5 (TUI session cost)

Scope reviewed: `git diff HEAD -- apps/ptah-tui` in `D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost` (use-sessions.ts, status-line.ts, use-commands.ts, use-sessions.spec.ts, status-line.spec.ts), read in full, against the committed contract in `libs/shared/src/lib/types/agent-adapter.types.ts` (`ResultStatsPayload`, `sessionStats?: SessionStatsEntry`) and `libs/shared/src/lib/types/rpc/rpc-session.types.ts:193-283` (`SessionStatsEntry`). Batch 6 test files and screenshots were ignored. Read-only review; no source modified; no git writes; only read-only git used.

## Summary

| Metric              | Value     |
| ------------------- | --------- |
| Overall score       | 8/10      |
| Assessment          | APPROVED  |
| Blocking issues     | 0         |
| Serious issues      | 0         |
| Moderate issues     | 1         |
| Failure modes found | 4         |

Verification evidence: `npx jest -c apps/ptah-tui/jest.config.cjs apps/ptah-tui/src/hooks/use-sessions.spec.ts apps/ptah-tui/src/lib/status-line.spec.ts` — 2 suites, **29 passed, 0 failed** (tail: `Test Suites: 2 passed`; `Tests: 29 passed, 29 total`).

## Five logic questions

### 1. How does this fail silently?

- A `session:stats` push with no snapshot keeps the previously displayed cost for the same session (use-sessions.ts:160-164). The value can go stale only while the backend publishes no snapshot at all; per the contract the snapshot is "absent when the backend had no snapshot to publish" (`agent-adapter.types.ts:75-77`), so the previous figure is the backend's last word for that session, not an invention. This is the designed fallback, not a misrepresentation.
- A push for a session with no prior state and no snapshot yields `costUSD: null` and the cost field is hidden (use-sessions.ts:164; status-line.ts:116-127) — silent but correct: unknown is hidden, never $0.
- No path turns a failure into a success-looking number. The old failure mode — `payload.cost ?? primary?.costUSD ?? 0` silently presenting one model row's cumulative cost as a session total — is removed at use-sessions.ts:183.

### 2. What user action produces unexpected behaviour?

- A session whose backend total is a known $0.00 shows no cost chip on the status bar (`costValue > 0` gate, status-line.ts:118; pre-existing pin at status-line.spec.ts:92-105), while `/status` prints `$0.0000` (use-commands.ts:318). Hiding a real zero understates nothing and does not misrepresent money; it makes known-zero and unknown look the same on the bar. Minor (F2 below).
- A partially priced session displays `>=$4.00` on the bar but the tone is computed from the lower bound (F3 below): the tone can understate urgency, the amount cannot overstate.

### 3. What input data produces a wrong answer?

- A wire payload whose embedded `sessionStats` belongs to a different session than `payload.sessionId` (or a `session:stats-batch` response whose `sessionStats[0]` is for another id) would attach another session's money to the displayed session. The code trusts the contract pairing and does not compare `snapshot.sessionId` / `entry.sessionId` (use-sessions.ts:159-160; use-sessions.ts:291-294). The backend is the sole producer (`rpc-session.types.ts:181-187`), so the trigger is a backend bug, not user input. Moderate (F1 below).
- `knownCost` sent as a negative number, `NaN`, or non-number: `isKnownCost` rejects it → unknown (use-sessions.ts:82-84). Correct.
- `totalCost` sent as a known zero with garbage `knownCost`: totalCost wins, shown as $, partial false (use-sessions.ts:95-97). Correct: the contract makes a known zero a real zero (`rpc-session.types.ts:198-203`).

### 4. What happens when a dependency fails?

- `session:stats-batch` rejects or returns non-success/false status/missing array: `seedStats` sets `this.stats = null` (use-sessions.ts:291-297) → bar shows no cost, `/status` prints "No active session.". No stale or fabricated money.
- A push with an absent/malformed snapshot (status misspelled, missing fields): treated as no usable snapshot → previous same-session value kept, else unknown (use-sessions.ts:159-164). Correct degradation.
- A push lacking `sessionId` is dropped entirely (use-sessions.ts:171). Previous display stands; no wrong money.
- Older backend builds that predate `sessionStats`/`knownCost` (fields optional at the boundary, `rpc-session.types.ts:189-191`): `knownCost` absent → `isKnownCost(undefined)` false → unknown; never $0. Correct.

### 5. What is missing that the requirements never mentioned?

- No test covers the `/status` rendering branch (`'unavailable'` / `(partial pricing)`), use-commands.ts:313-319. Minor (F4).
- No runtime validation that the snapshot/entry id matches the session it arrives for (F1 below) — the requirements pinned the values, not the id pairing.

## Failure modes

### F1. Cross-session snapshot misattribution is not validated at the wire boundary

- Trigger: a `session:stats` payload whose `sessionStats.sessionId` differs from `payload.sessionId`, or a `session:stats-batch` response whose `sessionStats[0]` is for another id.
- Symptom: another session's cost is displayed as this session's cost.
- Evidence: use-sessions.ts:159-160 (snapshot read without id comparison); use-sessions.ts:291-294 (`deriveStatsFromBatch(id, entry)` labels the entry with the requested id, ignoring `entry.sessionId`).
- Current handling: trust. The push is cast `payload as SessionStatsPush` from unknown (use-sessions.ts:327) and the field is optional at this boundary (`rpc-session.types.ts:189-191`).
- Likelihood: low — the backend is the only producer and the batch request carries exactly one id (`rpc-session.types.ts:181-192`). The batch/entry form is pre-existing.
- Recommendation: guard `snapshot.sessionId === payload.sessionId` inside `sessionCostForPush` and skip mismatching `entry` in `seedStats`; treat mismatch as unknown or no-snapshot.

### F2. Known $0.00 total is indistinguishable from unknown on the status bar

- Trigger: a fully priced session whose total is a real $0 (pre-existing `> 0` gate).
- Symptom: no cost chip; same as an unpriced session.
- Evidence: status-line.ts:116-118; status-line.spec.ts:92-105 (pre-existing pin).
- Current handling: hidden. `/status` does distinguish (`$0.0000`, use-commands.ts:318).
- Recommendation: render `$0.00` when `costPartial` is false and `costUSD === 0`, or accept and document the choice. Display-only; no money overstated.

### F3. Tone of a lower-bound cost is computed from the lower bound

- Trigger: `knownCost` partial subtotal between $1 and $5 while the true total is higher.
- Symptom: `ok`/`warn` tone can understate urgency; the `>=` prefix is correct.
- Evidence: status-line.ts:118-125.
- Current handling: tone from `costValue` regardless of `costPartial`.
- Recommendation: cap the tone at `warn` when `costPartial` is true, or compute tone only for full-coverage totals.

### F4. `/status` cost branch is untested (adjacent gap)

- Trigger: any refactor of the use-commands.ts:313-319 branch.
- Symptom: regression would not fail any test.
- Recommendation: add a use-commands spec (or extract the formatter into status-line.ts and pin it there).

## Blocking issues

None.

## Serious issues

None.

## Moderate issues

- F1 (above) — use-sessions.ts:159-160, 291-294.

## Moderate and minor issues

- Minor F1 (moderate as counted above): snapshot/entry `sessionId` never validated — use-sessions.ts:159-160, use-sessions.ts:291-294.
- Minor: known-zero hidden on the bar — status-line.ts:118.
- Minor: lower-bound tone — status-line.ts:118-125.
- Minor: `/status` cost branch untested; decimal places differ from the bar (4 vs formatCost) — use-commands.ts:313-319.
- Pre-existing, out of scope: `handleStats` replaces `this.stats` wholesale for any session id without an active-session filter (use-sessions.ts:326-331). Batch 5 makes the cost safe across sessions; non-cost fields (tokens, model) can still be replaced by a push for a foreign session. Recommend a follow-up `payload.sessionId === this.activeSessionId` filter.

## Verification of the numbered review points

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | No path shows `turnCost` or a model row as the session cost | PASS | `sessionCostOf` reads only `totalCost`/`knownCost` (use-sessions.ts:92-102); `sessionCostForPush` reads only the snapshot or the same-session previous (use-sessions.ts:155-165); model-row `costUSD` feeds only `pickPrimaryModel` for model selection (use-sessions.ts:115, 141); grep over `apps/ptah-tui/src` finds no other session-cost consumer; `CostBadge.tsx` has no session-cost caller |
| 2 | Unknown never renders $0 | PASS | status-line.ts:116-127 (`?? null`, `costValue !== null` gate); StatusBar.tsx:115 renders only when `line.cost !== null`; use-commands.ts:314-315 prints `unavailable`; grep found no other render path |
| 3 | Snapshot present, status ok, prices nothing → unknown, not previous | CORRECT | use-sessions.ts:159-160 → `sessionCostOf` → UNKNOWN_COST (use-sessions.ts:100-101). The snapshot is the backend's authoritative word (`agent-adapter.types.ts:75-78`); an ok snapshot that prices nothing retracts the previous total, and keeping it would display money the backend no longer stands behind. The next priced snapshot restores the figure. Strict-money rule satisfied |
| 4 | Session switch never carries a cost across | PASS | `loadSession` → `seedStats` always overwrites `this.stats` fully or nulls it (use-sessions.ts:282-298); the push path consults `previous` only when `previous.sessionId === payload.sessionId` (use-sessions.ts:161); pinned at use-sessions.spec.ts:184-196 |
| 5 | Initial load from `session:stats-batch` uses the same rule | PASS | `deriveStatsFromBatch` calls `sessionCostOf` — the same helper the push path wraps (use-sessions.ts:129 vs 160); pinned at use-sessions.spec.ts:203-221 |
| 6 | Partial marker always shown for `knownCost` | PASS | `knownCost` is the only source with `costPartial: true` (use-sessions.ts:98-99); status-line.ts:120 prefixes `>=` when `costPartial === true`; use-commands.ts:316-317 prints `(partial pricing)`; pinned at use-sessions.spec.ts:150-158 and status-line.spec.ts:116-122 |
| 7 | Tests not tautological, nothing loosened | PASS | git show HEAD confirms the modified pre-existing test (use-sessions.spec.ts:61-93) asserted only model/context on base — no cost assertion was dropped, and the rename `cost` → `turnCost` matches the new contract; the six new tests use decoys (turnCost 10 and 5, model row 3) while asserting snapshot values (10, 15, 4, null, 0.07) that differ from the decoys, and the brief's base failures are consistent with `cost ?? primary?.costUSD ?? 0`; 29/29 passed in this worktree |

## Data flow

1. `session:stats` push arrives untyped → cast to `Partial<ResultStatsPayload>` (use-sessions.ts:52, 327) — OK; every field treated as possibly absent.
2. `deriveStats` rejects missing `sessionId` (use-sessions.ts:171) — OK.
3. Cost: `sessionCostForPush` → ok snapshot? → `sessionCostOf` (`totalCost` full → `knownCost` lower bound → unknown) → else previous same-session value → else unknown (use-sessions.ts:155-165) — OK. Gap: embedded snapshot id not compared to `payload.sessionId` (F1).
4. `status-line.ts` derivation: null → cost null → StatusBar.tsx:115 does not render — OK; number → `>=` prefix only when `costPartial === true` (status-line.ts:120) — OK.
5. `/status`: null → `unavailable`; partial → `>=$… (partial pricing)`; else `$…` (use-commands.ts:313-319) — OK; branch untested (F4).
6. Initial load: `session:stats-batch` → `sessionStats?.[0]` → `deriveStatsFromBatch` → `sessionCostOf` (use-sessions.ts:282-298, 104-134) — OK. Gap: entry id not compared to requested id (F1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Session cost = snapshot only, never turnCost/model row | COMPLETE | none |
| Unknown renders as hidden / `unavailable`, never $0 | COMPLETE | `/status` and bar consistent |
| `knownCost` → lower bound with `>=` marker | COMPLETE | tone understates (F3) |
| Keep previous cost only for the same session | COMPLETE | none |
| Batch seeding uses the same rule | COMPLETE | entry id not validated (F1) |
| Snapshot ok + nothing priced → unknown (open decision) | CORRECT | rationale in point 3 above |
| Tests prove the rule, nothing loosened | COMPLETE | `/status` branch untested (F4) |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Push with no snapshot | YES | previous same-session value, else unknown (use-sessions.ts:160-164) | value may be a display window behind an absent backend; contract says the backend publishes snapshots when it has them |
| Snapshot with `totalCost`/`knownCost` both null (ok) | YES | unknown (use-sessions.ts:100-101) | none — covered at use-sessions.spec.ts:160-172 |
| `knownCost` negative/NaN/absent | YES | `isKnownCost` rejects (use-sessions.ts:82-84) | none |
| Known zero total | YES | shown as $, `costPartial` false (use-sessions.ts:95-97) | hidden on the bar (F2) |
| Batch status `error`/`empty` | YES | `deriveStatsFromBatch` → null → `stats = null` (use-sessions.ts:108, 294) | none |
| Transport throws during seed | YES | `stats = null` (use-sessions.ts:295-297) | `/status` then says "No active session." (pre-existing) |
| Push for a different session | YES | cost unknown, previous not consulted (use-sessions.ts:161) | non-cost fields still replace wholesale (pre-existing) |
| Push without `sessionId` | YES | dropped (use-sessions.ts:171) | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a malformed wire payload pairing another session's snapshot with this session's push would display foreign money (F1); low likelihood under the single-producer contract, one guard line away from closed.
- What a robust implementation would add: (1) `snapshot.sessionId === payload.sessionId` and `entry.sessionId === id` guards yielding unknown on mismatch; (2) a `use-commands` spec pinning the `/status` cost branch; (3) tone capped at `warn` for `costPartial`; (4) an active-session filter in `handleStats` as a follow-up batch.