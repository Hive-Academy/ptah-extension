# Batch 41i code logic review

**Verdict: NEEDS_REVISION. Score: 7/10.** The host write/read path is sound for a valid selection, but the newly writable generic RPC key accepts malformed selections and reports a successful save. This is a moderate gap. The 7 band reflects a working core path with one user-visible entry-point defect; it does not reach 8 because the RPC result can contradict the effective routing state, and it does not fall to 5–6 because `getSelection` safely falls back to unset.

## Findings

### Moderate — generic settings save reports success for an unusable selection

`settings:set` admits this key because it is now file-based (`libs/backend/platform-core/src/file-settings-keys.ts:216-219`). Its payload schema accepts an unknown value (`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.schema.ts:21-24`), and the handler validates values only when `findAdvancedSetting` finds a descriptor, then returns `{ success: true }` after the write (`libs/backend/rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:153-180`). A caller can submit `{ key: 'agentOrchestration.decisionModel', value: { kind: 'ollama', model: '' } }`; the RPC reports success and the file manager persists that object (`libs/backend/platform-core/src/file-settings-manager.ts:122-136,581-594`). `DecisionModelConfig.getSelection` then fails schema parsing and returns `{ kind: 'unset' }` with a warning (`libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:129-145`). The UI or automation that trusted the successful save sees a different effective route. Validate this key against `DecisionModelSelectionSchema` before `settings:set` reports success, or exclude it from that generic writer.

## Five logic questions

1. **Silent success:** The malformed `settings:set` case above persists and returns success while effective selection becomes unset (`settings-rpc.handlers.ts:165-180`; `decision-model.config.ts:137-145`). A warning is logged on read, but the save response itself does not reveal the mismatch.
2. **User action:** A caller using generic `settings:set` for the new allow-listed key can supply an invalid selection and get that mismatch. The dedicated `setSelection` path validates before writing (`decision-model.config.ts:153-167`).
3. **Wrong input answer:** For valid `{ kind: 'ollama', model: 'tev1' }`, the whole object survives a fresh manager (`file-settings-manager.ts:665-685`; `file-settings-manager.spec.ts:243-260`). A malformed object safely reads as unset, not as a selected model (`decision-model.config.ts:137-145`).
4. **Dependency failure or malformed return:** File persistence rejects on failure and restores the prior cached value (`file-settings-manager.ts:137-153,581-605`). A malformed persisted selection is handled by the schema fallback (`decision-model.config.ts:137-145`). The new tests do not exercise the three providers or the RPC end to end (`file-settings-manager.spec.ts:243-265`; `file-settings-keys.spec.ts:305-327`).
5. **Unstated case:** A mixed hand-edited `settings.json` containing both a whole `decisionModel` object and a `decisionModel.kind` dotted leaf can produce order-dependent output on a later write: flattening preserves the whole object and separately emits the leaf (`file-settings-manager.ts:672-685`), while unflattening assigns paths in insertion order (`file-settings-manager.ts:704-716`). Normal pre-fix host writes did not create those file leaves, so this is an edge case rather than a separate finding.

## Path trace and verification

- The registry routes the key to file settings and gives it a `null` default (`file-settings-keys.ts:216-219,502-505,547-549`). `getSelection` treats null as unset without warning (`decision-model.config.ts:129-136`). `PtahFileSettingsManager.get` returns the registered null when absent (`file-settings-manager.ts:104-111`).
- VS Code uses file settings on both get and set (`libs/backend/platform-vscode/src/implementations/vscode-workspace-provider.ts:75-84,95-109`). Electron and CLI do the same (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:90-101,212-227`; `libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:84-95,104-119`). Their old host config values would be ignored after switching routes, but `batches.md:2258-2261` records that this feature is unreleased and migration is unnecessary.
- The writer nests the dotted key into JSON and a new manager flattens that nested object as one value (`file-settings-manager.ts:513-517,581-594,665-685,699-716`). Other keys still recurse because the exception is exact (`file-settings-manager.ts:677-685`). In-process listeners fire for the exact key after a successful set (`file-settings-manager.ts:155-157,175-185`); cross-process reload diffs and fires the whole key (`file-settings-manager.ts:465-504`). A listener registered only on `.kind` will not fire for a normal whole-object update.
- The new registry spec fails without the file-based addition, and the fresh-manager round-trip spec fails without the flatten exception (`file-settings-keys.spec.ts:305-327`; `file-settings-manager.spec.ts:243-265`). They do not pin a real provider or generic RPC path.
- Scoped verification: platform-core diagnostics reported 0 errors and 0 warnings. The requested Jest command passed 2 suites and 329 tests. No build, e2e, or other project test was run. Manual VS Code save/restart was not performed.

## Decisions

- Treat legacy Electron/CLI host config as out of migration scope. Options were migration or file-only routing; the batch decision explicitly says the feature is unreleased (`batches.md:2258-2261`). Reversible: yes.
- Treat mixed whole-object and dotted-leaf input as an edge case, not a release blocker. It requires a hand-edited file under this commit (`file-settings-keys.ts:216-219`; `file-settings-manager.ts:672-685,704-716`). Reversible: yes.
