# Code Logic Review (main merge) — TASK_2026_620

Scope: in-progress `git merge --no-commit origin/main` into `feat/task-620-memory-skills-bench-s3` (HEAD f3ef3a2fe). Read-only review; no tests/builds run (the lane's scoped checks are taken as given).

## Summary

| Metric | Value |
| --- | --- |
| Score | 9/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 2 (non-blocking) |

## Method

- Compared each resolved file against `HEAD` (what main contributes) and against `origin/main` (what 620 contributes), plus `git diff 9bba84b23 origin/main` for the two component files, to confirm every main hunk survived.
- Searched the merged tree (`apps`, `libs`, `tools`) for the three keys deleted by `dbfe31d04`.
- Intersected `git diff --name-only 9bba84b23 HEAD` with `... origin/main` (16 files) and read the merged-vs-HEAD diff of the 12 non-conflicted ones.
- Confirmed no unresolved `UU` paths other than the four resolved files, and no conflict markers.

## Per-file findings

### 1. memory-diagnostics-accordion.component.ts — OK
- Main kept (vs `9bba84b23..origin/main`): `SurfaceCardComponent` import and imports entry, `data-testid="thoth-section-memory-diagnostics"`, `surface-2` / `border-surface-border` classes, the `ptah-surface-card` curator block with the compact "Change" button (lines ~144-166), the reformatted `resolvedCuratorModel`, and `manageCurator()` targeting `{ tab: 'orchestration', section: 'background-models' }` (line 350). The merged file is byte-identical to origin/main outside 620's hunks.
- 620 kept: `MEMORY_PAUSED_REASON` import, `pausedNotice` banner (`role="status"`, test id `memory-paused-notice`), Run-now `[disabled]` includes `paused()`, `runNowTitle`, paused hint with `@else if` fallback to the no-session hint, and the PreCompact toggle plus `onPreCompactChange` are gone.
- The Providers-targeted `manageCurator` from 620 was correctly dropped; `'background-models'` is a member of `PendingSettingsTab.section` (`app-state.service.ts:153`) and of `ORCHESTRATION_SECTIONS` (`settings.component.ts:37`), so the deep link routes to Agent Orchestration.
- No orphan imports: `AppStateManager` and `ProvidersSettingsStateService` are still used (lines 337-340, 270); `computed` and `TriggerToggleChange` still used. Standalone, OnPush, `inject()`, signals preserved.

### 2. skill-settings-panel.component.ts — OK
- Merged equals origin/main except 620's changes: the Core "Enabled" checkbox replaced by the `skills-settings-switch-note` paragraph (the Skills header switch owns `enabled`; `skill-synthesis-tab.component.ts:835-842,1041-1042` confirm the form has no `enabled` control and strips it from the save policy).
- Main's removal of the judging-model Providers button, the `skills-lanes-section`, `laneTargets`, `manage()`, the `inject`/`AppStateManager` imports is intact. No resurrected UI; `ChangeDetectionStrategy`, `input`, `output` imports are all still used.

### 3. skill-settings-panel.component.spec.ts — OK
- `AppStateManager` mock/providers removed (no remaining references); main's negative assertions (`skills-lanes-section` null, no "Manage judging model in Providers") retained; 620's `enabled` form control removed from the fixture form and the new "master switch" describe is present and consistent with the component. Test setup is `TestBed.configureTestingModule({ imports: [SkillSettingsPanelComponent] })` with no unneeded providers.

### 4. skills-lane-pickers.e2e.spec.ts — OK
- Main's flow retained: switch to settings view, click "Agent Orchestration", open `background-roles-summary`, assert panel has no picker and no "Manage synthesis in Providers". 620's fixture change (no `preCompact` in `memory:getTriggers`) retained. The fallback `toggleEdit` for the synthesis editor remains valid. Header and test title updated to Agent Orchestration. `SETTINGS_FIXTURE` still carries `enabled: true`, which is the live DTO field, correct.

## Deleted keys (dbfe31d04) — confirmed gone
Searched merged tree for `memory.curatorEnabled`, `memory.triggers.preCompact`, `triggers.preCompact`, `skillSynthesis.triggers.sessionEnd`, DTO `preCompact:` and `onPreCompactChange`: zero code hits in `apps/libs/tools` (only agent-sdk's unrelated PreCompact hook machinery and the live `memory.triggers.sessionEnd` memory trigger remain). `skillSynthesis.curatorEnabled` is a distinct live key and is correctly untouched. Docs (`apps/ptah-docs/.../memory/index.mdx:20`) mention the SDK PreCompact hook as a mechanism, not the removed setting.

## Auto-merged files touched by both sides — no semantic conflicts
- `thoth-runtime.ts` (cli-engine): main's `resolveWorkspaceRoot(container, logger)` (signature verified at `cli-workspace-index.ts:169`) and `guard()` Promise-wrapping coexist with 620's `startSkillTrigger`/`onStarted` ordering. `thoth-runtime.spec.ts` logger mock gained `error` (main) alongside 620 changes. OK.
- `boot-thoth-runtime.ts`: main's degradation-audit comment only; 620 logic intact.
- `memory-curator-tab`, `skill-synthesis-tab`, `thoth-shell` (+ specs), `skill-activity-feed`, `skill-triggers-settings`: main contributes surface/elevation classes and `thoth-section-*` test ids; 620 contributes switch/pause/trigger removal. Disjoint concerns; both present.
- `providers-settings-state.service.spec.ts`: main's `AuthStateService` mock + `refreshAuthStatus` assertion alongside 620's removal of the dead key from fixtures. OK.
- `apps/ptah-electron-e2e/.../skills.spec.ts` equals origin/main (main-only change, retargeted to Agent Orchestration).

## Minor (non-blocking)
1. `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:336-340` comment still describes the old "Manage synthesis in Providers" click path while the assertions (line 405) were updated; this is main's own staleness, not a merge artefact.
2. The curator "Change" button (accordion ~line 160) has no contextual accessible name beyond visible text; inherited from main.

## Must-fix list
None.

## Verdict
APPROVE, confidence HIGH on the four resolved files and the deleted-key sweep; MEDIUM-HIGH on the auto-merged files (read as diffs, not executed). Residual uncertainty: the electron/e2e specs were not run, and the resolution report's verification table was truncated in the lane report at the point I read it (memory-curator-ui typecheck only was visible; the task brief states the other scoped checks passed).
