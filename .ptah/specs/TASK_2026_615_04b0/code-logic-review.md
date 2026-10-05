# Code Logic Review - TASK_2026_615_04b0

Reviewer: independent cross-side logic review of the working-tree diff (lanes A, B, C plus orchestrator fixes).
Checks run: `npx jest -c libs/backend/auth-providers/jest.config.ts provider-owner.resolver` (49/49 pass); `tools/degradation-audit/check-degradation.ts` (all libs at or under baseline; no new unsuppressed sites). All other conclusions come from reading the code and tracing the data paths.

## Verdict

Score: 7/10. Verdict: APPROVED WITH MINORS.

Findings: 0 Blocking, 1 Major, 9 Minor.

No finding stops the merge. The Major is a design assumption the context already accepted; it needs a recorded caveat and a follow-up.

## Findings

### 1. [Major] The Antigravity account identity may not be the account Antigravity bills

Evidence: `libs/backend/auth-providers/src/lib/quota/provider-owner.resolver.ts:119-136` and `:377-387`.

- `readActiveGeminiAccount` reads `~/.gemini/google_accounts.json`. This is the Gemini CLI's active-login file. Nothing in the diff shows Antigravity reads or writes it.
- The usage reader (`readers/antigravity-plan-usage.reader.ts`) asks the local language server. That server reports whichever account Antigravity is signed into.
- If the two logins differ, plan windows read from Antigravity are attributed to the Gemini CLI account's owner key. The result looks valid and is wrong. This is a silent wrong answer and is not guarded.
- When the Gemini CLI account changes without Antigravity changing, the owner key changes and the ledger history is orphaned.

Mitigations already present: no secret leaks, and the fallback to `cli-store` works.

Recommendation:
- Record this as an explicit assumption in `context.md` and in the JSDoc of `ownerForAntigravity`.
- Add a follow-up to move to the `GetUserStatus` account field once it is confirmed.
- Consider putting the owner label of this kind into the tile text, for example "Antigravity account (Gemini login)".

### 2. [Minor] "Read at spawn and again at exit, so no upgrade path needed" is not accurate

Evidence: `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-owner.resolver.ts:46-55`; `agent-process-manager.service.ts:855-859`, `:2428`.

- `upgradeQuotaOwner` replaces only an `unknown` identity kind.
- An Antigravity lane that spawned before the account file existed carries a `cli-store` owner. That kind is not `unknown`, so it is never upgraded at exit.
- Discovery then lists the same install twice: the lane's `cli-store` key (from `active-evidence` / `lane` ledger entries) and the new `account` key (from `cli-store` discovery, `plan-limit-owner-discovery.service.ts:327-333`).
- The same split happens once when the account file first appears for an existing install, and again on every account switch.
- Impact: duplicate or orphaned owner rows for a while. Nothing is lost.
- Fix: correct the claim in the context. Optionally let `cli-store` be upgraded to `account` for the same provider.

### 3. [Minor] The account-file schema is stricter than needed, and the email is not normalised

Evidence: `provider-owner.resolver.ts:113-116`, `:127-128`, `:381-383`.

- `old: z.array(z.string())` is required. A file with only `active` fails the parse and silently falls back to `cli-store`. This is documented as an optional capability and is not logged.
- The email is trimmed but not lowercased. `A@x.com` and `a@x.com` give two owner keys for one account.
- Fix: make `old` optional and lowercase `active`.
- No email leak found: the value is hashed and never logged. The only throw site, `quotaOwnerRefFromKey`, has a fixed message. The label stays `Antigravity account`, built from the provider and kind only.

### 4. [Minor] Synchronous file read on hot paths

Evidence: `provider-owner.resolver.ts:119-136`; callers `lane-owner.resolver.ts:79` (spawn and exit), `plan-limit-owner-discovery.service.ts:331` (each discovery, and so each snapshot and broadcaster push).

- This is one small local file and the read is guarded by try/catch.
- On a slow or networked home directory it blocks the event loop on every snapshot.
- Fix: cache with a short TTL or a file mtime check. Not required now.

### 5. [Minor] Broadcaster `pushing` flag can wedge if a dependency never settles

Evidence: `libs/backend/rpc-handlers/src/lib/handlers/plan-limits-broadcaster.ts:75-80`, `:89-112`.

- The old generation counter let a newer push proceed past a slow one. The new `pushing` flag blocks all pushes until the in-flight one settles.
- If `snapshots.currentSnapshot()` or `webviewManager.broadcastMessage()` never resolves, every later ledger change only sets `dirty`. Updates stop for the process lifetime with no log.
- `currentSnapshot` is deadline-bounded, so the practical risk is the webview transport. It is low.
- Re-arm logic itself checks out:
  - A change during a push sets `dirty` and one trailing push follows immediately. The stale snapshot is still sent first, then the fresh one, in order.
  - `dispose()` stops both the timer and the re-arm.
  - The `void this.push()` in `finally` cannot reject, because `push` catches everything. Only a throwing logger could break that.
  - A timer cannot be pending while `pushing` is true, so the early return in `push()` loses nothing.
- Fix: add a bounded wait on the broadcast, or a watchdog that clears `pushing`.

### 6. [Minor] `resolveModelScope` collapses to a Claude family for every CLI, and changes the scope the ledger records

Evidence: `agent-process-manager.service.ts:2654-2657`, `:859`, `:2462-2466`.

- The comment says "Claude uses families, all others retain their id". The code does not gate on `cli` or owner provider.
- Any model id containing `opus`, `sonnet` or `haiku` becomes that family. Examples: an opencode `anthropic/claude-sonnet-4`, or a third-party model with the substring.
- `recordSuccess` formerly wrote the full lower-cased model id for every lane. It now writes the family for these. Existing ledger rows keyed by full model id are orphaned.
- This does match `ptah-cli-stream-loop.service.ts:614` and `weekly_model:<family>` windows for Claude owners.
- Fix: gate on `cli` being claude or ptah-cli, or on owner provider. Otherwise document the change.
- Spawn with no model gives `null`, which is the same as before.

### 7. [Minor] Frontend merge: a backend `null` never clears a known `modelScope`

Evidence: `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1065`, `:1284`.

- `info.modelScope ?? existing.modelScope` keeps the old scope when a reopened or exited lane reports `null`.
- This is probably intended: an exit payload that lacks the model must not erase a known value.
- If a resumed lane runs on a different model with no resolvable family, the card keeps the stale scope and may show the wrong model-scoped window.
- Fix: accept the behaviour and add a comment, or distinguish `undefined` from `null` for the resume case.
- Other paths are fine: spawn and fresh use `?? null`; restore uses `ref.modelScope ?? null` at `:1520` and `agent-process-manager.service.ts:1219`.

### 8. [Minor] The open plan tile no longer shows the meter

Evidence: `plan-window-detail.component.ts:31-73`; `plan-limit-tile.component.ts:103`.

With `showSummary=false` the opened panel drops:
- the percentage meter, which has `role="meter"`;
- the near-limit tick.

Every other summary field is on the tile face: `label`, `caption`, `value` (the same `usedText`), `chip` and `sourceChips` (`plan-limit-tiles.ts:206-217`). The meter is not on the face, so it is a real loss.
- The lane subgroup keeps the default (`true`), so it still shows the meter.
- The `usedText` that stays on the face still carries the percentage, so no data is lost.
- It is a design call. State it or keep the meter in the panel.

### 9. [Minor] One owner label still uses the raw label

Evidence: `lane-tiles.ts:419` (`${snapshot.owner.label} does not report plan usage`).

Every other owner label in these files now goes through `ownerDisplayLabel`. Two owners without a usage source read the same here. The suffix helper itself is sound:
- It takes only the last 4 hex characters of a fingerprint of 8 or more hex characters, after the last `:`.
- A non-canonical key returns the plain label.
- For `account`, `cli-store` and `unknown` keys the suffix is applied the same way.

For `unknown` and `cli-store` keys the suffix carries little meaning, because those are path-derived. It is harmless.

### 10. [Minor] Doc claim and unrelated churn

- `session-plan-limit-callback-registry.ts:61-62` and `session-quota-probe.service.ts:33-35` now say signals "carry the SDK's real session id".
  - `stream-transformer.ts:434` starts `effectiveSessionId` at the tabId and `:589` emits with it.
  - A turn-start that fires before `init` still carries the tabId.
  - The old wording was safer. The probe's `find` accepts both ids, so there is no functional impact.
- Formatting-only edits widen the diff:
  - `plan-limit-owner-discovery.service.ts` (re-wrapped `selectedProvider`, `ptahCliLanes`, `routeInput`)
  - `agent-monitor.store.ts:821`
- The `LOOPBACK_AGENT` change in `antigravity-plan-usage.reader.ts` is a separate fix. It is fine, but note it in the commit message.

## Review checklist answers

1. Antigravity identity:
   - Distinct accounts give distinct keys (the path root and `active` are hashed together).
   - The fallback is safe and no email appears in logs, labels or errors.
   - The DI constructor is unchanged, so tsyringe and `emitDecoratorMetadata` are unaffected. The `read` default parameter is a plain function default.
   - The discovery `cli-store` branch is wrapped by `fromSource`, so a throw is contained.
   - See findings 1 to 4.
2. `session-quota-probe.service.ts`:
   - `.catch` is correct and logs at debug without the error text. This is acceptable.
   - `cloud_credential_error` exists in `SDKAssistantMessageError` (`sdk.d.ts:3484`), and dropping the cached account on it is harmless.
3. Discovery timeout:
   - The timer is cleared in `finally`.
   - A late rejection from `selectedProvider` is handled by `Promise.race`, so there is no unhandled rejection.
   - The mapping is correct: `unavailable` gives `service-unavailable`, no owner gives `provider-unsupported`.
   - `ownerSnapshotForProvider` has a single caller (`provider-rpc.handlers.ts:204`), and it is updated.
   - A deterministic throw in `selectedProvider` now reports a retryable error instead of unsupported. This is a behaviour change worth knowing about.
4. Broadcaster: see finding 5.
5. `modelScope`:
   - All write paths are covered: spawn (`:859`), exit persist (`agent-events.ts:439`), restore (`:1219`).
   - A restore with an invalid `quotaOwner` and a valid `modelScope` returns `{...rest, modelScope}`. A legacy reference without these keys returns the same object.
   - See findings 6 and 7.
6. Owner label suffix: never the full key. See finding 9.
7. `showSummary`: see finding 8.
8. Project traps: no async-without-await, NaN or object-literal default parameter found. The new catches carry degradation markers or log and return. The `AgentProcessManager` constructor order is untouched.

## Five logic questions

1. Silent failure: finding 1 (a wrong account attributed with no signal) and the unlogged account-file parse fallback (finding 3).
2. Unexpected user action: switching the Gemini CLI login splits the ledger history (findings 1 and 2).
3. Wrong answer from input: mixed-case emails and non-Claude ids that contain `sonnet`, `opus` or `haiku` (findings 3 and 6).
4. Dependency failure: a missing or malformed account file falls back to `cli-store`. A discovery timeout or throw now reports `service-unavailable`. A hung broadcast stalls pushes (finding 5).
5. Missing: a caveat that the Antigravity identity is a stand-in, a TTL on the file read, and a label that tells the user which login the owner follows.

## Correction review

Verdict: APPROVED. No defects.

- `provider-owner.resolver.ts`: `GeminiAccountsSchema` requires only `active`. The value is trimmed and lowercased before hashing, and an empty value still falls back to `cli-store`. The new spec asserts the same key for `first@example.test` with `old: []` and ` First@Example.TEST ` with no `old`. This closes finding 3.
- `lane-tiles.ts:419` now uses `ownerDisplayLabel(snapshot.owner)`. This closes finding 9.
- Findings 1, 2, 4 to 8 and 10 remain open as recorded follow-ups.
