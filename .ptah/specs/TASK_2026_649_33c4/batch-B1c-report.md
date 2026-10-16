# B1c — tool invocation provenance

## Files changed

- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.ts` — resolves SDK session and caller workspace synchronously, captures the proposing turn before the first await, passes its frozen timestamp to save, releases the capture in `finally`, and broadcasts the revision identified by the returned proposal's `updatedAt`.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/harness-namespace.builder.spec.ts` — updates the proposal fixture and covers capture/save ordering, a later callback before save completion, exact saved-revision broadcast, absent attribution, and release on persistence failure.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` — wires capture and save through the platform-core proposal-store token without importing rpc-handlers. Capture is absent when the caller's pinned workspace differs from the store provider's active root.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts` — covers SDK session resolution, capture and fourth save argument forwarding, unavailable store, and workspace mismatch.

## Decisions

- **Workspace mismatch:** return an unattributed capture when the resolved caller workspace differs from the provider root. Options: capture from the provider anyway, or omit attribution. Evidence: B1a's `IHarnessProposalStore.captureProposingTurnStartedAt(sessionId)` does not accept a workspace, while B1b resolves its provider root internally; D9 forbids attaching an unrelated turn. Reversible: yes, once the store contract accepts a pinned workspace.
- **Saved revision identity:** select `proposal.revisions.find(item => item.updatedAt === proposal.updatedAt)` and fail without broadcasting if absent. Options: broadcast the inbound update, choose the last revision, or use B1b's unique write timestamp. Evidence: B1b handoff says revisions are sorted by turn start, so the saved revision can precede a later turn. Reversible: yes.
- **Capture lifetime:** retain through save and broadcast, releasing in `finally`. Options: release before save, or release when the invocation settles. Evidence: `implementation-plan.md:35,48` and B1b's capture/release contract. Reversible: yes.

## Verification

- `ptah_ast_analyze` parsed all four edited TypeScript files with zero syntax errors.
- Nx, Jest, TypeScript, diagnostics, lint, build, serve, and e2e were not run, per the caller's instruction. The orchestrator owns those checks.

## Not done

- Full workspace pinning across capture and persistence needs a change outside B1c ownership: extend `libs/backend/platform-core/src/interfaces/harness-proposal-store.interface.ts` so capture and save accept the caller's pinned workspace root, then update `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` to use and validate that root rather than reading the mutable provider root separately. Current B1c behavior conservatively omits attribution on a synchronous workspace mismatch; it cannot force the store to persist under the pinned caller workspace. Those files were not edited.
