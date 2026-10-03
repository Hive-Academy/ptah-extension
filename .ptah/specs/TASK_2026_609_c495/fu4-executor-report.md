# Backend implementation — TASK_2026_609_c495, batch FU-4

**Tasks completed:** Behaviour-preserving agent model type cleanup.

**Diff summary**
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/harness-sync/src/lib/targets/harness-target.port.ts`: added optional `HarnessPlanWrite.model?: string` with the agents-only transformed-copy documentation.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/harness-sync/src/lib/targets/workspace-target.ts`: removed the local `AgentModelPlanWrite` type and its comment, typed the writes array as `HarnessPlanWrite[]`, and replaced the runtime property guard with `const model = write.model`. No remaining `AgentModelPlanWrite` references in this file.
- Existing conditional model forwarding, transformation, and hashing remain unchanged. No tests or other source files edited.

**Stack observed:** TypeScript 6.0.3, Nx 23.2.1, tsyringe 4.10.0 (package.json and package-lock.json). This is the runtime-agnostic harness target engine, using Node filesystem operations and constructor-supplied WorkspaceHarnessTargetOptions; no HTTP framework applies. HarnessAgentSource documents that models are already resolved and checked by isAgentModelEmittable (targets/transformers/agent-transformer.port.ts). Existing package aliases and boundary rules in eslint.config.mjs remain unchanged.

**Verification:** Both requested checks passed (exit 0), with PowerShell `Select-Object -Last 30` serving as `tail -30`. Scoped ptah_get_diagnostics reported clean coverage, zero errors and zero warnings. Seven selected suites / 60 tests passed, covering harness-manifest.builder case 6 (plan/write/file hash equality) and rival-targets.agent-model.

Command: `npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync 2>&1 | tail -30`

```text
NX   Running targets typecheck, lint for project @ptah-extension/harness-sync:

- @ptah-extension/harness-sync


√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck



 NX   Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync


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
  Run duration:      6.5s
  Cache:             0/2 hit (0%)
  Critical path:     6.4s (1 task)
  Recoverable time:  <1ms
CHECK_EXIT=0
```

Command: `npx nx test @ptah-extension/harness-sync --maxWorkers=2 --testPathPatterns="harness-manifest.builder|rival-targets|workspace-target|artifact-retirement|retire-local-edit" 2>&1 | tail -30`

```text
> nx run @ptah-extension/harness-sync:test --maxWorkers=2 --testPathPatterns=harness-manifest.builder|rival-targets|workspace-target|artifact-retirement|retire-local-edit

node.exe : The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g 
@nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See 
https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (The `@nx/jest:j...ed for details.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
Test Suites: 7 passed, 7 total
Tests:       60 passed, 60 total
Snapshots:   0 total
Time:        7.274 s, estimated 10 s
Ran all test suites matching 
harness-manifest.builder|rival-targets|workspace-target|artifact-retirement|retire-local-edit.



 NX   Successfully ran target test for project @ptah-extension/harness-sync


 NX   Nx Cloud encountered some problems
This Nx Cloud organization has been disabled due to exceeding the FREE plan.
Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan at 
https://cloud.nx.app/orgs/68b4af751a4191272698bd6c/plans. (code: 401)
  Run duration:      8.0s
  Cache:             0/1 hit (0%)
  Critical path:     7.9s (1 task)
  Recoverable time:  <1ms
CHECK_EXIT=0
```

**Plan deviations:** None. No git commands run.

**Out-of-scope observations:** Nx Cloud reports its organization disabled for exceeding the free plan (401); local checks still exit 0. The existing @nx/jest:jest executor emits a deprecation warning. No required work blocked.

