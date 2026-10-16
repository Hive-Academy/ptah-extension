# Batch 25 (B7) — `agent:outcomeSignals` RPC handler

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. No git writes. No `package.json` change (decision #79). Nx and Jest were not run (decision #53). The `ptah_*` MCP tools were not connected in this session (only the `tasks` server); source was read with the native tools.

## Files

| Lines | Path |
| ----: | ---- |
| 24 | `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome.schema.ts` (created) |
| 100 | `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.ts` (created) |
| 182 | `libs/backend/rpc-handlers/src/lib/handlers/agent-outcome-rpc.handlers.spec.ts` (created) |
| — | `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts` (modified) |
| — | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts` (modified) |
| — | `libs/backend/rpc-handlers/src/lib/handlers/index.ts` (modified) |
| — | `libs/backend/rpc-handlers/src/index.ts` (modified) |

`rpc-allowlist.spec.ts` was read and left unchanged. No host expected-absent list was edited.

## Acceptance

| Item | Where |
| --- | --- |
| 1. Zod `.strict()` schema, ≤500 slugs of 1–200 chars | `agent-outcome.schema.ts:12-16` |
| 2. Handler class, `RpcUserError` with the Zod issue text | `agent-outcome-rpc.handlers.ts:45-72` |
| 2. One `reader.agentSignals(slugs, 30)` per call | `agent-outcome-rpc.handlers.ts:84` (`WINDOW_DAYS` at `:30`) |
| 2. Result `{ signals, windowDays: 30, persistent }` | `agent-outcome-rpc.handlers.ts:77` and `:85-89`. `persistent` is `reader.isPersistent()` (`lane-outcome-reader.service.ts:36-37`) |
| 2. Reader missing → `{ signals: {}, windowDays: 30, persistent: false }` | `agent-outcome-rpc.handlers.ts:76-78` |
| 2. Reader rejects → log error name only, then rethrow (RPC error result) | `agent-outcome-rpc.handlers.ts:90-97` |
| 3. Lazy `isRegistered(LANE_OUTCOME_TOKENS.READER, true)` then `resolve`. No `@inject` of that token | `agent-outcome-rpc.handlers.ts:15`, `:50-55`, `:76-83`. Token is `Symbol.for('PtahLaneOutcomeReader')` (`lane-outcomes/.../di/tokens.ts:7`) |
| 4. `registerSingleton` with the other shared handlers | `register-shared-rpc-handlers.ts:17`, `:82-84` |
| 5. Manifest entry | `manifest.ts:121-129`. `requires: []` (`manifest.ts:127`) |
| 6. Allowlist "claims every registry method exactly once" | No edit. `rpc-allowlist.spec.ts:41-42` calls `assertManifestInvariants(RPC_METHOD_NAMES)`, which fails on any registry method the manifest does not own (`manifest.ts:508-512`). The new entry supplies that owner. |
| 7. Expected-absent lists | Not changed. `requires: []` keeps the method served on every host. VS Code and CLI compare `surface.excluded` to lists that do not name `agent:outcomeSignals`. Electron asserts `excluded` is empty and `registered` equals `RPC_METHOD_NAMES`. |
| 8. Handler spec | See the table below. `import 'reflect-metadata'` is `agent-outcome-rpc.handlers.spec.ts:8`. |

## Spec cases

| Case | Line |
| --- | --- |
| Valid params: signals, `windowDays: 30`, `persistent: true`, `isRegistered(READER, true)`, one `agentSignals` call | `agent-outcome-rpc.handlers.spec.ts:101-118` |
| Extra key → `RpcUserError` / `INVALID_PARAMS` / Zod issue text; reader not touched | `:120-122` via `expectInvalid` at `:79-97` |
| 501 slugs | `:124-126` |
| 201-character slug | `:128-130` |
| Empty slug | `:132-134` |
| Reader not registered → `{ signals: {}, windowDays: 30, persistent: false }`, `resolve` not called | `:136-145` |
| Reader throws → same error rejects; log is `{ code: 'OutcomeReadError' }` only (no slug, no path) | `:148-166` |
| Many slugs → `agentSignals` called once with the full list and `30` | `:168-180` |

## Checks

- eslint (the seven files above): exit 0, no findings.
- prettier `--write` then `--check`: `All matched files use Prettier code style!`
- degradation-audit (`--max-warnings=-1`, filtered): `degradation-audit: TOTAL 296 unsuppressed site(s)`. No `FAIL` line.
- di-lint (last line): `di-lint OK: 1846 @inject sites all resolve to a registered token (815 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies`

## Decisions

1. **New class, manifest key `agentOutcome`, `requires: []`.** Options: add the method to `AgentRpcHandlers`, or a new class. The batch names a new file, and `AgentRpcHandlers` injects CLI, auth, and decision-model tokens this read does not use. `requires: []` matches the other always-on `agent:*` entry (`manifest.ts:115-119`) and SC-8, which does not name a capability. Reversible: a later batch can move the key or add a capability.
2. **Lazy container resolve, not `@inject`.** Options: constructor `@inject(LANE_OUTCOME_TOKENS.READER)`, or `runtimeContainer.isRegistered` / `resolve` at call time. Decision #73 and the batch forbid injecting a token hosts register only in Batch 30. The container is the same `PLATFORM_TOKENS.DI_CONTAINER` slot `AgentRpcHandlers` uses (`agent-rpc.handlers.ts:314-316`); the recursive flag is the batch's `isRegistered(token, true)`. Reversible: switch to `@inject` after Batch 30 registers the token on every host.
3. **Issue text is `path: message` from the first Zod issue.** Options: `parsed.error.message` (`agent-rpc.handlers.ts:1128`) or `formatIssue` (`wizard-generation-rpc.schema.ts:77-81`). The wizard form names the field and does not echo the rejected value. Reversible.
4. **A reader rejection is logged and rethrown.** Options: return the empty result, or rethrow after `logger.error` with `{ code: error.name }` only. The batch says an error result and forbids a silent swallow. `RpcHandler` turns the throw into the error response. `isPersistent()` is not called when `agentSignals` rejects. Reversible.
5. **Registration lives in `registerSharedRpcHandlers`, not the host phase files.** Those phase files are outside this batch. Every host already calls `registerSharedRpcHandlers` before `registerRpcSurface`, and `registerRpcSurface` does `container.resolve(ctor).register()` for a lib-owned entry (`register-rpc-surface.ts:184-185`). `registerSingleton` matches `SetupRpcHandlers` in the same function. The class is not also registered in a phase file, so this is not a second cache. Reversible.
6. **Public barrels export the class.** `src/index.ts` re-exports handler classes from `handlers/index.ts`, so both files name `AgentOutcomeRpcHandlers` (`src/index.ts:11`, `handlers/index.ts:12`). The manifest imports it from that barrel (`manifest.ts:29`). Reversible.
7. **No `auth-providers` Jest mock.** Sibling specs mock it because they import `@ptah-extension/cli-agent-runtime`. This handler's chain (`lane-outcomes` → `agent-sdk`) does not import `@ptah-extension/auth-providers`. `reflect-metadata` is still the first import. Reversible: add the mock if a test load fails on that barrel.

## Not done

- Jest and `nx typecheck` / the rule-8 guard specs were not run (decision #53). The orchestrator owns them.
- `ptah_agent_report` could not be called: the `ptah` MCP server is not connected in this session (`search_tool` for `ptah_agent_report` returned no tool).
