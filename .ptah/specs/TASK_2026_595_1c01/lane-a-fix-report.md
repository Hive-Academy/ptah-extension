# Lane A review fixes - TASK_2026_595_1c01

All five assigned findings are addressed. Only vscode-lm-tools source/specs and this report were written; no git operations, dependency changes or configuration changes.

## Review #2 - execute_code namespace bypass

- Changed: [mcp-tool-profile.ts:32](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts:32) adds withAppsNamespaceProfile, a typed proxy using the existing throwing-proxy convention from PtahAPIBuilder.buildNamespaceSafe. Every method reads the injected profile getter at invocation time and throws appsOnlyToolMessage with its namespace/method name before invoking the underlying method when the profile is not apps.
- Wiring: [ptah-api-builder.service.ts:861](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:861) wraps dashboard; [line 882](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:882) wraps surface. Both receive getCallerToolProfile. Apps calls preserve the original receiver, arguments and result.
- Specs: [ptah-api-builder.service.spec.ts:619](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts:619) exercises the real executeCode engine with the built API for surface.update, surface.getState and dashboard.proposeSpec. Each coding call rejects with the Apps-only wording and all namespace method mocks remain untouched; each apps call on the same API invokes the intended method exactly once with unchanged arguments.
- Additional spec: [mcp-tool-profile.spec.ts:47](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.spec.ts:47) captures a method, switches coding/apps/coding, and verifies lazy profile checks plus preservation of the original namespace receiver.

## Review #3 - stale namespace count

- Changed: [system-namespace.builders.ts:50](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:50) drops the fixed count from the overview title: "Ptah IDE Access - Namespaces:". Neither profile now advertises a stale total.
- Spec: [system-namespace.builders.spec.ts:425](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts:425) pins that exact heading for coding help() and help('overview'), while retaining the Apps-topic omission assertions.

## Review #4 - plain-URL trust-boundary coverage

- Changed/spec: [protocol-dispatcher.surface.spec.ts:161](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts:161) restores all four plain paths: /, /workspace/ws-plain, /session/attacker and /session/victim.
- Each case sends forged body session attribution on both a read and a delete. Both calls return the coding Apps-only refusal, neither leaks the victim secret, neither namespace method runs, and the victim's stored state equals its pre-call snapshot.
- The Apps-profile anonymous/workspace, attacker-session and legitimate victim-session variants remain as additional cases, along with the existing forged body profile refusal.

## Review #5 - coding and Apps driver coverage

- Changed/spec: [mcp-contract.sweep.spec.ts:1793](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts:1793) parameterizes "every served tool has a registered driver" over coding and apps.
- Each profile explicitly supplies _callerToolProfile when obtaining both IDE and non-IDE catalogs. Both assert every served tool has a driver or a named exception; stale exceptions still fail.
- Full Apps oversized-result sweeps and existing coding/Apps count and set-difference tests remain intact.

## Review #6 - malformed URL escape handling

- Confirmed: profile extraction at [http-server.handler.ts:395](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:395) is inside the request handler's try/catch. The catch responds with HTTP 400 and JSON-RPC code -32700 / "Parse error" at [line 414](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:414), matching the sibling extractors. No production change or silent fallback is needed.
- Spec: [http-server.handler.spec.ts:513](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.spec.ts:513) now covers /profile/%ZZ, /profile/%E0%A4 and /session/s1/profile/%E0%A4. All assert HTTP 400, -32700, and no onMCPRequest invocation.

## Verification

Final command: `NX_NO_CLOUD=true NX_DAEMON=false npx nx run-many -t test,typecheck,lint -p @ptah-extension/vscode-lm-tools --output-style=static` (environment variables set through PowerShell).

- **PASS: all three targets**, exit code 0; no cache hits (0/3).
- **Tests: 78 suites passed, 2,532 tests passed, 0 failed**, 128.809 seconds. This adds 11 regression cases to the previous 2,521-test baseline.
- **Typecheck: PASS**, the library's declared tsc --noEmit target.
- **Lint: PASS, 0 errors / 71 warnings**. Existing warnings were not changed.
- Total Nx run: 2 minutes 13 seconds. Plain Nx worked with the provided node_modules junction; no package-path override was needed.
- Scoped ptah_get_diagnostics found no production errors and caught a `this` typing issue in the new captured-method fixture. The fixture was fixed before the final passing run. Changed files were formatted with the repository Prettier configuration.
- An earlier combined invocation passed tests/lint but failed typecheck because Nx forwarded the shared --maxWorkers=2 flag to tsc. The final invocation removed that flag and temporarily constrained only the verification process and its children to two CPUs (Node availableParallelism verified as 2), keeping the configured Jest 50% worker pool at one worker. The invoking PowerShell process's original affinity was restored afterward.
- Runner warnings: Nx reports the @nx/jest executor deprecation and a Jest-config ES-module loading warning. Neither prevented the successful run; unrelated runner/configuration changes were not made.

## Files written

- [mcp-core/mcp-tool-profile.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts)
- [mcp-core/mcp-tool-profile.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.spec.ts)
- [ptah-api-builder.service.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts)
- [ptah-api-builder.service.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.spec.ts)
- [namespace-builders/system-namespace.builders.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts)
- [namespace-builders/system-namespace.builders.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts)
- [mcp-core/protocol-dispatcher.surface.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts)
- [mcp-core/mcp-contract.sweep.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts)
- [mcp-http/http-server.handler.spec.ts](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.spec.ts)
- [lane-a-fix-report.md](D:/projects/ptah-extension/.claude-worktrees/task-595-apps-tool-profile/.ptah/specs/TASK_2026_595_1c01/lane-a-fix-report.md)

## Scope and remaining items

- No changes outside the assigned library and task report.
- Review #1 (session-profile persistence) and #7 (live-session continuation semantics) are outside this lane's assigned findings.
- No live UI run was requested or performed. Real executeCode-engine and HTTP-boundary tests provide the regression coverage.
