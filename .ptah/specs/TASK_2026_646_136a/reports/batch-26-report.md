# Batch 26 (A9a) — Route tool modules

Worktree: `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. New files only. No git writes. `protocol-dispatcher.ts`, `tool-result-budget.ts`, `ptah-api-builder.service.ts`, the `PtahAPI` type, stdio registration, and every `register*.ts` were left untouched (AB9 / Batch 29 owns registration). Nx and Jest were not run (decision #53).

## Files created

| Non-blank lines | Path                                                                                                                                                                         |
| --------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|             111 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tools.ts`                            |
|              61 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tools.spec.ts`                       |
|              97 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tool-handlers.ts`                    |
|             154 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\route-tool-handlers.spec.ts`               |
|              99 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\route-namespace.builder.ts`      |
|             257 | `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\route-namespace.builder.spec.ts` |

No files were modified. `libs/backend/vscode-lm-tools/package.json` does not gain `@ptah-extension/lane-routing` (decision #79). The import uses the existing `tsconfig.base.json` path alias.

## PA-4 — `ptahAPI.agent.listRoles()` returns workspace role names

**Result: true.** The namespace builder passes `agent.listRoles()` through. It does not replace a successful list with `[]`.

Evidence:

- `agent-namespace.builder.ts:529-531` — `listRoles` calls `listAgentRoles(getWorkspaceRoot())`, or returns `[]` only when that callback is not wired.
- `ptah-api-builder.service.ts:743-748` — the wired callback calls `this.agentRoleResolver.listRoles(workspaceRoot)`, or returns `[]` when no resolver is registered.
- `agent-role-resolver.service.ts:50-55` — `listRoles` lists files under `agentsDirFor(resolveHarnessWorkspaceRoot(workspaceRoot))` and returns each file's role stem.
- `agent-role-resolver.service.ts:141-143` — that directory is `join(harnessRoot, '.claude', 'agents')`.
- `agent-role-resolver.service.ts:18` and `:153-160` — only `*.md` files are roles; the name is the file stem.

The plan's fallback ("namespace builder lists none") is not used. A `listRoles()` rejection is not turned into `[]` (`route-namespace.builder.ts:95-97`). Gather already maps that rejection to the reason `roles unavailable` and still offers built-in roles (`gather.ts:139-148`, `phase-plan.ts:236`). Returning `[]` from a failed call would hide that reason.

## Task 26.1 evidence

| Requirement                                                                   | Evidence                                                                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tool name `ptah_route_decide`                                                 | `route-tools.ts:13`, `route-tools.ts:113`                                                                                                 |
| `buildRouteDecideTool()`, schema generated from `RouteDecideArgsSchema`       | `route-tools.ts:92-98`, `route-tools.ts:121`                                                                                              |
| `readOnlyHint: false` (rotation state)                                        | `route-tools.ts:122`                                                                                                                      |
| Zod at the handler boundary, before any service call                          | `route-tool-handlers.ts:96-97`                                                                                                            |
| Invalid args name the field and do not call `route.decide`                    | `route-tool-handlers.ts:43-52` and `:78-83`; spec `route-tool-handlers.spec.ts` (extra key, non-object `(root)`, duplicate `phases.1.id`) |
| Handler reaches `RouteDecideService` only through the namespace               | `route-tool-handlers.ts:100` calls `route.decide(parsed.data)`                                                                            |
| Service resolved through `LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE`           | `route-namespace.builder.ts:60-66` (`isRegistered(token, true)` then `resolve`)                                                           |
| Unregistered host → F9, no agent I/O                                          | `route-namespace.builder.ts:24-25`, `:105-107`. Text: `routing is not available in this host; use the skill's rule tables`                |
| Candidate source from `agent.list`, `agent.limits`, `agent.listRoles`         | `route-namespace.builder.ts:79-98`, passed at `:108`                                                                                      |
| Limit map key is `ptahCliId` or `cli`; value is `LaneLimitResult.state.state` | `route-namespace.builder.ts:74-76`, `:90`. `laneCandidateId` is not on the `@ptah-extension/lane-routing` barrel, so the rule is local    |
| Missing or `undefined` limits → `null` (limits unavailable)                   | `route-namespace.builder.ts:84-86`                                                                                                        |
| Thrown failures become a redacted tool error; F9 text is unchanged            | `route-tool-handlers.ts:61-75`, `:102-106`                                                                                                |
| Success text is the JSON result                                               | `route-tool-handlers.ts:101`                                                                                                              |
| No registration edits                                                         | This batch created only the six files above                                                                                               |

Module boundary: `@ptah-extension/vscode-lm-tools` is `scope:extension` + `type:feature` (`libs/backend/vscode-lm-tools/project.json`). `@ptah-extension/lane-routing` has the same tags (`libs/backend/lane-routing/project.json`). `eslint.config.mjs` allows `scope:extension` → `scope:extension` and `type:feature` → `type:feature`. ESLint on the new files exited 0, so the import is accepted.

## Token / injection (#73)

`LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE` is registered only inside `registerLaneRoutingServices` (`libs/backend/lane-routing/src/lib/di/register.ts`). No host calls that function until Batch 30.

No new class uses `@inject`. `PtahAPIBuilder` is constructed by hosts today, and this batch does not edit it. `buildRouteNamespace` takes a `RouteServiceLocator` (the two methods `DependencyContainer` already has) and calls `isRegistered(token, true)` on every `decide`. AB9 passes the host container when it wires `ptahAPI.route`. Until that registration lands, `decide` throws `RoutingUnavailableError` and does not call `agent.list`, `agent.limits`, or `agent.listRoles`.

`handleRouteToolCall(args, route, logger)` matches part A §8: the handler validates, then calls `ptahAPI.route.decide`. The token lookup stays in the namespace so both the MCP handler and a later `execute_code` path share one resolution.

## Checks

Jest left for the team-leader (decision #53):

`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tools.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/route-tool-handlers.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/route-namespace.builder.spec.ts --coverage=false --maxWorkers=2`

ESLint (the six new files) exited 0. One unused-arg warning on the first run was removed; the confirmation run printed no problems.

Prettier `--check` on the six files:

```
Checking formatting...
All matched files use Prettier code style!
```

Exit 0.

Degradation audit (`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1`), filtered to `FAIL|TOTAL`. PowerShell `Select-String` is case-insensitive, so the heading `per-directory totals` also matched. No directory line contained `FAIL`. Exit 0.

```
degradation-audit: per-directory totals
degradation-audit: TOTAL 296 unsuppressed site(s)
```

di-lint (`npx ts-node --transpile-only tools/di-lint/check-injects.ts`), last line. Exit 0.

```
di-lint OK: 1843 @inject sites all resolve to a registered token (814 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies
```

## Handoff

`ptah_agent_report` is not on this session's MCP server (`search_tool` for `ptah_agent_report` returned no tools). The summary is in the executor's final message.

AB9 wires `buildRouteDecideTool` after `buildSessionHandoffTool()`, `handleRouteToolCall`, and `buildRouteNamespace({ agent, container })`. This batch does not.
