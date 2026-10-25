# Code Logic Review — Batch 1i fix round (TASK_2026_714_c8a2)

Score: 7/10. Verdict: REVISE (one failing spec; production logic accepted).

## Test evidence

`npx jest -c libs/backend/codex-runtime/jest.config.ts .../evidence-harness.spec.ts --coverage=false --maxWorkers=2`:
147 passed, 2 failed. Both failures are `records sanitised approval evidence for rule-approval|read-approval`, `evidence-harness.spec.ts:1829`:
`expect(result.approvals[0].reason).toHaveLength(400)` receives 52 chars (`"Contact [REDACTED] with Bearer [REDACTED] [REDACTED]"`).
`sanitize` (`evidence-harness.ts:86-98`) redacts the 450-char `x` run as a long token, so the cap is never reached. The harness is behaving
correctly (more redaction, no leak); the spec assumption is wrong. The line-1824 `toMatchObject` passes only because it recomputes the same sanitised value.
The 400-char cap is therefore not exercised by any test.

## Serious

- S-new-1 (Serious, spec): `evidence-harness.spec.ts:1829` fails, so the fix round is not green and the fix report's "specs require the orchestrator's check slot" claim was unverified.
  Fix: use a reason that survives sanitize and exceeds 400 chars (for example words separated by spaces, `'word '.repeat(120)`) and assert length 400; keep the secret/email redaction assertion.

## Checks

- S1 prompt: `evidence-harness.ts:1746` drops "Request approval, then" only for `readRule`; other commands unchanged. PASS (spec :1812 passes).
- S1 evidence: `approvalSummary` (:352-368) records sorted sanitised `paramKeys`, string-or-null `reason`/`kind`/`type` (sanitised, sliced to 400), and
  `hasProposedExecpolicyAmendment` as `!= null`; amendment content, cwd, command and paths are never copied. Field names `reason`, `kind`,
  `proposedExecpolicyAmendment` match the schema per the fix report. `type` is defensive and documented as such. Cannot throw: `safeParse` on params,
  `Object.keys` on a plain record, `sanitize` on strings only. It runs before the `try` at :571 but needs no guard. Recording happens at receipt
  (:569-571) and every decline path sets `response` (:577, :585, :591, :597), so the decline path is not broken by it. A non-array/oddly-typed
  amendment still yields a boolean. PASS. Minor: `paramKeys` entries come from wire-controlled keys; they are sanitised but uncapped in count/length (Minor, :359).
- Validated approvals separated (`validatedApprovals`, :1264, :1344-1361) so tolerated reads do not shift marker indices. PASS.
- S2: rules built at :1212-1216 as full argv + `["Get-Content"]` + `["powershell.exe"]` (win32) or `["cat"]` otherwise, one `prefix_rule(..., decision="prompt")` per line.
  Exact command gate (`commandMatches`, :966, and the `readRule` unexpected-command throw :1448) unchanged. Rule file removed in `finally` (:1851-1853). PASS.
  Residual: on win32, a wrapper `powershell.exe` prompt for a different command is still gated by the exact-command check. Acceptable.
- S4: spec :149 now matches `readRule ? ... : markerCommand([execPath, markerScript, experiment.root, target])`. Guards the property again. PASS.
- Runner (`spike-runner.ts:18-37`): order matches the requested sequence; CAP = min(11, 8) = 8; planned cost 7 (0+0+1x7); refuses `cost >= CAP`
  (7 < 8 passes, leaving one steer slot); passes `--turn-cap 8`, which `TurnBudget` (:66-68) validates; rejects a user-supplied `--turn-cap`. Closes first-review S3/M1.
  Minor: cost 7 leaves exactly one spare turn; if ask-command-edit's steer consumes it, ask-read-rule (last) is the case that can skip, as the comment states.

## Verdict

REVISE: fix the single spec assertion at `evidence-harness.spec.ts:1829` (and the input at :1824) so the 400-cap is genuinely tested and the suite is green.
All S1/S2/S4 production changes and the runner are acceptable.
