# Code Logic Review — Batch 1l fixes (round 1), TASK_2026_714_c8a2

Review family: Claude reviewer, Codex implementer.

Score: 8/10. Verdict: APPROVED (no blocking or serious issues; remaining items are minor).

Evidence: full `git diff` of evidence-harness.ts and evidence-failure-notes.ts, and the diff hunks of the spec. Scoped jest run: 1 suite, 175 tests passed. The real harness was not run.

## Original findings 1-5

1. FIXED (path privacy), evidence-harness.ts:640-660, evidence-failure-notes.ts:111-160.
   - `createPathRedactor` is a pure extraction of the former inline replacements: same variants (raw, PowerShell quote-doubling, POSIX quote-escape, JSON-escaped which gives doubled backslashes), same longest-first sort, same case-insensitive flag on win32.
   - `recordCommandShape` now calls it. The diff shows no semantic change there, so command-shape behavior is unchanged.
   - Agent text then goes through generic rules: `[A-Za-z]:[\\/]+Users[\\/]+<name>` (one or more of either slash, so doubled backslash and forward slash are covered), `/home/<name>` and `/Users/<name>`. After that comes `sanitize`, then the 400-character cut, then trailing partial placeholder removal.
   - Order is correct: redact, sanitize, truncate. `sanitize` keeps `<USER_HOME>`.
   - Spec coverage (`it.each` for `\` and `/`) checks workspace, home, scratch, root, a foreign Windows user and the POSIX `/home` and `/Users` forms. The doubled-backslash form is not asserted in a spec; it works through the JSON variant for known paths and `[\\/]+` for generic ones. Minor: add a doubled-backslash case.
   - Residual, accepted: paths outside Users, home or the known dirs (for example `D:\work\x`) pass through. After a foreign-user redaction, the tail such as `\AppData\Local\Temp\...` remains, which is a layout leak but not an identity leak.
2. FIXED (instruction wording): matches the suggested text; asserted verbatim in the edit-flow spec. Other kinds are unchanged, and the accept/deny/file/mcp instruction is byte-identical to HEAD.
3. FIXED (expected-approval note), evidence-harness.ts:2074-2090.
   - The count compares `validatedApprovals.length` with 2 for edit and 1 for other command cases. `validatedApprovals` is pushed only at :1576 and :1676 (validated marker approvals), so tolerated reads are not counted. Deny has one approval (the decline), so it needs no extra handling.
   - It fires only on `terminal === 'completed'`. Interrupted, failed and timed-out cases (terminal undefined or other) produce no note, and an interrupted terminal is spec'd. A harness exception after a completed terminal still appends the note, which is accurate.
   - No duplicate: the granular-ask note is now restricted to `item.kind !== 'command'`, and the spec asserts one count note and no granular note for the four scenarios (including steer-then-message-only, 1 of 2).
   - Minor regression (finding A below).
4. FIXED (latest three retained), :653-659. Push then `shift()` once above 3 is correct, and it is spec'd for the fourth message. Events still contain no message text.
5. FIXED (spec gaps): the cases are present. The spec change that touched existing behavior is limited to the `decision` for the new `accept-empty` mode; the original edit/read-rule mapping is unchanged.

## Regression check (all case kinds)

HEAD vs working tree, harness code changes are limited to: the new optional `agentMessages` field, the `RpcChild` constructor redactor parameter (defaulted), the `agentMessage` capture, the edit instruction string, and the finally-block note logic. No change to command accept/deny/edit gating, file, mcp, read-rule or schema flow, no change to approval matching, outcome gates or steer. The "two command-shape regressions" were spec failures where generic home redaction would have altered `<PATH>` output; they were resolved by keeping the shared helper's semantics and applying the generic rules only to agent text (:644-651). I confirmed the helper diff is a pure move.

## New findings

A. MINOR - evidence-harness.ts:2084. For command cases the old `granular ask: no approval request observed` note is gone entirely. Command turns that end with terminal `failed` (not completed, not a harness exception) and no approval used to get a note and now get none. Consider extending the count note to any terminal other than `interrupted`, or to non-undefined terminals, with the terminal status in the text.

B. MINOR - evidence-harness.ts:659 trailing-placeholder trim `/(?:<[^>]*|\[[^\]]*)$/`. A message whose last `<` or `[` has no closing bracket before the 400-character cut loses everything after it (for example `a < b` or code like `arr[i`), so a long message could be truncated early. Restrict it to known placeholder prefixes (`<(?:WORKSPACE|ROOT|HOME|SCRATCH|USER_HOME|TMP|CWD|NODE|AUTH_DIR|CODEX_HOME)?` and `\[REDACTED?`) to keep it from eating real text.

C. MINOR (spec) - no doubled-backslash assertion (see finding 1); no assertion for a file with terminal `failed` (finding A).

## Verdict

APPROVED, 8/10, confidence HIGH on the logic and MEDIUM on model behavior, which only the paid run can settle. Findings A to C are optional and do not need to block run 6j.
