# Code Logic Review — D9 fix batch 1

Review family: claude (in-process subagent); implementer: codex
Scope: codex-protocol-validator.ts/.spec.ts, codex-app-server-process.ts/.spec.ts, codex-session-history.spec.ts (uncommitted diff). Static read only; nothing executed.

**Score: 7/10 — Verdict: REVISE (minor; core logic is correct)**

## Checks

1. Request-local result failure — OK.
   - process.ts:404-420: a pending entry with a numeric id, `invalidResult` and a matching method clears that timer, deletes that entry, warns once and rejects once, then returns.
   - The entry is removed before the reject, so a later `fail()`/`close()` loop (≈:503) cannot settle it twice. The code is synchronous, so there is no race with close.
   - Malformed JSON, an invalid envelope (validator throws a different code), an unknown id (`!pending` → "Unknown response" at :372), and malformed server requests (no `pending`) still reach `throw error` and are fatal.
   - The removed `invalid-result` fatal case is replaced by local-rejection specs.
2. Diagnostics are bounded: 8 issues, 8 path depth, 64-character segments. Only `{path, code}` is kept, with no Zod message or value. See D2 for the remaining key leak.
3. The second `validateCodexResult` in `request()` (:268) is unchanged and consistent. It is idempotent, throws the same request-local error, and does not WARN (see D3). The `model/list` special case is subsumed and not regressed.
4. History mapping is correct at `CodexSessionHistoryError.from` (codex-session-history.ts:39). But `malformedPage` is NOT in the `mapped` table of `nativeHistoryRpcError` (chat-history-read.service.ts:44-57), so it falls through to the default `nativeReadFailed`. The UI therefore still receives `HISTORY_FAILED` / "Session history could not be read." The premise "user does not see HISTORY_FAILED" is not met. See D1.
5. Strict TS looks fine. `z.core.$ZodIssueCode` exists in zod v4, and `stderrTail()` is public so removing its callers leaves nothing unused. No new catch sites were added, so no degradation-audit suppression is needed. See D4 for formatting.

## Defects

1. **Moderate** — chat-history-read.service.ts:44-57 (outside the reviewed files, but the effect belongs to this batch): `malformedPage`, `stalledCursor`, `pageLimitExceeded`, `requestRejected` and `processFailure` all collapse to `HISTORY_FAILED` with no diagnosable code. A page-level schema drift is surfaced as a generic failure. Fix: either accept this explicitly and document it, or add an explicit `malformedPage` entry (still `HISTORY_FAILED`, with a distinct message) and log the cause's `issues` at the service WARN. The process WARN already carries the issues, so triage is possible.
2. **Minor** — codex-protocol-validator.ts:~57-63: the identifier regex lets dynamic record keys through (`z.record` at codex-protocol-schemas.ts:6, 368, 628). A server-chosen key of up to 64 characters (for example `sk_live_...`) is therefore logged as a path segment. Fix: allow only string segments that are known schema property names, or redact any segment following a record level; at minimum, document the residual exposure.
3. **Minor** — process.ts:268: a failure from the second validation path in `request()` is rejected but not WARNed, so the diagnostics are inconsistent. It is only reachable if the first validation was non-idempotent. Fix: drop the redundant revalidation, or WARN.
4. **Minor** — codex-protocol-validator.ts diagnostics block and codex-session-history.spec.ts: lines exceed the prettier width (`) return segment;`, the long `diagnosticIssues` signature, the `it.each([...] as const)` row). `lint-staged` will reformat on commit. Run prettier on the changed files before commit.
5. **Minor (spec risk, unexecuted)** — process.spec.ts: `expect(jest.getTimerCount()).toBe(0)` (thread/start and thread/list tests) assumes no other fake timers are alive (kill timers, stderr and approval timers). It is unverified and may be brittle. Run the spec in a verify pass before push.
6. **Minor** — The WARN spec asserts the log metadata equals `{method, issues}` exactly, which is good. There is no test that a pending `model/list` plus an unrelated pending request survives, though the thread/list test covers the same pattern.

No blocking or serious logic defects were found. The uncovered failure is a path-segment key leak (D2) plus the unmet UI-code expectation (D1). Residual uncertainty: no tests, typecheck or lint were run, and the live `thread/list` mismatch is still uncaptured.

## Round 1

Static read of the Revision 1 diff only; nothing executed.

| Defect | Status | Evidence |
| --- | --- | --- |
| D1 `malformedPage` collapsed to HISTORY_FAILED | FIXED | chat-history-read.service.ts:55-58 maps it to `HISTORY_MALFORMED` with a fixed message; code added to the shared union at rpc-error-codes.types.ts:43-44; spec at chat-history-read.service.spec.ts:184-202. |
| D2 record keys could leak in WARN paths | FIXED | codex-protocol-validator.ts: `classifyDiagnosticPath` walks the schema; record depths go into `recordKeys` and always win. Strings are kept only where an object schema declares them (`schemaKeys`). Unions, optional, nullable and pipe are unwrapped. Unhandled wrappers (lazy, intersection, default) fail closed to `[redacted]`. Spec at codex-protocol-validator.spec.ts:541. |
| D3 second validation without WARN | FIXED | codex-app-server-process.ts:275-289 warns with the sanitized method and issues, then rethrows. |
| D4 prettier width | FIXED (not verified) | Manually hand-formatted; lint-staged will normalize. |
| D5 brittle `getTimerCount() === 0` | FIXED | codex-app-server-process.spec.ts uses relative counts (before-request baseline, +1 for the concurrent request). |

Other checks:
- Shared code wiring: `RpcUserErrorCode` is only consumed as a type or as `Record<string, ...>` (chat-history-read.service.ts:44, rpc-types.ts, claude-rpc.service.ts). No exhaustive switch or record over the union exists in libs/frontend or libs/backend, so adding the code cannot break compilation. The message is fixed and user-safe, with no path or value.
- No frontend Codex special case: grep for `HISTORY_MALFORMED` finds only the backend service, its spec and the shared union. The frontend treats it as any other coded error.
- Request-local rejection (process.ts:~413-428): still correct. It requires a pending entry, a numeric id and a matching method. The timer is cleared and the entry deleted before the reject, so there is no double settle. Envelope and framing errors, unknown ids and server requests stay fatal. The WARN carries only the method and the sanitized `{path, code}`. The `stderrTail` removal from the metadata is a leak reduction.

New defects:
- Minor: process.spec timer-delta assertions and the new specs were not run; run the codex-runtime and rpc-handlers specs in a verify pass before push.
- Minor (UX): other `CodexSessionHistoryError` codes (`stalledCursor`, `pageLimitExceeded`, `requestRejected`, `processFailure`) still map to the generic HISTORY_FAILED. This is acceptable, because the process WARN has the detail.

**Score: 9/10 — Verdict: APPROVE** (condition: run the scoped specs once before push).
