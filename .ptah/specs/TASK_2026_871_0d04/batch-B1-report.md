# Batch B1 report

## Files changed

- libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts ? added required filesystem operations.
- libs/backend/platform-core/src/testing/mocks/file-system-provider.mock.ts ? added operation defaults.
- libs/backend/platform-core/src/testing/contracts/run-file-system-contract.ts ? added bounded-read and metadata assertions.
- libs/backend/platform-electron/src/implementations/electron-file-system-provider.ts ? added no-follow bounded reads and metadata.
- libs/backend/platform-electron/src/implementations/electron-file-system.spec.ts ? forwarded new methods in contract wrapper.
- libs/backend/platform-cli/src/implementations/cli-file-system-provider.ts ? added no-follow bounded reads and metadata.
- libs/backend/platform-cli/src/implementations/cli-file-system-provider.spec.ts ? forwarded new methods in contract wrapper.
- libs/shared/src/lib/types/rpc/rpc-tasks.types.ts ? added request and result contracts.
- libs/shared/src/lib/types/rpc.types.ts ? registered two RPC method types and names.
- libs/shared/src/lib/types/task-spec.types.ts ? added optional typed entries for compatibility.
- libs/shared/src/lib/types/task-folder-markdown-eligibility.ts ? added pure eligibility predicate.
- libs/shared/src/lib/types/task-folder-markdown-eligibility.spec.ts ? added predicate examples.
- libs/backend/task-specs/src/lib/task-index.service.ts ? added contained read/list and typed detail entries.
- libs/backend/task-specs/src/lib/task-index.service.spec.ts ? extended fake and added read/list smoke test.
- libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts ? added shape schemas.
- libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts ? registered two methods.
- libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.spec.ts ? updated registration and parameter matrix.
- apps/ptah-electron/src/replay/scenario-sanitizer.ts ? allowlisted read-only methods.
- apps/ptah-electron/src/replay/scenario-sanitizer.spec.ts ? asserted allowlist.
- libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts ? extended typed fake.
- libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts ? extended typed fake.
- libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts ? extended typed fake.
- libs/backend/workspace-intelligence/src/services/file-system.service.spec.ts ? added the three port methods to an independently typed fixture.
- libs/backend/cli-engine/src/lib/container-attention.spec.ts ? asserted CLI DI resolves all three filesystem methods.
- libs/backend/agent-generation/src/lib/services/generated-section-validator.spec.ts ? extended typed fake.

## Acceptance checklist

- Partial: Required port methods implemented in Electron, CLI, core mock and independently typed fixtures. Contract tests added.
- Partial: Two RPC methods registered in shared types, Zod, handler and Electron replay sanitizer.
- Partial: Service checks canonical containment and file type, uses 1 MiB bounded UTF-8 reads, and limits listing depth and count.
- Partial: Typed entries added to detail and legacy artifacts derived from them; entries are optional at the type level for existing consumers.
- Not complete: Real junction/escape and mocked race regression tests, DI resolution assertions, and host-source/RPC-surface guard execution.
- Not verified: All scoped project verifies failed before checks because Nx plugin subprocess spawn returned EPERM.

## Verify commands

- `npm run verify -- -p @ptah-extension/platform-core` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/platform-electron` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/platform-cli` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/shared` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/task-specs` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/rpc-handlers` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/cli-engine` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p ptah-electron` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/lane-routing` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/workspace-intelligence` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/vscode-lm-tools` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/agent-generation` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/output-styles` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/memory-curator` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/cli-agent-runtime` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.
- `npm run verify -- -p @ptah-extension/skill-synthesis` ? FAIL: Nx Jest/ESLint plugin `spawn EPERM`; project checks did not run.

## Shared index export

The orchestrator has already added exactly:

```ts
export * from './lib/types/task-folder-markdown-eligibility';
```

## Decisions

- Used required port methods rather than a task-specs Node filesystem dependency. Evidence: existing port injection and approved plan. Reversible: yes.
- Kept `TaskSpecDetail.entries` optional to preserve existing typed consumer fixtures; the service populates it on successful detail reads. Reversible: yes.

## Deviations from plan

- The service mirrors the shared predicate expression locally; the B2-owned public index now exports the predicate.
- Follow-up added a CLI port resolution assertion and a real Electron junction test. The Electron smoke guard already registers the filesystem token and the production handler phase already registers `TasksRpcHandlers`; its existing assertions did not fail.

## Open issues

- Nx verification is environment-blocked by `spawn EPERM` in all 16 required commands; Ptah diagnostics also timed out without checking files.
- The added containment regression tests have passed typecheck but have not run under Jest in this sandbox. Orchestrator verification is still required.
- Skill discovery was unavailable in this lane.

## Fix round 1

- Shared RPC declarations: inspected `rpc.types.ts`; each new method appears once in the method map and once in the method-name registry. `npx tsc --noEmit -p libs/shared/tsconfig.lib.json` passed. No edit was necessary in this round because the duplicate was already absent in the current worktree.
- Added the three required methods to `libs/backend/workspace-intelligence/src/services/file-system.service.spec.ts:19`. The full-worktree `Mocked<IFileSystemProvider>` census also found cast-backed literals in `workspace-intelligence/src/services/code-symbol-indexer.service.spec.ts:29` and `vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts:93`; both use explicit `as unknown as` casts and are outside the newly assigned file. The typed literal in `vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts:56` already has the three methods. No other uncast typed object literal was found.
- Added `task-index.service.spec.ts` regressions for a linked folder, a canonical path escape, and a bounded-read race. Changed the service to return `rejected` for invalid task ids and canonical containment failures.
- Added a real directory junction assertion in `platform-electron/src/implementations/electron-file-system.spec.ts` using `fs.symlink(..., 'junction')` on Windows. No file symlink was created.
- Added a CLI filesystem DI assertion in `cli-engine/src/lib/container-attention.spec.ts`. The Electron production registration and existing smoke registration were inspected; no guard edit was needed.
- Direct typechecks passed: `npx tsc --noEmit -p libs/shared/tsconfig.lib.json`, `npx tsc --noEmit -p libs/backend/workspace-intelligence/tsconfig.spec.json`, `npx tsc --noEmit -p libs/backend/task-specs/tsconfig.spec.json`, `npx tsc --noEmit -p libs/backend/platform-electron/tsconfig.spec.json`, and `npx tsc --noEmit -p libs/backend/cli-engine/tsconfig.spec.json` (all produced no errors).
- Ptah scoped diagnostics remained unavailable after 45 seconds; direct `tsc` supplied the typecheck evidence above. Nx verify was not rerun.
