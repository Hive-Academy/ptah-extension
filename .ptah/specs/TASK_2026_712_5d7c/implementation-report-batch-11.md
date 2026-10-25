# Batch 11 implementation report

## Files changed

All paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`.

- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts` (256 lines).
- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.spec.ts`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts` (additive contracts only).
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.ts`.
- MODIFIED `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts`.
- CREATED this authorized deliverable, `.ptah/specs/TASK_2026_712_5d7c/implementation-report-batch-11.md`.

No native registry/source/spec, detection roster, SYSTEM_CLI_TYPES, host file, task state or batch state was changed. No Git commands were run.

## Adapter API and capabilities

`ClaudeCliAdapter` implements the additive `ClaudeCliAdapterContract`. It exposes detect, runSdk, listModels, parseOutput and capabilities. `ClaudeCliCommandOptions` adds parentSessionId and a typed accountAdmission selection request, never an environment bag or caller-certified route.

Detection uses the existing SdkModuleLoader.getCliJsPath and getQueryFunction. Neither the query function nor model discovery is invoked by detection. Missing executable, missing SDK and loader rejection return isolated installed:false results. Execution uses only buildClaudeSdkLaneOptions and ClaudeSdkLaneRunner, with empty native auth, resolved executable, real capability policy and PtahCliSpawnOptions. No ACP, CLI status command, shell execution protocol or fabricated PtahCliConfig is introduced.

The assembly receives actual cwd, agent id, parent/own session ids, role and capability policy. Existing system-prompt construction, Ptah MCP policy, hooks, settings, output style, auto-compact, strict isolation, native process spawner and permission bridge feed the shared builder. The lazy permission resolver begins with the supplied agent id and receives later setAgentId updates. Resume routing retains precedence over parent routing.

Capabilities are continuation:true, steer:false, interrupt:false; roleChannel is system-prompt and supportsMcp is true through the existing policy-filtered assembly. Real runner handles retain abort, done, output, segments, rich stream events, session callbacks and queued continuation. Pre-subscription segment/event buffers are capped at 5000 and cleared on completion/startup failure. The real quota-owner/plan-limit helper is created per run.

Explicit model identifiers are passed unchanged, ahead of injected defaults. An unresolved model is omitted so the SDK chooses; no new hard-coded model or tier mapping is introduced. Effort is checked against both the installed SDK scale and the selected native model metadata. Precedence is explicit request, configured value, inherited chat value, reviewer default, chat value, SDK default; unsupported candidates are skipped without Codex max-to-xhigh coercion. modelTier is ignored. Unknown metadata means no effort is applied. Catalog discovery uses the existing native-Claude model service and failures return an empty/unknown catalog.

There are currently no Claude-specific lane setting keys in AgentSpawnEnvironment (its existing model/effort maps do not include Claude). Runtime registration therefore supplies current chat effort from ReasoningSettings and leaves the model at the native CLI default when omitted. The injectable defaults seam supports configured precedence without inventing settings outside this batch. Public settings/roster activation remains Batch 26.

Account-aware runs fail closed before SDK loading, query creation or lease acquisition. The dependency uses ProviderAccountAdmissionPort and AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_ACCOUNT_ADMISSION from the public auth-providers-tokens alias. A missing port refuses; even a registered port refuses until durable admission and the own-query prompt gate are integrated in Batches 17/20. This deliberately also refuses explicit ambient admission requests for now. Ordinary omitted-route native runs remain available. No caller env is accepted or applied.

## Registration

- Token: `ClaudeCliAdapter` class; lifetime: instanceCachingFactory, one cached instance per registration.
- Token: `ClaudeSdkLaneRunner` class; lifetime: instanceCachingFactory, one cached stateless runner per registration. Each run owns its mailbox, callbacks, abort and plan-limit helper.
- Dependencies use existing public SDK/settings/auth tokens. Policy, model catalog, admission, reasoning settings and quota-owner dependencies resolve lazily where needed; no manager/detection cycle is introduced during construction.
- The runtime smoke spec verifies cached adapter identity, the real ClaudeSdkLaneRunner and the real OffThreadProcessSpawner. The existing native PtahCliRegistry smoke assertions remain.

## Specs by acceptance item

These are authored assertions, not an executed-test pass claim.

1. Detection isolation:
   - `detects the executable and SDK without status, model probes or inference`
   - `isolates a missing executable`
   - `isolates a missing SDK and a failing executable loader`
2. Actual handle/options/model/effort:
   - `forwards empty native auth, real context and complete policy options to the extracted runner` (real extracted runner; mocked stream loop; checks native query arguments, policy, permission routing, spawn callback, continuation and settlement).
   - Parameterized `resolves request %s, setting %s and inherited %s without coercion` (max retained, unsupported request falls through, xhigh is not coerced, inherited and reviewer precedence).
   - `forwards explicit models unchanged, ignores modelTier and does not invent a default`
   - `treats unavailable model metadata as unknown and applies no effort`
   - `closes the prompt and ends lifecycle tracking on synchronous SDK failure`
3. Native-path regression preservation:
   - Existing native PtahCliRegistry specs and source are unchanged.
   - Existing registry DI smoke assertions retained; added `registers a cached constructible Claude adapter with the real SDK runner and spawner`.
   - CI must execute existing native regressions; this lane was explicitly forbidden to run Jest/Nx.
4. Named admission:
   - `fails closed before named admission, SDK loading or prompt release even with a registered port`
5. SDK-only protocol:
   - Constructibility test proves detection never calls query or models.
   - Complete-options test runs the real ClaudeSdkLaneRunner and observes its SDK query call and off-thread spawn callback. No alternative execution protocol exists in the adapter.

## Required guard updates

None required by the inspected guard contracts. `apps/ptah-electron/src/di/expected-resolvable.ts:14`, `apps/ptah-cli/src/di/expected-resolvable.ts:17` and `apps/ptah-extension-vscode/src/di/expected-resolvable.ts:21` enumerate handler classes, not all runtime class registrations. The corresponding smoke and surface-composition specs do not enforce a closed census of these runtime class tokens. The owned runtime smoke spec covers the two new registrations. No host guard was edited.

## Decisions

- **Separate additive constructibility contract until roster activation.** Options: broaden the public CLI union/roster or add a Claude-specific contract extending the existing adapter methods. Evidence: shared agent-process.types.ts derives CliType from SYSTEM_CLI_TYPES, and the batch explicitly forbids adding Claude there. Chosen additive contract with a Claude detection discriminant; existing CliAdapter remains unchanged. Reversible at Batch 26.
- **Runtime-local class registrations.** Options: add token/barrel files outside ownership or register by class. Evidence: existing register.ts registers AgentSpawnEnvironment and AgentOutputBuffer by class, and this batch owns neither tokens.ts nor the barrel. Chosen cached class factories, including a real runner. Reversible when public activation is assigned.
- **Fail closed before acquiring account leases.** Options: partially invoke admission without prompt gating or refuse account-aware execution. Evidence: Batch 10 explicitly leaves integration to Batches 17/20; the admission port says route certification alone does not permit conversation release. Chosen refusal even with a present port, preventing an unused lease or premature prompt. Reversible when the full lifecycle is implemented.
- **Reuse current native defaults and SDK catalog.** Options: invent Claude-specific model IDs/settings or preserve SDK default and existing ReasoningSettings. Evidence: lane-spawn-policy.ts gives non-Codex lanes their CLI default, AgentSpawnEnvironment has no Claude lane setting, and sdk-model-service.ts exposes native catalog metadata. Chosen native default plus inherited chat effort, with an injectable configured-default seam for direct unit tests. Named catalog requests remain inaccessible until admitted routing exists. Reversible during settings/roster integration.
- **Reuse native assembly and permission mapping.** Options: duplicate option policy or use Batch 9 helpers. Evidence: implementation-plan.md lines 164-165 and existing native registry usage explicitly require shared assembly/builder/runner. Chosen helpers with empty auth and real context. No replacement protocol or generic abstraction introduced.

## Verification and remaining work

- Prettier TypeScript parsing/formatting completed for the five owned source/spec files.
- Final ptah_get_diagnostics scoped to those five files returned source typescript-compiler, clean coverage, zero errors and zero warnings; no sibling diagnostics.
- No nx, jest, tsc, lint, build, real provider binary, network, sign-in or Git command was run.
- Native green status and the newly authored Jest assertions require CI execution; diagnostics alone do not establish test success.
- Batches 17/20 must integrate account admission, durable binding, identity verification, gated prompt release and lease teardown before account-aware execution can be enabled. Batch 26 owns public Claude type/roster/settings activation. Those are intentionally not implemented here.
- No other known unfinished implementation item within the assigned Batch 11 file scope.
