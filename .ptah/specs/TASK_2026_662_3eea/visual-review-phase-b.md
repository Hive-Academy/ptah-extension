# Visual Review - TASK_2026_662 Phase B (batches 16-24)

Verdict: REVISE (score 5/10). Visual breaking 0, Serious 3, Moderate 7, Minor 4.
The score is held down by one real-run defect: the Library cannot list any clone at HEAD 829600e7f.

## Environment

- Build: `npx nx run ptah-electron:build-dev` then `copy-renderer-dev`, both from the worktree
  `.claude-worktrees/skill-synthesis-purge` (HEAD 829600e7f). Both exited 0; `main.mjs` and the renderer were
  rebuilt from these sources just before the run (same approach as Phase A).
- Launch: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs`, `--remote-debugging-port=9390`
  only, private HOME/USERPROFILE/APPDATA/LOCALAPPDATA/`--user-data-dir`/`PTAH_DB_PATH` under a new
  `os.tmpdir()/ptah-662-pb-*` folder, removed on exit. The real profile and `~/.ptah/settings.json` were never
  touched. In the private profile `skillSynthesis.enabled` and `skills.telemetry.enabled` default to true, so the
  paused state was reached by operating the switch, not by the real settings file.
- Viewport 1280x800 for every Phase B item (audit selection, not a support contract; narrow widths were not
  opened). The Thoth width baseline also used 1904x967 (a 1920x1080 request, clamped by the display).
- Themes: dark = `anubis`, light = `anubis-light`.
- Fault injection: the preload bridge is frozen (`contextBridge`), so RPC delay/failure/replies were injected in
  the Electron main process by wrapping the `rpc` ipcMain listener (`visual/phase-b/capture-phase-b.cjs`).
  Held, failed or synthetic replies were used only for: pause/telemetry pending and error, model-list slow and
  failure, enhance preview/save replies, and the Library clone list (see Serious 1; the real list fails).
  Everything in the Library screens below is therefore rendered from synthetic RPC replies, with real
  components and real CSS.
- Scripts and raw notes: `visual/phase-b/capture-phase-b.cjs`, `run-all.txt`, `run-models-*.txt`,
  `index-raw-*.txt`. Screenshots: `visual/phase-b/pb-<name>-<dark|light>.png` (138 files incl. the models set).
- Cleanup: Electron closed via `app.close()` after every run; `netstat` shows nothing on 9390 and no electron
  process remains.

## Findings

### Serious

1. Library lists nothing in the real app: red alert "skillSynthesis:listClones failed; please try again."
   - Reproduced in my Electron run (Skills > Library, all three kind tabs, both themes; tab counts show 0).
     The real-path screenshot (red alert bar above the tab strip, tabs "Skills 0 / Agents 0 / Commands 0") was
     overwritten by later synthetic-reply runs of the same file name; the error is preserved in
     `visual/phase-b/main-log.txt` and `index-raw-library.txt` ("Skills cards: 0 ... Agents cards: 0"), and the
     stack above is quoted from the log.
   - Exact main-process error (private APPDATA log, `udd/logs/Ptah Electron-2026-10-19.log`):
     ```
     [ERROR] RPC SkillsSynthesisRpcHandlers.registerListClones failed
       Error: Cannot read properties of undefined (reading 'getUsageStats')
       TypeError: Cannot read properties of undefined (reading 'getUsageStats')
         at SkillScorecardService.getInvocationStats (dist/apps/ptah-electron/main.mjs:247232:36)
         at SkillsSynthesisRpcHandlers.toCloneSummary (main.mjs:254668:35)
         at async RpcHandler.handleMessage
     [WARN] RpcHandler: Method "skillSynthesis:listClones" returned user error (PERSISTENCE_UNAVAILABLE)
     ```
   - Cause: `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:61` reads `this.events.getUsageStats`,
     but the fifth constructor parameter (`private readonly events: SkillInvocationEventStore`, line 48) has no
     `@inject(...)`. The bundle is built by esbuild, which emits no `design:paramtypes`, so tsyringe injects
     `undefined` (every other parameter in that constructor uses `@inject`). Introduced by commit e632e109d.
     `SkillInvocationEventStore` is registered as a class singleton at `di/register.ts:79`.
   - Not the DB: migration 0056 applied (max version 56), `idx_skill_task_grades_subject` exists and the
     `INDEXED BY` query in `skill-task-grade.store.ts:187-192` runs. The same failure occurs with no events and no
     grades seeded (seed variants `events`, `grades`, none all failed identically).
   - The throw is reached from `toCloneSummary` (`skills-synthesis-rpc.handlers.ts:2335`, unguarded
     `getInvocationStats`), so one failing lookup empties the whole Library and `getClone` fails the same way.
     The Phase A screens would have been unreachable the same way after e632e109d.
   - Fix: add `@inject(SKILL_SYNTHESIS_TOKENS...)` (or a token) for the event store parameter, and guard
     `toCloneSummary` so a scorecard failure degrades one card instead of the list.
   - Impact: Library, card/drawer grade display, model editor and Enhance preview are unreachable by users.
2. Pre-existing `badge-success`/`badge-error`/`alert-error` token pairs fail AA 1.4.3 and now appear in the new
   batch 21 preview drawer (text 10-12px).
   - Measured (canvas-resolved colours, `run-all.txt`): dark "Proposal ready" badge 232,230,225 on 22,163,74 =
     2.64:1; dark stale/save alert 3.87:1; light stale alert 4.12:1; dark `FAILED` pill 3.87:1; dark `COMPLETE`
     2.64:1; light `FAILED` 4.12:1. Light "Proposal ready" 6.01:1 passes.
   - Screenshots: `pb-enhance-draft-dark.png`, `pb-enhance-stale-dark.png`, `pb-enhance-stale-light.png`.
   - Source: `enhance-preview-drawer.component.ts:62-70,76` (`alert alert-error`, `badge-success`), shared daisyUI
     tokens. Same root cause as the open Phase A Serious; not a Phase B regression, but the new drawer inherits it.
3. Light-theme Thoth tile numerals fail contrast (pre-existing, unchanged by Phase B): Memory/Cron/Messaging values
   `68,235,211` on `240,236,232` = 1.27:1 and `0,164,242` = 2.35:1 at 20px (large text threshold 3:1). The Skills
   value ("Off", `167,108,0`) is 3.45:1 and passes as large text. Screenshot: `pb-dashboard-tiles-light.png`.
   Source: `thoth-shell.component.ts:175` (`dashboard-status-card-value`).

### Moderate

1. Dashboard Skills tile goes stale after a telemetry change. With the telemetry switch toggled to Off the tile
   still reads "On" 3 s later in the same tab; only a tab round trip (Memory then Skills) refreshes it to "Off".
   Evidence: `run-all.txt` "skills tile (after toggle): On", "(3s later, same tab): On", "(after tab round trip): Off";
   screenshots `pb-dashboard-tiles-toggled-dark.png` vs `pb-dashboard-tiles-after-roundtrip-dark.png`. The switch
   and tile sit side by side. Cause: `thoth-status.service.ts` refreshes lazily (tab switch/focus, ~line 148-156) and
   `thoth-shell.component.ts` only re-reads the pause flag on `pausedChange`; no hook for telemetry
   (`skill-synthesis-state.service.ts:532` `setTelemetryEnabled`).
2. The tile reads "Skills / Off / Skill telemetry" or "Skills / On" with a "Paused" badge. With Skills enabled and
   telemetry Off the headline reads as if Skills were off; with Skills paused it reads "On". Screenshots
   `pb-skills-tile-after-roundtrip-dark.png`, `pb-dashboard-tiles-paused-dark.png`. Source:
   `thoth-status.service.ts:574-576` (value On/Off, desc "Skill telemetry").
3. Phase A carry-over Moderate 1 (null detail-row pill): now reachable and renders, but the neutral "No grade" pill
   has no visible container in dark (pill bg 19,19,23 = card bg; text 14.86:1 passes, shape lost), while light shows
   an outlined pill. Screenshots `pb-rows-agents-1-dark.png`, `pb-rows-agents-1-light.png`. Source:
   `scorecard-detail.component.ts:118-119` (`badge badge-xs`, no tone class). Contrast and tone verified; low
   priority styling gap. Note the wire type (`ScorecardInvocationRow.succeeded: boolean`) still cannot carry null;
   my rows were synthetic.
4. Model editor load states. "Loading models..." is plain muted text with no spinner or elapsed hint for up to 20 s
   (`pb-model-slow-11s-dark.png`, `pb-model-slow-3s-light.png`); the unavailable message shows the raw internal
   string "Models unavailable: RPC timeout: skillSynthesis:getAgentModels" (`pb-model-unavailable-light.png`,
   `pb-model-unavailable-dark.png`). A reload keeps the stale list until the failure replaces it with the alert
   (`pb-model-reload-stale-8s-dark.png`). Source: `agent-model-editor.component.ts:416-435`.
   Contrast is fine (error text 5.97-6.12:1).
5. Background roles count disagrees between surfaces: routing map node says "2 roles" (twice on the same card,
   "2 roles" badge and body) while the Orchestration summary says "3 roles - Memory curator, enhancement, decision".
   Screenshots `pb-routing-map-light.png`, `pb-orch-background-summary-closed-light.png`. Sources:
   `routing-map.component.ts`, `orchestration-settings.component.ts`.
6. Enhancement row copy and truncation: chips "Enhancement provider / model / time limit - Mixed sources" show even when
   every value is the default; the editor's Model select clips "Default (active provide..." (`pb-enhancement-editor-viewport-dark.png`,
   `pb-consumer-assignments-dark.png`). Source: `provider-consumer-assignments.component.ts:312-330,350-417`.
7. Pause switch layout: the toggle drops below the help text, leaving the right side empty, while the telemetry card
   keeps its toggle on the right (`pb-pause-and-telemetry-dark.png`; unchanged at 1904px, see
   `thoth-width/before/before-thoth-skills-1920-dark.png`). The telemetry switch shows no "Saving..." text while
   pending (`pb-telemetry-pending-light.png`), unlike the pause switch (`pb-pause-pending-light.png`); both pending
   switches look dim/unchecked-like because a disabled checked toggle has low contrast.
   Source: `skills-pause-switch.component.ts:46-110`, `skill-synthesis-tab.component.ts:176-198`.

### Minor

1. Phase A carry-over Minor 1 (neutral verdict dot) is NOT resolved: the card dot strip still maps any non-true value to
   a red dot with title "FAILED" (a null verdict rendered as red/"FAILED", `pb-card-agents-1-dark.png`: red, green, red).
   `scorecard-badge.component.ts:70-77` (`[class.bg-error]="!v.succeeded"`). Unreachable on the current wire type,
   but it will mislabel an ungraded run the moment null verdicts flow.
2. Duplicate grade display on agent cards/drawer: "SUCCESS No grade" in the metric grid plus the "No grade / 3 inv"
   scorecard row below it; an unused agent shows the one-sentence empty state and also "No grade 0 inv tokens: no data
   yet cost: no data yet" (`pb-card-agents-0-dark.png`, `pb-drawer-agents-1-dark.png`). By design per batch 24's
   "extra context", but it repeats the same fact.
3. Preview "No change proposed": Save is disabled with the reason only in a `title` tooltip (`pb-enhance-nodraft-light.png`);
   the diff panel is a fixed 26rem tall box with large empty space for short diffs (`pb-enhance-draft-dark.png`).
4. Background-roles cards: the Memory curator card has a large blank gap between title and content
   (`pb-consumer-assignments-dark.png`).

## Batch 24 three-kind grade display (card and drawer, synthetic clone data)

Rendered for skills, commands and agents, both themes. Text taken from `innerText` (`index-raw-*.txt`/`run-all.txt`).

| Kind case | Skills | Commands | Agents | Verdict |
|---|---|---|---|---|
| unused + ungraded | "Never invoked yet - usage metrics appear after its first recorded run." only (card and drawer) | same | same sentence, plus the scorecard row (Minor 2) | PASS (one sentence) |
| used + ungraded | INVOCATIONS 3, SUCCESS "No grade" in muted text (5.71:1 dark, 14.44:1 light) | INVOCATIONS 2, "No grade" | INVOCATIONS 3, "No grade" + scorecard | PASS |
| graded | 100%, and a real 0% for zero-skill (not hidden, not "No grade") | 50% | 75%, 0% (code-reviewer) | PASS |

Card and drawer agree on every row. Screenshots: `pb-card-{skills,commands,agents}-N-{dark,light}.png`,
`pb-drawer-{skills,commands,agents}-N-{dark,light}.png`, `pb-library-{skills,commands,agents}-{dark,light}.png`.
No horizontal overflow at 1280x800 in either theme.

## Phase B item checklist

| Item | Dark | Light | Result | Key screenshots |
|---|---|---|---|---|
| O10 dashboard Skills tile, telemetry On/Off | yes | yes | PASS with Moderate 1, 2 | `pb-skills-tile-initial-*`, `pb-skills-tile-toggled-*`, `pb-skills-tile-after-roundtrip-*`, `pb-dashboard-tiles-*` |
| Library pause + telemetry controls | yes | yes | PASS (Moderate 7) | `pb-pause-and-telemetry-*`, `pb-telemetry-switch-*`, `pb-library-header-*` |
| Providers Enhancement row (provider, model, timeout + Undo) | yes | yes | PASS with Moderate 6 | `pb-consumer-assignments-*`, `pb-enhancement-editor-*`, `pb-enhancement-timeout-editor-*` |
| Background-roles summary (3 roles) | yes | yes | PASS (Moderate 5) | `pb-orch-background-summary-closed-*` |
| Routing map Background roles node (2 roles) | yes | yes | PASS (Moderate 5) | `pb-routing-map-*`, `pb-routing-map-viewport-*` |
| Pause switch pending (committed value held, disabled, "Saving...") | yes | yes | PASS: checked stayed at the committed value, disabled=true | `pb-pause-pending-*` |
| Pause switch error alert, stays at committed value | yes | yes | PASS: "Could not change the Skills switch. It shows the saved setting." role=alert, 12.30:1 dark / 13.27:1 light | `pb-pause-error-*` |
| Telemetry switch pending / error | yes | yes | PASS; no pending text (Moderate 7) | `pb-telemetry-pending-*`, `pb-telemetry-error-*` |
| Model editor slow list (held past 10 s, under 20 s) | yes | yes | Loading stays; no progress affordance (Moderate 4) | `pb-model-slow-3s-*`, `pb-model-slow-11s-*`, `pb-model-slow-16s-*` |
| Model editor unavailable (loading cleared, message + Reload) | yes | yes | PASS functionally; raw method name in copy (Moderate 4) | `pb-model-unavailable-*`, `pb-model-unavailable-fast-*` |
| Enhance preview drawer: loading, draft + Save enabled | yes | yes | PASS (Serious 2 contrast) | `pb-enhance-loading-*`, `pb-enhance-draft-*` |
| Enhance preview: save in flight | yes | yes | PASS: "Saving...", Save and Discard disabled | `pb-enhance-saving-*` |
| Enhance preview: stale refusal, draft kept open | yes | yes | PASS: error shown, diff kept, Save stays enabled | `pb-enhance-stale-*` |
| Enhance preview: no draft, preview error | yes | yes | PASS: Save disabled (Minor 3) | `pb-enhance-nodraft-*`, `pb-enhance-error-*` |
| Phase A Moderate 1 null detail-row pill | yes | yes | Renders "No grade" neutral (Moderate 3) | `pb-rows-agents-1-*` |
| Phase A Minor 1 neutral verdict dot | yes | yes | NOT resolved (Minor 1) | `pb-card-agents-1-dark.png`, `pb-dots-agents-1-*` |

## Accessibility and contrast (Phase B surfaces, 1280x800)

Criterion: WCAG 2.2 AA (1.4.3: 4.5:1 normal text, 3:1 large). No project-declared override found; Phase A used the same.

- Pass: "No grade" muted text 5.71:1 dark / 14.44:1 light; neutral "No grade" pill text 13.89-15.92:1; telemetry help
  text 5.71:1 / 5.47:1; telemetry error text 6.33:1 / 6.29:1; pause error 12.30:1 / 13.27:1; "Paused" badge 6.61:1 / 5.66:1;
  dark Save button 4.82:1, light Save 6.81:1; skill tile "On" 7.39:1.
- Fail: see Serious 2 and 3. Disabled Save in light (1.47:1) is exempt as a disabled control.
- Targets: pause and telemetry toggles sit in a 24x24 hit area (source comment at `skills-pause-switch.component.ts:99`);
  not re-measured.
- Keyboard focus and tab order for the new drawers were not re-run in Phase B.

## Prototype fidelity

- No approved prototype exists for these batches. Fidelity: NOT APPLICABLE.
- Before/after: `visual/before/` holds the pre-purge Providers, routing-map and consumer-assignments captures
  (`before-routing-map-{dark,light}.png`, `before-consumer-assignments-{dark,light}.png`). The after images are
  `pb-routing-map-{dark,light}.png` and `pb-consumer-assignments-{dark,light}.png`. The old "Judging & enhancement" row
  and lane rows are gone; the Enhancement row replaces them; no regressions beyond Moderate 5 and 6.

## Thoth width baseline (extra capture requested by the orchestrator)

Before images for Memory, Skills, Cron and Gateway at 1280x800 and 1904x967 (the 1920x1080 request, clamped by
the display), dark and light: `visual/thoth-width/before/before-thoth-<panel>-<1280|1920>-<dark|light>.png`
(16 files). No horizontal overflow in any. At 1904 the content column is capped near 960px and centred, with wide
empty margins (e.g. `before-thoth-skills-1920-dark.png`), which is the baseline for the later full-width work.
Script: `visual/thoth-width/capture-thoth-width.cjs`.

## Visual performance

No layout shift seen on pause/telemetry toggles (the min-h row holds). Real `getAgentModels` takes about 15 s
in the private profile because `agent:listCliModels` times out on the dead Ollama endpoint (log: "agent model lists
timed out ... timeoutMs 15000"); that is environment, but it is why the loading text can persist (Moderate 4).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the listClones cause and the pause/telemetry/enhance states; MEDIUM for the Library visuals
  (synthetic RPC replies, single 1280x800 viewport, focus order not re-run).
- Key concern: Serious 1, the missing `@inject` on `SkillScorecardService`'s `events` parameter makes the Library fail in the real
  app, so none of the batch 24 display can be seen by a user until it is fixed.
