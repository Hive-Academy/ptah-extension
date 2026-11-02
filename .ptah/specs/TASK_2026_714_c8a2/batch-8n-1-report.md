# Codex initialize timeout and startup diagnostics

## Summary

Extended the Codex app-server initialize handshake budget from 10,000 to 60,000 ms, including OS process start-up. Ordinary requests retain a named 30,000 ms budget. Pin verification is computed once. A successful start logs the binary path, pinned version, pin status, and elapsed time from immediately before spawn to the initialize response. An initialize timeout uses the existing single failure log with elapsed time, timeout budget, and the bounded, redacted stderr tail.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-app-server-process.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-app-server-process.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8n-1-report.md`

## Specs added or updated

- **accepts an initialize response after fifteen seconds and logs the verified start once**: proves a response beyond the former 10 second budget succeeds and the info log has path, version, pin status, and measured duration exactly once, without a test environment secret.
- **times out the handshake at sixty seconds with the original error and one bounded diagnostic log**: proves it remains pending at 59,999 ms, then rejects at 60,000 ms with `CodexProcessFailureError`, reason `Codex request timed out`, and method `initialize`. It also checks the single warning has elapsed and timeout fields, bounded redacted stderr, and no test environment secret.
- **aborts a slow handshake promptly without waiting for its timeout**: proves abort at 5,000 ms rejects with method `initialize` immediately and closes stdin.

The existing abort listener is installed before `sendRequest()` arms the initialize timer. On abort, `fail()` rejects pending requests and clears their timers, so the longer timeout does not delay cancellation.

Only the resolved binary path, pinned version, pin verification status, start duration, failure reason and method, timeout measurements, and existing bounded redacted stderr tail enter these logs. The new metadata never includes environment values, URLs, headers, tokens, or request parameters.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use a 60,000 ms initialize budget | Longer handshake budget or move timer start | Observed bundled binary startup takes 12.6–13.6 s; the old 10 s budget fails before its response. | Yes; one constant. |
| Measure with `Date.now()` immediately before spawn | `Date.now()` or `performance.now()` | Existing Jest fake timers advance `Date.now()`, enabling exact duration and boundary assertions. | Yes. |
| Extend `fail()` for initialize timeout diagnostics | One existing failure log or an additional timeout line | `fail()` already logs a bounded redacted stderr tail; one warning prevents duplicate failure lines. | Yes. |
| Log the start after handshake and notification flush | Log immediately after spawn or after successful start | A start log should represent a completed handshake and appear once per successful start. | Yes. |

## Open items

- The coordinating team must run the changed-project verification and perform a live Electron startup check. No tests, builds, lint, typecheck, or other checks were run here, as directed.
- No Electron app file needed changing.
