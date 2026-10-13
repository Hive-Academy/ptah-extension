# Antigravity + Ollama Cloud plan-usage — live fix report

Branch `fix/plan-limits-live-providers`. Machine: Windows 11, this user's real
accounts. All credentials were inspected by key/shape only; no secret, token or
email appears in this report or in any probe output. Throwaway probes live under
`.ptah/specs/plan-limits-live-fix/probe/`.

Scoped verification only: `npx jest -c libs/backend/auth-providers/jest.config.ts <spec> --coverage=false --maxWorkers=2`,
`npx nx typecheck <project>`. No build/serve/e2e, no git writes.

---

## B. Ollama Cloud — FIXED (complete, live-verified)

### Live reproduction BEFORE

Dashboard: `Ollama Cloud (owner unknown) (key unavailable) — API key rejected — check the key`,
while the "Glm" Ollama Cloud Ptah-CLI provider (`ptahCliId pc-355b645d-…`) works for chat.

Live probe (`probe/ollama-live.cjs`, statuses only):

```
slot ptahCli.<Glm>: placeholder("ollama")
slot ollama-cloud:  real-looking (len 57)
provider ollama-cloud key  /api/usage 200   (range/scope/granularity/from/until/totals/buckets)
provider ollama-cloud key  /api/me    200   (plan: pro)
Glm slot                   /api/usage 401   invalid credentials
Glm slot                   /api/me    401   invalid credentials
```

### Root cause

Two independent faults, both real:

1. **Wrong credential is read.** A signin-based Ollama Cloud Ptah-CLI agent
   stores the sign-in placeholder `"ollama"` in its own secret slot
   (`resolveAgentApiKey`, `ptah-cli-registry.ts:217`, returns the placeholder for
   the optional-key `ollama-cloud` provider). The owner resolver read that slot
   (`provider-owner.resolver.ts` `ownerForPtahCli`) → no real credential →
   `unknownOwnerKey` + label `(key unavailable)` → **"owner unknown / key
   unavailable"**. The usage read then used `{kind:'ptah-cli-key'}`
   (`plan-owner-read.ts:98-100`), which `PlanCredentialSource.resolve` maps to
   `unsupported-auth` because the stored value is a placeholder
   (`plan-credential.source.ts:114`) → **"API key rejected"**. The user's real
   ollama.com key lives in the shared `ollama-cloud` provider slot, which was
   never consulted for this lane.

2. **Wrong response shape.** Even with a good key, the reader expected a
   `limits.session/weekly` percent-of-quota body
   (`ollama-cloud-plan-usage.reader.ts` `UsageSchema`). That shape does not
   exist. Verified live: `GET https://ollama.com/api/usage` returns request-count
   buckets (`range`=`24h|7d|30d`, `totals.request_count`, `buckets[]`) with no
   allowance, limit or reset. There is **no plan-limit/quota API for an API key**
   (confirmed against the live endpoint and corroborated by community reports).
   So the old parser always fell through to `service-unavailable`, and the
   session/weekly windows it claimed to produce were fiction.

### Fix applied

- `libs/backend/auth-providers/src/lib/quota/readers/ollama-cloud-plan-usage.reader.ts`
  — rewritten to the real endpoint semantics. It calls `GET /api/usage` purely to
  tell a usable key from a rejected one: `200`/`404` → honest `no-usage-source`
  (Ollama exposes no quota to report); `401`/`403` → `unsupported-auth`; other
  non-ok / network error / timeout → `service-unavailable`; missing credential →
  `unsupported-config`. Bearer still refuses redirects. A working key is **never**
  reported as rejected.
- `.../readers/ollama-cloud-plan-usage.reader.spec.ts` — rewritten to the new
  contract (real body fixture, `200 → no-usage-source`, `401/403 → unsupported-auth`).
- `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts`
  (`ownerForPtahCli`) — for `ollama-cloud`, resolve the owner from the shared
  `ollama-cloud` provider key (the ollama.com sign-in that actually bills), not
  the agent's placeholder slot. Removes `(key unavailable)` and the unknown owner.
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/plan-owner-read.ts`
  (`planOwnerRead`, `ollama-cloud` branch) — always read through
  `{kind:'provider-key', providerId:'ollama-cloud'}`, matching the owner above.

### Live reproduction AFTER (shipped reader, `probe/live-ollama.cjs`)

```
real provider ollama-cloud key:   status=no-usage-source   windows=0
Glm agent own slot (placeholder): status=unsupported-auth  windows=0
no credential:                    status=unsupported-config windows=0
```

With the credential-resolution fix, the Glm lane and the main Ollama route both
resolve to the real `ollama-cloud` key, so the card now shows the account as the
owner with an honest **"No usage source"** — no more "owner unknown / key
unavailable / API key rejected" for a working account.

### Changes needed outside my files

- `plan-owner-read.ts` (listed above) — credential-resolution code; the `ollama`
  root cause lived there, which the task permits editing.
- Four spec files updated to the new contract:
  `provider-owner.resolver.spec.ts`, `plan-limit-owner-discovery.service.spec.ts`,
  `lane-limit-lookup.service.spec.ts`, and the Ollama reader spec.

### Out-of-scope observation (frontend, not touched)

`provider-account-card.component.ts:663-666` shows `no-usage-source` for
`ollama-cloud` as the generic "No usage source available". A clearer line such as
"Ollama Cloud reports no plan quota for API keys" would read better, but UI copy
is outside the assigned files.

---

## A. Antigravity — ROOT CAUSE PROVEN LIVE; fix blocked on an architecture decision

### Live reproduction BEFORE

Dashboard: `Usage unavailable — Open Antigravity to read local quota`.
Shipped OAuth reader live (`probe/out/live-antigravity.cjs`, real reader via esbuild):

```
owner identityKind: account
status service-unavailable  windows []
```

### Root cause (two faults, both located)

1. **The OAuth reader looks for a credential file that the installed Antigravity
   CLI no longer writes.** `antigravity-oauth-plan-usage.reader.ts:95-103` reads
   `~/.gemini/antigravity-acp/acp_token.json` — which does **not** exist. The
   installed CLI is `agy` (`C:\Users\<u>\AppData\Local\agy\bin\agy.EXE`); its log
   (`~/.gemini/antigravity-cli/cli.log`) shows `ChainedAuth: authenticated via
keyring` and `keyringAuth: loaded token`. The token lives in the **OS
   keyring**, Windows Credential Manager target `gemini:antigravity`, as go-keyring
   JSON `{token:{access_token, token_type, refresh_token, expiry}, auth_method,
id_token}` (inspected by key names only). So `readOAuth` returns `undefined`
   and the reader falls through to the local language-server probe, which is not
   running → `service-unavailable` → the "Open Antigravity" copy.

2. **The reader would be skipped anyway for this owner.** `antigravity-plan-usage.reader.ts:73-79`
   only tries OAuth when `identityKind` is `cli-store` or `unknown`. Here
   `~/.gemini/google_accounts.json` has an active account, so
   `provider-owner.resolver.ts:385-388` resolves the owner as `account` — and the
   OAuth-first branch is never entered. The gate must also admit `account`.

### What actually works (verified live, `probe/quota2.cjs`)

Using the keyring `refresh_token`, refreshed at `oauth2.googleapis.com/token`
with the CLI's embedded OAuth client, then `loadCodeAssist` to obtain the
free-tier project, then `POST /v1internal:retrieveUserQuotaSummary` on
`daily-cloudcode-pa.googleapis.com` with the Antigravity `User-Agent`:

```
loadCodeAssist 200  tier free-tier  hasProject true
retrieveUserQuotaSummary 200
  gemini-weekly  window=weekly  used 26.3%  reset 2026-10-14T19:03:52Z
  gemini-5h      window=5h      used 0.0%   reset 2026-10-13T05:28:09Z
  3p-weekly      window=weekly  used 49.4%  reset 2026-10-18T14:48:30Z   (Claude & GPT)
  3p-5h          window=5h      used 0.0%   reset 2026-10-13T05:14:15Z
fetchAvailableModels 200  (per-model quotaInfo as fallback)
```

So the t3code approach is correct and the data is real; the current reader's
`SummarySchema`/`ModelsSchema` parse this shape. Two things the shipped code does
not do and would need: send the Antigravity `User-Agent`, and resolve/send the
`project` via `loadCodeAssist` (an empty body returns `403`; with the project it
returns `200`). The plain `~/.gemini/oauth_creds.json` is **not** a substitute: it
is the Gemini-CLI login and its `refresh_token` returns `401 invalid_client`
against every OAuth client embedded in `agy.EXE` (probe `oauth-creds-clients.cjs`).

### Why no code fix was shipped for Antigravity

The only credential that reads the Antigravity quota is the **OS-keyring** entry,
and reading it requires go-keyring-compatible access (Windows target
`gemini:antigravity` with no trailing account segment). The repo's existing
`keytar` optional dependency cannot read it — keytar addresses targets as
`service/account`, which does not match go-keyring's bare `gemini:antigravity`.
A working fix therefore needs **a new OS-credential read capability** (per-platform
keyring read, or a vetted dependency) plus a decision on where the OAuth client
constants come from. Introducing a new native capability — and hardcoding an OAuth
client I extracted from a third-party binary — is an architecture choice I will
not make unilaterally; it belongs to the architect.

### Decision needed (for the architect / plan owner)

1. **Keyring read mechanism** (Recommended: a small per-platform keyring reader
   consistent with the existing `execFile` discovery already in
   `antigravity-plan-usage.reader.ts` — Windows `CredRead`, macOS `security`,
   Linux `libsecret` — matching go-keyring's naming). Alternative: adopt a
   go-keyring-compatible npm dependency.
2. **OAuth client constants** — confirm the public Gemini/Antigravity installed-app
   client to embed, rather than scanning `agy.EXE` at runtime (brittle; path and
   layout change on update).

### Fix shape once that is decided (proven end to end above)

- `antigravity-oauth-plan-usage.reader.ts`: read the keyring entry instead of
  `acp_token.json`; refresh with the confirmed client; call `loadCodeAssist` for
  the project; send the Antigravity `User-Agent` on the quota calls. (Existing
  bucket/model parsing already matches the live `200` shape.)
- `antigravity-plan-usage.reader.ts:73-79`: broaden the OAuth-first gate to
  include `identityKind === 'account'` so the service prefers OAuth over the
  not-running language server.

### Changes needed outside my files

None beyond the gate/reader above — the owner resolution at
`provider-owner.resolver.ts:385-388` is correct (the `account` owner is right); it
is the reader gate that must admit it.

---

## Test results

| Check                                                                                           | Result                                                         |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `jest … ollama-cloud-plan-usage.reader.spec provider-owner.resolver.spec`                       | 2 suites, 76 tests passed                                      |
| `jest … plan-limit-owner-discovery.service.spec lane-limit-lookup.service.spec plan-owner-read` | 2 suites, 44 tests passed                                      |
| `jest … owner-lifecycle.integration`                                                            | 1 suite, 5 tests passed                                        |
| `nx typecheck auth-providers`                                                                   | Success                                                        |
| `nx typecheck cli-agent-runtime`                                                                | Success                                                        |
| Live: shipped Ollama reader against ollama.com                                                  | real key → `no-usage-source`; placeholder → `unsupported-auth` |
| Live: shipped Antigravity reader                                                                | `service-unavailable` (credential file absent — root cause)    |
| Live: proven Antigravity quota path (probe)                                                     | `200` with real buckets (see above)                            |

build / serve / e2e: not run (prohibited). Nx Cloud remote cache is disabled on
this org; both typechecks ran locally and succeeded.

---

## Integration round (handoff finish, 2026-10-13)

User decisions applied: A = keyring + embedded installed-app client; B = show
Ollama request counts.

### Antigravity — checked, two live defects fixed

Already present and verified: the per-platform read-only keyring reader
(`antigravity-keyring.ts`: Windows `CredReadW` through hidden PowerShell,
macOS `security`, Linux `secret-tool`, target `gemini:antigravity`), the refresh →
`loadCodeAssist` → `retrieveUserQuotaSummary` flow with the Antigravity UA, the
access-token cache, and the removal of the `cli-store`/`unknown` gate (an
`account` owner now tries OAuth first, with the language server as fallback).

The shipped code was still failing live (`service-unavailable`). I found three
causes and fixed them:

1. **Wrong embedded OAuth client.** Both the client id and the secret constant
   in `antigravity-oauth-plan-usage.reader.ts` were wrong. The id did not match
   the `agy` binary, and the secret was one character short, so the token
   endpoint returned `401 invalid_client`. I replaced them with the values
   extracted from `agy.EXE` and confirmed them with a live refresh
   (`probe/fix-client.cjs` printed statuses only).
2. **Keyring read timed out.** On a cold run the `Add-Type` compile took about
   5.7 s, longer than the 4 s timeout, so the read returned "no token". The
   timeout is now 15 s (`ANTIGRAVITY_KEYRING_TIMEOUT_MS`). The reader also no
   longer reads the keyring while a cached access token is valid. That skips a
   PowerShell spawn on every poll. A 401 clears the cache and re-reads the
   keyring.
3. **Unclear labels.** The live summary repeats the bucket names "Weekly Limit
   Remaining" and "Five Hour Limit Remaining" in both model groups, and the
   window holds a _used_ percent. Labels are now `<group> · Weekly` and
   `<group> · 5-hour`.

### Ollama Cloud — request counts

- `ollama-cloud-plan-usage.reader.ts`: a `200` response whose body has
  `totals.request_count` now returns `available` with
  `localUsage = { label: 'Ollama Cloud requests', requests, range: 'last 7 days', tokens: 0, estimatedCostUsd: 0 }`.
  The range codes `24h`, `7d` and `30d` become readable text. A `200` whose body
  is unreadable, too large or missing totals still returns `no-usage-source`.
  `401` and `403` still return `unsupported-auth`.
- Shared `PlanLocalUsage.requests?` (already added) carries the count.
  `plan-usage.service.ts` already passes `localUsage` through, so it needed no
  change.
- Frontend (minimal): `provider-account-card.component.ts` `localUsageView`
  shows `N requests` and a `note` ("Account request count · Ollama exposes no
  plan percentage or reset"). `provider-account-row.component.ts` renders
  `usage.note` (`data-testid="local-usage-note"`) in place of the hardcoded
  local-CLI sentence. OpenCode keeps its original sentence.

### Live results (shipped code, esbuild bundle, redacted)

```
Antigravity (probe/live-antigravity.ts, owner identityKind=account, keyring credential):
status available
  Gemini Models · Weekly          used=26.3%  reset=2026-10-14T19:03:52Z
  Gemini Models · 5-hour          used=0.0%   reset=2026-10-13T06:11:00Z
  Claude and GPT models · Weekly  used=49.4%  reset=2026-10-18T14:48:30Z
  Claude and GPT models · 5-hour  used=0.0%   reset=2026-10-13T06:11:00Z

Ollama (probe/live-ollama.ts):
real provider ollama-cloud key: status=available requests=2610 range=last 7 days
Glm placeholder slot:           status=unsupported-auth
no credential:                  status=unsupported-config
```

### Checks

| Check                                                                                                                                         | Result                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `jest` antigravity-keyring, antigravity-oauth, antigravity-plan-usage, ollama-cloud reader, provider-owner.resolver, plan-usage.service specs | 6 suites pass. Two suites had leftover TS spec errors (mock tuple types), now fixed. |
| `nx typecheck auth-providers`                                                                                                                 | Success                                                                              |
| `nx typecheck shared`                                                                                                                         | Success                                                                              |
| `nx test dashboard`                                                                                                                           | 13 suites, 174 tests passed                                                          |
| `nx typecheck dashboard`                                                                                                                      | Success                                                                              |

### Notes

- The Windows keyring read costs about 3–6 s of PowerShell + `Add-Type` on
  each cold read. It now happens about once an hour, when the access token
  expires. A caller with a shorter overall timeout, such as the lane-limit
  lookup (another writer owns it), could still time out on that first read.
- `loadCodeAssist` metadata and the UA hardcode `WINDOWS_AMD64` / `os_type=windows`.
  This works live here; macOS/Linux were not verified.
