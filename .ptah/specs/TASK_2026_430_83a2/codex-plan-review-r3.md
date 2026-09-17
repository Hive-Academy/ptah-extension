**APPROVE WITH CHANGES**

Closure means closure in the design, not verified implementation. Review was read-only; no AppData access or tests executed.

| Finding | Closure verdict                                                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1      | **Legitimately retired.** Retaining historical inline output is no longer required; new writes remove bulk.                                                                             |
| N2      | **Closed.** Allocation above occupied manifest and blob generations addresses failed-attempt collisions.                                                                                |
| N3      | **Legitimately retired.** No pending maintenance or deferred stdout hydration remains.                                                                                                  |
| N4      | **Legitimately retired.** No historical variants or preferred-snapshot contract remains.                                                                                                |
| N5      | **Legitimately retired.** The corrected release premise removes the downgrade obligation.                                                                                               |
| N6      | **Legitimately retired.** No resumable sweep or watermark remains.                                                                                                                      |
| N7      | **Legitimately retired.** Sync replacement need not preserve historical variants.                                                                                                       |
| N8      | **Closed.** Refreshing touched cache keys before surfacing failure, or failing closed, addresses stale host state.                                                                      |
| N9      | **Closed for memory.** Stateless cursors remove abandoned-read pinning. Scalar continuation correctness remains deficient below.                                                        |
| N10     | **Partially closed.** The revised 1 MiB ceiling and unbounded index exception are explicit; continuation requests cannot currently preserve the projection that enforces the guarantee. |
| N11     | **Open.** The revised ordering still breaks intermediate compilation.                                                                                                                   |

**R3-1 — MAJOR — Stateless scalar continuation loses its projection.**

- **Plan:** Component 3, “Cursors,” “Projected get,” and “Protocol”; component 4.
- **Evidence:** [worker-runtime.ts:508](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:508) currently preserves the operation iterator; [worker-host.ts:549](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts:549) reconstructs exactly the operations received. Revision 3 removes iterator state, specifies cursor `g<blobGeneration>.<operationOffset>`, and defines `read-scalar-page { key, cursor, maxBytes }` without projection.
- **Failure:** A projected fat dev detail needs multiple messages. Later requests contain neither the omission paths nor a cursor encoding them. Regenerating operations from the raw value changes the operation offsets and can return omitted stdout, produce malformed assembly, or reject a raw value whose projection fits. This affects `chat:resume`, `session:cli-sessions`, and output-page membership checks.
- **Fix:** Carry the projection on every continuation and bind its identity into the cursor. Reapply the projection and ceiling before regenerating operations. Test a multi-page projected fat detail, including LRU eviction between pages and changed-projection rejection.

**R3-2 — MAJOR — The handoff cannot compile batch by batch.**

- **Plan:** Component 1 and team-leader P1–P4 ordering.
- **Evidence:** [session-metadata-store.ts:194](/D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts:194) supplies `'retain-source'`; [worker-protocol.ts:185](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:185) explicitly types the old schema against the port; [worker-protocol.ts:200](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-protocol.ts:200) types the old receipt. [worker-runtime.ts:438](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:438) consumes `loaded.values`.
- **Failure:** P1 replaces required literals and receipt fields while those consumers remain unchanged until components 3–5. Component 2 then removes the initialization result consumed by component 3. Component 3 deletes a request still emitted by component 4. These are compile-breaking transitions, not independent landing batches. Tests importing the not-yet-created worker loop also cannot establish the requested behavioral red result on `main`.
- **Fix:** Make helpers additive first; land breaking contracts with all affected consumers in one atomic batch, or explicitly group components into a single compilation gate. Establish the baseline regression through existing entry points, then move it to the extracted loop.

**R3-3 — MINOR — Drop accounting contradicts the stdout rule.**

- **Plan:** Architecture decision, components 3 and 5, regression test 1.
- **Evidence:** [worker-runtime.ts:673](/D:/projects/ptah-extension/libs/backend/platform-electron/src/implementations/electron-state-storage-worker-runtime.ts:673) currently counts missing IDs only. [session-metadata-store.ts:810](/D:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/session-metadata-store.ts:810) logs output counts without a stdout-drop counter.
- **Failure:** The fixture has 28 stdout-bearing references with existing output, plus one missing-ID reference. The architecture requires dropped stdout to be counted, but the split instructions count only missing IDs, live-save instructions specify no drop accounting, and the test expects `droppedBulkCount === 1`.
- **Fix:** Define counting units explicitly. With one count per affected reference, this fixture requires 29 drops and one skipped session. Add equivalent observable accounting for live saves.

The fresh split’s lean-first commit and sidebar index path are covered by the design. For dev v2 stores left in place, projection safety requires R3-1; object-shaped output deliberately returns an isolated `not-a-sequence` failure, so output paging does **not** universally succeed there. That accepted historical limitation needs no compatibility mechanism. Restored-agent empty stdout follows directly from [agent-process-manager.service.ts:812](/D:/projects/ptah-extension/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:812) and is within the accepted scope.
