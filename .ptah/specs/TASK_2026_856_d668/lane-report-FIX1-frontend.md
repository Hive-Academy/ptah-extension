# FIX1 frontend lane report

## Fixes

- S1: Exported the finite, non-negative `isValidTokenCount` guard at `libs/shared/src/lib/utils/token-usage.utils.ts:4` and `libs/shared/src/lib/utils/index.ts:93`. Applied it to message and session totals (`token-usage.utils.ts:20,31`), CLI totals (`cli-usage.utils.ts:32,40-41`), and context fill (`context-fill.utils.ts:11,47`). Added negative, NaN, and Infinity cases in `token-usage.utils.spec.ts:3,62`, `context-fill.utils.spec.ts:26,70-73`, and `cli-usage.utils.spec.ts:204-208`.
- S2: Added the payload/window/display explanation at `libs/frontend/chat-state/src/lib/live-context-stats.ts:33`; behavior is unchanged.
- M1: `applyResumeStats(tabId, sessionId, ...)` now reads the tab once and carries its prior live stats only when `tab.claudeSessionId === sessionId` at `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:1255-1256`. Regression at `session-loader.service.spec.ts:962` checks the other-session trusted prior yields the unknown placeholder and `sessionContextCue` label `—`.
- m2: `session-live-stats.util.ts:78` uses the host-provided numerator directly and removes the unused import.

## NUL counts

- Before edit: **1** literal NUL byte, counted with `ReadAllBytes` because `grep` was not on PowerShell PATH. The requested `grep -c -aP '\x00'` was attempted before editing and failed with command-not-found.
- After byte-safe replacement: **1** literal NUL byte. The same byte-level count and `C:\Program Files\Git\usr\bin\grep.exe -c -aP '\x00'` both returned **1** after editing.

## Checks

- `npm run verify -- -t test -p @ptah-extension/shared -- --testPathPatterns="token-usage|context-fill|cli-usage"`: `NX 1 task: 1 succeeded`, exit 0.
- `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="session-loader|session-live-stats"`: initial run `NX 1 task: 0 succeeded, 1 failed`; the new fixture made the tab belong to the other session too early, causing an existing ownership check to stop the flow. Corrected the fixture.
- Follow-up changed-project check `npx nx test @ptah-extension/chat --testPathPatterns="session-loader|session-live-stats" --coverage=false --maxWorkers=2 --outputStyle=static`: `Test Suites: 5 passed, 5 total`; `Tests: 2 skipped, 157 passed, 159 total`; exit 0.
- `npm run verify -- -t test -p @ptah-extension/chat-state -- --testPathPatterns="live-context-stats"`: `NX 1 task: 1 succeeded`, exit 0.
- `git diff --check` on changed files: clean.
- Scoped `ptah_get_diagnostics`: unavailable after two 45-second timeouts; no TypeScript diagnostic result was returned.

## Unmet requirements

- The pre-edit GNU grep invocation could not run because `grep` was not on PATH; an exact byte-level count was used before the edit. The post-edit GNU grep invocation succeeded via Git's bundled executable.
- Scoped Ptah TypeScript diagnostics did not complete. All requested focused test suites passed after the fixture correction.
