# Backend implementation — TASK_2026_609_c495, batch B-5c

**Verdict:** Implemented; scoped typecheck, lint and test targets passed (exit 0). No git commands ran.

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.ts` — Injectable listAll() extracted from the handler, including both live refinements and display-name formatting.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.spec.ts` — Eight cases covering serialized parity, metadata retention, live refinements, empty lists, refinement failures, and top-level detector rejection.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts` — Delegates listing to CliModelListService; logging, Sentry capture and error propagation remain in the handler.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts` — Registers CliModelListService with registerSingleton.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.list-rows.spec.ts` — Adjusts constructor imports and arguments for the extracted service; existing assertions unchanged.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.migration.spec.ts` — Adjusts constructor imports and arguments for the extracted service; existing assertions unchanged.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.resume-parent-session.spec.ts` — Adjusts constructor imports and arguments for the extracted service; existing assertions unchanged.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts` — Adjusts constructor imports and arguments for the extracted service; existing assertions unchanged.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/.ptah/specs/TASK_2026_609_c495/b5c-executor-report.md` — this executor report.

## Behavior and verification

The same six properties are returned in the same order: codex, copilot, cursor, antigravity, opencode, pi. Detector arrays and entry metadata are preserved. Nonempty Codex auth and Copilot host lists replace their detector lists using the original name mapping. An empty or rejected refinement preserves the detector list. Missing detector keys become empty arrays. A top-level listModelsForAll() rejection still propagates to the original handler error path; no new catch or fallback was invented. Individual adapter failures are already caught in CliDetectionService.listModelsForAll() and omit that provider's entry.

Eight service cases include JSON.stringify equality for both fallback and live-refinement output. Four existing handler spec constructors needed the new dependency in place of the old two dependencies.

### Typecheck and lint

Command: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers`, captured with PowerShell `Select-Object -Last 40` (equivalent to tail -40).

```text
NX   Running targets typecheck, lint for project @ptah-extension/rpc-handlers:

- @ptah-extension/rpc-handlers


√  nx run @ptah-extension/rpc-handlers:lint
√  nx run @ptah-extension/rpc-handlers:typecheck



 NX   Successfully ran targets typecheck, lint for project @ptah-extension/rpc-handlers


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan.
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at 
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)
  Run duration:      33.8s
  Cache:             0/2 hit (0%)
  Critical path:     33.8s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/rpc-handlers:typecheck    33.8s
CHECK_EXIT=0
```

### Tests

Command: `npx nx run-many -t test -p @ptah-extension/rpc-handlers --maxWorkers=2`, captured with PowerShell `Select-Object -Last 40`.

```text
NX   Running target test for project @ptah-extension/rpc-handlers:

- @ptah-extension/rpc-handlers

With additional flags:
  --maxWorkers=2


√  nx run @ptah-extension/rpc-handlers:test --maxWorkers=2



 NX   Successfully ran target test for project @ptah-extension/rpc-handlers


Output of 1 successful task was not shown. Run with --verbose or --output-style=static to see it.

node.exe : 
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
 NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan.
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at 
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)
  Run duration:      1m 57s
  Cache:             0/1 hit (0%)
  Critical path:     1m 57s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/rpc-handlers:test    1m 57s
TEST_EXIT=0
```

Nx suppressed individual successful-task output; no suite/test total is claimed. Both invocations reported zero cache hits. The Nx Cloud free-plan warning was nonfatal. No failure in libs/shared/src/lib/types/agent-models.types.ts appeared.

Scoped ptah_get_diagnostics was called after edits. It returned **unavailable**, with all four supplied production/new-spec files unchecked because its compiler was still running after 45 seconds. The explicit scoped Nx typecheck subsequently passed; the unavailable diagnostics result is not counted as a pass.

## Fallback versus provider-reported finding

No new field was introduced and no response field was added.

- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:141` already defines optional `CliModelOption.isFallback`.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.interface.ts:19` defines `CliModelInfo` with only id/name. The current adapter directory does not populate isFallback.
- CodexCliAdapter.listModels() returns its curated SUPPORTED_MODELS (`codex-cli.adapter.ts:414`); CopilotSdkAdapter.listModels() returns curated COPILOT_MODELS (`copilot-sdk.adapter.ts:234`). Those entries are unmarked.
- CursorCliAdapter.listModels() (`cursor-cli.adapter.ts:290`) returns either SDK results or FALLBACK_MODELS with the same id/name shape. Provenance is lost before this service sees it.
- CodexAuthService.listModels() (`auth-providers/src/lib/providers/codex/codex-auth.service.ts:302`) returns live account models or an empty list. Copilot host results come from IModelDiscovery. The extracted refinements still map to exactly id/name.
- Existing metadata on detector entries is retained untouched, but **absence of isFallback does not establish that an entry was provider-reported**. Matching ids against a curated list cannot reliably establish provenance because live lists may contain the same ids.
- The service's Codex/Copilot branch knows whether it selected live results or curated detector results, but the byte-identical response does not expose that distinction. Cursor requires provenance from its adapter. A downstream requirement that fallback entries never classify as Listed needs a separately authorized provenance change at those producer boundaries (using the existing optional field); it cannot be guaranteed by the current response.

## Stack and scope evidence

- Node 24, TypeScript 6.0.3, tsyringe ^4.10.0 and Zod 4.6.5: package.json and package-lock.json. This is the shared host RPC library, not a NestJS HTTP module.
- DI follows AgentRpcHandlers and TurnChangeSetStore: @injectable, explicit @inject tokens, class registration in registerSharedRpcHandlers. ConnectionCheckRecorder provides the same singleton service-registration precedent. All three host composition roots already call registerSharedRpcHandlers.
- Existing RPC boundary and validation stay unchanged; listAll takes no untrusted arguments. Imports use established package barrels. Project tags are scope:extension/type:feature (rpc-handlers/project.json); dependency rules are in eslint.config.mjs.
- Verification targets and Jest configuration come from rpc-handlers/project.json and jest.config.ts.

**Plan deviations:** None in behavior. The display-name helper moved with its only consumers. Four allowed existing specs needed constructor adjustments. Fallback provenance is reported instead of changing response bytes.

**Out-of-scope observations:** Current model provenance is insufficient for the downstream classifier, as detailed above. No concurrent-batch files were edited.

