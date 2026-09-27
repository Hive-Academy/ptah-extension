# Batch 37b1c executor report: `diagnosticsConsent` RPC family (Lane K)

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-559-lane-k`, branch `fix/task-559-lane-k`, base 668dd181d
(37b1a + 37b1b). No git command changed state. The tree is left dirty for the team leader.

`RH` = `libs/backend/rpc-handlers/src/lib`.

## Files

| Status   | File                                                    | Change |
| -------- | ------------------------------------------------------- | ------ |
| MODIFIED | `libs/shared/src/lib/types/rpc.types.ts`                | `diagnostics:go-vet-consent-get` / `-set` in `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`; inline DTOs (`GoVetConsentStateDto`, `GoVetConsentStaleReasonDto`, `DiagnosticsGoVetConsent{Get,Set}{Params,Result}`, `DiagnosticsGoVetConsentSetError`) with the O2 §3 shapes |
| MODIFIED | `RH/host-profile/capabilities.ts`                       | `goVetDiagnostics` appended to `RPC_CAPABILITIES` |
| MODIFIED | `RH/host-profile/host-profile.ts`                       | `goVetDiagnostics: false` in `ALL_DISABLED` |
| MODIFIED | `RH/host-profile/manifest.ts`                           | Entry `diagnosticsConsent`, `requires: ['goVetDiagnostics']`, lib-owned handler (imported from its file directly; `handlers/index.ts` is not in the batch list) |
| CREATED  | `RH/handlers/diagnostics-consent-rpc.handlers.ts`       | `DiagnosticsConsentRpcHandlers` (GET/SET) |
| CREATED  | `RH/handlers/diagnostics-consent-rpc.handlers.spec.ts`  | O2 §7.3 cases 1-11, Decision 25 `go-changed`, win32 case-fold (19 tests) |
| MODIFIED | `libs/backend/vscode-core/src/messaging/rpc-handler.ts` | **Outside the batch list** — `'diagnostics:'` added to `ALLOWED_METHOD_PREFIXES` (see Deviations 1) |

## Behaviour

- **Params at the boundary.** Strict zod: GET `{}` (unknown key → throws the fixed text `invalid-params`); SET
  `{ enabled: boolean, workspaceRoot: string (1..4096), source: 'settings-ui' | 'cli' }`, unknown keys rejected →
  `{ success:false, error:'invalid-params' }`.
- **Check order (O2 §3, all before any write).** invalid-params → `unsupported` (storage not workspace-scoped) →
  `no-workspace` (active = `lifecycle.getActiveFolder() ?? wsProvider.getWorkspaceRoot()`, matched to a registered
  storage key: exact `path.resolve`, then win32 case-folded over `getAllWorkspacePaths()`; no fallback) →
  `workspace-changed` (caller `workspaceRoot` vs active root, `path.resolve`, win32 case-folded; the caller value is
  only compared, the write target is always the host's registered active root) → grant: `resolveGoBinary` (same
  `userDataPath` as the checker) → `no-go-binary`; revoke: `update(key, undefined)` → `persist-failed` on any throw.
- **Read-back before success.** Grant: `GoVetConsentStore.read(root, binary)` must be `on`. Revoke: the key must be
  absent from the root's own storage (`get` and `keys()`) AND the store must answer `off` (the store also answers
  `off` on a failed read, so the key check is what proves deletion). Mismatch → `persist-failed`. Revoke is idempotent.
- **Audit (O2 §6).** `[Diagnostics] go vet consent changed` `{ workspaceHash (sha256(path.resolve(root)).slice(0,16)), enabled, source }`,
  only after a successful read-back. Write failures and read-back mismatches log a fixed-text `warn` with the hash only;
  no error text or path reaches the log or the caller.
- **GET.** `{ supported, workspace: {root} | null, state, staleReason?, goBinary? }`. `on` shows the recorded binary;
  `off`/`stale` show the binary a grant would record now. `stale` carries `staleReason` (`root-moved`, `root-replaced`,
  `go-changed`; Decision 25), never reported as `on`.
- **No repository path enables consent.** The handler reads/writes only through `GoVetConsentStore` over
  `WORKSPACE_STATE_STORAGE` in the host user-data dir; spec case 1 walks the user-data dir and both roots and finds the
  key in exactly one file, the root's own `workspace-state.json`.
- SET calls are serialised (promise chain) so each read-back observes its own write.
- DI: `LOGGER`, `RPC_HANDLER`, `WORKSPACE_PROVIDER`, `WORKSPACE_LIFECYCLE_PROVIDER`, `WORKSPACE_STATE_STORAGE`,
  `PLATFORM_INFO` (`globalStoragePath` = user-data dir, confirmed equal in both hosts by 37b1a). Both Electron and
  cli-engine register all six (`platform-electron/src/registration.ts:134,157`, `platform-cli/src/registration.ts:71,84`).

## FB evidence

- Base (668dd181d): the handler file and the registry entries do not exist, so the new spec cannot compile.
- Mutations against the finished handler (each restored; file byte-identical afterwards, `cmp`):

| Mutation | Result |
| --- | --- |
| Stale-UI guard removed | **2 failed** (cases 9, 10) |
| Read-back ignored | **1 failed** (case 8 read-back) |
| GET reports `stale` as `off` | **1 failed** (Decision 25) |
| Revoke read-back without the key check | 19 passed (the store read also catches it here; the key check is defence in depth) |

- Final: `nx test @ptah-extension/rpc-handlers --testFile=diagnostics-consent-rpc.handlers.spec.ts` → 19 passed.

## Verification (tail only)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/vscode-core --skip-nx-cache --parallel=2`
  (3 projects, 9 tasks): 8 succeeded; `rpc-handlers:test` failed — 7 suites / 106 passed, 3151 tests passed, 1 failed:
  - 6 suites (`rpc-allowlist`, `resolve-handler-plan`, `surface-rpc.handlers{,.deadline,.submit}`, `output-style-rpc.handlers`)
    fail at module load, **not caused by this batch**: `vscode-lm-tools` calls `recognisedSourceExtensions()` and
    `supportedLanguagesFor()` at import time, and `RH/../test-utils/heavy-module-mocks.ts` (the WI mock these suites use)
    has neither (the calls came in with earlier merged batches, e.g. 24d `2509540e2`; the mock is unchanged at HEAD and on
    the integration tip a01cc0d21). With a temporary 2-line stub added to that mock (reverted; `git diff` clean) all 6
    suites pass: **143 passed**, including `rpc-allowlist` (manifest disjoint/total + prefix guard for the new methods)
    and `resolve-handler-plan`.
  - `harness-skill-selection-rpc.service.spec.ts` "never writes state.json" — the known flake; it also fails alone
    (1 failed / 8 passed) because `%TEMP%/.ptah` exists on this machine (dated 09-26, not created by this batch).
- ESLint on the changed files: 0 errors; 1 pre-existing `max-lines` warning on `rpc.types.ts`. Prettier: clean.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron` → success (2 projects).
- `nx run ptah-electron:validate-deps` → "All external imports are covered by package.json dependencies".
- `nx run degradation-audit:lint` → TOTAL 300 (rpc-handlers 1/1, shared 3/3).
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` unchanged. No `as any`/`@ts-ignore`; `catch (error: unknown)`; package-alias imports.

## Deviations

1. **`vscode-core/src/messaging/rpc-handler.ts` edited (7th file, 3rd lib).** `RpcHandler` refuses to register a
   method whose prefix is not in `ALLOWED_METHOD_PREFIXES`, and `rpc-allowlist.spec.ts` enforces it. Without
   `'diagnostics:'` the O2 method names cannot be served. One line; `@ptah-extension/vscode-core` added to the scoped
   run (test/lint/typecheck green). Revert only together with renaming the methods.
2. **Per-root storage in the spec is a copy of `CliStateStorage`, not the class.** `platform-cli` is `scope:cli`;
   `rpc-handlers` is `scope:extension` and `@nx/enforce-module-boundaries` (spec files included) forbids the import.
   `JsonFileStateStorage` in the spec is its line-for-line logic (JSON file, atomic rename, `undefined` deletes). The
   real `WorkspaceAwareStateStorage` + `WorkspaceContextManager` register the roots. 37b1d's cli-engine wiring spec
   (`scope:cli`) can exercise the real class.
3. **Spec stubs `workspace-intelligence/src/ast/wasm-bundle-dir` by relative `jest.mock` path.** The WI barrel cannot
   load under CommonJS ts-jest in this lib (`import.meta.url`); no rpc-handlers precedent loads the real barrel. The
   stub covers only that module; the store, resolver and checker are real.
4. **Schemas live in the handler file** (no `*.schema.ts`), to stay within the listed files.

## For 37b1d / later

- Adding the capability with every profile `false` shrinks Electron's served set: `apps/ptah-electron/src/di/rpc-surface.spec.ts`
  ("excludes nothing") and `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (`CLI_EXPECTED_ABSENT_METHODS`)
  fail until 37b1d sets `goVetDiagnostics: true` in both profiles. **Not owned by any batch:**
  `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` enumerates VS Code's excluded methods and must gain the two
  `diagnostics:go-vet-consent-*` methods (VS Code keeps the capability off).
- `heavy-module-mocks.ts` needs `recognisedSourceExtensions` and `supportedLanguagesFor` stubs to un-break 6 rpc-handlers suites (pre-existing).

## Follow-up

Coordinator follow-up round. No git command changed state; only `git show <rev>:<path>` and `git merge-base --is-ancestor` were used for reading.

### 1. The WI mock gap predates 37b1c

- `git show 1eab01c35:libs/backend/rpc-handlers/src/test-utils/heavy-module-mocks.ts`: 0 matches for
  `recognisedSourceExtensions` or `supportedLanguagesFor`.
- `git show bf1a2b11b:libs/backend/workspace-intelligence/src/index.ts:124-125` (Batch 24c) exports both. Both
  bf1a2b11b and 1eab01c35 are ancestors of HEAD. `vscode-lm-tools` calls them at module load
  (`analysis-namespace.builders.ts:397`, `tool-description.builder.ts:40`), so every spec that mocks WI without them and
  reaches `handlers/index.ts` fails to load.
- **Fix (MODIFIED `libs/backend/rpc-handlers/src/test-utils/heavy-module-mocks.ts`).** The stubs follow the real
  signatures in `ast/language-registry.ts:298,315`: `recognisedSourceExtensions()` returns dotted lower-case extensions
  (`.ts .tsx .js .jsx`), and `supportedLanguagesFor()` returns `LanguageId`s in `LANGUAGE_IDS` order (`typescript
  javascript tsx`).
- The same gap broke `apps/ptah-extension-vscode/src/integration/wizard-seed-noop.spec.ts`, which has its own inline WI
  mock (0 matches at 1eab01c35). **MODIFIED** with the same two stubs. That file was needed so that
  `ptah-extension-vscode:test` goes green.

### 2. VS Code surface spec

MODIFIED `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`: `diagnostics:go-vet-consent-get` and `-set` were added
to `VSCODE_EXPECTED_ABSENT_METHODS`, in sorted position after `db:reset`. The comment names TASK_2026_559 Batch 37b and
O2 §3/§5.3.

### 3. harness-skill-selection is the known environment flake

It fails alone (1 failed / 8 passed) and in the full run on "never writes state.json". The mechanism:

- The spec's temp workspace is `mkdtemp(os.tmpdir()/…)`.
- `resolveHarnessWorkspaceRoot` (`harness-sync/src/lib/workspace/workspace-root.ts:66-81`) walks up to the nearest
  ancestor that holds a `.ptah` marker.
- `%TEMP%/.ptah` exists on this machine (dated 09-26) and holds `harness/state.json`. The root therefore resolves to
  `%TEMP%`, and `state.json` "exists" before the call.

No file of this batch is on that path. It is not fixed, as instructed.

### Verification

`node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/vscode-core ptah-extension-vscode --skip-nx-cache --parallel=2`
- Header: 4 projects (rpc-handlers, shared, vscode-core, ptah-extension-vscode) and 27 dependency tasks.
- **Only failed task:** `@ptah-extension/rpc-handlers:test`, from the harness-skill-selection flake alone. rpc-handlers
  gives 112/113 suites and 3294 passed, 1 failed, 4 skipped.
- Every other target is green, including `ptah-extension-vscode:test` (9/9 suites, including `rpc-surface.spec.ts` and
  `wizard-seed-noop.spec.ts`) and the lint and typecheck targets of all 4 projects.
- The 6 suites that failed on load before this round (including `rpc-allowlist` and `resolve-handler-plan`) now pass.
- Prettier: clean on the 3 edited files.
