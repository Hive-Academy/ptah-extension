Verdict: REVISE

## Round 1 result

1. **Closed — measurement gates.** R1 schedules the 60 s baseline before Batch 1, intermediate and final profiles, a 30 min private-memory series, forced GC, an agreed ceiling, and a recorded pass/fail comparison (`D:/projects/ptah-wt-628/.ptah/specs/TASK_2026_628_5ab5/implementation-plan.md:42-64`). These cover the acceptance measurements (`.ptah/specs/TASK_2026_628_5ab5/context.md:212-224`).
2. **Closed — hidden-window truncation ordering.** R2 keeps pending text raw and folds it into the existing body before issuing one leading notice (`implementation-plan.md:66-79`). This addresses the notice-in-the-middle defect; the separate stream-count problem is listed below.
3. **Open — Batch 7 geometry after release.** R3 says to remove stale nodes, then write authoritative geometry inside one batch (`implementation-plan.md:81-104`). The current apply uses `grid.load(..., false)`, not `update()` calls (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:779-805`). `load()` starts and ends its own batch (`node_modules/gridstack/dist/gridstack.js:652-652`, `:717-717`); its end invokes `engine.batchUpdate(false)` with default packing (`gridstack.js:730-737`; `gridstack-engine.js:47-62`). A surrounding public batch therefore cannot keep the removal and final write in one batch, and a sequence of `update()` calls followed by public `batchUpdate(false)` also packs. `_packNodes` can move a live node upward after the authoritative write (`gridstack-engine.js:427-465`). Specify a final geometry check/reconciliation or a proven no-pack commit path, and test the engine coordinates after the final batch closes.

## New defects

1. **Major — R2, private dropped count mixes streams.** R2 defines one `Map<agentId, number>` (`implementation-plan.md:66-75`), but stdout and stderr are capped independently (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1290-1300`) and `capBuffer` records the count in each buffer's own leading notice (`libs/frontend/chat-streaming/src/lib/agent-output-retention.ts:64-75`). If both streams trim, a shared count can make each notice include bytes dropped from the other stream. Keep separate stdout and stderr counts per agent and test both streams trimming.
2. **Major — R3, closing the last tile skips release.** R3 calls for release only inside `applyAuthoritativeGeometry` (`implementation-plan.md:88-99`), but that method returns when `positioned.length === 0`, before obtaining the grid or entering its apply window (`libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:739-748`). Closing the final tile can therefore leave its engine node and drag handlers retained until destroy or a later nonempty apply. Provide a guarded empty-layout release path and test closing the last tile while the workspace stays mounted.

## Confirmed

- Batch 1a sanitizes completed markdown slices separately, inserts each into its own `[innerHTML]` element, and renders the growing tail as text; the existing boundary finder uses fences and blank lines (`libs/frontend/markdown/src/lib/streaming-markdown-renderer.ts:31-57`; `implementation-plan.md:126-175`, `:287-320`).
- The streaming wrapper preserves the sanitized root's containment styles (`libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:200-225`; `implementation-plan.md:153-165`).
- Batch 2's three-Map identity key survives shallow flush copies; the state factory creates fresh Maps and reviewed replacement paths do not clear or replace those Maps in place (`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:182-192`; `libs/frontend/chat-types/src/lib/chat-types.ts:168-183`; `implementation-plan.md:433-453`).
- Batch 3 chooses pending/deferred state before tab state, preserving summary ordering (`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:127-136`; `implementation-plan.md:590-605`).
- Batch 4 keeps the public `AgentMonitorStore` signal and agent shapes; Batch 5 uses the `tab-<id>` tile key (`implementation-plan.md:638-643`, `:957-982`).
- Batch 7 remains scoped to GridStack lifecycle and option pruning rather than the canvas layout algorithm (`implementation-plan.md:1248-1267`).

## Decisions

- Keep Batch 1a's raw-boundary approach for security review: separate sanitization and DOM insertion prevent cross-block HTML parsing; streaming HTML fidelity remains a distinct disclosed risk (`implementation-plan.md:232-241`, `:287-313`).
- Treat fork/rebind as a clear followed by a fresh state, consistent with the state factory (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2460-2470`; `libs/frontend/chat-types/src/lib/chat-types.ts:168-183`).
- No tests or builds were run, per scope. Runtime memory thresholds, detached-node retainers, and Angular/GridStack integration remain for implementation and measurement.
