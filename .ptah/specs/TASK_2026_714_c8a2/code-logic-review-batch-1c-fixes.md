# Code Logic Review: Batch 1c fix round (S1, M1, M3, M4)

Verdict: APPROVED, 8.5/10. 0 blocking, 0 serious, 0 moderate, 3 minor.
Scope: only the fix round in evidence-failure-notes.ts, evidence-harness.ts and
evidence-harness.spec.ts (commit 60a4833a0). No commands were run. Code was read.

## S1: host path redaction (resolved)

- evidence-failure-notes.ts:126-146 builds the replacement list. It covers
  experiment root/home/scratch/workspace, execPath, homedir, tmpdir, cwd, CODEX_HOME
  and the auth directory. Each path gets raw, slash, backslash, quote-escaped and
  JSON-escaped variants.
  - The list is de-duplicated and sorted by value length, longest first (:140).
    Experiment paths under tmpdir or homedir are longer than their parents, so they
    resolve to <ROOT>/<WORKSPACE> first. The nested-path spec (spec :59) proves this.
  - Empty values are skipped (:152). An unset CODEX_HOME or authDirectory cannot
    produce an empty-string replacement.
  - Case-insensitive matching on win32 only (:155).
- The fallback `<PATH>` regex (:189-195) runs after the exact replacements. Its
  character classes exclude `<` and `>`, so a placeholder is never consumed. It
  covers drive-letter, UNC, /home/, /Users/ and ~/ paths. It runs before sanitize.
  Spec :121 asserts six cases.
- evidence-harness.ts:97-100: the `<USER_HOME>` alternative is leftmost. It matches at
  `<` before `\buser_` can match at `U`, so the placeholder survives. Real
  `user-xxx` and `acct_` IDs are still redacted. No other placeholder
  (<ROOT>, <HOME>, <SCRATCH>, <WORKSPACE>, <NODE>, <TMP>, <CWD>, <CODEX_HOME>,
  <AUTH_DIR>, <MARKER_SCRIPT>) matches any sanitize rule.
- authDirectory is threaded from runCase (harness :1013) to all three
  recordCommandShape call sites (:1143, :1196, :1219) and the caller (:1581,
  dirname(authPath)).

Minor findings:
- Minor (failure-notes :146-152): the guard is only non-empty. If homedir() or cwd()
  is "/" (a container with HOME=/), every "/" becomes a placeholder. This only
  degrades the diagnostic and cannot leak. Suggested guard: skip values shorter
  than 2-3 characters.
- Minor (:189-195): the fallback does not cover POSIX roots other than /home and
  /Users (/root, /opt, /var). It also leaks the tail of an unknown path containing
  spaces. The model-supplied commands here are expected to be fixed strings, so the
  exposure is small.
- Minor (:189-195): the regex has no left boundary. `<ROOT>/home/x` or
  `<WORKSPACE>/Users/x` becomes `<ROOT><PATH>`. This is cosmetic and affects only
  the diagnostic.

## M1: sanitize before the 400 cap (resolved)

failure-notes :187-195 applies sanitize to the full placeholder-substituted string,
then `.slice(0, 400)`. A secret straddling character 400 is redacted whole. Spec :134
places the secret at offset 390 and asserts `[REDACTED]` exactly at the cap with no
residue.

## M4: missing-approval note (resolved)

- harness :823 is a pure predicate: `!!turnId && level === 'ask' && !approvalRequestObserved`.
- turnId is assigned at :1346, immediately after the turn/start response. It is empty
  for early failures such as setup or config gates, so the note cannot be emitted
  falsely.
- approvalRequestObserved is set by the frame handler at :1108 for any `*/requestApproval`.
- The only effect is a `notes` push in `finally` (:1386). It touches no status,
  gate or cleanup path, so it cannot change pass/fail.
- Spec :992 covers true, empty turnId, observed request, and all non-ask levels.

## M3: policy mismatch message (resolved)

- harness :815 throws the exact string 'Effective approval policy differs from bounded profile'.
- The string is in the failureMessages allowlist (failure-notes :49).
- The call at :1297 runs after the generic config check (:1285-1294). Output-bound
  and sandbox mismatches keep their old message, and the policy mismatch gets its
  own.
- Spec :1002 covers a throw, equality, and the note surviving recordCaseFailure.

## Spec quality

- The new specs assert exact output strings. They exercise real homedir, tmpdir,
  cwd and CODEX_HOME values, with env restore in `finally`.
- The changed casing spec (:242) is not weaker. The input is still the uppercased
  workspace. The assertion is still `<WORKSPACE>` on win32 and unchanged text
  elsewhere. Only the fixture moved to a POSIX-style path so the new drive-letter
  fallback does not interfere. Platform-sensitive matching is still verified.

## Five logic questions (fix-scoped)

1. Silent failure: none new. The M4 note is informational and not gating.
2. Unexpected action: none.
3. Wrong output: only the cosmetic mangling noted above.
4. Dependency failure: not applicable. Everything is local string handling.
5. Missing: a minimum-length guard for placeholder substitution (Minor).
