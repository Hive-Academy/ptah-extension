# Antigravity CLI result diagnostics

## Criteria and changes

1. **Structured result error:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.ts:162-193` validates optional string or object `result.error` with Zod, retaining additional event fields through `.passthrough()`.
2. **Visible failure detail:** `antigravity-cli.adapter.ts:1175-1185` emits a failure segment and `[Error]` with status, safe error code/message, and response. Formatting and redaction are in `antigravity-result-diagnostics.ts:29-45`.
3. **One bounded failure log:** `antigravity-cli.adapter.ts:738-755,929` retains the last five ERROR step events, then logs the redacted full result event, process exit, failed steps, and captured `AGY_ERROR` lines once via the Logger supplied at `cli-detection.service.ts:72`. `antigravity-result-diagnostics.ts:2-27,47-53` redacts sensitive keys and common inline credentials and caps the log payload at 8 KiB.
4. **stderr and exit in completion:** `antigravity-cli.adapter.ts:872-887,921-941` collects `AGY_ERROR` stderr lines and emits them with the process exit code before resolving a failed turn. `antigravity-cli.adapter.ts:1055-1075` keeps non-SUCCESS mapped to turn exit 1.
5. **Logger wiring:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:72` changed because that service owns the injected `TOKENS.LOGGER` instance and constructs `AntigravityCliAdapter`. Passing its Logger to the adapter lets the new diagnostic path log through the established dependency injection pattern without adding a separate container lookup or console output.
6. **Regression tests:** `antigravity-cli.adapter.spec.ts:939-1018` covers structured code/message, redacted log payload and secrets, ERROR step history, `AGY_ERROR` plus process exit 3 in completion, SUCCESS without an error log, and exit 0.

## Verification

Command: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/antigravity-cli.adapter.spec.ts --coverage=false --maxWorkers=1`

Jest tail:

```text
Test Suites: 1 passed, 1 total
Tests:       52 passed, 52 total
Snapshots:   0 total
Time:        20.755 s
```

`ptah_get_diagnostics` was called after edits for the four changed TypeScript files, but reported the TypeScript check unavailable after its 45-second timeout. No Nx, build, lint, or wide tests were run.

## Decisions

- **Preserve CLI terminal status:** Kept `SUCCESS` as turn exit 0 and every other result status as exit 1. Options were retaining this mapping or accepting output/files as success. Existing adapter behavior and the task instruction support retaining it. Reversible.
- **Log on process close:** Chose process close over the instant the result arrives so late stderr and the actual process exit are included in the one log entry. Options were result-time logging or close-time logging. The headless failure protocol can emit `AGY_ERROR` on stderr and exit 3; close-time logging captures both. Reversible.
- **Dedicated small formatter:** Added one colocated helper for bounded redaction and message formatting. Options were inline code in the already large adapter or a helper. The adapter exceeded 1,100 lines before this change, and the helper is under 60 lines. Reversible.

## Not done

- Scoped TypeScript diagnostics did not complete because the diagnostics service timed out. The focused Jest suite passed.
- No naturally occurring failed `agy` lane was available to capture; the next failure will exercise the diagnostics path.

