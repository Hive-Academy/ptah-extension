# OpenCode Go/Zen — REVISE fixes (code-logic-review defects 1-6, my files)

Branch `fix/plan-limits-live-providers` · Files: `opencode-go-credential.ts`,
`readers/opencode-go-plan-usage.reader.ts` (+ their specs) · 2026-10-13

**Outcome: all five assigned defects fixed in my files, live-verified, quota
specs 305/305 (15/15 suites, including the other lanes'), typecheck green.**

## Defect 1 (review defect 2) — stale store cache ignored the WAL → fixed

- `opencode-go-credential.ts:104-118` — `storeCache` entries now carry
  `{ checkedAt, dbMtimeMs, dbSize, walMtimeMs, walSize, state }`: the
  signature covers the database **and** its `-wal`, because in WAL mode a
  fresh login (or a re-login rotating the token) lands in `opencode.db-wal`
  while the db file's mtime/size stay unchanged until a checkpoint.
- `:292-332` (`storeKeyState`) — the `-wal` is statted via `statOrNull`
  (`:417-423`), ENOENT counting as 0s (the review's exact recipe); the
  cache-hit comparison at `:318-325` requires the full db+WAL signature to
  match.
- `invalid` is **never cached**: the stat-failure branch (`:303-310`) caches
  only `absent`, and the re-read branch (`:351-359`) skips `storeCache.set`
  when the state is `invalid` — a lock or a mid-write read is transient, so
  the next check retries immediately instead of waiting out the 5 s TTL.
- Specs (real SQLite): "re-reads when the WAL changes while the database file
  does not" (WAL-mode writer connection; the opencode material lands only in
  the WAL; the answer flips to true at TTL expiry with the db file unchanged)
  and "never caches an unreadable store, so the next check retries" (corrupt
  db → false; db becomes readable again at clock 1 000, well inside the TTL →
  true).

## Defect 2 (review defects 3+4) — full main-thread DB copy, non-atomic snapshot → fixed by opening IN PLACE; the copy is REMOVED

- **Live evidence first**: `probe/inplace-check.cjs` — with **3 opencode
  processes running** and a live **62.7 MB db + 10.2 MB wal**:
  `new DatabaseSync(dbPath, { readOnly: true, timeout: 500 })` opened the
  store in place and read the active credential row — `in-place readOnly open
(opencode running, wal present): OK | credential row present: true | type:
oauth | expires in future: true`. Per the task, the copy machinery is
  therefore **removed entirely**.
- `opencode-go-credential.ts:207-238` — `storeCredentialFromInPlace`: the one
  shared in-place read — `DatabaseSync` `readOnly: true` with a short busy
  `timeout` (500 ms, `:60`), the shared `STORE_CREDENTIAL_QUERY` (`:64`),
  close in `finally`. A WAL reader never blocks OpenCode's writer.
- Used by both paths: the async `readOpenCodeGoStoreCredential` (`:240-249`)
  and the sync owner check `storeKeyStateFromStore` (`:271-290`, never
  throws; failure → `'invalid'`, uncached).
- Everything copy-related is deleted (`snapshotStoreDb`,
  `removeStoreSnapshot`, `storeKeyFromSnapshot`, `storeKeyFromFreshSnapshot`,
  the `copyFileSync`/`mkdtempSync`/`rmSync`/`tmpdir` imports): **no copy of
  sessions or messages ever lands in a temp directory**, no repeated
  multi-MB main-thread copies on every cache miss, and the reviewer's
  temp-leak note (kill between mkdtemp and finally) is moot.
- Defect 3 (non-atomic db/-wal/-shm snapshot) is thereby resolved — there is
  no snapshot. The contingency (copy with a size guard + one retry) never
  became necessary; a locked or unrecoverable WAL (no writer running to
  recover it) degrades honestly: sync → `'invalid'` (uncached, retried next
  check), async → throws → reader `service-unavailable`.

## Defect 4 (review defect 5) — 401 / expired OAuth token read as a service outage → fixed

- **Shared-reason decision (as the task required)**: the only
  `PlanLimitUnavailableReason` is `'no-open-session'`
  (`libs/shared/src/lib/types/plan-limit.types.ts:154`) — nothing means
  "credential expired / sign in again". No shared type was edited. The
  reader therefore uses the state this codebase uses for a **rejected
  credential**: `status: 'unsupported-auth'` — the exact state the Ollama
  Cloud reader returns for a rejected key
  (`ollama-cloud-plan-usage.reader.ts:74-75`), via its own `reading()`
  helper (`:104-112`).
- `opencode-go-credential.ts:44-52` — `StoreValueSchema` now accepts the
  oauth value's optional `expires` (ms epoch); `storeCredentialFromRow`
  (`:178-205`) returns `OpenCodeStoreCredential` (`:122-127`)
  = `{ key, expiresAt? }`. `refresh` tokens, account ids, emails and org
  metadata still never leave the stored value.
- `readers/opencode-go-plan-usage.reader.ts`:
  - `:76-79` — the seam `OpenCodeStoreKeyReader` now returns
    `string | OpenCodeStoreCredential | undefined` (v1 strings carry no
    expiry; the v2 store credential may).
  - `:107-118` — the v1→v2 fallback now captures `expiresAt`.
  - `:120-124` — `expiresAt <= now()` (the reader's injected clock) →
    `authRejected()` (`:65-70`, `unsupported-auth`) **without making the
    request**. No refresh is implemented — OpenCode rotates its own refresh
    tokens, and refreshing here would invalidate its copy.
  - `:135` — HTTP **401** → the same `authRejected()` state (no longer
    `unavailable` at `:136-137`); 403 → `no-usage-source` unchanged.
- Specs: expired stored token → `unsupported-auth`, fetcher never called,
  result contains no material; not-yet-expired token → `available` with the
  token as Bearer; HTTP 401 → `unsupported-auth`; the real-db v2-selection
  test now asserts `{ key: 'live-access', expiresAt: 4102444800000 }`.

## Defect 5 (review defect 6) — sync owner check vs async reader precedence → fixed

- `opencode-go-credential.ts:381-393` — `blank` (a whitespace-only
  `opencode-go` key in `auth.json`) now falls through to the **store without
  consulting `OPENCODE_API_KEY`**, mirroring `openCodeGoKeyFromAuth`'s
  masking (`' ' || envKey` keeps the blank before `.trim()`) — exactly the
  reader's own precedence; `invalid` still returns `false`, and the reader
  likewise reports `unavailable` for invalid v1 without ever touching the
  store. Both paths now apply one precedence: inline → `auth.json` → (env
  key, unless masked by a blank entry) → v2 store.
- Spec: "applies the reader precedence to a blank auth.json key" — blank +
  env key + no store → `false` (the env key is masked); blank + env key +
  valid store → `true` (the store is consulted on both paths).

## Live result (redacted; final code)

`$env:NODE_OPTIONS='--require …probe\vscode-shim.cjs'; npx tsx --tsconfig
tsconfig.base.json .ptah/specs/plan-limits-live-fix/probe/go-reader-live.ts`
— run with opencode live (WAL present), reading the store IN PLACE:

- `v1 auth.json/env key present: false`
- `v2 opencode.db credential present: true` · `v2 token expiry: valid`
- `hasOpenCodeGoCredentialSync (v1 || v2 store): true`
- `ownerForOpenCode picked: { providerId: 'opencode-go', identityKind:
'cli-store', label: 'OpenCode CLI login', isGoOwner: true }` — the REAL
  resolver method
- `reader status: available`, `windowSetEstablished: true`
- windows: `five_hour` "Go · 5-hour" **20%** (300 min, resets
  2026-10-13T05:24:28Z) · `weekly` "Go · Weekly" **17%** (10080 min, resets
  2026-10-19T00:00:00Z) · `monthly` "Go · Monthly" **82%** (resets
  2026-11-04T11:44:06Z)

## Check results

1. `npx jest -c libs/backend/auth-providers/jest.config.ts
libs/backend/auth-providers/src/lib/quota --coverage=false --maxWorkers=2`
   — first run: 294/294 tests passed but **1 suite failed to run**: MY reader
   spec at `:170` — ts-jest `TS2493` (a new test's `jest.fn` fetcher lacked
   typed parameters, so `fetcher.mock.calls[0][1]` did not typecheck). Fixed
   by declaring `(_url: RequestInfo | URL, _init?: RequestInit)` — the
   pattern the file's older tests already use.
2. Re-run of the same command → **15/15 suites, 305/305 tests PASS** (all
   quota specs, including the other lanes' resolver/service/ledger specs).
   (The `jest.config.ts` ES-module warning and the earlier "worker process
   failed to exit" note are pre-existing noise; both absent from the green
   run's summary.)
3. `npx nx typecheck auth-providers --parallel=1` → **Successfully ran target
   typecheck for project @ptah-extension/auth-providers**.

## Files changed

- `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts` —
  rewritten store access (in-place read-only, WAL-signature cache, no copy,
  expiry surfaced, blank parity); `readOpenCodeGoStoreKey` renamed to
  `readOpenCodeGoStoreCredential` (richer return; no other importer existed
  beyond the reader + its spec).
- `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts`
  — expiry pre-check, 401 → `unsupported-auth`, seam widened, default
  `readStoreKey = readOpenCodeGoStoreCredential`.
- `…/opencode-go-credential.spec.ts` — +3 tests (WAL signature, no
  `invalid` caching, blank precedence).
- `…/readers/opencode-go-plan-usage.reader.spec.ts` — rename + 3 new auth
  tests + the typed-fetcher fix.
- Probe: `probe/go-reader-live.ts` (rename + `v2 token expiry` line),
  `probe/inplace-check.cjs` added (the in-place live evidence).

## Not done (outside my file scope — for the orchestrator)

- Review **defect 1** (12 s deadline holds the whole response:
  `lane-limit-lookup.service.ts:131`, `plan-limits-snapshot.service.ts`
  assemble, `plan-limit-owner-discovery.service.ts:261`) — other lanes'
  files, untouched.
- Review **defect 7** (Ollama per-agent key slot: `plan-owner-read.ts:99-107`,
  `provider-owner.resolver.ts:470`) — other lanes' files.
- Review **defect 8** (hard-coded slow-deadline provider ids:
  `evidence-precedence.ts:25-29`) — other lanes' files.
- No shared-type edit was made (per instruction): `'no-open-session'` is the
  only `PlanLimitUnavailableReason`, so the sign-in-again answer uses the
  rejected-credential **status** `unsupported-auth`; a dedicated
  `PlanLimitUnavailableReason` (e.g. `'auth-expired'`) in
  `libs/shared/src/lib/types/plan-limit.types.ts:154` plus a dashboard label
  remains the cleaner long-term shape, as the previous report already noted.
