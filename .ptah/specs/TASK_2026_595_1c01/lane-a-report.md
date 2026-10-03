# Backend implementation - TASK_2026_595_1c01, lane A

**Tasks completed:** components 4, 5, 6 and 8. Baseline captured before production edits; temporary measurement spec deleted. Source changes remain uncommitted. No git commands were run.

**Result:** coding sessions list none of the three Apps tools and calls return an isError result naming the tool and saying "available on the Apps page only". Apps lists all three eagerly. Profile attribution comes only from the URL; body copies are discarded. Request context reaches the real execute_code help path.

## Files

- CREATED [mcp-core/mcp-tool-profile.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts) - Closed profile resolver, Apps-only tool names and actionable refusal text.
- CREATED [mcp-core/mcp-tool-profile.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.spec.ts) - Resolver defaults, exact tool set and refusal-message regression tests.
- MODIFIED [mcp-core/types/mcp-protocol.types.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts) - Transport-owned raw profile field.
- MODIFIED [mcp-http/http-server.handler.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts) - Terminal URL profile reader, workspace-tail grammar and body-field stripping.
- MODIFIED [mcp-http/http-server.handler.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.spec.ts) - URL grammar, encoded roots/profiles, malformed escapes and forged-body coverage.
- MODIFIED [mcp-core/mcp-request-context.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts) - Typed request profile and default-coding getter.
- MODIFIED [mcp-core/mcp-request-context.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.spec.ts) - Default, await propagation, concurrency isolation and cleanup checks.
- MODIFIED [mcp-core/protocol-dispatcher.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts) - Profile-filtered listing, Apps eager metadata, context binding and call refusal.
- MODIFIED [mcp-core/protocol-dispatcher.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts) - Catalog/eager invariants, refusal without namespace calls and real execute_code help coverage; existing Apps calls updated.
- MODIFIED [mcp-core/protocol-dispatcher.surface.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts) - Apps URLs for existing surface paths and forged-profile HTTP refusal without state mutation.
- MODIFIED [mcp-core/dashboard-propose-spec.tool.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts) - Apps listing/calls/help and coding absence assertion.
- MODIFIED [mcp-core/mcp-contract.sweep.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts) - Coding 53/50 and Apps 56/53 matrix; Apps listing and drivers retain full contract coverage.
- MODIFIED [namespace-builders/system-namespace.builders.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts) - Injected profile-aware overview, topic help and discovery.
- MODIFIED [namespace-builders/system-namespace.builders.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts) - Coding help suppression and unchanged Apps help.
- MODIFIED [namespace-builders/tasks-namespace.builder.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts) - Explicit coding profile for help builder.
- MODIFIED [ptah-api-builder.service.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts) - Wires request-context profile getter into help.
- CREATED [measurement.md](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/.ptah/specs/TASK_2026_595_1c01/measurement.md) - Before/after host tables, per-tool sizes, method and limitations.
- CREATED [lane-a-report.md](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/.ptah/specs/TASK_2026_595_1c01/lane-a-report.md) - This handoff.
- CREATED then DELETED D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-profile.measure.spec.ts - Temporary baseline/after measurement only.

No edits to shared, agent-sdk, rpc-handlers, frontend, dependency files or configuration files. tool-result-budget.spec.ts and surface-trust-boundary.spec.ts do not dispatch through handleMCPRequest and needed no changes.

## Stack and repository evidence

- Node 24.x, TypeScript 6.0.3, tsyringe ^4.10.0, Zod 4.6.5 and Jest ^30.0.2: root package.json / package-lock.json. This change serves the Node MCP HTTP/dispatcher runtime, not NestJS.
- Plain dispatcher dependencies and the existing request AsyncLocalStorage are reused: protocol-dispatcher.ts and mcp-request-context.ts. PtahAPIBuilderService supplies the getter; no registration/module/dependency was introduced.
- External profile parsing follows the existing closed URL grammar and decode/error handling in http-server.handler.ts. Unknown decoded profiles resolve to coding against the shared MCP_TOOL_PROFILES export.
- CONVENTIONS.md section 8 and eslint.config.mjs enforce downward layers/package aliases. The help builder receives a getter rather than importing mcp-core.

## Measurements

| Host | Before chars / estimated tokens | Coding chars / estimated tokens | Apps chars / estimated tokens |
| --- | ---: | ---: | ---: |
| Electron-like | 123484 / 30871 | 54471 / 13618 | 123568 / 30892 |
| VS Code-like | 125789 / 31448 | 56776 / 14194 | 125873 / 31469 |

Coding saves **69,013 characters**, approximately **17,253-17,254 tokens**, versus baseline. Apps adds 84 characters of eager metadata. Estimates use ceil(chars / 4), not exact tokenization. Full evidence is in measurement.md.

## Verification

- Baseline measurement: **1 suite, 2 tests passed** before production edits.
- After measurement: **1 suite, 2 tests passed**; report written and temporary spec deleted.
- Final complete vscode-lm-tools Jest run: **78 suites passed, 2,521 tests passed, 0 failed, 0 skipped**, 118.045 seconds. Used the repository project config through Jest runCLI, maxWorkers=2, with only the marked package mapping adjusted as described below.
- `npx nx typecheck @ptah-extension/vscode-lm-tools`: **PASS**, tsc --noEmit; 15.2 seconds.
- Final `npx nx lint @ptah-extension/vscode-lm-tools`: **PASS**, **0 errors / 71 warnings**; 9.5 seconds.
- Required `npx nx run-many -t test,typecheck -p @ptah-extension/vscode-lm-tools --maxWorkers=2` was executed. That intermediate run failed (26 failed / 53 passed suites, 1,180 passing tests): the preset cannot find worktree-local marked, and it caught two unintended getter properties in workspace resolver wiring. Those properties were removed; the subsequent typecheck and full test run above pass. The unmodified Nx test invocation still has the environment limitation below and is not claimed green.
- ptah_get_diagnostics was called with scoped changed files. It returned **unavailable**, because its TypeScript check exceeded 45 seconds; the subsequent Nx typecheck is the completed compiler evidence.
- No full-workspace checks were run.

## Plan deviations

1. Nx 23 / Jest 30 uses `--testPathPatterns` (plural). The plan's singular flag did not filter the initial run, which was stopped; the measurement itself subsequently ran alone before production edits.
2. The worktree has no local node_modules. Root jest.preset.js hard-codes `<worktree>/node_modules/marked/lib/marked.umd.js`, which does not exist. No files outside ownership were changed. Successful measurements/tests used the existing project config with only `^marked$` mapped to `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` via Jest runCLI. Attempts to pass this through Nx CLI configuration serialization did not preserve the JSON. The fallback ran real tests against this worktree's sources.
3. Explicit `ptah.help('overview')` receives the same coding filtering as `ptah.help()`; otherwise the explicit overview topic would disclose the hidden namespaces. Both forms are tested.
4. Exact token counts and a live application cross-check were optional and were not performed.

## Reproducing the full test fallback

Run from the assigned worktree, feeding this JavaScript to node (no file creation required):

```js
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs', moduleResolution: 'node', ignoreDeprecations: '6.0',
  },
});
const root = require('node:path').resolve('libs/backend/vscode-lm-tools');
const config = require(root + '/jest.config.ts').default;
config.rootDir = root;
config.moduleNameMapper['^marked$'] =
  'D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js';
require('jest').runCLI({
  config: JSON.stringify(config), maxWorkers: 2, $0: 'jest', _: [],
}, [root]).then(({ results }) => {
  console.log({
    suitesPassed: results.numPassedTestSuites,
    suitesFailed: results.numFailedTestSuites,
    testsPassed: results.numPassedTests,
    testsFailed: results.numFailedTests,
  });
  process.exitCode = results.success ? 0 : 1;
});
```

Windows PowerShell reported exit 1 for piped Jest stderr warnings even when Jest's structured result was successful; the pass counts above are from Jest's actual results, not inferred from that wrapper exit.

## Open items and out-of-scope observations

- Standard Nx test execution needs worktree-local dependency resolution corrected by the invoking workflow, or the documented command-only override.
- Jest reports its existing project-level coverageThreshold configuration warning and a worker teardown/active-timer warning. All 2,521 tests passed; no unrelated cleanup was attempted.
- The 71 lint warnings remain. No out-of-scope fixes were made.
- Live Apps chat create/patch/read and SDK URL use were not manually exercised; real HTTP surface integration and execute_code help tests pass. The other lane owns URL writing, RPC propagation and the Apps page.

