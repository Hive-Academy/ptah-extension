# P5 backend bounded logic re-review, round 2

Verdict: APPROVED
Score: 8/10

R1 Serious finding: **Closed**. `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:540` records close independently of receipt state; disposal transfers observation to `exitSeen` while PID remains unresolved (`:475-481`), and the kill guard consults `exited` (`:517`). Disposal itself never asserts termination (`:182-186`).

## Scope and evidence
- Read the complete command implementation and `claude-account-command.ambient.spec.ts`; reviewed the r1 finding, task context, requirement/plan excerpts and root instructions. This verdict covers the bounded lifecycle correction, not unrelated patch changes.
- Scoped `ptah_get_diagnostics` returned zero errors/warnings, coverage clean. No tests, builds, installs or git commands were run. The reported 130/130 focused tests are caller-provided evidence, not independently rerun results.
- Added regression cases cover disposed/closed, disposed/live, receipt-closed and null PID (`libs/backend/auth-providers/src/lib/accounts/claude-account-command.ambient.spec.ts:158`, `:166`, `:175`, `:183`). Earlier cases cover PID during the limit and close during grace (`:110`, `:136`).

## Ordering and ownership
- PID before grace: the single stop callback requests the kill if still open; close sets `exited` and completes termination (`claude-account-command.ts:499-519`, `:539-544`). PID after grace: the receipt allows the owed kill; observed close suppresses it (`:505-517`).
- Close before disposal sets `exited` and closes the receipt. Dispose before close installs the independent once-listener; close sets `exited` without reviving receipt subscribers (`:182-195`, `:475-481`, `:540-542`). PID before disposal leaves no temporary observer to attach (`:483-485`).
- Null PID before grace completes as terminated; after grace it closes a retained receipt. After disposal the receipt intentionally stays disposed, but PID settlement removes the temporary listener and no kill occurs (`:189-190`, `:483-485`, `:509-513`).
- Rejected PID removes the temporary observer; the stop chain catches rejection and leaves termination unproved until close. Neither handler manufactures closure (`:483-488`, `:520-522`). Native handle `off()` is assumed nonthrowing; both rejection branches are attached immediately.
- Never-settling PID: disposal retains exactly one once-listener until close. If neither PID nor close arrives, that observer remains intentionally necessary to prevent a future stale-PID kill (`:475-481`); the caller already received a bounded unresolved outcome (`:503-507`).
- No reachable double attachment: finish is guarded, a receipt-bearing finish does not detach, and receipt close/dispose are mutually guarded (`:182-195`, `:489-495`). No double kill: `stopped` gates registration of the sole kill callback (`:499-508`). Known-PID live receipts retain their ordinary close listener intentionally until closure/disposal; the temporary observer is removed (`:483-485`).
- Callback order: both reactions use the same native Promise; registration at `:488` precedes `:508`. Reversing just those two callbacks would not change an `exited` decision: the kill callback reads independently recorded closure; null-PID cleanup could temporarily attach an observer which `pidSettled` then removes. This reasoning assumes ordinary event-loop delivery, with no third-party promise reaction emitting close between observer removal and the kill callback; such an interposition is not exercised by these specs.
- The degradation-audit comment at `:487` appropriately identifies best-effort PID/kill handling: rejection ends observation of PID availability, while timeout/error and unproved termination remain visible through the stop outcome (`:499-522`). It does not claim successful termination.

## Five logic questions
1. **Silent failure?** A failed kill remains an explicitly unproved termination with null status, rather than a success-looking status (`claude-account-command.ts:374-377`, `:506`, `:520-522`).
2. **Unexpected user action?** Repeated disposal/abort cannot add listeners or issue another kill (`:182-186`, `:499-501`). Disposal preserves the owed late kill for a live child (`:517-519`).
3. **Wrong-answer input?** Null PID means no process and bypasses killing; stopped output is never parsed (`:374-376`, `:509-513`). Malformed positive PID values are outside the typed spawner contract and this correction.
4. **Dependency failure?** PID rejection and tree-kill rejection are handled; an unresolved PID does not extend the operation beyond grace (`:503-522`). The correction supplies no new guarantee of eventual process termination.
5. **Unspecified requirement?** Lifetime of the safety observer when both PID and close never arrive is necessarily indefinite (`:481`); disposing the receipt cannot safely erase that obligation.

## Findings and confidence
No new actionable logic findings in the bounded correction. Remaining uncertainty: no newly executed runtime checks, and no dedicated rejection, repeated-disposal, never-settling-PID or listener-count assertions in the added four cases (`claude-account-command.ambient.spec.ts:148-189`). Static state tracing supports approval; these verification limits keep the score below 9, while closure of the serious defect and explicit handling of the reviewed orderings distinguish it from the 5-6 band.

## Decisions
Approve this bounded correction using the native Promise/event-emitter contract; options were approval or revision for a demonstrated remaining failure. Evidence is the guarded lifecycle above. Reversible through follow-up review if an adapter permits interposed close delivery between promise reactions.
