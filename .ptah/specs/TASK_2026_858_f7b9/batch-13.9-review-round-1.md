+# Batch 13.9 code logic review — revise round 1

Verdict: APPROVED
Score: 8/10
Review family: codex (implementer: claude)

## Prior defects

| Defect | Judgment | Evidence |
| --- | --- | --- |
| 1. A failed second attempt clears the first live query's provisional lock | Fixed | `session-driver-lock-coordinator.ts:17-29,183-198,207-223` gives each attempt its own token and deletes only that token. `chat-session.service.ts:1697,1902,1929,2052,2137,2165,2339,2364-2367` carries it through continue, activate, and rewind. The overlapping-attempt spec at `session-driver-lock-coordinator.spec.ts:339-371` covers the earlier failure sequence. |
| 2. Stale removal clears a replacement's provisional owner | Fixed | `session-driver-lock-coordinator.ts:307-321,353-358` ends attempts only when their stored record token matches the removed token. `session-driver-lock-coordinator.spec.ts:373-404` covers delayed removal after replacement. |
| 3. Operator release passes a stale liveness check | Fixed | `control-endpoint.ts:185-193` delegates release to `releaseIfIdle`; `kernel-session-driver-lock.ts:50-59` invokes the gate. `session-driver-lock-coordinator.ts:52-61,102-115` checks owners and awaits release inside the same per-session queue used by admissions and owner changes. `session-driver-lock-coordinator.spec.ts:405-444` covers admission before release and release before admission. |

## New defects

None found in the revised paths.

## Five logic questions

1. **Silent failure:** A record that never emits `init` retains its attempt and kernel lock while the record exists (`session-driver-lock-coordinator.ts:207-220`). This is fail-closed for a potentially live SDK query. Binding or removal ends the wait (`:303-321,353-356`); a permanently live query with neither event remains locked by design.
2. **Unexpected user action:** Retrying the same tab after an earlier attempt returns no longer clears that earlier attempt (`:193-198`). Operator release during an acquisition waits for the acquisition's queue entry, then sees its owner (`:54-60,102-115`).
3. **Wrong input association:** A removed record's tab ID can equal a replacement's tab ID. Removal now uses the old record's token when selecting settled attempts (`:308-318,353-356`).
4. **Dependency failure:** A failed lock acquisition refuses before an attempt is recorded (`:142-159,183-189`). A gate or release rejection rejects the operator request and advances the promise queue via `:102-114`; it does not admit a release after an owner appears. A stranded kernel release remains unavailable for subsequent acquisition (`kernel-session-driver-lock.ts:71-86,225-257`).
5. **Unspecified case:** The plan's single provisional entry did not specify overlapping attempts. The revised token map provides independent ownership (`session-driver-lock-coordinator.ts:19-29,183-198`). A never-ending SDK query still requires its registry lifecycle to remove its record before the lock can be freed.

## Decisions and verification

- **Decision:** APPROVED. The three concrete races in the prior review are closed by per-attempt identity, per-record cleanup, and serialized operator release. This is 8/10 rather than 9/10 because the cross-process gate path and a permanently stalled SDK query were not independently exercised in this read-only review; it is above the 5–6 band because no remaining path was found that releases a live owner's lock. The decision is reversible.
- Reviewed the specified `4cc7f062b..518cb5d17` diff, full coordinator, affected service call sites, kernel and control release paths, null lock, registry removal and displacement, and the W10/C4b plan. No tests or builds run, as instructed. Implementer-reported verification was 19/19 across the five named projects. Scoped `ptah_get_diagnostics` was attempted; it reported TypeScript checking still running rather than a result. No skill-loading tool was available in this lane.
