# Code logic review R2 — e2680278c

## Verdict

**APPROVED** for the scoped fixes. Serious 1 and Serious 2 are fixed. No new Blocking or Serious defect is supported by the changed code. This verdict does not revisit deferred Moderate 3.

## Prior findings

1. **Serious 1 — FIXED.** The write result is typed without a host `error` field and the component reads only the success flags and the RPC timeout marker (`libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts:428-440`). On refusal it writes a fixed local message to both the field and status (`:448-455`), which the template interpolates (`:215-223,242-249`). The sentinel refusal test checks that host text appears in neither `textContent` nor `innerHTML` and that the field retains the user's draft (`libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.spec.ts:390-416`). Client-side validation still sets its own error in `edit` and `commit` before any write (`advanced-settings-group.component.ts:385-408`); the existing invalid-draft cases assert the message and zero RPC writes (`advanced-settings-group.component.spec.ts:303-323`). Impact: a host exception can no longer disclose its text through this card, while local validation advice remains visible.

2. **Serious 2 — FIXED.** `reload` starts its own five-second timer and races it against all read calls (`advanced-settings-group.component.ts:298-319`). A deadline result sets the load error (`:320-327`), and the error template exposes Retry (`:110-126`). This covers the host-readiness wait because `rpcCall` waits for readiness before installing its own timeout (`libs/frontend/core/src/lib/services/rpc-call.util.ts:115-133`). The test holds every read unresolved and observes Loading at 4,999 ms, Retry at 5,000 ms, then a fresh Loading state on Retry (`advanced-settings-group.component.spec.ts:183-212`). Impact: the user can retry when the host bridge never becomes ready.

## New Blocking or Serious findings

None. The group's timer is cleared when the race settles and on component destruction (`advanced-settings-group.component.ts:286-288,311-319`). A late result from a read whose deadline already won cannot resume the completed `Promise.race` continuation (`:318-340`); Retry starts a separate read (`:122,298-318`). A successful write still takes the confirmed branch (`:431-446`), while local invalid drafts still stop before `write` (`:398-408`). The remaining malformed-success read behavior was explicitly deferred and is excluded from this R2 verdict.

## Five logic questions and verification

1. **Silent failure:** no new silent failure was found in the changed paths; malformed successful reads remain the deferred prior finding (`advanced-settings-group.component.ts:320-339`).
2. **Unexpected user action:** Retry after a never-settling read restarts Loading and a fresh deadline (`advanced-settings-group.component.ts:122,298-318`; `advanced-settings-group.component.spec.ts:183-212`).
3. **Wrong answer from input data:** local invalid numeric text remains rejected with its own message and no write (`advanced-settings-group.component.ts:385-408`; `advanced-settings-group.component.spec.ts:303-323`).
4. **Dependency failure or timeout:** a missing read response produces Retry at five seconds; an unconfirmed write retains the unconfirmed wording (`advanced-settings-group.component.ts:318-327,437-455`).
5. **Unstated requirement:** public error copy must not expose arbitrary host text; the fixed message now enforces that boundary (`advanced-settings-group.component.ts:448-455`).

I read both changed files in full and traced the RPC readiness gate. The fix-round report records the targeted Jest suite passing 32/32 tests; I did not rerun it. Scoped `ptah_get_diagnostics` reported no diagnostics in either requested file, while also reporting unrelated sibling errors in the chat project; it does not establish a project-wide typecheck pass. This review is static beyond the recorded test evidence.
