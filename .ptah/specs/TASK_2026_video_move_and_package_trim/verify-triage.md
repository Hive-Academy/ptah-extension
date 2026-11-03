# Verification triage

## Failure triage

"Fails on main?" is inferred from unchanged files and the earlier implementation report; main was not run separately. The original removed-item assertions were corrected before this lane.

| Target | Fails on main? | Cause | Task-caused? | Fix |
| --- | --- | --- | --- | --- |
| `@ptah-extension/persistence-sqlite:lint` | Likely; failing files unchanged | Ten SQL interpolation lint errors in migration 0057/0058 files and specs | No | Leave to persistence owner. |
| `@ptah-extension/agent-sdk:test` | Likely; failing specs unchanged | Two symlink `EPERM` cases in `plugin-loader.service.session-notice.spec.ts:220` and `plugin-loader.service.capabilities.spec.ts:324` | No | Windows symlink privilege; no test edit. |
| `@ptah-extension/chat-ui:test` | No current failure | Passed after earlier removed-item assertion corrections | Earlier failure yes; fixed before this lane | None remaining. |
| `@ptah-extension/harness-sync:test` | Likely; failing specs unchanged | Symlink `EPERM` in `workspace-target.retirement.spec.ts:379`; Windows slash expectations in `harness-reconciler.retirement.spec.ts:397,466` | No | Leave unchanged tests to owner. |
| `@ptah-extension/agent-generation:test` | Likely for remaining failures; failing spec unchanged | Symlink `EPERM` in `user-layer-reap.spec.ts:799,827` | No remaining task-caused failure | Windows symlink privilege; no test edit. |
| `@ptah-extension/auth-providers:lint` | Likely; failing metadata unchanged | Unused persistence-sqlite dependency in `libs/backend/auth-providers/package.json:9` | No | Leave unrelated metadata to owner. |
| `@ptah-extension/auth-providers:test` | Likely; failing spec unchanged | Windows identity/path expectations in `codex-account-usage.service.spec.ts:481,503` | No | Leave unchanged test to owner. |
| `@ptah-extension/usage-analytics:lint` | Likely; failing file unchanged | `prefer-const` in `codex.source.ts:43` | No | Leave unrelated lint to owner. |
| `@ptah-extension/rpc-handlers:test` | Likely for remaining failures; failing specs unchanged | 30 failures across nine suites: Windows symlink, path, permission, and fixture outcomes; no removed-item reference in task log | No remaining task-caused failure | Leave unchanged Windows-sensitive tests to owners. |
| `ptah-electron:test` | No current failure | Passed after earlier removed-item assertion corrections; Nx flags historical flakiness | Earlier failure yes; fixed before this lane | None remaining. |

## Changes made

- Confirmed `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-reachability.table.ts:1682` already names only the retained `docs-screenshots/workspace-settings.shot.ts` consumer; no source edit was needed.
- Completed this failure triage. No remaining task-caused failure was found, so no production or test code was changed in this lane.

## Decisions

- Coordinator decision: keep all package removals, including `node-pty` and `nodejs-whisper`. No live source import, project external, Electron builder or Electron package reference remains. `ptah-electron:validate-deps` passed previously. A later package change could reverse this, but this lane must not edit `package.json` or `package-lock.json` or run `npm install`.
- Leave unchanged Windows symlink and path-sensitive tests intact. The task treats unchanged symlink `EPERM` cases as environment-only and untouched lint as pre-existing. A separate task can revise those tests if needed.
- Main was not checked out or executed. "Likely" baseline classifications rest on unchanged failing files and the earlier implementation report.

## Verification

Each target used `npm run verify -- -t <test|lint> -p <project> 2>&1 | Select-Object -Last 40` (the PowerShell equivalent of `tail -40`). Exit codes below are verify process codes printed after the pipeline. Failing details came from the corresponding Nx task terminal output.

| Command target | Exit | Tail / failing detail |
| --- | ---: | --- |
| `-t lint -p @ptah-extension/persistence-sqlite` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `33 problems (10 errors, 23 warnings)` |
| `-t test -p @ptah-extension/agent-sdk` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `2 failed, 5 skipped, 5270 passed` |
| `-t test -p @ptah-extension/chat-ui` | 0 | `NX 1 task: 1 succeeded, 1 cached` |
| `-t test -p @ptah-extension/harness-sync` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `3 failed, 2 skipped, 726 passed` |
| `-t test -p @ptah-extension/agent-generation` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `2 failed, 1 skipped, 1461 passed` |
| `-t lint -p @ptah-extension/auth-providers` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `11 problems (1 error, 10 warnings)` |
| `-t test -p @ptah-extension/auth-providers` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `2 failed, 10 skipped, 2567 passed` |
| `-t lint -p @ptah-extension/usage-analytics` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `3 problems (1 error, 2 warnings)` |
| `-t test -p @ptah-extension/rpc-handlers` | 1 | `NX 1 task: 0 succeeded, 1 failed`; `30 failed, 7 skipped, 5807 passed` |
| `-t test -p ptah-electron` | 0 | `NX 7 tasks: 7 succeeded, 7 cached`; Nx also reported a flaky-task advisory |

Final aggregate command (PowerShell `Select-String` is the requested `grep -E` equivalent):

`npm run verify -- -p ptah-electron,ptah-extension-webview,@ptah-extension/rpc-handlers,mcp-bench,@ptah-extension/webview-e2e-harness,@ptah-extension/cli-engine,@ptah-extension/platform-cli 2>&1 | Select-String -Pattern 'Running target|Successfully|failed|tasks:' | Select-Object -Last 20`

Exit 1; tail: `NX 26 tasks: 25 succeeded, 9 cached, 1 failed`. The failed task was `@ptah-extension/rpc-handlers:test`; its task log ended `Test Suites: 9 failed, 210 passed` and `Tests: 30 failed, 7 skipped, 5807 passed`. All other 25 tasks in this scoped aggregate passed, including Electron, renderer webview, mcp-bench, cli-engine, platform-cli and webview e2e harness targets.

## Open items

- The unrelated `rpc-handlers:test` Windows failures prevent an all-green final aggregate gate on this host. The other pre-existing target failures in the table remain open for their owners.

## Lane limits (coordinator, 2026-11-03)
- kimi code (pc-10e5a6b5…, family kimi-code): API 429 "rate limit exceeded" at 05:23 UTC during the
  final review (7c1213b6, wrote only a skeleton). Reset unknown; skipped for the rest of this run.
- Glm (ollama-cloud): AT LIMIT (error-derived, reset unknown). Final review moved to grok (956b6679).
- grok: 402 "Grok Build usage balance exhausted" at 05:24 UTC (956b6679). Skipped for this run.
- Subagent reason: no non-codex lane with room (Glm AT LIMIT, kimi 429, grok 402, copilot/claude
  disabled, antigravity failed at start). Final review by an in-process code-logic-reviewer
  subagent (family claude; implementer codex).
