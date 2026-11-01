# Code Logic Review - Batch 8p-3 (TASK_2026_714_c8a2)

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 3 |

Scope read: full diff of `libs/backend/codex-runtime/src`, `codex-resume-profile-error.ts`, `RuntimeContext.open`, `CodexRuntime.open`, `codex-thread-identity-store.ts`, the two production `buildCodexExecutionProfile` callers. No tests or builds were run, as instructed.

## 1. D23 fingerprint narrowing

The digest at `codex-execution-profile.ts:~283` now holds permissionLevel, sandboxPolicy and approvalPolicy. I traced what the dropped fields guarded.

- contextId, normalizedHome, providerId, workspaceId: checked on every open at `codex-runtime.ts:81-94`. The persisted store also checks them at `codex-thread-identity-store.ts:40-52`, and the chat host checks home, workspace and provider at `codex-chat-host-ports.ts:427-433`. Covered.
- accountId: a label on the profile. It is not stored in `CodexThreadIdentity` or in the thread record. The credential boundary is `normalizedHome` (CODEX_HOME, verified against the spawned process at `codex-runtime.ts:328`), and that is still compared. The old fingerprint did not actually bind accountId to a stored thread either, because nothing but the fingerprint carried it. Not a regression of a security property, but see M2.
- consumer: the `input.resume` check in the builder (`codex-execution-profile.ts:233-250`) is the only place that compares consumer, accountId and cwd. Both production callers (`codex-chat-host-ports.ts:421`, `codex-runtime-composition.ts:440`) never pass `resume`, so that block is dead in production. Consumer still changes `approvalPolicy` (chat uses D14, others use the old mapping), so a chat thread reopened as a gateway thread at the same level gets a different fingerprint. The new spec proves this (gateway vs auto-edit). Covered through policy.
- cwd: for writable profiles `writableRoots: [cwd]` is inside `sandboxPolicy`, so a cwd change still moves the digest. The new spec proves it ("otherWorkspace"). For read-only profiles cwd is not in the digest, but nothing is writable there. The resume frame sends the current `cwd` plus `sandbox` mode (`codex-runtime.ts:~337-355`). No privilege is widened.
- lane: any lane with suppressedTools, maxTurns, maxBudgetUsd or explicitFullAccess is refused at `codex-runtime.ts:103-111`, and explicitFullAccess is refused at build time. A lane consumer also changes approvalPolicy through the non-chat mapping. Remaining lane fields are not enforced at this boundary anyway.

Result: no security-relevant hazard. All privilege-bearing inputs are either in the digest or compared separately. Optional hardening is M2.

## 2. Resume re-sends instructions

Confirmed. `open` builds `baseInstructions` (systemPrompt) and `developerInstructions` (developerPrompt, outputStyle, instruction sources) once and spreads the same `params` into `thread/resume` (`codex-runtime.ts:337-357`). The spec at `codex-runtime.spec.ts:1632-1675` asserts both on the resume frame.

The test resumes with the same prompts it started with. It therefore proves "resume carries instructions", not "a changed prompt is accepted and applied". See M1.

## 3. Typed error module

- `codex-resume-profile-error.ts` is a clean leaf module, with no circular import with `codex-runtime.ts`. The constants are exported. The barrel exports class, guard and both constants.
- The guard is a direct `instanceof`. The spec asserts that a wrapper with `cause` is NOT recognised. The consumers at `chat-session.service.ts:625-629` and `codex-chat-adapter.ts:787-789` still match on `name` and `code` strings. This is acknowledged as a later batch. Those strings equal the constants (`'resume-profile-changed'`), so behaviour is unchanged until migration. Minor: until then the single-source claim in D23 is not true.
- The class moved out of `codex-runtime.ts`. No code outside `codex-runtime/src` imports it from there (grep), so nothing breaks.
- A duplicated module instance (two bundled copies) would defeat `instanceof`. This is minor, and the later consumers should keep the code check as a fallback.

## 4. M1 emitFollowUpRejected

- Edit follow-up path (`codex-runtime.ts:283-286`): same guard as before (closed state or already-terminal turn means no emit) and same event shape. The helper (`:659-674`) builds the same identity spread, sequence 0, code, message and `retryable: true`. Behaviour is unchanged.
- User-input path: emits only for `kind === 'user-input'`, and only when steer is rejected (`:707-708`) or returns a different turn (`:699`). It runs inside `serialize` after the live-turn check at `:683-689`. After a terminal or close it warns `turn-ended` and returns without emitting. The helper also re-checks `terminalTurns` after the awaited steer, so a rejection arriving after the terminal event is suppressed (the spec covers this). Denial feedback is unchanged (it only warns).
- Double emit: each steer produces one outcome (`!==` branch or catch, not both). I found no double emit.
- Ordering risk: the check is point-in-time, and the emit is synchronous after the check. JS is single-threaded, so there is no interleaving. A rejection that lands before the terminal event is emitted before it, which is correct.
- Gap (Minor, M3): a non-rejection failure (transport error or timeout, `'failed'` cause) on a user-input steer only warns. The user gets no event, while "refused" and "different-turn" do. This is arguably intended because `onFailure` covers fatal transport errors, but the answer is silently dropped from the user's view.

## 5. Spec changes

- `contextId` fingerprint now equal: justified, because contextId is checked separately (`:81-94`) and the runtime spec still covers identity mismatch.
- Prompt, outputStyle and instructionSources changes no longer change the fingerprint: this is the intended D23 change. It is replaced by positive assertions for permission, sandbox, approval and cwd.
- The `permissionLevel: 'auto-edit'` patch was moved out of the "unchanged" list into a dedicated test. Correct.
- The runtime spec switch to constants and the guard is neutral. The strict `message` assertion is replaced by the constant, which is a smaller check but the module is trivially covered.
- The old accountId, consumer and lane fingerprint sensitivity was dropped without a replacement test. Policy coverage is asserted only for consumer (gateway). No regression is hidden, but the spec no longer documents that accountId and lane do not matter.
- The `events` subscription added to the existing denial-feedback test and the no-error assertions strengthen it.

## Findings

### Moderate

- M1 `codex-runtime.spec.ts:1632-1675`: add a resume case where systemPrompt or developerPrompt differ from the start values, and assert `thread/resume` carries the new text and no `CodexResumeProfileChangedError` is thrown. That is the actual D23 behaviour and it is untested end to end (the builder spec tests the fingerprint, the runtime spec tests the same-prompt resume).
- M2 `codex-runtime.ts:81-94` and `codex-thread-identity-store.ts:40-52`: `accountId` and `consumer` are in neither the stored identity nor the digest. Today `normalizedHome` plus approvalPolicy cover the real hazards. If two accounts ever share a CODEX_HOME, or two consumers share the same policy, a thread can be resumed across them silently. Minimal addition if wanted: put `consumer` in the digest (one field, no prompt drift risk), or add a short comment at `codex-execution-profile.ts:~281` stating that home is the account boundary. Not required to merge.

### Minor

- M3 `codex-runtime.ts:701-709`: a non-rejection steer failure on a user-input answer produces no user-visible error. Consider emitting for `'failed'` too, or document why not.
- M4 `chat-session.service.ts:625-629` and `codex-chat-adapter.ts:787-789`: still string-match on name and code. Migrate to `isCodexResumeProfileChangedError` with the code as a fallback.
- M5 `codex-execution-profile.ts:233-250`: the `input.resume` identity block is unused by production callers, and it still enforces consumer, accountId and cwd. Either wire it to a real caller or note it as test-only, so the D23 comment does not imply those fields are checked on resume.

## Five logic questions (short)

1. Silent failure: user-input steer transport failure (M3).
2. Unexpected action: resuming an old thread under a changed cwd inside the same workspace applies the new cwd (read-only only), with no refusal.
3. Wrong answer: none found. Every fingerprint change maps to a policy change.
4. Dependency failure: a steer refused or rerouted is handled, and the terminal event ordering holds.
5. Missing: the test in M1, and documented ownership of account identity (M2).

Recommendation: APPROVE. Confidence HIGH on the fingerprint and emit logic, MEDIUM on cross-package consumers (not read in full, since they change in a later batch).
