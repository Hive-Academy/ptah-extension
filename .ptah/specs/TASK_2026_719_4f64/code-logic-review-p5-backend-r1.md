# P5 backend fix-round logic re-review

Verdict: REVISE
Score: 6/10

Original late-PID finding: Closed for retained, undisposed receipts: `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:505` now allows the owed kill after grace; receipt-close and null-PID paths suppress it (`:497`, `:529`). Disposal introduces the separate regression below.
Original environment/key finding: Closed: `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:177` freezes one allowed environment, derives its key at `:178`, stores both at `:185`, and passes that environment through certification to the child (`:196`, `:218`).

## New finding

**Serious — disposed receipt permits a late kill after the child has closed.**
Evidence: `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:182` disposes the receipt by detaching listeners without setting `seen`; `:190` also ignores closure after disposal. The new guard at `:505` therefore treats a disposed receipt as an open child indefinitely. The close listener removed by `:474` cannot correct that state. Disposal is reachable through `libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:149` and `:274`.
Failure scenario: defer the PID, let timeout and grace expire, dispose the reader/receipt, let the child close, then deliver the positive PID. `receipt.closed` remains false and `:507` requests SIGKILL despite the intervening close. If that PID has been reused, an unrelated process can be killed: `libs/backend/platform-core/src/utils/process-tree-reaper.ts:65` targets the numeric PID on Windows; `:78` and `:81` target the process group/PID on POSIX. The old settled guard did not issue this late kill. This is a static ordering trace, not a runtime reproduction or a claim that PID reuse is common.
Required fix: preserve termination observation independently of subscriber/receipt disposal while a deferred PID can still trigger a kill, or use equivalent process-identity-safe cancellation. Add a deterministic dispose -> close -> PID test that expects no kill, alongside dispose -> still-live -> PID. Merely marking disposal as closure would reintroduce the leaked-child defect.

## Ordering and regression checks

- PID before grace: `claude-account-command.ts:487` admits only one stop handler; its single promise callback issues one tree-kill request (`:496`). Subsequent stop signals cannot schedule another. Close before PID settles without a receipt and suppresses the kill (`:530`, `:505`).
- PID after grace, open receipt: kill is issued (`:493`, `:505`). After grace with an already closed, undisposed receipt: `:529` calls `markClosed`, whose getter exposes `seen` (`:173`, `:191`), and the kill is skipped. The getter is correct for observed closure, but deliberately ceases tracking after disposal; it is unsafe as the new guard's sole lifecycle authority.
- Null PID: before grace it establishes termination; after grace it closes the retained receipt without killing (`claude-account-command.ts:497`). A disposed receipt ignores `markClosed` (`:190`), but this branch still issues no kill.
- Cache clearing has not moved relative to the blocked-read check: `claude-ambient-login-status.ts:178` calls the extracted `keyOf` before checking receipts at `:179`, just as the former `currentKey` did. `currentKey` still snapshots the live environment and clears a mismatched cache (`:255`, `:259`); its read/dispose/finish callers retain their semantics (`:128`, `:147`, `:229`).
- Same-key joins share the active snapshot (`claude-ambient-login-status.ts:161`); refreshes share one queued follow-up (`:172`). Completion starts that follow-up with a fresh snapshot (`:235`, `:175`); obsolete attempts transfer callers through the same path (`:247`). Blocked attempts do not spawn (`:179`). No additional environment/cache regression found in these paths.

## Regression-spec assessment

- `claude-account-command.ambient.spec.ts:121` deterministically gates PID delivery until fake timeout and grace have run. It fails on the old settled guard because the expected kill at `:131` never occurs.
- `claude-ambient-login-status.spec.ts:349` gates certification, changes A to B before releasing it, and asserts the child receives A (`:360`) before restoring A and asserting cached completion. The old implementation passes B and fails that assertion.
- These use explicit promises, fake timers and bounded microtask drains (`claude-account-command.ambient.spec.ts:30`, `:55`; `claude-ambient-login-status.spec.ts:13`, `:93`), not wall-clock races. The drain counts depend on implementation depth but not timing luck.
- The protective no-kill spec at `claude-account-command.ambient.spec.ts:136` also passes without the fix. It closes before grace, so it covers the no-receipt branch, not the closed-receipt branch. Neither added runner case covers null PID or disposal; neither asserts an exact kill count. Those ordering conclusions above are static evidence, not claimed test coverage.

## Five logic questions

1. Silent failure: the disposed-receipt late kill occurs after the original operation has returned (`claude-account-command.ts:494`, `:507`); its errors are swallowed at `:508`.
2. Unexpected user action: host/reader disposal while the PID remains deferred can enter the new finding (`claude-ambient-login-status.ts:149`).
3. Wrong input result: A -> B -> A now probes A and caches under A (`claude-ambient-login-status.ts:185`, `:218`, `:233`); no remaining wrong-key result found within this patch.
4. Dependency failure: null PID avoids a kill (`claude-account-command.ts:497`); rejected PID/kill promises leave termination unproved (`:508`). Certification/probe failures retain receipts and map to unknown (`claude-ambient-login-status.ts:214`, `:219`, `:221`).
5. Missing requirement: receipt subscriber disposal and pending kill ownership need separate lifecycle guarantees; the plan explicitly requires receipt disposal (`implementation-plan-p5.md:264`), while `claude-account-command.ts:505` now relies on continued close observation.

## Evidence and limits

Reviewed the saved four-file patch, both source files, both regression-spec files, previous review and developer fix report; traced the touched functions and receipt lifecycle. Scoped diagnostics for the two source files returned 0 errors and 0 warnings. No tests, builds, installs, verification commands or git operations were run; the developer's reported 33 passing tests and two failing revert checks are supplied evidence, not independently reproduced results.
Counts: 0 Blocking, 1 Serious, 0 Moderate, 0 Minor; 1 new failure mode. Score 6 reflects a localized but consequential lifecycle regression despite the repaired snapshot and retained-receipt paths; the unsafe late kill prevents the sound 7-8 band, while the correctly traced queue/cache behavior does not justify the broader defects implied by 3-4.
