# Code Logic Review — Batch 3 (`TASK_2026_555` / `TASK_2026_551` Cursor key redaction)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 2                                    |
| Failure modes found | 1 (informational, no leak)           |

Scope: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/sdk-error-summary.ts`,
`cursor-cli.adapter.ts`, and their `.spec.ts` files (Batch 3 files only). Verified against
`implementation-plan.md:230-269` (Component 2) and TASK_2026_551 acceptance criteria 1 and 3
(criterion 2, the `cursorApiKeyStored`/`cursorApiKeyEnvSet` read-back, is explicitly out of
scope for Batch 3 per `batches.md:361,458` — deferred to Batches 5/8; confirmed not silently
dropped).

## Five logic questions

### 1. How does this fail silently?

No silent-failure path found in the redaction logic itself: `redactSecrets` is a pure
string-split/join with no catch block, so it cannot itself swallow an error. The one
pre-existing silent path — `this.logger?.error(...)` doing nothing when no logger is
injected (`cursor-cli.adapter.ts:391-393`, `449-451`) — predates this batch and is
unchanged; the user-facing `output`/`segment` still carry the redacted summary regardless
of logger presence, so no information is lost to the *caller*, only to the log.

### 2. What user action produces unexpected behaviour?

None identified that is new to this batch. `run.cancel()` failing now always rethrows a
freshly constructed `Error(detail)` instead of the original error object when the original
was itself an `Error` (`cursor-cli.adapter.ts:454`, was
`throw error instanceof Error ? error : new Error(detail)`). The only production consumer,
`agent-message-router.service.ts:177,384-386` (`describeError`), reads only `.message`, so
no observable behaviour changes today — but any future consumer that narrows on
`instanceof <VendorError>` or reads `.code`/`.status` off the rethrown value will find it
gone. This is a deliberate, documented deviation (batch-3-report.md "Plan deviations"),
correctly motivated (the original stack embeds the unredacted message), and covered by the
pre-existing `rejects.toThrow('run already gone')` spec (`cursor-cli.adapter.spec.ts:830`),
which still passes. Flagged as Moderate, not Serious, because the actual call site is
unaffected.

### 3. What input data produces a wrong answer?

A secret value of pathological length (empty string, whitespace-only) is explicitly
skipped (`sdk-error-summary.ts:41-43`, tested at `sdk-error-summary.spec.ts` "ignores blank
secrets"). A very short literal secret (1-2 characters) would over-redact unrelated
substrings of the message — not a security defect (nothing is *un*-redacted), only a
cosmetic one, and unreachable in practice since `resolveCursorApiKey` only ever populates
`secretRedactions` with a real, trimmed, non-empty Cursor key
(`cursor-cli.adapter.ts:187-202`, `313-324`). Regex-metacharacter-bearing keys are
correctly handled by literal splitting rather than a regex (spec: "replaces a value that
contains regex metacharacters literally").

### 4. What happens when a dependency fails?

- `agent.send`/`Agent.create`/`Agent.resume`/`getCursorSdk()` failures are all inside the
  same `try` in `runTurn` (`cursor-cli.adapter.ts:326-402`) and hit the one redacting catch
  — confirmed by reading the surrounding `try` block, not just the diff hunk.
- `run.cancel()` failing is redacted and rethrown (`:439-455`), verified end-to-end by a
  spec that goes through the real adapter code path with a faked SDK, not a mock of
  `redactSecrets`/`summarizeCliSdkError` themselves (`cursor-cli.adapter.spec.ts:920-947`).
- `resolveApiKey()` (the injected secrets-store resolver) rejecting is caught in
  `resolveCursorApiKey` (`:192-201`) and reduced to a fixed debug line with no error
  detail — correct per the acceptance criterion, and pinned by a spec that puts the key
  inside the rejection (`cursor-cli.adapter.spec.ts:958-971`).
- `sdk.Cursor.models.list()` rejecting is swallowed silently (`:261-270`, pre-existing,
  unchanged) and pinned by a spec with the key in the rejection message
  (`cursor-cli.adapter.spec.ts:974-985`).

### 5. What is missing that the requirements never mentioned?

- The plan's evidence for "one helper vs. per-adapter fix" is honoured (optional third
  parameter, default `[]`), but no spec exercises `summarizeCliSdkError` with more than one
  secret through the *adapter* path (only the unit spec for `redactSecrets` covers multiple
  secrets). Low risk today since Cursor only ever has one live secret, but if a future
  adapter needs two (e.g. a key plus a session token) the multi-secret path is unit-tested,
  not integration-tested.
- No spec drives an error whose `.message` is empty/undefined-ish (e.g. `throw 'plain
  string with the key'` rather than `throw new Error(...)`) through the adapter's
  `runTurn`/`interrupt` paths — only `sdk-error-summary.spec.ts` exercises non-`Error`
  rejections directly. The adapter code correctly falls back to `String(error)` at both
  sites (`:388`, `:446`), so the logic is present; only the adapter-level spec coverage for
  that shape is absent. Minor gap, not a defect.

## Failure modes

### Original error identity lost on `run.cancel()` failure

- Trigger: `run.cancel()` rejects with an `Error` instance (real SDK behaviour).
- Symptom: none observable today — `describeError` only reads `.message`.
- Evidence: `cursor-cli.adapter.ts:454` (`throw new Error(detail)` unconditionally, was
  `throw error instanceof Error ? error : new Error(detail)`).
- Current handling: intentional, to keep the original stack (which embeds the unredacted
  message) from ever being constructed with the secret in it.
- Recommendation: none required; if a future consumer needs the vendor error's `.name` or
  `.code`, carry those fields explicitly onto the redacted `Error` (e.g.
  `Object.assign(new Error(detail), { code: (error as any)?.code })`) rather than
  rethrowing the original.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate** — `cursor-cli.adapter.ts:454`: unconditional `new Error(detail)` on
   `run.cancel()` failure discards the original error's type/extra properties even when no
   secret is present in the message. See Failure modes above. No current break; flagged for
   awareness.
2. **Moderate** — no adapter-level (integration) spec exercises `summarizeCliSdkError`/
   `redactSecrets` with more than one live secret simultaneously; only the pure-function
   spec does. Acceptable for Cursor's single-secret shape today.
3. **Minor** — `redactSecrets` (`sdk-error-summary.ts:34-47`) has no lower bound on secret
   length beyond the blank check, so a hypothetically very short key could over-redact
   unrelated text. Unreachable given how `secretRedactions` is populated
   (`cursor-cli.adapter.ts:313-324`); noted only for completeness.

## Data flow

1. `runTurn` resolves the Cursor key (`resolveCursorApiKey`, env first) — OK, guarded by
   `!apiKey` early return before any SDK call, so an absent key never reaches the SDK.
2. Key captured into closure-scoped `secretRedactions = [apiKey]` before any SDK call in
   this turn — OK; re-set on every `runTurn` invocation (initial turn and every
   `continue()`), so a rotated key on a later turn correctly replaces the list.
3. `agent.send`/stream/`Agent.create`/`Agent.resume` run inside the guarded `try` — OK, any
   throw lands in the one catch that redacts before logging or streaming.
4. Catch: `errorMessage` (redacted) → `this.logger?.error(..., { detail: errorMessage })` —
   OK, only the redacted string is passed, never the raw `error` object.
5. Catch: `summary = summarizeCliSdkError(error, 'Cursor', secretRedactions)` — OK; the raw
   `error` is passed in, but redaction happens inside `summarizeCliSdkError` on `.message`
   only, before the headline is cut and before the usage-limit check, so the marker
   survives truncation (spec-verified) and usage-limit wording is preserved (spec-verified).
6. `output.emit`/`segment.emit` receive only the already-redacted `summary` — OK.
7. `interrupt()` → `run.cancel()` catch: `detail` (redacted) is logged, then a **fresh**
   `Error(detail)` is thrown — OK for secret containment; loses original error identity
   (Moderate finding above).
8. `agent-message-router.service.ts:177-186` catches the rethrown error and calls
   `describeError(error)`, which reads only `.message` — OK, receives the redacted text.
9. `detect()`/`listModels()` failure paths: caught, nothing logged, fixed fallback returned
   — OK, matches the plan's explicit "today they log nothing, keep that" instruction, and is
   pinned by spec.

No step in this trace loses, duplicates, or reads a stale value with respect to the
redaction guarantee.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `redactSecrets(text, secrets)` literal-value replacement, fixed `[REDACTED]` marker | COMPLETE | none |
| `summarizeCliSdkError` optional 3rd param, default `[]`, Codex untouched | COMPLETE | none — Codex call site verified unchanged, spec pins it |
| Redaction runs before the headline is cut | COMPLETE | spec proves marker survives the 500-char cap |
| Cursor `runTurn` redacts log detail + summary | COMPLETE | none |
| Cursor `interrupt()`/`run.cancel()` redacts log + rethrown error | COMPLETE | original error identity lost as a side effect (Moderate, accepted) |
| Cursor `detect()`/`listModels()` never log the key | COMPLETE | pre-existing "log nothing" behaviour pinned, not changed |
| `fix-report.md` write-path trace | PARTIAL (by design) | UI half (`cursorApiKeyStored`/`cursorApiKeyEnvSet`) explicitly deferred to Batches 5/8, placeholders present |
| `cursorApiKeyStored`/`cursorApiKeyEnvSet` read-back (551 acceptance #4) | NOT IN SCOPE | correctly deferred, not silently dropped |

Implicit requirements not addressed: none found beyond what is already tracked as deferred
in `batches.md`/`fix-report.md`.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty/absent key | YES | `!apiKey` early-return before any SDK call or `secretRedactions` write | none |
| Key with regex metacharacters | YES | literal `split`/`join`, not regex | none |
| Key repeated multiple times in one message | YES | `split(value).join(marker)` replaces every occurrence | none |
| Multiple distinct secrets | YES (unit-tested) | loop over `secrets` array | only unit-level coverage, not adapter-level (Moderate #2) |
| Non-`Error` rejection (string/object thrown) | YES (helper-tested) | `String(error)` fallback at both call sites | adapter-level spec coverage for this shape is absent (Minor) |
| Key rotated between turns | YES | `secretRedactions` re-set at the top of every `runTurn` call | none |
| `run.cancel()` failure carries the key | YES | redacted, rethrown as fresh `Error` | loses original error identity (Moderate #1) |
| Codex two-argument call site | YES | default parameter `= []`; pinned by spec and unchanged diff | none |
| Very short/degenerate secret value | PARTIAL | no lower-bound check beyond blank | theoretical over-redaction only, unreachable in practice (Minor #3) |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the sole notable risk (loss of original error identity on
  `run.cancel()` failure) is deliberate, documented, and has no live consumer today.
- What a robust implementation would add: an adapter-level spec with two simultaneous
  secrets in scope (forward-looking, not required by 551); optionally carry `.code`/`.name`
  from the original `run.cancel()` error onto the redacted replacement for future
  consumers.
