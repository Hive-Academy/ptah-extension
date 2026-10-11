# Lane C revision 2

## Defect 1 — account failure hidden by local usage

`mergeLocalUsage` retains the account status and windows, promoting local-only Grok credential reads only when there is no account source. The stale path now keeps freshly read local usage while reusing the last successful account windows. `libs/backend/auth-providers/src/lib/quota/plan-usage.service.ts:288,342,418`. Regression cases cover OpenCode Go and Grok errors and stale fallback in `plan-usage.service.spec.ts:271,301`.

## Defect 2 — OpenCode Go credential binding

The service resolves OpenCode Go `credentialRef`; the reader reveals that secret for credential owners and reads the OpenCode CLI auth store only for cli-store owners. Grok billing likewise accepts CLI auth only for cli-store owners. `plan-usage.service.ts:262`; `readers/opencode-go-plan-usage.reader.ts:22-45`; `readers/grok-account-plan-usage.reader.ts:27`. Tests: `plan-usage.service.spec.ts:324`, `readers/opencode-go-plan-usage.reader.spec.ts:14`, `readers/grok-account-plan-usage.reader.spec.ts:10`.

## Defect 3 — Antigravity OAuth masks local probe

Only an available OAuth reading short-circuits the local language-server probe. `readers/antigravity-plan-usage.reader.ts:75`; fallback regression in `readers/antigravity-plan-usage.reader.spec.ts:65`.

## Defect 11 — Antigravity OAuth refresh and failure handling

An access token is cached in memory until its expiry margin; an already-aborted signal returns before file I/O; refresh `invalid_grant` returns `unsupported-auth`; JSON is checked against a 256 KiB limit before parsing. `readers/antigravity-oauth-plan-usage.reader.ts:18-24,34,48-66,77`. Tests cover reuse, abort, revoked grant, and oversized body in `readers/antigravity-oauth-plan-usage.reader.spec.ts:7`.

## Defect 12 — Grok auth and local accounting

HTTP 401 returns `unsupported-auth`. Without `cliSessionId`, account windows remain and `unavailableReason: 'no-open-session'` explains absent local usage. Non-cli-store owners return `no-usage-source` before reading `GROK_HOME` or `GROK_AUTH`, preventing an unverified email from being attributed to another owner. `readers/grok-account-plan-usage.reader.ts:27,53`; `plan-usage.service.ts:280-295`. Tests: `readers/grok-account-plan-usage.reader.spec.ts:10`, `plan-usage.service.spec.ts:333`.

## Verification

- `npx jest -c libs/backend/auth-providers/jest.config.ts <five changed specs> --coverage=false --maxWorkers=1`: `Tests: 64 passed, 64 total` (before one additional Grok binding test).
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/readers/grok-account-plan-usage.reader.spec.ts --coverage=false --maxWorkers=1`: `Tests: 6 passed, 6 total` (includes the added binding test).
- `npx nx typecheck @ptah-extension/auth-providers --parallel=1`: exit 0; one typecheck task, 0 cache hits. Nx Cloud separately reported its disabled organization (401).
- Scoped `ptah_get_diagnostics` for edited source and specs: 0 errors, 0 warnings.

## Decisions

- `QuotaOwnerRef` contains a hashed key and identity kind, but no verified email. This scope cannot compare a Grok credential email with an account owner's plaintext email. The reader declines non-cli-store owners before reading auth; this avoids cross-account attribution and needs no shared type change. The account-owner mismatch path is covered by the new Grok test.
- The Antigravity token file has no email, so OAuth account binding remains limited to cli-store and unknown owners. The cached access token stays in memory; nothing is written to the token file.
- `no-open-session` is the existing typed reason used to explain why Grok local accounting is unavailable when there is no CLI session ID.
