## Frontend implementation — `TASK_2026_596_0a19`, batch 20

**Tasks completed**: 20.1 (chat view builds `limits`), 20.2 (`extractCliAgentStats` delegates to `addCliUsage`)

**Files** (worktree root `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets`):

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`: `StatsTileExpansionState` added to `providers`. Adds `PlanLimitsStore` injection, `_limitTime`, `sessionLaneRuns`, `sessionRunOwnerKeys`, `resolvedStatsLimits`, a load effect, and the exported pure mapper `toStatsLimitLaneRun`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`: adds `[limits]="resolvedStatsLimits()"` and `[sessionId]="resolvedSessionId()"` on `ptah-session-stats-summary`. This is the only change to the host binding at `:27-33`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\templates\chat-view.component.spec.ts`: the harness gains a `PlanLimitsStore` stub and exposes the `agentsForSession` mock. Adds a new describe block, "plan limits wiring (TASK_2026_596)", with 8 cases.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`: `extractCliAgentStats` is now a reduce over `addCliUsage`.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.ts`: adds `restored?: boolean` at the end of the `MonitoredAgent` interface, and `restored: true` in `loadCliSessions` only. This is outside the Batch 20 file list. See "Plan deviations".
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-596-quota-resets\libs\frontend\chat-streaming\src\lib\agent-monitor.store.spec.ts`: one new case. A finished live card is not restored, and a running card from `loadCliSessions` is restored.

Unchanged: `stats-bar.utils.spec.ts` (the oracle), every settings path, `session-stats-summary.component.*`, and `batches.md`. No git was run.

**Stack observed**
- Angular, with standalone OnPush components, `inject()`, `computed` and `effect` plus `untracked`, as in `chat-view.component.ts`.
- `PlanLimitsStore` comes from `libs/frontend/core/src/lib/services/plan-limits.store.ts`.
- The view model comes from `libs/frontend/chat-ui/src/index.ts:72-78`.
- The time pattern is copied from `provider-account-card.component.ts:342-345`.

**Design fidelity**: no markup was added. The tiles are the Batch 19 components, fed through the existing `limits` and `sessionId` inputs. A3 is met: one `StatsTileExpansionState` per `ChatViewComponent`, released with the view.

### Per-task evidence

**20.2: fold delegation**
- `extractCliAgentStats(segments)` is now `segments.reduce((stats, {usage}) => addCliUsage(stats, usage), null)`.
- `addCliUsage` is imported from `@ptah-extension/shared` (`libs/shared/src/lib/utils/index.ts:45`).
- The skip rule (no defined field), the sums, and latest-wins for model, cost and duration are the same. The result is `null` until any usage has been seen.
- 597 seam: the fold now lives only in `addCliUsage`, as plan `:1345-1349` requires.
- The existing `stats-bar.utils.spec.ts` passes with no edits (the file does not appear in `git status`).

**20.1: chat view builds `limits`**
- `providers: [TranscriptRetentionService, PanelResizeService, StatsTileExpansionState]`.
- `resolvedStatsLimits` is a `computed` that calls `buildStatsLimitViewModel` with:
  - `sessionId`
  - `sessionOwnerKey` from `planLimits.sessionOwner(id)?.ownerKey ?? null`
  - `sessionModelScope` from `sessionOwner?.modelScope ?? null`
  - `owners` from `snapshot.owners`
  - `laneRuns` from `agentsForSession(id).map(toStatsLimitLaneRun)`
  - `now` from `planLimits.now()`, the store's existing 30 s tick. No new timer was added.
  - `time` from `_limitTime`
- It returns `null` when no session is open or before the first snapshot. The strip then renders exactly as it does today. A failed read gives an empty snapshot, which renders as "Unavailable".
- Load effect: on any change of `resolvedSessionId` or of the recorded owner-key set, it calls `planLimits.load({sessionIds: id ? [id] : [], ownerKeys})`.
  - `sessionRunOwnerKeys` is sorted, de-duplicated, and uses structural `equal`. Streaming deltas therefore do not trigger a reload, but a newly recorded owner does.
  - This matters because restored runs arrive asynchronously after the session change. Firing only on the session change would never request their owners.

### How each carry-forward was closed

| Carry-forward | Closure | Spec |
|---|---|---|
| Time from `{timeZone: Intl…resolvedOptions().timeZone, zoneNameLocale: inject(LOCALE_ID)}`, never `'UTC'` | `_limitTime` field | "formats times in the host zone and app locale": mocks `resolvedOptions` to `Europe/Berlin` and checks the zone and `LOCALE_ID` |
| `load` always receives explicit `sessionIds` and `ownerKeys`, `[]` with no session | The effect always sends both | "loads the session … sends [] for both once no session is open": session A, then `sessionIdSig.set(null)`, gives `{sessionIds:[], ownerKeys:[]}` |
| `ownerKeys` come from `agent.quotaOwner?.key`; a run with no owner adds no key and is unknown | `recordedOwnerKeys`; the view model reads the absent owner as `not-recorded` | Same spec (the ownerless run adds no key); the F58 spec gets `ownerStatus` `['not-recorded','same']` |
| `usageTotals` null or absent means unknown, never 0 | Passed through unchanged | `it.each` with null and absent |
| `restored` comes from the restore path, never from status | `MonitoredAgent.restored` set only in `loadCliSessions`; the mapper reads `restored === true` | Mapper spec (restored+running is true, live+completed is false) and store spec (live finished card undefined, restored running card true) |
| `cliLabel` is the card's display name | `agent.displayName \|\| agent.cli`, the same expression as `agent-card-header.component.ts:45` | Mapper spec |
| `modelScope` and `sessionModelScope` only when backend-resolved, else `null`; no string matching | Lanes get `modelScope: null`, because a run record carries no resolved scope. The session gets `sessionOwners[id].modelScope`, which the backend resolves | F58 spec: the session's `opus` window tile renders, and the lane subgroup gets the info note "Model unknown · model-specific limits are not applied" |
| F58: only runs from `agentsForSession` | `sessionLaneRuns` calls `agentsForSession(id)`, and returns `[]` with no session (unlike `sessionAgents`, which returns every agent on the main panel) | F58 spec: `lanesCount` is 2, and the run from the other session is excluded |
| `stats-bar.utils.ts` fold delegates to `addCliUsage` | Task 20.2 | The existing spec passes unchanged |
| R5: only the named regions change; no 597 behaviour; no settings files | chat-view edits are limited to imports, the module-level mapper, `providers`, the view-model region after `resolvedCompactionCount`, one constructor effect, and the host binding | `git status` lists 6 files and no settings path |

**States covered**:
- No session, or no snapshot yet: `limits` is null, so today's strip renders.
- A failed read gives an empty snapshot, which reads "Unavailable".
- Unknown owner, unknown usage and unknown model scope each have their own state, provided by the Batch 18 and 19 model and components.
- Keyboard and ARIA behaviour belongs to the Batch 19 components and is unchanged.

**Verification**: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat ptah-extension-webview @ptah-extension/chat-streaming`, run in the foreground with no extra flags.
- Result: "Successfully ran targets typecheck, test, lint for 3 projects", 9/9 targets, cache 0/9 hit, so every target actually ran. The Nx Cloud 401 notice is unrelated.
- Focused run before that: `npx jest -c libs/frontend/chat/jest.config.ts …chat-view.component.spec.ts -t "plan limits wiring"` gave 8 passed and 54 skipped.

**Plan deviations**
1. **Store flag outside the batch file list.** Batch 18 says "add the flag where the card is created, or keep a set of restored ids". The chat view never sees `loadCliSessions`, which `SessionLoaderService` calls, so it cannot keep that set itself.
   - I added `restored?: boolean` to `agent-monitor.store.ts`, in the `MonitoredAgent` tail and the restore path. Batch 17's R5 rule already allows edits in both regions.
   - I added one store spec case and ran `@ptah-extension/chat-streaming` as well.
   - A same-id re-open spreads `...existing`, so the card stays restored. A replacement card is new and is not restored.
2. **`sessionModelScope` source.** Task 20.1 and plan `:1196` say to take it from `resolvedLiveModelStats().model`. That value is a raw model id, and the Batch 18 binding carry-forward forbids string matching in the UI and asks for a backend-resolved scope. I used `PlanLimitSessionOwner.modelScope` instead (`plan-limit.types.ts:160-164`), which the backend resolves per session. The later binding rule wins.
3. **The load also fires when the owner set changes**, not only on a session change. Without this, restored runs never get their owner snapshots, which Decision 10 needs.
4. **`toStatsLimitLaneRun` is exported** from `chat-view.component.ts` so it can be unit-tested. The file already exports `AGENT_PANEL_OVERLAY_BREAKPOINT`.

**Out-of-scope observations** (for the Phase 6 review)
- **Several surfaces compete for the store's scope.** `PlanLimitsStore.load` replaces `sessionIds` and `ownerKeys`, so in canvas grid mode each tile, plus the hidden main panel, overwrites the others' scope. The last loader wins.
  - Other tiles then have only their ledger-known `sessionOwners`, because the host always returns those (`plan-limits-snapshot.service.ts:216-225`).
  - A fix belongs in the store (a union across surfaces, or per-surface registration). It is not chat-view work.
- **Unattributed runs appear in every session.** `agentsForSession` uses `agentVisibleInSession`, so a run whose `parentSessionId` has not resolved yet shows in every session's lane tiles for that short time. This follows the carry-forward ("only runs from `agentsForSession`") and the store's documented scoping rule.
- `chat-view.component.ts` was already over the warn-level `max-lines` limit before this batch, and now has 121 more lines. Lint passes because the rule is a warning.
