# B2: Usage layout

## Changes

- `analytics-card.component.html:1-3`, `usage-dashboard.component.html:1-52`: one Usage header row with date span, 7d/30d/90d, Refresh, and a focusable partial badge. Its `aria-description`, `title`, and tooltip use the same incomplete-source text (`usage-dashboard.component.ts:92-97`). The visible source list is removed.
- `usage-kpi-strip.component.ts:16-49`: one six-tile strip for raw cost, processed tokens, cached share, sessions, messages, and subagents. The cost subline and tooltip preserve savings and output details; the provenance row remains the sole visible savings dollar figure. The API-rate footnote sits below the strip.
- `usage-dashboard.component.html:118-177`: daily chart at full width, then cost share and provider bars, then breakdown and top sessions, then provenance. Container-width rules at `usage-dashboard.component.ts:62-69` stack the pairs below 720px and 900px; KPI rules at `usage-kpi-strip.component.ts:9-16` yield 2, 3, or 6 columns.
- `usage-cost-summary.component.ts:12-52`: provider rows retain mark, cost, bar, share, and token count in a compact section.
- `usage-summary.view-model.ts:116-121,281-284` resolves top-session model display names through the same `resolveModelDisplayName` used for breakdown rows at `:199`; `usage-top-sessions.component.ts:25` displays the resolved name with the raw model id in `title`.
- `usage-dashboard.component.spec.ts:113-126,163-174,231-237`: checks session display name and raw-id tooltip, six tiles and section order, and the badge's accessible source details.

## Preserve list

All example values in the investigation (such as $3.82, 3.6M, 14, and 97.4%) are runtime values, not constants.

| Investigation item | Current location |
| --- | --- |
| Usage heading; date span; 7d/30d/90d; Refresh | `usage-dashboard.component.html:3-39` |
| Loading usage, fixed load error and Retry, refresh-failed, updating, empty-state messages | `usage-dashboard.component.html:54-109`; request and state remain in `analytics-usage.store.ts` |
| Raw token cost, Unknown, ≥ lower bound, unpriced fact/token detail | `usage-kpi-strip.component.ts:19-22,56-69` |
| Partial badge; incomplete source names and reason/status, including Codex, Antigravity, Ollama Cloud; complete sources omitted | `usage-dashboard.component.html:41-51`; `usage-dashboard.component.ts:92-97`; provider naming from `usage-formatting.ts:130-159` |
| API-rate footnote | `usage-kpi-strip.component.ts:49` |
| Provider mark, name, —/≥ cost, share bar, share of cost or known cost, tokens | `usage-cost-summary.component.ts:12-52` |
| Cost share Provider/Model, center known cost, legend cost and percent/—, unpriced explanation | `usage-cost-donut.component.ts:13-47` |
| Daily usage Cost/Tokens, in-house SVG, per-provider series and day labels, hover/focus readout and caption | `usage-dashboard.component.html:118-153`; `usage-dashboard.component.ts:105-117`; `stacked-bar-chart.component.html:33-169` |
| Processed tokens and per-active-day or No active days | `usage-kpi-strip.component.ts:24-29,72-76` |
| Cached input amount, cached share of observed input or No input observed | `usage-kpi-strip.component.ts:30-34,78-83` |
| Uncached input and cache writes | `usage-kpi-strip.component.ts:34` |
| Output tokens | `usage-kpi-strip.component.ts:28,64-69,98` (screen-reader text and cost tooltip) |
| Cache savings $, —/≥, unknown-fact tooltip, vs raw token cost | `usage-cost-quality.component.ts:49-79`; cost tile tooltip and multiple/lower-bound/no-data subline at `usage-kpi-strip.component.ts:64-98` |
| Sessions, Messages, Subagents; session-identity caveat and group label | `usage-kpi-strip.component.ts:17,35-47` |
| Breakdown Model/Day, model mark/display name/provider, cost, share of known cost, tokens, day top model, unpriced titles | `usage-breakdown-table.component.ts:29-112,140-172`; resolved name at `usage-summary.view-model.ts:199` |
| Top 5 sessions; empty text; session title, model display name with raw-id tooltip, Unpriced/≥ cost, tokens, relative last-active | `usage-top-sessions.component.ts:13-53`; resolver at `usage-summary.view-model.ts:281-284` |
| Provider reported, Model priced, Unpriced, Cache savings; share of tokens and null as — | `usage-cost-quality.component.ts:23-80` |
| Honest gaps (—, ≥, partial, Unpriced, Unknown, No price), provider marks and names, 30-day default, spend-summary RPC | `usage-kpi-strip.component.ts:56-69`; `usage-cost-summary.component.ts:16-52`; `usage-breakdown-table.component.ts:71-93`; `usage-top-sessions.component.ts:41-45`; `analytics-usage.store.ts:22-29,122-125` |
| BuildersCard “Ptah is open source” | `dashboard-grid.component.html:89` (untouched) |

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-dashboard.component.spec.ts libs/frontend/dashboard/src/lib/components/usage-dashboard/usage-summary.view-model.spec.ts --coverage=false --maxWorkers=1 --silent`: three runs; all passed, 2 suites / 56 tests.
- `ptah_get_diagnostics` after edits: no errors in changed TypeScript. Six unrelated sibling errors remain in `skill-selection-card.spec.ts`, `capability-id-codec.ts`, and `attention-identity.ts`.
- Read the supplied 1440 and 1920 dark screenshots. No new Electron screenshot or live visual review was run.

## Proposed Removals

None beyond the approved removal of visible per-source status lines and the weaker separate sessions row. Its source text remains in the partial badge's accessible description and tooltip.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Put the single Usage heading inside the dashboard header and remove the host's duplicate heading | Keep host heading above controls; place heading with controls | Approved header-row layout; original host heading was separate in `analytics-card.component.html:2` | Yes |
| Use container width for 720/900/1300px layout changes | Viewport breakpoints; container breakpoints | Electron side rail and VS Code webview change available content width independently of viewport width | Yes |
| Keep savings dollars visible only in provenance, with details in the cost tile tooltip | Show savings in both places; provenance only | Approved six KPIs and four-cell provenance row; duplicate visible savings was explicitly discouraged | Yes |

## Not done

- No edits to other lanes' files, no git operations, and no full build, serve, or e2e run.
