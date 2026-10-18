# B02 agent run ownership and freshness report

## Files changed

- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` — bound submit, preview, cancel, retry, recovery lookup, source and provider decisions.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.ts` — Zod binding schemas.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts` — active run owner, exact cancel, bound completion, finalization failure.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts` — checkpoint metadata, authorized bind on resume, bound lookup, strict finalize.
- `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts` — optional version-1 checkpoint metadata and validation.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.spec.ts` — invalid binding cases.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.spec.ts` — exact owner cancel and finalization failure.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.spec.ts` — old checkpoint parse and retained outcome.

## Acceptance status

1. Tabless submit still returns awaited acceptance shape, and tabless cancel still aborts any active run, including bound (`wizard-generation-rpc.handlers.ts:300,900`). Tabless retry retains `lastGenerationOptions` (`:1013`).
2. Bound submit authorizes canonical host and tab roots before freshness or checkpoint I/O, and rejects foreign analysis directories (`wizard-generation-rpc.handlers.ts:322-335,1401`; `wizard-generation-rpc.schema.ts:23-29`).
3. Submit uses `getStatus`, accepts the latest fresh directory with its verified manifest run ID, drops bound client analysis data, and reports discovery reasons including not-latest and lookup-failed (`wizard-generation-rpc.handlers.ts:345-401,427,1184`). The orchestrator retains its existing verified phase reader.
4. Provider/model route and saved guidance are read before accepted; metadata is persisted on new and resume submits (`wizard-generation-rpc.handlers.ts:401-425,1423`; `wizard-generation-checkpoint.service.ts:156-160,302-306`). Retry checks the saved guidance-used flag (`wizard-generation-rpc.handlers.ts:1021`).
5. Version-1 fields are optional; old records parse and resume carries final outcomes and model (`generation-checkpoint.types.ts:22-31,181-194`; `wizard-generation-checkpoint.service.ts:285-307`; `wizard-generation-checkpoint.service.spec.ts:14`).
6. The supervisor stores the exact binding, bound cancel checks all three identity fields, and submit returns the prepared run ID (`wizard-generation-run.supervisor.ts:181-201,226`; `wizard-generation-rpc.handlers.ts:492-538`). Blocked replies expose owner tab only when workspace matches (`wizard-generation-rpc.handlers.ts:1392`).
7. Internal, unregistered `getGenerationRunState` reads active owner and checkpoint, including a lost start response (`wizard-generation-rpc.handlers.ts:230-264`; `wizard-generation-checkpoint.service.ts:224-242`). Lookup coverage is limited to root and latest analysis directory; see open points.
8. Bound progress, stream and completion carry binding and lifecycle/result fields; completion is emitted after settlement (`wizard-generation-rpc.handlers.ts:1187,1207-1250`; `wizard-generation-run.supervisor.ts:296-318`). Counts use settled outcomes (`wizard-generation-run.supervisor.ts:134-174`). Duplicate terminal/late completion has no dedicated regression spec yet.
9. Bound preview authorizes workspace; submit recalculates definite target signatures and requires a new preview when changed (`wizard-generation-rpc.handlers.ts:403-410,696-720,1414-1420`). The shared preview request type lacks the optional binding field, which B03 must address without changing this batch's shared-file boundary.
10. Bound retry requires run binding and loads its checkpoint instead of another run's process-wide options (`wizard-generation-rpc.handlers.ts:976-1040`).
11. Missing/failing checkpoint finalization prevents success; validation fallback and propagation remain in their existing paths (`wizard-generation-checkpoint.service.ts:362-377`; `wizard-generation-run.supervisor.ts:283-296`; `wizard-generation-rpc.handlers.ts:635-655`).
12. Orchestrator discovery/validation and propagation functions were not changed (`wizard-generation-rpc.handlers.ts:635-655,1237-1300`).

## Checks

- `nx run-many -t typecheck,lint` for **2 projects**: `NX Successfully ran targets typecheck, lint for 2 projects` (final run).
- `nx run-many -t test` header confirmed `Running target test for 2 projects`; agent-generation test passed, rpc-handlers failed: `Test Suites: 82 failed, 76 passed, 158 total; Tests: 1 failed, 5 skipped, 2174 passed, 2180 total`. The worktree lacks `node_modules/marked/lib/marked.umd.js`, required by `jest.preset.js`'s mapper, causing broad module-load failures.
- Changed-spec Jest attempt: `Test Suites: 5 failed, 5 total; Tests: 0 total`, same missing mapped `marked.umd.js`.
- Isolated supervisor spec: `Test Suites: 1 passed, 1 total; Tests: 2 passed, 2 total`.
- `ptah_get_diagnostics` after edits: unavailable after 45 seconds; Nx TypeScript compiler check passed.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use optional binding on the existing RPC methods | Additive optional binding; breaking replacement | D10 and shared B01 types; tabless behavior retained | Yes |
| Read provider model DI identity via `Symbol.for('SdkProviderModels')` | Direct barrel import; token package import; verified symbol identity | `libs/backend/auth-providers-tokens/src/lib/tokens.ts:4`; barrel import broke Jest loading and token-package import required an out-of-scope package manifest edit | Yes |
| Keep confirmation snapshots in a bounded in-memory map | Persist preview tokens; compare latest definite targets in memory | Existing preview response has no confirmation token and B02 cannot edit shared contracts | Yes |
| Fail completion when finalize fails | Best-effort finalize; strict finalization | Acceptance 11 and checkpoint durability boundary | Yes |

## Open points

- Full rpc-handlers test verification needs the missing mapped `marked.umd.js` dependency in this worktree. No dependency or Jest config files were changed because they are outside B02 ownership.
- Required handler integration coverage for the complete source matrix, lost-response lookup, old resume, target renewal and duplicate terminal behavior is incomplete. Existing handler and preview specs were not extended.
- `locateBound` searches root and latest analysis directory. A completed bound checkpoint beside an older analysis directory may be missed after a newer analysis is created.
- The shared `WizardPreviewGenerationParams` interface has no `tabBinding`; the runtime schema supports it, but B03 must align the shared type before frontend callers can type it.
- The preview snapshot is process local. After a host restart, the caller must preview again before a bound submit.

## Proposed Removals

None.

## Revision round 1

This section supersedes the earlier Checks and Open points sections. The missing Jest dependency was repaired in the worktree before this round.

### Files changed in this round

- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts`: optional preview binding.
- `libs/shared/src/lib/types/rpc/rpc-setup-generation.contract.spec.ts`: compile-time preview contract assertion.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.ts`: bounded, newest-first bound checkpoint search.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`: nonterminal orphan lookup and cancel-first settlement.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.ts`: abort prevents success; preserve an existing failure message.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.spec.ts`: bound source, ownership, lookup, resume, retry, cancel and failure integration tests.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation.preview-fidelity.spec.ts`: target renewal and unsafe-content fallback integration tests.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-run.supervisor.spec.ts`: validated outcome counts.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-checkpoint.service.spec.ts`: strict index-signature access in the old-checkpoint assertion.
- `libs/backend/agent-generation/src/lib/types/generation-checkpoint.types.ts`: formatting of existing B02 changes.
- `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.schema.spec.ts`: formatting of existing B02 changes.

### Fixes 1–5

1. Preview request accepts optional `SetupGenerationTabBinding` (`rpc-setup.types.ts:317-322`); the type assertion is at `rpc-setup-generation.contract.spec.ts:42-46`.
2. `locateBound` checks the workspace root and each direct valid analysis directory from `AnalysisStorageService.list`, then chooses the matching trusted checkpoint with the latest `updatedAt` (`wizard-generation-checkpoint.service.ts:230-271`). The older-directory lookup is exercised at `wizard-generation-rpc.handlers.spec.ts:399`.
3. A checkpoint with no active controller and lifecycle `running` is returned as `starting`, with no `result` (`wizard-generation-rpc.handlers.ts:264-292`; spec `wizard-generation-rpc.handlers.spec.ts:383`). `starting` is the closest existing nonterminal union value for an unconfirmed orphan. A verified cancel writes `paused` (`wizard-generation-rpc.handlers.ts:806-814`), which lookup maps to `cancelled`. Only completed, timed-out, paused and failed checkpoints produce terminal facts.
4. Integration coverage is listed below.
5. Ran Prettier on every changed source and spec file, including the B02 files from the prior lane; the final passes were on `wizard-generation-rpc.handlers.spec.ts` and `wizard-generation.preview-fidelity.spec.ts`.

### Integration specs for 4a–4l

| Item | Spec name and location |
| --- | --- |
| 4a | `uses workspace discovery for %s analysis`, `uses the latest fresh analysis with its verified run identity`, `falls back from an older analysis directory and from a throwing freshness lookup` (`wizard-generation-rpc.handlers.spec.ts:277,294,311`). These also assert altered client `analysisData` is dropped. |
| 4b | `rejects a foreign directory and workspace mismatch before freshness or checkpoint I/O` (`wizard-generation-rpc.handlers.spec.ts:331`), including malformed binding. |
| 4c | `returns the prepared run id before work settles and recovers a lost start response` (`wizard-generation-rpc.handlers.spec.ts:367`). |
| 4d | `blocks a second tab with only the owner tab id, and keeps owner ids private across workspaces` (`wizard-generation-rpc.handlers.spec.ts:511`), including a tabless owner. |
| 4e | `returns the prepared run id before work settles and recovers a lost start response` (`wizard-generation-rpc.handlers.spec.ts:367`), including wrong-tab lookup. |
| 4f | `keeps a cancelled bound run cancelled when completion arrives late` (`wizard-generation-rpc.handlers.spec.ts:418`); one completion is emitted. |
| 4g | `cancel is a pause: aborts the run...` (`wizard-generation-rpc.handlers.spec.ts:1670`), `reuses the last run options and updates the same checkpoint record` (`:2099`), plus the bound-run tabless-cancel case (`:418`). |
| 4h | `rejects bound retry without its run and reuses the matching checkpoint model` (`wizard-generation-rpc.handlers.spec.ts:476`). |
| 4i | `parses a version-1 checkpoint without a tab binding and keeps final outcomes` (`wizard-generation-checkpoint.service.spec.ts:17`) and `binds an old checkpoint only on an authorized resume and retains its outcomes and model` (`wizard-generation-rpc.handlers.spec.ts:444`). |
| 4j | `requires renewed confirmation when a definite target changes after a bound preview` (`wizard-generation.preview-fidelity.spec.ts:535`), covering both changed and unchanged after re-preview. |
| 4k | `does not report completed when checkpoint finalization fails` (`wizard-generation-rpc.handlers.spec.ts:499`); `changes a successful payload to failure when finalization fails` (`wizard-generation-run.supervisor.spec.ts`). |
| 4l | `counts final outcomes rather than attempted-file summary totals` (`wizard-generation-run.supervisor.spec.ts:45`). The unsafe content path is covered by `writes the authored fallback when generated content fails safety validation` (`wizard-generation.preview-fidelity.spec.ts:582`). |

### Checks

- `npx nx run-many -t typecheck,lint -p "@ptah-extension/shared" "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1`: `NX Successfully ran targets typecheck, lint for 3 projects`.
- `npx nx run-many -t test -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1`: header `Running target test for 2 projects`; `NX Successfully ran target test for 2 projects`. Agent-generation used a matching local cache result; rpc-handlers ran. The first full test run exposed TS4111 in the new checkpoint spec; it was corrected and the final run passed.
- Focused handler suite: `Test Suites: 1 passed, 1 total; Tests: 80 passed, 80 total`. Focused preview fidelity suite: `Test Suites: 1 passed, 1 total; Tests: 7 passed, 7 total`.
- `ptah_get_diagnostics` remained unavailable after its 45-second timeout; Nx typecheck passed.

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Show an orphaned `running` checkpoint as `starting` without result | `starting`, `running`, fabricated `failed` | `SetupGenerationRunLifecycle` has no stalled value; an absent controller does not prove failure (`rpc-setup.types.ts:36-43`; `wizard-generation-rpc.handlers.ts:264-292`) | Yes |
| Search direct valid analyses and sort matching checkpoints by update time | Only latest; bounded direct list; recursive filesystem search | `AnalysisStorageService.list` enumerates valid direct analysis runs; checkpoints may be beside an older run (`analysis-storage.service.ts:626-646`) | Yes |
| Keep cancellation terminal even when an orchestrator returns late success | Trust late summary; trust abort reason | The supervisor has the abort signal and cancellation is authoritative (`wizard-generation-run.supervisor.ts:160`; `wizard-generation-rpc.handlers.ts:806-814`) | Yes |

### Open points

- The preview confirmation snapshot is process-local. A host restart requires the tab to preview again before bound submit.
- B03 still owns public registration of `wizard:get-generation-run-state`; this round left it internal.

## Revision round 2

- Added `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts`. It holds checkpoint-to-run-state mapping, tab workspace authorization, rejection and blocked response construction, verified analysis source resolution, provider/model routing, accepted response construction, and preview confirmation consumption. No DI registration or RPC name changed.
- Split submit handling into `registerSubmitSelection`, `executeSubmitInWorkspace`, `prepareSubmittedRun`, `launchSubmittedRun`, and `reportSubmitLaunchFailure`. Existing I/O sequence, error and log text, and response values were retained; no behavior change was intended.
- Final line counts: handler **1,698**, new binding file **292**. The longest submit method is `registerSubmitSelection` at **117 lines** (the launch method is 116). The requested handler size target of about 1,215 lines was **not met**; the split methods and parameter lists added lines.
- Checks: Prettier ran on both changed source files. `npx nx run-many -t typecheck,lint -p "@ptah-extension/rpc-handlers" "@ptah-extension/agent-generation" --parallel=1` passed all 4 targets. Focused wizard-generation Jest: **5 suites, 112 tests passed**. `npx nx test "@ptah-extension/rpc-handlers" --parallel=1` had **156 suites passed, 2 failed; 4,519 tests passed, 2 failed**. The failures were 5-second timeouts in `skills-sh-legacy-adoption.spec.ts` setup and `harness-proposal-store.service.spec.ts` concurrent write test, outside the edited files.

### Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep binding helpers as plain functions | New DI collaborator; plain functions | DI guard specs belong to B03; the helpers only need explicit inputs | Yes |
