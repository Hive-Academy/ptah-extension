# Usage readers implementation report

## OpenCode

Shows **“Local usage: tokens & estimated cost”** as a compact token/cost stat. It is local CLI accounting only, with no fabricated allowance percentage or reset. The reader runs `opencode stats --json --cost` with a five-second abortable timeout, validates the response with Zod, and uses a Windows `.cmd`-safe invocation.

Live harness result (redacted): `service-unavailable` at `local-cli:stats-json-cost`; no values, credentials, or raw response were emitted. This run exposed the Windows npm shim path; the reader was then adjusted to launch the fixed command through `cmd.exe` without rerunning the required one-off harness.

Files: `opencode-local-usage.reader.ts`, `local-usage.readers.spec.ts`, plan-usage registration/types, dashboard/chat UI, and `scripts/agent-usage/probe-plan-usage.ts`.

## Grok

Shows **“Session usage: tokens & cost”** as a compact token/cost stat for a supplied Ptah-created CLI session only. It calls `grok usage <session-id>` with a five-second abortable timeout and Zod-validates its result. It never lists sessions, searches local state, or reads session content. The session id is allow-listed before the Windows command shim is invoked. No xAI Management API is used.

Live harness result (redacted): `service-unavailable` at `skipped:no-ptah-session-id`. This is expected: the harness deliberately had no Ptah-created Grok session id and did not discover one.

Files: `grok-session-usage.reader.ts`, `local-usage.readers.spec.ts`, `plan-owner-read.ts`, `lane-limit-lookup.service.ts`, plan-usage registration/types, dashboard/chat UI, and probe harness.

## Antigravity

The existing provisional local language-server reader remains the plan-quota source. When no local server is available, the dashboard now says **“Open Antigravity to read local quota”**.

Live harness result (redacted): `service-unavailable` at `process/discovery`; no local server was running.

Files: `provider-account-card.component.ts`.

## Shared/UI model

`PlanLocalUsage` is a separate `local-usage` snapshot field with tokens, estimated USD cost, observed time, local-CLI provenance, and optional CLI range. It is intentionally not a `PlanLimitWindow`, so existing plan-window states, radial gauges, percentages, and reset semantics remain unchanged. The dashboard and chat session tile render the compact stat rather than a radial gauge.

## Checks

- `npx nx typecheck auth-providers --parallel=1` — passed.
- `npx nx typecheck cli-agent-runtime --parallel=1` — passed.
- `npx nx typecheck dashboard --parallel=1` — passed.
- `npx nx typecheck chat-ui --parallel=1` — passed.
- `npx nx typecheck shared --parallel=1` — passed.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/readers/local-usage.readers.spec.ts --coverage=false --maxWorkers=2` — passed (2 tests).
- `ptah_get_diagnostics` — TypeScript compiler diagnostics were unavailable after 45 seconds; scoped Nx typechecks above passed.

## Decisions

- Modeled local accounting separately from plan windows to prevent cost/token totals becoming implied allowance percentages or reset windows.
- Used only known, Ptah-recorded Grok CLI session ids; missing or malformed ids produce no subprocess call.
- Treated OpenCode and Grok output as local-only provenance and retained the existing Antigravity `provider-unofficial` plan reading.
- Kept the live harness output redacted: it reports local-usage field presence only, never token or cost values.

## Follow-up fixes

### OpenCode live reader

- Root cause: [opencode-local-usage.reader.ts](../../../../libs/backend/auth-providers/src/lib/quota/readers/opencode-local-usage.reader.ts) lines 11-35 modeled `range` as a string and `tokens.cache` as a number, while the live CLI returns a `{ from, to }` range and `{ read, write }` cache object. The Windows `cmd.exe` call also supplied the command and its arguments as separate post-`/c` entries.
- Fix: accept the documented live JSON shape while permitting extra top-level fields; sum cache read/write tokens; tolerate a non-JSON stdout prefix; convert the millisecond range into displayable ISO bounds; invoke the npm `.cmd` shim as one fixed `cmd.exe /c` command string. Failures are logged only as classified reasons (`invalid-json`, `schema:*`, `timeout-or-aborted`, or `command-failed`) without output values. `PlanUsageReadRequest.localUsageDays` maps a valid selected day count to `--days N`.
- Harness result: OpenCode is `available` at `local-cli:stats-json-cost` and reports a redacted `localUsage` object with token, estimated-cost, and range fields present. No token, cost, secret, email, or raw CLI data is recorded here.
- Reader spec: `local-usage.readers.spec.ts` passed (2 tests), including the exact documented OpenCode shape with extra top-level keys, nested cache counters, millisecond range, stdout prefix, and `--days 0` mapping.

### UI local-usage stat

- Added dashboard and chat tile specs that assert the local-usage label and formatted token/cost stat, and assert that no radial gauge is rendered.
- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts --coverage=false --maxWorkers=2` passed (35 tests).
- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/session/plan-limits --coverage=false --maxWorkers=2` passed (5 suites, 73 tests).
- Typechecks passed: `auth-providers`, `dashboard`, and `chat-ui`, each with `--parallel=1`.
