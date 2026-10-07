# Cross-side review — `pause-switches-plan.md` (TASK_2026_620_a13e)

Review mode: read-only decision review against source. No tests or builds were run; no git
operations; the concurrent edits under `tools/mcp-bench` were not touched. ~26 inventory rows were
spot-checked with opened `file:line` evidence across `libs/backend/memory-curator`,
`libs/backend/skill-synthesis`, `libs/backend/thoth-runtime`, `libs/backend/cli-engine`,
`libs/backend/rpc-handlers`, `apps/ptah-electron/src/services/tray` (+ `activation`),
`libs/frontend/{skill-synthesis-ui,thoth-shell}` and `libs/shared`.

**Verdict: REVISE** — the architecture (two existing file-routed master keys, live per-unit gates,
no new RPC names) is sound and well-evidenced, but five serious findings change P1–P5 content or
coverage and must be folded in before implementation.

---

## Findings

### 1. SERIOUS — the skills boot scan has no resume path at all

Evidence:
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:148-189` — `start()` has
  no master gate; the boot scan is armed whenever `readBootScanFlag()` is true (`:182-186`), so it
  runs while paused.
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:865-871` — today the
  callback enqueues and returns `'ran'` unconditionally; the enqueue silently no-ops when the
  service is not started (`skill-synthesis.service.ts:529-531`) → watermark advances past
  never-queued sessions (S3 data loss — verified).
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:940-944` — `'stalled'`
  makes `BootScanRunner` **stop the scan** and leave the watermark below the session; "the next
  boot retries it". So P2's `'stalled'`-while-paused fix preserves the watermark but *stops* the
  scan.
- Plan §3.4 and P2 specify a resume re-arm **only for `MemoryTriggerService`** ("re-arms its boot
  scan on the resume event if not already armed"). Nothing re-arms `SkillTriggerService`'s boot
  scan, and §5's skill-synthesis test rows test only that it returns `'stalled'` while paused.

Consequence: pause mid-scan → resume → unscanned transcripts stay unscanned until the **next app
start**. This contradicts the plan's own rule "Resume restarts without app restart" (§3.4) and the
user's "playable without any issues". Fix: mirror the memory design — re-arm the skills boot scan
on the resume event (and ideally a lazy path, see finding 3), plus a resume test.

### 2. SERIOUS — the M10 fix (P3) creates a capture-dead boot with no revive path

Evidence:
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:232-265` — Electron starts the
  PreCompact `MemoryCuratorService` only when the per-workspace status resolves true (un-awaited,
  `:246-264`); today the trigger service still starts regardless (`:274-289`, gated only on
  `refs.memoryCurator !== null`), so M10's gap claim is verified.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:235-249` — the CLI awaits the
  status and sets `refs.memoryCurator` only when started, so the trigger service never starts when
  the row is off. **The CLI behaviour the plan mirrors has the same hole.**
- `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:402-424` —
  `setPipelineEnabled('memory', true)` (the "Chat memory extraction" toggle in the Memory tab)
  starts only the PreCompact curator (`:417-422`); nothing starts `MemoryTriggerService` post-boot.

Consequence of P3 as written ("start the memory trigger service only after the per-workspace
status resolves true"): a workspace whose row is off at boot gets **no observation capture at all**,
and flipping the toggle on later revives PreCompact only — capture stays dead until app restart.
That is also a silent semantics change: today capture runs with the row off (only PreCompact and
indexing are gated), while §3.2 claims "keep, unchanged semantics in B-P". Fix: either keep starting
the trigger service unconditionally and gate per-unit on the row (consistent with the plan's own
live-gate philosophy), or add a start path when the row flips on — and state the semantics change.

### 3. SERIOUS — memory boot-scan re-arm is event-only; a cross-process resume never re-arms it

Evidence:
- `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:215-219` — the boot scan
  is armed once in `start()` (`readMemoryEnabled() && readBootScanFlag()`); there is no other arm
  site (stop cancels it, `:251-254`).
- Plan §3.4 resume row: re-arm happens "on the resume event"; the skills side additionally gets a
  lazy path (`ensureStarted` from `enqueueAnalyze`/`analyzeSession`/prefilter). The memory side has
  no lazy path.
- Plan's own notification table (§ "Settings change-notification mechanics", verified consistent
  with source): `IWorkspaceProvider.onDidChangeConfiguration` fires only on **in-process**
  `setConfiguration`; a write by another process (`ptah config set` while Electron runs, or an
  external edit of `~/.ptah/settings.json`) refreshes the file-settings cache (so live gates see
  it) but fires no event.

Consequence: a cross-process resume makes every live gate work again, but the memory boot scan
stays un-armed/stalled until the **next app start** — unbounded, not the "only the re-arm latency
differs" the plan claims when rejecting `watchSetting` (§3.4). Fix: add a lazy memory re-arm (e.g.
re-check `readMemoryEnabled() && !armed` in the event handlers that already run on every session
event), or soften the claim and document the limitation.

### 4. SERIOUS (coverage) — missed job: the Electron embedder warmup is neither inventoried nor gated

Evidence:
- `apps/ptah-electron/src/activation/wire-runtime.ts:505` — `coordinator.armWarmup(() =>
  runEmbedderWarmup(container))`; `:632-660` — pre-warms the embedder + reranker (model load in a
  utility process), fire-and-forget, with **no `memory.enabled` / `skillSynthesis.enabled` read**.
- The embedder serves memory indexing (M13) and the skills embedding stages, so this is
  memory/skills-related work that runs while paused.

Impact is resource-only (no LLM spend, no DB/file writes; one shot at boot), but the plan's
inventory claims to enumerate "every background job and path" and §3.1/§3.3 never mention it. Fix
is trivial: arm the warmup only when either master is on, or record an explicit justification
(cold-start cost on first search after resume). Either way it needs an inventory row.

### 5. SERIOUS — a VS Code user cannot reach either switch, and the plan never says so

Evidence:
- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:240-241` — the Memory and
  Skills tabs are `electronOnly: true`.
- `SkillSettingsPanelComponent` is mounted only from
  `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:49,80`
  (repo grep — no other mount), i.e. the skills settings surface is Electron-only too.
- Plan §2 itself records that the main Settings page has "no memory/skills master switch", and P4
  adds switches **only** to the Thoth tab headers.

The user asked for the switches to be "visible in our settings page **or** memory/skills Thoth
settings". The plan picks the only surface that does not exist on VS Code. Since VS Code runs no
Thoth background work the switches would be inert as *gates* there — but they are the controls for
the shared `~/.ptah/settings.json` (e.g. an Electron instance kept alive by the tray while the
user works in VS Code). The plan must either add the toggles (or a deep link) to the main settings
page, which renders on every host, or explicitly record "VS Code users have no surface" as an
accepted consequence. Silence on the one host where the user's first-listed location lives is a
coverage gap against the request.

### 6. MINOR — the `memory:setTriggers` payload for the new master switch is underspecified (stale-write risk)

Evidence: `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:229-231` — `triggers` is
**required** in `MemorySetTriggersParams`; `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:738-746`
— the handler writes every flattened key present in the DTO. P3 adds `enabled?` and P4 adds
`setMemoryEnabled()` but neither states the payload. If the implementer naturally sends the cached
triggers DTO alongside `enabled`, the switch silently clobbers trigger keys changed elsewhere
since load — the exact defect class P4 fixes on the skills side by removing `enabled` from the Save
form. Specify: send `triggers: {}` (verified safe — the flatten of an empty `Partial` writes
nothing) or make `triggers` optional in the schema when `enabled` is present.

### 7. MINOR — removing the curator restart from `updateSettings` makes `curatorIntervalHours` changes inert until restart

Evidence: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:650-672` —
today `curatorAffected` restarts the curator, which applies a new interval period live (while
dropping the pass/event options — S13, verified real at `:661-664` vs the options passed at
`skill-synthesis.service.ts:426-429`).
`libs/backend/skill-synthesis/src/lib/skill-curator.service.ts:230-242` — the interval period is
fixed at `start()`; P2's "tick reads fresh settings" covers the pass settings, not the period.
Post-P3 a period change needs an app restart — a capability regression the plan does not
acknowledge. Either keep a *safe* restart (P2's idempotent `start()` + options), let the tick
re-arm itself with the fresh period, or record the regression.

### 8. MINOR — the "Paused" badge dependency direction is unresolved

Evidence: plan P4 (Assumption: `libs/frontend/dashboard/.../thoth-status.service.ts` can expose the
two booleans; fallback: read them from the two state services).
`thoth-shell.component.ts:239-249` configures tabs by id/label/icon only — the shell does not
import the tab libs today, so **both** options add a new cross-lib edge (thoth-shell → dashboard,
or thoth-shell → memory-curator-ui/skill-synthesis-ui). The plan should name which edge the
repository's lib boundaries permit before P4 starts, rather than leaving it as an either/or.

### 9. MINOR — evidence path errors and citations not re-verified

- The CLI bootstrap path is `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` — the
  plan cites `src/bootstrap/...` (missing the `lib` segment) in §Inputs, M9 and M10. The line
  numbers themselves check out at the correct path (`:246-249` verified above).
- `electron-workspace-provider.ts:217-226` ("setConfiguration fires `onDidChangeConfiguration`
  for file keys") was not openable at the implied path and was **not re-verified** here. The port
  exists (`platform-core/src/interfaces/workspace-provider.interface.ts`; the CLI adapter exposes
  the event at `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:36`), and
  P1/P2/P5's resume paths all depend on the Electron fire — the implementer must confirm it first.
- M19's "grep count 0" for the five host-local trigger keys and M20's "no production reader" for
  `memory.curatorEnabled` were not independently re-verified (repo grep truncated). Both are
  consistent with what was opened (`memory-trigger-config.ts:30-59` defines the keys;
  `file-settings-keys.ts:248,564` declares the dead key and no reader surfaced in any file opened
  for this review).

### 10. MINOR — the plan does not tag its rules user-requested / project-rule / lane-proposed

No rule in the plan carries a provenance tag. The mapping is supplied below ("Rule tagging" and
"## Lane-introduced constraints") so the team-leader and reviewers can separate the user's ask
from the lane's design choices; the plan itself should carry it.

---

## Missed-jobs sweep (per the review brief)

Missed:
- **Embedder warmup** — finding 4 (`wire-runtime.ts:505,632-660`). The only job class found running
  while paused that the plan neither stops nor justifies.

Checked and correctly covered or justifiably out of scope:
- Cron inventory is complete: `start-thoth-cron.ts` registers `SKILL_DRAIN_JOBS` (`:67`),
  `@ptah/db-integrity-check` (`:245`), `MEMORY_RETENTION_JOB` (`:281-300`),
  `SKILL_BACKLOG_CLEANUP_JOB` (`:318-337`), `@ptah/daily-backup` (`:459`) — all inventoried
  (S6, M18, S11, M11; M18 kept running with a stated, defensible reason).
- Curator reconciliation (S10): `skill-curator.service.ts:224-225` runs inside `start()`, so it
  is gated by the master at boot and by the deferred start on resume — preserved by design, fine.
- Repropagation / enhancement / retirement: inside the curator pass (S9), fixed by the gated tick.
- Spec harvest (S4): `skill-trigger.service.ts:421-433` — `fireHarvest` has no gate (verified);
  P2 gates it. Note the *arming* path (`fireTurnComplete`, `:395-423`) also has no master gate
  today; the enqueue half is gated at `skill-synthesis.service.ts:529-531`, so the P2 harvest gate
  closes the loop.
- Timers: memory idle (M6 — `fireIdle` at `memory-trigger.service.ts:661-672` and
  `tryEpisodeCurate` at `:680-764` have no master gate — gap verified); skills turn-complete
  debounce → `fireTurnComplete` (covered via S4's fix + enqueue gates); skills curator interval
  (S9 — snapshot + no gate verified at `skill-curator.service.ts:221-242`).
- SKILL.md migration + directory bootstrap: inside `SkillSynthesisService.start()`
  (`skill-synthesis.service.ts:354-401`) — covered by the deferred start (S8 same).
- Embedding backfill (S8): `:616-636`, queue row — covered by the deferred start.
- OpenRouter pricing warmup (`agent-sdk/pricing.port.ts:9`, `auth-providers/openrouter`) — not
  memory/skills work; correctly out of scope.

## Pause/resume, cross-host, UI, batches, tests — assessment

Verified sound:
- **Live-gate model**: gates re-read per event on the memory side
  (`memory-trigger.service.ts:276,397,424,466,482,550`), per tick on the drain
  (`skill-drain.service.ts:784`), per run on retention (`memory-retention.service.ts:190`), per
  call on enqueue/analyze (`skill-synthesis.service.ts:529-531,698-703`). The plan's authoritative
  gate = live re-read is the repository's own pattern, correctly identified.
- **Queue/watermark data loss is real**: S3 verified (`skill-trigger.service.ts:865-871` returns
  `'ran'` while the enqueue no-ops); S7 verified (`stage-handlers.service.ts:279-283` — a `null`
  from a not-started analyzer becomes terminal `skipped`). The `unscored`+retry fix direction
  matches the drain's existing counters/deferral shape (`skill-drain.service.ts:770,821-839`:
  budget/network deferrals already leave rows queued — same mechanism).
- **Double scheduling**: `SkillCurator.start()` is not idempotent today
  (`skill-curator.service.ts:234-242` — `setInterval` without clearing; verified). P2's
  clear-before-re-arm + never-stop-on-pause design, plus never stopping crons, avoids all three
  named hazards (curator interval, cron upserts, trigger re-arm guarded by the existing handle).
- **S13 bug verified**: `skills-synthesis-rpc.handlers.ts:661-664` restarts the curator without the
  `onPassComplete`/`onEvent` options that `skill-synthesis.service.ts:426-429` passes — the P3
  removal + P2 live tick is a valid fix (with finding 7's caveat).
- **Cross-host / hexagonal**: P1/P2/P5 use only `IWorkspaceProvider` port methods; no new
  `vscode-core` imports proposed; VS Code stays Thoth-free by construction. The skills trigger
  service already receives a workspace provider (`skill-trigger.boot-defer.spec.ts:128` mocks
  `onDidChangeConfiguration`), so P2's listener wiring has an established seam.
- **In-process notification chain**: webview UI → RPC handler `setConfiguration`
  (`memory-rpc.handlers.ts:741-745`, `skills-synthesis-rpc.handlers.ts:654-660`) and tray →
  `setConfiguration` (`tray.service.ts:261-265`) are in-process writes, so the plan's
  event-based resume/cleanup works for UI and tray toggles on Electron; the cross-process case is
  findings 1/3.
- **UI rows verified**: Skills "Enabled" checkbox inside the Save form
  (`skill-settings-panel.component.ts:22-29`), Save button `:385-393`, deep-link `:421-423`;
  `updateSettings` merges per provided key only (`skills-synthesis-rpc.handlers.ts:654-660`) — so
  the header-switch write of `{settings:{enabled}}` cannot clobber other keys, and the form minus
  `enabled` cannot clobber the master. Optimistic update/rollback and disable-while-in-flight are
  specified; focus/visibility re-fetch covers tray and CLI writes.
- **Sub-batches**: P1 (memory-curator lib), P2 (skill-synthesis lib), P3 (shared + rpc-handlers +
  thoth-runtime + platform-core), P4 (frontend libs), P5 (electron tray) are file-disjoint; P4
  correctly gated on P3's shared type landing. Executors (backend-developer ×4,
  frontend-developer for P4, one code-logic-reviewer pass) are sensible.
- **Test plan** proves pause *and* resume (two resume events → one scheduler; lazy resume with no
  event; mid-tick drain leaves rows queued; prefilter row survives; retention skip reason; tray
  refresh; integration enqueue→pause→resume→all-drained). Gaps: no test for skills boot-scan
  resume (finding 1), none for the per-workspace row flip-on after the M10 fix (finding 2), none
  for a cross-process resume of the memory boot scan (finding 3), none for `setTriggers`
  partial-payload safety (finding 6).

## Rule tagging

- **User-requested**: switches visible (settings page or Thoth settings) and working; stop ALL
  memory/skills background work; pause and resume without issues.
- **Project-rule (verified in source)**: no new RPC method names (baseline registry); VS Code
  Thoth-free invariant; the two existing file-routed keys as masters with sub-switches ANDed
  beneath (`file-settings-keys.ts:289` documents `skillSynthesis.enabled` as the drain's first
  gate); hexagonal `IWorkspaceProvider`-only access; the preserve list (cron job ids, observation
  flush on stop `memory-trigger.service.ts:256-259`, reconciliation-at-start, stage registration
  above the early return `skill-synthesis.service.ts:335-343`, unconditional tray quit item
  `tray.service.ts:111-117`); Angular standalone/OnPush/signal conventions; zod at the RPC
  boundary.
- **Lane-proposed**: everything under "## Lane-introduced constraints" below.

## Lane-introduced constraints

Rules the lane chose that are neither the user's request nor a repository rule (P1–P5 and §3–§5
must not treat these as fixed requirements):

1. The master switches are surfaced by **extending `memory:getTriggers`/`setTriggers` with a
   top-level `enabled` field** rather than a new RPC method or a settings-page control (the
   no-new-method constraint is a project rule; reusing the *triggers* pair is the lane's choice).
2. The switches live **only on the Thoth Memory/Skills tab headers** (not the main settings page).
3. **In-flight units finish**; nothing is aborted mid-unit (the finish-vs-abort choice).
4. Boot scans return **`'stalled'`** while paused (watermark-preservation mechanism).
5. Prefilter returns **`{outcome:'unscored', retryInMs}`** (not `skipped`) when the analyzer is
   not started.
6. The drain loop breaks with **`summary.reason = 'paused-mid-run'`**, leaving rows queued.
7. The tray gets **two checkbox items** replacing the single "Pause background learning" item,
   refreshed via `onDidChangeConfiguration`.
8. The Skills **"Enabled" checkbox moves out of the Save form** into the header switch.
9. **Read side and invocation telemetry stay on** while paused (the plan's interpretation of
   "ALL"; mitigated by Open question 1).
10. Manual run-now RPCs **refuse with `PAUSED`** and the buttons grey out (Open question 5).
11. UI freshness via **re-fetch on focus/visibilitychange** instead of a settings push message.
12. The **"Paused" badge** on the Thoth rail plus "On / Paused" state text and explanation copy.
13. The curator interval is **never stopped/started on pause/resume** (gated tick), and
    `updateSettings` no longer restarts the curator.
14. The M10 fix direction is **mirror the CLI**.
15. The memory master write uses **optimistic update + rollback, toggle disabled while in flight**.
16. Visual review requires **8 screenshots minimum, dark and light themes, plus the tray** in both
    states.

---

## Verdict

**REVISE.** The switch model, gate placement and file-disjoint batching are well-grounded in
verified source. Fold in: a skills boot-scan resume path (1), a revive path (or per-unit gating)
for the M10 change (2), a lazy memory boot-scan re-arm (3), the embedder-warmup row (4), and an
explicit decision on VS Code visibility (5); then address the minor items (6–10) in the same pass.
