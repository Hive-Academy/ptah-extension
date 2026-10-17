# Renderer console error log fix

## Root cause

`process-lifecycle-recorder.ts:222-232` passed the bounded renderer message and source only as the second argument to `logger.error`. Unlike `warn`, `Logger.error` treats that argument as structured context (`libs/backend/vscode-core/src/logging/logger.ts:156-185`). Its console sink prints only `context.metadata` and `context.error`, not arbitrary context fields (`logger.ts:344-365`); `Logger.warn` instead inlines its argument in the message (`logger.ts:145-146,227-234`). That produced bare `[ERROR] [renderer] console.error` lines while warning lines retained their JSON. The supplied `electron.log` shows this at lines 983 and 641 respectively.

## Change

- `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.ts:222-236`: inline the same bounded, redacted `message` and bounded `source:line` in the error log message. The structured context is still passed through, and warning behavior and rate limiting are unchanged.
- `apps/ptah-electron/src/services/diagnostics/process-lifecycle-recorder.spec.ts:182-206,240-262`: assert the error log's printable argument contains the message and source, and excludes the sample query secret and second-line API key.

## Verification

No Nx, Jest, `tsc`, build, or Electron command was started, per the task constraint. `ptah_get_diagnostics` was requested for both changed files, but its TypeScript worker first reported termination after another run timed out, then reported that a check was still running after 45 seconds. It did not return diagnostics for either file.

Angular's installed `ErrorHandler` calls `console.error('ERROR', error)` (`node_modules/@angular/core/fesm2022/_pending_tasks-chunk.mjs:2692-2696`). Electron's installed `WebContentsConsoleMessageEventParams` exposes only a `message` string plus level, source and line (`node_modules/electron/electron.d.ts:24432-24454`), not the original argument array. This fix logs the first bounded line of the supplied `details.message`. If Electron supplies only the literal `ERROR` for that two-argument call, the recorder cannot recover the Error object's text within the assigned scope; the source and line still identify the call site. Electron's [console-message API](https://www.electronjs.org/docs/latest/api/web-contents#event-console-message) documents the same event shape.

## Decisions

- **Decision:** Change the recorder, not the shared Logger. **Options:** inline the sanitized context for error calls, or change Logger context rendering for every caller. **Evidence:** Logger's error context behavior is intentional in its existing API, while this recorder needs a single searchable line. **Reversible:** yes.
- **Decision:** Keep the literal first-line policy for `details.message`. **Options:** retain the existing first line, or scan later lines for error text. **Evidence:** `process-lifecycle-recorder.ts:64-92` explicitly limits persisted renderer text to the first line because later lines may contain credentials, and the existing spec enforces that rule. **Reversible:** yes.
