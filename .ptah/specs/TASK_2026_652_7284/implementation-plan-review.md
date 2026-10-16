# Implementation Plan Review - TASK_2026_652_7284

## Review state

| Field | Value |
| --- | --- |
| Author | codex CLI lane (CLI side, codex family) |
| Reviewer | in-process claude subagent (software-architect role) |
| Sides | author CLI/codex; reviewer in-process/claude (cross-side) |
| Reviewed revision | round 2 (`implementation-plan.md` 171 lines, `parity-inventory.md` 36 lines) |
| Completed rounds | 2 |
| Verdict | **REVISE** (1 new Serious finding, F18. F1-F17 resolved) |

Round 2 resolves F13-F17. Each was checked against the code.

I walked every batch in order (S, P, A, C, D1, D2, D3, B, E, F, G, H, I) and checked each one's own scoped gate.
One gate fails as written. The new `wizard:analysis-status` RPC is registered in one batch and given a handler in
another. Whichever of C or G owns the registry entry, one of them fails its own check (F18).

The fix is small and can be made in the plan without another design round.

## Requirement trace

| # | Requirement (task context.md) | Plan section | Status |
| --- | --- | --- | --- |
| 1 | Session-scoped proposal, persisted in the backend, plus a read RPC | Section 1; batches S/P/A/C/D1-D3/B | Met |
| 2 | `start-new-project` returns seed, intake and plugin results; New Project keeps working | Section 2; batches C/D1/D2 | Met. The transport is kept for now; its cleanup is deferred with exact files |
| 3 | Manifest v4 with sessionId, attempt, input fingerprints and verification; v3 not reinterpreted | Section 3; batches E/F | Met. Order note in F20 |
| 4 | Workspace-fingerprint freshness check, plus status RPC | Section 4; batches F/G | Met in design. Registration split fails a gate (F18) |
| 5 | Self-gathering agent and system-prompt generation | Section 5; batches H/I | Met |
| C | No 629-owned file; keep-and-fix; scoped verification | Batches; Deferred review items | Met. No batch touches `libs/frontend/{canvas,chat,chat-ui,chat-streaming,chat-state,chat-types}` or `apps/ptah-extension-webview`. Proposed Removals is "None" |

## Recheck of earlier findings

| # | Severity | Status | Evidence in round 2 |
| --- | --- | --- | --- |
| F1-F12 | various | Resolved (rounds 1-2) | Unchanged from the round-1 recheck. File ownership is complete, apart from F18 and F20 |
| F13 | Serious | **Resolved** | The constant, payload, baseline entry (`host-source-registry.baseline.ts:515`), relay case and dependent specs are kept. C removes only the producer at `harness-rpc.handlers.ts:872`. The deferred item lists every file: `message-constants.ts:194`, `payload-map.ts:199-200,417`, `baseline.ts:515`, the handler and its spec, `unit5-message-routing.spec.ts:74,209,236`, and four Electron e2e specs. D2 changes only the config-proposed payload, which `unit5-message-routing.spec.ts:75,210` checks by constant value only |
| F14 | Serious | **Resolved** | `HarnessStartNewProjectResult` (`rpc-harness.types.ts:512-515`) now changes in C, with its handler. S creates a separate `rpc-harness-proposal.types.ts`. A no longer compiles against a new required result field |
| F15 | Minor | Resolved | Parity rows for CLI `analyze.ts:70-189`, `prompts.ts:162-175`, `setup.ts:232` and `wizard.ts:217` |
| F16 | Minor | Resolved | S owns `shared/src/lib/utils/index.ts` (re-exported at `shared/src/index.ts:59`) and `shared/src/index.ts` |
| F17 | Minor | Resolved | No order change is needed, because `broadcast` is untyped (`harness-namespace.builder.ts:381`). B has a sessionId regression test |

## Lane-introduced constraints (round 2)

There are no new runtime constraints. L17 (remove the transport now) is withdrawn, and the removal is now a deferred
review item gated on the TASK_2026_629 merge. L1-L16 and L18 stand as accepted in rounds 0-1.

## Parity deltas (round 2)

- 27 capability rows, all `keep` or `move`. There is no `remove-proposed` row, and Proposed Removals is "None".
- Row 16 (the relay) is `keep`. The relay now delegates to the extracted D1 request service, so the user-visible
  behaviour is unchanged.

## New findings

**F18 - Serious - `wizard:analysis-status` is registered in one batch and handled in another.**
- `rpc.types.ts` has only one owner, batch C. Plan line 103 says the status RPC's "types and source-registration
  follow `wizard:get-resumable-run`", so its `RPC_METHOD_NAMES` and baseline entries land in C.
- The handler lands in batch G: the `SetupRpcHandlers.METHODS` entry and its binding.
- Consequences:
  - `rpc-handlers/src/lib/rpc-allowlist.spec.ts:41` ("claims every registry method exactly once") fails in C's own
    `@ptah-extension/rpc-handlers` test run. The handler manifest is built from each handler's `METHODS`
    (`harness-rpc.handlers.ts:361`), and no `METHODS` list claims the new name until G.
  - If the entry instead lands in G, G cannot edit `rpc.types.ts` (owned by C). `METHODS` is
    `as const satisfies readonly RpcMethodName[]` (`setup-rpc.handlers.ts:~97`), so G's typecheck fails.
- Fix (either):
  - In C, register only `harness:get-proposal`. Move the `wizard:analysis-status` entries for `rpc.types.ts` and
    `baseline.ts` into G. Move `agent-generation/src/index.ts` from G to E, so G stays within two libraries: shared and
    rpc-handlers.
  - Or move the status handler's `METHODS` entry and binding into C. This needs the freshness token from F, so C would
    have to come after F.

  Sequential edits of `rpc.types.ts` in two batches are acceptable, but the plan must state that ownership explicitly.

**F19 - Moderate - The CLI RPC surface spec is not verified.**
- `cli-engine/src/lib/rpc/rpc-surface.spec.ts:17-30` requires every new `RPC_METHOD_NAMES` entry to be either served by
  the CLI profile or added to its frozen excluded list.
- No batch runs `@ptah-extension/cli-engine` tests.
- Fix: after the batches that add the two RPCs, add one scoped
  `npx nx run-many -t test -p @ptah-extension/cli-engine --parallel=1`. Decide whether the CLI serves
  `harness:get-proposal`. The CLI registers harness services at `cli-engine/src/lib/container.ts:941`.

**F20 - Moderate - E's gate can break code that E does not own.**
- E changes the manifest read path. `AnalysisStorageService.loadManifest` has callers outside E:
  - `rpc-handlers/.../wizard-generation-checkpoint.service.ts:133`, owned by no batch.
  - `analysis-run-checkpoint.ts:72` (E) and `analysis-storage.service.ts:493,575` (E).
- `multi-phase-analysis.service.ts` (owned by F) calls the checkpoint API.
- Fix: E must keep `loadManifest` and the checkpoint call surface source-compatible, adding `readManifest` alongside,
  or else take ownership of `wizard-generation-checkpoint.service.ts`. Without that, E's or G's gate fails on code its
  batch does not own.

**F21 - Minor - The hydration call needs an owner.**
- D2 hydrates through `harness:get-proposal`, but the frontend RPC wrapper `services/harness-rpc.service.ts` is owned
  by D1.
- Fix: state that D1 adds the `getProposal` method.

## Required for approval

- F18: change one batch-table line and plan line 103 so that the registry entry and the handler for
  `wizard:analysis-status` land in the same batch, still at 2 libraries or fewer.
- F19-F21 can go to the team-leader as notes. F20 should be written into the E contract.
