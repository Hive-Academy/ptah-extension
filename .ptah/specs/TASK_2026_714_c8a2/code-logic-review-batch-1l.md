# Code Logic Review — Batch 1l, TASK_2026_714_c8a2

Review family: Claude reviewer, Codex implementer.

Score: 6/10. Verdict: REVISE (one Serious fix needed before the paid run; the instruction wording is acceptable).

Scope read: git diff of evidence-harness.ts and evidence-harness.spec.ts, `sanitize` (:86-118), RpcChild event handler (:615-659), thread/start instructions (:1946-1957), the turn/steer text (:1677-1688), the finally block (:2054-2072), the artifact writer (:2317-2400), `evidence-failure-notes.ts` redaction, and `evidence-cases.json`. Ran the one allowed jest command: 1 suite, 170 tests passed. The real harness was not run.

## Findings

1. SERIOUS - evidence-harness.ts:645 (also :2317, :2374). `sanitize()` has no path or home-directory redaction. It covers bearer tokens, sk-/JWT/gh tokens, emails, uuids, `key=value` secrets and strings of 48+ characters. The only path redaction in the tool is in `evidence-failure-notes.ts:134-235`, which this change does not use. The model sees `cwd` (the experiment workspace under the OS temp dir) and a Windows path such as `C:\Users\abdal\AppData\Local\Temp\ptah-codex-evidence-...\ask-command-edit.marker`. If the model quotes a path in an agent message, which is the most likely thing it says when it refuses or explains, `agentMessages` writes it into the committed spike-run JSON. That leaks the username and temp layout. The artifact-level `sanitize` at :2317 does not help, because it applies the same rules. The spec only proves email and Bearer redaction, so it hides this gap. Fix: before truncating, apply the path replacements from evidence-failure-notes (workspace, root, home, scratch to placeholders, plus a generic rule for `[A-Za-z]:\\Users\\[^\\\s]+` and `/(home|Users)/[^/\s]+`). Add a spec with a Windows temp path in the message. Truncation after redaction is correct, but a cut can still land inside a half-redacted token, so also drop a trailing partial.

2. MODERATE - evidence-harness.ts:1955 (instruction wording). Recommendation: acceptable, with one wording tweak.
   - Steer input is user input. `turn/steer` appends a user-role `input` item to the in-flight turn, so "per user message" does count the steered text as a new message. The steer text itself says "run exactly this command once instead", an explicit directive that outranks the system-level scope hint. The accept/deny cases ran with this base text and the model did run commands, which is the best evidence we have.
   - Residual risk: "Only the single requested marker may be touched" can read as "the marker from the first message". The replacement writes `<id>.replacement.marker`, a different file. The old "latest requested command" wording was clearer on this point, but it is the only difference from the accept/deny base, so reverting it is weaker than the observed text. 6i also failed with it, though that evidence is confounded by the missing stop rule.
   - Suggested exact text, which keeps the observed base and changes only the last clause: `...No subagents. No retries. Stop after one tool action per user message; a later user message may request a different single marker.` This adds no plan naming (no decline, steer or replacement) and removes the ambiguity. If the orchestrator wants zero deviation from the observed text, keep the current wording; the risk is low-moderate.
   - Also confirm that "the single requested marker" is not checked by a gate that rejects a second marker. :1593 chooses `replacement` for round 2, so it is fine.

3. MODERATE - evidence-harness.ts:2055-2062 (note). Logic is correct as far as it goes: `terminal` is declared at :1406 before the try, is reset on a turn change (:1402), and is set at :1859, so it is in scope in the finally. It does not mask failures, because it only appends a note. Gaps:
   - In the edit case, `approvalRequestObserved` stays true after round 1. If the first command is declined and the post-steer turn completes with no second approval (the replacement is skipped, a likely failure mode here), no note fires, although that is exactly the interesting case. Condition the note on `validatedApprovals.length` or `approvalRounds` versus the expected count (2 for editing) so it fires for "completed with fewer approvals than expected".
   - All command cases are level `ask`, so this note always duplicates `granular ask: no approval request observed` (:2071). That is cosmetic, but the two notes will confuse a reader. Merge them or reference the message count in the existing note.
   - `terminal` comes from the last turn only; for a steer that starts a new turn, a first-turn `completed` is lost. This is acceptable.

4. MINOR - evidence-harness.ts:642. The message cap is 3 per case, taken from the first three. For the edit case the interesting message may be the fourth or later (after the steer). Consider keeping the last three, or a separate counter for the post-steer turn. The 400-character cap per message and the 3-message cap are within the requirement, so this is optional.

5. MINOR - spec quality. Good coverage of: completed-only, started and reasoning excluded, malformed non-string text excluded, cap of 3, cap of 400, no leak into events, the exact developer instruction, and the messages-only and empty-turn notes. Missing: a path or username case (Finding 1), a case of the edit flow completing the second turn without a second approval (Finding 3), and a case where `terminal` is not `completed` (should add no note). The test at :1851 asserts the instruction string verbatim, which is fine but will need an update if the wording changes.

## Answers to the focus questions

- Will the instruction block the replacement? Unlikely, as above; the steer is a user message, but tweak the wording to be safe.
- Does `sanitize` redact paths and secrets in agent text? Secrets and emails yes; paths and home directories NO (Finding 1).
- Is the finally note correct? In scope and non-masking, but misses the second-approval gap and duplicates the ask note (Finding 3).

## Verdict

REVISE, 6/10. Fix Finding 1 before spending a paid turn, because the 6j run writes agent text into a committed JSON file. Findings 2 and 3 are recommended tweaks that are cheap and make the 6j result more informative. Confidence: MEDIUM-HIGH on the code; MEDIUM on model behaviour, which can only be settled by the paid run.
