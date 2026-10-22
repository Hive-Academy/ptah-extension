# Batch 21 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.ts:113`: one 20,000 ms agent-model timeout; `:571-580` forwards the optional source hash; `:714-733` uses the timeout for model read and save.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\services\skill-synthesis-rpc.service.spec.ts:550`: delayed list and exact timeout; `:568` hash forwarding; `:674` drawer emits a draft and displays stale errors.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-model-editor.component.spec.ts:720`: unavailable list clears loading; `:734` stale workspace reply is ignored.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\enhance-preview-drawer.component.ts:68`: save error is displayed alongside the draft; `:189,224` emits the exact draft body and source hash only on explicit Save.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.ts:386,813`: parent receives Save, verifies it is the current draft, calls the guarded RPC save, refreshes and closes on success, and keeps the draft open on refusal.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.spec.ts:579,598`: save success and stale refusal; `:179,975` corrects prior mock typings in this now-owned spec.

## Timeout and write path

- `getAgentModels`: 10,000 ms -> 20,000 ms. `setAgentModel`: 8,000 ms -> 20,000 ms. The server may wait 15,000 ms for model lists; 5,000 ms remains for RPC and save. Other timeouts stay unchanged.
- Agent model editor -> `setAgentModel` -> success/refusal UI. The store's existing revision and workspace ticket guard at `agent-models.store.ts:144-174` discards an old list. Rejected reads set the unavailable state and clear loading.
- `previewEnhancement` -> draft in drawer: no write. Save -> drawer emits `draft.after` and `draft.sourceHash` -> parent validates against the current preview -> `saveCloneBody(kind, slug, body, expectedSourceHash)` -> backend hash guard. Success closes, refreshes clones, and refreshes open detail. Stale refusal shows the backend's preview-again message while retaining the draft. No path from this drawer calls `applyProposal`; its facade remains for batch 58.

## UI and WRITE-PATH flags

- UI: the drawer presents the draft and enables Save only when it exists. Model-list failure and workspace-switch behavior are covered.
- WRITE-PATH: only the explicit Save uses the hash-protected clone write. The parent owns refresh, close, and stale error state. The existing model editor continues using `setAgentModel`.

## Verification

- Scoped `ptah_get_diagnostics`: no errors in changed files; 10 existing errors remain in sibling files outside this batch.
- Tests, typecheck, lint, build, and Nx/Jest commands were not run per executor instruction.

## Decisions

- Keep the existing agent-model store/editor implementation and add regressions. Its workspace ticket, revision guard, unavailable message, and save/refusal state already meet the behavior. Alternative: replace the store/editor flow. Evidence: `agent-models.store.ts:144-174`, `agent-model-editor.component.ts:416-435,679-756`. Reversible: yes.
- Orchestrator decision O14 grants ownership of the parent view and spec. Move the explicit save to the parent, using the drawer only to emit the reviewed body and hash. Alternative: save in the drawer and separately coordinate parent refresh. Evidence: parent already owns `previewApplying`, `previewError`, clone refresh, detail refresh, and close at `skill-clones-view.component.ts:813-838`; shared RPC accepts `expectedSourceHash`. Reversible: yes.
## Fix round 1

- Defect: the unrelated listCandidates test passed status: 'candidate' while expecting status: 'pending'. Restored its original call in services/skill-synthesis-rpc.service.spec.ts:47; the RPC expectation is unchanged.
- Defect: drawer component tests were in the RPC service spec. Moved both cases to components/clones/enhance-preview-drawer.component.spec.ts:1-75, using standalone component TestBed setup. Removed the drawer import and cases from services/skill-synthesis-rpc.service.spec.ts:10,674; service-level timeout and guarded-save tests remain there.
- Verification: tests, Nx, Jest, typecheck commands, and lint were not run per fix-round instruction. Scoped ptah diagnostics found no error in the new drawer spec; the restored pending call has TS2322 because the current listCandidates type excludes pending. The caller explicitly requested this exact restoration, so the contract mismatch remains for the orchestrator. Both edited specs use LF line endings.
