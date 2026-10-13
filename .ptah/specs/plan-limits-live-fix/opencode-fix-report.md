# OpenCode Go/Zen windows — owner-detection + runtime fix report

Branch `fix/plan-limits-live-providers` · Lane: `opencode-go-credential.ts` +
`opencode-go-plan-usage.reader.ts` (+ their specs) · 2026-10-13

**Outcome: LIVE-VERIFIED.** `hasOpenCodeGoCredentialSync()` now detects the v2
`opencode.db` store, the real `provider-owner.resolver.ts ownerForOpenCode()`
picks the `opencode-go` cli-store owner on this machine, and the reader returns
all three windows (5-hour / weekly / monthly) from
`https://opencode.ai/zen/go/v1/usage`. My specs 27/27, sibling resolver spec
67/67 (a regression I introduced was found and fixed in my own file),
`nx typecheck auth-providers` green.

## Files changed (file:line)

### `libs/backend/auth-providers/src/lib/quota/opencode-go-credential.ts` (rewritten — it owns the module charter: "one definition … shared by the Go plan-usage reader and the owner resolver")

- `:1-27` charter header rewritten: v1 (auth.json/env) + v2 (`opencode.db`),
  snapshot-copy read-only access, `node:sqlite` never statically imported.
- `:44-49` `StoreValueSchema` moved here from the reader (shared by both
  store paths).
- `:61` `STORE_CREDENTIAL_QUERY` — the store SQL now exists exactly ONCE in
  the codebase (was private to the reader): the active `opencode`
  integration's credential, OpenCode's own selection order.
- `:82` `StoreKeyState = 'usable' | 'absent' | 'invalid' | 'unknown'`
  (`unknown` = host cannot read SQLite at all → no opinion).
- `:94` `storeCache` — store mirror of `credentialCache`, same 5 s TTL +
  mtime/size invalidation keyed by the db path.
- `:155-179` `storeKeyFromSnapshot(copy, DatabaseSync)` — the ONE shared
  snapshot query + parse helper (open copy read-only, run the query, parse
  `value`, return trimmed `key`/`access` material; `undefined` = no material
  row such as `external`; throws on a corrupt store; closes its own db).
- `:181-191` `snapshotStoreDb` — copy db + `-wal`/`-shm` into a temp dir.
- `:194-202` `removeStoreSnapshot` — never-throws cleanup with Windows
  handle-retry (`maxRetries: 3`).
- `:212-233` `export async function readOpenCodeGoStoreKey(env)` — moved here
  from the reader, behavior-identical: missing db → `undefined`; corrupt store
  → throws (reader maps to `service-unavailable`); lazy `await
import('node:sqlite')` so hosts without it degrade instead of crashing.
- `:236-247` `loadStoreDatabaseSync()` — the sync `node:sqlite` loader:
  typeof-guarded `process.getBuiltinModule('node:sqlite')` (works in every
  module format; never throws; `null` when absent).
- `:249-272` `storeKeyFromFreshSnapshot` — sync snapshot read for the owner
  check; **never throws end to end** (snapshot plumbing failures → `'invalid'`).
- `:275-322` `storeKeyState(dbPath, now)` — `fileKeyState`'s store mirror:
  5 s TTL + mtime/size cache; ENOENT → `'absent'`; other stat failure →
  `'invalid'`; missing `node:sqlite` → `'unknown'`; never exposes the key.
- `:324-357` `hasOpenCodeGoCredentialSync` — now consults the v2 store after
  v1 misses, mirroring the reader's own fallback order
  (`readOpenCodeGoKey` → `readOpenCodeGoStoreKey`): inline parse-ok-but-no-key
  falls through to the store; invalid inline stays `false`; file `usable` →
  `true`; `absent` → envKey, else store; `blank`/`invalid` → `false`
  (pre-existing documented v1 semantics kept). Store `usable` → `true`.
- `:359-362` `resetOpenCodeGoCredentialCacheForTests()` now clears BOTH caches
  (same export, same name — `provider-owner.resolver.spec.ts:40` unaffected).

### `libs/backend/auth-providers/src/lib/quota/readers/opencode-go-plan-usage.reader.ts`

- Store detection code removed (schema, SQL, snapshot, cleanup) — it now
  imports `readOpenCodeGoStoreKey` from `../opencode-go-credential`
  (`:25-29`) and uses it as the default 5th param `readStoreKey` (`:70`).
  Public surface unchanged: `OPENCODE_GO_USAGE_URL`, `OpenCodeStoreKeyReader`
  type, `createOpenCodeGoPlanUsageReader(now, fetcher, readAuth, env,
readStoreKey)` — `plan-usage.service.ts:158/262` compiles unchanged
  (typecheck green). Credential order, 403 → `no-usage-source`, window
  mapping, timeout all untouched.

### Specs

- `opencode-go-credential.spec.ts` — new describe
  `hasOpenCodeGoCredentialSync · v2 credential store` with a real-SQLite
  `writeStoreDb`/`storeHome` builder (same `node:sqlite` approach as the
  reader spec): active oauth row → `true`; active api-key row → `true`;
  external/other-integration-only → `false`; corrupt db → `false` without
  throwing; v1-usable beats a (deliberately corrupted) store; v1-invalid
  outranks a valid store; 5 s store cache then re-read on mtime/size change.
  No test prints material (`refresh`/`metadata` never asserted).
- `opencode-go-plan-usage.reader.spec.ts:5-8` — only change:
  `readOpenCodeGoStoreKey` import moved to `../opencode-go-credential` (the
  real-db v2-selection test itself is unchanged and still exercises the
  reader's default `readStoreKey` seam).

### Probe artifacts (verification only, no product code)

- `probe/go-reader-live.ts` — extended: v1/v2 presence booleans,
  `hasOpenCodeGoCredentialSync()`, and the REAL
  `new ProviderOwnerResolver(...).ownerForOpenCode()` (stub deps; the method
  touches only the credential helpers) printing providerId/identityKind/
  label/isGoOwner — no keys, paths, ids or emails.
- `probe/vscode-shim.cjs` (new) — under tsx, redirects `require('vscode')`
  to `__mocks__/vscode.ts`, mirroring `jest.config.ts` `moduleNameMapper`.
- `probe/tsconfig.probe.json`/`tsconfig.json` attempts and `store-debug.ts`
  were removed after use; `probe/go-reader-live.ts` + `vscode-shim.cjs` stay
  as the reproducible probe.

## Runtime decision for SQLite (task item 2): keep `node:sqlite`, load sync via `process.getBuiltinModule`

Evidence per host:

| Host                                                                                                  | Node                                                                                                       | `node:sqlite`                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| CLI (Node 24)                                                                                         | 24.15.0 local                                                                                              | yes — live-proven (probe + jest real-db tests) |
| Electron 44                                                                                           | 24.18.1 (electronjs.org v44.0.0 notes; local `node_modules/electron` 44.4.3)                               | yes — unflagged since 22.13/23.4               |
| VS Code extension host                                                                                | ≥ Node 22 since VS Code 1.101 (Electron 35 — code.visualstudio.com/updates/v1_101); local VS Code is 1.140 | yes on every supported VS Code ≥ 1.101         |
| VS Code 1.100 (the `engines.vscode: ^1.100.0` floor, `apps/ptah-extension-vscode/package.json:15-17`) | Electron 34 = Node 20.18                                                                                   | **absent → degrades, never throws**            |

- **better-sqlite3 rejected**: it is structurally absent in the VS Code
  extension host — `apps/ptah-extension-vscode/src/di/expected-absent.ts:6`
  ("no better-sqlite3", PersistenceRpcHandlers/MemoryRpcHandlers are
  EXPECTED_ABSENT there) and `apps/ptah-extension-vscode/src/rpc-host-profile.ts:8`
  — and the workspace binary is compiled for the Electron ABI only
  (NODE_MODULE_VERSION 143; will not load under plain Node 137 —
  `.ptah/specs/TASK_2026_266/context.md:129-131`). Adding it to
  `@ptah-extension/auth-providers` (not in its package.json) would change the
  build graph and still cover fewer hosts than `node:sqlite`.
- **Sync loading**: the owner check is synchronous, so the sync path loads
  `node:sqlite` through `process.getBuiltinModule` (Node 22.3+; fully typed in
  `@types/node` 24.13.6 `BuiltInModule` map; every Node that has `node:sqlite`
  also has it), typeof-guarded + try/catch → `null` → `'unknown'` → `false` →
  the existing plain-opencode owner fallback. The async reader path keeps the
  lazy `await import('node:sqlite')`. **No static import of `node:sqlite`
  anywhere**, so module load is safe on Node 20.18 hosts.
- **Degradation matrix (all without throwing)**: db missing → `'absent'`
  (falls through to the v1 result); locked/corrupt/mid-write snapshot →
  `'invalid'` → `false` (retried after the 5 s cache); no `node:sqlite` →
  `'unknown'` → `false`. Verified by specs + live.

## Live result (redacted; final code)

`$env:NODE_OPTIONS='--require D:\projects\ptah-extension\.ptah\specs\plan-limits-live-fix\probe\vscode-shim.cjs'; npx tsx --tsconfig tsconfig.base.json .ptah/specs/plan-limits-live-fix/probe/go-reader-live.ts`

- `v1 auth.json/env key present: false` (v1 fallbacks kept)
- `v2 opencode.db key present: true`
- `hasOpenCodeGoCredentialSync (v1 || v2 store): true`
- `ownerForOpenCode picked: { providerId: 'opencode-go', identityKind:
'cli-store', label: 'OpenCode CLI login', isGoOwner: true }` — the REAL
  resolver method, not a replica
- `reader status: available`, `windowSetEstablished: true`
- windows: `five_hour` "Go · 5-hour" **15%** (300 min, resets
  2026-10-13T05:24:28Z) · `weekly` "Go · Weekly" **15%** (10080 min, resets
  2026-10-19T00:00:00Z) · `monthly` "Go · Monthly" **81%** (resets
  2026-11-04T11:44:06Z)

Probe plumbing notes (why the invocation looks like it does): the repo has no
root `tsconfig.json` (Nx uses `tsconfig.base.json`), so tsx's default
discovery finds nothing and tsyringe's parameter decorators fail without
`--tsconfig tsconfig.base.json`; tsx ignores a nested probe tsconfig (4
variants tried); tsyringe needs `import 'reflect-metadata'` at the entry;
`provider-owner.resolver.ts` → `vscode-core` barrel → `require('vscode')`
which only exists inside the extension host, hence the shim.

## Check results

1. `npx jest -c libs/backend/auth-providers/jest.config.ts <credential spec>
<reader spec> --coverage=false --maxWorkers=2` → **PASS 27/27**
   (the `jest.config.ts` ES-module warning is pre-existing noise).
2. `npx jest … provider-owner.resolver.spec.ts` (sibling suite, read-only
   check — it exercises my changed function via `ownerForOpenCode`) → first
   run **66/67 FAIL**: `provider-owner.resolver.spec.ts:42` mocks `node:fs`
   with only `readFileSync`/`statSync`, so my sync store path hit an undefined
   `mkdtempSync` that sat OUTSIDE my try-catch → `ownerForOpenCode` threw.
   **Fixed in my file** (`storeKeyFromFreshSnapshot` is now non-throwing end
   to end, `opencode-go-credential.ts:249-272`) — no edit to their spec.
3. Final combined run (my 2 specs + resolver spec) → **PASS 94/94**.
4. `npx nx typecheck auth-providers --parallel=1` → **Success** (twice —
   after the restructure and again after the final fix; the "Nx Cloud free
   plan" message is unrelated noise).

Bug found and fixed during live verification: the first version of the shared
helper invoked the injected constructor without `new`
(`ERR_CONSTRUCT_CALL_REQUIRED`, caught live by the probe before any test
run); `storeKeyFromSnapshot` now calls `new DatabaseSync(copy, { readOnly:
true })` exactly like the previous lane's code.

## Anything needed elsewhere

- **`provider-owner.resolver.ts` — NO code change required** (task item 1):
  `ownerForOpenCode()` (`:561-574`) picks the `opencode-go` cli-store owner
  purely through the fixed `hasOpenCodeGoCredentialSync()` — verified live
  above; `plan-usage.service.ts:262` dispatches to the reader and
  `:311-318` stays correct for plain `opencode`/`opencode-zen` rows.
- `provider-owner.resolver.spec.ts:42` — tolerated as-is (94/94): its partial
  `node:fs` mock makes my sync store check read `'invalid'` → `false`, which
  matches those tests' expectations. Worth knowing if that mock ever grows.
- Optional honesty upgrade from the prior report (unchanged, separate lane):
  a dedicated `'no-subscription'` unavailable reason at
  `libs/shared/src/lib/types/plan-limit.types.ts:148` + a dashboard label, so
  the 403 path stops reusing `no-usage-source`.
- The UI re-layout ("Provider accounts & plan limits" above "Session
  Analytics", row alignment) is the frontend lane, not mine.

## Behavior notes / decisions

- v1 before v2 everywhere (`OPENCODE_AUTH_CONTENT`/`auth.json`/`OPENCODE_API_KEY`
  keep priority), matching the shipped reader order — confirmed by both specs.
- `auth.json` with a whitespace-only `opencode-go` key (`'blank'`) still
  returns `false` without consulting the store — the pre-existing documented
  v1 semantics (`.ptah/specs/cli-lane-limits/implementation-plan.md:371`),
  deliberately not changed in this lane; the reader would fall to the store
  there, an ultra-pathological edge noted for a future parity pass.
- Secret hygiene unchanged: only `key`/`access` material is used, only as the
  Bearer header; `refresh`, account ids, emails and org metadata never leave
  the stored value; probes print only statuses/percentages/identity kinds.
