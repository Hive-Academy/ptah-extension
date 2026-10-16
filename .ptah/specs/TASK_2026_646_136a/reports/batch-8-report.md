# Batch 8 report — B8 Library Agents-tab outcome signals

Task 8.1 is implemented. Agent cards and the agent drawer no longer show the Success percentage. They show outcome signals from one `agent:outcomeSignals` call. Skills and commands still show Success. No Nx or Jest command was run (decision #53). The team-leader owns `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1` and `npx nx lint @ptah-extension/skill-synthesis-ui`.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.spec.ts`

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-clones-state.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-clones-state.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts`

The last two spec files are not in the Task 8.1 file list. The Library view now reads `agentOutcomeSignals` and `outcomeWindowDays` off the state service while it renders. Those stubs construct that service. Without the two signals the view throws on first change detection, and the project test the team-leader runs would fail. No production behavior was added there.

Not edited, on purpose: `skill-clones-state.perf.spec.ts`. Its RPC stub has no `getAgentOutcomeSignals`. `refreshClones` still completes: the missing call throws inside `loadAgentOutcomeSignals`, the catch stores `{}` and `null`, and the spec's assertion (one `getScorecards` call for 200 clones) still holds. Adding the stub method would stop that swallowed TypeError. It is a one-line follow-up, not a failure of the NFR assertion.

## Task 8.1 evidence

- Formatter `formatAgentOutcomeSignals(signals, windowDays)` in `agent-outcome-signals.ts:35`. Absent or `runCount === 0` returns one metric, label `Outcomes (Nd)`, value `no data yet` (`:42-50`). Otherwise: Window `(last N days)`, Delivered `80% (4/5)` or `no verified runs`, Review pass `x% (n/d)` or `not reviewed yet`, Avg revise rounds to one decimal hidden when the review denominator is 0 or the average is null/non-finite, Top failure class or `no failures recorded` (`:52-84`). Percentages use `Math.round`. Test ids are `clone-metric-outcome-*`. Spec covers every Req 9.1 branch (`agent-outcome-signals.spec.ts:29-176`).
- `SkillSynthesisRpcService.getAgentOutcomeSignals(slugs)` calls `'agent:outcomeSignals'` with `{ slugs }` and `LIST_MS` (10s), and returns `AgentOutcomeSignalsResult` (`skill-synthesis-rpc.service.ts:627-639`). Spec locks the method name, payload, timeout, unwrap, and error throw (`skill-synthesis-rpc.service.spec.ts:409-442`).
- `SkillClonesStateService` holds `agentOutcomeSignals` and `outcomeWindowDays` (`skill-clones-state.service.ts:48-52`). `refreshClones` loads them in the same post-list step as scorecards, via `Promise.all` (`:70-73`). One call, agent slugs only (`:107-117`). Failure or a list with no agents stores `{}` and `null` and does not set `error` (`:108-120`). Spec: `skill-clones-state.service.spec.ts:351-423`.
- `CloneCardComponent.outcomeSignals = input<AgentOutcomeSignals | null>(null)` and `outcomeWindowDays = input<number | null>(null)` (`clone-card.component.ts:319-321`). The metrics `computed` emits Success only when `kind !== 'agent'` (`:423-429`) and appends the formatter for agents (`:430-436`). A record whose `slug` is not the card's slug is treated as absent.
- `CloneDetailDrawerComponent` has the same two inputs (`clone-detail-drawer.component.ts:451-455`) and the same branch in `buildMetrics` (`:580-594`). Drawer metric values now carry `data-testid` (`:150-165`). History on the drawer is still the bare count (`:607`), not the card's "N snapshots" wording.
- `skill-clones-view.component.ts` passes both inputs next to `[scorecard]` on the card (`:314-316`) and the drawer (`:357-358`). Accessors: `outcomeSignalsFor` (`:983-985`), `selectedOutcomeSignals` (`:987-992`).
- Components stay standalone, `OnPush`, `input()` / `output()`, signals. No new component. No `[innerHTML]`. No `@Input` / `@Output`, no `NgModule`, no constructor injection.

## Decisions

1. **The window is a metric row, not a new caption element.** Options: a full-width caption outside the `dl`, or a `Window` / `(last N days)` row in the existing metric markup. Evidence: part B §9 says the metric row markup is reused and no new component is added (`implementation-plan-part-b.md:567-573`). The visible value is the plan's `(last N days)`. Reversible: yes.
2. **The empty state is label `Outcomes (Nd)` and value `no data yet`.** Options: one text node `Outcomes (30d): no data yet`, or the existing dt/dd split. Evidence: Req 9.2 requires the words "no data yet" (`task-description.md:424-425`); the card's metric row is always label plus value (`clone-card.component.ts:178-189`). The value is exactly `no data yet`. Reversible: yes.
3. **`persistent` is returned by the RPC method and not stored on the card.** Options: a third signal and a "not readable" sentence, or the two signals §9 names. Evidence: §9 names `agentOutcomeSignals` and `outcomeWindowDays` only (`implementation-plan-part-b.md:558-561`). The result type still carries `persistent` (`rpc-lane-outcome.types.ts:34-38`) and `getAgentOutcomeSignals` returns that whole object (`skill-synthesis-rpc.service.ts:629-637`). An unreadable store with an empty map renders "no data yet", which does not fabricate a rate. Reversible: yes, add a sentence without changing the RPC method.
4. **A signal record whose `slug` does not match the entry is treated as absent.** Options: render whatever object the parent passed, or require `signals.slug === clone.slug`. Evidence: Req 9.5 is that two agents show different records (`task-description.md:430`); the map is keyed by slug (`rpc-lane-outcome.types.ts:28-35`). The guard stops one agent's rates landing on another card. The view passes `map[slug]`, so the happy path matches. Reversible: yes.
5. **Scorecards and outcome signals load with `Promise.all`.** Options: sequential awaits, or one parallel step. Evidence: §9 says the same post-`refreshClones` step as `loadScorecards` (`implementation-plan-part-b.md:559-561`). Each loader catches its own failure, so one failure does not blank the other and does not set `error`. Reversible: yes.
6. **Failure class text is the enum token** (`timeout`, `usage-limit`), not a rewritten phrase. Options: humanize the token, or show it. Evidence: `LaneFailureClass` is the closed set (`lane-outcome.types.ts:26-33`); Req 9.1 says show the class (`task-description.md:419-420`). Reversible: yes.
7. **Drawer history copy was not unified with the card.** The drawer still shows the bare count (`clone-detail-drawer.component.ts:607`). The card still shows `N snapshot(s)` (`clone-card.component.ts:446-451`). Evidence: parity row "History snapshot count" is `keep` (`parity-inventory.md:13`). Reversible: no, changing either string would move a keep row.

## Assumptions

- **PB-4 holds.** `AgentProcessInfo.role` is the workspace role name (`agent-process.types.ts:154-155`). A spawn with a role file stamps `role: roleDefinition.name` (`agent-process-manager.service.ts:617-618`). That name is the `.md` basename under `.claude/agents` (`agent-role-resolver.service.ts:18`, `:141-160`). Agent clone files are `{ws}/.claude/agents/<slug>.md` (`user-layer-seed-quarantine.ts:52`), and the Library row's slug is that registry slug (`skills-synthesis-rpc.handlers.ts:2318`). The Agents tab therefore asks `agent:outcomeSignals` for the same string a lane record stores as `role` (`skill-clones-state.service.ts:107-115`). Lane records keyed by that role attach to the matching card once Batch 25's handler exists. No frontend key change. Fallback in the plan ("if it does not, lane records do not count on Agents-tab cards") does not apply.

## Parity rows (R-11)

| Row | Result | Where |
| --- | --- | --- |
| Invocations count, all kinds | kept | Card emits it when `invocationCount > 0` (`clone-card.component.ts:415-419`). Drawer does the same (`clone-detail-drawer.component.ts:573-577`). Specs: `clone-card.component.spec.ts:117`, `:371`, `:391`; `clone-detail-drawer.component.spec.ts:304`. |
| "Success" %, agent kind | changed | Emitted only when `kind !== 'agent'` (`clone-card.component.ts:423-429`; `clone-detail-drawer.component.ts:580-588`). Agent path appends the formatter (`:430-436`, `:589-594`). Specs assert the test id is absent: `clone-card.component.spec.ts:370`, `:390`, `:412`; `clone-detail-drawer.component.spec.ts:303`, `:334`. |
| "Success" %, skill and command kinds | kept | Same `kind !== 'agent'` branch still calls `formatSuccessRate` (`clone-action-gating.ts:240-245`, unchanged). Specs: skill `50%` and command `25%` (`clone-card.component.spec.ts:340`, `:355`; drawer `:274`, `:285`). |
| Last enhanced | kept | Card `clone-card.component.ts:440-445` (`3h ago` in `clone-card.component.spec.ts:128`, `:392`). Drawer `clone-detail-drawer.component.ts:596-601` (`clone-detail-drawer.component.spec.ts:308`). |
| History snapshot count | kept | Card `N snapshot(s)` (`clone-card.component.ts:447-452`; spec `:127`, `:393`). Drawer bare count (`clone-detail-drawer.component.ts:602-608`; spec `:310` expects `3`). |
| Scorecard badge | kept | Still mounted only for agents (`clone-card.component.ts:192-194`; `clone-detail-drawer.component.ts:270-275`). Specs: `clone-card.component.spec.ts:323-325`, `:395`; drawer `drawer-scorecard` at `clone-detail-drawer.component.spec.ts:315`. |

## PB-4 acceptance

**Pass.** See Assumptions. The slug the Agents tab sends is the role file basename, and that is what `AgentProcessInfo.role` holds when a lane is spawned with a role file. This batch does not write outcome records. Batch 25's handler is what counts those records onto the slugs this UI already sends.

## Risks and validation notes

- **R-10 (MEDIUM).** Before screenshots (dark and light) of the Agents tab from base commit `c57a9a1e7` are a capture that must happen before this batch is committed (`batches.md:386`). This lane does not commit, does not run the app, and does not take screenshots (decision #53 forbids serve/dev). The base commit is still available for that capture. Visual review stays with the P5 visual-reviewer.
- **R-11 (LOW).** Every `keep` row above is unchanged. The agent Success row is the only replacement. `formatSuccessRate` is still the skill and command formatter.
- **R-5.** This batch does not register the handler. It only calls the method Batch 2 put on the typed registry. A missing handler throws; the state service stores `{}` and the card says "no data yet". The known-red host guard specs stay Batch 25's (`batches.md:112`).
- **Backend handler.** Batch 25 does not exist yet. Until it does, a live Agents tab shows "no data yet" for every agent after the RPC fails. That is the specified failure behavior (`implementation-plan-part-b.md:560-561`, `:577`), not a fabricated rate.
- **Rule 8 DI guards.** This batch registers no DI service, RPC handler, or MCP tool. No guard spec was edited.
- **Verification was not run.** The batch text says `npx nx test @ptah-extension/skill-synthesis-ui --parallel=1`, then lint (`batches.md:388-389`). Decision #53 forbids every Nx and Jest command while other lanes run. No test tail exists.

## Could not do

- Did not run `npx nx test @ptah-extension/skill-synthesis-ui` or `npx nx lint @ptah-extension/skill-synthesis-ui`. Decision #53. The team-leader runs that check.
- Did not capture the R-10 before screenshots. No serve, and this lane must not commit.
- Did not implement the `agent:outcomeSignals` handler. That is Batch 25.
- `ptah_*` tools, including `ptah_agent_report`, are not on this machine. Tool search against the connected MCP servers returned no `ptah` tools. Reads used the native search tools. The orchestrator report is in this file and in the lane's final message.
- Did not edit `batches.md` or `task.md`. No git writes.
