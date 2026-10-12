## Backend implementation — `TASK_2026_623_3492`, batch 7

**Tasks completed**: Task 7.1 `agent:getLanePlanLimits` types and registration (L1)

**Files**:

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc\rpc-lane-plan-limits.types.ts — `AgentGetLanePlanLimitsParams` (`Record<string, never>`), `AgentLanePlanLimitRow` (5 readonly string cells), `AgentGetLanePlanLimitsResult` (`rows`, `lanes`, `atLimit`, `nearLimit`, `unknown`, `asOf`). These are closed interfaces with no index signature, written exactly as implementation-plan.md:1000-1004 gives them.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc\rpc-lane-plan-limits.contract.spec.ts — compile-time `Expect<Equals<>>` checks and a runtime fixture based on R10.10 (3 lanes, 4 rows), plus the R10.4 privacy sentinel. 10 tests.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\lib\types\rpc.types.ts — `export * from './rpc/rpc-lane-plan-limits.types'` plus a type import, a registry entry `'agent:getLanePlanLimits'` after `agent:backgroundList` (around line 1381), and an `RPC_METHOD_ENTRIES` entry after `'agent:backgroundList': true` (around line 3882) with a dual-registration comment in the style of lines 4027-4066. `provider:getPlanLimits` is not touched.

**Stack observed**:

- TypeScript shared library. Wire contracts live under `libs/shared/src/lib/types/rpc/` and are re-exported from the `rpc.types.ts` barrel (lines 11-42).
- Methods are registered twice, in `RpcMethodRegistry` and in `RPC_METHOD_ENTRIES: Record<RpcMethodName, true>`. The `_AssertAllRpcMethodsListed` drift check (rpc.types.ts:4196-4202) enforces this at compile time.
- The `agent:` prefix is already in `ALLOWED_METHOD_PREFIXES` (`libs/backend/vscode-core/src/messaging/rpc-handler.ts:66`), so no runtime guard entry is needed.
- Jest uses ts-jest with full type-checking (`libs/shared/jest.config.ts` and `tsconfig.spec.json`), so the spec's type assertions and `@ts-expect-error` lines are enforced when Jest runs.
- ESLint's `varsIgnorePattern: '^_'` (root `eslint.config.mjs:420-424`) allows the module-private `type _X = Expect<...>` aliases. `rpc.types.ts:4196` uses the same pattern.

**What the contract spec pins**:

- **Exact key sets (R10.1).** `keyof AgentLanePlanLimitRow` equals `lane|window|used|state|reset`. `keyof Result` equals the six R10.1 keys. Both shapes are checked structurally to be exact: every cell is `readonly string`, the scalars and `asOf` are `number`, and `rows` is a readonly array. At runtime, `Object.keys` on the fixture and on each row must equal the same lists.
- **Text cells (R10.3).** Each row has exactly five string cells, and none is empty. The fixture uses the list's own words: "(none)", "unknown", "reset unknown", "-", "Unknown".
- **Scalars count lanes, not rows.** The fixture has 4 rows and 3 lanes. `lanes` equals the number of distinct lanes, the scalars are integers, and `asOf` is carried through.
- **Params.** The params type is exactly `Record<string, never>`, so no `refresh` flag can be sent (decisions.md #18).
- **Registry.** `RpcMethodParams` and `RpcMethodResult` for `'agent:getLanePlanLimits'` resolve to the new types. `RPC_METHOD_NAMES` contains the method exactly once.
- **`provider:getPlanLimits` unchanged.** Its params type still equals `ProviderGetPlanLimitsParams`. Its result and `ProviderGetPlanLimitsResult` still equal `PlanLimitsSnapshot`.
- **Privacy sentinel (R10.4).**
  - Type level: no key of the row or of the result appears in the set of forbidden identifying keys. That set is the explicit list (owner, owners, ownerKey, key, label, identityKind, fingerprint, account, accountId, planType, providerId, ptahCliId, cliSessionId, sessionId, sessionOwners, email, credential, token) plus every key of `QuotaOwnerRef`, `PlanLimitOwnerSnapshot` and `PlanLimitsSnapshot`.
  - Excess-property checks: `@ts-expect-error` cases add owner, account, providerId, cliSessionId or email to the result and to a row. Each directive sits on the property's own line so formatting cannot move it.
  - A `PlanLimitsSnapshot` cannot be assigned to the result type, which rules out forwarding the snapshot.
  - At runtime, `JSON.stringify(response)` contains none of the forbidden keys, none of the sentinel values (owner key, label, plan type, CLI session id, Ptah CLI provider id, email), and no email-shaped string.
  - Mutation check: I made a temporary copy of the types file that adds `providerId` to the row, plus a copy of the spec that imports it. The copied suite failed to compile (0 tests ran), which proves the sentinel catches the leak. Both temporary files were deleted afterwards.

**Verification** (run one at a time, from the worktree root):

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/rpc/rpc-lane-plan-limits.contract.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40` → Test Suites: 1 passed. Tests: 10 passed, 10 total.
- `npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20` → "Successfully ran target typecheck for project @ptah-extension/shared".
- `npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20` → 0 errors, 6 warnings. These are the 6 known baseline warnings: `rpc.types.ts` max-lines was already over the limit, plus `json.utils.ts`, `surface-data-model.ts` ×2 and `surface.schemas.ts`. Two warnings are not in the output I captured. The new files add no warnings.
- `npx prettier --check` on the 3 changed files → all formatted.
- I did not run the declarative-dashboard typecheck (decision #21), or any build, serve, e2e or workspace-wide target.

**Risks and edge cases from the plan validation section**:

- **HIGH, `$limits` privacy and side effects.** This batch handles the type half. Every type is field-by-field and closed, and the sentinel above is pinned at compile time and at runtime. The params type cannot carry `refresh`. The recording-proxy and no-spawn checks belong to Task 9.1, and the lookup-level no-`refresh` check belongs to Task 10.1.
- **MEDIUM, red cross-project specs between commits.** As predicted, `agent:getLanePlanLimits` is now in `RPC_METHOD_ENTRIES`, but no manifest entry or handler owns it yet. Until Batches 9-12 land, manifest coverage (`libs/backend/rpc-handlers/.../manifest.ts`, `resolve-handler-plan.spec.ts`) and the host `rpc-surface` and `container.smoke` specs may be red. I did not run them because they are outside this batch's project. Batches 7-12 should run back to back.
- **Edge case: `$limits` RPC failure or VS Code host shows "unavailable".** No contract change is needed. Failure is an RPC error, not a result variant, so the result type has no error or partial fields that could carry diagnostics. This is handled in Tasks 9.1 and 17.2.
- **Assumption A5 (capability defaults to false).** Not touched here. The capability and the expected-absent lists are Task 12.1.

**Plan deviations**: none. The plan cites rpc.types.ts lines `:750` and `:3723`. Those anchors are still accurate (registry interface at about 757, `RPC_METHOD_ENTRIES` at about 3730 after my edits).

**Out-of-scope observations**: `rpc.types.ts` is far over max-lines (an existing warning, now about 3530 counted lines). This batch added only about 18 lines there. Contract types went into the new child file, following the file's own split convention.
