# B-P: memory and skills pause switches — inventory and implementation plan (TASK_2026_620_a13e)

Revision 1 (2026-10-07). Folds in the cross-side review `pause-switches-plan-review.md` (5 serious, 5 minor;
each answered in "Review disposition" at the end) and the binding **User decisions 2026-10-07, B-P**
(`context.md:178-188`). Plan only; no production code changed. All `file:line` references are against the
worktree `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.

## Provenance tags

Every rule below carries one tag:

- **[U]** user-requested — the original request or a binding user decision (`context.md:178-188`).
- **[R]** project rule — verified in repository source (cited).
- **[L]** lane-proposed — a design choice made in this plan; listed again in "Lane-introduced constraints".
  The team-leader and reviewers may change an [L] rule without asking the user; [U] and [R] rules need the
  user or a cited source change.

## User decisions applied (binding) [U]

1. Read side stays on while paused: saved memories and skills are still injected and `ptah_memory_search`
   still works. Pause stops all background capture, curation, retention, lifecycle, synthesis, judging,
   promotion, and embedder warmup/backfill.
2. Delete `memory.curatorEnabled`, `memory.triggers.preCompact`, `skillSynthesis.triggers.sessionEnd`.
   The per-workspace toggle fix and moving host-local trigger keys are follow-ups.
3. Manual runs `memory:runNow`, `skillSynthesis:runCurator`, `skillSynthesis:analyzeNow`,
   `skillSynthesis:enhanceNow` are refused by the RPC and greyed out in the UI while paused.
4. Electron tray: two items "Pause memory" / "Pause skills"; tray always shown; refreshed when the setting
   changes elsewhere; Quit keeps working.
5. Original request: switches visible on the settings page or the Thoth Memory/Skills settings; stop ALL
   memory and skills work; pause and resume without issues.

---

## 0. Host and notification facts (Verified)

### 0.1 What runs on each host

| Host | Memory/skills background work | Evidence |
|---|---|---|
| **Electron** | everything in section 1 | `bootThothRuntime` `apps/ptah-electron/src/activation/boot-heavy-services.ts:164`, `startThothCron` `:422`, embedder warmup `apps/ptah-electron/src/activation/wire-runtime.ts:505, 632-660` |
| **CLI** | the same libraries via its own composition | `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:93` (`activateThoth`), job specs imported from `@ptah-extension/thoth-runtime` (`:25-31`) |
| **VS Code** | **none that a switch could pause** | see 0.2 |

### 0.2 VS Code reachability [R]

- No SQLite: "nothing under apps/ptah-extension-vscode calls registerPersistenceSqliteServices … the
  Thoth-free invariant is lint-enforced" (`apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:84-91`).
- `MemoryRpcHandlers`, `IndexingRpcHandlers`, `SkillsSynthesisRpcHandlers` are pinned as **must-not-resolve**
  in VS Code (`apps/ptah-extension-vscode/src/di/expected-absent.ts:22-26, 38-43`; header `:1-14`: "no
  better-sqlite3, no embedder worker").
- The symbol index path is guarded by `sqliteOk` (`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:193-199`),
  which is always false there, so `CodeSymbolIndexer.indexWorkspace` never runs in VS Code. (It is a code
  index, not memory, in any host.)
- `mirrorUserLayer` (`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:49`,
  `activation/plugin-activation.ts:107-135`) copies **already-promoted** skills (`synthesizedSkillsRoot`,
  `plugin-activation.ts:89`) into `~/.ptah/user`. It creates nothing, runs no synthesis and no LLM; it is the
  read side that user decision 1 keeps on.
- The Memory and Skills Thoth tabs are `electronOnly: true` (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:240-241`).

Statement for the user: **a VS Code user has nothing to pause in VS Code** — no capture, curation, retention,
synthesis, judging, promotion or embedder runs there. The switches are therefore not shown in VS Code [L],
because showing them would require registering `MemoryRpcHandlers`/`SkillsSynthesisRpcHandlers` in VS Code,
which `expected-absent.ts` forbids [R]. If an Electron instance (kept alive by the tray) or a CLI process
shares the same `~/.ptah/settings.json`, it is paused from the Electron tray or Thoth tabs, or with
`ptah config set ptah.memory.enabled false` (`apps/ptah-cli/src/cli/commands/config.ts:8, 257`).

### 0.3 Settings change notification

| Write source | Path | Fires `IWorkspaceProvider.onDidChangeConfiguration`? |
|---|---|---|
| Thoth UI toggle (Electron) | RPC handler → `this.workspaceProvider.setConfiguration('ptah', key, v)` (`memory-rpc.handlers.ts:741-745`, `skills-synthesis-rpc.handlers.ts:654-660`) → `ElectronWorkspaceProvider.setConfiguration` `libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:212-226` (file key → `fileSettings.set` then `fireConfigChange`, `:217-225`); event field `:41`, assigned `:62` | **Yes** (in-process) |
| Electron tray | `tray.service.ts:259-265` → the same `setConfiguration` (provider resolved `apps/ptah-electron/src/main.ts:327-333`) | **Yes** (in-process) |
| `ptah config set` in the CLI process | `cli-workspace-provider.ts:104-118` | Yes **inside the CLI process only** |
| External edit of `~/.ptah/settings.json`, or a write by another Ptah process | `PtahFileSettingsManager` cross-process `fs.watch` → debounced diff → fires only its **own per-key listeners** (`libs/backend/platform-core/src/file-settings-manager.ts:188-210, 455-505`); `ElectronWorkspaceProvider` never subscribes to `fileSettings.watch` (no such call in the file) | **No.** `getConfiguration` sees the new value (cache refreshed); no event |

Consequence [L]: every gate re-reads the key at each unit of work (authoritative), and every re-arm also has
a **lazy path** that does not depend on the event (sections 3.4 and 4), so an external-edit resume works
without an app restart.

---

## 1. Inventory — every background job and path

Gate read: **live** = re-read per run/event; **boot** = once at `start()`. **GAP** = runs or loses data while paused.
Paths: `memory-curator/…` = `libs/backend/memory-curator/src/lib/…`; `skill-synthesis/…` = `libs/backend/skill-synthesis/src/lib/…`.

### 1a. Memory

| # | Job / path | Start / body | Gate(s) today | Read | On pause today | Status |
|---|---|---|---|---|---|---|
| M1 | PostToolUse capture → `observation_queue` | `memory-curator/triggers/memory-trigger.service.ts:546-550` | `memory.enabled` + `postToolUse.enabled` | live | stops | OK |
| M2 | UserPromptSubmit cue → curate | `memory-trigger.service.ts:481-482` | `memory.enabled` | live | stops | OK |
| M3 | Stop hook → episode/curate | `memory-trigger.service.ts:396-397` | `memory.enabled` | live | stops | OK |
| M4 | ToolFailure capture | `memory-trigger.service.ts:423-424` | `memory.enabled` | live | stops | OK |
| M5 | SessionEnd hook → final curate | `memory-trigger.service.ts:451-476` (`:466`) | `memory.enabled` + `sessionEnd.enabled` | live | stops | OK |
| M6 | Idle timer → `fireIdle` → `tryEpisodeCurate` | arm `:275-303`; fire `:661-672`; `tryEpisodeCurate` `:680-764` | arm only | fire ungated | timer armed before pause curates up to 600 s later | **GAP** |
| M7 | Boot scan → `curator.curate` per session | arm `:215-219` (only arm site; cancel `:251-254`); body `:915-1000` | `memory.enabled && bootScan` | **boot** | running scan continues; never re-armed after resume until next start | **GAP** |
| M8 | In-flight curate | `:820-870` | — | — | finishes | acceptable (3.4) |
| M9 | PreCompact curation (`MemoryCuratorService`) | `memory-curator/memory-curator.service.ts:250-321` | per-workspace `memory_enabled` (boot `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:232-264`; toggle `memory-curator/control/indexing-control.service.ts:416-422`) | boot + toggle | **not gated by `memory.enabled`** | **GAP** |
| M10 | Per-workspace row vs trigger service | Electron starts the trigger service regardless of the row (`boot-thoth-runtime.ts:274-289`); CLI starts it only when the row is on and never later (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:235-249, 259-268`); flipping the row on starts PreCompact only (`indexing-control.service.ts:417-422`) | per-workspace row | boot | host-inconsistent | **Follow-up F1** (not B-P, user decision 2) |
| M11 | Retention cron `@ptah/memory-retention` `17 * * * *` | `start-thoth-cron.ts:270-300`; `thoth-runtime/src/lib/memory-retention-job.ts`; `memory-curator/retention/memory-retention.service.ts:190` | `memory.retention.enabled` | live | runs while `memory.enabled=false` (deletes rows) | **GAP** |
| M12 | Lifecycle archive/delete/evict (inside the retention run) | `memory-curator/retention/memory-lifecycle.service.ts`; `memory-lifecycle-config.ts:44-47` | `memory.lifecycle.enabled` | live | runs while paused | **GAP** |
| M13 | Memory indexing run | `indexing-control.service.ts:304` | per-workspace row or `force` | live | not gated by master | **GAP** |
| M14 | `memory:runNow` | `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:627` | none | — | runs | **GAP** (decision 3) |
| M15 | **Embedder + reranker warmup** (model load in utility process) | armed `apps/ptah-electron/src/activation/wire-runtime.ts:505`; body `:632-660`; barrier opens once the window has loaded and the curator exists | none | boot (once) | runs at every boot while paused | **GAP** (decision 1) |
| M16 | Session-start memory injection | `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:181-187` | `memory.triggers.sessionStart.injectionEnabled` | live | — | read side, stays on [U] |
| M17 | Code-symbol injection | `agent-sdk/src/lib/helpers/code-symbol-prompt-injector.ts:26` | `memory.symbolInjectionEnabled` | live | — | read side, stays on [U] |
| M18 | `ptah_memory_search` / `memory:search` (embeds the query; lazy-loads the embedder, `memory-curator/embedder/embedder-worker-client.ts:99, 170, 194`) | `memory-rpc.handlers.ts:236` | none | — | — | read side, stays on [U]; owned by TASK_2026_619 |
| M19 | DB integrity + daily backup cron | `start-thoth-cron.ts:165-253, 456-467` | `cron.enabled` | live | shared SQLite maintenance, not memory work | out of scope; preserve |
| M20 | Host-local trigger keys: `memory.triggers.turnComplete.enabled`, `episode.enabled`, `sessionEnd.enabled`, `maxObservationsPerCurate`, `bootScanDelayMs`, `bootScanIdleBackoffMs`, `sessionStart.injectionEnabled/observationCount/corpusCount` (`memory-curator/triggers/memory-trigger-config.ts:30-56`) | — | — | — | **Verified absent** from `file-settings-keys.ts` (`grep -c "'<key>'"` = 0 for each of the nine keys and for `skillSynthesis.drain.bootDeferralMs`); writes go to the host-local `config.json` (`electron-workspace-provider.ts:229-232`, `cli-workspace-provider.ts:120-123`) | **Follow-up F2** |
| M21 | Dead keys to delete: `memory.curatorEnabled` — **Verified** no reader: the only hits in `libs/` and `apps/` are its declaration `file-settings-keys.ts:248`, a comment `:360`, and the default `:564`. `memory.triggers.preCompact` — read into the DTO only (`memory-trigger-config.ts:175-180, 263`), gates nothing | — | — | — | deleted in PD [U] |

### 1b. Skills

| # | Job / path | Start / body | Gate(s) today | Read | On pause today | Status |
|---|---|---|---|---|---|---|
| S1 | Session-end → `enqueueAnalyze` | subscribe `skill-synthesis/skill-synthesis.service.ts:412-423`; gate `:529-531` | `skillSynthesis.enabled` | live body; **subscribed only if enabled at boot** (`:345-350`) | a host booted paused never subscribes | **GAP** |
| S2 | Trigger hooks (activity idle, Stop, PostToolUse, SubagentStop, prompt expansion) → `enqueueAnalyze` | `skill-synthesis/triggers/skill-trigger.service.ts:148-181, 765-778` | inside `enqueueAnalyze` (`:529-531`, `null` when `!started`) | live | silent no-op after resume of a booted-paused host | **GAP** |
| S3 | Skill boot scan → enqueue `source:'boot'` | arm `skill-trigger.service.ts:182-186` (no master gate); callback `:865-871` | `triggers.bootScan` | boot | returns `'ran'` even when the enqueue no-ops → **watermark advances past never-queued sessions**; never re-armed after resume | **GAP (data loss)** |
| S4 | Spec harvest on turn complete | `skill-trigger.service.ts:395-433` | none | — | writes while paused | **GAP** |
| S5 | Invocation telemetry | `skill-trigger.service.ts:436-450, 615, 625-690` | telemetry flag | live | records | stays on [L] (3.3) |
| S6 | Drain cron ×3 (`*/15`, `0 3 * * *`, `0 4 * * 0`) | `thoth-runtime/src/lib/skill-drain-jobs.ts`; `start-thoth-cron.ts:56-120`; `skill-synthesis/queue/skill-drain.service.ts:758-856` | gate 1 (`:784`) | per tick only; loop `:821-836` checks only `signal.aborted` | a nightly (40) / weekly (400) tick keeps running | **GAP** |
| S7 | Drain stages prefilter, embedding, archaeology, judge-panel, replay, trigger-eval | `skill-synthesis/queue/stage-handlers.service.ts:216-245` | inherit S6 | — | prefilter with `!started` → `analyzeSession` `null` (`skill-synthesis.service.ts:698-700`) → terminal `skipped` (`stage-handlers.service.ts:272-283`) | **GAP (data loss)** |
| S8 | SKILL.md migration, dirs, embedding backfill enqueue | inside `SkillSynthesisService.start()` `:354-443` | `skillSynthesis.enabled` | boot | — | OK via deferred start |
| S9 | Curator interval: retirement, umbrella merge, enhancement → promotion/repropagation | `skill-synthesis/skill-curator.service.ts:217-243`; pass `:268-276` | `curatorEnabled` at `start()`; tick uses the start-time snapshot | boot | fires while paused; stale settings | **GAP** |
| S10 | Curator reconciliation (data repair) | `skill-curator.service.ts:224-225, 505` | none (by design) | at `start()` | runs once per start | OK; preserve |
| S11 | Backlog cleanup cron `41 * * * *` | `thoth-runtime/src/lib/skill-backlog-cleanup-job.ts`; `skill-synthesis/cleanup/skill-backlog-cleanup.service.ts:136, 584` | `skillSynthesis.enabled` | live | skips | OK |
| S12 | Manual `skillSynthesis:runCurator` (`skills-synthesis-rpc.handlers.ts:732`), `analyzeNow` (`:834`), `enhanceNow` (`:1100`) | — | none | — | run | **GAP** (decision 3) |
| S13 | Curator restart in `updateSettings` drops `onPassComplete`/`onEvent` | `skills-synthesis-rpc.handlers.ts:650-672` vs `skill-synthesis.service.ts:426-429` | — | — | passes stop being recorded/emitted after a curator setting change | bug, fixed in P2/P3 |
| S14 | Electron tray | `apps/ptah-electron/src/services/tray/tray.service.ts:118-131, 221-276`; created only with `trayKeepalive` (`apps/ptah-electron/src/main.ts:320-350`) | writes `skillSynthesis.enabled` only | own click only | no external refresh; no memory item | **GAP** (decision 4) |
| S15 | Promoted skills exposed to agents (`mirrorUserLayer`, all hosts) | `plugin-activation.ts:89, 107-135` | — | — | — | read side, stays on [U] |
| S16 | Dead key `skillSynthesis.triggers.sessionEnd` — read into the DTO only (`skill-trigger-config.ts:95-102, 146`), surfaced to the UI (`skills-synthesis-rpc.handlers.ts:803`), gates nothing | — | — | — | — | deleted in PD [U] |

Totals: **37 rows** (21 memory, 16 skills). **16 gaps fixed in B-P**: M6, M7, M9, M11, M12, M13, M14, M15,
S1, S2, S3, S4, S6, S7, S9, S12 (+ tray S14 and bug S13). Two follow-ups (M10 → F1, M20 → F2).
Three dead keys deleted (M21 ×2, S16).

---

## 2. Existing UI and control surfaces (Verified)

| Surface | Location | Controls | Backend path |
|---|---|---|---|
| Thoth shell (Electron only) | `thoth-shell.component.ts:31, 240-247`; already imports `MemoryCuratorTabComponent`/`SkillSynthesisTabComponent` (`:25-26`) and `ThothStatusService` from `@ptah-extension/dashboard` (`:21-24, 203, 212`) | tab rail with pillar status | `ThothStatusService.refresh()` on every tab switch (`libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:137-145, 240`) |
| Skills tab → settings panel, "Enabled" checkbox inside a Save form | `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts:21-28`, Save `:385-393`; mounted only at `skill-synthesis-tab.component.ts:590` | `skillSynthesis.enabled` (applies on Save) | `skill-synthesis-rpc.service.ts:265-269` → `skillSynthesis:updateSettings` (`libs/shared/src/lib/types/rpc.types.ts:1952`) → `skills-synthesis-rpc.handlers.ts:640-672`, writes only keys present (`:654-660`); schema has `enabled` (`skills-synthesis-rpc.schema.ts:75`) |
| Skills tab → trigger toggles | `skill-synthesis-ui/…/diagnostics/skill-triggers-settings.component.ts:51-53, 135-136`; `skill-trigger-toggle.component.ts:9` | `skillSynthesis.triggers.*` | `skillSynthesis:setTriggers` (schema `skills-synthesis-rpc.schema.ts:276-277`) |
| Memory tab → "Chat memory extraction" | `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html:355-365`, mounted `memory-curator-tab.component.ts:207` | per-workspace row | indexing RPC → `indexing-control.service.ts:401-423` |
| Memory tab → trigger checkboxes, Run now | `memory-curator-ui/…/diagnostics/memory-diagnostics-accordion.component.ts:53-92, 231, 239`; `memory-trigger-toggle.component.ts:15-75` | `memory.triggers.*`; manual run | `memory-diagnostics-state.service.ts:76-106` → `memory:setTriggers`/`memory:runNow` (`rpc.types.ts:1856-1863`; params `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:229-241`; schema `memory-rpc.schema.ts:44-45, 93-95`) → `memory-rpc.handlers.ts:627, 720-757` |
| Skills manual actions | Run curator `skill-synthesis-tab.component.ts:1025`; Analyze now `…/diagnostics/skill-activity-feed.component.ts:91` → `skill-diagnostics-state.service.ts:156`; enhance via `previewEnhancement` (`…/clones/skill-clones-view.component.ts:751`; `enhanceNow` has no UI caller, `enhance-preview-drawer.component.ts:4-6`) | manual runs | as S12 |
| `memory.enabled` | — | **no UI anywhere** | — |
| Settings push to the webview | push constants `libs/shared/src/lib/types/messages/message-constants.ts:245, 255` | **none for settings** | — |
| Electron main Settings page | `libs/frontend/chat/src/lib/settings/settings.component.ts` | no memory/skills switch | — |

Angular conventions [R]: standalone, `OnPush`, signal `input()`/`output()` (`memory-trigger-toggle.component.ts:15-17, 54-61`);
DaisyUI switch `class="toggle toggle-xs toggle-primary"` (`workspace-indexing.component.html:358`).

---

## 3. Design

### 3.1 Switch model

| Switch | Key | Pauses | Never pauses |
|---|---|---|---|
| **Memory** | `memory.enabled` | M1-M7, M9, M11-M15 | M16-M18 read side [U]; M19 DB maintenance [L] |
| **Skills** | `skillSynthesis.enabled` | S1-S4, S6-S9, S12 | S5 telemetry [L]; S10 reconciliation at start [R]; S15 skill files [U] |

- Reuse the two existing file-routed keys (`file-settings-keys.ts:369, 658` and `:255, 571`) [L]; no new
  keys. `skillSynthesis.enabled` is already documented as the single skills master with "deliberately NO
  pause/queueEnabled key" [R] (`file-settings-keys.ts:286-292`).
- Sub-switches stay underneath: effective = master AND sub-switch; resume never flips a sub-switch [L].
- No new RPC method name [R] (`host-source-registry.baseline.ts:1-5`, Gate 2 exception required).

### 3.2 Per-workspace `memory_enabled`

Unchanged in B-P [U] (decision 2 → Follow-up F1). B-P does **not** apply the earlier M10 "mirror the CLI"
change: the review showed it would leave capture dead with no revive path (CLI already has that hole,
`cli-engine/src/lib/bootstrap/thoth-runtime.ts:246-268`; `indexing-control.service.ts:417-422` revives
PreCompact only).

### 3.3 Read side and telemetry

Stays on while paused [U]: M16, M17, M18, S15. Skill invocation telemetry (S5) also stays on [L]: retirement
retires skills unused for `dormantAfterDays` (`file-settings-keys.ts:592-593`), so pausing usage recording
while the user keeps using skills would retire them after resume. It writes usage events only; it runs no
synthesis, judging or promotion.

The UI copy under each switch says: "Pausing stops capture and background processing. Saved memories/skills
are still used in chats." [L]

### 3.4 Pause / resume semantics

| Rule | Mechanism | Tag |
|---|---|---|
| No new unit starts while paused | each entry point re-reads its master before a unit: trigger events, `fireIdle`, each boot-scan session, each drain item, each curator tick, retention run, indexing run, warmup, manual RPCs | [U] stop ALL; [R] live re-read is the existing pattern (`memory-trigger.service.ts:276, 397, 424, 466, 482, 550`; `skill-drain.service.ts:784`; `memory-retention.service.ts:190`) |
| In-flight: finish the current unit, start no further unit | a running curate, drain stage or curator step completes and records its result. Rejected "abort": an aborted drain claim waits for the stale reaper (`staleClaimTtlMs` 15 min, `file-settings-keys.ts:621`), spent tokens are wasted, and no rollback exists for half-written candidates | [L] |
| Timers stop doing work | the pause event clears memory idle timers and cancels the boot-scan scheduler. Without an event (external edit) the timer fires and the live gate makes it a no-op | [L] |
| Boot scans never advance the watermark while paused | memory and skills boot-scan callbacks return `'stalled'` when the master is off; `BootScanRunner` then stops and keeps the watermark below that session (`memory-trigger.service.ts:940-948`) | [L] |
| **Boot scans resume without restart** | each trigger service keeps a `bootScanOwed` flag, set when `start()` skipped arming because paused, or when a scan ended because a callback stalled on the pause. `maybeRearmBootScan()` arms only if owed, master on, `bootScan` flag on, and the service's own `bootScanArmed` is false. It is called from (a) the `onDidChangeConfiguration` handler (in-process writes) and (b) **lazily from `onActivity`/`onSessionStart`**, which run on every session event, so an external-edit resume re-arms on the next chat activity. Rate-limit stalls do not set the flag (unchanged behaviour) | [L]; [U] resume without issues |
| Queue rows are never lost | prefilter with the analyzer not started returns `{outcome:'unscored', retryInMs}` instead of terminal `skipped`; a mid-tick pause leaves unclaimed rows `queued` | [L] |
| Skills deferred start | `SkillSynthesisService.ensureStarted()` (idempotent on `started`) completes the boot work skipped while paused (DB check, migration, session-end subscription, curator start, embedding backfill). Called from the `onDidChangeConfiguration` handler and **lazily** from `enqueueAnalyze`, `analyzeSession`, and the prefilter stage when `enabled && !started` | [L] |
| Drain/retention resume | next cron tick (≤ 15 min drain, ≤ 60 min retention). The backlog stays queued and drains under the existing tier caps. No forced run-now kick | [L] |
| No double scheduling | every arm is guarded by a handle the service owns (`bootScanArmed`, `intervalHandle`, `started`, `HandlerRegistry.has`). `SkillCuratorService.start()` clears an existing interval before arming (today it does not, `skill-curator.service.ts:234-242`). Listeners are registered once in `start()` and disposed in `stop()` | [L] |
| Curator settings stay fresh; period changes apply live | the curator tick reads settings through a supplier (`SkillSynthesisService.readSettings`) and no-ops when `enabled` or `curatorEnabled` is false. A change to `curatorEnabled`/`curatorIntervalHours` via `updateSettings` calls a new `SkillSynthesisService.restartCurator()` that passes the same `onPassComplete`/`onEvent` options as `start()` (fixes S13 and keeps period changes live; review finding 7) | [L] |
| Hexagonal, all hosts | only `IWorkspaceProvider.getConfiguration`/`onDidChangeConfiguration` (port, `workspace-provider.interface.ts:57`); no new `vscode-core` imports in agnostic libs | [R] |

Rejected [L]: adding `watchSetting(key)` to the `IWorkspaceProvider` port. It would change three adapters plus
test doubles, and the lazy paths above already cover external edits.

### 3.5 Dead keys — deleted in B-P [U]

All readers, DTOs, UI and specs change in one sub-batch (PD), because removing a DTO field breaks compilation
across libs:

| Key | Files that change |
|---|---|
| `memory.curatorEnabled` | `libs/backend/platform-core/src/file-settings-keys.ts:248, 564` (and reword the comment `:360`) |
| `memory.triggers.preCompact` | `file-settings-keys.ts:380, 669`; `file-settings-keys.spec.ts:332, 345`; `memory-curator/triggers/memory-trigger-config.ts:19, 76, 126, 141, 175-180, 263` (+ `memory-trigger-config.spec.ts:16, 42, 66, 125, 130, 153`); `memory-curator/diagnostics.types.ts:53` and its builder (+ `diagnostics.service.spec.ts:149`); `memory-trigger.coalesce.spec.ts:106`, `memory-trigger.integration.spec.ts:59`, `memory-trigger.service.spec.ts:200`; `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:68`; `rpc-handlers/…/memory-rpc.schema.ts:45`; `memory-rpc.handlers.ts:596` (+ `memory-rpc.handlers.spec.ts:191, 765, 795, 1013, 1022`); `libs/frontend/memory-curator-ui/…/memory-diagnostics-accordion.component.ts:55, 239` (+ `.spec.ts:298-300, 435, 465, 503, 554`); `memory-diagnostics-rpc.service.spec.ts:87, 132, 184-207, 268`; `memory-diagnostics-state.service.spec.ts:25, 89, 205-212`; `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings.fixtures.ts:257`, `…/thoth/skills-lane-pickers.e2e.spec.ts:215`, `…/thoth/thoth-feed-visual.e2e.spec.ts:180` |
| `skillSynthesis.triggers.sessionEnd` | `file-settings-keys.ts:389, 686`; `file-settings-keys.spec.ts:339, 349`; `skill-synthesis/triggers/skill-trigger-config.ts:8, 44, 68, 78, 97-102, 146` (+ `skill-trigger-config.spec.ts:16`); `skill-synthesis/diagnostics.service.spec.ts:26, 143, 158, 165` and the diagnostics snapshot type that carries it; shared `SkillTriggersDto.sessionEnd` `rpc-curator-diagnostics.types.ts:95`; `skills-synthesis-rpc.schema.ts:277`; `skills-synthesis-rpc.handlers.ts:803` (+ `skills-synthesis-rpc.handlers.spec.ts:283, 392, 433, 487, 743-822`; `skills-synthesis-rpc.activity-feed.integration.spec.ts:374-377, 483, 493`); `libs/frontend/skill-synthesis-ui/…/diagnostics/skill-trigger-toggle.component.ts:9`, `skill-triggers-settings.component.ts:51-53, 135-136`, `…/services/skill-diagnostics-state.service.ts:66` (+ their specs) |

Do not touch: `persistence-sqlite/…/0032_skill_synthesis_queue.spec.ts:194` (`'sessionEnd'` there is not this
key; implementer confirms), and every `onPreCompact`/`PreCompactTrigger`/compaction-coordinator symbol
(the hook, not the key). Leftover values in users' `~/.ptah/settings.json` become unrouted keys.
Assumption: `PtahFileSettingsManager` loads and ignores unknown keys; check `file-settings-manager.ts`
load/diff and keep a spec that an unknown key does not throw.

### 3.6 Manual runs while paused [U]

- `memory:runNow`, `skillSynthesis:runCurator`, `analyzeNow`, `enhanceNow` throw
  `RpcUserError('<feature> is paused', 'PAUSED')` when their master is off. `'PAUSED'` is added to
  `RpcUserErrorCode` (`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:7-23`) [L].
- The UI greys out Run now (memory accordion `:231`), Run curator (`skill-synthesis-tab.component.ts:1025`)
  and Analyze now (`skill-activity-feed.component.ts:91`), with the tooltip "Paused — resume Skills/Memory to
  run". `enhanceNow` has no UI caller; see Open question 1 for `previewEnhancement`.

### 3.7 UI [U visible; placement L]

- **Where:** a "Background learning" switch at the top of the Thoth Memory tab and the Thoth Skills tab
  (Electron) [L]. These are the "memory/skills Thoth settings" the user named [U], and Electron is the only
  host where the work runs (0.1). The main Settings page gets no second control (two controls for one key
  can drift) [L].
- **Control:** an immediate-apply DaisyUI `toggle` (not in any form) with "On / Paused" text and the 3.3
  copy. Optimistic update, rollback on RPC error, disabled while in flight [L].
- **Memory payload (review finding 6):** `memory:setTriggers` with `{ triggers: {}, enabled }`, never the
  cached trigger DTO. An empty partial writes no trigger key (`memory-rpc.handlers.ts:738-746` flattens only
  present keys). Shared types: `MemorySetTriggersParams.enabled?: boolean`; `MemorySetTriggersResult.enabled`
  and `MemoryGetTriggersResult.enabled: boolean` (`rpc-curator-diagnostics.types.ts:229-241`) [L].
- **Skills:** the header switch sends `updateSettings({ settings: { enabled } })`. The "Enabled" checkbox
  leaves the Save form (`skill-settings-panel.component.ts:21-28`), and the form payload drops `enabled`
  [L].
- **Paused badge (review finding 8):** the existing edges are enough. `ThothStatusService` (dashboard,
  already imported by the shell) adds `memoryPaused`/`skillsPaused` to its pillar refresh, read through the
  existing `memory:getTriggers` and `skillSynthesis:getSettings`. Each tab component emits a
  `pausedChange` output; the shell, which already hosts both tabs, calls `thothStatus.refresh()` on it. No
  new lib dependency [L].
- **Freshness without a push channel:** tabs and `ThothStatusService` re-fetch on tab switch (existing),
  window `focus` and `visibilitychange`. This covers tray and external writes [L].

### 3.8 Electron tray [U two items, always shown, refreshed; mechanics L]

- **Always created** in `main.ts` (drop the `trayKeepalive === true` condition at `main.ts:330-336`; keep
  every failure → `trayService = null`).
- **Menu:** checkbox "Pause memory" (`memory.enabled`), checkbox "Pause skills" (`skillSynthesis.enabled`),
  separator, "Quit Ptah". The quit item stays a literal and `assertQuitItemPresent` stays [R] (`tray.service.ts:11-24, 111-117`).
  `TRAY_SETTINGS_KEYS` gains `memory.enabled`.
- **Refresh:** subscribe to `workspace.onDidChangeConfiguration` in `create()` and dispose in `destroy()`.
  Also rebuild the menu just before it opens (`tray.on('click')`/`'right-click'`, Assumption: confirm the
  event per platform), so an external edit, which fires no event (0.3), is still current when the menu shows.
- **What "always shown" changes about quit:** today `handleWindowAllClosed` suppresses the quit whenever a
  live tray exists (`tray.service.ts:309-329`, wired `main.ts:390-396`). With the tray always created,
  closing the last window would stop quitting on Windows and Linux, a silent behaviour change. Rule [L]:
  suppress the quit only when `trayKeepalive === true` (read live at close time) **and** a live tray exists.
  This keeps R10 (no live tray → always quit) [R] and the shipped default (keepalive `false` → closing the
  window quits, as today). `WindowAllClosedDeps` gains `keepAliveRequested: () => boolean`. macOS is
  unchanged (`:317-319`). `main.quit-path.spec.ts` pins the new matrix.

### 3.9 Embedder warmup (M15) [U]

`runEmbedderWarmup` (`wire-runtime.ts:632-660`) returns early, with a log line, when `memory.enabled` is
false. It needs no re-warm on resume, because the embedder lazy-loads on first `embed` (`embedder-worker-client.ts:99, 170, 194`).
The cost is a cold start on the first search or curate after resume [L]. Skills embedding work is the drain's
`embedding` stage plus the backfill enqueue in the deferred start, so it is already under the Skills switch.

---

## 4. File-level plan (sub-batches)

Order: **PD first** (alone, because it spans libs). Then **P1, P2, P3, P5 in parallel** (file-disjoint with
each other). Then **P4** after P3's shared types land. Executors: backend-developer sub-agent (or one CLI
lane each) for PD, P1, P2, P3, P5; frontend-developer sub-agent for P4. One code-logic-reviewer pass over all.

### PD — Dead-key removal (backend-developer; frontend edits are mechanical field removals)

Every file in the 3.5 table. Done when nothing references the three keys, and the scoped typecheck plus
tests pass for `platform-core`, `memory-curator`, `skill-synthesis`, `shared`, `rpc-handlers`,
`memory-curator-ui`, `skill-synthesis-ui` and `webview-e2e-harness`.

### P1 — Memory backend (backend-developer) — `libs/backend/memory-curator`

- `triggers/memory-trigger.service.ts`: gate `fireIdle`/`tryEpisodeCurate` on `readMemoryEnabled()`;
  boot-scan callback returns `'stalled'` when paused and sets `bootScanOwed`; add `bootScanArmed` and
  `maybeRearmBootScan()` (event path plus lazy calls from `onActivity`/`onSessionStart`); in `start()` set owed
  instead of arming when paused, and subscribe to `onDidChangeConfiguration` (`ptah.memory.enabled`): pause
  → clear idle timers and cancel the scan (owed = true if it was running); resume → `maybeRearmBootScan()`.
  Dispose in `stop()`.
- `memory-curator.service.ts`: the PreCompact handler (`:252`) returns early when `memory.enabled` is false
  (Assumption: confirm the class injects `IWorkspaceProvider`; else inject `PLATFORM_TOKENS.WORKSPACE_PROVIDER`
  as `indexing-control.service.ts:7` does).
- `retention/memory-retention.service.ts` (+ `memory-retention-config.ts` if the read lives there): first gate
  `memory.enabled === false` → `skip('memory-paused')`. Lifecycle inherits it.
- `control/indexing-control.service.ts:304`: the memory pipeline run is skipped while paused (except `force`);
  symbols are untouched.
- Specs: new `triggers/memory-trigger.pause.spec.ts`; `memory-retention.service.spec.ts`;
  `indexing-control.service.spec.ts`; the curator PreCompact spec.

### P2 — Skills backend (backend-developer) — `libs/backend/skill-synthesis`

- `skill-synthesis.service.ts`: `ensureStarted()` (event plus lazy from `enqueueAnalyze`/`analyzeSession`);
  config-change listener; `restartCurator()` that passes the start options.
- `queue/skill-drain.service.ts`: re-read `enabled` before each item (`:821`); on false, break with
  `summary.reason = 'paused-mid-run'`. Update the gate-order header.
- `queue/stage-handlers.service.ts`: prefilter with the analyzer not started → `unscored` + `retryInMs`.
- `skill-curator.service.ts`: settings supplier, gated tick, clear-before-arm in `start()`.
- `triggers/skill-trigger.service.ts`: boot-scan arming needs the master (else owed); the callback returns
  `'stalled'` and sets owed when paused; `maybeRearmBootScan()` from the config-change event and lazily from
  `onActivity`; gate `fireHarvest`; telemetry untouched.
- Specs: `queue/skill-drain.gates.spec.ts`; new `skill-synthesis.pause-resume.spec.ts`;
  `skill-curator.service.spec.ts`; `triggers/skill-trigger.service.spec.ts` (or the existing
  `skill-trigger.boot-defer.spec.ts`, which already mocks `onDidChangeConfiguration` at `:128`).

### P3 — Contract and RPC (backend-developer) — `libs/shared`, `libs/backend/rpc-handlers`

- `shared/…/rpc-curator-diagnostics.types.ts`: `enabled` fields (3.7).
- `shared/…/rpc-error-codes.types.ts`: `'PAUSED'`.
- `rpc-handlers/…/memory-rpc.schema.ts`: `enabled: z.boolean().optional()` on set; `memory-rpc.handlers.ts`:
  write/return `memory.enabled`; `runNow` refuses while paused.
- `rpc-handlers/…/skills-synthesis-rpc.handlers.ts`: `updateSettings` calls `synthesis.restartCurator()`
  instead of `curator.stop()/start(newSettings)` (`:661-664`); `runCurator`, `analyzeNow`, `enhanceNow` refuse
  while paused.
- Specs: `memory-rpc.handlers.spec.ts`, `memory-rpc.schema.spec.ts`, `skills-synthesis-rpc.handlers.spec.ts`.

### P4 — Thoth UI (frontend-developer; after P3)

- `memory-curator-ui`: `memory-diagnostics-rpc.service.ts`, `memory-diagnostics-state.service.ts`
  (`memoryEnabled` signal, `setMemoryEnabled()` sending `{triggers:{}, enabled}`, rollback, focus refresh);
  `memory-curator-tab.component.ts` (header switch, `pausedChange` output);
  `memory-diagnostics-accordion.component.ts` (disable Run now while paused).
- `skill-synthesis-ui`: `skill-synthesis-state.service.ts` (`:343`), `skill-synthesis-tab.component.ts`
  (header switch, `pausedChange`, disable Run curator), `skill-settings-panel.component.ts` (remove `enabled`),
  `diagnostics/skill-activity-feed.component.ts` (disable Analyze now).
- `dashboard/…/thoth-status.service.ts` (paused flags) and `thoth-shell.component.ts` (badge; refresh on
  `pausedChange` and focus).
- Specs for each.

### P5 — Electron (backend-developer) — `apps/ptah-electron`

- `src/services/tray/tray.service.ts` (+ `tray.service.spec.ts`): two items, refresh listener plus refresh on
  open, `keepAliveRequested` in `handleWindowAllClosed`, header comment updated.
- `src/main.ts` (+ `main.quit-path.spec.ts`): always create the tray; pass `keepAliveRequested`.
- `src/activation/wire-runtime.ts`: warmup gate (3.9).

---

## 5. Test plan

Unit tests run scoped (`npx nx test <project> --testFile=<file>`); mcp-bench never runs [U/R per orchestrator].

| Project | Must prove |
|---|---|
| memory-curator | an idle timer armed before pause does not curate after; the pause event clears timers; a paused boot scan returns `'stalled'` and the watermark does not move; **resume by event re-arms exactly once** (two events → one arm); **resume with no event** (value flipped in a fake provider, then one `onActivity`) re-arms once; boot with the master off arms nothing, and the first resume arms; PreCompact no-op while paused; retention `skipped: memory-paused`; listener disposed on `stop()` |
| skill-synthesis | booted paused → event → subscription, curator interval and backfill exist once; the same via the lazy path with no event; two resumes → one interval; mid-tick pause leaves rows `queued`; prefilter while not started → `unscored`, row survives; curator tick reads live settings and no-ops while paused; `restartCurator()` keeps the callbacks (pass recorded after a settings change); **skill boot scan: paused → `'stalled'`, watermark kept → resume (event and lazy) re-arms once and queues the skipped sessions**; harvest not called while paused; telemetry still recorded |
| rpc-handlers | `setTriggers {triggers:{}, enabled:false}` writes only `memory.enabled`; get returns it; schema rejects a non-boolean; the four manual RPCs throw `PAUSED` while paused and run when on; `updateSettings` with `curatorIntervalHours` calls `restartCurator` |
| platform-core / PD | the three keys are absent from keys and defaults; an unknown key in `settings.json` does not throw |
| ptah-electron | both items render from settings; a click writes the right key; an external `setConfiguration` refreshes the menu; refresh on open picks up a value changed with no event; listener disposed on destroy; quit matrix: no tray → quit; tray + keepalive false → quit; tray + keepalive true → stay; darwin → stay; warmup skipped when memory is paused |
| frontend | optimistic toggle and rollback; payload `{triggers:{}, enabled}`; the Skills Save payload has no `enabled`; buttons disabled while paused; badge refresh on `pausedChange`; re-fetch on focus |

Integration (existing `skill-synthesis/queue/queue-db.test-support.ts`, `memory-curator/retention/retention-sqlite.test-support.ts`):
enqueue N → pause → tick → resume → next tick drains all N, none `skipped`, no duplicate claim.

Visual (visual-reviewer) [L]: Memory and Skills tabs, switch On and Paused, **dark and light**, wide rail and
narrow strip (8 shots), plus the tray menu in both states. Check focus ring, badge contrast, disabled-button
tooltips, and that the Skills form has no "Enabled".

Manual smoke (Electron): pause both from the tray with the Thoth tab open; cron history shows
`skipped: disabled`/`memory-paused` on the next drain/retention ticks; edit `~/.ptah/settings.json` by hand
to resume, start a chat turn, and confirm the boot scans re-arm and the next ticks run; close the window with
keepalive off and confirm the app quits.

---

## 6. Preserve list

- `skillSynthesis.enabled` as the drain's first gate and the single skills master [R] (`skill-drain.service.ts:17-31`);
  `memory.enabled` stays outside `MemoryTriggersDto` [R] (`memory-trigger-config.ts:8-17`).
- All remaining sub-switches and defaults [R].
- Per-workspace "Chat memory extraction" behaviour, unchanged [U].
- Stage-handler registration above the early return [R] (`skill-synthesis.service.ts:330-343`).
- Reconciliation at curator start [R] (`skill-curator.service.ts:224-225`).
- Read side M16-M18, S15 [U]; telemetry S5 [L].
- Tray quit item unconditional + `assertQuitItemPresent` + R10 "no live tray → quit" [R]; default
  window-close quits [L, preserves today].
- Cron job ids, handler names, expressions; `drain()` never throws [R].
- VS Code Thoth-free; `expected-absent.ts` unchanged [R]. No new RPC method names [R].
- Observation-queue flush on `stop()` [R] (`memory-trigger.service.ts:256-259`).

## Proposed Removals

None pending. The three dead keys, the Skills form "Enabled" checkbox (moved, not dropped), the single tray
item, and manual runs while paused were approved by the user decisions (`context.md:178-188`) and are now
part of the plan.

## Follow-ups (not B-P) [U decision 2]

- **F1 Per-workspace memory toggle:** make `memory_enabled` a live per-workspace gate on every capture path.
  Covers Electron starting the trigger service with the row off (`boot-thoth-runtime.ts:274-289`), CLI
  capture never starting later (`cli-engine/src/lib/bootstrap/thoth-runtime.ts:246-268`), and the process-wide
  `stop()` (`indexing-control.service.ts:417-422`).
- **F2 Host-local trigger keys (M20):** route them to `~/.ptah/settings.json`, with a one-time migration from
  the host `config.json`.
- **F3 Settings push to the webview** (replaces focus re-fetch) [L].

## Lane-introduced constraints

Choices this plan made that are neither user-requested nor repository rules:

1. The masters reuse `memory.enabled` / `skillSynthesis.enabled`, and sub-switches are ANDed beneath.
2. The memory master is carried on `memory:getTriggers`/`setTriggers` (top-level `enabled`, payload `{triggers:{}, enabled}`).
3. Switches live in the Thoth tab headers only; no main-Settings-page control; none in VS Code.
4. In-flight units finish; nothing aborts mid-unit.
5. Boot scans return `'stalled'` while paused; `bootScanOwed` + lazy re-arm from session events.
6. `ensureStarted()` lazy deferred start for skills.
7. Prefilter `unscored` + retry when not started; drain break with `paused-mid-run`.
8. No forced drain run on resume; next tick.
9. The curator tick reads live settings; `restartCurator()` replaces the RPC's stop/start.
10. Invocation telemetry and DB maintenance stay on while paused.
11. Error code `'PAUSED'`; disabled buttons with a tooltip.
12. Optimistic toggle with rollback; refresh on focus/visibility; the `pausedChange` output drives the shell badge via `ThothStatusService`.
13. Window-close keep-alive requires `trayKeepalive` (live) AND a live tray; the menu also refreshes on open.
14. Embedder warmup is gated on `memory.enabled` only; no re-warm on resume.
15. Visual review: 8 screenshots, dark + light, plus the tray.
16. PD runs alone first; P4 waits for P3.

## Review disposition (`pause-switches-plan-review.md`)

| # | Finding | Resolution |
|---|---|---|
| 1 | Skills boot scan has no resume path | `bootScanOwed` + event and lazy re-arm in `SkillTriggerService` (3.4, P2); tests in §5 |
| 2 | M10 fix creates capture-dead boot | M10 change dropped; per-workspace semantics unchanged; F1 (3.2) |
| 3 | Memory re-arm is event-only | lazy re-arm from `onActivity`/`onSessionStart` (3.4, P1); no-event test |
| 4 | Embedder warmup missed | row M15; gated under Memory (3.9, P5) |
| 5 | VS Code reachability | 0.2: nothing runs there, and the handlers are forbidden by `expected-absent.ts`; no VS Code UI, stated explicitly |
| 6 | `setTriggers` payload stale-write risk | payload fixed to `{triggers:{}, enabled}` (3.7) |
| 7 | Interval change inert after removing restart | `restartCurator()` keeps period changes live and fixes S13 (3.4) |
| 8 | Badge dependency direction | both edges already exist (`thoth-shell.component.ts:21-26`); `ThothStatusService` + `pausedChange` (3.7) |
| 9 | Path errors / unverified citations | CLI path corrected to `cli-engine/src/lib/bootstrap/thoth-runtime.ts`; Electron event verified at `platform-electron/src/implementations/electron-workspace-provider.ts:41, 62, 212-226` (0.3); M20/M21 absence re-verified with stated grep |
| 10 | No provenance tags | tags on every rule + Lane-introduced constraints |

## Open questions for the user

1. **`skillSynthesis:previewEnhancement`** is the call the Skills UI actually makes to generate an enhancement
   (`skill-clones-view.component.ts:751`); `enhanceNow` has no UI caller. Should the preview also be refused
   while Skills is paused?
   - (Recommended) Yes: refuse it and grey out the Enhance button, because it is the same LLM work under a
     different name.
   - No: refuse only the four RPCs you named.
