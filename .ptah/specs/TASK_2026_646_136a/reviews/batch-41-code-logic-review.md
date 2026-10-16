# Batch 41 code logic review

**Verdict: NEEDS_REVISION — 5.5/10.** 0 Blocking, 2 Serious, 0 Moderate; 2 new failure modes. The direct fixes close their reported cases, but the new key rollback has two paths that can leave a saved selection using the wrong credential. This is above the 3–4 band because the normal and single write failure paths are covered; it is below 7 because both remaining paths affect active credentials.

**Review family:** reviewer codex/OpenAI; implementers Anthropic subagents and Anthropic orchestrator.

| Target defect or batch item | Status | File:line evidence |
| --- | --- | --- |
| P6 logic defect 1: a throwing shutdown logger rejects the bounded drain | **CLOSED** | `libs/backend/lane-outcomes/src/lib/di/start.ts:48-56,121-160` catches warning failures in both drain rejection and timeout paths; `start.spec.ts:134-163` covers each. |
| P4 logic defect 1: invalid selection changes Jev key; failed selection write leaves new key; row falsely says unchanged after rollback failure | **CLOSED for the reported cases** | `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:613-624,821-855` validates before writing and restores the previous key when `setSelection` rejects; `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:637-648` shows the fixed partial-write message. The new rollback cases are below. |
| P5 logic defect 1: VS Code missing deliverable refuses the report | **CLOSED** | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:66-75,143-165` maps `FileNotFound` and `FileNotADirectory` to `exists: false`; `outcome-report.tool.spec.ts:205-228` covers both. |
| P5 style D1: outcome schema omits per-kind required-field guidance | **CLOSED** | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:43-58` uses the shared flattener; `surface-tools.ts:74-145` adds per-kind required and forbidden-field descriptions. |
| P5 visual Serious: card outcome text clips | **CLOSED by source evidence; rendered layout unverified** | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-card.component.ts:139-157,220-244,538-543` sizes columns from the card and gives sentence states a wrapping full row. No new visual capture was supplied. |
| 41e initial bundle budget and tab loading | **CLOSED by source and reported measurement** | `libs/frontend/chat/src/lib/settings/settings.component.html:172-184` defers the Orchestration tab with an `aria-busy` placeholder; `settings.component.ts:27-30,102-108` leaves its component as a defer-only reference. `reports/batch-41e-report.md` reports a 87.70 kB initial-chunk reduction. |
| 8253977e8 CI externalization and manifest refresh | **CLOSED by configuration inspection** | `libs/backend/lane-outcomes/project.json:17` lists the host-native externals; `content-manifest.json:3-5` has the refreshed hash and generation time. Runtime packaging was not rerun. |

## NEW defects

1. **Serious — a post-write failure restores the old credential under the new selection.** `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:153-175,701-706`; `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:834-855`. Start with an unsupported Ollama selection and no Jev key. Save Jev plus a new key. `setSelection` writes Jev at line 163, then `clearMark` can reject while persisting the mark at lines 701–706. The handler treats the rejection as a failed selection write and deletes the new key at lines 839–841. The stored selection is now Jev without a credential, while the RPC returns a generic failed-save result. The test at `agent-rpc.handlers.decision-model.spec.ts:535-566` mocks an immediate `setSelection` rejection and cannot catch a rejection after its configuration write.

2. **Serious — concurrent saves can roll back a newer successful key.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:821-855`. Two `agent:setConfig` calls share this configuration service and the read, write, selection, and rollback steps have no serialization. Call A reads old key K0 and writes K1, then waits for its selection write. Call B reads K1, writes K2 and succeeds. If A's selection write then rejects, A restores K0 at line 841. B has reported success, but its selection now uses K0 instead of K2. The existing rollback test at `agent-rpc.handlers.decision-model.spec.ts:535-566` exercises only one call.

## Five logic questions

1. **Silent failure:** defect 2 lets B return `success: true` while its key is replaced afterward (`agent-rpc.handlers.ts:834-841`).
2. **Unexpected user action:** two overlapping settings saves can interleave their awaits and trigger defect 2 (`agent-rpc.handlers.ts:821-855`).
3. **Wrong-answer input:** an Ollama unsupported mark followed by a Jev selection and key yields Jev with no key if mark persistence fails (`decision-model.config.ts:163-175,701-706`; defect 1).
4. **Dependency failure:** VS Code `FileNotFound` now becomes a negative deliverable check (`outcome-report.tool.ts:143-165`); a failing mark store after selection persistence triggers defect 1.
5. **Missing requirement:** combined key and selection saves need a defined result when a later side effect fails, and a defined ordering for overlapping saves (`agent-rpc.handlers.ts:821-855`).

## Scope and verification

Inspected the six named commits, prior target reviews, Batch 41 reports, root repository instructions, changed implementation and relevant specs. The caller reports scoped Jest, typecheck, lint, library builds and the 296-item degradation audit passing; these were not rerun, per instruction. Source inspection establishes the two failure interleavings, but no fault-injection test for either is present. No source files were edited.

## Decisions

- **Status of 41a:** Marked the specifically reported malformed-selection, direct selection-write rejection and failed-rollback message paths closed. Options were CLOSED or PARTIAL; the cited code and specs support closure for those paths, while the two newly identified interleavings are recorded separately. Reversible: yes.
- **Status of 41c:** Marked source closure with visual uncertainty. Options were CLOSED or PARTIAL; full-row wrapping and container-width columns directly address the reported clipping mechanism, but no rendered screenshot was available. Reversible: yes.
