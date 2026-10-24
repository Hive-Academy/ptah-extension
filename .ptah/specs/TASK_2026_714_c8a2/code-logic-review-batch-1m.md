# Code Logic Review, Batch 1m (evidence cases for run 7a), TASK_2026_714_c8a2

Review family: Claude reviewer, Codex implementer.

Score: 6/10. Verdict: REVISE (small runner and harness edits; no redesign). Fix the items marked MUST before any paid turn.

Checks run: `jest tools` gave 196/196 passing. The round spec (17 tests) and the harness spec (179 tests) show no open handle under `--runInBand --detectOpenHandles`. The earlier "worker failed to exit" warning appears only in the parallel run and has no identifiable leak. The dry run prints 9 cases, planned turns 9, cap 10, budget left 17. No `--run`, no real binary.

Files read in full: `tools/evidence-cases-round.ts`, the harness diff, the failure-notes diff, `evidence-cases.json`, and the runner.

## What is sound
- **Turn cap is hard and shared.** `RpcChild.request` claims one unit per `turn/start` or `thread/compact/start` from the shared `TurnBudget`, `evidence-harness.ts:788-792`. This covers two-child cases because both children use `c.budget`. A claim past the cap throws `not run: cap` and sends nothing. There are no retries or steers in the round cases. Cost 9 (0+1+1+1+2+2+2) is under cap 10, and `runner` rejects a plan that leaves no steer slot.
- **Approvals only accept, acceptForSession or decline, and only for the exact marker command.** `evidence-cases-round.ts:213-249`. Any other method, thread, command or count is declined and the case throws. The marker is checked absent before approval.
- **A failed gate stops later cases.** `stop = true` on any non-observed result, `evidence-harness.ts:2401`. Later cases become `not run: prior gate or usage bound`.
- **Per-turn and cumulative usage bounds** go through `UsageBudget.observe`, which throws on a breach. The key is per `item.id:thread`, so two-child cases count each thread separately.
- **Artifacts store counts and booleans only.** No agent text, thread ids, home paths or account ids. The redactor covers the extra home (`createPathRedactor(local, ...)`). Every thrown message in the round file is in the literal allowlist `failureMessages` (checked by name).
- **Cleanup.** The extra home is registered in `experiment.additionalHomes` before it is created (`:433`). It is removed in `finally` (`:506`) and again by the fatal/keep path (`cleanupAdditionalHome`) if the first removal throws. Sessions are stopped with `Promise.allSettled`. The resumed first child is stopped explicitly and removed from `sessions`. Timers are cleared.

## Findings

### MUST fix before paid turns

1. **The cumulative bound will end the round before its most valuable cases, and the order wastes the rest.** Observed turns cost about 11.5-12.6k tokens each, and MCP or two-request turns about 24.5k (native-route-evidence.md, run 6h). Estimated cost by case in run order:

   | Case | Estimate (tokens) |
   | --- | --- |
   | different-home | about 12k |
   | profile | about 12-15k |
   | usage-semantics | about 25k |
   | same-home | about 24k |
   | resume | about 23k |
   | scope | about 36k |
   | **Total** | about 130-150k |

   The cumulative limit is 100k. `UsageBudget` throws at 100k, so `always-allow-scope`, which is last and is an unproved ledger item, is the case most likely to be skipped. The report's own estimate (60-100k) is optimistic against the measured numbers. Reorder so the unproved items with the highest value run first and the already-partially-observed, expensive case runs last. Suggested: different-home, always-allow-scope, same-home, resume-history, profile-inputs, usage-semantics. Alternatively get a user decision to raise the cumulative bound (money, user-reserved); do not change it silently. `spike-runner.ts:14-24`.

2. **A merely "unverified" `usage-semantics` stops all later cases.** `evidence-harness.ts:2396-2401` sets `stop = true` for any non-observed result, including `unverified: two usage notifications required`. That is not a safety or budget failure. Placed at position 6 it forfeits three paid-for-already-budgeted cases. Fixing item 1 (move it last) is sufficient; otherwise do not stop for `unverified:` statuses.

3. **Per-case deadline of 60 s is too short for the two-turn cases.** `CASE_DEADLINE_MS = 60_000` applies to resume-history (two inits, two turns, restart), same-home (two children, two turns) and always-allow-scope (two turns, three commands). A deadline abort mid-case burns paid tokens and yields no evidence. Give turnCost-2 round cases a longer deadline (for example 150 s). The turn and usage bounds already protect cost, so a longer deadline adds no spend risk.

### SHOULD fix (the case can run, but "observed" would overstate)

4. **Effort echo is not discriminating.** `OUTPUT_BOUNDS` already forces `model_reasoning_effort="low"` globally (`:154`), and the thread sets the same `low` (`:374`). `response.reasoningEffort === 'low'` (`:397`) is therefore true whether or not the thread-level setting is applied. Use a different thread value than the global bound, or drop the effort claim from `profile-inputs`.

5. **`profile-inputs` proves a subset.** It proves developer instructions and a CLI-configured local stdio MCP reaching ready, not Ptah profile skills, output style, attachments, model, max, resume roles or remote MCP. Keep ledger item `profile-inputs` unproved; the evidence is partial (also true of `remote-mcp`). Same for `history-rewind`, whose file restoration part stays unproved.

6. **Same-home isolation evidence is partly vacuous.** The two children are separate OS processes, so "no cross-thread events or approvals" cannot occur in the per-process notification stream (`:252-257`). `config.toml` may not exist, in which case `before === snapshot()` is `null === null` (`:116`, `:512`). Each child runs a different marker command, so the case cannot show that a grant in one thread does not leak to the other. Cheap fix with no extra turn: child 1 gets `acceptForSession` for command X, child 2 is asked for command X and must still prompt. Also assert `config.toml` exists, or hash `auth.json` before and after.

7. **Different-home isolation is weak.** The copied `auth.json` has the same account, so account or usage isolation is not observable. No hash or unchanged check on home B's `config.toml` or `auth.json`. Add equality of both homes' auth files (hash only, not stored) and treat the result as partial for the `configuration-auth-usage-isolation` ledger item.

8. **Usage can be undercounted for the resumed session.** The resumed session reuses the key `resume-history:<threadId>` (`:278`) and `observe` keeps `Math.max(count, previous)`. If the resumed thread's `total` restarts from zero, the second child's turn is invisible to both bounds until it exceeds the first child's total. Key by session label, which is conservative (overcounts if totals continue).

9. **`always-allow-scope` proves native session semantics only.** Exact command repeated without a prompt plus a different marker command prompting is a sound discriminator and not a false positive: it fails if Codex matches by prefix or program. It does not prove Ptah's remembered-rule store scope (thread, home, workspace). The parity-gate row `always-allow-scope` should say so; do not flip it on this alone.

### MINOR

10. The first unrelated `tool item` or `agentMessage` after the third command is allowed, so a runaway model message is bounded only by per-turn usage and the deadline. Acceptable.
11. `rmSync(extraHome)` in `finally` (`:506`) can throw EBUSY on Windows and skip the `configUnchanged` assertion; the fatal-cleanup path still removes the home. Wrap in try/catch and record `secondHomeDeleted: false` instead.

## Answers to the review questions
1. Budget safety: hard cap holds, no loops, no retries. The weakness is the plan, not the guard (items 1-3).
2. Observed criteria: scope is a valid native discriminator (item 9). Isolation, effort and profile criteria overstate (items 4-7).
3. Approvals: compliant.
4. Sanitization: compliant. Counts and booleans only.
5. Cleanup: compliant on every path reviewed, including two-child and resume cases (item 11 is cosmetic).
6. Order: a likely failure at case 3 or 4 (MCP-related, as in 6g/6h) stops everything, and the cumulative bound ends the round before scope (items 1-2).

## Verdict
REVISE. Do items 1-3 (runner order, stop rule, deadline) before spending. Items 4-9 can ride along in the same fix or be recorded as partial-evidence caveats in the report. Confidence: HIGH on 1-3 (arithmetic from recorded runs, code-evident), MEDIUM on 8 (depends on whether resume resets `total`).

## Fixes re-review (round 1 of 2)

Verdict: APPROVED to run, 8/10. No must-fix item remains. Confidence is HIGH on budget safety and MEDIUM on whether the paid evidence will come out as hoped, which depends on the model. Scoped jest on tools passes 226/226. The only residual jest noise is the "worker failed to exit" warning when all three tools specs run together at `--maxWorkers=2`. It does not appear when the round-plan spec (19 tests) or the round-cases spec (20 tests) runs alone, and the new code adds no unconditional timer, so it is not a spend risk. No `--run` and no real binary were used.

### Must-fix items from the first review

1. **Per-run estimate under the bound, with margin.** `evidence-round-plan.ts:3-15` fixes per-case estimates and refuses a plan above 85k. Run 7a is 72k (different-home 12k, scope 36k, same-home 24k), leaving 28k below the 100k cumulative bound. Run 7b is 64k (resume 24k, profile 15k, usage-semantics 25k), leaving 36k. Each harness process has its own `UsageBudget`, so the two runs each get a fresh 100k. Total expected spend is about 136k across two runs, and the 100k bound is enforced per run. The highest-value unproved cases (scope, same-home) now run first in 7a. Grouping accepted.
2. **Unverified continues, a failed gate stops.** `shouldStopAfterCase` (`evidence-harness.ts:49-51`) stops only when the status is neither `observed` nor `unverified:`; it is called at `:2413`. A thrown case still sets `stop`. `usage-semantics` is last in 7b, so a thin usage result costs nothing downstream.
3. **Per-case deadlines.** `caseDeadlineMs` is `min(225 s, max(60 s, 75 s x turnCost))`. Dry run confirms 60 s for zero-cost cases, 75 s for one-turn cases and 150 s for two-turn cases. The dry-run JSON reports each case's deadline.

### Should-fix items

4. **Effort now discriminates.** The thread sets `model_reasoning_effort: 'medium'` for profile-inputs against the global `low` bound (`evidence-cases-round.ts:382`), and the response must echo `medium` (`:405`). A global-only setting can no longer pass. Cost rises slightly (more reasoning output); the 15k estimate and the 30k per-turn bound still cover it.
5. **Same-home cross-thread probe is effective.** `commandLabel = same ? 'first' : label` (`:143`) makes both children use the identical script and marker. Child 1 gets `acceptForSession`, the marker is removed, and child 2 receives the same command and must prompt (`second.approvals === 1`, `:460-467`). A missing prompt fails the gate, so this is not a false positive. Caveat: the children are separate OS processes, so a session grant living in process memory cannot cross. The probe therefore shows only that nothing was persisted to the shared home. The report states this limit. Cross-thread scoping inside one process remains the unit-tested RuleStore's job.
6. **Honest partial-evidence notes.** The report's "Case evidence limits" table keeps `profile-inputs`, `remote-mcp` and file rewind unproved, labels scope as native session semantics only, and states that home-B hashes and account separation were not added. No ledger or gate source changed.
7. **Per-child resumed usage accounting.** The key is `item:label:thread` (`:285`). It overcounts conservatively if the resumed total continues. Caveat: the resumed child's first notification may carry the cumulative total (about 24k after two turns). That is under the 30k per-turn bound but with little margin. If it breaches, the case fails with a usage error. This wastes at most that case and is bounded, so it is acceptable.

### Carry-forward of `--7a-turns-used`
- 7b requires the flag; 7a rejects it; the value must be an integer from 0 to 17 and not above the remaining budget (`parseRoundArgs`). Dry runs confirm: 7b without the flag errors, `13` errors with "Cap exceeds remaining approved turns", `6` gives remaining 11, cap 5.
- A wrong value cannot let 7b exceed the 17 approved turns. The harness enforces its own hard cap (6 for 7a, 5 for 7b) at every `turn/start`, independent of the flag. 7a plus 7b can use at most 11 turns even if the flag is mistyped as 0. A value too high only causes a refusal.
- Residual: the flag is not machine-checked against the 7a artifact. A third or retried run would be new spend; the report requires reconciling it against the shared allowance. That is process, not code.

### Unchanged behavior
The approval gate (accept, acceptForSession, decline only; exact marker command), the sanitization and cleanup paths, the turn claim in `RpcChild.request`, and the usage bounds are as in the first review. `usage-semantics` still runs without the early interrupt and with the longer prompt.

### Dry-run commands (exact)
```
npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run --round 7a
npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json .ptah/specs/TASK_2026_714_c8a2/spike-runner.ts --dry-run --round 7b --7a-turns-used <turnsConsumed from the 7a artifact>
```
Expected headers: `runner 7a: 6 cases, planned turns 5, cap 6, estimated tokens 72000, budget left 17` and, for 7b with 6, `runner 7b: 6 cases, planned turns 4, cap 5, estimated tokens 64000, budget left 11, prior turns used 6`.
