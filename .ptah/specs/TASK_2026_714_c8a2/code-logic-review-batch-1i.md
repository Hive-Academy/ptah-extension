# Code Logic Review, batch 1i (TASK_2026_714_c8a2)

Scope: uncommitted diff of `libs/backend/codex-runtime/tools/{evidence-harness.ts, evidence-harness.spec.ts, evidence-cases.json, evidence-failure-notes.ts}`. Run once: `jest evidence-harness.spec.ts` gave 145 passed, 1 FAILED. No real codex binary was run.

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 4 |
| Moderate | 3 |

## Serious

### S1. ask-read-rule prompt cannot prove the rule caused the approval
- File: `evidence-harness.ts:1703-1706` (shared prompt: "Request approval, then run exactly this command once"), `:1432-1436` (approval record), `:1346` area.
- Scenario: the profile is granular `sandbox_approval: true`, so the model may itself ask for escalation. The prompt tells it to "Request approval", so it can emit an escalated or `require_escalated` call on a read the read-only sandbox would have allowed. The harness sees `requestApproval`, declines, and marks the case `observed`. That is a false positive for "rule prompts". The paid turn is spent on an ambiguous result.
- Evidence gap: `result.approvals` stores only `{method, absentBefore, response}`. The schema's `CommandExecutionRequestApprovalParams` has `reason`, `proposedExecpolicyAmendment`, `kind`, `approvalId`, `commandActions`, `networkApprovalContext` (schema keys confirmed). None of them is recorded, so the artifact cannot tell a rule prompt from a model escalation.
- Fix (minimal):
  1. For `readRule`, use a plain prompt: `Run exactly this command once, without wrappers, changes or added punctuation. The command is the whole next line:\n<cmd>\nNo other tools or retries.` Do not ask for approval. Add "Do not request escalated permissions" to the developer instructions.
  2. Without a rule, the read runs unprompted in read-only. So an approval then implicates the rule, and a no-approval completion is already handled as "rule did not prompt".
  3. Record sanitised approval-param evidence for this case. Keep the key list (`Object.keys(params).sort()`), `kind`, whether `reason` is present, and a bounded `reason` (<=120 chars, run through `sanitize`). Keep `proposedExecpolicyAmendment` presence only, and `approvalId` presence. Do not store the command, which is already gated.
- Residual: even with a plain prompt, the model might still volunteer escalation. The `reason` text is the only discriminator, so item 3 is needed.

### S2. Full-argv rule pattern probably never matches on Windows
- File: `evidence-harness.ts:1172-1181`, pattern `["Get-Content","-LiteralPath","C:/.../x.fixture.txt"]`.
- Scenario: Codex runs `powershell.exe -Command "<inner>"`. Exec-policy matching works on argv tokens. Either the wrapper is not parsed (argv is `["powershell.exe","-Command","Get-Content ..."]`, and the pattern's first token is `Get-Content`, so there is no match), or it is parsed by a shell-lc style splitter. In that case the quoted token is `'C:/...'` and might keep its single quotes, which would not equal the unquoted rule token. Either way the full-argv pattern has the lowest chance of matching. The outcome would be "rule did not prompt", which would be read as the rule not working when the pattern is at fault.
- Evidence: the report itself says the binary strings do not establish the signature or a PowerShell-aware parser. I could not verify this either, so this is a recommendation under uncertainty.
- Fix: write several rules in the same file (the cost is one line each) so one turn answers more:
  `prefix_rule(pattern=["Get-Content"], decision="prompt")` and `prefix_rule(pattern=["powershell.exe"], decision="prompt")`. Consider a `["pwsh"]` rule too. Keep the exact-command gate (`commandMatches`/`Unexpected command`), so widening the prefix adds no unsafe acceptance: every approval is still declined and every other command still throws. Record the rule content (already done). Treat a prompt as "some rule matched", not a specific rule, and say so in the note.

### S3. An "unverified" read-rule result halts the rest of the paid run
- File: `evidence-cases.json:36` (second in order), `evidence-harness.ts:1757,1766` and `:~1950` (`if (result.status !== 'observed') stop = true`).
- Scenario: the rule location is unverified and the pattern is a guess (S2), so "unverified: rule did not prompt" is the most likely outcome. It sets `stop`, and file-change-accept, plan-read-only, auto-edit-boundary, yolo-interrupt and mcp-approval never run. That is five of seven planned turns lost to a speculative probe. The report claims "stops subsequent inference on any unverified case" as a feature, but here it makes the cheap probe a single point of failure.
- Fix: either move `ask-read-rule` to the end of the catalog (after `mcp-approval`), or do not set `stop` when `item.kind === 'read-rule'` and the status is exactly `unverified: rule did not prompt` (no state is polluted: the rule is removed and the marker is untouched). Reordering is a one-line, lower-risk change.

### S4. Existing spec now fails
- File: `evidence-harness.spec.ts:149` expects the source text `const expectedCommand = markerCommand([`. The refactor at `evidence-harness.ts:1186-1191` turned it into `const expectedCommand = readRule ? ... : markerCommand([`, so the test fails (jest run: 1 failed, 145 passed). The prepush or CI gate fails, and the implementer reported tests as not run.
- Fix: relax the assertion (for example `toContain('markerCommand([')` plus `toContain('process.execPath')`), or extract `expectedCommand` into a small helper and assert on that. This is a source-grep spec, so also keep an assertion that the non-read-rule branch still uses `markerCommand`.

## Moderate

- M1. No way to select the 7-case subset (item 4). `parseOptions` (`evidence-harness.ts:1838-1850`) has no `--cases` or `--only`, and `main` loads the whole JSON (`require.main` block). The full catalog now costs 10 turns, and the preflight `plannedTurns > cap` (`:1870`) throws for it, as it did for 9 before. The planned run therefore needs a hand-edited `evidence-cases.json` (uncommitted dev edit, risk of an accidental commit or a wrong subset). Fix: add `--only id,id` validated against known ids, or document the exact temporary JSON. The 7-turn plan with `--turn-cap 8` is otherwise sound. Worst case is 7 + 1 steer-created turn = 8, which fits; `worstCaseTurns` (`:1873`) matches. Any extra turn from the new rule case would stop the run via `not run: cap`. Do not bump the cap above 8 (`TurnBudget` forbids it anyway).
- M2. Matcher is case-sensitive on Windows (`evidence-harness.ts:943`, cmdlet names and path compared with `===` after slash normalisation). A model that emits `get-content` or a differently cased drive letter hits `Unexpected command` and the case fails (fail closed, one wasted turn). This is acceptable, but note it. Do not fold case for the path unless the run showed it matters.
- M3. `readCompleted` note logic (`:1553-1560`): the note `unverified: rule did not prompt` is pushed whenever a completed item arrives with `approvalRounds === 0`, including a completed event for an item that does not match (it would have thrown before). It is also pushed again via status. Harmless, but the note and status are duplicated information; confirm the artifact does not double-report.

## Requirement-by-requirement

1. Tolerated read (edit case): matcher at `evidence-harness.ts:925-950` is sound.
   - It requires an exact string match to `original` after backslash to slash normalisation. There is no pattern interpretation, so `..`, trailing spaces, UNC, `file:stream`, `*` and `[` wildcards under `-Path` all fail the equality (an ADS or wildcard form is never equal to the original path). The only way `-Path` globbing could matter is if the experiment path itself contains `[` or `*`, which temp paths do not.
   - Chaining `; | & > \` $(` and CR/LF are rejected. The wrapper must pass the existing `commandMatches` identity (absolute `powershell.exe`/`pwsh.exe`). The inner command is single-quoted with no `'` inside, so `$env:` or subexpressions cannot expand.
   - It applies only to id `ask-command-edit`, read-only sandbox, edit. It claims once before any approval (`beforeFirstApproval`/`approvalRequestObserved`), so a second or late read is `Unexpected command`. It does not consume a `toolItems` slot, and its approval is declined with a note.
   - Gaps: an approval frame that arrives before its `item/started` takes the normal path and throws `Unexpected command` (fails closed). Other cases keep the exact gate (`isToleratedMarkerRead` is guarded by `editing && item.id`). No bypass found. COMPLETE.
2. ask-read-rule: PARTIAL, see S1 to S3. The location `rules/default.rules` is honestly marked unverified (`:1184`). The assumption that rules in `CODEX_HOME/rules/` load at session start is plausible but unconfirmed.
3. Cleanup: COMPLETE. The rule is written before spawn and removed in `finally` after `rpc.stop()` (`:1812`), and whole-home cleanup still applies, so there is no cross-case pollution. Minor: if `writeFileSync` of the rule throws midway the file may survive until whole-home cleanup, which still runs. The fixture file stays in the workspace, which is harmless.
4. Bounds: turn cap, usage bounds and deadlines are unchanged in the diff. See M1 for the subset mechanism.
5. Specs: new specs drive the real code paths (fake-child flows, matcher positives and negatives, lifecycle). I found no `any`, `ts-ignore` or `as unknown as` in the added lines. One existing spec now fails (S4).

## Five logic questions (short)

1. Silent success-looking failure: a model-escalated approval recorded as "observed: rule prompts" (S1).
2. Unexpected user action: running the harness without editing the cases file fails at preflight (M1).
3. Wrong answer: a no-match caused by the pattern is reported as "rule did not prompt" (S2).
4. Dependency failure: the codex rules loader may reject a rule line (`failed to parse rules`), and the harness has no signal for it. Only stderr, which the artifact does not keep. Consider recording whether stderr contained a bounded `failed to parse rules` literal.
5. Missing: recorded approval-param discriminators (S1) and a guard against the stop cascade (S3).

## Verdict

REVISE. The tolerated-read matcher is tight and the cleanup is correct. Before spending paid turns, fix S1 (plain prompt plus recorded `reason`/key evidence), S2 (broader prefixes), S3 (reorder or exempt from stop) and S4 (failing spec). Then add the case selector or document the temporary JSON (M1).
