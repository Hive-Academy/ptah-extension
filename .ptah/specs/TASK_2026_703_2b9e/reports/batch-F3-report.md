# Batch F3 report - chat: adapters, composer, lane rework, CLI flat bar, removal

## Files changed (all under `libs/frontend/chat/src/lib/`)

- CREATED `utils/lane-stats.adapters.ts` (+ `.spec.ts`) - `subagentLaneStats(record, now)` and
  `cliLaneStats(agent)` -> `AgentLaneStatsView`. Token, partial and cost rules moved unchanged from
  the lane meta, `laneMeta` and `CliLaneUsageSummaryComponent`; cache title text kept from the
  deleted usage row.
- CREATED `utils/subagent-follow-up-prompt.ts` (+ `.spec.ts`).
- CREATED `components/organisms/subagent-lane/subagent-lane-composer.component.ts` (+ `.spec.ts`) -
  `ptah-subagent-lane-composer`: mode `steer` / `follow-up` / `unavailable`; steer through
  `SessionAgentTrayService.steer`, follow-up through `ChatAgentFeedbackSender.send`; draft kept on
  failure (`role="alert"`), "Sent to the main chat" (`role="status"`); reset per agent key (m5) with
  a generation guard so a late reply for agent A never lands on agent B. Sticky footer via host class.
- MODIFIED `components/organisms/subagent-lane/subagent-lane.component.ts` (+ spec) - steer toggle and
  its state/viewChild/icon removed; usage row and Model row removed; token meta removed; stats bar
  outside the details; Task row reads `taskDescription` only (D6); cache-info load once per key;
  `stopPending`/`backgroundPending` reset per key (m5); `summaryContent` input deleted (Decision 1).
- MODIFIED `components/molecules/agent-card/agent-card.component.ts` - flat branch: stats bar after the
  execution header, usage row, Model row and token meta removed.
- MODIFIED `components/molecules/agent-card/cli-lane-usage-summary.component.ts` - `presentation`
  input and `flat` class bindings deleted (card is the only use).
- MODIFIED specs: `agent-card-flat-header.spec.ts`, `cli-agent-output.component.spec.ts` (flat case
  asserted the old usage row), `organisms/agent-monitor-panel.component.spec.ts` (lane stub no longer
  renders the deleted component; cache-info load now covered by the lane spec).
- MODIFIED `components/index.ts` - export of `SubagentUsageSummaryComponent` dropped.
- DELETED `components/molecules/agent-card/subagent-usage-summary.component.ts` (+ spec).

## Acceptance

- Seams of components 4-8 covered. `grep SubagentUsageSummary libs/` -> no hits.
  `summaryContent` is gone from the lane (remaining hits are `ExecutionNode.summaryContent`, F7).

## Checks

- Changed specs via Jest (`--maxWorkers=2`): 16 suites, 182 tests PASS.
- `npx nx test @ptah-extension/chat --parallel=1`: PASS (253 suites, 4491 passed, 2 skipped).
- `npx nx typecheck @ptah-extension/chat --parallel=1`: PASS.
- `npx nx lint @ptah-extension/chat --parallel=1`: PASS (0 errors, 90 warnings; the ones in touched
  specs are the files' existing non-null-assertion style).

## Deviations / notes

- Follow-up prompt with no agent name reads "Continue the sub-agent ..." instead of the plan's literal
  "Continue the sub-agent sub-agent ...".
- The send button of `ptah-agent-steer-input` keeps its label "Send steer message" in follow-up mode
  (chat-ui label not made configurable; out of plan scope).
- `agent-card.component.ts`, `agent-card-flat-header.spec.ts`, `cli-lane-usage-summary.component.ts`
  and `cli-agent-output.component.spec.ts` were not prettier-formatted on `main`; lint-staged would
  format them at commit, and the formatter drops the trailing space in `<dt>Status: </dt>`, which broke
  the `Status: Completed` assertions. They are now prettier-formatted, the details `<dd>`s carry
  `ms-1` (as in the sub-agent lane) for the gap, and the assertions use `/Status:\s*.../`. This
  inflates the `agent-card.component.ts` diff (formatting only, outside the edits listed above).
- Final run after formatting: chat test PASS (4491), typecheck PASS, lint PASS (0 errors, 89 warnings).
