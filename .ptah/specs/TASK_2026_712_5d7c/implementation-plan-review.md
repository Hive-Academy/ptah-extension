# Implementation plan review — TASK_2026_712_5d7c

**Verdict: APPROVED**

**Revision:** architecture re-review revision 1 of maximum 2, against architecture revision 1 of `implementation-plan.md`.

Reviewed the revised plan against the previous REVISE review. No production code was changed. No removal is approved. This approval is technical-plan approval only. Mocked process and query doubles do not authorize subscription enablement or release.

## Disposition

### B1. Closed

The revised plan names one typed backend route and one final child-env application after the env object already exists.

- `ClaudeAccountRoute` is a closed readonly union, `{ kind: 'ambient' }` or `{ kind: 'named'; provider: 'claude'; profileId; canonicalConfigDir; routeFingerprint; routeRevision; authEpoch; runId }`, produced only by admission (`implementation-plan.md:119`). It is not added to `AuthEnv`, has no env bag, and is not a public RPC path.
- `applyClaudeAccountRouteEnv` clones the finished child env, sets `CLAUDE_CONFIG_DIR` only for a named route, then deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and the finite certified conflicting selectors (`implementation-plan.md:168`). It does not mutate `process.env`, `AuthEnv`, `HOME`, `USERPROFILE`, or `XDG_*`.
- Placement is after existing construction (`implementation-plan.md:169`):
  - Lane: after `env: buildSafeEnv(authEnv)` at `ptah-cli-registry.ts:873`. The options object that contains it is the object passed to `queryFn` (`ptah-cli-registry.ts:807-882`); nothing later in that object overwrites `env`.
  - Main: after the `process.env` / tier / `effectiveAuthEnv` / `NO_PROXY` / beta / workflow object at `sdk-query-options-builder.ts:1331-1346`.
  - One-shot: after the `process.env` / tier / leak-cleanup / auth / `NO_PROXY` / beta object at `sdk-query-runner.service.ts:600-615`.
- Probe and resume use those constructors or the same helper over the completed env, never a raw `process.env` launch (`implementation-plan.md:169`). The model probe’s completed env is the local object at `sdk-model-service.ts:809-816`, and that service is in the Component 4 modify set (`implementation-plan.md:174,177`). Resume takes the route from the persisted binding, not the current selection (`implementation-plan.md:169,190`).
- Ambient and omitted routes skip the helper. `buildSafeEnv` (`build-safe-env.ts:46-85`) still forwards `HOME`, `USERPROFILE`, and `XDG_*` and does not forward `CLAUDE_CONFIG_DIR`. The official auth-command child (`implementation-plan.md:147`) is a separate argument-array launch with the same directory and foreign-routing clearing; it does not replace the SDK helper.

The configured-provider connection test at `ptah-cli-registry.ts:522-536` also calls `buildSafeEnv`, but only after an API key is resolved (`:506-515`). It is not a named main, lane, one-shot, probe, or resume path.

### B2. Closed

The plan extracts the native lane’s real option and handle behaviour and leaves `runInteractive` as the launch funnel.

- `InteractiveRunInput` is `{ mode: 'interactive'; prompt: AsyncIterable<SDKUserMessage>; options: SdkQueryOptions }` and the result is `{ sdkQuery: Query }` (`sdk-query-runner.service.ts:236-252`). `runInteractive` loads `query` and `invokeWithLoadedQuery` forwards that prompt and options (`:442-458`). The plan does not put admission or policy assembly inside it (`implementation-plan.md:163`).
- `ClaudeSdkLaneRunner` receives the completed options, the caller-owned async prompt, stream callbacks, and lifecycle context (`implementation-plan.md:164`). Option construction at `ptah-cli-registry.ts:807-882` and `resolvePermissionOptions` at `:1345-1400` are extracted for both the existing registry and `ClaudeCliAdapter`. The adapter passes native auth `{}`, resolved model and effort, real capability policy, and the typed route. It does not invent a `PtahCliConfig`.
- `assembleSpawnOptions(authEnv, cwd, resolvedModel, sessionContext, agentId, role, capabilityPolicy)` matches the method at `ptah-cli-spawn-options.service.ts:170-178`. MCP, hooks, system prompt, output-style and capability flags, and strict isolation go through that assembly into the same builder (`implementation-plan.md:165`).
- Permissions stay the current mapping. YOLO returns `bypassPermissions` and `allowDangerouslySkipPermissions` with no `canUseTool` (`ptah-cli-registry.ts:1363-1370`). Every other level returns `canUseTool` from `createCallback` (`:1391-1399`). Named accounts add no bypass (`implementation-plan.md:166`).
- Stream, per-turn settlement, session replay, `setAgentId`, queued continuation, and cleanup stay the `:884-1008` behaviour (`implementation-plan.md:167`). The current handle exposes `supportsContinuation: () => true` (`ptah-cli-registry.ts:977`) and no steer or message-interrupt capability. The plan advertises `steer: false`, `interrupt: false`, `continuation: true`, and `supportsMcp` true when the Ptah MCP server is attached. A3 does not turn that flag off (`implementation-plan.md:167,172`).
- Named execution uses a new empty-until-commit iterable (`implementation-plan.md:185`). `createPromptMailbox` still queues `initialTask` immediately (`ptah-cli-prompt-mailbox.ts:23-24`) and stays on the configured native path only. Abort or close drops held messages and wakes waiters without yielding them.
- Cancel, timeout, mismatch, and storage failure close the gate before query teardown, settle each pending turn once, deny outstanding permission waits, and dispose hooks, MCP, proxy, and listeners (`implementation-plan.md:167,188`). `accountInfo()` is `Promise<AccountInfo>` (`sdk.d.ts:2923-2928`). `AccountInfo.email` and `organization` are optional (`sdk.d.ts:23-26`). The plan does not treat that result as `authMethod`.

Component 5’s outer sequence (`implementation-plan.md:184`) is narrowed by the required split at `:186-187`: a non-persisting control query with certified named env and no conversation or resume data, torn down before a second query that carries the extracted policy. The user prompt stays gated until that second query’s own `accountInfo()` check and both durable writes commit. That split does not restore a prompt-first path and does not add a second stream protocol.

## Nonblocking clarifications

All six prior notes are now in the plan.

| Prior note | Where the revision states it |
| --- | --- |
| Release predicate is live named auth-command and live named query launch only | `implementation-plan.md:18` |
| CLI session index has `sdkSessionId` and no profile id | `implementation-plan.md:190`, matching `apps/ptah-cli/src/cli/commands/session.ts:147-158` |
| Output-style activation file | `implementation-plan.md:207`. The file exists; `:35-65` is the lifecycle comment and imports, not a method body |
| `@ptah-extension/persistence-sqlite` on `auth-providers` | `implementation-plan.md:140` |
| Design §3.1 duplicate-directory sentence, with no path | `implementation-plan.md:129`, matching `design-spec.md:52` |
| No PID or timeout lock stealing | `implementation-plan.md:136` |

## Introduced regressions

None that block implementation. The connection-test env at `ptah-cli-registry.ts:536` is outside the named routes this revision had to close. `AccountInfo` also carries `tokenSource`, `apiKeySource`, and `apiProvider` (`sdk.d.ts:27-32`); the plan still certifies named auth from official `auth status`, which is the A1 hold, not a new contract.

## Open holds

These stay open after approval. None of them is cleared by this verdict, and none authorizes a removal.

| Hold | Why it stays open |
| --- | --- |
| Subscription enablement and release | User-reserved. The plan’s release predicate (`implementation-plan.md:18,330`) wraps live named launches only. Mocked doubles are technical proof, not shipping authorization. |
| A1 | Installed `auth status` must emit a matching canonical directory and `authMethod`. Fixtures are not that proof. |
| A2 | A mocked empty-iterable `accountInfo()` test is required, and installed-runtime compatibility is still required before live named execution. |
| A3 | Selected-directory user state and project, local, and managed auth precedence stay unproven. Named routes report unsupported imported user MCP and approvals until then. |
| A4 | Codex file-store isolation is unproven. Keyring, auto, and ephemeral stores are not certified. |
| Abandoned reservation recovery | No automatic reclaim. Unresolved leases stay unavailable. |
| Rendered Electron evidence | Dark, light, focus, and the 960, 640, and embedded-400 widths still need a later launch. Design source approval is not that evidence. |

## Decision

APPROVED for implementation of the technical plan. B1 and B2 are closed in the revision. Do not add scope, do not drop account actions, and do not treat this approval as release authorization.
