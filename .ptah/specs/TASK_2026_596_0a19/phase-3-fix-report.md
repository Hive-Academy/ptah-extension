# Phase 3 fix report — TASK_2026_596_0a19

Scope: findings A1-A3 (`phase-3-code-review.md`) and B1-B5 (`phase-3-batch-10-review.md`). Every edit is under `libs/backend/auth-providers/**`. I did not touch `cli-agent-runtime`, `batches.md` or the root barrel (still 149 lines), and I did not fix any Minor finding. Logging uses only the injected Logger. No test makes a live network call. The B1 server runs inside the test process and listens on 127.0.0.1 with an ephemeral port.

All paths below are relative to `libs/backend/auth-providers/src/lib/quota/`.

## A1 — a null-owner proxy 2xx now clears its own proxy's cooldown

- **Fix:** `plan-limit-ledger.service.ts:452-464`. `onProxySuccess` no longer returns early for `ownerKey === null`. It sends `ownerKey: proxyOwner(observation).key`, the same resolution the 429 path uses. A null-owner 2xx therefore clears only that proxy's `unknownOwnerKey(provider, 'proxy:<sourceId>')` cooldown. The billing stays `'unknown'`, so exhaustion is never cleared; only `billing:'plan'` clears it. The file header now states this rule (`:14-20`).
- **Specs** (`plan-limit-ledger.service.spec.ts`):
  - `:584`: the old "null owner clears nothing" case was replaced. Two unattributed proxies each receive a 7-day `Retry-After`. A 2xx from p1 drops p1's owner, and p2 keeps its `rawUntil = T0+7d`.
  - `:610`: a null-owner 2xx clears that owner's cooldown but leaves its window exhaustion in place.
  - `:632`: a 2xx observed before the 429 does not clear it.

## A2 — Codex `rateLimitReachedType` becomes window evidence

- **Fix:** `readers/codex-plan-usage.reader.ts`.
  - `:71` reads `reached` from `quota.rateLimitReachedType`.
  - `:93` defines `atLimit` as `usedPercent >= 100`.
  - `:110` attaches `exhaustion: { observedAt, source: 'provider-api' }`.
  - The header explains the matching (`:15-20`). None of the reached types in the 0.155.1 union names a window; they name a cause such as rate limit, credits or workspace usage. So the "cannot be matched" fallback applies: every window at or over 100% is marked. If no window is at the limit, none is marked. A window at 100% with no reached type stays a reading, not exhaustion. Stale answers keep the original `fetchedAt` as the time of the exhaustion.
- **Ledger:** no production change was needed. `recordWindowEvidence` → `windowStamp` already uses `exhaustion.source`/`observedAt`, and the shared `supersedes` and `carryExhaustion`/`readingClears` handle the rest. Two ledger specs now pin this behaviour.
- **Specs:**
  - `readers/codex-plan-usage.reader.spec.ts:122-179`: 5 cases (window at the limit marked, both windows at the limit marked, no match, 100% without a type, stale keeps `fetchedAt`).
  - `plan-limit-ledger.service.spec.ts:969-1017`:
    - A provider-api exhaustion is accepted and carried past a newer read that is still at the limit, then cleared by a newer read below the limit.
    - An older provider-api exhaustion, fresh or `{stale:true}`, never displaces newer live `stream-event` evidence.

## A3 — the session index now evicts idle sessions

- **Fix:** `plan-limit-ledger.service.ts`.
  - `SESSION_IDLE_MS` = 24 h (`:104`), exported from the service module only, not from the barrel.
  - `SessionState.lastSignalAt` (`:158`) is stamped from the injected clock on every session signal (`:365`), on every `setSessionOwner` (`:293`) and when the entry is created (`:483`).
  - `evictIdleSessions(now)` (`:496`) deletes a session only when it has been idle for at least `SESSION_IDLE_MS` and its owner has no live evidence after `prune`.
  - Eviction is lazy. It runs inside the existing operations `onSessionSignal` (`:363`), `knownOwners` (`:322`) and `sessionOwners` (`:332`). No timers are involved.
  - Live sessions keep their current owner. An evicted session re-registers on its next signal.
- **Specs** (`plan-limit-ledger.service.spec.ts:1019-1066`):
  - Present at `IDLE-1` and gone at `IDLE`, from both `knownOwners` and `sessionOwners`.
  - An idle session whose owner still holds live evidence is kept.
  - A session with a recent signal is kept, and an evicted session re-registers on its next turn-start.

## B1 — the Antigravity request always settles

- **Fix:** `readers/antigravity-plan-usage.reader.ts:287-337`. The new `readJsonResponse(open, maxBytes)` is exported from the module for the spec only; it is not in the barrel. It settles exactly once and:
  - checks for a 2xx `statusCode` before reading the body;
  - caps the body at `ANTIGRAVITY_MAX_BODY_BYTES` (1 MiB);
  - listens for `response.on('error')` and `response.on('close')`, both no-ops once settled;
  - adds a `request.on('close')` listener for a close before any response arrives;
  - calls `request.destroy()` on failure.
- `defaultRequest` now wraps `httpsRequest` with `readJsonResponse`. The reader also races each step against the deadline (`untilAborted`, `:136`), so an injected seam cannot outlive it either.
- **Specs** (`readers/antigravity-plan-usage.reader.spec.ts:332-389`): an in-process `node:http` server on 127.0.0.1 with port 0, closed in `afterAll` via `closeAllConnections` + `close`. Cases:
  - a 2xx body is parsed;
  - a stalled body (headers plus a partial body, never ended) with `AbortSignal.timeout(200)` rejects in under `ANTIGRAVITY_USAGE_TIMEOUT_MS`;
  - a server drop mid-body rejects;
  - a 500 rejects with `status 500`;
  - an oversized body rejects.
- The spec drives `readJsonResponse` over plain `http` because the repository has no TLS-cert tooling and I did not want to commit a private-key fixture. The settle logic does not depend on the transport.

## B2 — one deadline covers discovery and the request

- **Fix:**
  - The controller and the single 3 s timer are created before discovery (`readers/antigravity-plan-usage.reader.ts:78-84`). The caller's signal is forwarded into that controller.
  - `ProbeCommandRunner` now receives the signal, and `defaultRun` passes it to `execFile` (`:248-257`). The separate `execFile` timeout is gone.
  - Both `run` and `requestStatus` are raced with `untilAborted`.
- **Specs:**
  - `:233`: a caller abort during discovery resolves `service-unavailable`, aborts the discovery signal, and never sends the request.
  - `:260` uses fake timers. Discovery takes 2.5 s and the request ignores its signal. The reader is still pending at 2,999 ms and settles at exactly 3,000 ms, with no timers left.

## B3 — `findServer` matches on the executable only

- **Fix:** `readers/antigravity-plan-usage.reader.ts:153-207`.
  - The pid prefix is stripped. `splitExecutable` takes the first argv element: the contents of a quoted path, otherwise the first whitespace token.
  - `isAntigravityServer` requires `language_server` in the executable's basename and `antigravity` in the executable path, never anywhere else on the line.
  - `serverArguments` matches `--csrf_token` and `--port` only at an argument boundary, and strips surrounding `"` or `'` from the token.
  - Candidates are de-duplicated by (port, token). More than one distinct pair returns `null`, which surfaces as `service-unavailable`.
- **Specs** (`readers/antigravity-plan-usage.reader.spec.ts`):
  - `:133`: markers that appear only in arguments, on POSIX and Windows lines, are rejected.
  - `:146`: two distinct pairs are ambiguous and the request is not sent.
  - `:158`: the same pair listed twice is accepted.
  - `:168`: a quoted `Program Files` executable with a quoted token yields the bare token.
  - The existing fixtures now use realistic executable paths.

## B4 — `toWindow` no longer claims a weekly period

- **Fix:** `readers/antigravity-plan-usage.reader.ts:210-237`. The descriptor comes from `windowKindFromDuration(undefined, position)`, which gives kind `other` and the label `Window N · <model>`. The key is `other:model-<model>` and `modelScope` is kept. The model name is capped at `ANTIGRAVITY_MAX_MODEL_LENGTH` (64), and the percent is rounded to 0.1 (`:227`).
- **Specs:**
  - `:55`: F33 now expects `other:model-gemini` and `Window 1 · gemini`.
  - `:83`: no label says "weekly"; `0.7` → `30` and `0.123456` → `87.7`; a 500-character model is capped to 64 in the key, label and scope.

## B5 — Ollama Cloud: auth status and redirects

- **Fix:** `readers/ollama-cloud-plan-usage.reader.ts`. The fetch now passes `redirect: 'error'` (`:49`), so the bearer header cannot follow a redirect. Responses with status 401 or 403 map to `unsupported-auth` (`:53`); any other non-ok status still maps to `service-unavailable`.
- **Specs** (`readers/ollama-cloud-plan-usage.reader.spec.ts`):
  - `:116`: 401 and 403 → `unsupported-auth`.
  - `:138`: `redirect: 'error'` is asserted on the call, and a refused redirect maps to `service-unavailable`.

## Verification

- Targeted: `npx jest -c libs/backend/auth-providers/jest.config.ts --maxWorkers=2 libs/backend/auth-providers/src/lib/quota` → 8 suites, **170 tests, all passed**. I re-ran this after the final prettier pass.
- Required: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/auth-providers`, run in the foreground with no extra flags:
  - **typecheck: passed.** No errors were reported, including none from cli-agent-runtime files.
  - **lint: passed** with 0 errors and 4 warnings. The warnings are pre-existing and in files I did not touch: `max-lines` in `provider-models.service.ts` and `translation-proxy-base.ts`, a non-null assertion in `translation-proxy-base.ts`, and `no-useless-assignment` elsewhere.
  - **test:** 61 suites (60 passed, 1 failed); 1529 tests (1525 passed, 4 failed).
- All 4 failures are the known environment case. They are in `translation-proxy.sdk.integration.spec.ts` (S1-S4), and each fails with `EPERM, Permission denied` in the `removeTree` teardown (`:177`). No other test failed.
- The task reported failed only because of those EPERM teardowns.
- Run order: a first nx run surfaced one lint error that I introduced (`prefer-const` in `readJsonResponse`). I fixed it, then re-ran the full nx command with the results above. After that I applied prettier to the 8 changed files (formatting only) and re-ran the quota specs.

## Files

MODIFIED (all under `libs/backend/auth-providers/src/lib/quota/`):

- `plan-limit-ledger.service.ts` (A1, A3)
- `plan-limit-ledger.service.spec.ts` (A1, A2, A3)
- `readers/codex-plan-usage.reader.ts` and `.spec.ts` (A2)
- `readers/antigravity-plan-usage.reader.ts` and `.spec.ts` (B1-B4)
- `readers/ollama-cloud-plan-usage.reader.ts` and `.spec.ts` (B5)

## Plan deviations

- **A2:** no reached-type value in the current union names a window, so matching always uses the "window at or over 100%" fallback. I added no speculative type-to-window map.
- **B1:** the loopback spec runs over plain HTTP, using the exported settle function; see B1 for the reason.

## Out-of-scope observations

- Minors 4-6 (Batches 6-9 review) and 6-8 (Batch 10 review) are still open, as instructed.
