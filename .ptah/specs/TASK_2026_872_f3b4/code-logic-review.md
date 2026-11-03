# Code Logic Review — TASK_2026_872_f3b4

Review family: claude (reviewer, subagent fallback) vs codex (implementer)

Score: 6.5/10. Verdict: REVISE. Scope: the full diff and the new files. No checks were run, as instructed.

Counts: 0 Blocking, 2 Serious, 3 Moderate, 3 Minor.

## Findings

1. **Serious.** `stats-limit-view-model.ts:~104-126` (providerLimits). A provider whose runs have mixed owners (some with `quotaOwner`, some without) gets `ownerKeys.length === 1`. The tile then shows that one owner's windows and percentages for the whole CLI family. The unowned runs' "Limits not tracked" state is silently dropped. A run with no owner is a different, unknown account, so it should count as a second state. Fix: treat `runs.some(r => !r.quotaOwner)` together with at least one owner key as `multiple` (or show a "some runs untracked" note). Add a spec for it.

2. **Serious.** `stats-limit-view-model.ts:~118-122`. The single-owner path takes `scopes.length === 1 ? scopes[0] : null`. With mixed model scopes (the same owner, scopes A and B), `sessionPlan` gets `sessionModelScope: null`. I did not verify what `sessionPlan` does with a null scope. If it falls back to unscoped or all windows, a scope-limited percentage can be shown as the family's. The model must not pick a scope arbitrarily. Fix: confirm the null-scope behaviour and add a spec; if it picks one window, show a "multiple scopes" message or list all scopes.

3. **Moderate.** `provider-lane-limit-tile.component.ts`. Cooldown and evidence tiles (`kind !== 'window'`) render only when the user clicks "More detail". The "More detail" button itself shows only if `windows.length > 1 || ownerDetails.length > 1`. A provider with one window plus a cooldown, or a single window with evidence, gives the user no way to see the cooldown or evidence. A rate-limit cooldown is hidden unless it is the only tile. Fix: always show cooldown tiles (or make the toggle condition `windows.length > windowTiles().length`). Note that `message` is `''` when any window exists, so a cooldown on a provider that also has a window leaves no visible cue.

4. **Moderate.** `inspector-agent-usage.ts:~89` (`costEstimated`). The old code was `true` unconditionally. The new code is `cliUsage ? … : stats?.cost != null`. For non-CLI rows with no `stats` that carry `usageTotals.costUsd`, the `~` marker is now dropped. That may be correct (a reported cost is not an estimate), but it is an unplanned behaviour change to a Keep row ("lower-bound `≥` and estimated `~` markers"). I could not confirm `inspector-agent-usage.spec.ts` covers it. Fix: add or confirm specs for the subagent, background and orchestrator cases, and state the intent in the batch report.

5. **Moderate.** `inspector-agents-section.component.ts:~284-289` (`expandedKeys`). Keys are never pruned when runs leave the roster. The set grows slowly but is bounded by the session's runs, so this is low risk. A reused key would reopen a stale panel. Fix: prune against the current rows in a `computed`, or accept and document.

6. **Minor.** `inspector-agents-section.component.ts:~512`. The role is appended to `name` after `agentListRow`. `ariaLabel` and `usageLabel` were built from the old name, so screen readers miss the role and the actions menu `[name]="row.name"` differs from the aria label. Fix: pass the role into `agentListRow` instead of patching the result.

7. **Minor.** `stats-limit-view-model.ts` (`inspectorRuns`). `laneTile([run], …)` is rebuilt once per run, in addition to the grouped `laneTiles`. This is O(runs) extra work on every stats recompute. It is fine at present, but it duplicates the owner and notes logic. Fix: reuse the grouped tile's subgroups keyed by `runId` if profiling shows a cost.

8. **Minor.** `provider-lane-limit-tile.component.ts`. `selectedId` is not reset when the provider's windows change. The fallback to `windowTiles()[0]` handles a vanished window, so no stale display results. However, if the window comes back, the old selection silently re-applies. This is acceptable; I note it for completeness.

## Checked and OK

- **Grouping key.** One tile per `run.cli`, not per role, so 3 codex runs give 1 row.
- **Owner mixing.** Distinct owner keys give "Multiple accounts" with empty `windows`, so no merged percentages. The exception is finding 1.
- **Null vs 0.** No-owner gives "Limits not tracked". An owner with no windows gives "Usage unknown" or "Limits not tracked" by owner status, never 0%.
- **Selection vs expand.** The expand button is a sibling of the row button, and state lives in `expandedKeys`, separate from `selectedAgentKey`. No conflict.
- **Subtotal.** Rendered after the "Show N more" control, so it sits outside the cap. It uses `subtotalTile` with `≥` markers and the "lane · not in totals" caption. It is not added to the session totals.
- **Stop.** The existing actions menu is unchanged and reachable on each CLI row.
- **Strip consumer.** `laneTiles`, `subtotal` and `lanesCount` are intact; `runRow` is only newly exported. No `any`, `ts-ignore` or `as unknown as` in the diff. `chat` imports `chat-ui` through the barrel only. No signal or effect misuse; there are no timers in the new code.

## Parity rows checked

All 11 Keep rows are visible in the table, each with its counterpart in the diff. These are: the AGENTS header and count; the loading and empty states; the roster kinds; name, avatar and model plus role; orchestrator tokens, cost and tooltip; CLI tokens, cost and markers (see finding 4); the status word; elapsed duration (new Time column); selection and keyboard open (independent expand added); the Stop, steer and background actions; permission and question lines; and the 6-row cap, pin and "Show N more". The Move rows are covered: the per-run face moved to AGENTS, and the LANES count now reads "N providers". I did not fully verify test coverage for each row. Specs exist for the new surfaces (the view-model, the section and the lanes component), but I did not read them in full.
