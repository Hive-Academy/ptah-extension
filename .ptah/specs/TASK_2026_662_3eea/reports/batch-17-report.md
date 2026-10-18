# Batch 17 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.ts:18`: two provider consumer IDs, Enhancement row, new setting keys and enhancement save patch (:221-272).
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\provider-consumer-rows.spec.ts:23`: row order, scope keys, inherit sentinel, loaded state and readiness checks.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.ts:348`: Enhancement timeout presentation, enhancement state (:628-669), retry (:778-782), timeout patch and Undo (:811-851).
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\provider-consumer-assignments.component.spec.ts:305`: UI row and decision card, provider/model assignment, retry, timeout, Undo, validation and refused write cases.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\connection-usage.ts:23`: Enhancement replaces lane and judging sources in usage attribution (:111) and completeness (:132-139).
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\chat\src\lib\settings\providers\connection-usage.spec.ts:18`: direct and inherited Enhancement usage, incomplete reads, and CLI attribution.

## Write-path trace

Enhancement row provider/model picker → `onDraftChange` → `saveDraft` with `SettingsSaveFeedbackService` Undo → `writeAssignment` → `consumerPatch('enhancement', provider, model)` → `ProvidersSettingsStateService.saveSettings({ enhancement: { provider, model } }, context)` → `ProvidersCommitService` writes each `skills.enhancement.provider` / `.model` via `settings:set` and confirms each with `settings:get` readBack → `refreshEnhancement()` reads the keys with `settings:get` → `buildConsumerRows` reads `enhancement()` and displays the row. An empty picker model is persisted as `inherit` and displayed as an empty picker value.

Enhancement timeout editor → `saveTimeout` with the same Undo service → `writeTimeout` → `saveSettings({ enhancement: { timeoutMs } }, context)` → `settings:set` for `skills.enhancement.timeoutMs` → `settings:get` readBack → `refreshEnhancement()` → displayed effective seconds. The scope badge reads `skills.enhancement.timeoutMs`.

## Preserve check

Provider pick, model pick, timeout edit, validation, failure feedback, and Undo remain on the Enhancement row. Memory curator, decision model, provider readiness, inherited main provider usage, and CLI usage remain. The approved lane rows and Judging & enhancement row were removed. The requested grep has zero hits in the six assigned files; there are no `SkillLane*Dto` imports. Tree-sitter parsed all six files with zero error nodes.

## UI and WRITE-PATH flags

UI: row order is Memory curator, Enhancement, Decision model. The timeout editor renders beneath Enhancement after its state has loaded. Connection usage attributes Enhancement to its explicit or inherited provider.

WRITE-PATH: provider, model and timeout use the Batch 16 enhancement patch. Core commit writes `settings:set` and verifies with `settings:get`; core state reads all three settings into `enhancement()`.

No tests, typecheck, lint, build, or Nx/Jest command was run, per executor rule. A scoped `ptah_get_diagnostics` call returned unavailable after 45 seconds with all six files unchecked. AST parsing and static grep completed.

## Decisions

- **Timeout bounds:** use 15–600 seconds and a 120-second default in the UI because the new enhancement section exposes only the effective timeout. These values match `ENHANCE_TIMEOUT_MIN_MS`, `ENHANCE_TIMEOUT_MAX_MS`, and `ENHANCE_TIMEOUT_DEFAULT_MS` in `libs/backend/platform-core/src/file-settings-keys.ts:494-496`. The old judging response carried the bounds directly. Reversible when the enhancement API exposes bounds.
- **Model sentinel:** normalize empty picker values to `inherit` in the row patch, matching the core commit service's existing normalization and readBack at `libs/frontend/core/src/lib/services/providers-commit.service.ts:134-148`. Reversible.
- **Usage completeness:** require the enhancement source to load before reporting a complete usage map, following the former role source rule. Reversible.

## Proposed Removals

None beyond the approved lane and combined judging row removals.

## Integration dependency

Resolved in Fix round 1: `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:829-845` now passes `enhancementProvider` from `state.enhancement()` to `connectionUsage`. The lanes section remains for Batch 18.

## Fix round 1

- **Focus target mismatch (TS2322, TS2769, TS2677):** `libs/frontend/core/src/lib/services/app-state.service.ts:130-143` now accepts `enhancement` in `PendingSettingsTab.section`. This shared pending-tab union was the actual type boundary at the drawer request; the chat focus-target union already derives from `ProviderConsumerId`. `libs/frontend/chat/src/lib/settings/settings.component.ts:51-57` routes the current background-role targets. The drawer mapping in `libs/frontend/chat/src/lib/settings/providers/connection-drawer/overview-tab.component.ts:329` uses that updated union; its badge comment was updated at :135. Matching deep-link specs were updated in `settings.component.spec.ts:210,277,348`, `ptah-ai/orchestration-settings.component.spec.ts:334,363`, and `providers/connection-drawer/overview-tab.component.spec.ts:22,635`.
- **Usage source mismatch (TS2353):** `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.ts:829-845` passes `enhancementProvider` from `ProvidersSettingsStateService.enhancement()` to `connectionUsage`. The lanes section and other Providers settings behavior remain for Batch 18.
- **Scope decision:** O13a authorized the pending-tab union edit in core. I added `enhancement` so the drawer deep link reaches Settings and Orchestration. The four old lane IDs remain because they are still used in the live routing map at `libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts:14-17` and commit code at `libs/frontend/core/src/lib/services/providers-commit.service.ts:151-154`. `judging-enhancement` remains because active e2e fixtures still reference it at `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:114` and `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:121`; no production use was found. Removing these literals can follow the owners' cleanup. The chat focus-target set excludes all five old IDs.
- **Core spec:** `libs/frontend/core/src/lib/services/app-state.service.spec.ts` has no reference to the changed ID `enhancement`, so it was left unchanged.
- **Verification:** No tests, typecheck, lint, build, Nx, Jest, or diagnostics were run, per executor instruction. A targeted static search found no removed role IDs in the touched chat focus-target and drawer specs.

## Fix round 2

- `libs/frontend/chat/src/lib/settings/providers/providers-settings.component.spec.ts:82,115`: the component's state stub now provides an Enhancement section with neutral provider, model, and 120000 ms timeout values, plus `refreshEnhancement`. This supplies the signal read by `providers-settings.component.ts:831` during connection usage rendering.
- `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts:321-322`: the Enhancement summary assertion now expects the provider ID `anthropic` and model ID `claude-3-5-sonnet` rendered by this fixture.
- **Display decision:** both Memory curator and Enhancement use `makeRow` in `provider-consumer-rows.ts:227-261`. Both summaries call `formatResolvedSummary` at :184, which calls `formatProviderDisplayName` at :160. That lookup returns the raw ID for providers without matching metadata at :56-61. The shared template displays `row.resolvedSummary` at `provider-consumer-assignments.component.ts:194-213`. The observed `anthropic` output is therefore consistent for both rows; no production change was needed. This spec expectation is reversible if provider metadata later adds a display label.
- **Verification:** scoped `ptah_get_diagnostics` reported no diagnostics in either changed spec. It also reported 267 errors in sibling chat files outside this round's ownership. No tests, Nx, Jest, build, lint, or explicit typecheck command was run.

## Fix round 3

- **Defect:** The background roles summary still named the six retired roles, so its list text failed the three-role spec assertion.
- **Change:** `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:149` now displays `Memory curator, enhancement, decision`. The adjacent count already derives from `BACKGROUND_ROLE_IDS.length` at :251; that array contains the three current roles, so the badge renders `3 roles` without a hard-coded count change.
- **Verification:** No checks were run, as instructed.
 
