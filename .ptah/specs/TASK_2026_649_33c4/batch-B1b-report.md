# B1b — captured turns and durable revisions

## Files changed

- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-turn-attribution.service.ts` — subscribes once to SDK prompt callbacks and turn endings, captures only a unique session/workspace start, retains referenced starts through later callbacks and terminal events, and bounds unreferenced history and sessions. `dispose()` removes every subscription.
- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts` — implements B1a's capture/release and fourth `save` argument. One locked file write persists a new revision and the merged projection. Revisions are ordered by captured turn start, with unattributed revisions first. The saved revision has a unique `updatedAt` equal to the returned proposal's `updatedAt`, so B1c can select that exact revision for its push even when it is not last in turn order.
- `libs/backend/rpc-handlers/src/lib/harness/di.ts` — registers the attribution service as a singleton for the proposal store.
- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-turn-attribution.service.spec.ts` — covers T1 capture, T2 user choice interval, T3 callback and terminal before T4 save, plus ambiguity, workspace mismatch, failed turn, and subscription release.
- `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts` — covers one revision per save and its write identity, late T1 persistence after T3 without displacing T3 fields, legacy merged-only records, and unattributed late writes.

## Decisions

- **Ambiguous callbacks:** mark a session ambiguous when another prompt callback arrives before terminal; capture stays absent until terminal. Options: select latest callback or return absent. Evidence: D9 and `implementation-plan.md:25,35` say no turn ID exists and forbids guessing. Reversible: yes.
- **Revision projection:** sort unattributed revisions before attributed ones, then by turn start and stable revision ID; fold updates in that order. Options: fold in write order or turn order. Evidence: `implementation-plan.md:34-35` and the T1-after-T3 regression requirement. Reversible: yes.
- **Saved revision identity:** make each record's write timestamp monotonic and unique, and use it as the prefix of the revision ID. Options: add a new return property to the B1a interface or identify the saved revision by the returned proposal's `updatedAt`. The B1a interface returns `HarnessProposal`, and B1c needs the exact saved revision for broadcast. Reversible: yes. B1c should select `proposal.revisions.find(revision => revision.updatedAt === proposal.updatedAt)`.
- **Conservative capacity:** retain at most 16 idle callbacks per session and 128 sessions without in-flight references. If capacity is exceeded, discard an unreferenced session and leave future captures absent until a new callback. Options: unbounded history or conservative eviction. Evidence: B1b requires bounded history while D9 forbids guessing. Reversible: yes.

## Verification and remaining work

- `ptah_ast_analyze` parsed all five edited TypeScript files with zero syntax errors. Imports and SDK callback/event APIs were checked against their source.
- Nx, Jest, TypeScript, diagnostics, lint, build, serve, and e2e were not run, per the batch instruction. The orchestrator owns those checks.
- B1c must freeze the capture at tool invocation, pass its `turnStartedAt` to this store, release the handle in `finally`, and select the saved revision by the returned proposal's `updatedAt` for broadcast. No files outside B1b ownership were edited.

## Orchestrator fix

- `harness-proposal-turn-attribution.service.spec.ts:27`: `createMockLogger() as Logger` failed ts-jest (TS2352); changed to `as unknown as Logger`, the pattern of the sibling `harness-proposal-store.service.spec.ts:37`. Test-only.
