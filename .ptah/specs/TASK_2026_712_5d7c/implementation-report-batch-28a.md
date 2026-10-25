# Backend implementation: TASK_2026_712_5d7c, Batch 28a

**Tasks completed**: Batch 28a, the agent RPC account argument and the Claude config keys (D31 split of Task 28.1).

## Files

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.schema.ts`: `AgentResumeCliSessionParamsSchema` gets an optional `accountSelection`. It reuses the strict shared `ProviderAccountSelectionSchema` (`@ptah-extension/shared/schemas`), which accepts `omitted`, `ambient`, or `named` + opaque `profileId`. A path, env, token, owner key or any other extra field fails the parse.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`:
  - `claudeModel` is added to `CLI_MODEL_KEYS` (type-checked, stored trimmed).
  - `claudeReasoningEffort` is added to the effort allowlist (`CLAUDE_REASONING_EFFORT_VALUES`), so an invalid value is refused before any write.
  - `agent:setConfig` now writes `claudeReasoningEffort`.
  - `agent:getConfig` now returns `claudeModel` and `claudeReasoningEffort` (default `''`).
  - `agent:resumeCliSession` checks the supplied account selection against the stored binding before reading the session folder or spawning. It uses the new private methods `resumeAccountRefusal` and `storedResumeBinding`.
  - The resume `catch` now maps `LaneAccountResumeError` (the D28 follow-up) to a safe text built only from the whitelisted code. `laneAccountRefusalCode` still matches by name, not `instanceof` (D28).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/platform-core/src/file-settings-keys.ts`: `agentOrchestration.claudeModel` and `agentOrchestration.claudeReasoningEffort` are now in `FILE_BASED_SETTINGS_KEYS`, with defaults `''`, following `grokModel`/`piModel`. Before this change, saves of these two keys were dropped.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/platform-core/src/file-settings-keys.spec.ts`: new describe "Claude system-lane keys". It checks that both keys are routed, that both default to `''`, that the effort default is in `CLAUDE_REASONING_EFFORT_VALUES`, and that both are global-only scoped keys.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/provider-accounts-p1e/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.spec.ts`:
  - Harness changes: the `@ptah-extension/auth-providers` mock gets a `ProviderAccountService` class token. `makeHarness({ accountLookup })` registers a fake service in the mocked container. `cliDetection.detectAll` is mocked so `getConfig` can run.
  - New describe "Claude lane config keys" (5 tests): write and trim, invalid effort refused with no write, non-string model refused, getConfig read-back, default `''`.
  - New describe "agent:resumeCliSession account selection" (13 tests plus a 7-row malformed table):
    - No argument, or `omitted`: no store read.
    - Ambient restated on an ambient session: resumes.
    - Ambient on a bound session: conflict.
    - Different named account: conflict.
    - Named account on an ambient session: conflict.
    - Restated named account: reaches spawn, the runtime's `release-held` is mapped with no path in the reply, and the spawn request carries no `accountSelection`.
    - `invalid-bound` stored: refused.
    - Stored binding that fails validation: `invalid-bound`.
    - Service not registered, or lookup throws: `unavailable-storage`, with no path in the warn log.
    - Non-claude CLI with a named account: conflict, no lookup.
    - Non-claude CLI with ambient: resumes.
    - Malformed selection (path, env, token, ownerKey, short id, unknown kind, non-object): `invalid params`, no lookup, no spawn.

Six files in total. Nothing outside the assigned ownership was edited. I wrote a temporary edit script under `D:/projects/ptah-extension/.ptah/tmp/` to apply the spec changes and deleted it afterwards.

## Behaviour

- Existing callers send no `accountSelection`. For them nothing changes: no account-store read, and the same spawn request.
- Resume decision: `classifyAgentResumeAccountSelection` (Batch 25), with this stored presence:
  - `claude`: `ProviderAccountService.lookupBySdkSession({provider:'claude', sdkSessionId: cliSessionId})`. This is the same authority the runtime gate reads (`cli-agent-runtime/src/lib/di/register.ts:107-141`). The result is re-validated with `classifyProviderAccountBinding`, and a binding whose provider is not `claude` counts as `invalid-bound`.
  - Every other CLI and `ptah-cli`: `absent`. These lanes have no account binding.
- The decision maps to refusals as follows. `inherit` lets the resume go on. `conflict` refuses with `conflict`. `invalid` refuses with `invalid-bound`. A missing, unregistered or failing service refuses with `unavailable-storage`, never `absent` (fail-closed).
- The wire reply is `{ success:false, error:'Agent resume account refused (<code>).' }`, and a warn log records `{cli, code}` only.
- D7 is kept. On `inherit` the handler does not forward the selection. The runtime resumes on the stored binding through its own gate, and that gate still refuses a named binding with `release-held` (`validateResume`, `register.ts:134-136`). Nothing bypasses admission.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| D-28a-1: The stored binding is resolved lazily from the already-injected `PLATFORM_TOKENS.DI_CONTAINER` (`isRegistered(ProviderAccountService, true)` then `resolve`). No new `@inject`. | (a) Add a constructor `@inject(ProviderAccountService)`. (b) Lazy resolve. (c) Refuse every non-omitted selection without a lookup. | (a) changes the constructor that all 7 agent-rpc specs call positionally, with no file budget to fix them, and makes CLI/VS Code hosts resolve the account service eagerly. (c) would wrongly refuse an ambient restatement. Precedent for lazy resolve: `mcp-directory-rpc.handlers.ts:1354`, `workspace-rpc.handlers.ts:456`. `ProviderAccountService` is registered as a class token (`auth-providers/src/lib/di/register.ts:158`) and already used as one in `provider-account-rpc.handlers.ts:150`. | Yes |
| D-28a-2: On `inherit` the selection is not put on the spawn request. | Forward it vs drop it after the check. | `SpawnAgentRequest` (`libs/shared/src/lib/types/agent-process.types.ts:254-328`) has no `accountSelection` field, and shared is outside 28a ownership (D31). On resume the stored binding is authoritative (plan 237, `rpc-agents.types.ts:390-403`), so after `inherit` the selection carries no information. | Yes |
| D-28a-3: Non-`claude` CLIs and Ptah CLI agents count as stored `absent`. | Treat them as absent vs refuse every selection for them. | Only `claude` lanes carry a binding (`lane-resume-gate.ts:212`; `PROVIDER_ACCOUNT_PROVIDERS` codex lane binding not wired). An ambient restatement is truthful. A named account is a conflict, so it fails closed. | Yes |
| D-28a-4: Resume refusals use the text `Agent resume account refused (<code>).`. `agent:continue` keeps its existing `Claude lane …` text. | One shared text vs per-method text. | The pre-spawn check also covers non-claude CLIs, so "Claude lane" would be wrong there. The `agent:continue` text is pinned by existing tests and stays unchanged. The resume result type has no `code` field: `rpc.types.ts` is outside ownership. | Yes |
| D-28a-5: The `getConfig`/`setConfig`/`resume` tests went into `agent-rpc.handlers.spec.ts`, not `agent-rpc.handlers.set-config.spec.ts`. | Split across the two specs vs one spec. | `agent-rpc.handlers.spec.ts` already covers both `setConfig` and resume and has a settings-map harness. This kept the change inside the tool budget. No suite was copied. | Yes |

## Specs that mock changed members

All 7 agent-rpc specs mock `@ptah-extension/cli-agent-runtime` and `@ptah-extension/auth-providers`:

- `agent-rpc.handlers.spec.ts`
- `.set-config.spec.ts`
- `.decision-model.spec.ts`
- `.decision-endpoint.spec.ts`
- `.migration.spec.ts`
- `.list-rows.spec.ts`
- `.resume-parent-session.spec.ts`

The handler now imports `ProviderAccountService` (a value) from `@ptah-extension/auth-providers`. In the six specs I did not edit, the mock does not export it, so it resolves to `undefined`. It is only touched when a request carries a non-omitted `accountSelection`, and none of those specs send one, so I expect no change there.

Watch `getConfig` assertions that use exact `toEqual` on the whole config object: they now also get `claudeModel: ''` and `claudeReasoningEffort: ''`. Candidates are `list-rows.spec.ts` and `decision-model.spec.ts`. I did not read them.

## For Batch 34 (callers)

I verified the files below but did not read exact caller lines.

- `libs/shared/src/lib/types/rpc.types.ts:1389`: the `agent:resumeCliSession` registry params need `accountSelection?: ProviderAccountSelection`, so typed callers can send it. Today it is accepted only at runtime.
- Fresh spawn: `SpawnAgentRequest` in `libs/shared/src/lib/types/agent-process.types.ts:254-328` has no `accountSelection`. The MCP spawn path (28b, `agent-spawn-args.schema.ts`) cannot carry a selection to `AgentProcessManager.spawn` until that field exists and the runtime reads it. `agent-adapter.types.ts:179,229,254` already has it at the adapter level.
- Electron callers: the webview `AgentMonitorStore.resumeAgentWithMessage` and `agent-card.component.ts` (named in `agent-rpc.schema.ts:48-50`) send no selection today. That stays valid, and they only need to send one if the UI offers it.
- ptah-cli: the `agent resume` command (`apps/ptah-cli`, see "from ptah agent-cli resume" in `agent-rpc.handlers.resume-parent-session.spec.ts:618`) sends no selection. That stays valid.
- `AgentResumeOutcome` / resume result type: no safe `code` field yet, so refusals travel only as `error` text. Add a `code` when `rpc.types.ts` is in scope (D28 also lists `account_refused` for `AgentContinueErrorCode`).
- The frontend may now send `claudeModel` / `claudeReasoningEffort` on `agent:setConfig`. The Batch 25 caveat ("ignored") is closed.

## Verification

- Per the batch rules I ran no nx, jest, tsc, lint or npm.
- `ptah_get_diagnostics` was called twice, scoped to the changed files. Both calls came back **unavailable** ("TypeScript check still running after 45s"), so no type result was observed.
- Formatting: some new handler lines may exceed the Prettier width (the resume refusal `return`, the `lookupBySdkSession` call). lint-staged or Prettier should reformat them.
- Suggested commands, one at a time:
  - `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers --coverage=false --maxWorkers=2` (covers all 7 agent-rpc specs)
  - `npx jest -c libs/backend/platform-core/jest.config.ts libs/backend/platform-core/src/file-settings-keys.spec.ts --coverage=false --maxWorkers=2`
  - Then `npx nx run-many -t typecheck test -p rpc-handlers platform-core --parallel=1`, plus the host typechecks per `Verify-ProviderAccountsBatch`.

## Risks to check in the test run

- `claude` must be a member of `SYSTEM_CLI_TYPES` (Batch 26, commit 48ccfbebc) for the schema to accept `cli:'claude'`.
- The new `getConfig` tests depend on the harness mocks covering everything `getConfig` touches (`detectAll` was added). If something else is unmocked, those 2 tests fail. The handler itself is not affected.
- The "fails validation" test relies on `runId: 'C:/not/an/id'` failing the opaque-id check.

## Out-of-scope observations

- `grokReasoningEffort` and `antigravityReasoningEffort` are written by `agent:setConfig` but are not in `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:106-125`). Their saves may be dropped on file-settings hosts, the same defect fixed here for the Claude keys. I did not touch them.
