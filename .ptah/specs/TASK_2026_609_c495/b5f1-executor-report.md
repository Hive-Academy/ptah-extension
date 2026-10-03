# Backend implementation — TASK_2026_609_c495, batch B-5f1

Implemented B-5f1.1 and B-5f1.2 within the four assigned source/spec files. Typecheck, lint and diagnostics passed. The full test command remains red only for the supplied baseline: 17 known failures plus capability-policy C3; no additional failures.

## Files changed

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.ts` — optional lazy structural model reader; models accompany synchronous, effective-policy and fallback states when available.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.spec.ts` — nine additional model-reader cases, with isolated home directory.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\di\register.ts` — builder warnings reach `logger.warn(message, toDetail(detail))`, matching the adjacent manifest store registration and builder's `(message: string, detail?: unknown) => void` callback.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\rival-targets.agent-model.spec.ts` — three filesystem integration cases through the real resolver, builder, reconciler and Codex target.
- CREATED this report: `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b5f1-executor-report.md`.

No changes to workspace-target, agent-generation, settings-core, task status or other source files. No git commands were run.

## Getter contract and workspace root

The factory and class constructor accept the same second argument:

```ts
type AgentModelsFactory = () => {
  layersForPath(workspacePath: string): AgentModelLayers;
} | null;

createPluginConfigSourceResolver(
  readerFactory: () => HarnessPluginConfigReader | null,
  agentModelsFactory?: AgentModelsFactory | HarnessSourceLayout,
  mcpIntents?: McpIntentStore,
): IHarnessSourceResolver;
```

The existing layout form is still required by current consumers: plugin-gate and capability-policy specs, the resolver specs, and rpc-handlers' wizard-generation.preview-fidelity spec. The second argument distinguishes a function from a layout object, preserving those callers without edits outside the batch. Hosts can pass their settings getter directly as argument two. There is no settings-core import, new DI registration or dependency.

`HarnessReconcilerService` calls `resolveHarnessWorkspaceRoot(cwd)` at its entry points and passes the resulting root to `sourceResolver.resolve(workspaceRoot)` (service lines 194/202 and 271/384 at inspection). The resolver forwards that same root verbatim to `layersForPath`, just as it already does for plugin policy and `scopeAgentsRoot`. No active workspace or new root inference is introduced. The integration test starts reconciliation from `workspace/src/nested` and proves the getter receives the marked workspace root.

The getter is invoked on each scoped resolve, never during construction or from a cache. Absent getter, null result, throwing getter, or throwing `layersForPath` omit the `agentModels` property entirely. Missing/empty workspace roots skip the getter. Model failure does not change other source fields or synchronous/asynchronous resolution behavior. The resolver has no logger, so its non-fatal catch is documented in place; builder warnings are separately connected to the host logger.

## Specs

Resolver additions:

- Fresh layers for exact roots A and B, with lazy construction, on synchronous policy, effective policy and unavailable-plugin-reader paths (three cases).
- Absent getter, null result, getter throw, and layers read throw leave the complete serialized state byte-identical to the no-getter baseline, with no own `agentModels` property (four cases).
- Undefined and empty roots never invoke model settings (two cases).

Codex integration additions:

- Changing one slug's model from `model-one` to `model-two` rewrites the actual TOML without `overwrittenLocalEdit`, including nested-cwd root normalization.
- `provider model preview` fails the syntax heuristic but classifies as provider-listed and emittable; the actual TOML contains that exact value.
- Absent getter and empty layers both preserve a literal pre-model Codex output fixture, including omission of the source's Claude `model: opus` hint.

The integration suite mocks `os.homedir()`, clears and restores `CODEX_HOME`, puts source, workspace and home under a temporary directory, grants explicit agent consent, and cleans up that directory. No helper outside the owned spec was needed.

## Stack and boundaries observed

- `package.json` / `package-lock.json`: TypeScript 6.0.3, tsyringe 4.10.0, Zod 4.6.5, Nx 23.2.1; Jest declared ^30.0.2 and locked 30.5.2.
- This is a runtime-agnostic Node filesystem library, not a NestJS handler. `di/register.ts` supplies collaborators through existing factories and tsyringe registrations. The resolver takes structural host readers.
- `project.json`: scope:extension/type:feature, Nx lint/typecheck/Jest targets. `eslint.config.mjs` restricts extension imports to shared/extension and enforces the existing type lattice.
- Existing `McpIntentStore` uses Zod at its file boundary; the model reader delegates settings reads to the host. Shared model resolution/emittability already defensively handle model data. No new external input boundary was introduced.

## Verification

Scoped `ptah_get_diagnostics` on all four changed source/spec paths: TypeScript compiler, clean coverage, 0 errors, 0 warnings.

PowerShell `Select-Object -Last` was used as the equivalent of the requested `tail` commands.

```text
npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync 2>&1 | Select-Object -Last 30

√ nx run @ptah-extension/harness-sync:lint
√ nx run @ptah-extension/harness-sync:typecheck
NX Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
Run duration: 5.3s
Cache: 0/2 hit (0%)
```

```text
npx nx test @ptah-extension/harness-sync --maxWorkers=2 2>&1 | Tee-Object -FilePath "$env:TEMP/ptah-b5f1-tests.log" | Select-Object -Last 40

capability-policy.spec.ts:458:36: expect(applied[0].baseEntries).toEqual({})
Test Suites: 6 failed, 49 passed, 55 total
Tests:       18 failed, 502 passed, 520 total
Snapshots:   0 total
Time:        14.747 s
Ran all test suites.
NX Running target test for project @ptah-extension/harness-sync failed
```

Failure classification from the saved output: agent-consent 2, skill-consent 7, gitignore E23 5, cancellation B8 2, write-failure E21 1, capability-policy C3 1. This exactly matches the supplied baseline plus the known C3 flake. Neither changed spec suite appears among failures; all 17 tests in those two suites passed (five existing resolver tests, nine added resolver cases, three new integration tests). No suite was rerun.

Both commands also reported the existing Nx Cloud organization-disabled/free-plan 401 warning; local lint/typecheck still succeeded. Raw test output was captured at `C:\Users\abdal\AppData\Local\Temp\ptah-b5f1-tests.log` and not added to the repository.

## Deviations and limitations

The second argument retains the current layout input alongside the requested getter because repository consumers already depend on that contract and edits to them were out of scope. No behavioral plan deviation. The full required test suite is not green because of the enumerated known baseline failures; these were not changed. Host getter wiring belongs to B-5f2/3/4 and was not performed here.

## Fix round 1

The orchestrator-requested API correction supersedes the second-argument union documented above.

- Restored the constructor's original second parameter exactly: `private readonly layout: HarnessSourceLayout = defaultHarnessSourceLayout()`.
- Kept `mcpIntents` third and added `private readonly agentModelsFactory?: AgentModelsFactory` fourth. Removed constructor `typeof` discrimination and separate property assignments.
- Factory signature is now `createPluginConfigSourceResolver(readerFactory, layout?, mcpIntents?, agentModelsFactory?)`.
- Exported `AgentModelsFactory` from `plugin-config-source-resolver.ts` and moved the getter arguments in both owned specs to position four. Existing layout/MCP callers remain unchanged.
- Model resolution behavior, reconcile-root forwarding, failure fallback, and builder warning registration remain as previously implemented.

Files modified this round:

- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\sources\plugin-config-source-resolver.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\rival-targets.agent-model.spec.ts`
- This report: `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\.ptah\specs\TASK_2026_609_c495\b5f1-executor-report.md`

Barrel finding / host follow-up: `libs/backend/harness-sync/src/index.ts:238-244` explicitly re-exports named symbols from the resolver file, including `HarnessPluginConfigReader`, but does NOT re-export `AgentModelsFactory`. Per instruction, the barrel was not edited. The type is exported from its defining file but must be added to the public barrel by an authorized follow-up before hosts can import it through `@ptah-extension/harness-sync`. No deep import was introduced.

Verification (PowerShell tail equivalent; each command run once):

```text
ptah_get_diagnostics — scoped to the three modified source/spec files
Source: typescript-compiler; coverage: clean; errors: 0; warnings: 0

npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync 2>&1 | Select-Object -Last 30
PASS @ptah-extension/harness-sync:lint
PASS @ptah-extension/harness-sync:typecheck
NX Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
Run duration: 5.4s; cache: 0/2 hit

npx nx test @ptah-extension/harness-sync --maxWorkers=2 --testPathPatterns="plugin-config-source-resolver|rival-targets|register" 2>&1 | Select-Object -Last 30
Test Suites: 5 passed, 5 total
Tests:       26 passed, 26 total
Snapshots:   0 total
Time:        5.381 s
Ran all test suites matching plugin-config-source-resolver|rival-targets|register.
NX Successfully ran target test for project @ptah-extension/harness-sync
```

Both checks succeeded locally despite the Nx Cloud free-plan/organization-disabled 401 warning. Jest also reported the existing Nx executor deprecation warning. No failure in parallel-owned files was observed. No git commands or edits to workspace-target.ts, content-hash.ts, artifact-retirement.ts, or the barrel were performed.
