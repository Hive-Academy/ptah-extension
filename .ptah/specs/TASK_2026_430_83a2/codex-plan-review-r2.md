**REJECT**

Closure below means the **revised design** closes the finding; implementation is not yet present. Evidence was checked read-only. No files were modified or anything under `AppData` accessed.

| #   | Prior finding                           | Closure              | Evidence                                                                                                                                                                                                                       |
| --- | --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Post-publication commit failure         | **PARTIALLY CLOSED** | §§3–4 specify reconciliation and retirement, addressing `worker-runtime.ts:470–482`. However, unpublished generation collisions can permanently prevent subsequent writes; host-cache reconciliation is missing. N2, N8 below. |
| 2   | Partition placement and cursors         | **CLOSED**           | §4 separates partition items from ordinary tag counts and binds cursors to blob generations; §12 resets stale history. These address `worker-runtime.ts:156–173,567–570`.                                                      |
| 3   | Unsafe stdout window selection          | **PARTIALLY CLOSED** | §4 preserves non-contained variants, addressing `agent-process-manager.service.ts:1089–1092`. Its replacement/dedupe rules do not maintain the promised preferred snapshot. Sync replacement also lacks preservation. N4, N7.  |
| 4   | Premature absence and sync restore      | **PARTIALLY CLOSED** | §§7,9 specify three outcomes and sync fallback. But `pendingMaintenance` has no route through the value-only storage port; skipped conversion is also unspecified. N3.                                                         |
| 5   | Main-thread hydration                   | **PARTIALLY CLOSED** | §§4,7 omit inline output before transport. However, §4 permits 4 MiB projected values and §6 reconstructs them using the existing whole-value assembler (`worker-host.ts:549–580`). N10.                                       |
| 6   | Terminating, downgrade-safe maintenance | **PARTIALLY CLOSED** | §4 advances past retained/oversized keys, but its completion watermark can certify keys changed behind a resumed scan. The actual tagged downgrade writer also contradicts the premise. N5–N6.                                 |
| 7   | Structurally oversized writes           | **CLOSED**           | §§4–6 replace whole-item transport with snapshot-operation pages and actual envelope estimation, addressing `worker-host.ts:398–408`. Test 1 includes sub-threshold string leaves.                                             |
| 8   | Worker versus RPC budgets               | **CLOSED**           | §§1,4,7 require both budgets, envelope reservation and suffix accounting; test 9 targets the mismatch at `worker-protocol.ts:575` versus `session-metadata-store.ts:952–958`.                                                  |
| 9   | Nonexistent `materialize-v1`            | **CLOSED**           | Rollback claim explicitly withdrawn and recorded as unmet. Repository search still finds no implementation. The separate downgrade claim remains defective: N5.                                                                |

**N1 — BLOCKER — Projected saves can discard deliberately retained output.**  
**Plan:** §4, lines 293, 304–309; §7, line 420.  
**Code:** [session-metadata-store.ts:482](/D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts:482), [worker-runtime.ts:465](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:465).  
**Scenario:** A missing-ID reference retains its only reachable stdout inline. The projection removes that field. A rename/save submits the projected detail. Normalizing the stored value still cannot migrate this reference; subsequently replacing it with the incoming value discards the retained field. The oversized-destination skip has the same problem. Historical orphan blobs are not a supported recovery path.  
**Fix:** Preserve omitted fields for every unsuccessful conversion, matching retained references by a stable identity, or reject the replacement. Test projected saves after missing-ID and oversized skips, including duplicate/missing identities.

**N2 — MAJOR — The collision guard permanently strands writes after pre-publication failure.**  
**Plan:** §§3–4, lines 222–257.  
**Code:** [commit-store.ts:286](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts:286), `:305,335–359`; existing fault points in `electron-state-storage-commit-store.spec.ts:10–22`.  
**Scenario:** Generation N+1’s manifest is published, then failure occurs before replacing `CURRENT`. Reconciliation correctly adopts N. Every retry selects N+1 and hits `generation-exists`; restarting does not help. A published orphan blob can similarly block the new no-overwrite publication even without a manifest.  
**Fix:** Allocate a fresh generation beyond occupied manifest **and blob** generations while retaining `previousGeneration = N`. Test another successful mutation after **every** pre-publication fault, both on the same runtime and after restart. Merely asserting that a collision is refused is insufficient.

**N3 — MAJOR — `pendingMaintenance` cannot reach the proposed stdout reader.**  
**Plan:** §1 line 141; §§5–7 lines 350–351, 373–377, 442–445.  
**Code:** [async-state-storage.interface.ts:40](/D:/projects/ptah-extension/libs/backend/platform-core/src/interfaces/async-state-storage.interface.ts:40), [worker-host.ts:207](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts:207), `electron-state-storage.ts:117–118`.  
**Scenario:** Conversion fails and the worker successfully returns projected data with `pendingMaintenance`. The proposed port still returns only `T | undefined`, and the host unwraps the value. `readAgentStdout` cannot inspect the flag and can memoize `absent`. Successful-but-skipped oversized conversion likewise has no defined pending outcome.  
**Fix:** Specify an explicit result-bearing read capability, or a typed pending signal consumed by the domain reader. Carry it through scalar paging and the workspace adapter. Test the full worker→adapter→reader→memoization path, including skips.

**N4 — MAJOR — Dedupe does not preserve “last item = latest snapshot.”**  
**Plan:** §4 lines 298–303; §§7,12 tail/last-item readers.  
**Code:** [agent-process-manager.service.ts:1089](/D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1089); existing tag merge at `worker-runtime.ts:156–173`.  
**Scenario:** Existing variants are `[A, B]`. Incoming C contains A but differs from B. “Replace in place” yields `[C, B]`; readers return B. Incoming A identical to an earlier variant is skipped and also leaves B preferred. Re-merging an older inline reference can conversely promote stale content.  
**Fix:** Define preference independently from content retention, with explicit precedence between live saves and historical migration. Test `[A,B] + A`, `[A,B] + containing(A)`, and migration after a newer live save. Cut containment compaction if it complicates this guarantee.

**N5 — MAJOR — The downgrade premise does not match the repository’s v0.1.70 tag.**  
**Plan:** §4 lines 317–318; rollback section; test 8.  
**Code:** At **`electron-v0.1.70`**, `electron-state-storage.ts:55–58,64–73` reads/writes the legacy JSON file; its tree contains no worker/commit-store implementation. `session-metadata-store.ts:518–526` expects the legacy array.  
**Scenario:** The tagged release changes v1, so no v2 blob generation advances. Upgrading again cannot discover those edits through the proposed generation filter. The test using today’s runtime without maintenance plans does not simulate that release.  
**Fix:** Identify the exact shipped artifact/commit and test its actual storage behavior. Remove the v0.1.70 compatibility assertion unless proven; explicitly specify treatment of intervening v1 edits. **Installed binary provenance remains unverified**, since accessing the installed profile was prohibited.

**N6 — MAJOR — A resumed scan can permanently skip intervening writes.**  
**Plan:** §4 lines 310–317.  
**Code:** `worker-runtime.ts:252–254` permits raw updates; [commit-store.ts:314](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-commit-store.ts:314) records each changed blob’s generation.  
**Scenario:** Sweep checkpoints after key M and stops. A maintenance-unaware writer changes earlier key A. On upgrade, scanning resumes after M, then records the completion generation. A’s change is older than that watermark, so subsequent revalidation excludes it forever. This requires no simultaneous processes.  
**Fix:** Capture a scan-start generation and certify only that boundary; perform a subsequent change pass. Alternatively restart incomplete scans after process restart. Add this interrupted-sweep→old-write→resume test.

**N7 — MAJOR — Sync live saves can erase migrated stdout variants.**  
**Plan:** §7 lines 425–448.  
**Code:** [session-metadata-store.ts:787](/D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts:787), `:807–808`.  
**Scenario:** Sync migration preserves historical stdout in `PersistedAgentOutput.segments`. A later `saveAgentOutput` builds a fresh record and overwrites it. The plan assigns carry-over to the worker, which sync adapters do not have; invoking the shared merge only from `migrateRefOutput` does not close this path.  
**Fix:** Apply the preservation merge to sync destination writes too, serialized with migration. Test migration followed by repeated live saves.

**N8 — MAJOR — Reconciliation leaves the host cache stale after a landed commit.**  
**Plan:** §4 lines 256–257; §6 lines 374,382–385.  
**Code:** [worker-host.ts:215](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts:215), `:229–234`.  
**Scenario:** An index write publishes, then reports `commit-failed`. Runtime reconciliation adopts it, but the host throws before updating its cache. The new cache-hit read returns the old index indefinitely; a later read-modify-write can overwrite the durable update.  
**Fix:** Invalidate affected host cache entries before surfacing any uncertain commit outcome, and explicitly refresh or bypass them. Add a host-level landed-index-write failure test; runtime-only testing misses this.

**N9 — MAJOR — Cursor pinning defeats the stated memory bound.**  
**Plan:** §4 lines 265–267; scalar cursors at line 276.  
**Code:** [worker-runtime.ts:491](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:491), `:511,543`: existing cursor state is removed only on completion.  
**Scenario:** Abandoned or stale scalar reads leave pinned entries. The plan defines no cancellation, expiry, cursor-count limit or aggregate pinned-byte limit. Repeated incomplete reads can exceed the 32 MiB LRU indefinitely.  
**Fix / simplification:** Remove pinning where generation validation plus rereading suffices. Otherwise specify explicit release, expiry and a hard aggregate quota; test abandonment and stale-read restarts.

**N10 — MAJOR — The 256 KiB main-thread guarantee remains unenforced.**  
**Plan:** Architecture decision line 91 versus §4 line 275 and §6 line 375.  
**Code:** [worker-host.ts:561](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts:561), `:574–580`.  
**Scenario:** A detail containing 1 MiB of non-omitted metadata fits the proposed 4 MiB ceiling and is fully reconstructed on main. Individual messages remain bounded, but the claimed hydration guarantee fails. The single real-shape fixture does not establish a general bound.  
**Fix:** Define and enforce the total returned-detail budget, using bounded domain projections or separately paged fields. Add an adversarial non-output metadata fixture. If 4 MiB hydration is intentional, explicitly revise the guarantee.

**N11 — MINOR — Handoff dependencies and verification gates are incomplete.**  
**Plan:** §7 line 465; handoff lines 704,716,722–725.  
**Code:** The replacement for `worker-runtime.ts:132–175` needs `tagged-sequence-merge.ts`, but that helper is assigned to component 7, after runtime component 4. Component 8 is both folded into 7 and scheduled before it.  
**Scenario:** Following the handoff requires temporary duplicate merging code or breaks intermediate compilation; the current test list also omits the counterexamples above.  
**Fix:** Move the shared merge and its tests into component 1; give shared types one explicit early owner. Gate integration on the full failure-path tests above and review component 7’s sync preservation alongside worker durability.
