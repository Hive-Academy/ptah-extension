# Batch B7 fix

## Failures and changes

1. `session-enter.spec.ts:126`: B7's same-pass restore left a retained pinned transcript at its old native offset. The entrance's projected viewport then selected `B-1` instead of the latest `B-11`. `chat-transcript.component.ts:1064-1077,1125-1137` resets the pinned offset at the entrance/activation edge, registers the entrance read, and schedules the restore write for that render pass. The saved unpinned offset is untouched.
2. `session-enter.spec.ts:228`: In rapid A → B → A, `entering` rose after A had already activated, so activation alone scheduled no new restore. The same entrance-edge handling now re-arms the restore and marks A's current slot. The B4 specs were not edited.
3. `component.spec.ts:219`: The test expected the old rAF behavior: `scrollTop` remained 300 immediately after surface reactivation. B7 intentionally restores the pinned bottom to 1000 during that render pass. `chat-transcript.component.spec.ts:218-220` asserts the new immediate value before and after invoking stale frame callbacks, preserving the original stale-frame check.

## Review fixes

- `chat-transcript.component.ts:1242-1260`: a scroll that cancels a pending restore now updates pin state first, then schedules pinned follow. An upward scroll still unpins and cancels it.
- `chat-transcript.component.ts:1299-1303`: the executed restore callback clears its ref before the inactive guard; the generation check still protects a newer ref.
- `chat-transcript.scroll-restore.spec.ts:86-89,139-156`: regression coverage explicitly requests follow while restore is pending, cancels that restore with a still-pinned scroll, and verifies the queued frame reaches the bottom.

## Verification

- Permitted transcript Jest command: **20/20 suites and 241/241 tests passed** on the third and final run. The first run had four failures; the second had one entrance failure. No B4 spec was changed.
- After that run, the pinned-only reset guard and the regression test's explicit deferred-follow assertion were tightened. The three-run cap prevented another Jest run on those final small edits.
- `chat-transcript.component.ts` is 1398 lines. Scoped `ptah_get_diagnostics` was attempted after edits; its TypeScript compiler check remained unavailable after its 45-second timeout, so it supplied no type-check result.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Re-arm pinned follow when scroll cancels a restore | Schedule follow after pin update; keep a separate deferred-follow flag | B7 review Moderate 1 names this path; the new regression exercises it | Yes |
| Restore on an entrance edge even if activation occurred earlier | Handle only activation; handle both edges | Rapid A → B → A failed with zero marks, then passed with entrance-edge scheduling | Yes |
| Update the existing stale-frame assertion to 1000 after reactivation | Keep the rAF-era 300 assertion; assert B7's same-pass bottom | The restore spec requires first-pass bottom; stale callbacks still leave the value unchanged | Yes |
