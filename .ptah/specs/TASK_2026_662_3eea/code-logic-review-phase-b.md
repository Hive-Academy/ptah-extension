# Code Logic Review, Phase B - TASK_2026_662 (batches 16-24)

Review family: Claude (Sonnet 5.5). Implementers were codex CLI lanes; batch 16 and the first pass of batch 19 were Glm, per batches.md.
Diff reviewed: `git diff dc10d73b2..HEAD` over `libs/` and `apps/` (25 non-spec source files read in full or in context). Specs were not run (orchestrator owns checks).

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 4 |
| Moderate | 5 |
| Minor | 4 |

Score rationale: the settings round trips (pause, telemetry, enhancement) are correctly built (write, then read back, rollback, stale-read guards) and the nullable-grade display is coherent. The score is held at 6 because three of the four Serious findings are write paths whose persisted value does not reach the runtime reader, or a capability lost by the switch, and the fourth silently changes the meaning of a shipped RPC. None corrupts data, so nothing is Blocking. A 7-8 would need S1-S4 closed.

## Write-path trace (persisted writes to runtime readers)

| Writer | Key / scope / format | Runtime reader | Result |
| --- | --- | --- | --- |
| Providers row, provider (`providers-commit.service.ts:135-153`) | `skills.enhancement.provider`, global profile settings.json, string, `''` = follows main | `skill-enhancer.service.ts:873-877` | OK |
| Providers row, model | `skills.enhancement.model`, `''` persisted as `'inherit'` (commit `:136-139`) | `skill-enhancer.service.ts:879-891` maps `'inherit'` back to `''` | OK |
| Providers timeout editor (`provider-consumer-assignments.component.ts:843-851`) | `skills.enhancement.timeoutMs`, ms number, UI bound 15-600 s | enhancer `:861-871`, clamped to `ENHANCE_TIMEOUT_MIN/MAX_MS` | OK. The bound is duplicated, see M1 |
| Providers row, scope metadata | none: the keys are absent from `SCOPED_SETTING_KEYS` | `state.scopeEntry()` returns null | Wrong badge, see S3 |
| Library pause switch (`skill-synthesis-state.service.ts:448-469`) | `skillSynthesis.enabled`, boolean, via `settings:set` | enhancer guard, handler `assertSkillsNotPaused` | OK. Same `workspaceProvider.setConfiguration('ptah', ...)` as the old `updateSettings({enabled})` path |
| Library telemetry toggle (`:532-552`) | `skills.telemetry.enabled`, boolean | NOT read by anything at runtime | Inert, see S1 |
| Dashboard tile (`thoth-status.service.ts:380-391`) | reads `skills.telemetry.enabled` | n/a | Displays a setting that has no effect, see S1 |
| Enhance draft save (`skill-clones-view.component.ts:813-838`) | `skillSynthesis:saveCloneBody` + `expectedSourceHash` | `mirror.saveCloneBody` (`user-layer-mirror.service.ts:665-720`) | Writes the body; drops `markEnhanced` and repropagation, see S2 |
| Rate reads | `skill_task_grades` via `SkillScorecardService.getInvocationStats` | `toCloneSummary` (`skills-synthesis-rpc.handlers.ts:2334`) | OK for the list; `invocationStats` RPC regresses, see S4 |

## Five logic questions

1. **Silent failure.** The Library telemetry toggle and the dashboard "Skills: On/Off" tile report success and a persisted value while recording behaviour is unchanged (S1). The explicit Save of an enhancement draft reports "Enhanced" while the harness and registry bookkeeping an enhancement used to do never ran (S2).
2. **Unexpected user action.** Turning telemetry Off and seeing the tile read Off while skill-use events keep being written. Saving an enhancement and finding the harness copy unchanged. Opening Providers and seeing "Mixed sources" on the Enhancement row on every load (S3). Changing the Enhancement provider while the old lane pipeline still runs: the pipeline's judge lane still reads the old `skillSynthesis.judge*` keys, so the change does not reach it (transitional, N1).
3. **Wrong answer, not error.** `skillSynthesis:invocationStats` now returns the graded-task count as `total` (S4). A skill's `invocationCount` and an agent's with the same slug are merged because `getUsageStats` filters on `skill_slug` only (M3).
4. **Dependency failure.** `settings:get` failure on the three enhancement keys puts the whole Enhancement section in error, with Retry (OK, `providers-settings-state.service.ts:667-693`). The scorecard being absent degrades to null rates (OK, O12a). A thrown DB error inside `toCloneSummary` fails the whole Library list (M2). Telemetry read failure disables the toggle until the tab is reopened (m2).
5. **Missing, never specified.** A scope registry entry for the new keys (S3). A repropagation step on the new save path (S2). A guard that keeps the reader and writer of one setting switching in the same phase (S1). Validation of `skills.enhancement.timeoutMs` on the server (M1).

## Serious

### S1. Telemetry toggle writes `skills.telemetry.enabled`; the only runtime reader still reads the old key
- Files: writer `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts:540` and tile `libs/frontend/dashboard/src/lib/services/thoth-status.service.ts:380-391`. Reader `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:1098-1104` using `skill-trigger-config.ts:50-52` = `skillSynthesis.triggers.skillInvocationTelemetry.enabled`. Switching it is scheduled in batch 44 (batches.md:1402), which is Phase C and not yet done.
- Scenario: a user turns "Skill telemetry" off in the Library. `settings:set` succeeds, read-back returns `false`, the dashboard tile shows Off. `readSkillInvocationTelemetryEnabled()` still returns the old key's value (default true), so every skill use is still recorded. The migration (`file-settings-manager.ts:47-55`) copies old to new once, only when the new key is absent; nothing syncs in the other direction.
- Impact: a privacy-relevant control that does nothing, with a UI that confirms it worked. Any other writer of the old key (the Advanced settings descriptor, if present) now diverges from what the Library shows.
- Fix: either switch `readSkillInvocationTelemetryEnabled` to read `skills.telemetry.enabled` now (a one-line reader change with a fallback to the old key while it is present), or make the Library write both keys until batch 44 lands. Add a spec that asserts the writer's key is the reader's key. Do not ship the branch with Phase B and without batch 44.

### S2. Explicit save of an enhancement drops `markEnhanced` and harness repropagation
- Files: `skill-clones-view.component.ts:813-838` (new) against `skill-enhancer.service.ts:603-633` (old `applyProposal`) and `skills-synthesis-rpc.handlers.ts:1469-1499` plus `user-layer-mirror.service.ts:665-720` (new).
- Scenario: user previews and clicks Save. The old path called `registry.markEnhanced(kind, slug, now, currentContentHash)` and `repropagate(slug, kind, origin)`. The new path calls `mirror.saveCloneBody`, which writes the body, snapshots history and updates `currentContentHash` only in the sidecar. The registry row's `last_enhanced_at` is not stamped, so `CloneSummary.lastEnhancedAt` and `enhanceCooldownUntil` (`handlers.ts:2352-2359`) stay stale. Repropagation (the harness FS and plugin delivery copy) is not triggered, so chats keep using the previous body until some later reconcile.
- Impact: "Enhanced" toast, but the enhanced skill is not what the harness delivers; the card shows "never enhanced" and no cooldown. The plan keeps the repropagation token and port as a preserved capability (implementation-plan.md:53), and this path no longer exercises it.
- Fix: in the `saveCloneBody` handler, accept an `origin: 'enhancement'` flag (or add an `applyDraft` RPC) that, after a committed write, calls `registry.markEnhanced` with the new content hash and the repropagation port with `userInitiated: true`. If a user manual edit should also repropagate, say so in decisions.md. Add a handler spec for it.

### S3. New `skills.enhancement.*` keys have no scope registry entry
- Files: `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:498-526` (`SCOPED_SETTING_KEYS` lists only the old `skillSynthesis.judgeModel/judgeProvider/enhanceTimeoutMs`); consumers `provider-consumer-rows.ts:166-200,253-254` and `provider-consumer-assignments.component.ts:636-645`; `providers-settings-state.service.ts:147-149,865-872` (`scopeKeys` is derived from `SCOPED_SETTING_KEYS`, so the new keys are never requested).
- Scenario: `scopeEntry('skills.enhancement.provider')` is always null, so `makeRow` sets both scopes to `'mixed'` and `scopeShown = true` for the Enhancement row on every load, and the timeout row shows "mixed" (`:638-640`). Before the batch the same row showed the real source (global). The cleanup batch (batches.md:1810, rpc-auth.types `:482-522`) removes the old entries and nothing adds the new ones.
- Impact: a permanent, wrong "Mixed sources" badge on the new row, and `writeScopes()` returns `[]` for these keys.
- Fix: add the three keys with `appScopable: false, supportedTargets: ['global']` to `SCOPED_SETTING_KEYS`, and carry them in the batch 65 cleanup list so they are not deleted with the old ones. Add a state spec that `scopeEntry` returns a global entry for each.

### S4. `skillSynthesis:invocationStats` changes meaning, hard-codes `kind: 'skill'`, and breaks the Electron telemetry e2e
- Files: `skills-synthesis-rpc.handlers.ts:1778-1786`; consumer `apps/ptah-electron-e2e/src/specs/thoth/skill-telemetry.spec.ts:77,125-130` through `apps/ptah-electron-e2e/src/support/skill-telemetry-db.ts:62-78`.
- Scenario: the handler used to return event counts (`total` = telemetry rows). It now returns `total = graded task count` for `('skill', slug)`. The e2e smoke records a real /caveman invocation and asserts `afterTotal > baselineTotal`; graded counts do not move on a tool-use event, so the assertion cannot pass. Any caller passing an agent or command slug also gets zeros, because the params schema (`rpc-schema:495-497`) carries no `kind`, while `toCloneSummary` uses the row's real kind.
- Impact: the only test of the telemetry read path fails (Windows-only, provider-backed, so the orchestrator's scoped Jest gate will not see it). The RPC now reports a different quantity under the same field names.
- Fix: return `total: invocationCount` (telemetry) and add the graded figures as new fields, or keep `total` as use count. If the intent is to retire the method, say so in decisions.md and update the e2e support in the same batch. Pass `kind` or resolve it from the registry row.

## Moderate

- **M1. Timeout bounds duplicated in the UI; no server-side validation.** `provider-consumer-assignments.component.ts:64-66` hard-codes 15 / 600 / 120 while the doc comment at `:622-626` still says the backend owns the bound ("the UI never invents the range"). They match `file-settings-keys.ts:494-496` today. `settings:set` only value-checks keys with an `ADVANCED_SETTINGS` descriptor (`settings-rpc.handlers.ts:195-203`) and none exists for the new key, so any client can store `5` or `"abc"`; the enhancer clamps and type-checks at read (`skill-enhancer.service.ts:861-871`), which hides it. Import the constants from a shared location or add a descriptor.
- **M2. One failing stats query fails the whole Library list.** `toCloneSummary` (`handlers.ts:2334`) calls `scorecard.getInvocationStats` with no guard. A DB error or Zod parse failure in `getUsageStats` (`skill-invocation-event.store.ts:84-91`) rejects `listClones`. `getScorecards` guards the same kind of read with try/catch and a warning. Degrade to zero counts and a null rate with a warn log, as O12a does for the absent scorecard.
- **M3. Usage stats ignore `kind`.** `getUsageStats(slug)` counts by `skill_slug` only (`:84-91`) while grades are keyed by `(kind, slug)`. A skill and an agent with the same slug share one invocation count but not one grade. O12 accepted this as parity; with grades now kind-scoped the mismatch can show "used, No grade" for one kind and a rate for the other. Low likelihood.
- **M4. Agent card hides outcome signals when the agent has no telemetry or grade.** `clone-card.component.ts:~490-500` and `clone-detail-drawer.component.ts:~608-620` only append `formatAgentOutcomeSignals` when `invocationCount > 0 || successRate !== null`. Before, agent cards always showed outcome signals ("no data yet"). An agent with spec-review outcome signals but no telemetry row would now show the "unused" sentence. Confirm against `outcomeSignals` sources, or keep the old always-on agent row.
- **M5. Save success is dropped when the preview moves on mid-save.** `skill-clones-view.component.ts:822`: `if (this.previewClone() !== c || this.previewResult() !== preview) return;` runs after a committed write and skips the toast and `refreshClones()`. `onDiscardPreview` blocks discard while applying, so this is only reachable through a new preview or a clone switch, but the list then stays stale after a real write. Refresh unconditionally; keep the guard only for the toast and `closePreview`.

## Minor

- **m1. Pause help text contradicts the contract.** `skills-pause-switch.component.ts` template: "Pausing stops capture, background processing and manual runs", while the plan (implementation-plan.md:44, :125) says telemetry and harvest bypass pause and the telemetry card says "Records skill use even while Skills is paused." Reword to manual enhancement only.
- **m2. Telemetry toggle has no recovery path.** `refreshTelemetryEnabled` runs only in `ngOnInit` (`skill-synthesis-tab.component.ts:~1030`), not on focus like the pause switch. A failed first read leaves the toggle disabled (`[disabled]="... telemetryEnabled() === null"`) with an alert and no retry.
- **m3. Read-back mismatch is not reported.** In `setSkillsEnabled` and `setTelemetryEnabled`, a write that returns success but reads back a different value (another writer won) silently adopts the host value with no message (`state.service:457-459,541-543`).
- **m4. "No grade" styling keys on a display string.** `[class.text-base-content-muted]="m.value === 'No grade'"` (card, drawer). Export a constant from `clone-action-gating.ts` and compare against it.

## Notes (not findings)

- **N1.** The old pipeline's judge lane (`lane-resolver.service.ts`, `model-resolver.ts`, `skill-synthesis.service.ts:1627`) still reads `skillSynthesis.judge*`; the Providers row and `updateSettings` now write the new keys first (`handlers.ts:635-667` dual-writes for the legacy form, so that path is fine). The Providers row alone does not reach the lane. Transitional and acceptable only while those lanes are removed in Phase C/D.
- **N2.** `ProvidersSettingsStateService.sectionsReady` (`:~991-1001`) still requires `lanes()` and `judging()` to be ready, so a failure of the legacy `getLanes`/`getSettings` blocks the page's ready state even though no row shows them. Clear when batch 53 removes those slices.
- **N3.** `applyProposal` stays registered and unused by the UI (O14); the in-memory proposal cache from `generateProposal` still fills up to its cap and expires. Fine until batch 58.

## Preserve-list check

| Capability | Status |
| --- | --- |
| Pause switch (write, read-back, rollback, `PAUSED` refusal handling) | Preserved (`state.service:448-478`) |
| Telemetry control and dashboard On/Off tile | Present but inert (S1) |
| Enhancement provider/model/timeout editing with Undo | Preserved; scope badge wrong (S3) |
| Enhance preview, review before write, stale-source refusal keeps the draft open | Preserved (`skill-clones-view.component.ts:813-838`; `isStaleSource` hash matches `skill-enhancer.service.ts:483`) |
| Enhance writes registry and repropagates | Lost (S2) |
| Model list slow/unavailable handling, UI timeout 20 s over the 15 s server race | Preserved (`skill-synthesis-rpc.service.ts:~106-113`, `handlers.ts:279,2484`); `setAgentModel` also gets 20 s |
| Rate from `skill_task_grades`, null when ungraded; 0% shown as 0% | Preserved (`scorecard.service getInvocationStats`, `formatSuccessRate`); `Math.round(0*100)` renders `0%` |
| O15 display rule (unused+ungraded one sentence, used+ungraded "No grade", graded rate) | Implemented in card and drawer; agent variant see M4 |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Enhancement keys never written | YES | defaults `''`, `'inherit'`, 120000 (`file-settings-keys.ts:612-614`) | none |
| Old keys present, new absent | YES | one-time migration in `loadSync` | Persist failure is warned and swallowed (`file-settings-manager.ts:541-549`); next load retries |
| Hand-edited non-string provider | YES | section error with Retry | none |
| Write refused with a range message | PARTIAL | `commit` returns `success` only, so the descriptor message is lost | m3-like, UI shows fixed sentence |
| Save while stale | YES | `INVALID_PARAMS` message, drawer and draft kept | none |
| Save after preview moved on | PARTIAL | M5 |  |
| Scorecard absent | YES | O12a | none |
| Rate 0 of N graded | YES | `0%` | none |
| Telemetry off | NO | inert | S1 |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1 and S3 (direct grep of reader and registry), HIGH on S4 (the e2e asserts on `total`), MEDIUM-HIGH on S2 (behavioural comparison of two code paths; repropagation might be deliberately dropped, which would then need a decision record).
- Top risk: the telemetry control looks like it works and does nothing until batch 44.
- A robust implementation would add: a spec that pins each settings writer key to its runtime reader key; scope registry entries for the three new keys; a registry stamp and repropagation on the draft save; an `invocationStats` that keeps its telemetry meaning; and a guard around the per-row stats read.
