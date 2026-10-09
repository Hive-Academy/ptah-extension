# Lane guards settings UI

Settings → Agent orchestration now has a Lane guards card beside Session budget. A lane the host stops for a tool-call budget shows that reason on the Agents panel card.

## What was built

- Three numeric fields: Steer at (tool calls), Stop at (tool calls), Repeat-call stop at. Same card style as Session budget (label, text input, help with range, two-column grid from `sm`).
- Load uses `agent:getConfig`. Save uses `agent:setConfig` with a 5s timeout. Defaults shown when the host omits a value or returns one below the minimum: 40, 60, 20.
- Inline checks: whole numbers, steer ≥ 1, stop ≥ 2, repeat ≥ 2, stop greater than steer. An invalid pair is not written. A host rejection is shown as returned (for example `Unsupported laneToolCallStopAt value`) on the named field and the status line.
- Help text: at steer the lane is asked to wrap up; at stop it is stopped; grok and Ptah CLI providers cannot take the mid-turn steer and run until stop; repeat-call stop ends a lane that repeats the same call that many times.
- Agent card header, after the status badge, when the lane is not running:
  - `tool-call-budget` → "Stopped: tool-call limit reached"
  - `repeat-call` → "Stopped: repeated the same tool call"

## Files changed

- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.logic.ts:18` field table and bounds; `:62` integer parse; `:80` stop > steer; `:99` write payload (a valid steer/stop pair is sent together).
- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.ts:49` standalone OnPush section; `:201` `agent:setConfig`; `:240` `agent:getConfig`.
- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.logic.spec.ts` parse, pair, combined write, defaults, host error key.
- `libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.spec.ts` load, retry, blocked pair, save, backend error.
- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:191` `<ptah-lane-guards-settings />` inside the existing session-budget viewport defer, after Session budget.
- `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts` stub plus order assertion.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts:29` `laneGuardStopText`; `:83` reason span (`data-testid="lane-stop-reason"`).
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.spec.ts` budget stop, repeat stop, hidden while running.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:481` `MonitoredAgent.stopReason`; copied at `:1161` (re-open), `:1214` (replacement), `:1249` (fresh spawn), `:1400` (exit). Re-open assigns `info.stopReason`, so a new attempt clears the previous reason.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts` copies `tool-call-budget` on exit and clears it on re-open.

## Verification

- `npx jest --config libs/frontend/chat/jest.config.ts --coverage=false --maxWorkers=2 --testPathPatterns "lane-guards-settings|agent-card-header.component.spec|orchestration-settings.component.spec"` — 4 suites, 39 tests, passed.
- `npx jest --config libs/frontend/chat-streaming/jest.config.ts --coverage=false --maxWorkers=2 --testPathPatterns agent-monitor.store.spec --testNamePattern "copies stopReason"` — 1 passed (the new test). The rest of that file was not re-run.
- `npx nx lint @ptah-extension/chat --maxWorkers=2` — passed, 0 errors. 32 warnings, all in files this change did not touch.
- No browser was available in this session. The settings card and the header reason were exercised through the Jest component specs, not in the webview.

## Decisions

- Lane guards share the session-budget `@defer (on viewport)` block. A fourth defer block would change the orchestration spec that expects three blocks, and the placeholder would still be one row.
- Bounds match `invalidLaneGuard` in `agent-rpc.handlers.ts`: safe integers, those minimums, and stop > steer. Help text says "N or greater" because the host has no smaller maximum than `Number.MAX_SAFE_INTEGER`.
- `agent-monitor.store.ts` was edited even though another agent may be fixing typecheck there. `AgentProcessInfo.stopReason` already existed in shared types; `MonitoredAgent` did not, so the card could not show it. The edit only adds the optional field and the four copies. `cli-matrix-rows.ts` was not edited.
- A restored `CliSessionReference` still has no `stopReason`. A card rebuilt by `loadCliSessions` does not explain a budget stop until a live `agent:exited` in this process. Persisting the reason would touch the backend session reference, which this UI batch did not change.

## Not done

- `ptah_agent_report` is not registered in this session (MCP search returned no such tool), so the orchestrator was not notified through that call.
- No browser pass of the Settings page or the Agents panel.
- Repeat-call and tool-call-budget reasons are not written into persisted CLI session metadata.
