# Backend implementation — `TASK_2026_597_ab22`, batch 7

**Tasks completed**: 7.1 (zod `effort`), 7.2 (advertised `effort`), 7.3 (both dispatchers + parity spec)

**Files** (root `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\libs\backend\vscode-lm-tools\src\lib\code-execution\`):

- MODIFIED `mcp-core\agent-spawn-args.schema.ts` — new `MAX_EFFORT_LENGTH = 32`. New field `effort: z.string().min(1).max(MAX_EFFORT_LENGTH).optional()`. The schema stays `.strict()`.
- MODIFIED `mcp-core\agent-spawn-args.schema.spec.ts` — accepts every level. Keeps an unknown string such as `ultra`. Checks the 1..32 length bounds. Rejects a number, a boolean, null, an array and an object. The full documented shape now includes `effort`.
- MODIFIED `mcp-core\tool-description.builder.ts` — new `effort` property (type string). Its description lists minimal/low/medium/high/xhigh/max and says that it wins over the per-CLI setting and the chat effort (R2.3 step 1), and that a value the CLI does not take is ignored. The text is 207 chars. The top-level tool description is unchanged, so the `ptah_agent_spawn: 1568` description budget in `mcp-contract.sweep.spec.ts` is unaffected.
- MODIFIED `mcp-core\tool-description.builder.spec.ts` — new `buildAgentSpawnTool — effort` block. It checks the type, that `required` is still `['task']`, that every level is listed, the precedence wording, a length of 220 chars or less, and that no CLI vendor is named (same rule as `role`).
- MODIFIED `mcp-core\protocol-dispatcher.ts` — forwards `effort: spawnArgs.effort` into `ptahAPI.agent.spawn` and adds `effort` to the `[MCP] ptah_agent_spawn invoked` log.
- MODIFIED `mcp-stdio\agent-tool.dispatcher.ts` — forwards `effort: p.effort` into `ptahAPI.agent.spawn` and adds `effort` to the `[McpStdio] agent_spawn invoked` log.
- MODIFIED `mcp-core\agent-spawn-surface-parity.spec.ts` — runs both real dispatchers (HTTP `handleMCPRequest` and stdio `AgentToolDispatcher`) and checks five things:
  - The same args produce an identical `SpawnAgentRequest` on both surfaces, and it carries `effort: 'high'`.
  - An unknown effort passes through unchanged on both.
  - An omitted effort is `undefined` on both.
  - An invalid effort (number, `''`, 33 chars, object) is an `isError` reply on both, and no spawn happens.
  - Both advertised definitions type `effort` as a string.

**Edge cases handled**

- Invalid types are rejected at the boundary on both surfaces. The schema is strict, so an unknown key is still rejected.
- The schema does not use an enum. Each CLI accepts its own scale: pi takes `off`/`max`, and Codex maps `max` to `xhigh`. `lane-spawn-policy.ts` `resolveLaneEffort` already ignores a value at step 1 that the CLI does not take, records it in `ignored` and falls through to step 2. An enum would duplicate that per-CLI mapping and break pi `off`.
- The length bound (32) protects the `Lane policy` log line, which echoes an ignored effort. This partly addresses F6-m2 at the MCP boundary. The `execute_code` path (Task 34.2 / F6-M1) is still not bounded.
- The advertised description names no CLI vendor, which follows the existing `role` rule.

**Stack observed**: TypeScript, Nx, Jest, zod. Read from `agent-spawn-args.schema.ts` and the specs. Both surfaces parse with the shared `AgentSpawnArgsSchema`. HTTP uses `safeParse` in `protocol-dispatcher.ts`; stdio uses `parseArgs` in `agent-tool.dispatcher.ts`. The stdio definition is `rename(buildAgentSpawnTool(), 'agent_spawn')` (`mcp-stdio/tool-builders.ts:88`), so the advertised schema is shared. `SpawnAgentRequest.effort` already exists (`libs/shared/src/lib/types/agent-process.types.ts:188`, Batch 6). `agent-namespace.builder.ts` spreads the request through unchanged.

**Verification**

- `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-lm-tools`: "Successfully ran targets typecheck, lint" (exit 0).
- `npx nx run-many -t test -p @ptah-extension/vscode-lm-tools --maxWorkers=2`: "Successfully ran target test".
- `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts --maxWorkers=2`: 81 suites passed out of 81, and 2677 tests passed out of 2677.
- The batch lists no other project. No `@ptah-extension/shared` change was needed.

**Plan deviations**

- The advertised description does not use the literal label "step 1 of R2.3". An internal requirement id means nothing to the calling model, so the description states what step 1 does instead ("Wins over the per-CLI setting and the chat effort").
- Pi's extra `off` is left out of the advertised text to keep vendor names out. The schema and the policy still accept it.
- `effort` was also added to both "invoked" log lines. This is a small extension of the existing pattern, where `role` is logged.

**Out-of-scope observations**

- F6-M1 is still open: `execute_code` `ptah.agent.spawn({ effort })` is not type-validated. It is owned by Task 34.2.
