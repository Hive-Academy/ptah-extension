# Lane B — RPC mock hygiene

## Files changed

- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts`: return shared `rpcSuccess` results for model listing and pricing hydration in the existing RPC mock; retain its fallback behavior.
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts`: supply the same successful method-specific payloads in the existing inline RPC provider.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts`: retain `createMockRpcService` and override its generic call with model/pricing payloads; retain successful undefined fallback.
- This report: `lane-b-report.md`.

No production files, shared setup, excluded specs, existing test cases, or assertions were changed. No console suppression was added. Existing compaction-test console spies were left unchanged.

## Verification

Run from `D:\projects\ptah-extension\.claude-worktrees\chat-test-hygiene`.

The requested Jest command was executed with PowerShell filtering equivalent to grep/head:

```powershell
$results = & npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts --coverage=false --maxWorkers=2 2>&1; $jestExit = $LASTEXITCODE; $results | Select-String 'ModelStateService|pricing-get|Tests:|Test Suites:|●' | Select-Object -First 40; Write-Output "JEST_EXIT=$jestExit"; Write-Output "MODEL_LOG_LINES=$(($results | Select-String 'ModelStateService|pricing-get').Count)"; if ($jestExit -ne 0) { $results | Select-String -Pattern '●' -Context 0,12 | Select-Object -First 8 }; exit $jestExit
```

Filtered result:

```text
● Test suite failed to run (three suites)
Test Suites: 3 failed, 3 total
Tests:       0 total
JEST_EXIT=1
MODEL_LOG_LINES=0
```

Blocker: the preset maps marked to this worktree's nonexistent `node_modules/marked/lib/marked.umd.js`. The installed file exists at `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js`. No repository configuration or dependency directories were modified.

A second run used Jest's CLI API with only a command-line module mapper override:

```powershell
$results = @'
require('jest').run(['-c', 'libs/frontend/chat/jest.config.ts', 'libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts', 'libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.command-center-lock.spec.ts', 'libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.spec.ts', '--coverage=false', '--maxWorkers=2', '--moduleNameMapper', JSON.stringify({'^marked$': 'D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js'})]);
'@ | node 2>&1
$jestExit = $LASTEXITCODE
$results | Select-String 'ModelStateService|pricing-get|Tests:|Test Suites:|●' | Select-Object -First 40
Write-Output "JEST_EXIT=$jestExit"
Write-Output "MODEL_LOG_LINES=$(($results | Select-String 'ModelStateService|pricing-get').Count)"
if ($jestExit -ne 0) { $results | Select-String -Pattern '●' -Context 0,14 | Select-Object -First 6 }
exit $jestExit
```

Filtered result:

```text
● Console
● unified CLI agent output › keeps content-bearing segments with usage visible in the tree
● unified CLI agent output › keeps no-segment raw stdout and stderr visible through the fallback renderer
● unified CLI agent output › renders replacement text when coalescing keeps the segment count unchanged
Test Suites: 1 failed, 2 passed, 3 total
Tests:       3 failed, 104 passed, 107 total
JEST_EXIT=1
MODEL_LOG_LINES=0
```

Both chat-input suites pass. The three CLI-output failures are rendering expectations: expected "Answer with usage metadata" but node text is empty (line 264); expected "Raw stdout response" but only raw fallback/tool/error content is present (line 301); expected "First" but rendered text is empty (line 359). No fakeAsync/Zone failure was reported. These failures are not proven to be caused by another lane; their cause remains unverified. The required model/pricing noise is absent across the executed tests, but this is not an all-green verification.

Scoped `ptah_get_diagnostics` was called after edits with the three absolute spec paths. Its final completed result reports 255 project errors, zero warnings. Only one requested-file error remains: `chat-input.component.spec.ts:1022`, TS2352 on an unchanged partial-event cast. Sibling-file diagnostics are outside this lane's scope. An intermediate call timed out after 45 seconds without cancelling its check; the completed result was retrieved before Jest. No new error is reported for the changed mock code.

## Findings

- No confirmed production defect was found. `libs/frontend/core/src/lib/services/model-state.service.ts:172` requests pricing, and lines 173–177 log `result.error` when success data is missing. The model-list equivalent requests at line 286 and logs at lines 320–322. In these specs, failed mocks omit an error and the shared default success omits data, explaining the printed undefined values. Production error handling was not changed.
- Worktree dependency mapping prevents the exact unmodified Jest invocation from loading the suites; the verification-only override above resolves that environment limitation.
- Three CLI-output rendering failures remain, as detailed above; no assertions were weakened to accommodate them.

## Decisions

- Use real ModelStateService with valid RPC responses rather than replacing it: its constructor explicitly loads models and pricing, and existing specs already supply RPC mocks. This preserves integration coverage and is reversible.
- Reuse `rpcSuccess` from `libs/frontend/core/src/testing/mock-rpc-service.ts:26`; keep `createMockRpcService` in CLI-output. No shared helper was changed because ownership is restricted to these specs.
- Return `{ models: [] }` and `{ pricing: {}, hydrated: false }`: source requires these payloads and neither test suite needs populated models or hydrated remote pricing. Empty pricing preserves bundled pricing without muting logs.
- Use a command-line marked mapper override for verification only; alternatives were changing shared config or adding dependencies to the worktree, both outside assigned ownership. Reversible and leaves repository files untouched.

## Not done / additional specs

No extra spec files were changed. The direct ModelStateService grep found existing doubles in model-selector, agent-card-flat-header, inspector-agents-section, subagent-lane, message-sender.command-center, message-sender.host-data, message-sender.session-identity, message-sender.service, workspace-coordinator, and tab-close-session-end.integration specs. No additional directly constructed real ModelStateService was identified by that scan. It does not prove absence of indirect injection in all other chat specs; the full chat suite was deliberately not run.

Production behavior, out-of-scope files, existing event-cast diagnostics, and CLI-output rendering failures remain untouched. No git commands were run.

