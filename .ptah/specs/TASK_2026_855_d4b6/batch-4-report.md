# Batch 4 report — TASK_2026_855_d4b6

## Changed paths

- `libs/shared/src/lib/types/ai-provider.types.ts` — optional internal `AISessionConfig.pluginConfigAncestorRoots`.
- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — durable metadata field, field-state reader, preservation and legacy-upgrade write, migration summary projection.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — SDK-ID bind and resume/relaunch lineage forwarding.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` — removed the temporary intersection cast on the assigned lines.

`session-lifecycle-manager.ts` was inspected and not changed: `executeQuery` passes the config object directly, and `executeSlashCommandQuery` passes `config.sessionConfig` directly to the executor.

## Behavior and Batch 5 API

The field holds ordered governing root identity strings, nearest ancestor first, without policy values. `SessionMetadataStore.create(..., providerId?, pluginConfigAncestorRoots?)` persists supplied roots when the SDK reports the real session ID. A repeated create keeps the existing row's lineage; `_saveInternal` also protects it from later generic saves. The only update to an existing legacy row is `upgradeLegacyPluginConfigAncestorRoots(sessionId, roots)`, serialized through the store's write queue. It writes only when the field is absent and returns the resulting typed state. Existing valid or malformed data is never overwritten.

Batch 5 can call `SessionMetadataStore.readPluginConfigAncestorRoots(metadata)` on the result of `sessionMetadataStore.get(id)`. Its result has `status: 'missing'`, `'legacy'`, `'malformed'`, or `'valid'` with `roots`. Absent is legacy; `[]` is valid and explicitly independent; non-array, non-string, or empty-string entries are malformed. The store validates array shape. Batch 5 owns deriving `[source execution root, ...source saved ancestors]`, root identity/authorization/availability validation, and the decision to call the legacy upgrade after successful activation. It must reject malformed data rather than treat it as empty.

`sessionIndexEntry` and `toSessionRecordInput` spread the record into summary/detail. The split-array migration has an explicit summary-field list, now including lineage. On resume after a fresh runtime, the adapter reads the real SDK ID's metadata, places stored roots on `sessionConfig`, and passes it to `SessionLifecycleManager.executeQuery` → `SessionQueryExecutor.executeQuery` → `resolveCapabilityPolicy`. Slash-command re-query follows the same stored read and facade forwarding. Stored valid roots override caller roots; malformed stored roots refuse resume/relaunch. For legacy or missing metadata, validated caller roots remain available for Batch 5's recovery path. An already live query is reused unchanged.

Batch 5's new lineage specs should cover new bind and repeated bind, generic-save preservation, absent/empty/malformed reads, summary/detail and split migration round trips, explicit legacy upgrade, fresh-runtime resume and slash-command relaunch, and stored-over-caller precedence. Existing specs were kept unchanged.

## Decisions

- **Decision:** keep the field on the existing metadata record and use a typed state reader. **Options:** add another registry or use the existing store. **Evidence:** the approved plan assigns the existing record owner; its projections spread metadata while migration has one enumerated summary list. **Reversible:** yes, within the metadata schema and migration recipe.
- **Decision:** expose the reader as a static method on the exported `SessionMetadataStore` class. **Options:** export a new public barrel symbol or use a class method. **Evidence:** Batch 5 imports the class through the agent SDK entry point, while the free helper is not in that barrel and the barrel is outside this batch's edit scope. **Reversible:** yes.
- **Decision:** preserve the old adapter call shape and slash config identity when roots are absent. **Options:** always pass a seventh `undefined` argument and clone config, or conditionally add roots. **Evidence:** existing adapter specs assert six metadata arguments and the ambient slash config object identity. **Reversible:** yes.

## Verification

- `npx prettier --write` on all four changed source files: exit 0; final follow-up formatting on changed adapter and store files: exit 0.
- `ptah_get_diagnostics` scoped to four changed files: unavailable on all three attempts (including after the final edit) after 45-second TypeScript check timeouts; no clean result claimed. The scoped Nx typechecks below passed.
- Initial `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk`: exit 1; `NX   6 tasks: 5 succeeded, 1 failed`. The existing adapter spec failed on an extra `undefined` create argument and a cloned config without lineage. Both were corrected in the adapter.
- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns=sdk-agent-adapter.spec.ts`: exit 0; `NX   1 task: 1 succeeded`.
- Corrected `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk`: exit 0; `NX   6 tasks: 6 succeeded, 3 cached`. A final static read method was added afterward for the Batch 5 public API.
- `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode`: exit 0; `NX   50 tasks: 50 succeeded, 2 cached`.
- Final `npm run verify -- -p @ptah-extension/shared,@ptah-extension/agent-sdk` after the read API addition: exit 0; `NX   6 tasks: 6 succeeded, 3 cached`.

## Blockers

No source blocker. Root capture and authorization are assigned to Batches 5/6. No skill-loading tool was available to this lane, so no optional skill was applied. No Git operation was run.
