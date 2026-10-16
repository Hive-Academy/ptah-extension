# Code Logic Review r2 (fix hunks for S1, M1-M4) — TASK_2026_681_738f

Reviewer: Claude (implementer family codex). Read-only; no nx target, build or test run. Code read only. Jest and diagnostics results below are the lane reports' claims, not re-verified.

## Summary

| Metric | Value |
| --- | --- |
| Assessment | APPROVED |
| Score | 8/10 |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 3 (new) |

## Prior findings

| Finding | Resolved | Evidence |
| --- | --- | --- |
| S1 partial total shown as known | Yes (option (a), decisions row 27) | `stats-bar.utils.ts:4,70-83` returns `partial: true`, and `null` when none of input/output/total/cost exist. `cli-lane-usage-summary.component.ts:25,68-83`: input, output and cost get `≥ `, the group gets `title="From retained output, may be partial"`; cost keeps "est." Fallback is computed only when `agent.usageTotals == null`, so structured totals are never marked (spec `cli-lane-usage-summary.component.spec.ts` "prefers structured totals", asserts no `≥` and a null title). Inspector: `inspector-agents-section.component.ts:335-368` and the template badges use `view.cliUsagePartial = fallbackUsage?.partial === true`, so the same rule. Store Req 8.4 contract is untouched. |
| M1 duration text | Yes | `inspector-agents-section.component.ts:342`: CLI uses `formatElapsed` (the lane view's formatter), other kinds keep `formatAgentDuration`. The aria label drops the `formatAgentDuration` part for CLI (`durationMs: null`) and appends the same `duration` string (`:343-350`), so label, badge and lane agree. Spec pins both against `formatElapsed(65_000)`. |
| M2 fallback fields | Yes (documented, not folded) | JSDoc at `stats-bar.utils.ts:70-73` states the choice. The utils spec feeds `contextTokens` and `cacheReadTokens` and asserts they are absent from the result. The summary shows `ctx —` and no cache row for a fallback lane, which is consistent with the stated intent and the partial title. |
| M3 dock z-10 | Yes (accepted) | `canvas-lane-tabs.component.ts:82-87` keeps `z-10`, with a comment explaining it must stay below the header menu z-20. The spec asserts `z-10`, not `z-20`, and that the dock contains the menu and the hover card. The transient later-sibling `z-10` case (transcript notice) is still not checked in a browser. |
| M4 shadow colour | Yes (code) | `canvas-lane-tabs.component.ts:87` uses a neutral `rgb(0 0 0/0.45)`, with no `--bc` dependency. The class is pinned by the spec. A dark-theme visual check is still outstanding, and the lane report says so. |

## New findings

None at Moderate or above. Checks you asked about:

- Wrong marker when structured totals exist: no. `fallbackUsage` is null whenever `usageTotals != null` in both components.
- Partial flag leaking to `CliAgentStats` consumers: no. `PartialUsageTotals` is a separate `Pick` plus `partial: true` (`stats-bar.utils.ts:4`). The flag is only read by the two new views. `hasReportedCliCacheTokens(this.usage())` accepts it structurally.
- Type holes: no `any` or casts in the fix hunks.
- `class=""` plus `[class]=""` on one element: none. Only `[class.!x]` bindings alongside static `class` (summary `:19-22`), and `[attr.title]`.
- Specs pin the behaviour: yes for partial, structured and duration. The summary spec's "restored-then-live" test puts both usage segments in one array. It exercises the partial path but does not show a null `usageTotals` plus live segments distinctly from the restored case. This is acceptable.

Minor:

- m1. `inspector-agents-section.component.ts` partial token badge: `aria-label` is `'at least ' + view.cliTokens` (raw `11956`) while the visible text is `≥ 12.0k tokens`. The wording is aligned, the number format is not. The `aria-label` sits on a non-interactive `span`, which many screen readers ignore, and the `title` is not keyboard-reachable. Prefer `formatTokenCount` in the label, or `sr-only` text.
- m2. The inspector segment re-walk on each recompute (r1 Minor) is unchanged. It is bounded by the 500-segment cap.
- m3. There is no inspector spec for the case "usageTotals null with no usage segments" (expect no badges). The utils spec covers the `null` return, so the risk is low.

## Verdict

APPROVED, 8/10. S1, M1, M2, M3 and M4 are resolved in code and pinned by specs. Open items are non-blocking: a dark-theme visual check of the dock shadow, a manual check that the dock menu and card paint over lane content, and Minor m1.
