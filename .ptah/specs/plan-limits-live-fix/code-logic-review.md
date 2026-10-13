# Code Logic Review: plan-limits-live-fix

Verdict: REVISE (score 5/10). 0 blocking, 4 serious, 4 moderate.

Scope: working-tree diffs of evidence-precedence.ts, lane-limit-lookup.service.ts, plan-limit-owner-discovery.service.ts, plan-owner-read.ts, plan-limits-snapshot.service.ts, opencode-go-credential.ts and opencode-go-plan-usage.reader.ts. Whole files were read for the credential module, the reader and the lookup service. I did not run tests. No token logging was found: the key is returned only to the reader and sits in an Authorization header, and every catch discards the error.

## Answers to the focus questions

- **Does the 12 s deadline delay the whole response?** Yes, at the response level.
  - Deadlines are per row and per owner, so a slow lane is timed out on its own timer. The abort is still propagated correctly. `lane-limit-lookup.service.ts:131-133` aborts a per-row controller linked to the caller's signal, and `plan-limits-snapshot.service.ts:178-190` does the same per owner.
  - Both callers then `Promise.all` the rows or owners (`lane-limit-lookup.service.ts:131`, `plan-limits-snapshot.service.ts` `assemble`). One cold Codex or Antigravity read therefore holds the entire agent-list or dashboard response for up to 12 s. Before the change that cost was capped at 3 s.
  - The doc comments ("Codex cannot delay peers", "costs only its own lane") are only true for the classification of the result, not for latency. See defect 1.
- **node:sqlite degrade path.** The module loads in two ways, both guarded.
  - The sync path uses `process.getBuiltinModule` inside try/catch (`opencode-go-credential.ts:186-196`). When the module is missing it returns `unknown`, so `hasOpenCodeGoCredentialSync` is false and owner resolution falls back to plain opencode. That is correct.
  - The async path does `await import('node:sqlite')` at `:221`. A missing module throws and the reader maps it to `unavailable()` (`reader:84-86`). It does not crash, but a missing module and a real service outage look the same to the user.
  - If `node:sqlite` is loadable but its `DatabaseSync` constructor lacks `readOnly`, the same silent downgrade applies (low risk).
- **Temp copy cleanup.**
  - Both paths clean up in a `finally` with retries. A normal exit does not leak.
  - A process kill or crash between `mkdtempSync` and `finally` leaks a directory, and nothing ever sweeps the stale `ptah-opencode-cred-*` directories. The copy holds the whole OpenCode DB, including sessions and messages, plus the token. `mkdtemp` makes the directory 0700 on POSIX; on Windows it relies on the temp directory ACL.
  - The DB is copied on every cache miss. See defects 2 and 3.
- **WAL visibility.** The `-wal` and `-shm` files are copied, but there are two bugs: the copy is not atomic (defect 4), and the cache signature ignores the WAL (defect 2).
- **Sync I/O on a hot path.** `hasOpenCodeGoCredentialSync` has a single caller, `provider-owner.resolver.ts:568` (`ownerForOpenCode`). It runs during owner resolution at spawn, discovery and lane lookup. On a cache miss it runs `copyFileSync` of the full DB, the WAL and the shm, then mkdtemp, sqlite open and rm, all on the extension-host main thread. The async `readOpenCodeGoStoreKey` also uses sync `copyFileSync` and `existsSync` inside an async function, which blocks the loop in the same way.
- **401 and 403 mapping.** 403 maps to `noPlan` (`reader:99`). 401 falls into `!response.ok` and maps to `unavailable` (`reader:100`). See defect 5.
- **Expired OAuth access token.** The reader sends `access` as the Bearer token and never refreshes it. See defect 5.

## Defects

### 1. Serious: the per-lane or per-owner deadline does not shorten the response (lane-limit-lookup.service.ts:131, plan-limits-snapshot.service.ts assemble, plan-limit-owner-discovery.service.ts:261)

- **Scenario:** a Codex or Antigravity lane, or a selected Codex provider, has a cold start. The whole `lookup()` or `snapshot()` call waits for the 12 s deadline.
- **Impact:** the dashboard or agent list blocks for 12 s for every provider. The 12 s `lane` discovery source also bounds `discoverTargets` for everyone.
- **Fix:**
  - Return fast rows immediately and let slow lanes resolve later. For example, push partial results via the existing push path, or return slow lanes as `pending` or cached-ledger evidence at the 3 s mark.
  - Keep reading in the background and update the cache so the next push carries the real value.
  - If the single-response design must stay, correct the comments and state the 12 s worst-case latency explicitly.

### 2. Serious: the store cache goes stale because it keys on `opencode.db` mtime and size only (opencode-go-credential.ts:234-238)

- **Scenario:** OpenCode runs the DB in WAL mode, where fresh writes (a login, or a switch of the active credential) land in `opencode.db-wal`. The main file's mtime and size do not change until a checkpoint.
- **Impact:**
  - After the 5 s TTL, `stat` matches the cache and the old state is returned. A newly logged-in user stays on `absent` (plain opencode owner, "no plan") until a checkpoint.
  - A transient `invalid` state is cached with the same signature and sticks the same way.
  - A re-login that rotates the token is never picked up by the owner check.
- **Fix:**
  - Include `-wal` mtime and size in the signature (stat `dbPath + '-wal'`, ENOENT counts as 0).
  - Do not store metadata when the state is `invalid`, so the next TTL expiry re-reads.

### 3. Serious: the full DB is copied on the main thread whenever the signature changes (opencode-go-credential.ts:181-189, 205-206, 224)

- **Scenario:** the v2 `opencode.db` holds all sessions and messages, so it can be tens or hundreds of MB. It changes continuously while OpenCode is running, so the cache misses on every 5 s tick and after every OpenCode write.
- **Impact:** repeated synchronous multi-MB copies with `copyFileSync` block the extension-host event loop. The copies also leave conversation data in temp for a short time.
- **Fix:**
  - Open the store in place read-only, with no copy. WAL readers do not block the writer. For example use `new DatabaseSync(path, { readOnly: true })` with a short `timeout` and the busy handling, and fall back to `invalid` on error.
  - If copying is kept, make the async path use `fs/promises.copyFile` and add a size guard.
  - Run the sync check at most once per TTL, and prefer an async cached value that the sync check only reads.

### 4. Serious: the snapshot copy is not atomic, so it can be corrupt or reflect stale WAL (opencode-go-credential.ts:181-189)

- **Scenario:** `db`, `-wal` and `-shm` are copied one at a time while OpenCode checkpoints or writes. The result is a mismatched trio. SQLite either ignores the WAL (a stale credential, so the user gets a wrong or expired token) or fails to open the copy.
- **Impact:**
  - The failure reads as `invalid` or `absent`, which is `noPlan` or `unavailable`. It is also cached (see defect 2).
  - Copy order matters too: copying the WAL before the DB is wrong.
- **Fix:**
  - Open in place (see defect 3), or retry once after a failed open.
  - Do not cache `invalid`.
  - At minimum, copy `-wal` and `-shm` before or atomically with the DB, then retry once if the open fails.

### 5. Serious: 401 and expired OAuth show a misleading state (opencode-go-plan-usage.reader.ts:99-100, opencode-go-credential.ts:168-170)

- **Scenario:** the v2 credential is `{type:'oauth', access, refresh, expires}`. `access` expires and the stored value is not refreshed unless OpenCode itself runs. The usage endpoint returns 401.
- **Impact:** 401 hits `!response.ok` and becomes `unavailable()`, shown as "service unavailable" even though the account is signed in and just needs a re-login or a refresh. The code also ignores the `expires` field.
- **Fix:**
  - Map 401 to a distinct auth state, for example `unsupported-auth` or "sign in again", as the Ollama reader does for its rejected key.
  - Read `expires` from the oauth value and, if it is in the past, return the same state without making the request.
  - Do not implement a refresh. Refresh tokens are rotated by OpenCode, and refreshing here would invalidate its copy.

### 6. Moderate: the sync owner check and the async reader disagree when `auth.json` is blank or invalid (opencode-go-credential.ts:299-301 vs reader:79-86)

- **Scenario:** the `fileKeyState` switch returns false on `blank` or `invalid` and never consults the store. The reader behaves differently: `readOpenCodeGoKey` throws on invalid contents, so the reader gives `unavailable` without trying the store. `blank` returns `undefined`, so the reader does fall through to the store.
- **Impact:** a blank `opencode-go` key in `auth.json` plus a valid v2 login resolves the owner to plain opencode while the reader would find the key.
- **Fix:** treat `blank` like `absent` in the switch. Decide whether an invalid `auth.json` should still allow the store, and make both paths do the same thing.

### 7. Moderate: Ollama reads from a shared provider key only (plan-owner-read.ts:99-107)

- **Scenario:** a Ptah CLI agent that really has its own per-agent Ollama key, different from the shared provider key.
- **Impact:** the usage shown belongs to the shared account, not the agent's. The change assumes every agent slot holds only the placeholder, and owner resolution at `provider-owner.resolver.ts:470` makes the same assumption, so the two are at least consistent.
- **Fix:** read the agent slot first and use the provider key only when the slot is empty or a placeholder, and apply the same rule in `ownerForPtahCli`.

### 8. Moderate: provider-id coverage for the slow deadline is a hard-coded set (evidence-precedence.ts:25-29)

- **Scenario:** it lists `openai-codex`, `codex` and `antigravity`. Any other alias (for example `google-antigravity`, or a Codex lane whose `providerId` differs) gets 3 s and times out on a cold start.
- **Impact:** a possible silent timeout state for slow readers that the set misses.
- **Fix:** add a test that every id the Codex and Antigravity targets can carry maps to the slow deadline. Alternatively, let the reader declare its own deadline instead of a string set.
  - The discovery `lane` source uses 12 s unconditionally (`plan-limit-owner-discovery.service.ts:261`). That is deliberate, but it should be documented, and it ties into defect 1.

## Positives

- Token handling is clean. The key is never logged or cached, and the `unavailable` catches discard the error.
- `controller.abort()` runs in the `finally` of both the lane lookup and the snapshot service, so there are no dangling readers.
- The deadline `setTimeout` calls are unref'd and cleared.
- The cache TTL logic mirrors the existing auth.json cache.
- Query ordering matches OpenCode's own selection.

## Required before approval

Fix defects 1 to 5. Defect 6 is cheap and should go in too.
