# Batch 18.3 Test Report - TASK_2026_858_f7b9

## Specs added

`libs/backend/worker-runtime/src/lib/worker-security.spec.ts` (real loopback sockets on port 0, `ws` client, all closed in afterEach):

- pre-auth gate: every `RPC_METHOD_NAMES`, REMOTE and ADMIN method sent before hello -> close 4403, handler spy never called, zero frames received
- post-hello/pre-auth: remote, admin and 20 in-process methods -> 4403, no response for the call, no session data
- hello answered by the connection itself, handler not called
- LAN/non-literal bind refused (0.0.0.0, 192.168.1.20, 10.0.0.5, ::, localhost); loopback binds
- Host header wrong name/port refused; any Origin refused (incl. http://127.0.0.1, null); upgrade on `/`, `/rpc/`, `/rpcx`, `/other`, `/rpc?x=1` refused; plain HTTP GET `/`, `/rpc`, `/other` -> 404; valid upgrade accepted
- redaction: tokens, pairing codes, admin key in `adminKey` field, nested/array records
- `connection.spec.ts` (liveness timers): 2 timers while open, 0 after close; pending pong deadline released on peer close; auth timeout closes 4401 with timers released
- `worker-service.spec.ts` (shutdown goodbye): `stop()` sends `ctl goodbye {reason:'shutdown'}`; captured SIGTERM handler sends goodbye and removes endpoint

## Verify

`npm run verify -- -p @ptah-extension/worker-runtime` -> lint, test, typecheck pass; 24 suites, 96 passed, 2 todo. (One unused-import lint warning was fixed afterward; eslint and prettier on the spec files re-checked clean, full verify not re-run after that one-line removal.)

## Defects (production, not fixed)

1. MEDIUM `libs/backend/worker-runtime/src/lib/redact.ts:3` - `SECRET_FIELD` does not match the `admin` field of the `auth` frame (connection.ts auth params), so `redactLogRecord({params:{admin:<key>}})` leaks the admin key. Fix: add `admin` to the field regex.
2. LOW `redact.ts:9` - `redactText` has no pattern for a bare base64url admin key in free text. Fix: redact 43-char base64url runs, or never log raw frames. Both pinned as `it.todo` in worker-security.spec.ts.
3. NOTE `worker-server.ts` (upgrade handler): a bad path or Host on an upgrade request gets 403, not 404; only plain HTTP gets 404. Specs assert refusal on upgrade and 404 on plain HTTP.

## Files changed

- libs/backend/worker-runtime/src/lib/worker-security.spec.ts (new)
- libs/backend/worker-runtime/src/lib/connection.spec.ts
- libs/backend/worker-runtime/src/lib/worker-service.spec.ts
- .ptah/specs/TASK_2026_858_f7b9/batch-18.3-test-report.md

## Orchestrator fix (after this report)

- `redact.ts`: `SECRET_FIELD` now also matches the `admin` field (word-boundary form kept), and
  `redactText` masks a bare 43-character base64url key. The two `it.todo` entries are now tests.
- Result: `npm run verify -- -p @ptah-extension/worker-runtime` passed (24 suites, 98 tests).
- Open for the Phase D reviewer: a bare 8-character pairing code (no dash) in free text is not
  masked; a `code` key is not redacted because error objects use `code` for error codes.
