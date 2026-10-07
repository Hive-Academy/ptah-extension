# B-P: memory and skills pause switches — inventory and implementation plan (TASK_2026_620_a13e)

Status: plan only. No production code changed. All `file:line` references are against the
worktree `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`, branch
`feat/task-620-memory-skills-bench`. "Verified" means the line was opened while writing this plan.
"Assumption" names the check the implementer must run.

User intent (verbatim): "Include these switches in our batch and make sure they are visible in our
settings page or memory/skills Thoth settings ... make sure they work, stop ALL memory and skills
related work, and are pausable and playable (pause/resume) without any issues."

## Inputs and constraints

- Read: `context.md`, `batches.md` (format and phase layout only), the three inventory sweeps
  (memory jobs, skills jobs, settings UI + RPC) and direct reads of every file cited below.
- All `CLAUDE.md` files were deleted in `7917b193a` (context.md "Corrections"); repository patterns
  below are derived from source.
- Host facts that shape the design:
  - VS Code is Thoth-free by lint-enforced invariant (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:87-88`);
    the Memory and Skills Thoth tabs are `electronOnly: true` (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:240-241`).
    Memory and skills background work runs only in **Electron** (`bootThothRuntime` from
    `apps/ptah-electron/src/activation/boot-heavy-services.ts:164`, `startThothCron` at `:422`) and the **CLI**
    (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:93` `activateThoth`).
  - Both master keys are already file-routed: `memory.enabled` (`libs/backend/platform-core/src/file-settings-keys.ts:369`, default `:658`)
    and `skillSynthesis.enabled` (`:255`, default `:571`). So a write from any host lands in
    `~/.ptah/settings.json` and is visible to every other host.
- Adding an RPC method name changes `BASELINE_RPC_METHOD_NAMES` (`libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts:1-5`,
  "Any change to this baseline requires a Gate 2 exception in TASK_2026_610"). The plan therefore adds **no new RPC method**.

### Settings change-notification mechanics (Verified)

| Mechanism | Where | Fires on | Does NOT fire on |
|---|---|---|---|
| `IWorkspaceProvider.getConfiguration` (port) | `libs/backend/platform-core/src/interfaces/workspace-provider.interface.ts` | read, always current: file keys read the in-memory cache of `PtahFileSettingsManager`, refreshed by its cross-process `fs.watch` (`file-settings-manager.ts:188-210`, listeners fired at `:500`) | — |
| `IWorkspaceProvider.onDidChangeConfiguration` (port, `workspace-provider.interface.ts:57`) | fired by `setConfiguration` for file keys on VS Code (`vscode-workspace-provider.ts:97-108`), Electron (`electron-workspace-provider.ts:217-226`), CLI (`cli-workspace-provider.ts:109-118`) | every **in-process** write: RPC handlers, Electron tray (`tray.service.ts:259-263` uses `setConfiguration`), `ptah config set` (`apps/ptah-cli/src/cli/commands/config.ts:257`) | a write made by **another process** (e.g. `ptah config set` while Electron runs): only the per-key `PtahFileSettingsManager.watch` listeners fire, and `fileSettings` is not on the port |
| `ISettingsStore.watchGlobal` (settings-core, `ports/settings-store.interface.ts:31`) | `ReactiveSettingsStore` (`reactive/reactive-settings-store.ts:60-67`) | writes through that store only | writes via `setConfiguration`, cross-process writes. **No backend consumer exists** outside settings-core and the platform adapters |

Consequence: the repository's established pattern is **re-read the key with `getConfiguration` at each
unit of work** (drain gate 1 `skill-drain.service.ts:781-784`, backlog cleanup
`skill-backlog-cleanup.service.ts:136`, retention `memory-retention.service.ts:190`, trigger handlers
`memory-trigger.service.ts:276/397/424/466/482/550`). The plan keeps that as the authoritative gate
and adds `onDidChangeConfiguration` only for *cleanup and re-arming*, never as the only gate.

---

## 1. Inventory — every background job and path

Legend. Gate read: **live** = re-read on each run/event; **boot** = read once at `start()`/boot.
"On pause today" = what happens to running/armed work when the switch flips off today.
**GAP** = runs (or loses data) while paused.

### 1a. Memory trajectory

| # | Job / path | Start / body (file:line) | Gate(s) today | Gate read | On pause today | Status |
|---|---|---|---|---|---|---|
| M1 | PostToolUse observation capture → `observation_queue` | `memory-trigger.service.ts:546-550` | `memory.enabled` + `memory.triggers.postToolUse.enabled` | live | stops at next event | OK |
| M2 | UserPromptSubmit cue → curate | `memory-trigger.service.ts:481-482` | `memory.enabled` + `userPromptSubmit.enabled` | live | stops | OK |
| M3 | Stop hook (turn complete) → episode / curate | `memory-trigger.service.ts:396-397` | `memory.enabled` (+ `turnComplete.enabled`, host-local key, see M19) | live | stops | OK |
| M4 | ToolFailure capture | `memory-trigger.service.ts:423-424` | `memory.enabled` | live | stops | OK |
| M5 | SessionEnd hook → final episode curate | `memory-trigger.service.ts:451-476` (gate `:466`) | `memory.enabled` + `sessionEnd.enabled` | live | stops; teardown still runs (correct) | OK |
| M6 | Per-session idle timer → `fireIdle` → `tryEpisodeCurate` | arm `memory-trigger.service.ts:275-303`; fire `:661-672` | arm: `memory.enabled`; **fire: none** | arm live / fire ungated | a timer armed before pause curates up to `memory.triggers.idleMs` (600 s) after pause | **GAP** |
| M7 | Boot scan of unscanned transcripts → `curator.curate` per session | arm `memory-trigger.service.ts:215-219`; body `:915-1000` | `memory.enabled` && `memory.triggers.bootScan` | **boot only** | an armed/running scan keeps curating after pause; after a resume it never re-arms until the next app start | **GAP** |
| M8 | In-flight curate (LLM call) | `memory-trigger.service.ts:820-870` → `MemoryCuratorService.curate` | none during the call | — | finishes; observations marked processed | acceptable (see 3.4) |
| M9 | PreCompact curation (`MemoryCuratorService` subscriber) | `memory-curator.service.ts:250-321` | per-workspace `indexing_state.memory_enabled` at boot (`boot-thoth-runtime.ts:232-264`, CLI `thoth-runtime.ts:235-248`); live stop via `indexing-control.service.ts:416-422` | boot + per-workspace toggle | **not gated by `memory.enabled` at all**; the per-workspace toggle's `stop()` is process-wide | **GAP** |
| M10 | Trigger service start when workspace memory is off (Electron) | `boot-thoth-runtime.ts:275-287` (condition `refs.memoryCurator !== null`, set before the un-awaited status lookup `:244-258`) | none | boot | Electron starts M1-M7 even when `memory_enabled = 0`; CLI does not (`cli thoth-runtime.ts:246-249`) | **GAP** (host inconsistency) |
| M11 | Retention cron `@ptah/memory-retention`, `17 * * * *` (purge processed, quarantine stuck, vacuum) | register `start-thoth-cron.ts:270-300`; handler `memory-retention-job.ts`; body `memory-retention.service.ts:190…` | `memory.retention.enabled` | live | **runs while `memory.enabled = false`** (deletes rows) | **GAP** |
| M12 | Lifecycle archive / delete / evict (inside the retention run) | `memory-lifecycle.service.ts`; config `memory-lifecycle-config.ts:44-47` | `memory.lifecycle.enabled` | live | runs while memory paused | **GAP** |
| M13 | Memory indexing run (embeddings of memory chunks, user-started or stale rebuild) | `indexing-control.service.ts:304` | per-workspace `memory_enabled` (or `force`) | live | not gated by `memory.enabled` | **GAP** |
| M14 | `memory:runNow` (manual curate) | `memory-rpc.handlers.ts:627` | none | — | runs | decision (3.6) |
| M15 | Session-start memory injection into the system prompt | `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:181-187` | `memory.triggers.sessionStart.injectionEnabled` (host-local key) | live | — (read side) | kept separate (3.3) |
| M16 | Code-symbol injection | `agent-sdk/src/lib/helpers/code-symbol-prompt-injector.ts:26` | `memory.symbolInjectionEnabled` | live | — (read side) | kept separate |
| M17 | `ptah_memory_search` / `memory:search` | `memory-rpc.handlers.ts:236` | none | — | read side, owned by TASK_2026_619 | kept separate |
| M18 | DB integrity check and daily backup cron | `start-thoth-cron.ts:165-253`, `:456-467` | `cron.enabled` | live | shared SQLite maintenance, not memory work | out of scope (preserve) |
| M19 | Trigger keys absent from `FILE_BASED_SETTINGS_KEYS`: `memory.triggers.turnComplete.enabled`, `episode.enabled`, `sessionEnd.enabled`, `maxObservationsPerCurate`, `bootScanDelayMs`, `bootScanIdleBackoffMs`, `sessionStart.*` (`memory-trigger-config.ts:30-56`; grep count 0 in `file-settings-keys.ts`) | — | — | — | writes go to the host-local `config.json` (Electron `electron-workspace-provider.ts:229-232`, CLI `cli-workspace-provider.ts:120-123`), not `~/.ptah/settings.json`; invisible to other hosts and to cross-process watch (`file-settings-keys.ts:363-368` documents the failure class) | **GAP** (not a pause path; see Open question 4) |
| M20 | Dead/inert keys: `memory.curatorEnabled` (no reader outside its declaration `file-settings-keys.ts:248,564`); `memory.triggers.preCompact` (read only into the DTO, `memory-trigger-config.ts:175-180`, gates nothing) | — | — | — | toggling does nothing | Proposed Removals |

### 1b. Skills trajectory

| # | Job / path | Start / body (file:line) | Gate(s) today | Gate read | On pause today | Status |
|---|---|---|---|---|---|---|
| S1 | Session-end → `enqueueAnalyze` | subscribe `skill-synthesis.service.ts:412-423`; gate `:530-531` | `skillSynthesis.enabled` | live in body, but subscription happens **only if enabled at boot** (`:345-350` early return) | a host booted paused never subscribes; resume leaves session-end capture dead until restart | **GAP** |
| S2 | Skill trigger hooks (activity idle, Stop, PostToolUse, SubagentStop, prompt expansion) → `enqueueAnalyze` | `skill-trigger.service.ts:148-181`, `:765-778` | `skillSynthesis.enabled` inside `SkillSynthesisService.enqueueAnalyze` (`:529-531`); returns `null` when `!started` | live | while booted-paused the service is never `started`, so every enqueue after resume is a silent no-op | **GAP** (same root as S1) |
| S3 | Skill boot scan → enqueue `source:'boot'` rows | arm `skill-trigger.service.ts:182-186`; callback `:866-870` | `skillSynthesis.triggers.bootScan` only | boot | the callback returns `'ran'` even when `enqueueAnalyze` refused (paused), so the scan **watermark advances past sessions that were never queued** | **GAP (data loss)** |
| S4 | Spec harvest on turn complete | `skill-trigger.service.ts:421-433` | none (not `skillSynthesis.enabled`) | — | keeps writing while paused | **GAP** |
| S5 | Skill/agent invocation telemetry | `skill-trigger.service.ts:436-450`, `:615`, `:625-690` | telemetry flag only | live | keeps recording | **kept on deliberately** (3.3) |
| S6 | Drain cron ×3: `@ptah/skills-drain-frequent` `*/15`, `-nightly` `0 3 * * *`, `-weekly` `0 4 * * 0` | specs `thoth-runtime/src/lib/skill-drain-jobs.ts`; register `start-thoth-cron.ts:56-120`; body `skill-drain.service.ts:758-856` | gate 1 `skillSynthesis.enabled` (`:784`) | live **per tick only**; the item loop `:821-836` re-checks only `signal.aborted` | a nightly (40 items) or weekly (400 items) tick that started before pause keeps running every item | **GAP** |
| S7 | Drain stages `prefilter`, `embedding`, `archaeology`, `judge-panel`, `replay`, `trigger-eval` | registered `stage-handlers.service.ts:216-245` (above the early return, `skill-synthesis.service.ts:337`) | inherit S6 | — | `prefilter` calls `analyzeSession`, which returns `null` when `!started` (`skill-synthesis.service.ts:698-700`); the stage then returns `{outcome:'skipped'}` (`stage-handlers.service.ts:272-283`) — **terminal**. Every prefilter row drained after a resume of a booted-paused host is lost | **GAP (data loss)** |
| S8 | Embedding backfill enqueue | `skill-synthesis.service.ts:436-443` | inside `start()` | boot | — | OK (re-runs through deferred start) |
| S9 | Skill curator interval (retirement, umbrella merge, enhancement → repropagation) | `skill-curator.service.ts:217-243`; pass `:268-276` | `skillSynthesis.curatorEnabled` at `start()` only; tick uses the **settings snapshot** taken at start | boot | never checks `skillSynthesis.enabled`; a pass fires every `curatorIntervalHours` while paused; after a settings change it uses stale values | **GAP** |
| S10 | Curator reconciliation (data repair) | `skill-curator.service.ts:225`, `:505` | none ("runs even with the curator disabled") | at `start()` | runs once per start | OK (by design; preserve) |
| S11 | Backlog cleanup cron `@ptah/skills-backlog-cleanup`, `41 * * * *` | `thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`; gate `skill-backlog-cleanup.service.ts:136`, `:584` | `skillSynthesis.enabled` | live | skips | OK |
| S12 | Manual RPCs `skillSynthesis:runCurator` (`skills-synthesis-rpc.handlers.ts:732`), `analyzeNow` (`:834`), `enhanceNow` | — | none | — | run | decision (3.6) |
| S13 | Curator restart in `skillSynthesis:updateSettings` | `skills-synthesis-rpc.handlers.ts:651-674` | — | — | `curator.start(newSettings)` is called **without** the `onPassComplete`/`onEvent` options that `SkillSynthesisService.start` passes (`skill-synthesis.service.ts:426-429`), so after any curator setting change, passes stop being recorded and stop emitting activity events | bug found (fixed by 3.4 design) |
| S14 | Electron tray "Pause background learning" | `apps/ptah-electron/src/services/tray/tray.service.ts:118-131`, read `:221-228`, write `:259-276`; built only when `skillSynthesis.trayKeepalive === true` (`apps/ptah-electron/src/main.ts:320-340`) | writes `skillSynthesis.enabled` only | menu state read at build and after its own click | no refresh when the key changes elsewhere; memory not covered | **GAP** |
| S15 | Skill exposure to agents (promoted skills as files under `~/.ptah/skills`, mirrored into the workspace harness) | `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:107-135`, `:271-272` | — | — | read side | kept separate |
| S16 | Inert key `skillSynthesis.triggers.sessionEnd` (read into DTO `skill-trigger-config.ts:95-101`, round-tripped to the UI `skills-synthesis-rpc.handlers.ts:803`, gates nothing) | — | — | — | toggling does nothing | Proposed Removals |

Totals: **36 rows** (20 memory, 16 skills); **14 behavioural gaps** that run or lose data while
paused (M6, M7, M9, M10, M11, M12, M13, S1, S2, S3, S4, S6, S7, S9), plus one bug (S13),
three inert keys (M20 ×2, S16), the host-local key routing defect (M19), and the control-surface gaps in section 2.

---

## 2. Existing UI and control surfaces

| Surface | Location (Verified) | What it controls | How it reaches the backend |
|---|---|---|---|
| Thoth shell (Memory / Skills / Schedules / Messaging tabs, all Electron-only) | `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:31, 240-247` | tab host | — |
| Thoth **Skills** tab → settings panel, "Enabled" **checkbox** inside a Save-button reactive form | `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts:21-28` (checkbox), `:385-393` (Save); mounted at `skill-synthesis-tab.component.ts:590` | `skillSynthesis.enabled` + all skill settings; nothing applies until Save | `SkillSynthesisRpcService.updateSettings` (`skill-synthesis-rpc.service.ts:265-269`) → `'skillSynthesis:updateSettings'` (`libs/shared/src/lib/types/rpc.types.ts:1952`) → `skills-synthesis-rpc.handlers.ts:640-674` → `setConfiguration('ptah','skillSynthesis.<key>')`; schema already has `enabled` (`skills-synthesis-rpc.schema.ts:75`) |
| Thoth **Memory** tab → "Chat memory extraction" DaisyUI toggle | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html:355-365`, mounted at `memory-curator-tab.component.ts:207` | per-workspace `indexing_state.memory_enabled` (PreCompact only, M9) | indexing RPC (`indexing-rpc.handlers.ts:246-266`) → `IndexingControlService.setPipelineEnabled` (`indexing-control.service.ts:401-423`) |
| Thoth Memory tab → diagnostics accordion, per-trigger checkboxes | `memory-diagnostics-accordion.component.ts:53-92` using `memory-trigger-toggle.component.ts:15-75` | `memory.triggers.*` | `MemoryDiagnosticsStateService.setTriggers` (`memory-diagnostics-state.service.ts:101-106`) → `'memory:setTriggers'` (`rpc.types.ts:1860`; params `rpc-curator-diagnostics.types.ts:229-231`; schema `memory-rpc.schema.ts:93-95`) → `memory-rpc.handlers.ts:720-757` |
| **`memory.enabled` master switch** | — | — | **No UI anywhere.** Deliberately absent from `MemoryTriggersDto` (`memory-trigger-config.ts:8-17`) |
| Electron tray | `tray.service.ts` (S14) | `skillSynthesis.enabled` only, only with `trayKeepalive` | direct `setConfiguration` (fires `onDidChangeConfiguration`) |
| Main Settings page | `libs/frontend/chat/src/lib/settings/settings.component.ts`; deep-link via `AppStateManager.requestSettingsTab` | no memory/skills master switch; Skills panel deep-links to `providers` (`skill-settings-panel.component.ts:419-423`) | — |
| Push of settings changes to the webview | push constants `libs/shared/src/lib/types/messages/message-constants.ts:245,255` (`memory:corpusChanged`, `skillSynthesis:event`) | **no settings-changed push exists** | a tray or CLI write is invisible to an open Thoth tab until it re-fetches |

Angular conventions observed (Verified): standalone + `ChangeDetectionStrategy.OnPush` + signal
`input()`/`output()` (`memory-trigger-toggle.component.ts:15-17, 54-61`); DaisyUI immediate-apply
switch markup `class="toggle toggle-xs toggle-primary"` (`workspace-indexing.component.html:358`).

---

## 3. Design

### 3.1 Switch model (recommended)

Two user-facing master switches, **reusing the two existing file-routed keys**, no new keys:

| Switch (UI label) | Key | Pauses | Does not pause |
|---|---|---|---|
| **Memory — background learning** | `memory.enabled` | M1-M7, M9, M11, M12, M13 (capture, triggers, idle/boot curation, PreCompact curation, retention, lifecycle, memory indexing) | read side M15-M17; DB maintenance M18 |
| **Skills — background learning** | `skillSynthesis.enabled` | S1-S4, S6-S9 (session-end/trigger enqueue, boot scan, spec harvest, drain and every stage, curator interval) | invocation telemetry S5; reconciliation-at-start S10; skill files on disk S15 |

Rationale: both keys already exist, are already file-routed (so every host sees one truth), already
gate the bulk of the work live, and `skillSynthesis.enabled` is already documented as "the single
master switch" with "deliberately NO pause/queueEnabled key" (`file-settings-keys.ts:286-292`). A
third "pause" key would be a second way to mean "off". The fine-grained keys
(`memory.retention.enabled`, `memory.lifecycle.enabled`, `memory.triggers.*`,
`skillSynthesis.curatorEnabled`, `skillSynthesis.triggers.*`, `judgeEnabled`, …) stay as
**sub-switches under** the master: effective = master AND sub-switch. Resume never flips a
sub-switch.

Rejected: (a) a new `thoth.paused` umbrella key — adds a third state source and a migration for the
tray; (b) making the per-workspace `memory_enabled` column the memory master — it is workspace-scoped,
DB-resident (not visible to a second process without SQLite), and today only gates PreCompact.

### 3.2 Per-workspace `memory_enabled` — keep, unchanged semantics in B-P

It stays as the per-workspace "Chat memory extraction" toggle (preserve). B-P fixes only M10 (Electron
starting the trigger service for a workspace whose row is off, mirroring the CLI). Its process-wide
`stop()` (`indexing-control.service.ts:416-422`) is recorded as a known issue — see Open question 3.

### 3.3 Read-side injection — kept separate (recommended)

Not paused by either master switch: session-start memory injection (M15), symbol injection (M16),
`ptah_memory_search` (M17), skill files exposed to agents (S15), and **skill invocation telemetry
(S5)**. Why:
- The request is to stop background *work*; injection is a cheap read on the user's own turn, already
  has its own switches, and turning it off silently degrades agent answers.
- `ptah_memory_search` belongs to TASK_2026_619 (context.md boundary).
- Telemetry must keep running: retirement retires skills "unused" for `dormantAfterDays`
  (`file-settings-keys.ts:592-593`). Pausing usage recording while the user keeps using skills would
  make them look unused and get them retired after resume — a pause that causes data loss.

The UI copy under each switch states this ("Pausing stops capture and background processing. Saved
memories/skills are still used in chats."). If the user wants a "full off", that is Open question 1.

### 3.4 Pause / resume semantics

**Authoritative gate = live re-read at every unit-of-work boundary** (existing pattern). Event
subscription is used only to release timers and to re-arm work, so a missed event (cross-process
write) can delay a *resume* but can never let work run while paused.

| Rule | Mechanism |
|---|---|
| No new work starts while paused | every entry point in section 1 re-reads its master key before starting a unit (event handler, timer fire, boot-scan session, drain item, curator tick, retention run, indexing run) |
| In-flight work: **finish the current unit, start no further unit** | a running LLM call (curate, drain stage, curator pass step) completes and records its result; the loop checks the key before the next unit. Rejected "abort": an aborted drain claim is only reclaimed by the stale reaper after `staleClaimTtlMs` = 15 min (`file-settings-keys.ts:621`), already-spent tokens are wasted, and a half-written candidate would need rollback code that does not exist. Units are bounded (curate transcript tail, `enhanceTimeoutMs`, per-item drain), so "finish" ends within one unit |
| Timers / scans stop | on the pause event: memory idle timers cleared, boot-scan scheduler cancelled with its `AbortController`; skill curator interval tick becomes a no-op while paused. Where no event arrives (cross-process), the timer fires and the live gate turns it into a no-op |
| Boot scans never advance their watermark while paused | memory and skills boot-scan callbacks return `'stalled'` when the master is off (BootScanRunner leaves the watermark below that session, as documented at `memory-trigger.service.ts:942-948`) |
| Queue rows are never lost | a `prefilter` row drained while synthesis is not started returns `unscored` with a retry, not terminal `skipped`; drain rows left unclaimed by a mid-tick pause stay `queued` (no state change) |
| Resume restarts without app restart | `SkillSynthesisService` gains an idempotent deferred start: a host booted paused completes `start()` (DB check, session-end subscription, curator, embedding backfill) the first time it observes `enabled === true` — on the change event **or** lazily from `enqueueAnalyze`/`analyzeSession`/the prefilter stage (covers cross-process resume). `MemoryTriggerService` re-arms its boot scan on the resume event if not already armed. Drain and retention resume on their next cron tick (≤ 15 min / ≤ 60 min); the backlog that accumulated stays queued and drains under the existing tier caps |
| No double scheduling | every re-arm is guarded by the existing handle (`bootScanScheduler === null`, `intervalHandle === null`, `started` flag, `HandlerRegistry.has`). The curator interval is **not** stopped/started on pause — it stays scheduled and its tick is gated — so pause/resume cannot create a second interval. Change listeners are registered in `start()` and disposed in `stop()` |
| Settings snapshot | the curator tick re-reads settings via `SkillSynthesisService.readSettings()` instead of the start-time snapshot (fixes stale values and S13 without restarting the curator) |
| All hosts, hexagonal | only `IWorkspaceProvider.getConfiguration` / `onDidChangeConfiguration` (platform-core port) are used. No new `vscode-core` import in agnostic libs (memory-curator already imports `TOKENS/Logger/WebviewManager`, `indexing-control.service.ts:6,14`; that is not extended). VS Code runs no Thoth work, so the switches are inert there by construction |

Rejected for the live reaction: adding a `watchSetting(key)` method to `IWorkspaceProvider` so
cross-process writes also fire — it changes a port implemented by three adapters plus test doubles
for a case (two Ptah processes, the second one toggling) that the lazy deferred start and per-unit
gates already make safe; only the re-arm latency differs.

### 3.5 Dead key and tray decisions

- `memory.curatorEnabled`: **delete** (key `file-settings-keys.ts:248` and default `:564`). No reader;
  wiring it would create a third memory "off" switch that duplicates `memory.enabled`. Needs approval
  → Proposed Removals. Until approved, B-P leaves it untouched.
- `memory.triggers.preCompact` and `skillSynthesis.triggers.sessionEnd`: inert today. Not part of the
  pause path; listed under Proposed Removals with the alternative (wire them) as Open question 2.
- Tray: **cover both**. Replace the single item with two checkbox items, "Pause memory learning" and
  "Pause skills learning", each 1:1 with a master key (no mixed state to render). The menu refreshes on
  `onDidChangeConfiguration` for either key, and the listener is disposed with the tray. The tray still
  exists only with `skillSynthesis.trayKeepalive` (preserve; out of scope to change).

### 3.6 Manual actions while paused

`memory:runNow`, `skillSynthesis:runCurator`, `skillSynthesis:analyzeNow`, `skillSynthesis:enhanceNow`:
recommended **refuse with `RpcUserError(…, 'PAUSED')`** and disable the buttons with a tooltip while
paused, because the request says "stop ALL". This is Open question 5 because it removes a capability
the user may rely on (e.g. a deliberate one-off run while background learning is off).

### 3.7 UI

- Each master switch is an **immediate-apply** DaisyUI toggle at the top of its Thoth tab (above the
  tab content, not inside any form), labelled "Background learning" with an "On / Paused" state text,
  a one-line explanation (3.3) and, when paused, a `badge badge-warning` "Paused" on the Thoth tab rail
  item. Optimistic update with rollback on RPC failure; the toggle is disabled while the request is in
  flight.
- Skills: the "Enabled" checkbox is **moved out** of the Save form (`skill-settings-panel.component.ts:21-28`)
  into the new header switch, so one key has one control; the Save form stops sending `enabled`.
- Memory: the new switch reads/writes `memory.enabled` via the existing `memory:getTriggers` /
  `memory:setTriggers` methods extended with an optional top-level `enabled` field (no new RPC name,
  no baseline change). `MemoryTriggersDto` is not touched (keeps the documented separation).
- Freshness without a push channel: both tabs re-fetch the switch state on tab activation and on
  window `focus`/`visibilitychange`; that covers tray and CLI writes. A settings push message is
  rejected for B-P (new message type and three host emitters for one boolean).

---

## 4. File-level plan (file-disjoint sub-batches)

Contract first: P3 defines the RPC field that P4 consumes. P1, P2, P3, P5 are file-disjoint and can
run in parallel; P4 starts after P3's shared type lands.

### P1 — Memory backend gates (backend-developer sub-agent)
Lib: `libs/backend/memory-curator`.
- MODIFY `src/lib/triggers/memory-trigger.service.ts`: gate `fireIdle` on `readMemoryEnabled()`;
  boot-scan per-session callback returns `'stalled'` when paused; in `start()` subscribe to
  `this.workspace.onDidChangeConfiguration` for `ptah.memory.enabled` — on pause clear idle timers and
  cancel/abort the boot scan; on resume arm the boot scan if `readBootScanFlag()` and not armed;
  dispose the subscription in `stop()`.
- MODIFY `src/lib/memory-curator.service.ts`: PreCompact handler (`:252`) returns early when
  `memory.enabled` is false (live read through the injected workspace provider — Assumption: confirm
  the class already injects `IWorkspaceProvider`; if not, add `@inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)`,
  the same token `indexing-control.service.ts:7` uses).
- MODIFY `src/lib/retention/memory-retention.service.ts` (+ `memory-retention-config.ts` if the read
  lives there): first gate `memory.enabled === false` → `skip('memory-paused')`, before
  `memory.retention.enabled` (`:190`). Lifecycle inherits it (runs inside the same run).
- MODIFY `src/lib/control/indexing-control.service.ts`: memory pipeline run (`:304`) skipped unless
  `force` when `memory.enabled` is false; symbols pipeline untouched.
- Specs: `memory-trigger.service.spec.ts` (or a new `memory-trigger.pause.spec.ts`),
  `memory-retention.service.spec.ts`, `indexing-control.service.spec.ts`, curator PreCompact spec.

### P2 — Skills backend gates (backend-developer sub-agent)
Lib: `libs/backend/skill-synthesis`.
- MODIFY `src/lib/skill-synthesis.service.ts`: split `start()` into boot entry + idempotent
  `ensureStarted()`; when booted paused, register an `onDidChangeConfiguration` listener for
  `ptah.skillSynthesis.enabled` that calls `ensureStarted()`; `enqueueAnalyze` / `analyzeSession`
  call `ensureStarted()` when `enabled && !started`; pass the same `onPassComplete`/`onEvent`
  options on every curator start (S13).
- MODIFY `src/lib/queue/skill-drain.service.ts`: re-read `skillSynthesis.enabled` before each item in
  the loop (`:821`); on false, break and record `summary.reason = 'paused-mid-run'` (rows stay queued).
  Update the header gate-order comment.
- MODIFY `src/lib/queue/stage-handlers.service.ts`: prefilter returns `{outcome:'unscored', retryInMs}`
  (not `skipped`) when the analyzer is not started.
- MODIFY `src/lib/skill-curator.service.ts`: tick reads fresh settings through a supplier instead of
  `currentSettings`, and no-ops when `enabled` or `curatorEnabled` is false; `start()` stays idempotent
  (`intervalHandle !== null` → clear before re-arm).
- MODIFY `src/lib/triggers/skill-trigger.service.ts`: boot-scan callback returns `'stalled'` when
  `synthesis.readSettings().enabled` is false; `fireHarvest` gated on the same key; telemetry untouched.
- Specs: extend `queue/skill-drain.gates.spec.ts`, new `skill-synthesis.pause-resume.spec.ts`,
  `skill-curator.service.spec.ts`, `skill-trigger.service.spec.ts` (boot-scan watermark).

### P3 — Contract, RPC handlers, Electron boot (backend-developer sub-agent)
- MODIFY `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:229-241`: add
  `readonly enabled?: boolean` to `MemorySetTriggersParams`, `readonly enabled: boolean` to
  `MemorySetTriggersResult` and `MemoryGetTriggersResult`.
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.schema.ts:93-95`: `enabled: z.boolean().optional()`.
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts`: `setTriggers` writes
  `memory.enabled` when present; both handlers return it; `memory:runNow` refuses while paused (if
  Open question 5 = refuse).
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`: remove the
  curator stop/start from `updateSettings` (`:651-674`; P2 makes the tick read live settings);
  `runCurator`/`analyzeNow`/`enhanceNow` refusal while paused (Open question 5).
- MODIFY `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:232-287`: start the memory trigger
  service only after the per-workspace status resolves true, matching CLI (M10).
- Conditional on approval: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts` (+ its spec)
  to delete removed keys.
- Specs: `memory-rpc.handlers.spec.ts`, `memory-rpc.schema.spec.ts`,
  `skills-synthesis-rpc.handlers.spec.ts`, `boot-thoth-runtime.spec.ts`.

### P4 — Thoth UI switches (frontend-developer sub-agent; after P3 types)
- MODIFY `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-rpc.service.ts` and
  `memory-diagnostics-state.service.ts`: `memoryEnabled` signal, `setMemoryEnabled()` with optimistic
  update + rollback, refresh on focus/visibility.
- MODIFY `libs/frontend/memory-curator-ui/src/lib/components/memory-curator-tab.component.ts`: header
  switch block (inline in the tab template; no new component unless the skills tab needs the identical
  markup — then one shared presentational component in `memory-curator-ui` would cross a lib boundary,
  so keep two inline blocks).
- MODIFY `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`
  (`:343` settings load) and `skill-synthesis-tab.component.ts`: header switch writing
  `updateSettings({settings:{enabled}})` immediately; refresh on focus/visibility.
- MODIFY `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts:21-28`:
  remove the `enabled` checkbox from the form (and the form control/Save payload in the state service).
- MODIFY `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`: "Paused" badge on the
  Memory/Skills rail items (Assumption: the pillar status source `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts`
  can expose the two booleans; if not, read them from the two state services).
- Disable manual-run buttons while paused (Open question 5).
- Specs for each touched component/service.

### P5 — Electron tray (backend-developer sub-agent)
- MODIFY `apps/ptah-electron/src/services/tray/tray.service.ts`: two checkbox items (memory, skills),
  `TRAY_SETTINGS_KEYS` gains `memory.enabled`, subscribe to `workspace.onDidChangeConfiguration` in
  `create()` and dispose in `destroy()`, refresh the menu on either key.
- MODIFY `apps/ptah-electron/src/services/tray/tray.service.spec.ts` (Assumption: path of the existing spec).
- `apps/ptah-electron/src/main.ts`: no change expected (Assumption: `PtahTrayService.create` options
  already carry the workspace provider, `main.ts:336-341`).

Executors: all backend sub-batches suit a backend-developer sub-agent (or one CLI lane each — they are
file-disjoint); P4 needs a frontend-developer sub-agent. Review: one code-logic-reviewer pass over
P1-P5 (pause/resume races are the risk).

---

## 5. Test plan

Unit (scoped: `npx nx test <project> --testFile=<file>`; never mcp-bench):

| Project | Must prove |
|---|---|
| memory-curator | idle timer armed while enabled does **not** curate when it fires after pause; pause event clears all idle timers; boot scan returns `'stalled'` and does not advance the watermark when paused; resume event re-arms the boot scan exactly once (two resume events → one scheduler); PreCompact handler does nothing while paused; retention returns `skipped: memory-paused` before reading retention settings; listener disposed on `stop()` (no callback after stop) |
| skill-synthesis | host started with `enabled=false` → flip to true (event) → session-end subscription exists, curator scheduled once, embedding backfill enqueued once; same via lazy path with **no event** (cross-process case); two resume events → one subscription/one interval; drain stops before the next item when paused mid-tick and leaves remaining rows `queued`; prefilter while not started → `unscored` (row survives); curator tick reads live settings and no-ops while paused; skill boot scan returns `'stalled'` while paused; harvest not called while paused; telemetry still recorded while paused |
| rpc-handlers | `memory:setTriggers {enabled:false}` writes `memory.enabled`; get returns it; schema rejects non-boolean; `updateSettings` no longer restarts the curator; manual RPCs refuse with `PAUSED` (if approved) |
| thoth-runtime | Electron boot does not start the memory trigger when the workspace row is off |
| ptah-electron | tray renders both items from settings; clicking writes the right key; external `setConfiguration` refreshes the menu; listener disposed on destroy |
| frontend libs | toggle optimistic update and rollback on RPC error; Skills Save payload no longer carries `enabled`; state re-fetched on focus |

Integration (one per pipeline, existing SQLite test support `queue-db.test-support.ts`,
`retention-sqlite.test-support.ts`): enqueue N rows → pause → drain tick → resume → next tick drains
all N, no row `skipped`/lost, no duplicate claims.

Visual (visual-reviewer or Electron run skill): Thoth Memory and Skills tabs, switch On and Paused, in
**dark and light** themes, wide rail and narrow strip layouts — 8 screenshots minimum; plus the tray
menu with both states. Check toggle focus ring, contrast of the "Paused" badge, and that the Skills
form no longer shows "Enabled".

Manual smoke (Electron): pause both → wait one `*/15` drain tick and the `:17` retention tick → cron
run history shows `skipped: disabled` / `memory-paused`; resume → next ticks run; toggle from tray with
the Thoth tab open → tab reflects it on focus.

---

## 6. Preserve list

- `skillSynthesis.enabled` stays the drain's first gate and the single skills master
  (`skill-drain.service.ts:17-31`, `file-settings-keys.ts:286-292`); `memory.enabled` stays outside
  `MemoryTriggersDto` (`memory-trigger-config.ts:8-17`).
- All sub-switches keep their meaning and defaults: `memory.retention.enabled`, `memory.lifecycle.enabled`,
  every `memory.triggers.*`, `skillSynthesis.curatorEnabled`, `judgeEnabled`, `triggers.*`,
  `replayValidation.enabled`, `triggerEval.enabled`, `judgePanel.enabled`, drain battery/foreground/budget gates.
- Per-workspace "Chat memory extraction" toggle and `indexing_state.memory_enabled`.
- Stage-handler registration above the early return (`skill-synthesis.service.ts:330-343`).
- Curator reconciliation runs at start even when the curator is disabled (`skill-curator.service.ts:224-225`).
- Skill invocation telemetry keeps running while paused (3.3).
- Read side: memory and symbol injection, `ptah_memory_search`, skill files.
- Tray exists only with `skillSynthesis.trayKeepalive`; its quit item stays unconditional
  (`tray.service.ts:111-117`, `assertQuitItemPresent`).
- Cron job ids, handler names and expressions (`skill-drain-jobs.ts`, `MEMORY_RETENTION_JOB`,
  `SKILL_BACKLOG_CLEANUP_JOB`); `drain()` never throws.
- VS Code remains Thoth-free; no new RPC method names (baseline unchanged).
- Observation-queue flush on `stop()` (`memory-trigger.service.ts:256-259`).

## Proposed Removals

Each needs explicit user approval; none is done in B-P without it.

| Item | Evidence | Proposal |
|---|---|---|
| `memory.curatorEnabled` key + default | `file-settings-keys.ts:248, 564`; no production reader | delete |
| `memory.triggers.preCompact` key | read into DTO only (`memory-trigger-config.ts:175-180`), gates nothing | delete, or wire to gate PreCompact (Open question 2) |
| `skillSynthesis.triggers.sessionEnd` key | read into DTO only (`skill-trigger-config.ts:95-101`), shown to the UI (`skills-synthesis-rpc.handlers.ts:803`) | delete, or wire to gate S1 (Open question 2) |
| "Enabled" checkbox in the Skills settings form | `skill-settings-panel.component.ts:21-28` | move to the header switch (same key, different control) |
| Single tray item "Pause background learning" | `tray.service.ts:118-131` | replace by two items |
| Manual runs while paused (`memory:runNow`, `runCurator`, `analyzeNow`, `enhanceNow`) | section 3.6 | refuse while paused (Open question 5) |

## Open questions for the user

1. **Read side** — should pausing Memory also stop memory injection into chats and `ptah_memory_search`, and pausing Skills also hide learned skills from agents?
   - (Recommended) No: pause stops background capture and processing only; saved memories and skills keep being used.
   - Yes: add a "full off" that also disables injection (more switches, agent quality drops while off).
2. **Inert trigger keys** `memory.triggers.preCompact`, `skillSynthesis.triggers.sessionEnd`:
   - (Recommended) Delete them (the master switches now cover the need).
   - Wire them so they gate PreCompact curation / session-end enqueue.
   - Leave as is.
3. **Per-workspace "Chat memory extraction"** — today it only gates PreCompact and switching it off stops PreCompact for every workspace in the process:
   - (Recommended) Leave for a follow-up; B-P only fixes the Electron boot mismatch.
   - Fix now: make it a live per-workspace gate on every memory capture path.
4. **Trigger keys stored in the host-local config instead of `~/.ptah/settings.json`** (M19):
   - (Recommended) Separate follow-up (routing them changes where existing values live and needs a one-time migration).
   - Fold into B-P.
5. **Manual "Run now" actions while paused**:
   - (Recommended) Refuse and grey out the buttons while paused.
   - Allow them as explicit one-off runs.
