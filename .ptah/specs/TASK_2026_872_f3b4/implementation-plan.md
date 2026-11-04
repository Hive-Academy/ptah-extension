# Electron session inspector redesign plan

Scope: the `ptah-session-inspector` sidebar. Preserve the existing expanded stats strip that also uses `laneTiles`; evolve the shared model additively for that consumer, then remove inspector-only old rendering. No production file was changed in this planning task.

## Data flow

1. `AgentMonitorStore.agentsOwnedBySession(sessionId)` supplies one record per CLI run (`session-stats-source.ts:162-165`); `toStatsLimitLaneRun` carries `runId`, `cli`, `role`, `startedAt`, status, recorded `quotaOwner`, and structured/segment usage (`:82-96`). `PlanLimitsStore.snapshot().owners` supplies the per-owner windows and evidence (`:212-227`). The store's host scope already requests `runOwnerKeys` (`:167-175`); do not add a renderer RPC or infer owner from CLI name.
2. Build one normalized run presentation keyed by `runId`, using the existing `resolveCliLaneUsage` and exact Codex estimate rules (`inspector-agent-usage.ts:35-83`, `lane-stats.adapters.ts:98-149`). Feed AGENTS by matching roster key `cli:<runId>`; use the monitor record as source of truth, with the roster's retained segments as fallback when the monitor entry is absent. Numeric `0` is valid, null means unknown. Preserve `≥` for partial/inexact counts and `~` for estimated cost; never price other CLIs by guessing. Keep the existing `agentRunDurationMs` path with one shared wall clock, and show a visible Time cell. The run detail must include model, started instant, status, owner/scope relation, limit notes and source/evidence facts formerly in the LANES expansion. A run with no recorded owner stays “Unknown owner”; never borrow the current session's account.
3. In the limit view model, group provider rows by canonical CLI family (`run.cli`, not `cli+role`), deduplicating any number of runs and roles. Resolve the owner per provider from the **recorded owner keys** on that provider's runs. If exactly one owner is present, render only its applicable windows (respecting model scope and shared `applicableLimits`/classification). If several distinct owners occur, show a neutral “multiple accounts” state with owner-specific details on expansion; do not merge their usage percentages. If no recorded owner or no tracked windows, show “Limits not tracked” or “Usage unknown”, according to snapshot status. A provider row has one primary window bar, `% used`, reset text, and an expanded list/selector for other windows. Preserve all windows, source labels, stale/refresh explanations and cooldown/evidence. Keep `planTiles` for main PLAN LIMITS and `laneTiles` for the existing strip.
4. Render provider rows via a new small `ProviderLaneLimitTileComponent` composed around the existing `PlanLimitTileComponent` and its `PlanWindowDetailComponent` pattern. `PlanLimitTileComponent` accepts one `PlanLimitTileModel` and already renders inspector bar/percent/reset (`plan-limit-tile.component.ts:128-162,230-284,336-343`); it cannot directly accept a whole provider or switch windows. The wrapper owns selected window and open state. Keep a stable key `provider:<cli>` across pushes. The main PLAN LIMITS tiles continue to show the session account. Duplicate window facts are allowed when a provider's account is the session account; the sections now have different scopes, but the link/focus behavior should avoid a second incompatible reading.
5. Move Σ into AGENTS below all runs, outside the six-row `Show N more` cap. Derive it from the same normalized CLI runs, preserving known totals, unknown counts and lower bounds (`lane-tiles.ts:763-780`), with `lane · not in totals` beside it. No addition to the orchestrator/session total. The AGENTS header retains agent counts and gains the CLI run count; LANES header reports provider count, with no “N · M runs” wording.

## Component contracts

- `InspectorAgentsSectionComponent`: retain `tabId = input.required<string>()`, `agents = input.required<SectionState<InspectorAgentsData>>()`, selected/requests/steering inputs and outputs (`inspector-agents-section.component.ts:226-245`). Add `laneRuns = input<readonly InspectorLaneRunDetail[]>([])` and `laneSubtotal = input<LaneSubtotalTileModel | null>(null)` from the session stats limit model. Use `runId` to enrich each CLI `AgentListRow`; do not assume array ordering. Add a per-row expansion signal keyed by stable agent key, a separate `expanded = output<void>()` on `InspectorAgentRowComponent`, and a dedicated run detail component to keep the section file small. Stop remains driven by `SessionAgentTrayService`, gated by `entry.stoppable`; selection and expansion must be independent keyboard controls.
- `InspectorAgentRowComponent`: `row = input.required<AgentListRow>()`, `selected = output<void>()`; add `expanded = input<boolean>(false)`, `expandable = input<boolean>(false)`, `expansionToggled = output<void>()`. Show Time and a text status chip while keeping name/model, token/cost titles and avatar. The new run detail component takes `detail = input.required<InspectorLaneRunDetail>()`; owner and limit facts are read-only text, and the parent handles actions.
- `StatsLimitViewModel`: add `inspectorRuns: readonly InspectorLaneRunDetail[]`, `providerLimits: readonly ProviderLaneLimitModel[]`, and keep `planTiles`, `laneTiles`, `subtotal`, `lanesCount` for other consumers. Each run detail has `runId`, CLI/role label, model, usage text/markers, duration inputs or rendered duration, status badge, started timestamp, recorded owner relation and limit explanation. Each provider model has stable id, provider label, selected owner state, `readonly PlanLimitTileModel[]` windows and explicit empty/unknown status. Store facts, not live timer closures, in the model.
- `InspectorLimitsLanesComponent`: keep `limits = input.required<StatsLimitViewModel>()` and `sessionId = input<string | null>(null)` (`inspector-limits-lanes.component.ts:89-92`). Render `limits().providerLimits` instead of `laneTiles` and subtotal. Wrapper: `provider = input.required<ProviderLaneLimitModel>()`, `open = input<boolean>(false)`, `selectedWindowId = input<string | null>(null)`, `toggled = output<void>()`, `windowSelected = output<string>()`, `planTileRequested = output<string>()`. Persist expansion/selection per session/provider using `StatsTileExpansionState` or a small keyed signal in the parent; use `<ptah-plan-limit-tile variant="inspector">` for the selected window. Keep focus transfer to matching main PLAN LIMITS tile when available.
- `SessionInspectorComponent` template: pass `s?.limits?.inspectorRuns ?? []` and `s?.limits?.subtotal ?? null` into AGENTS (`session-inspector.component.html:185-207`). That is the single cross-section handoff; `session-stats-source.ts` already creates both from the same snapshot.

## Files and batches

**Batch 1 — shared view model and provider limit UI (`libs/frontend/chat-ui` only):**

- Change `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.types.ts` and `stats-limit-view-model.ts`: add per-run and provider-limit models; retain strip fields; group by CLI and recorded owner; use existing window classification/formatting.
- Change `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts` only to extract reusable run/subtotal formatting and fix partial/estimate parity; preserve old strip tile output.
- Create `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/provider-lane-limit-tile.component.ts`: one provider, selectable windows, compact unknown state, expansion, source/cooldown facts, existing plan tile reuse.
- Change `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.ts`: provider rows/count, retain PLAN LIMITS, remove inspector run tiles and Σ rendering.
- Change `libs/frontend/chat-ui/src/index.ts`: export only the new public models/components needed by `chat` through `@ptah-extension/chat-ui`.
- Update `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts`, `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-limits-lanes.component.spec.ts`, and add `provider-lane-limit-tile.component.spec.ts`. Test 3 Codex runs → 1 row, multiple windows, unknown/no owner, multiple owners, stale source, reset text, accessible selector and focus link. Keep existing `lane-usage-tile.component.spec.ts` passing for the strip.

**Batch 2 — AGENTS integration (`libs/frontend/chat` only):**

- Change `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html` to pass the new inputs; only change `session-inspector.component.ts` if type adaptation is needed. Do not grow its section logic.
- Change `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.ts`, `inspector-agent-row.component.ts`, `inspector-agent-list.ts`, and `inspector-agent-usage.ts`: join by run id, visible Time/status and expansion, transfer role and detail, move Σ and caption. Use current tray action path for Stop.
- Create `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agent-run-detail.component.ts` for the formerly nested run table and owner/limit facts.
- Update `libs/frontend/chat/src/lib/components/organisms/session-inspector/inspector-agents-section.component.spec.ts`, `inspector-agent-usage.spec.ts`, `inspector-agent-list.spec.ts`, and `session-inspector.component.spec.ts`; add `inspector-agent-run-detail.component.spec.ts` only if its owner/window rendering has distinct behavior. Test source reconciliation, `≥`/`~`, real unknown, duration tick, role label, Stop, independent expand/select, subtotal and Show N more.

These batches are file-disjoint. Before imports, verify `chat -> chat-ui` remains allowed and `chat-ui` never imports `chat`; existing `session-stats-source.ts:8-15` already shows that dependency direction. No new library or RPC contract is needed. After implementation, run diagnostics scoped to changed files and the changed projects' targeted Jest specs; capture before/after Electron sidebar screenshots as task context requests. This planning lane runs no checks.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep Σ in AGENTS | Keep/move/drop | User explicitly allows it; `lane-tiles.ts:763-780` has partial/unknown semantics and `stats-limit-view-model.ts:14-16` says lane usage stays outside session totals | Yes |
| Deduplicate LANES by CLI family, not role | CLI / CLI+role | Current `laneTileId` uses CLI+role (`lane-tiles.ts:85-86`), which causes duplicate Codex rows; request says one provider row | Yes |
| Do not merge different owners | Merge / choose latest / show multiple-account state | `stats-limit-view-model.ts:17-19` forbids borrowing another owner's windows; `session-stats-source.ts:167-175` loads recorded owners | Yes |
| Compose existing plan tile for the chosen window | Reuse directly / wrapper / fork | `PlanLimitTileComponent` takes one tile (`plan-limit-tile.component.ts:336-343`) and already has the inspector progress bar | Yes |
| Preserve expanded stats strip contract | Remove `laneTiles` globally / change inspector rendering only | `stats-limit-view-model.ts:55-69` feeds shared consumers; task targets Electron sidebar | Yes |
| Keep Stop in AGENTS | Move from LANES / retain tray action | Stop exists in AGENTS menu (`inspector-agent-actions-menu.component.ts:26-45`), not current lane tile | Yes |

## Risks

- Different owner or model scope on successive runs of one provider: a single merged bar would mislead. Show a multiple-account/unknown state and per-owner details instead; test it.
- `usageTotals` and retained segments may differ in completeness. Centralize normalization and keep null distinct from zero; verify both paths and the estimate markers.
- The selected provider window can disappear after a refresh. Fall back to the current primary eligible window by stable id and announce the selection change accessibly.
- The main PLAN LIMITS card and provider row may show the same account/window. Reuse the same formatter and keep owner/source labels so values do not contradict each other.
- The sidebar is narrow. A Time column and independent expand control need responsive truncation and keyboard/focus checks in Electron screenshots.
- The shared stats strip depends on `laneTiles`; removing that model now would be a public UI regression outside this task.

## Clarifications Needed

None. The existing owner and window rules give a defensible default for provider rows with several accounts.

