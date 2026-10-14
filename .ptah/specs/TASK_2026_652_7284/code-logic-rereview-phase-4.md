# Code logic re-review — Phase 4 fix (Batch 23, diff `d6938d874..4d5432f76`)

Reviewer: code-logic-reviewer (Phase 4 re-review, scoped to the fix commit only). Scope:
`git diff d6938d874..4d5432f76` — exactly two files:
`libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts` (+179/−136) and
`wizard-generation-rpc.handlers.spec.ts` (+115). Read-only re-review: no source edited, no
build/test/lint/typecheck run (per the re-review rule); the working-tree copies of both files are
byte-identical to `4d5432f76` (verified: `git diff --stat 4d5432f76 -- <both files>` is empty).
Both changed files were read whole, plus the unchanged collaborators the fix leans on
(`wizard-generation-run.supervisor.ts`, read whole), the first-review
`code-logic-review-phase-4.md`, `batch-23-report.md`, and the "Phase 4 review disposition"
(`batches.md:1591-1628`). Verification evidence below is static trace with file:line, plus the
implementer's recorded verification tails (`batch-23-report.md:23-53`: prettier, project
typecheck+lint, focused Jest 65/65 green) — not re-run by this reviewer, per the read-only rule.

## Per-finding status

| #   | First-review finding (severity)                                                                                                                       | Status                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | TOCTOU between the `isActive` guard and `void this.runs.run(...)`: orphan `running` checkpoint, discarded rejection, false `success: true` (Moderate) | **FIXED**                              | Reservation taken synchronously before the first await (`wizard-generation-rpc.handlers.ts:250`, first await `:286`), released through the outer `finally` on every path (`:432-434`); retry honours it (`:804`); pre-launch re-check finalizes the prepared checkpoint `failed` and returns the typed in-progress error (`:356-363`); the launch promise is observed end-to-end (`:373-411`). Full trace below.                                                                                                              |
| 2   | Degradation catches log no cause (Minor)                                                                                                              | **PARTIALLY FIXED** (as ruled)         | The RPC freshness catch now binds the error and logs a content-free cause — `{ cause: error instanceof Error ? error.name : typeof error }` (`:287-293`), exactly the descriptor the first review suggested (`code-logic-review-phase-4.md:85-87`). The other two flagged sites (`content-generation.service.ts:621-624`, `enhanced-prompts.service.ts:1074-1077`) are in agent-generation, untouched by this diff; the disposition records them rather than fixes them (`batches.md:1601`). Status confirmed, not re-raised. |
| 3   | Specs' `resolveAuthorizedAnalysisDir` mocks are identity-style (Minor)                                                                                | **NOT FIXED — recorded, out of scope** | Not in this diff; the disposition records it (`batches.md:1602`). Not re-raised (outside the fix commit).                                                                                                                                                                                                                                                                                                                                                                                                                     |

## The seven confirmations (all pass)

1. **Reservation before the first await, released on every path — PASS.** The guard
   (`:240-249`) reads `this.runs.isActive || this.submitReserved`; the reservation is set at
   `:250` in the same synchronous section (between the callback entry `:227` and `:250` there is
   only `parse` `:228`, the selection check `:231-239` and the guard — all synchronous; the
   first await is `freshness.getStatus` at `:286`). The outer `try` at `:251` carries the
   `finally` at `:432-434` that clears it. Every exit after `:250` is inside that try:
   no-workspace return `:254`, `authorizeAnalysisDir`'s `RpcUserError` `:260-263` (propagates to
   the RPC framework — typed, per boundary spec `wizard-generation-rpc.handlers.spec.ts:747-760`
   — and the finally still releases), `resolveService` throws `:274-281` → inner catch `:413-431`,
   no-resumable return `:324`, all-current `completeWithoutWork` return `:332` (reservation
   correctly held through the awaited finalize+broadcast at `:331`, released at `:432`),
   pre-launch-gate return `:358-362`, success `:412`, and any throw. No path sets the flag
   outside `:250` or clears it outside `:433`.
2. **Retry honours the reservation; no deadlock, never left set — PASS.** `wizard:retry-item`'s
   guard is now `this.runs.isActive || this.submitReserved` (`:804`), reusing its existing
   in-progress response. Retry never writes `submitReserved` (the only writer is the submit
   handler's `:250`/`:433`), so it cannot leave it set. No circular wait exists: a refused
   submit/retry returns immediately (nothing queues on the reservation), and retry's own
   `runs.run` is awaited (`:840`) inside the supervisor, whose watchdog aborts at the timeout
   (`wizard-generation-run.supervisor.ts:208-213`) and whose `finally` always clears the
   controller (`:275-278`). Between retry's guard `:804` and its `run` call `:840` there is no
   `await` (`parse`, `getWorkspaceRoot`, `resolveService`, `resolveWebviewManager`, the options
   literal are all synchronous), so retry opens no TOCTOU window of its own.
3. **No unhandled rejection; the launch promise is observed — PASS.** `void this.runs.run({...})`
   (`:373-390`) is now chained: `.catch(async (error) => { try { logger.error('RPC:
wizard:submit-selection launch failed') `:393`; sentryService.captureException(error,
{ errorSource: 'WizardGenerationRpcHandlers.registerSubmitSelection' }) `:394-402` } finally
{ await checkpoints.finalize(prepared.location, 'failed') } })` `:391-406`, then a terminal
   `.catch` `:407-411` whose empty body cannot throw, so the `void`-discarded tail promise can
   never reject. The `finally` at `:403-405` guarantees the checkpoint is finalized `failed`
   even when logging or Sentry itself throws. Rejection semantics for the caller: the handler
   returns `success: true` only at `:412`, after `runs.run` has been entered; the supervisor's
   only rejecting branch is its synchronous active-check (`supervisor:201-203`), and from the
   submit path that branch is unreachable — the only two launch sites in the repository are
   `:373` (submit) and `:840` (retry) (verified by search; the only other constructor of the
   supervisor is `wizard-generation.preview-fidelity.spec.ts:394`, a spec), both of which are
   gated by `submitReserved` while preparing, and the pre-launch gate `:356` re-checks with no
   intervening await. A post-launch internal throw inside the supervisor (e.g.
   `buildCompletePayload`, `supervisor:254-261`, escaping its `try/finally` at `:221/275` with
   no catch) is now observed by `:391` instead of discarded. On no reachable path does a caller
   get a false `success: true` that a still-live rejection contradicts: pre-response, every
   refusal path returns `success: false`; post-response, the completion broadcast carries the
   real outcome (fire-and-forget design, pinned by the pre-existing spec
   `wizard-generation-rpc.handlers.spec.ts:993-1005`). The residual "caller got `success: true`,
   run then rejected, no completion broadcast" is the disposition's own recorded observation
   (`batches.md:1620-1624`) and is unreachable from the submit path today — confirmed, not
   re-raised.
4. **Pre-launch active-run re-check — PASS.** `:356-363`: with no `await` between the check
   (`:356`) and the launch (`:373`; only the assignments `:364-365` and `logger.info` `:366-372`
   intervene), a still-active supervisor triggers `await checkpoints.finalize(prepared.location,
'failed')` (`:357`) and returns the same typed in-progress error string as the entry guard
   (`:358-362` vs `:244-248`). The reservation is held across the awaited finalize and released
   at `:433`. Unreachable in the current wiring (per the launch-site analysis above) but
   safe-sided and harmless — belt-and-braces exactly as the disposition ordered
   (`batches.md:1610-1612`).
5. **Semantics preserved; `last*` set only when launch proceeds — PASS.** `createFresh`'s input
   (`:312-322`: threshold, variableOverrides, model, analysisData), `prepareResumedRun`
   (`:443-460`), `buildOptions` (`:971-994`: `userOverrides: prepared.agentIds`, checkpoint
   inputs, trusted-dir gating) and the retry handler body are unchanged in this diff modulo
   indentation; retry alone gained the reservation term at `:804`. `lastGenerationOptions` and
   `lastCheckpoint` are now assigned at `:364-365`, after the `:356` gate, so they point only at
   a run that actually launched. The only readers are `wizard:retry-item`'s
   `this.lastCheckpoint` / `this.lastGenerationOptions` (`:829-831`); retry's contract is "reuse
   the last launched run" (spec `:1736-1774`), which the new ordering enforces exactly. Under
   the old ordering the flags could reference a run whose launch was discarded (the Finding-1
   orphan); nothing could have relied on that — it was the bug. The `completeWithoutWork`
   (`:330-333`) and no-resumable (`:323-329`) early returns precede the assignments in both old
   and new code, so those paths are unchanged.
6. **Finding-2 log change logs only name/type — PASS.** `:290-293` logs
   `{ cause: error instanceof Error ? error.name : typeof error }` — a class name (e.g.
   `TypeError`) or a `typeof` string. No message text, no paths, no manifest content, no
   secret-bearing values; the degradation fallback itself is unchanged (`:294-300`, same
   `stale/unreadable` shape as pre-diff).
7. **The four new specs genuinely exercise the behavior — PASS.** The harness drives the REAL
   `GenerationCheckpointService` (`spec:476-479`) and REAL `GenerationRunSupervisor` (`:480`)
   over the stateful in-memory storage fake (`:330-376`), so assertions read derived state, not
   mock defaults:
   - `:880-915` (reserves while freshness pending): `getStatus` is blocked on a manual promise
     via `mockImplementationOnce` (`:886-895`); the first submit is parked inside the handler's
     first await (`handlers:286`), the second submit is issued concurrently and must be refused
     by the reservation alone (the supervisor is NOT active at that moment); the test also pins
     one manifest write and one orchestrator call (`:913-914`), then normal completion after
     release. Pre-fix, the second submit would pass the guard and double-launch — the
     assertions fail on the old code.
   - `:917-935` (release after missing resume checkpoint): the first call returns via the
     `!prepared` early return (`handlers:323-329`) and the second submit's success proves the
     `finally` released the flag — without it the guard at `:240` would refuse the second call.
   - `:937-961` (rejected launch): `jest.spyOn(h.runs, 'run').mockRejectedValueOnce(...)`
     (`:939-941`) makes the launch reject after the caller already holds `success: true`;
     `await settle()` (`:949`) flushes the async catch chain, and the test asserts the persisted
     manifest lifecycle is `failed` (`:952`, read back through the real checkpoint service →
     fake `updateGenerationManifest` at `spec:356-371` — the create wrote `running`, so `failed`
     can only come from the new catch's `finalize`), plus the exact fixed log line (`:954-956`)
     and the Sentry capture with `errorSource` (`:957-960`). An unobserved rejection would
     surface as an unhandled rejection and fail the run (implementer's focused run: 65/65,
     `batch-23-report.md:42-51`).
   - `:963-991` (retry refused while preparing): the submit is parked in `getStatus` holding
     the reservation, and retry's refusal (`:987-988`) is produced by the new
     `|| this.submitReserved` term at `handlers:804` — the supervisor is not active yet, so the
     old guard alone would let the retry through.

No TODO/PLACEHOLDER/STUB markers, no empty method bodies, and no mock standing in for the
logic under test were found in either changed file (both read whole).

## New findings introduced by this diff

| #   | Severity | file:line                                                                                            | Issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | -------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Minor    | libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts:407-411 (with :403-405) | The terminal `.catch` absorbs any rejection from the first catch — including a `checkpoints.finalize` failure, not just a "secondary reporting failure". If `finalize` itself throws (e.g. a checkpoint write failure), the manifest stays `running` on disk and nothing logs that second failure; the marker's justification ("…its checkpoint finalized") is inaccurate in exactly that case. Reachability is a double fault (a `runs.run` rejection — unreachable from the submit path today, possible only via a supervisor-internal throw such as `buildCompletePayload`, `supervisor:254-261` — AND a checkpoint write failure), and a user can still recover via `resume: true`, which normalizes a stale `running` record (`spec:1416-1421`, `handlers:443-460`). Suggested hardening: log a content-free warn inside the terminal catch, mirroring the supervisor's own pattern for a failed post-settlement step (`supervisor:265-271`). Recorded, not fix-round material — consistent with how the disposition treats Minor items; the one fix round is spent (`batches.md:1626-1628`). |

## Five logic questions

1. **Silent failure?** N1 above — the terminal catch can discard a cleanup failure whose
   symptom (an orphaned `running` checkpoint) is exactly the class Finding 1 targeted, on a
   double-fault path only. Everything else the diff touched is now observed: launch rejection
   (`:391-405`) logs, captures and finalizes; freshness failure degrades with a cause (`:287-301`).
2. **Unexpected user action?** A double-clicked "Generate" or a retry arriving while a submit
   prepares is now deterministically refused (`:240-248`, `:804`) instead of racing — exercised
   by `spec:880-915` and `spec:963-991`.
3. **Wrong answer rather than error?** None found on the changed paths. The freshness
   degradation fallback (`:294-300`) is byte-identical in behavior to pre-diff; only the cause
   descriptor was added. Refusals all return the typed in-progress error string.
4. **Dependency fails, hangs, or mis-shapes?** `getStatus` throwing degrades to `stale/unreadable`
   with the cause logged (`:287-301`); enhanced-prompt/MCP/plugin failures keep their pre-existing
   warn-and-continue handling (`:919-953`). A hung awaited dependency (an fs read that never
   settles) would hold the reservation and refuse submits/retries until restart — inherent to
   the reserve-around-prepare design the first review itself prescribed
   (`code-logic-review-phase-4.md:57-60`); noted as an observation, not scored. A mis-shaped
   `SettledGenerationRun` that makes `buildCompletePayload` throw now lands in the observed
   `:391` catch instead of an unhandled rejection.
5. **Missing requirement?** None. All five required-fix items of `batch-23-report.md:10-14` are
   present and verified above; the four prescribed regression specs exist and are genuine.

## Evidence and checks performed

- Full read: both changed files (handler 1212 lines, spec 2220 lines) and the supervisor (298
  lines); diff inspected hunk by hunk against the pre-fix behavior.
- Atomicity trace: no `await` between guard `:240` and reservation `:250`; none between gate
  `:356` and launch `:373`; none between retry guard `:804` and `run` `:840`. The supervisor
  assigns its controller synchronously on entry (`supervisor:204-205`) before its first await
  (`:225`), and the reservation is released in the same synchronous tail of the handler
  (`:412` → `:432-434`), so there is no instant where both guards are down while a run is
  preparing or running.
- Launch-site census: `runs.run(` appears at `handlers:373` and `handlers:840` only; the
  supervisor's only other references are its definition and one spec construction
  (`wizard-generation.preview-fidelity.spec.ts:394`) — which is why the `:356` gate and the
  `:201-203` rejection branch are unreachable from submit today.
- Working-tree fidelity: both reviewed files are identical to `4d5432f76` (empty
  `git diff --stat 4d5432f76 -- <files>`).
- Not re-run (read-only re-review): builds, tests, lint, typecheck, `ptah_get_diagnostics`. The
  implementer's recorded evidence (prettier, `typecheck,lint` for `@ptah-extension/rpc-handlers`,
  focused Jest 65/65, degradation-audit baseline 1 ok — `batch-23-report.md:23-88`) is treated
  as the verification record; my static trace of every changed path is consistent with it.
- Remaining uncertainty: none material on the changed paths. The behavior of
  `GenerationCheckpointService.finalize` was verified through its real instance inside the spec
  harness rather than by a direct read of that (unchanged) file; the `:937` spec's persisted
  `failed` lifecycle is the evidence, and no claim in this review rests on it beyond that.

## Score and verdict

**Score: 8 / 10.** Every item the disposition ordered is present and statically verified
end-to-end: a reservation with no await before it and a release on every exit, a retry that
honours it, an observed launch promise with a `failed` checkpoint on rejection, a gap-free
reservation→supervisor handoff, and four regression specs that fail on the pre-fix code rather
than passing on mock defaults. What keeps it from 9-10: the one new Minor (N1 — the terminal
catch can silently discard a cleanup failure its own marker claims was already done) and the
two first-review Minors still open (Finding 2's two agent-generation sites, Finding 3's spec
mocks — both recorded by ruling, outside this commit). What keeps it above 5-7: no blocking or
serious defect, no swallowed error on a likely path, no behavior drift in ids/overrides/
checkpoint/resume/retry semantics, and the concurrency window the first review flagged is
closed by construction rather than narrowed.

**Verdict: APPROVED** — Finding 1 is fixed and verified; Finding 2 is partially fixed exactly as
the disposition ruled, and Finding 3 remains recorded. N1 (Minor) is recorded for a future
backend batch, consistent with the disposition's handling of Minor items and the spent fix
round (`batches.md:1626-1628`).
