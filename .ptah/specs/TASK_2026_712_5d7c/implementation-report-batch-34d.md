# Backend implementation: `TASK_2026_712`, batch 34d

**Executor**: backend-developer subagent (Claude). No git, no nx/jest/tsc/lint/npm run (the orchestrator runs scoped checks). `libs/backend/vscode-lm-tools/**` was not touched.

**Tasks completed**:
- RPC resume forwarding (34c item 3);
- resume spec assertions (34c item 4);
- `SCOPED_SETTING_KEYS` effort keys (34c item 5);
- Batch 34.1 CLI selector and account serialization (the `agent-cli.ts` and `agent-cli.spec.ts` part only).

File cap: 5 of 6 used.

## Changed files

- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
  - `:367-381`: new module function `resumeSpawnAccountSelection(cli, selection)`. It returns the selection only for `cli === 'claude'` and only for `omitted` or `ambient`. Every other case returns `undefined`.
  - `:1425-1437`: the system-CLI branch of `agent:resumeCliSession` spreads `accountSelection` into the `SpawnAgentRequest` only when that function returns a value.
  - No constructor change and no new `@inject` (D32).
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`
  - `:601-605`: an absent selection leaves the spawn request without the `accountSelection` key.
  - `:620-622`: an `omitted` selection is forwarded as `{ kind: 'omitted' }`.
  - `:640-648`: an ambient restatement on an ambient session reaches spawn as `accountSelection: { kind: 'ambient' }`.
  - `:832-835`: `codex` with ambient sends no selection.
  - Already covered, unchanged:
    - a conflict is refused before spawn (`refuses ambient on a bound session before spawn`, the named-conflict cases);
    - the named restatement still reaches the runtime without a selection and comes back as `release-held` (`:716` `not.toHaveProperty('accountSelection')`).
- MODIFIED `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:457-464`: `agentOrchestration.grokReasoningEffort` and `agentOrchestration.antigravityReasoningEffort` are added as `{ appScopable: false, supportedTargets: ['global'] }`, next to `piReasoningEffort`. No spec pins the full key list, so no spec edit was needed. `file-settings-keys.spec.ts` checks per key, and it is not in this batch's ownership.
- MODIFIED `apps/ptah-cli/src/cli/commands/agent-cli.ts`
  - `:63-66`: imports `isProviderAccountOpaqueId`.
  - `:78`: imports `ProviderAccountSelection` as a type.
  - `:17`: header row.
  - `:140-148`: `AgentCliOptions.account?: string`.
  - `:605-613`: `runResume` resolves `--account` after the `--ptah-cli-id` checks and before any engine or RPC call. A refusal is a stderr message plus `ExitCode.UsageError`.
  - `:653`: `ResumeCliSessionParams.accountSelection?`.
  - `:657`: `AMBIENT_ACCOUNT_SENTINEL = 'ambient'`.
  - `:660-697`: `ResumeAccountResolution` and `resolveResumeAccountSelection`.
  - `:704-728`: `buildResumeCliSessionParams` spreads `accountSelection` only when present.
- MODIFIED `apps/ptah-cli/src/cli/commands/agent-cli.spec.ts`
  - `:36-44`: imports.
  - `:1222-1340`: two new `describe` blocks (see Specs).

## Resume forwarding trace (`agent:resumeCliSession`, `claude`)

| Step | Location | Behaviour |
| --- | --- | --- |
| Boundary parse | `agent-rpc.handlers.ts` `AgentResumeCliSessionParamsSchema.safeParse` (`agent-rpc.schema.ts:91`, strict `ProviderAccountSelectionSchema`) | Malformed selections fail as `invalid params` before any lookup (existing `it.each` at spec `:824+`). |
| Conflict gate (Batch 28a, unchanged) | `resumeAccountRefusal` (`:1489+` region) | `omitted`/absent → no store read. `ambient`/`named` compared with the stored binding. `conflict`, `invalid-bound` and `unavailable-storage` are refused **before spawn**. |
| Selection to forward (new) | `resumeSpawnAccountSelection` `:375` | `claude` + `omitted`/`ambient` → forwarded as-is. `named` → not forwarded (D7). Non-claude → never forwarded. |
| Spawn request | `:1428-1438` `agentProcessManager.spawn({... , accountSelection?})` | The key is absent when there is nothing to forward, so existing exact-shape assertions are unaffected. |
| Runtime | `agent-process-manager.service.ts` `spawn` | Does not read the field. The runtime's resume gate reads the stored binding and stays authoritative and fail-closed. A named stored binding still returns `LaneAccountResumeError('release-held')`, which maps to a whitelisted refusal through `laneAccountRefusalCode` (`:343`). |

## CLI selector behaviour

- **Selector**: `CLI_AGENT_SELECTORS` was already derived from `SYSTEM_CLI_TYPES` (which now includes `claude`), plus `ptah-cli`, plus the deprecated `glm` alias (`agent-cli.ts:91-95`). There is no hand-copied list. Unchanged, and covered by the existing `CLI_AGENT_SELECTORS contract` and `it.each([...SYSTEM_CLI_TYPES])` resume tests. `ptah-cli` stays a separate target, and the existing `ptahCliId` precedence is unchanged.
- **`--account` on resume**, through `resolveResumeAccountSelection(raw, target)`:

  | Input | Result |
  | --- | --- |
  | target other than `claude` | refused: `--account only applies to --cli claude` |
  | `ambient` (after trim) | `{ kind: 'ambient' }`, serialized as `accountSelection` on the wire |
  | an opaque account ID | refused: `named accounts are not available yet; use --account ambient or omit the flag` (D7) |
  | anything else, including empty | refused: `--account must be 'ambient' (omit the flag to keep the session's stored account)` |

  - No message echoes the raw value.
  - Every refusal exits `UsageError` before the engine starts, so no RPC is sent.
- **Flag absent**: no `accountSelection` key is sent, and the backend's stored binding decides. Ambient is never inferred from the local CLI session index, which has no profile field. No client-side binding is created or stored.

## Specs

- `agent-rpc.handlers.spec.ts` (`AgentRpcHandlers — agent:resumeCliSession account selection`):
  - ambient is forwarded;
  - omitted is forwarded;
  - absent is not forwarded (`not.toHaveProperty`);
  - non-claude ambient is not forwarded;
  - the existing tests still cover conflict refused before spawn and named not forwarded (release-held from the runtime).
- `agent-cli.spec.ts`:
  - `resolveResumeAccountSelection`:
    - ambient maps to `{kind:'ambient'}`;
    - an account ID is refused without echo;
    - five malformed values are refused without echo;
    - every non-`claude` selector is refused (driven off `CLI_AGENT_SELECTORS`).
  - `ptah agent-cli resume --account`:
    - ambient is serialized into the exact RPC params and parsed by the real `AgentResumeCliSessionParamsSchema`;
    - an absent flag sends no key;
    - named is refused before the engine starts (`invoked.count === 0`), with safe stderr;
    - `codex --account ambient` is refused before the engine starts.
- Not run. Suggested scoped commands:
  - `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts --coverage=false --maxWorkers=2`
  - `npx jest -c apps/ptah-cli/jest.config.ts apps/ptah-cli/src/cli/commands/agent-cli.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx typecheck` for `shared`, `@ptah-extension/rpc-handlers` and `ptah-cli`, plus the host dependents of `shared` (`ptah-electron` first), with `--parallel=1`.

## Existing specs that mock or assert changed members

- `AgentProcessManager.spawn` call shape from `agent:resumeCliSession`:
  - `agent-rpc.handlers.spec.ts`: updated here;
  - `agent-rpc.handlers.resume-parent-session.spec.ts`: not changed.
  - Those callers send no selection, so the key stays absent and their `toEqual`/`objectContaining` assertions are unaffected.
- `buildResumeCliSessionParams` and `AgentCliOptions`: only `agent-cli.spec.ts` uses them (grep over `apps/ptah-cli/src`). The existing `never leaks the deprecation notice` test pins the keys to `['cli','cliSessionId','task']` with no selection, and still holds.
- `SCOPED_SETTING_KEYS`: read per key in `file-settings-keys.spec.ts:326,354` and `rpc-provider-accounts.spec.ts:356`. No spec enumerates the full map (grep for `Object.keys(SCOPED_SETTING_KEYS` and `SCOPED_SETTING_KEYS)` in specs: none). `config-scope-rpc.handlers.ts` and `providers-settings-state.service.ts` consume the map, and the change is additive.

## Diagnostics

`ptah_get_diagnostics` was called twice, scoped to exactly the 5 changed files, severity `error`. Both calls returned "Unavailable: TypeScript check still running after 45s". **There is no diagnostics evidence**, so the orchestrator's scoped typecheck must confirm the change.

Read-checked:
- `CliType` and `ProviderAccountSelection` were already imported in `agent-rpc.handlers.ts`, because the private method uses them.
- `isProviderAccountOpaqueId` and `ProviderAccountSelection` are exported through `@ptah-extension/shared` (`index.ts:32` → `provider-account.types`).
- No `any`, `@ts-ignore` or new `as unknown as` was added.
- No `process.cwd()` was added. `agent-cli.spec.ts:55` already used it in `baseGlobals`, and that line is unchanged.
- No `jest.spyOn` was used.

## Decisions

- **The named restatement is not forwarded on RPC resume.**
  - Options:
    - (a) forward every validated selection;
    - (b) forward omitted and ambient only;
    - (c) refuse named in the handler.
  - Evidence:
    - the `SpawnAgentRequest.accountSelection` doc (34b, `agent-process.types.ts:331-338`) says "omitted or ambient only while named admission is release-held (D7)";
    - the existing spec `:696-725` pins the runtime's `release-held` path, with the spawn request carrying no selection.
  - Chose (b). Reversible: yes, change one line when named admission is released.
- **Only `claude` forwards.** Other CLIs have no account bindings (`storedResumeBinding` returns `absent`), and the MCP `agentSpawnAccountRefusal` already refuses a selection on a non-claude lane. Reversible.
- **`--account` is refused on non-claude targets in the CLI, even for ambient.** The RPC boundary accepts ambient on `codex` as a no-op, but in the CLI the flag would mislead. The text is the same as the MCP refusal intent. Reversible.
- **The router is not wired** (`apps/ptah-cli/src/cli/router.ts:772-802`, outside this batch's ownership).
  - `AgentCliOptions.account` and the resolver are complete and tested at the `execute()` level, but no `--account <value>` commander option passes the value yet.
  - Follow-up: add `.option('--account <value>', ...)` to the `agent-cli resume` command and pass `account: opts.account`. This is about 3 lines in one file.
  - Recommended for Batch 34's remaining files or for 35.
- **D28 follow-up, recorded only and not changed**: `laneAccountRefusalCode` (`agent-rpc.handlers.ts:343-354`) still identifies the runtime refusal by `error.name === 'LaneAccountResumeError'`, not by `instanceof`.
  - The class is on the lib barrel, but the agent-rpc specs mock that barrel without it.
  - Switching to `instanceof` needs those barrel mocks updated in the same change.
  - `decisions.md` is not in this batch's ownership, so the item is recorded here for the orchestrator to add under D28.

## Out-of-scope observations

- `apps/ptah-cli/src/cli/router.ts`: `--account` is not yet passed through (see Decisions).
- The Batch 34.1 files in `vscode-lm-tools` (`agent-namespace.builder.spec.ts`, `system-namespace.builders.spec.ts`, `agent-spawn-accounts.spec.ts`) belong to the parallel agent and were not touched.
