# Code Logic Review — `TASK_2026_555` Batch 5

Scope: 551 read-back fields (`cursorApiKeyStored`, `cursorApiKeyEnvSet`) + migration of the
rejecting-write spec (S1b). Files reviewed via `git diff`:

- `libs/shared/src/lib/types/rpc/rpc-agents.types.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.migration.spec.ts` (new)

Same-side disclosure: most of this batch was written by a Glm CLI lane and finished by a
backend-developer subagent; this review is an independent in-process pass over the same
side of the work, not a cross-vendor review.

## Summary

| Metric              | Value    |
| -------------------- | -------- |
| Overall score        | 8/10     |
| Assessment           | APPROVED |
| Blocking issues      | 0        |
| Serious issues       | 0        |
| Moderate issues      | 2        |
| Failure modes found  | 1        |

## Five logic questions

### 1. How does this fail silently?

No silent-failure path was found in the changed logic itself. `getCursorApiKeyStatus()`
(`agent-rpc.handlers.ts:1057-1064`) computes three booleans from two independent reads
(`process.env['CURSOR_API_KEY']`, `authSecrets.hasProviderKey('cursor')`) and returns all
three; there is no branch that swallows one of them into a default that looks like a real
reading. `configured = envSet || stored` is derived, not read, so it cannot drift from its
inputs.

The one place a failure could be swallowed — `hasProviderKey('cursor')` rejecting — is not
swallowed locally, but it is also not new: the call sits inside the `try { … } catch (error)
{ … }` of the `agent:getConfig` handler itself (`agent-rpc.handlers.ts:174-` /catch not shown
in this diff but present pre-existing in the surrounding method), so a rejection surfaces as
an RPC error envelope, not a fabricated `false`. This is unchanged behaviour, not a
regression — see Failure modes below for the residual gap.

### 2. What user action produces unexpected behaviour?

None identified for the read-back fields: setting/clearing the stored key and setting/
unsetting `CURSOR_API_KEY` in any combination produces the matrix asserted in
`agent-rpc.handlers.set-config.spec.ts:300-361` (none / legacy-ignored / secret-only /
env-only / blank-env / both), and I re-ran both Batch 5 spec files directly
(`npx jest agent-rpc.handlers.set-config.spec.ts agent-rpc.handlers.migration.spec.ts` from
`libs/backend/rpc-handlers`) — 2 suites, 21 tests, all passing.

For the migration path, a user whose settings write is rejected (e.g. `EACCES`) now gets a
handler that logs a warning and leaves the migration flag unset, so a later launch retries
the same keys — matches the plan's stated failure behaviour
(`implementation-plan.md:199-201`: "the caller sees a rejection... no settings value or
secret in the error").

### 3. What input data produces a wrong answer?

Considered and ruled out:
- Env var containing only whitespace (`' \t '`) — correctly treated as absent
  (`envKey.trim().length > 0`), asserted at `set-config.spec.ts:344-350`.
- Env var with leading/trailing whitespace around a real value (`' env-test-key '`) — treated
  as set; the raw (untrimmed) value is never returned, and the test asserts
  `JSON.stringify(result)` does not contain the key text at all
  (`set-config.spec.ts:328-338`).
- Legacy plain setting `ptah.provider.cursor.apiKey` — correctly ignored by both the new
  fields and the existing `cursorApiKeyConfigured`, and the test also asserts
  `getConfiguration` was never called for that key (`set-config.spec.ts:302-317`).

No case was found where the three booleans could disagree with the ground truth used to
produce them, given the mock harness.

### 4. What happens when a dependency fails?

Two dependencies exist on this path:
- `authSecrets.hasProviderKey('cursor')` (secrets store) — if it rejects, `getConfig` today
  rejects and the outer handler's existing catch turns it into an RPC error envelope. This is
  unchanged from before the batch (the pre-image also awaited `hasProviderKey` unconditionally
  when the env var was unset). No new dependency-failure path was introduced.
- `workspace.setConfiguration` inside `migrateAgentOrchestrationSettings` — this is exactly
  the scenario the new migration spec targets. Both the lane's case (`register()` does not
  throw, warning logged, flag not written) and the added case (the private method's promise
  itself resolves, never rejects) are exercised and pass. I confirmed the call site: `register()`
  calls `void this.migrateAgentOrchestrationSettings()` (`agent-rpc.handlers.ts:136`), and the
  method's own `try/catch` (`:1093-1122`) sets the flag only inside the `try`, after all writes
  succeeded, so a mid-loop rejection cannot leave a partially-migrated state that is later
  marked "done."

### 5. What is missing that the requirements never mentioned?

- The 551 task also asks for a UI-side comparison (`cursorApiKeyStored` instead of
  `cursorApiKeyConfigured`) and a UI note when the env var wins — both are explicitly deferred
  to Batch 8 (`batch-5-report.md:47`), consistent with `batches.md` scoping this batch to the
  backend half only. Not a gap in this batch.
- No spec exercises `hasProviderKey` rejecting inside `getCursorApiKeyStatus` specifically (as
  opposed to the pre-existing outer catch). Given this is unchanged behaviour from before the
  batch, I record it as a residual/moderate item rather than a regression.

## Failure modes

### Secrets-store rejection during `agent:getConfig`

- Trigger: `authSecrets.hasProviderKey('cursor')` rejects (e.g. keychain unavailable).
- Symptom: `agent:getConfig` returns an RPC error envelope instead of a config object; the UI
  presumably shows a load failure for the whole settings panel, not just the Cursor card.
- Evidence: `agent-rpc.handlers.ts:1057-1064` (unconditional `await this.authSecrets
  .hasProviderKey('cursor')`, no local try/catch) inside `registerGetConfig`'s outer try/catch.
- Current handling: unchanged from the pre-image; the same unconditional call existed before
  (previously skipped only when the env var was set). Batch 5 made the call unconditional to
  populate `stored` even when `envSet` is true, which slightly *increases* exposure to this
  failure mode (one more code path always hits the secrets store instead of short-circuiting).
- Recommendation: low priority — no user-visible change in class of failure (still an RPC
  error, still recoverable by retry), but worth a follow-up spec or a local
  `.catch(() => false)` with a logged warning if the team wants `getConfig` to degrade
  gracefully rather than fail whole.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate — three non-Batch-5 fixtures build `AgentOrchestrationConfig` without the two
   new required fields.**
   - `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.spec.ts:23-33`
     (`function makeConfig(...): AgentOrchestrationConfig { return { ... } }`, no `cursorApiKeyStored`/`cursorApiKeyEnvSet`, no cast).
   - `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:159`
   - `libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts:160`
   - I verified the report's claim directly rather than taking it on faith: `npx nx typecheck
     tribunal-panel` passed (exit 0) because that target runs against `tsconfig.lib.json`,
     which excludes spec files, so the missing-field object literal is never type-checked by
     that command. I also ran the affected spec (`npx nx test tribunal-panel
     --testPathPatterns=tribunal-discovery.service.spec`, 25/25 passing) and confirmed the
     project's Jest transform is esbuild-based (no type-check on transform), so the missing
     fields do not fail at test time either. The report's "nothing breaks today" is accurate
     and independently confirmed, not merely asserted. This is real, tracked debt (three
     fixtures silently under-typed against the interface) but not a build/test risk today, and
     it is correctly deferred to whichever batch next touches those files.
2. **Moderate — no direct unit coverage for `hasProviderKey` rejecting inside
   `getCursorApiKeyStatus`.** See Failure modes above. Not a regression, but the new dual-read
   shape (always calling the secrets store) is a reasonable place to pin the degrade-or-fail
   decision with a spec once the team decides on the desired behaviour.
3. **Minor — JSDoc precision.** The updated JSDoc on `getCursorApiKeyStatus`
   (`agent-rpc.handlers.ts:1049-1055`) is accurate and matches the acceptance criteria's
   wording ("Only booleans leave this method; the raw key is never read or returned") —
   flagging as a positive, no action needed.

## Data flow

1. `agent:getConfig` invoked → `registerGetConfig`'s handler runs inside its existing
   try/catch (`agent-rpc.handlers.ts:174-`). OK.
2. `getCursorApiKeyStatus()` reads `process.env['CURSOR_API_KEY']` synchronously and awaits
   `authSecrets.hasProviderKey('cursor')` once. OK — single read, matches the report's claim
   of removing the duplicated secret-store read.
3. `envSet` and `stored` are returned as-is; `configured` is derived (`envSet || stored`). OK
   — no path re-derives `configured` from a stale copy.
4. The three fields are copied verbatim into the `AgentOrchestrationConfig` result literal
   (`:201-203`). OK — no re-computation, no truncation.
5. Result serialized over RPC. OK — verified by the `JSON.stringify(result)` assertion in the
   env-only spec that the raw key text never appears in the payload.
6. Migration: `register()` fires `migrateAgentOrchestrationSettings()` as a floating promise
   (`:136`). Method checks the idempotency flag, loops `KEYS_TO_MIGRATE`, skips keys already
   present in the workspace provider, writes missing ones, then sets the flag — all inside one
   `try`. A rejection anywhere in the loop skips the flag write and lands in the `catch`, which
   logs and returns normally (implicit `Promise<void>` resolution). OK — verified by both new
   spec cases and a direct read of the surrounding code.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| `agent:getConfig` returns `cursorApiKeyStored` (secret present) | COMPLETE | none |
| `agent:getConfig` returns `cursorApiKeyEnvSet` (env non-blank) | COMPLETE | none |
| Raw key never returned | COMPLETE | verified by `JSON.stringify` assertion, not just by inspection |
| `migrateAgentOrchestrationSettings` survives a rejecting write, logs, does not reject `register()` | COMPLETE | none |
| Migration flag not written on failure (retry next launch) | COMPLETE | asserted in both new spec cases |
| UI read-back switches to `cursorApiKeyStored` | DEFERRED (correctly, to Batch 8) | out of this batch's file list |
| `fix-report.md` for TASK_2026_551 | DEFERRED | plan assigns it to a later step per batch-5-report; not a Batch 5 file |

Implicit requirements not addressed: none found beyond the two deferrals above, both of which
are explicitly scoped out by `batches.md` and `batch-5-report.md`, not silently dropped.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Env var whitespace-only | YES | `.trim().length > 0` | none |
| Env var with real value + surrounding whitespace | YES | treated as set, raw value never returned | none |
| Both env and secret set | YES | new "both sources set" test case | none |
| Neither set + legacy plain setting present | YES | ignored, `getConfiguration` not called for legacy key | none |
| Secrets-store call rejects | NO (unchanged from pre-image) | falls through to outer handler catch → RPC error | whole `getConfig` fails instead of degrading; see Failure modes |
| Migration: all writes reject | YES | new case 2, resolves with one warning, flag untouched | none |
| Migration: one of several writes rejects | YES (existing case 1, single key) | loop aborts on first rejection via exception propagation, remaining keys not attempted | acceptable per plan ("logged... does not reject"); no case asserts *which* keys were or weren't written when failure occurs mid-loop with multiple keys — minor coverage gap, not a defect |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only real residual risk is that `getCursorApiKeyStatus` now
  always touches the secrets store, so a keychain outage fails the entire `agent:getConfig`
  call rather than just the Cursor card — pre-existing shape, not introduced here.
- What a robust implementation would add: (1) a spec pinning `getConfig`'s behaviour when
  `hasProviderKey` rejects, so the current "fail whole vs. degrade" choice is explicit rather
  than incidental; (2) updating the three under-typed fixtures the next time those files are
  touched, as the report already flags; (3) a migration-loop spec with more than one
  legacy key present, asserting exactly which keys got written before the rejecting one
  aborted the loop.
