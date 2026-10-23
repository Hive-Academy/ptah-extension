# Batch 1c fix report

Implemented S1, M1, M4 and M3 in the three assigned source/spec files.
All source paths below are relative to the worktree root; line references are
for the resulting files. No Git operations or prohibited check commands ran.

## Findings addressed

- **S1:** `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:126`
  adds user home, temp, cwd, CODEX_HOME and optional auth-source directory to
  the existing length-sorted slash, quote and JSON-escaped path variants.
  Nested experiment paths retain their specific placeholders.
  At `:189`, remaining drive-letter, UNC, /home/, /Users/ and ~/ paths become
  `<PATH>` before sanitization. Angle brackets delimit placeholders so the
  fallback cannot consume them. `evidence-harness.ts:1581` passes the resolved
  auth-source parent into runCase; `:1143`, `:1196` and `:1219` forward it to
  every command-shape diagnostic. `evidence-harness.ts:97` preserves the exact
  `<USER_HOME>` literal through account-ID sanitization.
- **M1:** `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:187`
  sanitizes the entire placeholder-substituted diagnostic before the 400-character
  cap at `:193`.
- **M4:** `libs/backend/codex-runtime/tools/evidence-harness.ts:823` exports
  `shouldNoteMissingApproval`: true only with a nonempty turn ID, explicit ask
  level and no observed approval request. The finally block uses it at `:1386`.
  Case outcomes, approval gates and cleanup are unchanged.
- **M3:** `libs/backend/codex-runtime/tools/evidence-harness.ts:815` exports
  `assertEffectiveApprovalPolicy`, used by the effective-config gate at `:1297`.
  A policy mismatch throws `Effective approval policy differs from bounded profile`;
  output-bound and sandbox mismatches retain the existing message.
  `evidence-failure-notes.ts:49` allowlists the new message.

## Specs added

In `libs/backend/codex-runtime/tools/evidence-harness.spec.ts`:

Describe `bounded command shape diagnostics`:

- `:59` — `replaces real home and temp paths while preserving nested experiment paths`
  (includes JSON-escaped real host paths and placeholder survival).
- `:90` — `replaces cwd, CODEX_HOME and the caller auth directory`.
- `:121` — `redacts an unknown absolute path: %s`
  (six Windows drive, UNC, POSIX and tilde cases).
- `:134` — `redacts a secret straddling character 400 before capping the note`.

Describe `granular ask approval policy`:

- `:992` — `notes missing approval only after an ask turn starts without a request`
  (early termination, observed requests and all non-ask/default levels covered).
- `:1002` — `reports an allowlisted approval-policy mismatch`
  (throws the new message, accepts equality and preserves the thrown message
  through recordCaseFailure).

Existing assertions remain. The casing test at `:242` now uses /evidence/workspace
so its POSIX unmatched-case expectation still tests platform-sensitive matching
without conflicting with the new mandatory Windows absolute-path fallback.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use explicit ask level for missing-approval notes | Explicit ask; granular policy alone | The review identifies default granular profiles as misleading; the requested condition names ask. | Yes |
| Forward resolved auth parent through runCase | Explicit parameter; global state; omit available source | runHarness already resolves authPath; all diagnostic callers share runCase. | Yes |
| Preserve only the exact USER_HOME placeholder in account-ID redaction | Exact literal exception; broadly bypass placeholder-shaped text | Existing user-prefix regex otherwise redacts the required placeholder. Other account matches remain redacted. | Yes |
| Extract the approval-policy assertion | Small tested assertion; duplicate throw logic in specs | Existing structural equality helper remains authoritative; regression spec exercises the actual throwing path. | Yes |
| Apply fallback only to emitted command text | Before diagnostic classification; before emission | Existing wrapper/quoting classification remains useful and does not participate in approval decisions. | Yes |

## Verification and remaining work

- Scoped `ptah_get_diagnostics` on the three changed files returned TypeScript
  compiler source, clean coverage, zero errors and zero warnings.
- No nx, Jest, tsc, eslint, prettier, npm, ts-node, native Codex or build command
  was run. The orchestrator must execute scoped tests and formatting checks.
- Exact command/file identity gates, approval decisions, turn budget, usage
  ceiling, deadline and cleanup logic were not changed.
- M2 and other review suggestions outside the four assigned findings remain
  outside this fix round. No other source files were edited or reverted.
- This report is the only task-folder deliverable written.
