# Code Logic Review — `TASK_2026_555` (Batch 28c)

## Re-review (revise round 1)

All three findings from round 1 (S-1, M-1, M-2) have been thoroughly resolved in source and pinned with dedicated specs.

| Finding | Status | Evidence (file:line) |
| --- | --- | --- |
| **S-1:** Stale check record persists after key delete/replace/remove | **FIXED** | [`libs/backend/rpc-handlers/src/lib/utils/connection-check-recorder.ts:47-69`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/utils/connection-check-recorder.ts#L47-L69) (`clear` bumps monotonic sequence tombstone; `complete` rejects tickets older than tombstone); [`handlers/auth-rpc.handlers.ts:1081,1097`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L1081) (`saveSettings`), [`:1369`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L1369) (`setApiKey` in `finally`), [`:1422,1425`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L1422) (`deleteStoredKey`); [`handlers/provider-rpc.handlers.ts:818,884-891`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts#L818) (`updateCustomEntry` via `customEntryEditStalesCheck`), [`:847`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts#L847) (`removeCustomEntry` in `finally`). Specs in `connection-check-recorder.spec.ts:65-105`, `auth-rpc.handlers.check-connection.spec.ts:308-401`, and `provider-rpc.custom-entries.spec.ts:628-683`. |
| **M-1:** Custom entries used a different probe than `provider:testCustomEntry` | **FIXED** | [`libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts:149-160`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/connection-check.ts#L149-L160) (`auth:checkConnection` delegates custom entries directly to `probeCustomProvider` and `customProbeCheckRecord`, unifying tool-verification semantics with `provider:testCustomEntry`); key provided securely via `readProviderKey` dep ([`auth-rpc.handlers.ts:306`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L306)). Specs in `connection-check.spec.ts:176-210`. |
| **M-2:** Schema failure returned 'Unknown provider id' | **FIXED** | [`libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:614-627`](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts#L614-L627) (throws standard `'Invalid parameters for auth:checkConnection'` on Zod failure, reserving `'Unknown provider id'` for well-formed but non-existent IDs). Specs in `auth-rpc.handlers.check-connection.spec.ts:180-215`. |

### New findings in Revise Round 1
*None.* The tombstone sequencing in `ConnectionCheckRecorder` cleanly prevents races between in-flight checks and key invalidation. The `readProviderKey` collaborator introduces no secret exposure: the credential remains strictly scoped to `probeCustomProvider` and is never logged, echoed, or included in check records.

---

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9.5/10                               |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Failure modes found | 0                                    |

Score justification: Exemplary implementation (>9/10). All security boundaries are airtight (keys > 4 chars never cross RPC, logs, Sentry, or errors; Unicode code point bounds and ASCII escaped bullets prevent formatting/mojibake issues). Concurrency single-flight joining prevents duplicated provider requests. The monotonic ticket sequence and tombstone invalidation pattern in `ConnectionCheckRecorder` eliminates state leaks across key deletion, key modification, custom entry edits, and asynchronous races.

---

## Five logic questions

### 1. How does this fail silently?
*No silent failures remain.* Key store read failures return explicit fixed `RpcUserError` text (`'Could not read the stored keys.'`, `PERSISTENCE_UNAVAILABLE`). Checks failing due to network or provider error are cleanly mapped to `{ status: 'failed', reason: ... }`. When a key is deleted or replaced, `clear` writes a sequence tombstone that immediately removes the check from `auth:getEffectiveRoute` and causes any in-flight check started before the mutation to be discarded.

### 2. What user action produces unexpected behaviour?
*None identified.* Deleting a key clears its check status immediately. Changing custom entry connection details (endpoint, lane, auth header, or key) resets its check status, while display-only changes (name, help URL, pricing) preserve the verified status as expected.

### 3. What input data produces a wrong answer?
*None.* `AuthCheckConnectionSchema` strictly enforces string length (1–128) and rejects unrecognised fields. Custom entries verify both connectivity and tool support identically via `probeCustomProvider`. Keys under 12 code points correctly yield no hint.

### 4. What happens when a dependency fails?
- **Secret storage read failure:** Caught in `keyStoreReadFailure`, logging `errorType` only and raising `RpcUserError('Could not read the stored keys.', 'PERSISTENCE_UNAVAILABLE')` without raw error propagation.
- **Provider network timeout or error:** `ConnectionChecker.run` catches unhandled probe exceptions, records `{ status: 'failed', reason: 'unclassified', latencyMs: null }`, and resolves without rejecting.
- **Custom entry probe failure:** Mapped deterministically by `customProbeCheckRecord` (`timeout`, `unreachable`, `credential-rejected`, `model-unavailable`, `unclassified`).

### 5. What is missing that the requirements never mentioned?
*Addressed in revise round 1.* Invalidation hooks upon key deletion, replacement, and custom entry reconfiguration were omitted in initial requirements but are now fully implemented and verified.

---

## Failure modes

*No active failure modes found.* All three failure modes identified in round 1 have been resolved:
- FM-1 (Stale check record after key deletion) is eliminated by `ConnectionCheckRecorder.clear()` and the monotonic tombstone mechanism.
- FM-2 (Custom provider probe divergence) is eliminated by routing `auth:checkConnection` custom entries to `probeCustomProvider`.
- FM-3 (Imprecise error classification on schema validation) is eliminated by returning standard `'Invalid parameters for auth:checkConnection'` on Zod failure.

---

## Blocking issues

*None.*

---

## Serious issues

*None.* (S-1 resolved).

---

## Moderate and minor issues

*None.* (M-1 and M-2 resolved).

---

## Data flow

1. **Check Connection Trigger (`auth:checkConnection`):**
   - Validated by `AuthCheckConnectionSchema` (`auth-rpc.schema.ts:87`). On schema violation: throws `RpcUserError('Invalid parameters for auth:checkConnection', 'INVALID_PARAMS')`. [OK]
   - Connection classified via `connectionCheckKind(providerId)` (`connection-check.ts:57`). Unknown ID throws `'Unknown provider id'`. Local servers throw `'This connection cannot be checked here.'`. [OK]
2. **Concurrency & Execution:**
   - Single-flight coalescing via `inFlight.get(providerId)`. Concurrent calls share the existing promise. [OK]
   - Monotonic sequence ticket acquired via `recorder.begin(providerId)`. [OK]
   - Execution branches:
     - `'apiKey'`: Bound stored probe via `DraftVerificationService.verify({ credential: { kind: 'stored' } })`. [OK]
     - `'custom'`: `probeCustomProvider` with stored key via `deps.readProviderKey(providerId)` and `customProbeCheckRecord`. [OK]
     - `'copilot'`: `copilotAuth.isAuthenticated()`. [OK]
     - `'codex'`: `codexAuth.clearCache()` + `getTokenStatus()`. [OK]
     - `'claude-cli'`: `cliDetector.performHealthCheck()`. [OK]
3. **Completion & Tombstone Check:**
   - `recorder.complete(ticket, record)` compares `ticket.sequence` against stored sequence. If `clear()` intervened, ticket is rejected. [OK]
4. **Key Mutation / Invalidation Flow:**
   - `auth:deleteStoredKey`, `auth:setApiKey`, `auth:saveSettings`, `provider:removeCustomEntry`, and non-display `provider:updateCustomEntry` execute `recorder.clear(id)` in `finally` blocks, advancing the sequence and clearing cached records. [OK]
5. **Route Read:**
   - `auth:getEffectiveRoute` queries `this.connectionChecks.get(provider.id)`. Returns `lastCheck` only when actively recorded and uninvalidated. [OK]
6. **Key Hint Read:**
   - `maskKeyHint`: Trims secret, verifies code-point length >= 12, prefixes `\u2022\u2022\u2022\u2022 `, returns last 4. On store error: converts to sanitized fixed `RpcUserError`. [OK]

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Masked hint: bullets + last 4 characters for keys >= 12 chars | COMPLETE | None. Tested with length 12, surrogate pairs, and trims. |
| Full key never crosses RPC, logs, or error responses | COMPLETE | None. Serialized response and diagnostic logs verified free of key fragments > 4 chars. |
| Key-store read failure returns fixed error text | COMPLETE | None. Verified by `keyStoreReadFailure` specs. |
| `auth:checkConnection` RPC with Zod validation | COMPLETE | None. Distinct messages for schema vs unknown ID. |
| Single-flight joining of concurrent connection checks | COMPLETE | None. Pinned in `connection-check.spec.ts` and handler specs. |
| Out-of-order check completion safety | COMPLETE | None. Monotonic sequence ordering verified. |
| Cache invalidation on key deletion/replacement | COMPLETE | None. Verified in `connection-check-recorder.spec.ts`, `check-connection.spec.ts`, and `custom-entries.spec.ts`. |
| Unified probe behavior for custom provider entries | COMPLETE | None. Both `auth:checkConnection` and `provider:testCustomEntry` verify tool support. |
| No-request check for Copilot / Codex / Claude CLI (`latencyMs: null`) | COMPLETE | None. Verified in `connection-check.spec.ts`. |

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Stored key < 12 characters | YES | `maskKeyHint` returns `undefined`; field omitted from JSON | None |
| Stored key with whitespace padding | YES | `secret.trim()` evaluated before length check | None |
| Surrogate pair at end of key | YES | `Array.from()` splits on code points rather than UTF-16 code units | None |
| Double click on "Check connection" | YES | `inFlight.get(providerId)` coalesces into single promise | None |
| Out-of-order check completion | YES | `recorder.complete` compares ticket sequence against current | None |
| Check in flight while key is deleted | YES | `recorder.clear` advances sequence; late completion rejected | None |
| Custom entry renamed only | YES | `customEntryEditStalesCheck` recognizes display-only field and preserves check | None |
| Custom entry endpoint or key edited | YES | `customEntryEditStalesCheck` invalidates check record | None |
| Provider network hang | YES | `DraftVerificationService` internal timeout aborts probe | None |
| Local server provider check | YES | `connectionCheckKind` returns `null`; rejects with fixed message | None |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None. The implementation is robust, complete, and resilient against race conditions and secret leaks.
- What a robust implementation would add: The current revision fulfills all architectural, functional, and security requirements.
