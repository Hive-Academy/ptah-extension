# Batch 12c Code Logic Review — `TASK_2026_555`

DISCLOSURE: same-side review. The reviewer and the batch's author (backend-developer,
in-process subagent per `batch-12c-report.md`) are both running in this process; no
independent CLI lane was used. Treat findings accordingly — this is not an
adversarial cross-vendor review.

## Scope

`git diff -- libs/backend/rpc-handlers/src/lib/handlers/{agent-rpc.handlers.ts,agent-rpc.handlers.set-config.spec.ts,provider-rpc.handlers.ts,provider-rpc.handlers.spec.ts}`
only. Reviewed against `.ptah/specs/TASK_2026_555/batch-12c-report.md` and the "Batch 12c"
section of `batches.md`.

## Summary

| Metric              | Value      |
| -------------------- | ---------- |
| Overall score        | 8/10       |
| Assessment            | APPROVED   |
| Blocking issues       | 0          |
| Serious issues        | 0          |
| Moderate issues       | 1          |
| Failure modes found   | 1 (moderate, below) |

## Checks performed

1. **Outer catches return fixed text; `SettingsPersistError` passes through, fixed by
   construction.**
   - `agent-rpc.handlers.ts:408-419`: the outer catch of `agent:setConfig` now returns
     `'Could not save the orchestration settings.'` for any non-`SettingsPersistError`,
     and `error.message` only when `error instanceof SettingsPersistError`. Confirmed —
     no other branch reaches the client.
   - `provider-rpc.handlers.ts:88-95` (`clientTierError`), used at `:623-626`
     (`setModelTier`) and `:715-718` (`clearModelTier`): same shape, one shared helper.
   - `libs/backend/platform-core/src/file-settings-errors.ts:1-14`: `SettingsPersistError`
     takes only `code: string` in its constructor and builds
     `` `Settings could not be saved to disk (${code})` `` — no path, no key, no
     wrapped-error message ever enters the string. Confirmed fixed by construction as
     claimed.
2. **Result shapes unchanged; `'conflict'` is frontend-only.**
   - `libs/frontend/core/src/lib/services/providers-commit.service.ts:186` and `:198`
     read only `.success` off the `agent:setConfig` / `provider:setModelTier` RPC
     results. Confirmed — the new fixed `.error` string is never inspected there.
   - `:265,277,329-338`: `conflicted`/`'conflict'` is produced inside the frontend's own
     `write()`/`settle()` from a value comparison, not from any RPC's `.error` field.
     Confirmed the three touched handlers never return a `'conflict'` value; their
     result union stays `{ success: boolean; error?: string }`.
3. **Out-of-scope sites unchanged.** `agent-rpc.handlers.ts:642,749,779,818,902,1135`
   (permissionResponse, stop, resumeCliSession, and others) still return
   `error instanceof Error ? error.message : String(error)` verbatim. `git diff --stat`
   for both `.ts` files shows only the two intended hunks (agent: +19/-7 across the one
   `agent:setConfig` catch plus its diagnostic changes; provider: +14/-7 across the two
   tier catches plus the new helper) — no incidental edits elsewhere.
4. **The three changed older assertions.** All three replace an assertion on the raw
   thrown message with the new fixed text, which is exactly the sanitize-in-place intent
   of this batch, not a weakening of coverage:
   - `agent-rpc.handlers.set-config.spec.ts:265-296`: renamed test now expects
     `'Could not save the orchestration settings.'` instead of `error.message`, and adds
     an assertion that the logger still receives the original `Error`. Justified.
   - `provider-rpc.handlers.spec.ts` (`setModelTier` "captures service failures"): 
     `'disk full'` → `'Could not save the model tier.'`. Justified, same reasoning.
   - `provider-rpc.handlers.spec.ts` (`clearModelTier` "captures service failures"):
     `'write blocked'` → `'Could not reset the model tier.'`. Justified.
   None of the three silently drops a check that existed before; each keeps (or adds)
   the logger/Sentry assertion alongside the new fixed-text assertion.
5. **New specs serialize the result and assert the fake key/path are absent.**
   - `agent-rpc.handlers.set-config.spec.ts:303-322`: builds
     `leakyMessage = 'write failed for ${fakeKey} at C:\Users\someone\.ptah\settings.json'`,
     rejects with `new Error(leakyMessage)`, then asserts
     `JSON.stringify(result)` does not contain `fakeKey` or `'someone'`, and that
     `result` equals the fixed-text shape. Confirmed this is a genuine round-trip
     serialization check, not just an object-equality check that could hide a leak in
     a non-enumerable property.
   - Same pattern in `provider-rpc.handlers.spec.ts:898-940` for `setModelTier` and
     `:1131-1156` for `clearModelTier`, both also asserting `h.logger.error` /
     `h.sentry.captureException` still receive the raw `error` object with the
     unchanged `errorSource`.
   - Both spec files were run directly: `agent-rpc.handlers.set-config.spec.ts` — 20/20
     passed; `provider-rpc.handlers.spec.ts` — 41/41 passed (foreground,
     `npx nx test @ptah-extension/rpc-handlers --testFile=<spec>`).

## Five logic questions

### 1. How does this fail silently?

It does not fail silently in the sense of losing the error: the logger and (for the
provider RPCs) Sentry still receive the full original `Error` object at
`agent-rpc.handlers.ts:410-413`, `provider-rpc.handlers.ts:618-621` and `:710-713`, so
the underlying cause is still observable server-side. The risk this batch closes is the
opposite direction (raw text leaking to the client), and that is verified above.

### 2. What user action produces unexpected behaviour?

None found for the three RPCs in scope. A user hitting a real `EACCES`/`ENOSPC` write
failure gets `Settings could not be saved to disk (<code>)` if the failure surfaces as a
`SettingsPersistError`, or a generic fixed sentence otherwise — both are informative
enough to retry, and neither exposes anything sensitive.

### 3. What input data produces a wrong answer?

None identified that this batch introduces. See Moderate issue below for a narrower
concern about non-`Error` throws.

### 4. What happens when a dependency fails?

Covered directly by the new specs: a rejected promise with a message containing a
credential and a filesystem path is turned into the fixed sentence before reaching the
client, while the logger/Sentry paths (the developer-facing surface) keep the original
object.

### 5. What is missing that the requirements never mentioned?

The follow-up list in `batch-12c-report.md` (`agent:permissionResponse`, `agent:stop`,
`agent:resumeCliSession`) is explicitly out of scope per `batches.md`'s Task 12c.1 file
list and correctly deferred to Batch 37's parity-evidence follow-ups; confirmed those
sites are untouched (Check 3 above). Nothing else in this batch's stated scope is
unaddressed.

## Failure modes

### Non-`Error` throw loses branch discrimination silently into the safe default

- Trigger: `error` is not an `Error` instance and not a `SettingsPersistError` (e.g. a
  rejected primitive, a string throw from a mocked dependency, or a plain object thrown
  by some third-party call inside `setConfiguration`/`setModelTier`/`clearModelTier`).
- Symptom: none visible to the user — `clientTierError`/the inline check in
  `agent-rpc.handlers.ts:414-418` still returns the fixed sentence, which is the correct
  and safe behavior.
- Evidence: `agent-rpc.handlers.ts:410-413` builds `new Error(String(error))` only for
  the log call; the returned `.error` string doesn't depend on `error`'s type at all
  once it fails the `SettingsPersistError` check, so this is safe by construction, not a
  bug. Listed as a failure mode only to record that it was checked and found benign,
  not a gap.
- Current handling: correct — any non-`SettingsPersistError` throw, of any shape,
  degrades to the fixed message.
- Recommendation: none required.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **Moderate.** `provider-rpc.handlers.spec.ts` and `agent-rpc.handlers.set-config.spec.ts`
  assert absence of the fake key/path only via `JSON.stringify(result)`. This is a solid
  check for the RPC boundary itself (what actually crosses the wire), but neither spec
  additionally asserts that `h.logger.error`'s *second* argument is the original `Error`
  object rather than a re-stringified/re-wrapped one that could itself have been
  sanitized somewhere upstream and lost fidelity — they do assert
  `toHaveBeenCalledWith('RPC: ... failed', error)` using the same `error` reference, which
  covers this reasonably (moderate only because it relies on referential equality rather
  than inspecting the logged payload's own message content, which is a minor
  belt-and-suspenders gap, not a defect).

No other findings; this is a narrow, well-scoped batch and the diff matches the report.

## Data flow

1. RPC call `agent:setConfig` / `provider:setModelTier` / `provider:clearModelTier`
   enters the handler — OK.
2. Underlying write (`workspace.setConfiguration`, `providerModels.setModelTier`,
   `providerModels.clearModelTier`) throws — OK, unchanged from before this batch.
3. Catch block logs full error (and Sentry, for provider RPCs) — OK, verified unchanged
   by the new specs.
4. Catch block builds the client-facing `.error` string: `SettingsPersistError.message`
   passthrough, else fixed sentence — OK, verified by construction and by test.
5. Result `{ success: false, error }` returned to RPC caller — OK, shape unchanged.
6. `providers-commit.service.ts` reads only `.success` — OK, verified; the sanitized
   `.error` text is not currently surfaced to `'conflict'` logic or otherwise
   misinterpreted.

No gap found in the traced path for the three RPCs in scope.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Outer catches return fixed text for `agent:setConfig` | COMPLETE | none |
| Outer catches return fixed text for `provider:setModelTier`/`clearModelTier` | COMPLETE | none |
| `SettingsPersistError` passes through unchanged | COMPLETE | none |
| Result shapes (`success`/`error`) unchanged, `'conflict'` untouched | COMPLETE | none |
| Out-of-scope sites (`permissionResponse`, `stop`, `resumeCliSession`) unchanged | COMPLETE | none |
| New specs prove fake key/path never reach the client | COMPLETE | none |
| Logging/Sentry keep the raw error | COMPLETE | none |

Implicit requirements not addressed: none identified beyond the report's own deferred
follow-up list, which is correctly out of scope for this batch.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Raw `Error` with credential/path in message | YES | Fixed sentence returned; logger/Sentry keep original | none |
| `SettingsPersistError` | YES | Message passed through, verified fixed by construction | none |
| Non-`Error` throw (string/object) | YES | Falls to fixed sentence by type-check default | none |
| Zod validation failure on tier RPCs | YES (per report) | Also gets fixed text; UI only checks `success` | Minor — not independently re-verified by this reviewer beyond the report's claim, since it is outside the four diffed files (validation logic lives elsewhere); accepted on the report's word plus the unchanged result-shape check |
| Successful write | YES | `{ success: true }` unchanged | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only residual note is the same-side disclosure itself —
  an independent second reviewer (CLI lane) was reserved but not used for this pass.
- What a robust implementation would add: nothing functionally; optionally, a shared
  test helper for the "assert fixed text + no leak + logger/Sentry untouched" pattern
  now duplicated three times across the two spec files, to keep future RPC sanitization
  batches from drifting in assertion shape (a style/DRY note, not a logic defect).
