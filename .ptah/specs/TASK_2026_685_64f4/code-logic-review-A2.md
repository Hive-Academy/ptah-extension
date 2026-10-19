# Code Logic Review A2 — TASK_2026_685

Review family: Claude (independent of the codex implementer)

Score: 9/10 — APPROVED (no Critical or Serious findings)

## Write-path trace

1. Exit event -> `persistCliSessionReference` (agent-events.ts:333). The `ref` literal (:420-445) now spreads `completedAt` from `info.completedAt` (:428), omitted when falsy, so it is never written as `undefined` or `""`.
2. `info.completedAt` is stamped before `agent:exited` is emitted on both stop and exit (agent-process-manager.service.ts:1946-1962, 2186). Restart clears it (:1852), so a running re-persist carries none. Correct.
3. `metadataStore.addCliSession` (session-metadata-store.ts:1183-1230) replaces the whole slot by `cliSessionId` (:1209). A terminal write therefore overwrites the older reference with the full new literal, which gives "adds it, keeps other fields" as long as the literal is complete. It is.
4. Blob rule (:20-30): the field is one short ISO string and the bulk-field omit list (:251-253, :1196-1250) is stdout/segments/streamEvents only, so `completedAt` stays in the lean blob. Size impact is negligible.
5. Restore: `restoreQuotaOwner` (:381-397) either returns the ref unchanged or spreads `...rest`, so `completedAt` passes through. `getCliSessionsForRestore` (:1144-1148) feeds `session:cli-sessions` (session-rpc.handlers.ts:1039-1055), which returns the refs unfiltered. Older sessions without the field restore unchanged, because the type is optional and nothing reads it as required.
6. Other writers: the only `CliSessionReference` literal is agent-events.ts:420. The call sites (agent-events.ts:186, 212, 228; sdk-callbacks.ts:304) all go through `persistCliSessionReference`. The migrator (session-store-migrator.ts:182-190) spreads `lean`, so it keeps the field. No path drops `completedAt` on a later write.

## Findings

1. Minor — agent-events.spec.ts "adds completion time…" test. The "older reference" is produced by the same code path (a `running` persist), not a legacy-shaped fixture. It proves the new write carries the fields over, but not behaviour against a stored legacy blob. Because `addCliSession` does a whole-slot replace, the risk is low. Optional: add a store-level spec with a legacy ref.
2. Minor — agent-events.spec.ts "omits completion time…" test passes with or without the change. It is a guard only, which is fine.
3. Info — the two positive specs would fail without the change. Test 1 needs `objectContaining({ completedAt })`, and test 2 needs `toEqual` with `completedAt`. I did not run them, per instructions.
4. Info — `restoreAgents` (agent-process-manager.service.ts:~1212) does not read `ref.completedAt`. That is outside A2 and belongs to A1 or a later batch if wanted.

No Critical or Serious issues.
