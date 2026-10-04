# Batch 47 executor report — N6 agent panel display

Executor: frontend-developer. Worktree `D:/projects/ptah-extension/.claude-worktrees/task-597-followups`, on top of
Batch 46 (`d78a0c5b4`). Nothing committed; the working tree is dirty.

## Tasks

- 47.1 Context, cache state and cost on each agent card: COMPLETE.

## Files

- MODIFIED `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts`: new `NOT_REPORTED` ("—"),
  `formatOptionalTokens(count | undefined)` ("—" when missing, never 0) and `formatEstimatedCost(cost | null |
undefined)` ("~$x.xx est.", or "—" when the cost is unpriced (`null`) or missing (`undefined`)).
- MODIFIED `.../agent-card/stats-bar.utils.spec.ts`: 2 tests for the formatters.
- MODIFIED `.../agent-card/agent-card-header.component.ts`: CLI lane cards show a `cache not reported` ghost badge when
  `agent().cacheReported === false` (every lane in PR 2). There is no context size and no warm/cold badge. The lane's own
  reported `$` cost is unchanged in the existing stats bar (`cli-agent-output.component.ts`).
- CREATED `.../agent-card/agent-card-header.component.spec.ts`: lane shows "cache not reported" and no warm/cold/ctx text;
  an agent with no cache fields shows no chip.
- CREATED `.../agent-card/subagent-usage-summary.component.ts` (`ptah-subagent-usage-summary`): standalone, OnPush,
  `inject()`, `input.required<SubagentRecord>()`, signals. The `view` computed is
  `subagentUsageView(record(), Date.now())` and also reads `store.tick()`. This is the same re-evaluation pattern as the
  agent card's elapsed time (`agent-card.component.ts:131`). It adds no timer of its own. It shows `ctx` (context size),
  a warm (`badge-success`) / cold (`badge-ghost`) badge only when the state is not `unknown`, with the tooltip and
  aria-label `Prompt cache <state> (TTL <5m|1h>, idle <duration|unknown>)`. Next come cache read / cache write (or
  "cache not reported" when the subagent reported no cache field), output tokens and the estimate. Every missing value
  is "—". An effect keyed on a `computed` `parentToolUseId` makes one `store.loadSubagentCacheInfo(id)` call when the
  row opens. Progress events do not call it again; only a different subagent does. A thrown transport error is logged
  and the state stays `unknown`.
- CREATED `.../agent-card/subagent-usage-summary.component.spec.ts`: 9 tests:
  - one load per opened subagent, none on record churn
  - everything "—" and no badge before any usage or TTL
  - priced estimate `~$0.03 est.` (seeded through `updatePricingMap`, reset after)
  - a cache field that was not reported stays "—" (and context stays "—")
  - an unpriced model gives "—" plus the tooltip
  - a warm badge with its TTL and idle time in the tooltip and aria-label
  - warm turns cold on the shared tick after the TTL
  - no activity gives cold with idle "unknown"
  - a load that throws leaves no badge
- MODIFIED `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.ts`: template and imports only
  (+3 lines). `<ptah-subagent-usage-summary [record]="sub" />` sits at the top of the opened-subagent detail, above the
  transcript viewer. No logic was added.
- MODIFIED `.../organisms/agent-monitor-panel.component.spec.ts`: the mock gains `loadSubagentCacheInfo`. A new test
  checks that the summary is absent and makes no query before the row is opened, and that it renders and queries once
  the tile is clicked.
- MODIFIED `.../organisms/agent-monitor/agent-lane-panel.spec.ts`: the store mock gains `tick` and
  `loadSubagentCacheInfo`. The panel now renders the summary for its selected workflow subagent.

## Stack observed

Angular 22 standalone components with signals and `inject()` (the same as `agent-card-header.component.ts` and
`agent-continue-input.component.ts`). Styling is Tailwind + DaisyUI badges, with the `text-[9px|10px] font-mono` stat
style of `cli-agent-output.component.ts:41-75`. Specs use Jest + TestBed with a `useValue` store mock, the same as
`agent-continue-input.component.spec.ts`. `chat` already imports `AgentMonitorStore` from `chat-streaming`, so no new
boundary is crossed.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat ptah-extension-webview`: "Successfully ran targets
  typecheck, lint for 2 projects" (4 tasks).
- `npx nx run-many -t test -p @ptah-extension/chat --maxWorkers=2`: "Successfully ran target test for project
  @ptah-extension/chat".
- Targeted run first: `npx jest -c libs/frontend/chat/jest.config.ts agent-card agent-monitor stats-bar subagent-usage
--maxWorkers=2` gave 16 suites and 181 tests, all passed.
- Prettier was run on all 9 files. It made whitespace-only changes to 2 of them, after the checks above.
- Screenshots: not taken (deferred to QA, as instructed).

## Deviations

1. **Placement of the subagent summary.** The plan says the summary is "used by the subagent tiles". It is mounted in
   the opened-subagent detail instead (`selectedWorkflowSubagent` branch, above the transcript). There are three
   reasons:
   - The tiles are compact 120 px-label buttons, and a row of five values does not fit in them.
   - "Opened" has to trigger the one `chat:subagent-query`, and mounting in the detail is the only way to do that
     without adding selection logic to the 1212-line panel. The plan forbids that logic.
   - The badge stays unknown and hidden until the row is opened, which is the rule.

   The tiles keep their existing `totalTokens` figure, so they are unchanged. The summary covers both session and
   workflow subagents, because both open the same detail branch.

2. Two existing panel specs (`agent-monitor-panel.component.spec.ts` and `agent-lane-panel.spec.ts`) got mock entries
   because the panel now renders the summary. Neither spec is named in the task file list. No other file outside the
   list was touched.
3. Warm/cold is re-evaluated when the record changes, when the cache info arrives, and on the store's shared 1 s
   `tick`. That tick runs only while a CLI agent is running. When no lane is running, a warm badge on an idle subagent
   becomes cold at the next record event or re-open, not at the exact TTL instant. This is the cost of the "no timers"
   rule. The tooltip's idle time has the same lag.

## Out-of-scope observations

- `agent-monitor-panel.component.ts` is still over the 700-line `max-lines` warning (now 1215 lines). This batch added 3
  lines.
- Lane cost is still shown as the lane's reported `$x.xxxx` in the stats bar, not as "~$x.xx est.". That is correct: it
  is a reported value, not an estimate.
