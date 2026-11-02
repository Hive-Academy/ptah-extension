# D9 fix batch 1 report

## Summary

Known response IDs with schema-invalid results now reject only their own pending request. The Codex App Server remains available for concurrent and following requests. Protocol errors carry bounded, payload-free Zod issue paths and codes; the process logs one WARN for each local result rejection. Fatal process logs no longer include stderr content. A malformed native history page now reaches the UI as `HISTORY_MALFORMED` with a safe message.

## Files changed

- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts`: retain at most eight issue paths/codes, at most eight path segments per issue and at most 64 characters per string segment; retain only schema-defined string keys and redact record keys.
- `libs/backend/codex-runtime/src/lib/codex-protocol-validator.spec.ts`: cover issue count, path bound, structured fields, record-key redaction and absence of reply values.
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`: generalize the existing `model/list` local rejection to all known pending methods; clear only that timer and pending entry, warn once with method and issues, and omit stderr tails from rejection and fatal logs. The second result validation warns with the same sanitized format if it fails.
- `libs/backend/codex-runtime/src/lib/codex-app-server-process.spec.ts`: cover local `thread/start` and `thread/list` rejection, concurrent and following request survival, relative timer counts, WARN diagnostics and existing fatal malformed envelope behavior; update stderr log expectations.
- `libs/backend/codex-runtime/src/lib/codex-session-history.spec.ts`: cover `malformedPage` mapping for `thread/read`, `thread/list`, `thread/turns/list` and `thread/items/list` local `invalidResult` errors.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts` and `.spec.ts`: map `malformedPage` to a dedicated safe RPC error for resume and page reads.
- `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`: declare `HISTORY_MALFORMED` in the shared RPC error union.

`codex-session-history.ts` already maps `CodexProtocolError('invalidResult')` to `malformedPage`; it was reviewed and left unchanged. No field schema was changed.

## Fatal vs request-local error matrix

| Inbound condition | Handling |
| --- | --- |
| Known pending response ID, valid envelope, invalid result for any method | Clear that timer, delete that pending entry, reject its promise with `CodexProtocolError`, WARN once; process and other requests remain healthy. |
| Malformed JSON or invalid response envelope | Existing fatal `Codex invalid protocol frame` path closes the process. |
| Unknown response ID | Existing fatal path closes the process. |
| Malformed server request | Existing fatal path closes the process. |
| Local invalid result from a history request | Existing history mapping returns `malformedPage`; the RPC read service returns `HISTORY_MALFORMED` and a safe message. |

## Sanitized diagnostic format

`CodexProtocolError.issues` contains only `{ path: (string | number)[], code: ZodIssueCode }` entries. The process WARN uses `{ method, issues }`. Neither object retains Zod messages, received values, input, previews, prompts or replies. Issue count and path depth are each capped at eight; string path segments are capped at 64 characters and must be declared object-schema keys. Record keys are `[redacted]`; array indexes remain numeric. Fatal and RPC rejection logs omit stderr tails because those can contain arbitrary server content.

## Decisions

- Preserved the validator's envelope-first order. A result schema error is local only when the response ID identifies a pending request; framing errors remain fatal.
- Kept `codex-session-history.ts` unchanged because its existing `invalidResult` branch already provides the required classification, now covered by specs for every history method.
- Kept the second result validation in `request()` because its typed return is still needed after `sendRequest()` resolves an unknown value. It normally follows successful receive validation; any future non-idempotent failure now emits the same sanitized WARN and rethrows the original protocol error.
- Did not edit `codex-protocol-schemas.ts`: the failing historical reply and exact mismatched field remain uncaptured.
- Skill discovery was available, but no matching backend skill was invocable from this lane. `rg` returned access denied, so targeted reads used PowerShell.

## Open risks

- The rejected live `thread/list` value was not captured; this batch cannot identify or correct its specific schema mismatch.
- Jest, Nx, typecheck, lint, build and diagnostics were prohibited, so the new specs and TypeScript changes have not been executed or compiled in this lane.
- The shared worktree contains concurrent changes under `auth-providers`, `agent-sdk` and other `codex-runtime` files outside this batch. These were not made, edited or reverted by this lane.

## Degradation audit result

`npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0. It reported 281 unsuppressed sites in the workspace, with no new site under `libs/backend/codex-runtime`. No baseline was changed.

## Revision 1

| Review defect | Fix | File:line | Spec / evidence |
| --- | --- | --- | --- |
| D1: `malformedPage` fell through to `HISTORY_FAILED`. | Return `HISTORY_MALFORMED` with a fixed, user-safe message for resume and page reads; add the shared code. | `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts:55`; `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:44` | `chat-history-read.service.spec.ts:184` covers both reads and checks code/message. |
| D2: record keys could appear in a WARN path. | Traverse the Zod schema for each bounded issue path. Retain only declared object keys and numeric indexes; redact record keys and unknown strings. | `libs/backend/codex-runtime/src/lib/codex-protocol-validator.ts:67` | `codex-protocol-validator.spec.ts:541` uses a secret-shaped record key and checks the safe path and code. |
| D3: second `request()` validation had no diagnostic. | Keep it for the typed return and warn with the same sanitized method/issues if it fails. | `libs/backend/codex-runtime/src/lib/codex-app-server-process.ts:275` | Existing process specs exercise the usual receive validation; a second-pass failure is unreachable with the current idempotent result schemas. |
| D4: new lines exceeded the requested style width. | Hand-format the validator diagnostic block and history classification spec to two-space indentation, single quotes, trailing commas and 80-column width. | `codex-protocol-validator.ts:67`; `codex-session-history.spec.ts:102` | Manual line-length inspection of the edited blocks; no formatter or lint run. |
| D5: local-rejection specs expected zero global timers. | Compare timer counts with the count before each request, including the one surviving concurrent request. | `codex-app-server-process.spec.ts:354`, `:684`, `:704` | The three local-rejection cases now assert relative counts; specs were not run by instruction. |

The permitted degradation audit exited 0 again with 281 unsuppressed sites and no new finding in the edited projects. All edited files are LF without BOM or CR. Skill files were discoverable locally, but this lane had no CLI skill invocation tool; no matching skill was applied.
