# Code Logic Review - Batch 1d (TASK_2026_714_c8a2)

Reviewer: Claude (different family from the Codex implementer). Read-only. Scope: `git diff HEAD` of evidence-harness.ts, evidence-failure-notes.ts, evidence-harness.spec.ts, plus the surrounding runCase/RPC/approval code and evidence-frames.ts. No checks were run.

Verdict: APPROVED, 8.5/10. Blocking 0, Serious 0, Moderate 1, Minor 3.

## Answers to the five checks

1. experimentalApi scoping - OK. `initializeParams` (evidence-harness.ts:815-820) sets `experimentalApi: typeof approvalPolicy !== 'string'`. Non-granular policies are strings, so they keep the exact HEAD payload (`clientInfo` + `experimentalApi:false`). The only call site is :1294 and it passes `selected.approvalPolicy`. The spec asserts both branches with `toEqual`, so a `true` leaking into plan, auto-edit or yolo would fail the spec.
2. assertThreadApprovalPolicy fails closed - OK. evidence-harness.ts:822-835 throws unless the response is a non-null object with an own `approvalPolicy` deep-strict-equal to the expected value and `approvalsReviewer === 'user'`. Deep-strict equality rejects extra or missing granular keys, a different shape and a string. It is called at :1334, directly after `thread/start` and before `assertSafeSandbox`, `turn/start` (:1359) and the budget charge. TURN_CAP charging happens at `turn/start`, rpc.request :558. No branch skips the call for granular cases, because the guard is the same `typeof ... !== 'string'` test. Non-granular cases are not confirmed this way, which is unchanged from HEAD and acceptable. The message is in the failureMessages allowlist (evidence-failure-notes.ts:49), and the spec round-trips it through `recordCaseFailure`.
3. RPC allowlist - OK. The note source is the harness's own string `RPC error ${frame.error.code}` (:540). Server `message` and `data` are never put in the Error. The regex `^RPC error -?\d{1,6}$` is anchored, and JS `$` without the `m` flag does not match before a trailing newline. The spec covers trailing text, a 7-digit code, a `+` sign and `\n`. A non-integer or huge code (zod `z.number()` allows 1.5 or 1e21) falls back to the generic "unclassified error", which is safe. The `.exec(...)?.[0] === message` form is redundant but harmless.
4. New approval or evidence paths - none found.
   - The approval handler is untouched. A server request is still accepted only if `fixed` (an identity check with level ask) and the method is in `manifest.methods.serverRequests`. Otherwise it declines and aborts (:1158-1175).
   - A case cannot pass without evidence. The granular confirmation note is pushed only after the assertion succeeds. The "Initialize: experimentalApi=true" note is pushed before the request. That only states what was sent, so it is not evidence of success.
   - The removed note ("not confirmed by config/read") is replaced by a real confirmation, not a weaker one.
   - A failed assertion happens after `thread/start` but before any charged turn, so it costs 0 turns. The orphan thread lives only in the temp CODEX_HOME, which is deleted.
5. Specs - mostly real. They call the real functions and use a negative control (reordered keys pass, `rules:false` fails). The note-recording test goes through `recordCaseFailure`. Gap: nothing tests the call-site ordering (assert before `turn/start`) or that runCase sends `initializeParams`. That is covered only by reading the code. See M1.

## experimentalApi and the strict envelopes (risk for run 6b)

Low-to-moderate risk, and it fails closed.

- The strict zod schemas (evidence-frames.ts:13-38) constrain only top-level keys: `jsonrpc`, `emittedAtMs`, `id`, `method`, `params`, `result` and `error`. `params`, `result` and `error.data` are `z.unknown()`. The experimental flag, as described in the schema, adds methods and fields inside params and results. It should not add top-level envelope keys, so the envelopes should not reject those frames.
- Extra notification methods only need to match `/^[A-Za-z0-9_./:-]+$/`, and unknown ones go to `onNotification`, which ignores what it does not handle.
- Real exposure is in the approval path. With experimentalApi on, approval requests may carry extra params or use a different method or shape, for example permission-style requests. `markerApprovalDecision` and `schemaDenial` would then fail the identity check, or the method would not be in `manifest.serverRequests`. The result is decline, interrupt and abort with "Approval rejected by safety gate". That is safe but could burn the one charged turn without evidence. Recommend the run 6b author expect the first-frame diagnostics (`rejectedFrameKeys`, command shape notes) to be the deliverable if that happens.
- Not verified: the actual 0.155.1 frame stream with the flag on. Only the thread/start probe exists (decisions.md).

## Findings

### Moderate
- M1 evidence-harness.ts:1333-1334 and spec: the ordering invariant (granular assert runs before `turn/start`) and the `initializeParams` wiring in runCase have no test. A refactor could drop the call and all specs would still pass. Suggest a small spec with a fake rpc, or a structural assertion.

### Minor
- m1 evidence-harness.ts:1289-1293: the "experimentalApi=true" note is added before `initialize` succeeds. If initialize fails, the note claims a declaration the server never accepted. Cosmetic.
- m2 evidence-harness.ts:1334: the thread/start check does not use the `-32600` knowledge to classify. A refusal now surfaces as "RPC error -32600", which is the intended allowlist outcome, so this is informational.
- m3 evidence-failure-notes.ts:86-88: the double check (`failureMessages.has || regex.exec()?.[0] === message`) can be a plain `regex.test(message)`. No behavior change.

No Blocking or Serious issues. The accepted stability risk (experimental API may change between codex versions) is already recorded in decisions.md and is not a code defect.
