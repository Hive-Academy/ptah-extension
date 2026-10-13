# OpenCode Go / Zen plan windows — live fix report

Branch `fix/plan-limits-live-providers` · Lane: `opencode-go-plan-usage.reader` (+ its spec) · 2026-10-13

## Live reproduction before (redacted)

Probes: `.ptah/specs/plan-limits-live-fix/probe/go-reader-live.ts` (reader-level, `npx tsx`)
and `probe/live-usage-probe.mjs` / `probe/db-schema.mjs` / `probe/credential-shape.mjs`
(store + endpoint level). None of them print key material, ids or emails.

- `opencode auth list` → "OpenCode Default stored" (integration `opencode`), but
  `<data dir>/auth.json` does **not** exist; the data dir holds `opencode.db`.
- Reader-level, before the fix (actual output):
  - `v1 auth.json/env key present: false`
  - `owner resolver would pick opencode-go owner: false`
  - `reader status: no-usage-source` → the Dashboard's "No usage source / Local usage only".
- Endpoint-level (the data the reader could not see): loading the credential the way
  OpenCode v2 stores it and calling the endpoint gave
  `GET https://opencode.ai/zen/go/v1/usage` → **HTTP 200**,
  `{"usage":{"rolling":{"status":"<s>","percent":2,"resetsAt":"<iso>"},"weekly":{…,"percent":10,…},"monthly":{…,"percent":78,…}}}`;
  `GET https://opencode.ai/zen/v1/usage` → **404**; `GET /zen/v1/models` → 200 (the token is
  a valid zen credential).

## Where v2 stores the credential

- Data dir: `XDG_DATA_HOME` else `~/.local/share/opencode` (unchanged from v1; same logic
  as `openCodeDataDir()`).
- OpenCode ≥ 2.x (verified on v2.0.12): SQLite **`opencode.db`**, table **`credential`**
  (`id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated`).
  The "OpenCode" login is `integration_id = 'opencode'`, `active = 1`; the row's `value` is
  JSON (schema `@opencode/schema/credential`, sst/anomalyco opencode):
  `{ type: "oauth", methodID: "device", refresh, access, expires, metadata: { server, accountID, email, orgID, orgName } }`
  — on this machine: type `oauth`, access token valid (ms-epoch `expires` in the future).
  API-key credentials are `{ type: "key", key }`; `{ type: "external" }` carries no material.
- v1 (`auth.json` key `opencode-go`, `OPENCODE_AUTH_CONTENT`, `OPENCODE_API_KEY`) remains
  only as a fallback; v2 no longer writes `auth.json`.
- Correct endpoint for this credential type: **`https://opencode.ai/zen/go/v1/usage` for
  BOTH credential types** (Go API key and OAuth/Zen account token). There is no
  `/zen/v1/usage` (404 live); the upstream console only routes `GET /zen/go/v1/usage`
  (`packages/console/app/src/lib/inference-proxy.ts` → `/go/v1/usage`). t3code's reader
  (`packages/provider-opencode/src/server/usageLimits.ts`) uses the same endpoint and the
  same "403 = valid key, no Go subscription" reading.

## Root cause (file:line)

1. `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts:53`
   (pre-fix): for `cli-store` owners the reader only consulted `readOpenCodeGoKey()` —
   v1 `auth.json`/env. OpenCode ≥ 2.0 has no `auth.json`, so `key` was always `undefined`
   → `no-usage-source`, while a valid credential sat in `opencode.db`.
2. Owner discovery never picked the Go owner (outside this lane's files):
   `opencode-go-credential.ts:99-126 hasOpenCodeGoCredentialSync()` also checks only v1 →
   `false` → `provider-owner.resolver.ts:559-564 ownerForOpenCode()` returned the plain
   `opencode` cli-store owner → `plan-usage.service.ts:311-318` then forced
   `no-usage-source` for provider ids `opencode`/`opencode-zen`.

## Fix (only the reader + its spec)

`opencode-go-plan-usage.reader.ts`:

- New exported `readOpenCodeGoStoreKey(env)`: reads the active `opencode` integration's
  credential from `<data dir>/opencode.db` (`ORDER BY active DESC, time_created DESC,
id DESC` — OpenCode's own selection order), accepts `{type:"key",key}` and
  `{type:"oauth",access}`, returns the trimmed material; `undefined` for missing DB /
  row / material (e.g. `external`); throws on a corrupt store. The DB is never opened in
  place: db + `-wal`/`-shm` are copied to a temp dir and the copy is opened read-only via
  `node:sqlite` (`DatabaseSync`, lazy `await import` so hosts without it degrade, never
  crash); the temp copy is always removed (Windows handle-retry).
- Reader credential order: Ptah credential (unchanged) → v1 `readOpenCodeGoKey`
  (unchanged) → v2 `readOpenCodeGoStoreKey` (new); store failure → `service-unavailable`.
- Window mapping unchanged: `rolling→five_hour` (300 min), `weekly→weekly` (10080 min),
  `monthly→monthly`; percent clamped 0..100; `resetsAt` from the source.
- 403 (valid credential, no Go/Zen subscription) → `no-usage-source` — the explicit,
  honest state in this codebase's vocabulary (identical mapping in
  `grok-account-plan-usage.reader.ts:134`, `antigravity-oauth-plan-usage.reader.ts:134`,
  `ollama-cloud-plan-usage.reader.ts:57`; t3code maps 403 to unsupported as well).
- New optional 5th parameter `readStoreKey` (test seam; default = the real store reader).

## Live result after (redacted)

`npx tsx .ptah/specs/plan-limits-live-fix/probe/go-reader-live.ts` (same probe, defaults):

- `v1 auth.json/env key present: false` (v1 fallbacks kept)
- `owner resolver would pick opencode-go owner: false` → still needs the out-of-scope
  owner-discovery change below (the reader itself is fixed)
- `reader status: available`, `windowSetEstablished: true`
- windows: `five_hour` "Go · 5-hour" **5%** (300 min, resets 2026-10-13T05:24:28Z) ·
  `weekly` "Go · Weekly" **11%** (10080 min, resets 2026-10-19T00:00:00Z) ·
  `monthly` "Go · Monthly" **79%** (resets 2026-11-04T11:44:06Z)

## Required changes outside my files (file:line + exact change)

The reader is fixed, but the Dashboard keeps showing "No usage source" until owner
discovery learns the v2 store. Exact changes (NOT made, per lane scope):

1. `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts:99-126` —
   `hasOpenCodeGoCredentialSync()` must also detect the v2 store. After the env/inline
   checks and the existing `fileKeyState(...)` switch (lines 116-125), add a synchronous
   v2-store check before returning the v1 result (`node:sqlite`'s `DatabaseSync` is
   synchronous, so it fits this sync API): snapshot-copy `<data dir>/opencode.db`
   (+`-wal`/`-shm`) exactly like `readOpenCodeGoStoreKey` in the reader, then
   `SELECT 1 FROM credential WHERE integration_id = 'opencode' AND active = 1` — row
   present → `true`; missing DB/table → fall through to the env-key result; unreadable →
   `false`. Cleanest shape: move `readOpenCodeGoStoreKey` + the snapshot helper into
   `opencode-go-credential.ts` (that module's charter is "one definition … shared by the
   Go plan-usage reader and the owner resolver") and let the reader import it as its
   default `readStoreKey`; a sync `storeKeyState(path)` mirroring `fileKeyState`
   (lines 133-170) with the same 5 s cache fits the existing pattern.
2. `provider-owner.resolver.ts:559` — no code change required: once
   `hasOpenCodeGoCredentialSync()` sees the v2 store, `ownerForOpenCode()` already returns
   the `opencode-go` cli-store owner keyed by `openCodeDataDir()`, `plan-usage.service.ts:262`
   dispatches to the fixed reader, and `plan-usage.service.ts:158
createOpenCodeGoPlanUsageReader(now)` already compiles against the new optional
   parameter. The force-no-usage-source at `plan-usage.service.ts:311-318` stays correct
   for plain `opencode`/`opencode-zen` rows.
3. Optional honesty upgrade (needs a shared-type change): a dedicated reason for
   "credential valid, no subscription" — `libs/shared/src/lib/types/plan-limit.types.ts:148`
   → `export type PlanLimitUnavailableReason = 'no-open-session' | 'no-subscription';`,
   have the reader's 403 branch return it with `unavailableReason`, and add a label at
   `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:528`
   (`'no-subscription': 'Logged in · no Go/Zen subscription'`). Until then the 403 path
   stays on the house convention `no-usage-source`.

## Decisions

- **Endpoint**: `https://opencode.ai/zen/go/v1/usage` for both credential types — verified
  live with this machine's OAuth token (200 + windows; `/zen/v1/usage` → 404). The URL
  constant is unchanged.
- **v1 before v2**: `readOpenCodeGoKey()` (env/auth.json) runs first, so an explicit
  `OPENCODE_API_KEY`/`auth.json` keeps priority; the v2 store is consulted only when v1
  misses ("keep auth.json/env fallbacks").
- **SQLite access**: `node:sqlite` (`DatabaseSync`), lazily imported — no new dependency
  for `@ptah-extension/auth-providers` (better-sqlite3 is not in its package.json; adding
  it would change the build graph). Precedent: `scripts/agent-usage/opencode-db.reader.ts:38`
  (same module + snapshot pattern) and `.ptah/specs/TASK_2026_580_9f77/smoke/electron-org.smoke.ts:24`
  (works inside Electron 44). Hosts without `node:sqlite` degrade to
  `service-unavailable`, never a crash.
- **Never open the live DB in place**: temp-dir copy (db + WAL/SHM), opened read-only,
  always removed — same pattern as the agent-usage reader. A snapshot taken mid-write may
  miss the newest rows; acceptable for a usage read.
- **Secret hygiene**: only `key`/`access` material is used and only as the Bearer header;
  refresh tokens and `metadata` (accountID/email/org) never leave the stored value. Specs
  assert results contain no material; probes print only statuses/percent/shape.
- **403 → `no-usage-source`** (house convention, same as grok/antigravity/ollama readers);
  see the optional shared-type upgrade above for a fully explicit reason.
- **Expired OAuth token** (401 from the endpoint): stays `service-unavailable` (transient
  — the OpenCode CLI refreshes `access` whenever it runs). Implementing refresh inside the
  reader would need the OAuth server's token endpoint + device-flow grant — deliberately
  not done.
- **Call budget**: this lane exceeded the 40-call guidance (~60). The upstream repo moved
  (sst/opencode → anomalyco/opencode) and the v2 CLI is a 203 MB compiled binary with no
  greppable source, so the credential store and endpoint had to be located via the repo
  tree API, the OpenAPI spec and live probes instead of one source lookup.

## Test result

`npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.spec.ts --coverage=false --maxWorkers=2`
→ **PASS, 8/8** (ts-jest type-checks): credential-owner path (no CLI reads), three-window
mapping, v1-over-v2 priority, v2 fallback sent as the Bearer token, no-credential + 403 →
`no-usage-source`, corrupt v2 store → `service-unavailable`, a real-DB v2-selection test
(builds an `opencode.db` with 4 credential rows, asserts the active `opencode` oauth row's
`access` wins and a missing store reads as `undefined`), malformed response + 5 s timeout.

(The `jest.config.ts` "Failed to load the ES module" warning is pre-existing noise; the
config loads and the suite runs. No other files were touched.)
