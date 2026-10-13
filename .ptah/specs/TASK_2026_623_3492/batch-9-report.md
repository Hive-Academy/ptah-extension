## Backend implementation — `TASK_2026_623_3492`, batch 9

**Tasks completed**: 9.1 (handler class, zod schema, spec), 9.2 (barrel, manifest entry, capability)

**Files**:

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.schema.ts — `LanePlanLimitsParamsSchema = z.object({}).strict()` (boot-rpc.schema.ts pattern).
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.ts — `@injectable() LanePlanLimitsRpcHandlers`, `METHODS = ['agent:getLanePlanLimits']`, injects `TOKENS.LOGGER`, `TOKENS.RPC_HANDLER`, `TOKENS.PTAH_API_BUILDER`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\lane-plan-limits-rpc.handlers.spec.ts — 21 cases (response, sentinel, recording proxy, params, failure).
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\handlers\index.ts — exports `LanePlanLimitsRpcHandlers`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts — entry `{ key: 'lanePlanLimits', methods: LanePlanLimitsRpcHandlers.METHODS, requires: ['lanePlanLimits'], handler: LanePlanLimitsRpcHandlers }` after `diagnosticsConsent`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\host-profile\capabilities.ts — `'lanePlanLimits'` added to `RPC_CAPABILITIES`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\lib\host-profile\host-profile.ts — `lanePlanLimits: false` in `ALL_DISABLED` (see deviations).

**Stack observed**: tsyringe `@injectable()`/`@inject(TOKENS.*)` (diagnostics-consent-rpc.handlers.ts:98-128); registration via `rpcHandler.registerMethod` in `register()`, resolved by `registerRpcSurface` from the manifest (manifest.ts:459-467); zod `.strict()` boundary schemas (boot-rpc.schema.ts:14); `RpcUserError(message, code)` from vscode-core (rpc-types.ts:87-95); `formatPlanLimitRows` / `type AgentLimit` / `type PtahAPI` / `PtahAPIBuilder` from the vscode-lm-tools barrel (index.ts:6-38).

**Implementation notes**:

- A1 resolved: `PtahAPIBuilder.build()` (ptah-api-builder.service.ts:543) is NOT memoized — every call constructs all namespaces. The handler builds lazily on the first read and keeps the `PtahAPI` (`this.api ??= this.apiBuilder.build()`); a failed build is not cached, so the next read retries. Specs: "builds the API once, lazily, and reuses it"; "registers ... without building the API"; "retries the build on the next read after a failed build".
- Read path: `agent.list()` then `agent.limits?.(rows)` with exactly one argument; no `refresh`, no spawn/stop/session access. Rows = `formatPlanLimitRows(limits, now).map(toRow)` taking cells 0-4 only; Source (cell 5) is never mapped. Scalars per lane by `state.state`; `lanes = limits.length`; `asOf = now`. Response built field by field.
- Logging: only fixed text plus `errorName` on failure; never row contents or error messages.

**Risks handled**:

- `$limits` privacy / side effects (HIGH): recording `Proxy` over `PtahAPI` and `agent` asserts the only namespace read is `agent` and the only agent keys read are `list` and `limits`; ten lane methods (`spawn`, `stop`, `continue`, `steer`, `message`, `status`, `read`, `wait`, `report`, `listRoles`) are never called; `list` gets 0 args and `limits` exactly 1 (the same rows array), list before limits; `JSON.stringify` of every call's arguments has no `"refresh"`; `{ refresh: true }` params are rejected with `INVALID_PARAMS` before any build or lookup. Sentinel test: owner.key, owner.label, account.planType, a row `cliSessionId`, Ptah CLI `providerId`, and an email (as `providerName`) are all absent from `JSON.stringify(response)`; the same sentinels plus row text ("Team lane", "5-hour session") are absent from every logger call, including a `list()` error whose message holds the email. "never sends the Source cell" proves `provider-api` (cell 5 only) is absent.
- Failure → "unavailable" edge case: per-lane lookup failures (the namespace's `lookup: 'failed'`) come back as rows with state "limit lookup failed" and count as `unknown`; `limits` returning `undefined`, a missing `limits` function, a throwing `list()` or a throwing `build()` reject with the fixed text "Lane plan limits are unavailable on this host" and do not include the internal message.
- Known red window (MEDIUM): manifest coverage and host `rpc-surface` / `container.smoke` specs were not run (Batches 10-12). `resolve-handler-plan.spec.ts` passes.

**Verification**:

- Jest (with the Batch 8 accepted worktree mapper, since the worktree has no `node_modules`): `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{"^vscode$":"<worktree>/__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'` → Test Suites: 2 passed; Tests: 27 passed. (The plain command fails before tests run: "Could not locate module marked".)
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1` → Successfully ran target typecheck.
- `npx nx lint @ptah-extension/rpc-handlers --parallel=1` → 0 errors, 50 warnings (all baseline; none in changed files).

**Plan deviations**:

- `host-profile.ts` (not in the batch file list) gained `lanePlanLimits: false`. `ALL_DISABLED` is typed `Record<Capability, boolean>`, so the capability cannot exist without it; this is where "defaults to false" is actually set.
- Unavailable lookup throws a plain `Error` with fixed text, not `RpcUserError` as plan line 1014 says. `RpcUserErrorCode` (shared rpc-error-codes.types.ts:7-28) has no code that fits "unavailable", and adding one would mean editing `shared`, which is outside this batch. In Electron the lookup is always bound, so `undefined` there means a wiring fault, and that should be reported. Invalid params use `RpcUserError(..., 'INVALID_PARAMS')`.
- The spec mocks `workspace-intelligence/src/ast/wasm-bundle-dir`, as `diagnostics-consent-rpc.handlers.spec.ts:23` does, so it can import the real vscode-lm-tools barrel (`import.meta.url` cannot be parsed under CommonJS ts-jest). The formatter under test is the real one.
- One `// eslint-disable-next-line preserve-caught-error` in the handler, with a comment. The cause is dropped on purpose because its message may quote a lane, a path or an account, and error reporting would forward a linked cause.

**Out-of-scope observations**:

- `libs/backend/rpc-handlers/src/index.ts` does not yet re-export `LanePlanLimitsRpcHandlers` from the package root. Batch 11 owns that file (batches.md:647).
- Electron profile `lanePlanLimits: true` and the VS Code / CLI expected-absent lists are Batches 11-12. Until then no host serves the method, and the manifest-coverage and host surface specs stay red as planned.
