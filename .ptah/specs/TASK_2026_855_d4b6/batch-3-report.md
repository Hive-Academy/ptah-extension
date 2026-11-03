# Batch 3 report — TASK_2026_855_d4b6

## Changed paths

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capabilities.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.harness-preflight.spec.ts`

## Behavior

`resolveSessionCapabilityPolicy` accepts optional ordered `pluginConfigAncestorRoots`. When absent it calls `resolve(cwd)` exactly as before. An explicit empty list and a nonempty list are passed unchanged in `{ pluginConfigAncestorRoots }`. Missing or throwing resolvers still produce the unverified restrictive policy.

`SessionQueryExecutor.executeQuery` reads roots from its per-query `sessionConfig` and resolves once before harness preflight. The same `EffectiveCapabilitySet` goes to harness sync and SDK options. The execution cwd, policy physical root, harness destination, MCP configuration and plugin catalog remain sourced from the execution root; roots are used only by the resolver's plugin configuration read. Each query creation reads its own current config, with no cross-query cache or active-query update.

Batch 4 wiring point: add `pluginConfigAncestorRoots?: readonly string[]` to `AISessionConfig` in `libs/shared/src/lib/types/ai-provider.types.ts`, then populate that field on the `sessionConfig` supplied to `SessionLifecycleManager.executeQuery` and `executeSlashCommandQuery`. The facade forwards `sessionConfig` to `SessionQueryExecutor.executeQuery` at `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:829` and `:904`; the executor already reads the field. No separate builder resolution or second context path is needed.

## Decisions

- **Decision:** Read the optional lineage on `sessionConfig` through a local intersection type until Batch 4 adds the shared field. **Options:** extend the out-of-scope shared contract now; add a separate executor parameter; use the existing config object. **Evidence:** both facade entry points already forward `sessionConfig`, and the approved plan assigns the shared type to Batch 4. **Reversible:** yes; the intersection can be removed after Batch 4.
- **Decision:** Give the resolver context only when roots are defined. **Options:** always pass a context object or preserve the one-argument call when absent. **Evidence:** suite F requires the legacy no-context call and distinguishes `undefined` from `[]`. **Reversible:** yes.

## Verification

- `npx prettier --write libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.capabilities.spec.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.harness-preflight.spec.ts` — exit 0.
- `ptah_get_diagnostics` scoped to all four changed files — unavailable after 45 seconds; TypeScript compiler still running, no diagnostic result.
- `npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns='(sdk-query-options-builder.capabilities|session-query-executor.harness-preflight).spec.ts'` — exit 0; `NX   1 task: 1 succeeded`.
- `npm run verify -- -p @ptah-extension/agent-sdk` — exit 0; `NX   3 tasks: 3 succeeded`.
- `npm run verify -- -t test,typecheck -p ptah-electron,ptah-tui,ptah-extension-vscode` — exit 0; `NX   50 tasks: 50 succeeded, 19 cached`.

## Blockers

No implementation or verification blocker remains. The scoped Ptah diagnostic request timed out, but the agent SDK project typecheck and dependent host typechecks passed. No skill-loading tool was exposed to this lane; no skill was invoked.
