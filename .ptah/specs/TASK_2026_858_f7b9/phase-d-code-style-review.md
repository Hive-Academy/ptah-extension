# Code Style Review — Phase D (TASK_2026_858_f7b9, Batches 14–19.3)

Scope: `git diff origin/main...HEAD` over `libs/backend/worker-runtime`, `libs/backend/worker-host`, `apps/ptah-electron` (83 files). Method: read project/eslint/tsconfig wiring, dispatch.ts, serve.ts, remote-sessions.ts, in-process-rpc.ts, admin-client.ts, workspace/grants/pair commands, ptah-electron project.json and validate-deps diffs, and grepped for casts, suppressions and cross-lib imports. I did not read every worker-runtime file in full (connection, token-store, transcript, readiness and similar were only grepped for imports and casts), so those files carry less assurance than the ones listed above. No Nx, Jest or verify run, as instructed.

## Summary

| Metric   | Value                                                                        |
| -------- | ---------------------------------------------------------------------------- |
| Score    | 6.5/10                                                                       |
| Verdict  | NEEDS_REVISION (no blockers; merge-able after the Serious items are triaged) |
| Blocking | 0                                                                            |
| Serious  | 4                                                                            |
| Minor    | 6                                                                            |

Positives: no `eslint-disable`, `@ts-ignore` or `as any` in production code. Both new libs carry `scope` and `type` tags. The scope:cli → scope:extension dependency is allowed by the depConstraints in `eslint.config.mjs`. Cross-lib imports go through barrels mapped in `tsconfig.base.json:116-120`. Degradation sites carry `degradation-audit` comments. Spec coverage is broad: security, connection, dispatch, serve sessions and packaging.

## Findings

### Serious

**S1. `serve.ts` is a 340-line closure that owns too many responsibilities** (`libs/backend/worker-host/src/lib/commands/serve.ts:72-409`)

- Evidence: `serveCommand` runs preflight checks, builds the push adapter, and builds the readiness probe (about 60 lines inline). It also adapts history, wires 15+ dependencies into `createRemoteSessions`, and holds the whole admin RPC dispatcher (`handle`, lines 265-352, five `admin.*` branches). It then builds `WorkerService`.
- The admin branches read their params with raw casts (`params as {...}` at lines 277 and 314) even though `WORKER_METHOD_SCHEMAS` exists and `admin-client.ts` already uses it on the client side. The server side does not validate with it.
- `admin.pairing.open` and `admin.grants.add` repeat the same "workspace id-or-path → id, else throw 'Unknown workspace'" mapping (lines ~283 and ~318).
- `admin.grants.add` hand-rolls the tmp-write-and-rename token persistence (lines 333-337). That belongs in `TokenStore`, which `grants.ts` and `pair.ts` go through.
- Fix: extract `createAdminHandler(deps)` into `admin-methods.ts` and `createReadinessProbes(...)` into its own unit. Add `registry.resolveIds(values)` to `WorkspaceRegistry` and `tokens.addWorkspaces(tokenId, ids)` to `TokenStore`. Parse admin params with `WORKER_METHOD_SCHEMAS[method].params`. `serveCommand` should then be about 120 lines of wiring.

**S2. Atomic file write is duplicated and has drifted** (`serve.ts:333-337`, `workspace.ts:36-38`, plus `token-store.ts` and `workspace-registry.ts` in worker-runtime)

- Evidence: the pattern `${path}.${process.pid}.tmp` → `writeFile(mode 0o600)` → `rename` is copied across the host commands. `withFileLock` has its own helper (`file-lock.ts`). `workspace remove` bypasses `WorkspaceRegistry` and writes the registry file directly. `register` goes through the registry, so add and remove are asymmetric.
- Impact: a format change to the workspaces or tokens file needs edits in 3-4 places, and the file mode is already easy to miss in one of them.
- Fix: add `WorkspaceRegistry.unregister(idOrPath)` and `TokenStore.update(...)`, both built on one `writeJsonAtomic(path, value)` in worker-runtime. The commands then call only the registry or store.

**S3. Repeated `as unknown as RpcSpec<...>` casts defeat the typed spec table** (`worker-runtime/src/lib/session-driver.ts:135,188,241`; `worker-host/src/lib/commands/remote-sessions.ts:173`; `worker-runtime/src/lib/session-event-log.ts:49`)

- Evidence: `IN_PROCESS_SPECS` (`in-process-rpc.ts`) types `chat:start`, `chat:continue` and `chat:abort` as one shared `chatSpec: RpcSpec<Nested>`. Each call site then double-casts it to the method's real result type. The nested `.passthrough()` schema stays loosely typed on purpose. The casts hide the mismatch and compile even if the real `RpcMethodResult` changes.
- Fix: make `InProcessRpc.call<M>` return `RpcCall<RpcMethodResult<M>>` internally from a spec map typed `{ [M in LocalMethod]: RpcSpec<RpcMethodResult<M>> }`. Do the single narrowing cast inside the table, with a comment, instead of at every call site. For `session-event-log.ts:49`, parse the header with a zod schema or add a type guard.

**S4. ptah-electron wiring for the worker host adds maintenance cost and duplicates the engine bundle config** (`apps/ptah-electron/project.json` `build-worker-host`; `scripts/validate-deps.js`; `src/config/esm-bundle-gate.spec.ts`)

- Evidence:
  - `build-worker-host` copies the 20-line `esbuildOptions` banner and the external list verbatim from the sibling builds. The `vscode` alias points at the cli-engine shim, which is correct, but the divergent external list (`@huggingface/transformers`, `kokoro-js`) has no comment saying why those differ.
  - `implicitDependencies` was added to `ptah-electron` (`worker-host`) although `build-worker-host` already uses it as an `@nx/esbuild` input. Check whether it forces affected runs for every worker-host change on the Electron app (it does, for the rationale given). Keep it, but say so in a comment, since JSON cannot carry one. Put the reason in the batch report.
  - `validate-deps.js` gained an allow-list with a long comment of optional imports ("each loaded in a try/catch"). It is a second hand-maintained list next to the existing one. Drift is likely when worker-host gains a lazy import.
  - `dispatch.ts` comment: "the ptah-electron ESM bundle gate relies on this fast entry guard". A test-only contract is encoded as a comment in production code. If someone moves the `!command` guard below the first `await import`, only the gate spec catches it.
- Fix: derive the shared banner and external list from one shared constant (a `targetDefaults` or `namedInputs` entry, or a shared JSON that the targets read). Generate or assert the optional-import list from the bundle metafile. Reference the gate spec by name from the dispatch comment.

### Minor

**M1. `dispatch.ts` repeats `(await import('./commands/x')).fn(await resolvePaths(), ...)` in every case** (`dispatch.ts`, ~10 call sites). A tiny `loadCommand` table (`{ status: () => import('./commands/status'), ... }`) would remove the noise. The lazy imports are justified and consistent with the CLI's fast-start pattern, so this is only about readability.

**M2. `dispatch.ts` hand-validates action grammar** (`workspace`, `grants`, `locks` branches use `includes` plus `rest.length` checks). `parseArgs` is already used for flags. Per-command usage strings are scattered. A per-command `parse(action, rest)` in each command file would keep usage next to the code.

**M3. Duplicate `__mocks__/wasm-bundle-dir.ts`** in `worker-runtime` and `worker-host`. Move to one shared test helper or reference one path from both `jest.config.ts` files.

**M4. `worker-host-profile.spec.ts` exists in both libs.** The one in worker-host checks the runtime's profile against cli-engine, but the profile lives in worker-runtime (`worker-runtime/src/lib/worker-host-profile.ts`). That is correct for the cross-lib comparison, but it hides the real subject. Rename the host-side spec to `worker-rpc-surface.spec.ts`.

**M5. `worker-runtime` imports the whole `@ptah-extension/rpc-handlers` barrel** (`worker-host-profile.ts:1`, and one more use of `RPC_CAPABILITIES`). rpc-handlers has only the single `src/index.ts` entry in `tsconfig.base.json:206`, so there is no narrower entry point today. The cost is that the profile builder pulls in the full handler graph at import time. It is `type:feature` → `type:feature` within `scope:extension`, so lint is fine. If worker-runtime stays lightweight for lazy import, add a secondary entry point (`@ptah-extension/rpc-handlers/host-profile`) exporting `capabilities`, `HostProfile`, `RPC_CAPABILITIES` and `deriveRpcSurface`. It is not urgent because every consumer imports it lazily.

**M6. Untracked `libs/backend/worker-host/docs/worker.md` and `batch-19.4-report.md`.** Make sure they are added or removed deliberately. User docs inside a lib folder are unusual here; check where sibling libs keep theirs.

## Five style questions

1. **Six months:** a new admin method needs edits in `serve.ts` `handle`, `admin-client`, `grants.ts` and `WORKER_METHOD_SCHEMAS`. The server branch is unvalidated (S1).
2. **Misread:** `worker-host` is `scope:cli` but ships inside Electron; the name "cli" will mislead. `remote-sessions.ts` (530 lines) lives in `worker-host/commands/` but is a session composition layer, not a command.
3. **Cost:** the 340-line closure, the double-cast table (S3), and the three-place hand-maintained bundle config (S4).
4. **Inconsistent:** sibling libs keep persistence behind a store class; here the commands write files directly (S2). Sibling cli-engine entries are not lazy-imported to this degree.
5. **Differently:** move `remote-sessions.ts` to worker-runtime (it takes `runtime` as a parameter only to dodge a static import, which suggests it belongs there), and keep worker-host as dispatch plus thin commands.

## Pattern compliance

| Rule                                   | Status | Evidence                                                                                |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| Tags scope + type on new projects      | PASS   | worker-host/project.json, worker-runtime/project.json                                   |
| No eslint-disable of module boundaries | PASS   | grep of both libs                                                                       |
| Barrel / mapped imports only           | PASS   | tsconfig.base.json:116-120                                                              |
| No `as any` / `@ts-ignore`             | PASS   | grep                                                                                    |
| Narrow casts                           | FAIL   | S3                                                                                      |
| Persistence behind stores              | FAIL   | S2                                                                                      |
| Ports from platform-core, not adapters | PASS   | remote-sessions.ts imports `ISessionDriverLock`, `IWorkspaceLifecycleProvider` as types |

## Verdict

- Recommendation: REVISE (minor effort; none blocks merge)
- Confidence: MEDIUM (partial read of worker-runtime internals)
- Key concern: `serve.ts` accumulates admin handling, readiness and persistence, with unvalidated admin params and duplicated atomic writes.
