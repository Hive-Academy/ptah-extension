# Code Logic Review, round 2: plan-limits-live-fix

Verdict: REVISE. Score 6/10. 0 blocking, 2 serious, 1 moderate new defects.

Scope: Codex deadline code and the OpenCode v2 credential store. The Ollama, Antigravity-key and UI edits belong to other lanes and are not judged here. I did not run any checks. This review reads the working tree only.

## Round-1 status

| #   | Defect                                                                               | Status                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The per-lane or per-owner deadline does not shorten the response                     | NOT FIXED (documented only)                                                                                                                                                                             | `lane-limit-lookup.service.ts:131-135` still does `Promise.all(rows.map(lookupRow))`, so the response waits for the slowest lane (up to 12 s). The change was a comment edit (`:11-15`). Discovery now also waits up to 12 s (`plan-limit-owner-discovery.service.ts:264`). See new defect 1. |
| 2   | The store cache ignores the WAL                                                      | FIXED                                                                                                                                                                                                   | `opencode-go-credential.ts:290-324`. The db and `-wal` signature is compared at `:294-303`. ENOENT counts as null (`:385-393`). `invalid` is never stored (`:311-322`).                                                                                                                       |
| 3   | The DB is copied on the main thread on every miss                                    | FIXED                                                                                                                                                                                                   | The copy machinery is gone. The store is opened in place with `readOnly` and a 500 ms timeout (`:207-228`). A residual risk remains (see new defect 3).                                                                                                                                       |
| 4   | The non-atomic db, WAL and shm snapshot                                              | FIXED                                                                                                                                                                                                   | There is no snapshot any more. Open failure maps to `invalid` and is uncached (`:239-253`).                                                                                                                                                                                                   |
| 5   | 401 and expired OAuth read as a service outage                                       | PARTIAL                                                                                                                                                                                                 | The reader is correct. An expired `expires` skips the request (`reader:120-122`), and 401 maps to `unsupported-auth` (`:135`). The user-visible text is still wrong for OpenCode. See new defect 2.                                                                                           |
| 6   | The sync owner check and the async reader disagree on a blank or invalid `auth.json` | FIXED                                                                                                                                                                                                   | `opencode-go-credential.ts:360-371`. `blank` falls through to the store. `invalid` returns false, as the reader does.                                                                                                                                                                         |
| 7   | Ollama reads from a shared key only                                                  | Out of scope. The other lane's `usesOllamaSignInFallback` change looks consistent in the resolver and the credential source.                                                                            |                                                                                                                                                                                                                                                                                               |
| 8   | Hard-coded slow-provider set                                                         | Accepted as minor. I found no concrete failure: `antigravity`, `codex` and `openai-codex` cover the callers (`lane-limit-lookup.service.ts:156-160` passes cli, providerId and the owner's providerId). |                                                                                                                                                                                                                                                                                               |

## New defects

1. Serious. Dashboard and agent-list latency now compounds to a worst case of about 24 s.
   - File: `plan-limit-owner-discovery.service.ts:261-264` and `plan-limits-snapshot.service.ts:145-147` plus `:183`.
   - Scenario:
     - The `lane` discovery source now has a 12 s deadline for every detected lane (`SLOW_LIMIT_LOOKUP_DEADLINE_MS`), not only Codex.
     - Codex-home or lane detection is cold (3-6 s was observed). `discoverTargets` is awaited in full at `plan-limits-snapshot.service.ts:145`, and the owner reads begin only afterwards.
     - A cold Codex or Antigravity owner read then takes up to a further 12 s.
     - The RPC therefore blocks Claude and every fast provider for up to about 24 s. Before the fix the cap was 3 s plus 3 s.
   - Fix:
     - Give the `lane` source the slow deadline only when a Codex or Antigravity lane is actually detected, or race the discovery sources individually and return the fast ones.
     - Better, return the fast owners first and let the slow ones resolve through the push path, as defect 1 asked.
     - At minimum, record the 24 s worst case in the docs (see also the stale text at `plan-limits-snapshot.service.ts:121`).

2. Serious. The sign-in-again state is invisible for OpenCode, so the defect 5 fix does not reach the user.
   - File: `readers/opencode-go-plan-usage.reader.ts:65-69,121,135`, consumed at `provider-account-card.component.ts:575-583` and `:673-684` (default branch), and at `lane-tiles.ts:411-415`.
   - Scenario:
     - The OpenCode OAuth `access` token expires while OpenCode is closed. This is the normal case, because only OpenCode refreshes it.
     - The reader returns `unsupported-auth`.
     - The dashboard card shows "API key — no plan limits" and "No plan limits (API key)". The lane tile says "Plan usage is not reported for this sign-in method".
     - The user is told the account has no limits, not to sign in again. This is a success-looking, misleading result.
   - Fix:
     - Add an OpenCode branch beside the ollama-cloud and antigravity branches. It should say "OpenCode sign-in expired, open OpenCode to refresh".
     - Or return a distinct status.

3. Moderate. An uncached `invalid` state means a synchronous open on every owner resolution.
   - File: `opencode-go-credential.ts:239-253,311-322`, called from `provider-owner.resolver.ts:593` (`ownerForOpenCode`).
   - Scenario:
     - The store is unreadable for a durable reason: a crash-leftover WAL with no running writer (readOnly open fails), a locked DB, or a corrupt credential `value` (`JSON.parse` throws).
     - `invalid` is never cached, so every `ownerForOpenCode` call (per lane row, discovery and spawn) performs a fresh `new DatabaseSync` on the extension-host thread. The busy case blocks up to the 500 ms `STORE_OPEN_TIMEOUT_MS` per call.
     - Several OpenCode rows can therefore freeze the host for seconds. The owner also flaps between opencode-go and plain opencode.
   - Fix: cache `invalid` under the db and WAL signature with a short TTL (about 1-2 s). The signature change then still triggers an immediate retry, and the 500 ms block happens at most once per TTL.

## Checked, no defect found

- Per-lane timers: the abort listeners and timers are released in the `finally` at `lane-limit-lookup.service.ts:176-181`.
- Caller-abort propagation: a caller abort cancels every row, as before.
- Late-owner retention: the retention callbacks still fire on timeout (`plan-limit-owner-discovery.service.ts:250,261`).
- Secrets in the credential module: only `key` and `expiresAt` leave the module, and no refresh token is carried.
- Cache-hit mutation: `cached.checkedAt` is updated only on a matching signature, which is correct.
- Reader seam: the `string | OpenCodeStoreCredential` union is handled at `reader:106-110`.

## Verdict

The OpenCode store work fixes defects 2, 3, 4 and 6. Defect 1 is left open and defect 5 is only half-fixed. New defects 1 and 2 are both user-visible. Fix those two and cache `invalid` briefly (new defect 3), and the code is approvable.
