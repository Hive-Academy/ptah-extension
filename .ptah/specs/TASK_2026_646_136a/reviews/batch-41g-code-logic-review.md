# Batch 41g code logic review

**Verdict: NEEDS_REVISION — 7/10.** The combined key and selection case from 41f is closed, but a selection-only save can still report an unchanged, failed save after the choice was stored. One Moderate finding keeps this below the 8/10 sound band; the combined-write fix and existing failure handling keep it above the 5–6 band.

**Review family:** reviewer codex/OpenAI; implementer Anthropic orchestrator.

## Target status

**PARTIALLY CLOSED.** In `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:867-881`, a combined write that rejects after the requested selection is stored reads it back, keeps the new key, logs the error type, and returns normally. `applySetConfig` then writes the remaining requested fields and returns `{ success: true }` (`agent-rpc.handlers.ts:690-702,824-828`). The revised assertion covers that case (`agent-rpc.handlers.decision-model.spec.ts:640-669`). A selection-only write takes the earlier branch at `agent-rpc.handlers.ts:857-860` and misses the readback; see the finding below.

## NEW defects

1. **Moderate — selection-only save still reports failure after committing the choice.** `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:857-860,815-828`; `libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:163-175,700-706`; `libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:56-57,588-598,637-648`. Start with an unsupported mark for Ollama and save a different selection without typing a Jev key. The row sends only `decisionModel`. `setSelection` stores the new selection at line 163, then `clearMark` can reject after its `logger.info` call at line 702. The selection-only branch propagates that late rejection without reading back the stored choice. `applySetConfig` returns `success: false`; the row displays that the saved choice is unchanged, although it changed. This also skips any other fields in the same RPC request. The new 41g test supplies both a key and a selection, so it does not exercise this branch.

## Path assessment

| Request / post-write state | Observed result |
| --- | --- |
| Both fields; selection stored | Correct success, new key kept; subsequent fields proceed (`agent-rpc.handlers.ts:865-881,690-702`). |
| Both fields; selection not stored or unreadable | Previous key is restored, then the selection error is reported; if key restoration fails, fixed uncertainty text is returned (`agent-rpc.handlers.ts:881-894,901-920`). An unreadable read cannot establish whether the selection changed, so the result remains uncertain. |
| Selection only; selection stored after a late rejection | Incorrect failed result; finding above (`agent-rpc.handlers.ts:857-860`). |
| Selection only; selection not stored | Failure is appropriate (`agent-rpc.handlers.ts:857-860`). |
| Key only; write resolves / rejects | Resolves to success / rejects to fixed failure text (`agent-rpc.handlers.ts:861-864,815-828`). A secret store that commits then rejects can still create an ambiguous result; this predates 41g and no key readback exists in this path. |

## Five logic questions

1. **Silent failure:** The readback in the combined path prevents a committed selection from looking failed, but the selection-only branch still returns a failure-looking result after a commit (`agent-rpc.handlers.ts:857-860`).
2. **User action:** Saving a different choice without entering a new Jev key takes that selection-only branch (`decision-model-row.component.ts:588-598`).
3. **Wrong answer from input:** A valid new choice with a pre-existing unsupported mark can be stored even when mark cleanup rejects; the RPC then answers that the save failed (`decision-model.config.ts:163-175,700-706`).
4. **Dependency failure:** Mark storage errors are caught by `persistMark` (`decision-model.config.ts:659-672`), while a throwing `clearMark` logger can still reject after the selection write. For combined writes, readback distinguishes stored, not-stored, and unreadable states (`agent-rpc.handlers.ts:872-920`).
5. **Unspecified case:** The stated recovery rule covers the combined write but omits the selection-only late rejection (`agent-rpc.handlers.ts:838-850,857-860`).

## Verification

Read-only review of commit `d4dcdc6c1`, the 41f review, the affected handler, service, row, and decision-model tests. The orchestrator already reported 33 decision-model specs passing, rpc-handlers typecheck and lint passing, and degradation TOTAL 296; these checks were not rerun. Their passing result does not cover the selection-only late-rejection scenario above.
