# Code Logic Review — `TASK_2026_707` dashboard v2, round 2

Review family: grok (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | One serious gap remains in the headline timeout fix |
| Verdict | REVISE |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 1 |
| Failure modes found | 2 |

Score 6 stays in the real-gaps band. It is not 5: defects 2 through 7 are fixed in the code the templates and registry actually render, each with a spec that asserts the new behaviour, and `provider:getPlanLimits` now has a 24s server ceiling under the 30s client timeout. It is not 7–8: a detection that uses its 12s cap and then a Codex lane that uses the remaining 12s still returns every read-kind owner as `service-unavailable` without calling the usage reader. That is the cold path batch A was meant to make reliable, and the new snapshot spec does not exercise it.

`ptah_*` tools are not exposed in this session (`search_tool` for `ptah` and `agent_report` returned no tools). `ptah_get_diagnostics` was not run. Orchestrator results accepted as given and not re-run: typecheck `cli-agent-runtime` and `rpc-handlers` PASS; Jest `cli-agent-runtime` limits 153/153; Jest `rpc-handlers` plan-limits 60/60.

## Round-1 defects

| # | Batch | Round-1 defect | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | A | `provider:getPlanLimits` can exceed the 30s client timeout | partly | Server ceiling is 24s (`plan-limits-snapshot.service.ts:84`), passed into discovery (`:147-148`) and each owner read (`:185-187`). Client default remains 30s (`claude-rpc.service.ts:135`); `PlanLimitsStore.load` does not override it (`plan-limits.store.ts:176`). Margin is 6s. A hung read settles inside that ceiling with the other owner kept (`plan-limits-snapshot.service.spec.ts:132-149`). Discovery can still consume the entire 24s before any usage read starts. See new defect 1. |
| 2 | B1 | `shortReset` forks the formatter and ignores exhaustion resets | fixed | `shortReset` is taken from `formatToolResetText` (`plan-tile-view.model.ts:985-991`). Exhaustion-only reset asserts `resets 4h 0m` and not `reset unknown` (`plan-tile-view.model.spec.ts:86-93`). |
| 3 | B1 | Docs still say to convene Tribunal from the dashboard | fixed | Tribunal guides now say to open the **Tribunal** tab (`apps/ptah-docs/src/content/docs/tribunal/relay.md:37`, `race.md:55`, `index.mdx:74`, `forge.md:50`, `crucible.md:81`, `council.md:94`). A search of `apps/ptah-docs` for `dashboard` under `tribunal/` returned no matches. |
| 4 | B1 | Windows past the third meter are absent from the tooltip | fixed | Overflow is appended to `hiddenWindowNotes` (`plan-tile-view.model.ts:1003-1008`). The tile title is that list (`provider-account-tile.component.ts:113-118`, `provider-account-tile.component.html:3`). Spec: five windows leave three meters and a `+2 more` note that includes `Window 4: 24%` (`plan-tile-view.model.spec.ts:96-102`). |
| 5 | B1 | Popover repair clause is not a registered step | fixed | `HARNESS_BLOCKED_RECONCILE_STEPS['marketplace-popover']` is the rendered clause (`harness-blocked-wording.ts:106`, `harness-health-badge.component.ts:29` and `:173`). The repair button is still behind `blocked().count > 0` (`harness-health-badge.component.ts:193-194`). Spec asserts the registry string (`harness-health-badge.component.spec.ts:193`). No `dashboard-card` key remains in `harness-blocked-wording.ts`. |
| 6 | B1 | Cooldown, evidence, and status notice are computed and not shown | fixed | `detailLines` collects status, cooldown, and evidence text (`provider-account-tile.component.ts:102-106`). Metered cells show the first line (`provider-account-tile.component.html:40-41`). The section `title` and `aria-label` get the full list (`provider-account-tile.component.html:3`, `provider-account-tile.component.ts:108-118`). Spec: cooldown text is visible and `Limit hit` is on `title` and `aria-label` while a meter is shown (`provider-account-tile.component.spec.ts:51-60`). |
| 7 | B2 | Strip is labelled as session activity; output tokens are not on the processed tile | fixed | Group label is `Usage totals for the selected range` (`usage-kpi-strip.component.ts:18`). Output is a visible processed subline (`:28`, `:98`). Spec asserts both (`usage-dashboard.component.spec.ts:163-166`). Cost tooltip no longer repeats output (`usage-kpi-strip.component.ts:64-68`). |

## Five logic questions

### 1. How does this fail silently?

A discovery that runs out the 24s budget does not reject. `readOwner` hits `remainingMs <= 0`, logs at debug, and returns `unreadSnapshot` (`plan-limits-snapshot.service.ts:188-193`, `:228-238`). The RPC succeeds. `PlanLimitsStore.apply` clears `loadError` and replaces the previous snapshot (`plan-limits.store.ts:236-241`). The card shows `service-unavailable` (or ledger windows plus "No live usage read") where a read never started.

A detection timeout still resolves that source to `undefined` and continues (`plan-limit-owner-discovery.service.ts:606-609`). Installed CLIs are omitted while selected-provider and Ptah CLI owners remain. That drop is the requested degradation. The hung-detector spec covers it (`plan-limit-owner-discovery.service.spec.ts:344-357`).

### 2. What user action produces unexpected behaviour?

Opening Analytics on a cold host where CLI detection takes about 12s and Codex is installed. The lane starts only after detection (`plan-limit-owner-discovery.service.ts:239-246`) and may use the rest of the 24s. The user waits about 24s and sees read-kind owners as usage-unavailable. Refresh used to keep the last good snapshot on a client timeout (`plan-limits.store.ts:244-254`). A successful partial snapshot now overwrites it.

### 3. What input data produces a wrong answer?

A reset passage is shortened with the first parenthetical only (`plan-tile-view.model.ts:987-991`). For a normal or exhaustion reset, `formatToolInstant` is `… UTC (in 3h 0m)` (`plan-limit-format.ts:173-176`, `:300-306`), and the spec locks `resets 4h 0m`. That path is not a wrong number. Overflow evidence past two items is a separate loss (new defect 2): the collapsed chip's `title` is not copied into the tooltip.

Null cost still renders `Unknown`. Null cached share still renders `—` (`usage-kpi-strip.component.ts:59-61`, `:76-78`).

### 4. What happens when a dependency fails?

One owner read that throws or times out becomes `service-unavailable` with ledger windows and does not reject `Promise.all` (`plan-limits-snapshot.service.ts:210-222`). A source that throws is logged with the `degradation-audit: reported` comment and dropped (`plan-limit-owner-discovery.service.ts:626-634`). A source that hits `remainingMs <= 0` is logged and dropped without that comment (`:606-609`). The snapshot spec shows a hung Codex read leaving the Ollama owner `available` (`plan-limits-snapshot.service.spec.ts:145-148`). That survivor is `kind: 'known'` (`:138`), so it never enters `readOwner`.

### 5. What is missing that the requirements never mentioned?

The 24s budget is one clock for discovery and reads, but reads start only after every discovery source has settled. No time is reserved for `getOwnerSnapshot`. The fix reports describe a partial snapshot when a read hangs after discovery; they do not describe discovery itself using the whole budget.

## New defects

### 1. Serious — detection plus the Codex lane can spend the entire 24s, so no usage read runs

- Batch: A
- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-limit-owner-discovery.service.ts:212-217` and `:239-246`; `libs/backend/rpc-handlers/src/lib/services/plan-limits-snapshot.service.ts:147-150` and `:185-193`
- Problem: `SNAPSHOT_BUDGET_MS` is 24_000 (`plan-limits-snapshot.service.ts:84`). Detection is capped at `SLOW_LIMIT_LOOKUP_DEADLINE_MS` (12_000, `evidence-precedence.ts:23`) against that same absolute deadline (`plan-limit-owner-discovery.service.ts:212-217`, `fromSource` at `:605`). The Codex lane starts only in `detected.then` (`:239-246`) and gets another `min(12_000, deadlineAt - now)`. When detection returns at about 12s with Codex installed, the lane is allowed to run until the deadline. `assemble` awaits `discoverTargets` before `Promise.all` of `ownerSnapshot` (`plan-limits-snapshot.service.ts:147-150`). `readOwner` then sees `remainingMs <= 0` and returns `unreadSnapshot` without calling `getOwnerSnapshot` (`:185-193`, `:228-238`). OpenCode, Antigravity, and Grok identities that `cli-store` already resolved are held until that `Promise.all` and get the same skip. The RPC still finishes inside 30s (`claude-rpc.service.ts:135`), which is why this is not the old hang. The body is a successful snapshot of `service-unavailable` owners, so the store replaces any previous good snapshot and clears `loadError` (`plan-limits.store.ts:176`, `:236-241`). A hung `detectAll` does not take this path: the lane sees an empty detection list and returns immediately (`plan-limit-owner-discovery.service.ts:412-419`), leaving about 12s for reads. The hole is a slow successful detection plus a slow Codex home resolution.
- Spec gap: `plan-limits-snapshot.service.spec.ts:132-149` waits 24s after an 11s discovery and a hung read. The kept owner is `kind: 'known'` (`:138`), which `ownerSnapshot` returns without a read (`plan-limits-snapshot.service.ts:165`). `plan-limit-owner-discovery.service.spec.ts:361-376` passes a 5s test deadline and checks identity only.
- Fix: Reserve a read window inside the 24s. Either pass `deadlineAt - reservedReadMs` into `discoverTargets` (reserved at least the slow read budget, 12s), or start `getOwnerSnapshot` for each owner as its source resolves so a Codex lane cannot block owners already found. Add a spec where detection resolves at 12s with Codex installed, `resolveCodexHomeOwner` never resolves, and a fast read-kind owner still receives `getOwnerSnapshot` and keeps that reader's status. Assert the snapshot settles before 24s and that `jest.getTimerCount()` is 0.

### 2. Moderate — evidence past the second item is only "+N more" in the tooltip

- Batch: B1
- File: `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:1021-1028`; `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts:102-106`
- Problem: After two evidence notices, the rest are spliced into one chip whose `text` is `+N more` and whose `title` holds the hidden sentences (`plan-tile-view.model.ts:1021-1028`). `detailLines` copies `item.text` only (`provider-account-tile.component.ts:104`). The section `title` and `aria-label` therefore never receive `item.title`. One or two evidence rows match the new spec (`provider-account-tile.component.spec.ts:51-60`). A third row is not recoverable by hover or by the accessible name.
- Fix: Map the overflow chip to its `title` (or stop collapsing and pass every `evidence.text`) inside `detailLines`. Extend the tile spec with three evidence items and expect each sentence on `aria-label`.

## Failure modes

### Cold detection plus Codex lane skips every live read

- Trigger: `detectAll` fulfills near 12s with Codex installed, and `resolveCodexHomeOwner` stays pending.
- Symptom: About 24s later the card lists those owners as `service-unavailable`. Ledger windows, if any, show with "No live usage read" (`plan-tile-view.model.ts:639-640`). A previous good snapshot is replaced. `loadError` is false.
- Evidence: new defect 1.
- Current handling: per-source caps on one shared deadline; reads are strictly after discovery.
- Recommendation: reserve read time, or read owners as soon as they are discovered.

### Collapsed owner evidence is not in the accessible name

- Trigger: an owner snapshot carries more than two `ownerEvidence` entries while meters are visible.
- Symptom: The visible line and the tooltip show `+N more` without the hidden sentences.
- Evidence: new defect 2.
- Current handling: chip `title` is set and never read.
- Recommendation: put that `title` on the detail tooltip and `aria-label`.

## Requirements still held

| Check | Result |
| --- | --- |
| 24s server budget vs 30s client | Held as a ceiling. `SNAPSHOT_BUDGET_MS` 24_000 vs `ClaudeRpcService` default 30_000. Store does not pass a shorter timeout. 6s is left for transport and scheduling. The ceiling is not a reserve for reads (new defect 1). |
| Partial owners keep status; nothing dropped with a fake 0 | Held for a read that actually starts: failure and timeout return ledger windows and `service-unavailable` (`plan-limits-snapshot.service.ts:210-238`). Known owners skip the read (`:165`). A read that never starts takes the same status, which is honest and is not a zero. The snapshot spec proves the known-owner case only. |
| Source throw still isolated | Held. `fromSource` catch logs `errorName` and returns `undefined` (`plan-limit-owner-discovery.service.ts:626-634`). |
| Reset text, overflow meters, harness clause, cooldown line, KPI label, output subline, Tribunal docs | Held. See the table above. |
| OnPush, signals, `input()`, no `[innerHTML]` on the touched tile and strip | Held. `ProviderAccountTileComponent` and `UsageKpiStripComponent` are standalone OnPush; state is `computed` from `input()`. Neither template uses `innerHTML`. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat defect 1 as partly fixed, and file the starved read phase as serious | Accept any return inside 30s as a full fix | The client timeout is closed (`plan-limits-snapshot.service.ts:84`, `claude-rpc.service.ts:135`). The usage read is still sequenced after a lane that may legally run until `deadlineAt` (`plan-limit-owner-discovery.service.ts:239-246`, `plan-limits-snapshot.service.ts:147-193`). The proving spec never builds that schedule. | Yes. A reserved read budget or pipelined reads. |
| Leave stale `HarnessCardComponent` comments out of this verdict | File them again as leftover user instructions | Round 1 already separated them from the user docs. `ipc-bridge.ts:214` and `skill-selection-card.component.ts:36` are comments. The Tribunal docs no longer name the dashboard control. | Yes |

## Jest

- Orchestrator, not re-run here: `cli-agent-runtime` limits 153/153; `rpc-handlers` plan-limits 60/60; typecheck of both projects PASS.
- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card libs/frontend/dashboard/src/lib/components/provider-account-tile --coverage=false --maxWorkers=2 --silent` — 3 suites passed, 66 tests passed (7.1s). Jest then force-exited a worker for open handles. The suites had already passed. No product timer was traced from that line.

Not run: usage-dashboard specs (B2 report records 35 passed), marketplace and shared harness specs (B1 fix report records them passed), browser, e2e, builds.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for defects 2–7 and for the 12s + 12s arithmetic. MEDIUM for how often `detectAll` actually sits on its 12s cap in production; the cap exists because that wait was observed.
- Top risk: a cold plan-limits load returns success full of `service-unavailable` cells and overwrites a good snapshot, after this round added the shared deadline that the lane is allowed to exhaust.
- What a robust implementation would add: a read reserve (or pipelined owner reads) with a spec for slow successful detection plus a hung Codex lane, and the overflow evidence `title` on the tile's accessible name.
