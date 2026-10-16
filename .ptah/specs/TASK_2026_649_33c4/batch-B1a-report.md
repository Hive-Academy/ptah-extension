# B1a proposal wire contract

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-harness-proposal.types.ts`: added `HarnessProposalRevision` with a stable ID, update, completion, write time, and optional captured `turnStartedAt`; added optional revision history to the existing proposal projection.
- `libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts`: strictly validates revision data and turns a legacy merged-only proposal into one unattributed revision on parse. It does not infer a turn start from `updatedAt`.
- `libs/shared/src/lib/types/messages/payload-map.ts`: permits the exact saved revision on `HarnessConfigProposedPayload` while retaining the existing fields and old callers.
- `libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts`: adds synchronous capture/release of an attributable turn and an optional captured turn start argument to `save`.
- `libs/shared/src/lib/types/rpc/rpc-harness.types.spec.ts`: covers legacy records, attributed and unattributed new revisions, malformed revisions, and the push payload type.

## Decisions

- **Revision shape:** use an optional `revisions` array with required `id`, `configUpdates`, `isConfigComplete`, and `updatedAt`, plus optional `turnStartedAt`. Alternatives were a single latest revision or replacing the merged view. Evidence: B1a requires old callers and records to remain valid, while the implementation plan requires multiple ordered revisions and a stable identity for live/reload deduplication. Reversible: yes.
- **Legacy identity:** derive a stable `legacy:<sessionId>:<updatedAt>` ID at parse time and leave its turn start absent. Alternatives were a random ID or using write time as turn start. Evidence: D9 forbids write-time attribution and the plan requires stable revision identity. Reversible: yes.
- **Turn capture contract:** expose `captureProposingTurnStartedAt(sessionId)` with a release handle and pass its optional value as a fourth `save` argument. Alternatives were a mutable latest-turn lookup in `save` or a dependency on rpc-handlers. Evidence: implementation-plan.md lines 13, 25, and 35 require synchronous capture before awaiting and release after save. Reversible: yes.

## Verification and remaining work

- Requested scoped `ptah_get_diagnostics` for all five edited files; the TypeScript compiler remained running beyond the tool's 45-second limit, so it returned all five as unchecked. No compiler verdict was available.
- Nx, Jest, typecheck, lint, build, and e2e commands were not run, per batch instruction. The orchestrator owns the specified checks.
- B1a does not implement persistence, SDK callback attribution, or broadcast. Those belong to later batches and must use the contract above.

## Fix round

- Orchestrator typecheck and lint passed for shared and platform-core. Its Jest run found two TypeScript errors in the new spec. Updated the prompt fixture to include required `enhancedSections` and typed malformed-revision cases as objects with an `unknown` value, avoiding mixed tuple inference. Production types were unchanged. Per instruction, no checks were rerun in this lane.

## Extra task

- Changed `HarnessWorkflowPromptParams` in `libs/shared/src/lib/types/rpc/rpc-harness.types.ts` to mirror the backend schema's two forms: an existing `intent: string` form with no `contextOnly`, or `contextOnly: true` with no `intent`. The backend schema alone enforces nonempty intent at runtime. Checked named type usages and the existing frontend caller still supplies the intent form; the backend service already narrows on `contextOnly`. The shared spec has no workflow-prompt test pattern, so no case was added. The orchestrator reported the previous spec fix passing 43/43; no checks were run for this extra task per instruction.
