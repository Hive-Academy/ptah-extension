# Revise round 1 — lane A (findings 1, 2, 5, 6 and the serve.spec flake)

Source: `phase-d-fixes-codex-review.md`. A previous subagent stopped partway; its uncommitted
edits were checked with `git diff` and kept. This lane added the missing connection specs, the
operator-guide update, formatting, and the flake investigation.

## Finding 1 (High) — never steal a live owner's lock

- `libs/backend/worker-runtime/src/lib/process-state.ts:26-48` — new `processStartTime(pid)`:
  field 22 of `/proc/<pid>/stat` (parsed after the last `)`), null off Linux or when gone.
- `libs/backend/worker-runtime/src/lib/file-lock.ts`
  - `:35-40` `LockOwner` = `{ pid, startedAt, nonce, acquiredAt }`; `:111-134` `acquire`
    writes a 16-byte random nonce and the owner start time.
  - `:168-175` `abandoned`: dead or foreign PID, or a live PID whose current start time differs
    from the recorded one (PID reuse). The 60 s age override is gone; a live owner keeps its lock.
    Without a recorded start time (non-Linux or legacy record) a live PID is never stolen.
  - `:137-143` `release` removes the lock only while its nonce is still ours; otherwise reports
    "held by another owner" through `onReleaseError` and leaves it.
  - `:146-166` `stealAbandoned` compares by nonce + PID after the rename, and hands back a live
    lock that replaced the abandoned one.
  - `:199-233` legacy owner records (no nonce) parse with `nonce = legacy:<acquiredAt>`.
- Specs `file-lock.spec.ts:137-221`: a live child-process owner with a 120 s-old lock is not
  stolen (busy error, operation not run, lock intact); PID reuse with a different start time is
  stolen (Linux only); the owner record carries PID, start time and nonce, and a release never
  removes a lock another owner holds.

## Finding 2 (High) — revocation and grant refresh vs. auth in progress

- `libs/backend/worker-runtime/src/lib/connection.ts:349-374` — after `await recordUse(...)`
  the connection re-reads the token (`tokens.authenticate(secret)`); a revoked token closes with
  4401, and the current grant (not the pre-await snapshot) is installed. Reading the record and
  entering `client` happen in one synchronous step, so any later `closeTokenConnections` /
  grant-refresh scan in `worker-service.ts` reaches the connection. No change was needed in
  `worker-service.ts`: there is no window left in which an auth-in-progress connection can
  become a client with stale state.
- Specs `connection.spec.ts` describe "auth races and the admin proof (revise round 1)":
  deferred `recordUse` + revocation during the await closes with 4401 and dispatches nothing;
  a grant changed during the await is the one returned and used.

## Finding 5 (Moderate) — admin challenge-response

- `libs/worker-protocol/src/lib/methods.ts:120-145` — `hello` result has an optional
  `adminChallenge` (16-128 chars); `auth` admin variant is now `{ adminProof }`; the old
  `{ admin }` key field is refused (spec `methods.spec.ts:121-130,186-196`).
- `libs/backend/worker-runtime/src/lib/admin-key.ts:20-45` — `ADMIN_PROOF_CONTEXT =
  'ptah-worker/admin-auth/v1'`, `adminProof(key, challenge)` = base64url
  HMAC-SHA256(key, `challenge\ncontext`), `verifyAdminProof` with `timingSafeEqual` and a length
  check. `verifyAdminKey` removed (no other caller).
- `connection.ts:67-68,292-296,325-341` — a fresh 32-byte challenge per connection, sent in
  `hello`; `auth` verifies the proof against it.
- `libs/backend/worker-host/src/lib/commands/admin-client.ts:10-60` — keeps the PID/user and
  machine-ID early refusal, additionally requires a challenge, then sends only the proof.
- `libs/backend/worker-host/docs/worker.md:57` documents the challenge-response; `:55` documents
  the new lock owner identity.
- Specs: `admin-key.spec.ts` (HMAC bound to challenge and key; raw key is not a proof);
  `admin-client.spec.ts:138-163` fake listener with the right machine ID and a live PID receives
  only `{ adminProof }`, and no frame contains the key in base64url, hex or base64;
  `connection.spec.ts` accepts a correct proof and refuses one replayed on another connection.

## Finding 6 (Low) — lastUsedAt debounce

- `libs/backend/worker-runtime/src/lib/token-store.ts:150-164` — `lastRecorded` is set only
  after `mutate` succeeds.
- Spec `token-store.spec.ts:127-147`: a failed write (mocked `writeJsonAtomic`) leaves
  `lastUsedAt` null and the immediate retry writes it.

## serve.spec.ts SIGTERM/SIGINT flake

Cause not established; no code change. The failing run's error text was never captured
(batch-21 report). Ruled out:

- Listener race: `serve.ts:362-373` calls `onReady` and attaches the `process.once` handlers in
  the same synchronous step; the test emits the signal only after the hello reply.
- `fixPath()` login-shell probe: bounded by a 5 s `spawnSync` timeout and idempotent.
- A `signal-exit` style handler re-raising the signal: none of its dependents (`execa`,
  `write-file-atomic`, `proper-lockfile`) is imported by backend libs.
- Shutdown wait: `worker-server.ts:103-116` terminates clients after 1 s; drain has no sessions.

Most likely: under a full verify lock the first case's 60 s timeout is exceeded, and the second
case then fails as a cascade (the first serve instance keeps its signal listeners until its
`finally` runs). Next step if it recurs: capture the Jest failure text in CI or with
`npm run verify -- -t test -p @ptah-extension/worker-host -- --testPathPatterns=serve.spec`
under load.

## Verification

Coordinator run, after both lanes finished:

- `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/worker-host`:
  worker-protocol and worker-runtime lint, typecheck and test passed; worker-host typecheck passed.
  worker-host lint and test failed on the new `remote-sessions.spec.ts` (a static import of the
  lazy-loaded `@ptah-extension/worker-runtime`, and a `handleMessage` mock typed narrower than
  `RpcHandlerPort`). Fixed: the spec loads the runtime in `beforeAll` like its siblings, and the
  mock takes `{ method, params: unknown, correlationId }`.
- Re-run of worker-host lint, typecheck and test: lint and typecheck passed; test failed only on
  the `serve.spec.ts` signal cases (below). Final uncached worker-host test run: 46/46 passed.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0.

New evidence on the serve.spec flake (no code change): it failed in 3 consecutive full worker-host
runs, then passed in 7 consecutive runs. Stage timing in a failing run showed startup, the
`hello` reply and the signal all within 300 ms; the hang is after the signal, while `serving`
shuts down (`WorkerService.stop` and the `withEngine` teardown). The spec alone, and every pair
with it (`remote-sessions`, `serve-sessions`, `admin-client`, `worker-doc`) passed. The failures
coincided with another worktree's verify of memory-curator, shared, rpc-handlers, thoth-runtime
and skill-synthesis, and stopped when it ended, so a resource shared across processes during
teardown is the leading suspect. Not confirmed: the passing runs with in-memory step traces
never captured a hang.

## Remaining limits

- A relay listener (an impostor that forwards the real worker's challenge) is not prevented by
  the HMAC alone; it would need the real port to be free, and the endpoint PID/user check still
  applies. A peer-credential-bound channel would close it.
- Lock owner identity relies on `/proc`; off Linux a live PID is never stolen, so a reused PID
  there blocks the lock until that process exits (fails safe with "Worker file is busy").
- `release` is read-then-remove, not atomic; a steal between the two is possible only if our
  own owner were judged abandoned, which a live owner never is now.
- Log redaction (`worker-security`) still targets the retired `admin` field; `adminProof` is a
  one-connection value and is not redacted. Not in this lane's ownership.
