# Backend implementation — TASK_2026_609_c495, batch B-5c2

**Verdict:** Implemented; scoped typecheck, lint, tests and diagnostics pass.

## Files changed

- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.ts — added public listForClassification(), using shared private loadModels() to preserve a single live-list replacement rule and one detector call per invocation. Only nonempty live Codex/Copilot results are provider-reported. All detector-derived classification entries are copied with isFallback: true; Claude is empty. listAll() keeps its original property order, values and detector array references.
- MODIFIED D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/libs/backend/rpc-handlers/src/lib/services/cli-model-list.service.spec.ts — seven added classification cases (two parameterized pairs and three individual cases); existing listAll serialization cases retained.
- CREATED D:/projects/ptah-extension/.claude-worktrees/task-609-subagent-setup/.ptah/specs/TASK_2026_609_c495/b5c2-executor-report.md — this executor report.

## Spec assertions

1. Live Codex: live entries replace detector entries, have no isFallback property, survive providerReported(), and detector/auth/host are each queried once. A following listAll() has byte-identical expected JSON.
2. Live Copilot: same guarantees for host-reported models.
3. Empty Codex auth: every detector entry is marked fallback, including a detector entry carrying isFallback: false. providerReported() returns empty; original detector data is not mutated; a following listAll() retains its exact JSON.
4. Empty Copilot host list: same guarantees for Copilot.
5. Cursor/OpenCode: detector entries carry isFallback: true; providerReported(result.cursor) is empty; Claude is []; the result has exactly the five classification providers; detector queried once.
6. Missing detector keys and empty live lists: all five classification arrays are empty, with one detector call.
7. Failed live queries: detector Codex and Copilot entries are still returned with fallback provenance.
8. Existing listAll() tests remain: byte-identical JSON on empty/live paths, metadata and reference preservation, live naming/property order, failed refinements, missing detector keys, live models without detector entries, and detector error propagation.

## Stack and source evidence

- TypeScript 6.0.3, tsyringe 4.10.0, Nx 23.2.1 and Zod 4.6.5 verified in package.json/package-lock.json; rpc-handlers/package.json declares tsyringe and Zod dependencies. This service is a host-independent backend service, not a NestJS controller.
- Existing constructor injection and private auth/host helpers in cli-model-list.service.ts are reused unchanged. No new registrations, dependencies, external calls or untrusted-input boundaries.
- Shared AgentModelProvider/AgentModelEntry/providerReported contracts verified in libs/shared/src/lib/types/agent-models.types.ts and exported by libs/shared/src/index.ts:53.
- Project scope:extension/type:feature tags and check targets from libs/backend/rpc-handlers/project.json; package-alias imports follow eslint.config.mjs boundary rules.
- Error handling remains with existing optional-query catch paths and the RPC error handler (agent-rpc.handlers.ts, registerListCliModels).
- Jest Node/ts-jest configuration from libs/backend/rpc-handlers/jest.config.ts.

## Verification

Scoped ptah_get_diagnostics for the two changed source/spec files: typescript-compiler, clean coverage, 0 errors, 0 warnings. AST parse: clean, 0 error nodes.

### Typecheck and lint

Command: npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers
Output captured through Select-Object -Last 40; exit code 0.

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
  Run duration:      23.1s
  Cache:             0/2 hit (0%)
  Critical path:     23.0s (1 task)
  Recoverable time:  <1ms
```

### Tests

Command: npx nx run-many -t test -p @ptah-extension/rpc-handlers --maxWorkers=2
Output captured through Select-Object -Last 40; exit code 0.

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
  Run duration:      56.3s
  Cache:             0/1 hit (0%)
  Critical path:     56.2s (1 task)
  Recoverable time:  <1ms

  Recommendations:
    - Speed up or split the longest tasks on the critical path:
        @ptah-extension/rpc-handlers:test    56.2s
```

Nx reported successful uncached task execution but suppressed detailed Jest suite/test counts. No counts are claimed and the suite was not rerun. A read-only attempt to find cached terminal output found no .nx/cache/terminalOutputs directory.

## Deviations and out-of-scope observations

No implementation deviations. No git commands, task-state edits, or changes to other source files. The report is the explicitly requested additional deliverable.
Nx Cloud reported organization quota/401 warnings after both successful commands; these did not fail local verification. No out-of-scope source failures were reported.
Native file reads were used because no direct ptah file-content reader is listed; ptah_search_files, ptah_ast_analyze and scoped ptah_get_diagnostics were used where applicable.

