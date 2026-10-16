# Code Logic Review (visual fix round, batches C2 and D2) — TASK_2026_681_738f

Review family: implementer codex, reviewer Claude. Read-only; no nx targets run.

Scope: uncommitted diff of the named files, fix hunks only (items 11-17 already reviewed). Answers visual-review-11-17.md Serious 1-2, Moderate 1, 2, 4; decisions rows 22-23.

## Summary

| Metric | Value |
| --- | --- |
| Assessment | NEEDS_FIXES |
| Score | 6/10 |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 4 |
| Minor | 3 |

## Serious

### S1. Segment fallback publishes a partial total as a known one, against the Req 8.4 / Decision 8 contract

- Files: `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts:71-79` (`usageTotalsFromSegments`), used at `cli-lane-usage-summary.component.ts:67-70` and `inspector-agents-section.component.ts:328` (views computed).
- The only lanes that reach the fallback are those with `usageTotals` null or absent. That is by design in two cases:
  - Restored cards: `agent-monitor.store.ts:1729-1731` ("Restored tokens and cost are unknown, not 0 (Req 8.4); persisted segments are not folded") and the doc at `agent-monitor.store.ts:472-477`.
  - Restored then re-opened: `agent-output-frame.ts:98-105` keeps `usageTotals` null while live segments arrive. `agent-monitor.store.spec.ts:1608-1612` asserts "a partial run total is not a known total".
- Scenario 1: a restored lane's persisted segments are `capSegments`-trimmed (`agent-monitor.store.ts:1705-1707`, cap 500) and usage-bearing `info` segments are not folded when dropped. The fallback sums only what survived. The lane shows `in 11.9k`, `~$0.15 est.` and an inspector token badge as if they were the run total.
- Scenario 2: a re-opened restored lane with 5 live tokens now shows "in 5" in the summary and a 5-token badge.
- Impact: before this round the UI said "unknown" (`—`). Now it can show a smaller number with no marker, which is a wrong answer rather than an error. Cost is "latest reported", so it can also understate when each turn reports its own cost.
- Note: the visual review (Moderate 2) asked for this fallback, but it also allowed "or confirm that live lanes always carry usageTotals". The store contract was not weighed in the D2 report or in decisions row 23.
- Fix, either:
  - (a) render the fallback with a visible partial marker (for example `≥ 11.9k`, "at least"), or label it as from the retained output;
  - (b) record an explicit decision superseding Req 8.4 for display, and change the Req 8.4 comments and spec to match.
- Either way, add a spec for the restored-then-live case.

## Moderate

### M1. Duration text is not identical to the lane view (`inspector-agents-section.component.ts:348`)

- The lane view uses `formatElapsed` (`agent-card.component.ts:157-164`, `agent-card.utils.ts:13-26`): `5m 7s`, `2h 3m`, `0s`.
- The AGENTS badge uses `formatAgentDuration` (`chat-ui/.../agent-duration.ts:11-23`): `5m 07s`, `2h 03m`, and `null` (badge hidden) under 1 second.
- Hour-scale values with two-digit minutes match, which is why the 67h case now reads the same. Every other lane differs in padding (for example `1m 05s` against `1m 5s`), and sub-second lanes show `0s` in the lane but no badge.
- The aria label already uses `formatAgentDuration`, so the aria label and the lane view disagree as well.
- Fix: use `formatElapsed` for the CLI badge, or accept the difference and correct the D2 claim and decisions row 23.

### M2. Fallback drops fields the summary can render (`stats-bar.utils.ts:78`)

- It returns only input, output, total and cost. `contextTokens` and the cache fields are discarded, although `extractCliAgentStats` carries them.
- `cli-lane-usage-summary.component.ts:21-24` renders `ctx` from `contextTokens` and `cacheReported()` from cache fields. A lane whose segments report them still shows `ctx —` and no cache row, so the two surfaces disagree.
- The "which fields" choice is also undocumented. If the intent is "only what is safe to total", say so in the JSDoc.

### M3. Dock `z-10` confines the hover card and dock menu to a z-10 stacking context (`canvas-lane-tabs.component.ts:86`)

- The `ptah-agent-dock-card` (`fixed z-50`, `agent-dock-card.component.ts:30`) and the native dropdown (`z-40` backdrop, `z-50` panel, `native-dropdown.component.ts:75,87`) are rendered inside the tablist div (`canvas-lane-tabs.component.ts:166-184`). That div is now a stacking context at z-10.
- The z-50 values are therefore no longer global. Any later z-10 sibling at the same level paints over them. One concrete case is the transcript notice at `canvas-detail-transcript.component.ts:34` (`absolute top-2 z-10`, DOM-later, pointer-events-none). It is transient, so likelihood is low.
- Positive: the header overflow menu (`canvas-focus-header.component.ts:234`, z-20, header has no stacking context at `:104`) still sits above the dock. The z-10 value must therefore stay below 20; do not "fix" this by raising it.
- Fix: no change needed beyond a spec or manual check that the dock menu and hover card still paint over lane content. Optionally move the card out of the tablist.

### M4. Shadow colour is theme-dependent (`canvas-lane-tabs.component.ts:86`)

- `oklch(var(--bc)/0.35)` uses base-content. In dark themes `--bc` is light, so the "shadow" is a pale haze, not a shadow.
- Orchestrator note: the C2 visual check should specifically confirm this in the dark theme. Prefer a neutral black alpha or the existing elevation token (`--elev-shadow`, used at `chat-input.component.ts:820`).

## Minor

- `canvas-lane-tabs.component.ts:86`: `pb-1` adds 4px to the dock height, so every lane panel shifts down 4px. This is a layout change, although it is stated as intentional in the C2 report.
- `canvas-lane-view.component.ts:76,146`: `p-2` became `px-3 pt-2`, which removes bottom padding on both wrappers. The last row (flat card, subagent tree) now sits flush to the pane bottom.
- `inspector-agents-section.component.ts:328`: when `usageTotals` is null, `usageTotalsFromSegments(agent.segments)` re-walks all segments on each recompute. That includes the one-second `now` tick of running rows. It is bounded by the 500-segment cap, so cost is small. A per-row `computed` or memo would avoid it.

## Checks requested

| Check | Result |
| --- | --- |
| Which segments / summed or latest | `extractCliAgentStats` → `addCliUsage` (`libs/shared/src/lib/utils/cli-usage.utils.ts:32-47`): all usage segments, tokens summed, cost and model latest. The same fold as the live store. No double counting beyond what the live path would do, since the fallback is used only when `usageTotals` is absent. Partial-total concern: S1. |
| `usageTotals` always wins | Yes: `agent.usageTotals ?? ...` at `cli-lane-usage-summary.component.ts:69` and `inspector-agents-section.component.ts:328`. Spec "prefers structured totals" covers it. An empty `{}` totals object also wins and renders `—`, as before. |
| Cost precedence | Segment cost is "latest" and used only in the fallback. A cost of 0 renders `~$0.00 est.`. `null` → `—`. OK. |
| No behaviour change for agents with usageTotals | Summary: none (fallback not reached), except the new `presentation` input default `'card'`. Inspector: CLI rows now render badges in place of the inline `· N tokens` text. For `kind === 'cli'` the old `extra.tokens` was always null (`session-agent-tray.service.ts:62-70` fills tokens only for subagent / background), so nothing is lost. The duration is moved to a badge, with the wording difference in M1. |
| Duration identical to lane view | NO — M1. |
| Dock shadow / z-10 covers hover card or menus | Does not cover the header menu (z-20) and does not capture pointer events (box-shadow). It confines the card and dropdown to z-10 (M3). It adds 4px of height (Minor). |
| Details toggle bindings | Kept: `data-details`, `aria-label`, `title`, `aria-haspopup`, `[attr.aria-expanded]="detailsOpen()"`, `aria-describedby`, `data-dot`, `(click)="detailsRequested.emit()"`, the dot and the context ring (`canvas-focus-header.component.ts:194-211`). The glyph became `PanelRight` with `aria-hidden`. The ring is 28px inside a `btn-square btn-xs` 24px box, as it was before. OK. |
| `outline-base-content` | Used elsewhere in the repo (for example `compact-session-card.component.ts`); applied to all four icon buttons. OK. |
| Roster change | `segments` / `usageTotals` are carried by reference on `SessionAgent` (`session-agent-roster.ts:37-38,169-170`), with no equality check on the roster, so there is no new churn. `cliActivity` now skips usage segments (`:73-84`), which is correct. |

## Verdict

NEEDS_FIXES. The canvas hunks (C2) are behaviourally sound except for M3 and M4, which are checks rather than blockers. D2 needs a decision on S1 (partial totals shown as known), plus M1 (duration text not identical to the lane view) before the visual findings can be called answered. Confidence: HIGH on S1 and M1 (read from code and existing specs), MEDIUM on M3 and M4 (rendered behaviour not verified).
