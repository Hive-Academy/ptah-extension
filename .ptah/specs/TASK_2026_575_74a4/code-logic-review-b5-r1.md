# Code Logic Review — `TASK_2026_575_74a4` Batch 5, round 1 fix (TUI session cost)

Re-review of `git diff HEAD -- apps/ptah-tui` in `D:\projects\ptah-extension\.claude-worktrees\task-575-session-cost` after the round-0 moderate finding (snapshot/entry `sessionId` not validated) was addressed. Read-only git; only the deliverable written; the Batch 6 test files and screenshots remain out of scope. Round-0 review: `code-logic-review-b5.md`.

## Summary

| Metric                 | Value    |
| ---------------------- | -------- |
| Overall score          | 9/10     |
| Assessment             | APPROVED |
| Blocking issues        | 0        |
| Serious issues         | 0        |
| Moderate issues        | 0        |
| Failure modes found    | 1 (minor, new) |

Evidence: `npx jest -c apps/ptah-tui/jest.config.cjs apps/ptah-tui/src/hooks/use-sessions.spec.ts` — **15 passed, 0 failed** (`Tests: 15 passed, 15 total`). `ptah_get_diagnostics` over `use-sessions.ts`, `use-commands.ts`, `status-line.ts`: **no diagnostics** in the requested files (the 120 workspace errors are pre-existing `libs/backend/*` vscode-shim files, unrelated to this batch).

## Status of the round-0 findings

| Round-0 finding | Severity | Status | Evidence |
| --- | --- | --- | --- |
| F1 — snapshot/entry `sessionId` trusted without a match check | Moderate | **FIXED** | One helper now guards both paths: `sessionCostFor` (use-sessions.ts:110-124). Push path: use-sessions.ts:192 — `sessionCostFor(payload.sessionId, payload.sessionStats, previous)`. Batch path: use-sessions.ts:154 — `sessionCostFor(sessionId, entry, previous)`. Pinned by two new decoy tests: use-sessions.spec.ts:195-212 (foreign push snapshot) and use-sessions.spec.ts:214-244 (foreign batch entry) |
| Known $0 hidden on the status bar | Minor | Open, unchanged | status-line.ts:116-118 (out of this fix's scope) |
| Lower-bound cost tone computed from the lower bound | Minor | Open, unchanged | status-line.ts:118-125 |
| `/status` cost branch untested | Minor | Open, unchanged | use-commands.ts:313-319 |
| `handleStats` replaces displayed stats for any session id (pre-existing) | Minor, adjacent | Open, unchanged | use-sessions.ts:335-340 |

## Verification of the fix

### Guard at the push path — CORRECT

`sessionCostFor` (use-sessions.ts:110-124) applies a snapshot cost only when all three hold: `snapshot` present, `snapshot.status === 'ok'` (line 117), and `snapshot.sessionId === sessionId` (line 118). Otherwise the previous value is consulted only when `previous.sessionId === sessionId` (line 122); otherwise `UNKNOWN_COST` (line 124). `turnCost` and model-row `costUSD` are still never consulted (only mention of `turnCost` in the cost path is the comment at use-sessions.ts:190-191).

### Guard at the batch path — CORRECT

`deriveStatsFromBatch(id, entry, previous)` (use-sessions.ts:128-165) routes the entry through the same `sessionCostFor(sessionId, entry, previous)` (use-sessions.ts:154), so a batch entry naming another session can never supply the cost. `seedStats` passes `this.stats` and labels the result with the loaded `id` (use-sessions.ts:291-303).

### Is `previous` ever another session's value at `seedStats`? — NO

At `loadSession('B')` time, `this.stats` still holds the PRIOR session's stats when `seedStats('B')` runs: `loadSession` sets `activeSessionId = 'B'` and awaits `seedStats` (use-sessions.ts:271-280) before `this.stats` is next written (use-sessions.ts:303). So `previous` is the prior session's value — for example session A's `{ costUSD: 10 }` while loading session B. The guard neutralizes this:

- Entry ok with `entry.sessionId === 'B'` → entry cost; `previous` (A) never consulted (use-sessions.ts:113-121).
- Entry ok with `entry.sessionId === 'other'` → guard fails; `previous.sessionId` (A) fails the B check → `UNKNOWN_COST`. The new test pins exactly this: entry carrying `totalCost: 99` for `'other'` yields `stats.sessionId === 'sess-x'`, `costUSD === null` (use-sessions.spec.ts:214-244).
- Entry `status !== 'ok'` → `deriveStatsFromBatch` returns `null` before any cost logic (use-sessions.ts:133) → `seedStats` sets `this.stats = null` (use-sessions.ts:303). A's cost is dropped, not carried.

The only way `previous` supplies a cost is `previous.sessionId === sessionId` — a same-session re-seed — which is the designed "backend's last word for this session" fallback. A's cost can never be displayed for B.

### Round-0 checks re-verified (no regression)

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Never turnCost / model row as session cost | PASS | `sessionCostOf` reads only `totalCost`/`knownCost` (use-sessions.ts:88-98); `sessionCostFor` reads only snapshot/previous (use-sessions.ts:110-124); model rows feed only `pickPrimaryModel` (use-sessions.ts:149-151, 172-178) |
| 2 | Unknown never renders $0 in bar or `/status` | PASS | status-line.ts:116-127 (unchanged); use-commands.ts:313-319 (unchanged); `StatusBar.tsx:115` renders only non-null cost |
| 3 | Snapshot ok that prices nothing → unknown, not previous | PASS | The ok-snapshot branch returns `sessionCostOf(snapshot)` unconditionally — including its `UNKNOWN_COST` (use-sessions.ts:120, 97); pinned at use-sessions.spec.ts:159-172 |
| 4 | Session switch carries nothing across | PASS | Batch always overwrites `this.stats` fully or nulls it (use-sessions.ts:303); push `previous` guarded by sessionId (use-sessions.ts:122); tests use-sessions.spec.ts:184-196, 214-244 |
| 5 | Initial batch load uses the same rule | PASS | Both paths call the one helper `sessionCostFor` → `sessionCostOf` (use-sessions.ts:154, 192) |
| 6 | Partial marker always with `knownCost` | PASS | use-sessions.ts:94-96; status-line.ts:120; use-commands.ts:316-317; pinned at use-sessions.spec.ts:150-158 and status-line.spec.ts:116-122 |
| 7 | Tests not tautological, nothing loosened | PASS | The two new tests use a `99` decoy snapshot/entry and assert it is never shown (kept `10`, or `null`) — values that fail on the round-0 code exactly as the brief states; fixtures gained the now-required `sessionId` (`'sess-9'` at use-sessions.spec.ts:291, `'sess-p'`/`'sess-u'` at use-sessions.spec.ts:247-260); the base fixture test (use-sessions.spec.ts:61-93) on HEAD never asserted a cost, so nothing was loosened |

## New findings

### F2 (Minor). Non-cost fields of a foreign batch entry still seed the display

- File: use-sessions.ts:128-165 (only cost guarded; entry `modelUsageList`/`tokens` still applied), with `stats.sessionId` labeled the requested `id` (use-sessions.ts:154, 163).
- Scenario: an ok batch entry naming another session seeds the requested session's stats with foreign tokens/model, cost null.
- Impact: display-only misattribution (wrong token counts/model); money stays safe. Likelihood low — single backend producer (`rpc-session.types.ts:181-187`). The executor declared this scope: "only cost is guarded".
- Recommendation: drop a mismatching entry entirely (treat as no entry) in a follow-up; the cost guard is sufficient for Batch 5's money contract.

### F3 (Minor, carried). Snapshot with non-ok status for the same session keeps the previous figure on pushes

- File: use-sessions.ts:110-124 (fall-through when `status !== 'ok'`).
- Scenario: a same-session push snapshot with status `'error'` retains the previously shown figure rather than dropping to unknown.
- Impact: the cost can lag a failed backend read, but it remains the backend's last sourced word for the same session and never overstates it. Matches the fix's stated contract ("else previous value for the same session"). Note: the batch path degrades differently — `status !== 'ok'` → `null` (use-sessions.ts:133, 303). Acceptable; record the asymmetry.
- Recommendation: none for Batch 5; if hardening later, treat error-status same-session snapshots uniformly across both paths.

### Carried minor issues (unchanged from round 0)

- Known $0.00 total hidden on the status bar — status-line.ts:118.
- Lower-bound tone from the lower bound — status-line.ts:118-125.
- `/status` cost branch untested — use-commands.ts:313-319.
- `handleStats` has no active-session filter (pre-existing; non-cost fields only) — use-sessions.ts:335-340.

## Data flow

1. Push arrives untyped → cast `Partial<ResultStatsPayload>` (use-sessions.ts:52, 336) — OK.
2. `deriveStats` rejects a missing `sessionId` (use-sessions.ts:180) — OK.
3. Cost: `sessionCostFor(payload.sessionId, payload.sessionStats, previous)` (use-sessions.ts:192) → id+status guard (`sessionCostOf`, :117-121) → same-session previous (:122-123) → unknown (:124). Gap closed: foreign snapshot id cannot supply cost.
4. Switch: `loadSession` → `seedStats(id)` → `deriveStatsFromBatch(id, entry, this.stats)` (:291-303) → `sessionCostFor(id, entry, previous)` (:154) — prior-session `previous` neutralized by the id guard; bad-status entry → `null`. Gap closed.
5. Render: `status-line.ts` (`>=` marker only when `costPartial === true`, :120) and `/status` (`unavailable`/`(partial pricing)`, use-commands.ts:313-319) — unchanged and still correct with `null`.
6. Initial load shares the same helper as the push path (:154 vs :192) — one rule, both entry points.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Guard snapshot vs target session id, both paths | COMPLETE | none (tests fail before the fix: Received 99) |
| `previous` never another session's value, incl. `seedStats` after a switch | COMPLETE | prior-session `this.stats` is neutralized by the sessionId guard |
| Round-0 checks 1-7 hold | COMPLETE | none regress |
| Only cost guarded (tokens/model from entry) | PARTIAL (declared scope) | foreign entry fields can still display (F2, minor) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a foreign batch entry can still display its tokens/model under the requested session id (F2, minor, money-safe); everything cost-related is now origin-checked at a single chokepoint.
- What a robust implementation would add: drop mismatching batch entries entirely (not only their cost); an active-session filter in `handleStats`; a `/status` cost-branch spec; tone capped at `warn` for `costPartial`.