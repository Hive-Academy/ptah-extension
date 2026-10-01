# Parity Inventory - TASK_2026_586_2b3e

Branch `fix/task-586-thoth-activity-feed` at `c4ab013f3`. I read the old code only. Nothing here designs the
replacement. All paths are relative to the worktree root
`D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed`.

Abbreviations used in the table:

- `TAB` = `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`
- `PSC` = `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts` (the surviving summary, "the Activity view's header", PSC:83)
- `ACC` = `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.ts` (the overlapping summary being removed)
- `FEED` = `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts`
- `TOG` = `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-trigger-toggle.component.ts`
- `DSS` = `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts`
- `DRPC` = `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-rpc.service.ts`
- `SSS` = `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
- `HND` = `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`
- `SHELL` = `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`
- `TSS` = `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts`

`Decision` values:

- `keep`: stays where it is, with the in-scope fix applied where one is noted.
- `move`: leaves the accordion or the Activity tab and must reappear at the new location.
- `remove-proposed`: needs the user's approval; each one is listed again under Proposed Removals.

56 capabilities: A 8, B 14, C 17, D 4, E 2, F 11.

## Key findings

1. **Polling has to move with the feed.** The accordion is the **only** caller of `DSS.startPolling()` (ACC:235-242; DSS:135-154). If it is unmounted with no replacement, the surviving card PSC only updates from live pushes after the snapshot taken when the tab opens (TAB:929). That freezes its last-analysis label, today counts and reason chip, and drops the drift correction DSS:160-161 depends on.
2. **The surviving card needs new inputs for the moved rows.** PSC does not have last curator pass, the three-bucket histogram breakdown, the sessions-analyzed-today total, or an absolute last-run time. Each `move` row into PSC means a new input wired from TAB (for example `lastCuratorPassAt`). PSC's existing `histogram` input (PSC:278) is used only for the two today counts.
3. **A second `events[0]`-as-latest consumer.** `ineligibleHint` in `TAB:769-780` (`events[0]` at :772) drives the hint on the Sessions sub-view (TAB:241-243). The verdict does not cite it, and it must follow the newest-first fix together with PSC:316-329.
4. **Item-6 corrections:**
   - **Tiles already refresh on a workspace switch.** TSS:162-170 re-runs `refresh()` when the workspace root changes. They freeze only across tab switches within one workspace (SHELL:214-216 → `refreshIfNeeded`, TSS:262-266).
   - **The Skills tile does not literally count all workspaces.** TSS:302-304 passes no `scope`, and the backend then defaults to `'workspace'` (HND:2170-2175, commit `1b1bcbe82`). The remaining defects:
     - (a) no explicit workspace: the root comes from the **backend's** `workspaceProvider.getWorkspaceRoot()`, not from the workspace the webview shows;
     - (b) candidates whose project was never recorded are counted (`workspace_root IS NULL`, `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:399`);
     - (c) the count is capped at 100 by `clampLimit(parsed?.limit, 100)` (HND:408, HND:2218-2223).

## A. Activity tab: the surviving summary (`ptah-skill-pipeline-status`)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| A1. Mounts the summary card on Activity with 6 inputs | TAB:474-481 | inputs from DSS and `SkillSynthesisStateService` | keep | Same mount point | `skill-synthesis-tab.component.spec.ts:335`, `:495`, `:539` |
| A2. "Last analysis" relative label (`never`, `Ns/m/h/d ago`) | PSC:127-128, PSC:301-305, PSC:474-484 | `skillSynthesis:diagnostics` → `lastAnalyzeRunAt` (HND:702); live via DSS:166-167 | keep | Same | `skill-synthesis-tab.component.spec.ts:495`, `:539` |
| A3. Reason chip (`ineligible` / `rate-limited`) taken from `events[0]` as "latest" | PSC:129-140, PSC:316-329 | `recentEvents` from `skillSynthesis:diagnostics` (HND:714-720) + live push | keep (must follow the newest-first fix: today `events[0]` is the OLDEST of the window) | Same | `skill-pipeline-status.component.spec.ts:262`; `skill-synthesis-tab.component.spec.ts:495` (seeds one event, so it cannot detect the ordering bug) |
| A4. "Today: N accepted, M ineligible" (ineligible = tooThin + rejected) | PSC:142-152, PSC:307-314 | `eligibilityHistogram` (HND:709-713; backend counters `SSS.getEligibilityHistogram`, day rollover) | keep | Same | `skill-synthesis-tab.component.spec.ts:495` |
| A5. Drain runs list (tier, status tone, duration, started/scheduled, summary, empty state) | PSC:155-208, PSC:331-342, PSC:445-462 | `drainRuns` from `SkillSynthesisStateService.refreshQueue()` (TAB:930) | keep | Same | `skill-pipeline-status.component.spec.ts:163`, `:204`, `:215`, `:224`, `:249` |
| A6. Stage cost strip (tokens today, dispatches, queued, in-flight, failed; bar scaled on tokens, else on dispatches; unattributed bucket) | PSC:210-272, PSC:344-427 | `queueItems` + `stageSpend` from `refreshQueue()` | keep | Same | `skill-pipeline-status.component.spec.ts:278-498` (15 cases) |
| A7. `histogram` input wired but used only for the today counts, not as bars | PSC:278, TAB:476 | `eligibilityHistogram` | keep (the moved histogram rows B4/B5 can reuse it) | Same | as A4 |
| A8. `now` clock-override input (test seam for relative labels) | PSC:299, PSC:429-431 | n/a | keep | Same | `skill-pipeline-status.component.spec.ts:224`, `:249` |

## B. Activity tab: the overlapping summary (`ptah-skill-diagnostics-accordion`)

Every row in this section leaves the accordion. A `move` row must reappear on Activity, or in Settings for the triggers. Every `remove-proposed` row is repeated under Proposed Removals.

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| B1. Mount of the accordion on Activity | TAB:486; import TAB:36, TAB:70 | n/a | remove-proposed (the component itself; its capabilities are dispositioned in B2-B14) | n/a | `skill-diagnostics-accordion.component.spec.ts:83` |
| B2. "Last analyze run" panel, absolute `toLocaleString()` or `Never` | ACC:30-39, ACC:225-228 | `lastAnalyzeRunAt` (same source as A2) | move (PSC already shows the relative label; keep the absolute time, e.g. as a tooltip or secondary text; needs a PSC rendering change) | PSC band 1 | `skill-diagnostics-accordion.component.spec.ts:83`; no PSC test for absolute time (missing) |
| B3. "Last curator pass" panel, absolute time or `Never` | ACC:41-50, ACC:230-233 | `lastCuratorPassAt` (HND:703; backend `recordCuratorPass` in SSS; live DSS:168-169) | move. **Not in PSC today**: needs a new PSC input, wired from `DSS.lastCuratorPassAt` in TAB | PSC band 1 | `skill-diagnostics-accordion.component.spec.ts:83`; PSC coverage missing |
| B4. "Sessions analyzed today (N)", the sum of all three buckets | ACC:53-60, DSS:71-74 | `eligibilityHistogram` | move (PSC shows accepted + ineligible but not the total; derivable from the existing `histogram` input) | PSC band 1 | `skill-diagnostics-accordion.component.spec.ts:83` |
| B5. Eligibility histogram, 3 proportional bars (too thin / rejected / accepted) via `ptah-eligibility-histogram` | ACC:61-63; `diagnostics/eligibility-histogram.component.ts` | `eligibilityHistogram` | move. PSC folds tooThin and rejected into one "ineligible" number, so the breakdown would be lost. Verdict C.4: the histogram appears only in the accordion | PSC, or directly under it on Activity | `eligibility-histogram.component.spec.ts:23`, `:32` |
| B6. "Candidates by status" (Candidates / Promoted / Rejected) | ACC:66-94, DSS:189-195 | `skillSynthesis:diagnostics` → `store.getStats()` (HND:700-707) | remove-proposed: it duplicates the always-visible `ptah-skill-stats-strip` (TAB:153; `skill-stats-strip.component.ts:34`, `:55`, `:76`, `:94`, `:112`), which reads the **same** `store.getStats()` via `skillSynthesis:stats` (HND:510-517) and also shows Active skills and Invocations | Already covered by the stats strip | `skill-diagnostics-accordion.component.spec.ts:83`; the stats strip has no dedicated spec |
| B7. "Recent events" section hosting `ptah-skill-event-feed` | ACC:96-105 | `recentEvents` (section C) | move. Verdict C.4: the feed exists only in the accordion | Activity, standalone section (grouped, newest-first) | `event-feed.component.spec.ts:19-85`; `skill-diagnostics-accordion.component.spec.ts:83` |
| B8. Triggers panel, 8 controls: sessionEnd, idleMs (on → 600000), bootScan, subagentStop, turnComplete, postToolUse, postToolUseMinEditCount (1-20), maxAnalyzesPerHour (0-1000, on → 60) | ACC:107-170, ACC:244-305; TOG:8-73 | write: `skillSynthesis:setTriggers` (DRPC:48-59 → HND:808-845, writes `ptah.*` config via `flattenSkillTriggers`); read: `skillSynthesis:diagnostics.triggers` (HND:721-732) | move (task scope: "Move the trigger toggles to Settings") | Skills → Settings sub-view (TAB:582-602 / `skill-settings-panel.component.ts`). Persistence differs: triggers save **immediately** per control via `setTriggers`; the settings panel saves one batched form via `skillSynthesis:updateSettings` (TAB:972-985) | `skill-diagnostics-accordion.component.spec.ts:125`, `:201`, `:223`, `:245`, `:267`; `skill-trigger-toggle.component.spec.ts:50-126`; `skill-diagnostics-state.service.spec.ts:162`; `skills-synthesis-rpc.handlers.spec.ts:590` |
| B9. Frontend trigger defaults before the first snapshot (no subagentStop / postToolUse / maxAnalyzesPerHour) | DSS:15-20 | n/a | keep (the toggles in Settings render these defaults until `diagnostics.refresh()` resolves; TAB:929 runs it on tab init whatever the sub-view) | Same | `skill-diagnostics-state.service.spec.ts:85` |
| B10. "Analyze current session" button: disabled without an active session, hint text, `force: true` | ACC:178-197, ACC:307-309; DSS:76-79, DSS:97-122 | `skillSynthesis:analyzeNow` (DRPC:36-46 → HND:749-802). Reads `TabManagerService` from `@ptah-extension/chat-state` (DSS:3, DSS:40); consumption only | move | Activity actions row (beside the feed or in the PSC header) | `skill-diagnostics-accordion.component.spec.ts:113`, `:155`, `:170`, `:185`; `skill-diagnostics-state.service.spec.ts:106-149` |
| B11. "View logs" button, which only calls `state.refresh()` and opens no logs | ACC:198-204, ACC:311-313 | `skillSynthesis:diagnostics` | remove-proposed (misleading label; replace with a correctly labelled "Refresh" if a manual refresh is wanted) | n/a, or "Refresh" on Activity | none |
| B12. Diagnostics error text (`state.error`) | ACC:205-207; DSS:58, DSS:90-91, DSS:117-118, DSS:130-131 | errors from diagnostics / analyzeNow / setTriggers | move (it needs a home on Activity for refresh and analyze errors, **and** in Settings for setTriggers errors) | Activity actions row + Settings triggers section | `skill-diagnostics-accordion.component.spec.ts:139`; `skill-diagnostics-state.service.spec.ts:99` |
| B13. 30-second diagnostics poll, ref-counted: start on init, stop on destroy | ACC:235-242; DSS:13, DSS:135-154 | `skillSynthesis:diagnostics` every 30 s | move. **The accordion is the only caller of `startPolling()`** (Key finding 1) | The Activity component that owns the feed or summary, or TAB while the Activity sub-view is shown | `skill-diagnostics-accordion.component.spec.ts:147`; `skill-diagnostics-state.service.spec.ts:168` |
| B14. The accordion's own `refresh()` on init | ACC:236 | `skillSynthesis:diagnostics` | remove-proposed (it duplicates TAB:929, so opening Activity today makes a second diagnostics call) | n/a | none |

## C. Event feed pipeline: ordering, identity, grouping (keep, with the fix)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| C1. Backend in-memory ring of 200 events, FIFO eviction | SSS:191, SSS:992-997 | n/a (process memory; the durable ledger is phase 6) | keep | Same | `skill-synthesis.service.spec.ts:776` |
| C2. `recentEvents(limit)` returns the newest window **oldest-first** (`slice(-safe)`) | SSS:1037-1040 | used by `SkillSynthesisDiagnosticsService.getSnapshot` (`libs/backend/skill-synthesis/src/lib/diagnostics.service.ts:31-32`) | keep (reverse to newest-first) | Same | `diagnostics.service.spec.ts:164` (limit forwarding only; no ordering test) |
| C3. Snapshot event limit: wire `eventLimit` ≤ 200 (`skills-synthesis-rpc.schema.ts:256-259`), default 10 (`diagnostics.service.ts:28`); the frontend never passes it (DSS:88) | as cited | `skillSynthesis:diagnostics` | keep | Same | `skills-synthesis-rpc.handlers.spec.ts:331` |
| C4. Diagnostics `workspaceRoot` param accepted but ignored, so events and histogram are machine-wide | `diagnostics.service.ts:27` (`_workspaceRoot`) | `skillSynthesis:diagnostics` | keep (out of scope; noted because Activity is not workspace-scoped while the Skills tile will be) | Same | none |
| C5. Event → wire mapping has no id; candidateId/reason are folded into `stats` | live: SSS:1019-1046; snapshot: HND:714-720 (re-maps to kind/timestamp/sessionId/stats/error only) | `SkillSynthesisEventWire` (`libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:50-56`); internal `SkillSynthesisEvent` (`libs/backend/skill-synthesis/src/lib/diagnostics.types.ts:20-28`) | keep (add an id to the internal event, both mappers and the shared wire type; keep it ULID-compatible for phase 6) | Same | `skills-synthesis-rpc.handlers.spec.ts:331`; `skill-synthesis.service.spec.ts:391` |
| C6. Live push: backend broadcasts `SKILL_SYNTHESIS_EVENT` per event | SSS:998-1011 | webview message `MESSAGE_TYPES.SKILL_SYNTHESIS_EVENT` (`libs/shared/src/lib/types/messages/payload-map.ts:170`) | keep | Same | `skill-synthesis-live.service.spec.ts:88` |
| C7. Live consumer appends at the **tail** with cap 50 (`[...list, event].slice(-50)`), and bumps the last-run timestamps and histogram | DSS:163-179; caller `skill-synthesis-live.service.ts:98` | as C6 | keep (newest-first; dedupe against the snapshot by id) | Same | `skill-synthesis-live.service.spec.ts:88` (forwarding only); no DSS `pushLiveEvent` ordering test |
| C8. Snapshot replaces the list wholesale on every refresh or poll | DSS:184 | `skillSynthesis:diagnostics` | keep | Same | `skill-diagnostics-state.service.spec.ts:85` |
| C9. Feed renders `events.slice(0, limit)`, `limit` = 10, so oldest-first input shows the oldest 10 | FEED:52-65 | n/a | keep (newest-first + grouping) | Activity standalone section | `event-feed.component.spec.ts:26` (asserts count only, with input already newest-first, so it cannot catch the bug) |
| C10. Row identity `track ev.timestamp + '-' + ev.kind` | FEED:26 | n/a | keep (track by the real event id) | Same | none |
| C11. Per-kind badge colours (analyze-run, ineligible, error, curator-pass, subagent-stop, edit-then-test, rate-limited, default ghost) | FEED:28-30, FEED:67-86 | n/a | keep | Same | partial: `event-feed.component.spec.ts:43-85` |
| C12. Relative time, session id, outcome text (error > rate-limited "Limit N/hour reached, resets at HH:MM" > `subagent=…` > "edits=N, tests passed" > first 3 stats `k=v` > `—`) | FEED:31-43, FEED:88-144 | n/a | keep | Same | `event-feed.component.spec.ts:43`, `:53`, `:69`, `:85` |
| C13. Empty state "No recent events." | FEED:22-23 | n/a | keep | Same | `event-feed.component.spec.ts:19` |
| C14. Grouping of repeated events: **absent**. One `analyze-run` is pushed per registered or reused candidate (SSS:916-923); the drain stage handler calls `analyzeSession` per queue row (`libs/backend/skill-synthesis/src/lib/queue/stage-handlers.service.ts:272`) | as cited | n/a | keep (new behaviour: group repeated same-kind events with counts) | Same | none (acceptance requires a new spec) |
| C15. Sessions sub-view hint taken from `events[0]` ("Recent sessions were marked ineligible…" / "Analysis was rate-limited…") | TAB:241-243, TAB:769-780 | `recentEvents` | keep. **Second `events[0]` consumer** (Key finding 3) | Same | none |
| C16. Adjacent consumer of the same wire event: back-office activity feed | `libs/frontend/core/src/lib/services/back-office-activity.service.ts:111`, `:177`, `:453-465` | `SKILL_SYNTHESIS_EVENT` | keep, untouched (an additive `id` on the wire is compatible) | Same | (outside this surface) |
| C17. Memory curator has its own event feed of the same shape | `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts` | memory diagnostics | keep, untouched (not in scope; flag for a parity follow-up) | Same | n/a |

## D. Activity tab and Skills header: other content (untouched, listed for parity)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| D1. Weekly digest panel | TAB:482-485, TAB:931 | `refreshDigest({ allowRewrite: false })` | keep | Same | `skill-synthesis-tab.component.spec.ts:401` |
| D2. Orchestration specs card (refresh, harvest, clear stale, table) | TAB:488-572, TAB:940-957 | `SkillSynthesisStateService` specs RPCs | keep | Same | none in the tab spec (state-service specs only) |
| D3. Header stats strip (Candidates / Promoted / Rejected / Active skills / Invocations), visible on every sub-view | TAB:153; `skill-stats-strip.component.ts` | `skillSynthesis:stats` (HND:504-523) | keep (absorbs B6) | Same | none dedicated |
| D4. Live activity spinner label (curator pass / backfill) | TAB:128-138, TAB:734 | `SKILL_SYNTHESIS_EVENT` via `SkillSynthesisLiveService` | keep | Same | `skill-synthesis-live.service.spec.ts:95-132` |

## E. Settings destination (for the trigger move)

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| E1. Settings sub-view: Core / Eligibility & quality / Judging / Pinning & curation / Background models (lanes → Providers) / Background work, one Save | TAB:582-602; `skill-settings-panel.component.ts:20`, `:75`, `:133`, `:159`, `:212-221`, `:406-421` | `skillSynthesis:getSettings` / `skillSynthesis:updateSettings` (TAB:959-985) | keep (receives the Triggers section, B8) | Same | `skill-settings-panel.component.spec.ts`; `skill-synthesis-tab.component.spec.ts:685`, `:874` |
| E2. `skillSynthesis:getTriggers` client exists but no frontend code calls it | DRPC:61-71; HND:850-870 | `skillSynthesis:getTriggers` | keep (available if Settings must load triggers without the diagnostics snapshot) | Same | `skills-synthesis-rpc.handlers.spec.ts:590` |

## F. Thoth shell tiles

| Capability | Where today (file:line) | Backing RPC/API | Decision | New location | Test |
| --- | --- | --- | --- | --- | --- |
| F1. One tile per pillar (memory, skills, cron, gateway): icon, label, active styling, `aria-selected`, `aria-controls` | SHELL:94-170, SHELL:239-249 | `TSS.pillars` (TSS:223-225) | keep | Same | `thoth-shell.component.spec.ts:195`, `:217` |
| F2. Tile value + unit + desc + accent colour; unavailable state shows `—` and desc | SHELL:131-168; TSS:419-541 | per pillar below | keep | Same | `thoth-status-pillars.spec.ts:27-127` |
| F3. Gateway platform badges (running / enabled / error / disabled), title = lastError | SHELL:145-157, SHELL:219-231; TSS:360-392 | `gateway:status` + `listBindings({ status: 'pending' })` (TSS:340-358) | keep | Same | `thoth-status.service.spec.ts:228`; `thoth-status-pillars.spec.ts:73-117` |
| F4. Gateway live update from the `GATEWAY_STATUS_CHANGED` message | TSS:172-174, TSS:268-279 | webview message | keep | Same | `thoth-status.service.spec.ts:270-397` |
| F5. Initial load **once**: the shell calls `refreshIfNeeded()` on init, a no-op after the first load | SHELL:214-216; TSS:262-266 | all four loaders | keep (add a refresh on tab switch) | Same | `thoth-status.service.spec.ts:208` (asserts the once-only behaviour; it will need revising) |
| F6. Refresh on workspace switch (effect; skips the first emission and same-root re-emits) | TSS:162-170 | all four loaders | keep (**already exists**; acceptance asks for a combined tab-switch-then-workspace-switch spec) | Same | `thoth-status.service.spec.ts:445`, `:465` |
| F7. Tab switch persisted via `AppStateManager.setThothActiveTab` | SHELL:263-269 | app state | keep (the tile-refresh hook belongs on this path) | Same | `thoth-shell.component.spec.ts:217` |
| F8. Memory tile: total facts and "N queued for curation", scoped to the workspace root | TSS:281-298, TSS:445-467 | `memory:stats(workspaceRoot)` | keep | Same | `thoth-status.service.spec.ts:429`, `:438` |
| F9. Skills tile: pending candidate count | TSS:300-314, TSS:469-491 | `skillSynthesis:listCandidates({ status: 'candidate' })`. No `scope` is passed, so the backend default `'workspace'` uses the backend's own root (HND:2170-2175); NULL-origin rows are included (`skill-candidate.store.ts:399`); the result is capped at 100 (HND:408) | keep (pass the current workspace explicitly; decide on unrecorded-project rows and the 100 cap; Key finding 4) | Same | `thoth-status.service.spec.ts:83`, `:172`; `thoth-status-pillars.spec.ts:53` |
| F10. Cron tile: job count and next run, scoped to the workspace | TSS:316-338, TSS:493-515 | `cron:list({ workspaceRoot })` | keep | Same | `thoth-status.service.spec.ts:83` |
| F11. Desktop-only placeholders outside Electron, and per-pillar error isolation | TSS:236-260, TSS:394-414 | n/a | keep | Same | `thoth-status.service.spec.ts:178`, `:481`; `thoth-shell.component.spec.ts:234`, `:260`, `:293`; `thoth-status-pillars.spec.ts:127` |

## Proposed Removals

These need the user's approval. Nothing from the surviving summary (`ptah-skill-pipeline-status`) is proposed for removal.

1. **The `ptah-skill-diagnostics-accordion` component as a unit** (B1: TAB:486 and the whole ACC file). Every capability inside it is dispositioned in B2-B14:
   - six move to Activity: last-run time, last curator pass, sessions-today total, histogram bars, the event feed, Analyze current session, error text and the 30-second poll;
   - the triggers move to Settings;
   - the remaining three are items 2-4 below.
2. **"Candidates by status" panel** (B6: ACC:66-94). It is redundant with `ptah-skill-stats-strip` (TAB:153), which shows the same three numbers, plus Active skills and Invocations, from the same `store.getStats()` (HND:510 versus HND:700). The only behavioural difference is freshness: the strip refreshes on live events and user actions, not on the 30-second poll.
3. **"View logs" button** (B11: ACC:198-204, ACC:311-313). It opens no logs and only re-fetches diagnostics. Either remove it or replace it with a correctly labelled "Refresh".
4. **The accordion's own `refresh()` on mount** (B14: ACC:236). It duplicates TAB:929. It is an internal call whose only effect is an extra RPC.

## Root cause re-verification

| Item | context.md cites | This branch (verified) | Status |
| --- | --- | --- | --- |
| 1a. Backend returns the newest window oldest-first | `skill-synthesis.service.ts:1052-1055` | `skill-synthesis.service.ts:1037-1040` (`return this.events.slice(-safe)` at :1039) | Confirmed; the lines moved by -15 |
| 1b. Live events append at the tail | `skill-diagnostics-state.service.ts:163` | `skill-diagnostics-state.service.ts:163-164` (`[...list, event].slice(-50)`) | Confirmed |
| 1c. Feed renders `slice(0, limit)` | `event-feed.component.ts:54-64` | `event-feed.component.ts:54-65` (slice at :58; default limit 10 at :52) | Confirmed |
| 1d. Status card treats `events[0]` as latest | `skill-pipeline-status.component.ts:316-328` | `skill-pipeline-status.component.ts:316-329` (`events[0]` at :321) | Confirmed. **Additional uncited site:** `skill-synthesis-tab.component.ts:769-780` (`ineligibleHint`, `events[0]` at :772) |
| 2. Unstable row identity | (no line) | `event-feed.component.ts:26`. No id exists anywhere on the path: `diagnostics.types.ts:20-28`, `rpc-curator-diagnostics.types.ts:50-56`, `skill-synthesis.service.ts:1019-1046`, `skills-synthesis-rpc.handlers.ts:714-720` | Confirmed |
| 3. Repeated rows are real events | (no line) | `skill-synthesis.service.ts:916-923` pushes `analyze-run` per registered or reused candidate; drain dispatch per queue row at `queue/stage-handlers.service.ts:272`; no grouping in `event-feed.component.ts` | Confirmed. The "96 ticks/day" figure, which follows from the `*/15 * * * *` default (TAB:811), was not re-measured |
| 4. Overlapping summaries | `skill-synthesis-tab.component.ts:476-490` | `skill-synthesis-tab.component.ts:474-486` (pipeline status :474-481, digest :482-485, accordion :486) | Confirmed; the lines moved by -2. Overlap: "Last analysis" (PSC:127 / ACC:35) and the accepted counts (PSC:143-146 / ACC:58-63). Only in the accordion: histogram bars, the feed, last curator pass, the triggers, Analyze-now |
| 6a. Shell tiles load once and freeze | `thoth-shell.component.ts:214-216`, `thoth-status.service.ts:263-266` | `thoth-shell.component.ts:214-216`, `thoth-status.service.ts:262-266` | Confirmed, with a **correction**: tiles already refresh on a workspace-root change (`thoth-status.service.ts:162-170`); they freeze only across tab switches within one workspace |
| 6b. Skills tile counts all workspaces | (no line) | `thoth-status.service.ts:302-304` passes no `scope`; the backend defaults to `'workspace'` (`skills-synthesis-rpc.handlers.ts:2170-2175`, commit `1b1bcbe82`) | **Partly stale.** Remaining defects: no explicit workspace (the backend's root, not the webview's); unrecorded-project candidates counted (`skill-candidate.store.ts:399`); cap at 100 (`skills-synthesis-rpc.handlers.ts:408`) |

## Constraint check (forbidden areas)

- `libs/frontend/chat-state`: **not** needed. DSS imports `TabManagerService` (DSS:3, DSS:40) for Analyze-now (B10). Moving that button keeps the same consumer, and chat-state does not change.
- `libs/frontend/chat`, `libs/backend/agent-sdk`, `libs/backend/cli-agent-runtime`, the sessions sidebar, and the persistence-sqlite migrations index: none of them is on any path above. The event ring is in-memory (SSS:191), so no migration is needed.
- `libs/backend/rpc-handlers`: the fix touches `skills-synthesis-rpc.handlers.ts`:
  - the event-id mapping (HND:714-720);
  - possibly the list scope and limit (HND:408, HND:2170-2175).

  That file is the skill-synthesis handler, not a session or chat handler, so it is allowed. It is flagged because it lives in rpc-handlers.
- `libs/shared`: `rpc-curator-diagnostics.types.ts:50-56` needs an `id` added to `SkillSynthesisEventWire`.
