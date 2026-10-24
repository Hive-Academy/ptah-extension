# Backend implementation: `TASK_2026_712`, batch 34c

**Executor**: backend-developer subagent (Claude). No git. No nx, jest, tsc, lint or npm run (the orchestrator runs scoped checks). No live CLI, sign-in or credential change.

**Tasks completed**: 34c items 1-2 from the 34b report (the namespace builder forwards the selection, and its spec is fixed), plus the Batch 34 drift specs (system-namespace help, new `agent-spawn-accounts.spec.ts`). The rpc-handlers resume forwarding, the `rpc-auth.types.ts` scoped keys and `apps/ptah-cli` belong to the parallel agent and were not touched.

## Changed files

- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`
  - `:34` imports the `ProviderAccountSelection` type from `@ptah-extension/shared`.
  - `:178` `UntypedSpawnRequest` is now `Omit<SpawnAgentRequest, 'accountSelection'> & { accountSelection?: unknown }`. Since 34b typed the field, the old intersection had collapsed to `ProviderAccountSelection`, so the `execute_code` boundary was no longer `unknown`. `SpawnAgentRequest` is still assignable to it, so `AgentNamespace.spawn` keeps its signature.
  - `:192-216` `assertAccountSelection` returns `ProviderAccountSelection | undefined`. It returns `undefined` when the selection is omitted, throws on invalid input or a refusal (same strict shared reader and `agentSpawnAccountRefusal`), and otherwise returns the parsed selection.
  - `:288` keeps the parsed value (`const accountSelection = ...`).
  - `:459-473` the raw caller value is destructured away (`_rawAccountSelection`), and the parsed one is spread back as `...(accountSelection && { accountSelection })`. The stale comment saying "`SpawnAgentRequest` does not declare it" is replaced.
  - `:480` `agentProcessManager.spawn(enrichedRequest)` now receives it.
  - Named selections are still refused before spawn (D7). The Ptah CLI branch (`:322`) can never receive a selection, because the refusal blocks it first.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts`
  - `:1581-1596` `AccountSpawnRequest` uses the same `Omit<...> & { accountSelection?: unknown }` shape, so the invalid fixtures (`null`, a bare string, `{ kind: 'default' }`, ...) type as `unknown` at the boundary the builder parses. The request is handed over with a plain `as SpawnAgentRequest` downcast, not `as unknown as`. This fixes the compile errors at the old lines ~1603 and ~1682.
  - `:1598-1616` the old "not forwarded" assertion now says the ambient and omitted selections are forwarded (`forwarded.accountSelection` equals the input).
  - `:1618` new test: no selection means no `accountSelection` key (old callers unchanged).
  - `:1627` new test: the forwarded value is the parsed object, not the caller's reference.
  - The named, resume-named, wrong-target and malformed refusal tests are unchanged.
- MODIFIED `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts`
  - `:28` imports `SYSTEM_CLI_TYPES`.
  - `:424-466` new describe `HELP_DOCS — system CLI list drift (Batch 34)` with four tests:
    - the tuple equals the original seven plus `claude` and has no `ptah-cli`;
    - the `orchestration` help contains `CLI agent adapters: ${tuple}, plus ptah-cli for configured providers;`;
    - the `agent` help types `cli?:` as the tuple union followed by a separate `ptahCliId?: string`, with no `'ptah-cli'` member in the union;
    - `modelTier` and the `accountSelection` doc are present.
- CREATED `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-accounts.spec.ts`
  - Both transports (HTTP `handleMCPRequest` and stdio `AgentToolDispatcher.dispatch`) run through the real `buildAgentNamespace` into a mocked process manager and Ptah CLI registry. This proves the whole forwarding chain, not just the dispatcher → `ptahAPI` hop.
  - It covers both transports for each case:
    - the selector is the original seven plus `claude`, and `cli: 'ptah-cli'` is rejected (reached through `ptahCliId`);
    - old callers: all 8 CLIs spawn with no `accountSelection` key;
    - ambient and omitted are forwarded;
    - an ambient resume is forwarded with `resumeSessionId`, so the runtime resume gate decides;
    - a resume with a conflicting (named) account is refused with no spawn;
    - a named selection is refused (D7);
    - `ptahCliId` wins over `cli` and goes to the registry, with `modelTier` passed through;
    - a selection on a Ptah CLI agent is refused;
    - `modelTier` is unchanged;
    - an explicit `effort` reaches the process manager as given;
    - a Ptah CLI lane ignoring `effort` is warned truthfully;
    - HTTP and stdio send an identical request.
  - Uses `import 'reflect-metadata'`. Mocks are built as `Partial<T>` literals with a single downcast. No `any`, no `@ts-ignore`, no `as unknown as`, no `jest.spyOn` on module namespaces, no `process.cwd()`.

## Forwarding trace (after 34c)

| Step | Location | State |
| --- | --- | --- |
| HTTP entry | `mcp-core/protocol-dispatcher.ts:1192-1204` | `AgentSpawnArgsSchema` parse plus `agentSpawnAccountRefusal` (superRefine) |
| stdio entry | `mcp-stdio/agent-tool.dispatcher.ts` `handleSpawn` | same schema |
| Dispatcher → `ptahAPI.agent.spawn` | `protocol-dispatcher.ts:1272`, `agent-tool.dispatcher.ts:506` (34b) | forwarded |
| Namespace re-check | `agent-namespace.builder.ts:192-216,288` | strict reader plus the same refusal; returns the parsed selection |
| Namespace → `agentProcessManager.spawn` | `agent-namespace.builder.ts:459-480` | **forwarded (34c)**, typed, only when present |
| Ptah CLI branch | `agent-namespace.builder.ts:322+` | never reached with a selection (refused) |
| Adapter | `cli-agent-runtime/.../agent-process-manager.service.ts:374` | does not read the field; ambient or omitted is today's route (D7 hold) |
| RPC `agent:resumeCliSession` | `rpc-handlers/.../agent-rpc.handlers.ts` | owned by the parallel agent, not touched here |

## Specs that mock the changed members

- `AgentNamespace.spawn` keeps the `(request: SpawnAgentRequest)` signature. Only the internal `UntypedSpawnRequest` changed.
- In the `processManager.spawn` call object, `accountSelection` now appears only when the caller sent one. Existing namespace-spec assertions on the forwarded request use `toEqual` or `toMatchObject`. Of these, only the `:1609` "not forwarded" assertion depended on stripping, and it has been changed.
- `agent-spawn-surface-parity.spec.ts` (34b) mocks `ptahAPI.agent.spawn` directly, so it is unaffected.
- `ptah-api-builder` specs build the namespace with absent or empty selections, so their behaviour does not change.

## Verification

- Commands were not run, as instructed. Suggested scoped commands (run one at a time):
  - `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-accounts.spec.ts libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-surface-parity.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck vscode-lm-tools --parallel=1` (the project name may be `@ptah-extension/vscode-lm-tools`)
- `ptah_get_diagnostics` was called three times on exactly the 4 changed files. Every call returned "Unavailable: TypeScript check still running after 45s". **There is no diagnostics evidence**, so the orchestrator's scoped typecheck must confirm the change.
- Type reasoning, from reading the code:
  - `SpawnAgentRequest` is assignable to `Omit<...> & { accountSelection?: unknown }`, so the arrow-property implementation satisfies `AgentNamespace.spawn` under `strictFunctionTypes`.
  - The spec's `request as SpawnAgentRequest` is a legal downcast, because the target is assignable to the source.
  - `Partial<Logger>`, `Partial<PtahAPI>`, `Partial<AgentProcessManager>` and `Partial<CliDetectionService>` downcast the same way.
- MCP tool descriptions are unchanged, so no `mcp-contract.sweep.spec.ts` budget is affected.

## Decisions

- **Restore `unknown` at the builder boundary with `Omit`, rather than leaving the collapsed intersection.**
  - Options: (a) `Omit` plus `unknown`; (b) keep `SpawnAgentRequest & { accountSelection?: unknown }` and cast every invalid fixture.
  - Evidence: `execute_code` callers are untyped JS (the comment at `:171-176`), and the builder parses the field with `readProviderAccountSelectionField(unknown)`.
  - Reversible: yes.
- **Forward the parsed selection, not the raw caller object.** Only schema-shaped data crosses into the runtime, so extra keys are impossible (strict schema).
- **Prove the drift tests end to end through the real namespace**, rather than mocking `ptahAPI.agent.spawn` as the parity spec does. This shows that the selection the dispatcher forwards actually reaches `AgentProcessManager.spawn`.

## Out-of-scope observations

- `mcp-core/agent-spawn-args.schema.ts:38-39`: the doc comment ("Ambient and omitted are today's route, so the spawn needs no extra field to carry them") is stale now that the field is forwarded. It is not in my file set.
- The batch acceptance item "list/message capabilities match handle" is not covered by the four files assigned here.
