# Batch 1l fixes — round 1

Addressed all five requested findings. Changed the two assigned harness files and the explicitly permitted shared failure-notes helper. No paid model turns or git operations were used; live ask-command-edit success remains unverified.

## Findings and changes

1. **Filesystem path privacy:** `libs/backend/codex-runtime/tools/evidence-failure-notes.ts:111` exports `createPathRedactor`, extracted from the existing command-shape path replacements. It retains slash/escaping variants, longest-path-first matching, and workspace/root/home/scratch and environment placeholders. Existing command diagnostics reuse it at line 179. `libs/backend/codex-runtime/tools/evidence-harness.ts:1402` supplies the experiment and auth directory to RpcChild. At line 646, completed agent text applies that redactor plus generic Windows Users and POSIX home/Users rules before sanitize and the 400-character cap. A trailing partial angle/square-bracket placeholder is removed after truncation.
   - Specs: `evidence-harness.spec.ts:2719` exercises both backslash and forward-slash experiment paths, all four experiment placeholders, an unrelated Windows username, Linux home and macOS Users paths. It asserts usernames and temporary path layout do not appear in the result. Existing unknown-path command-shape privacy regressions also pass unchanged.
2. **Instruction clarity:** `evidence-harness.ts:1974` uses the exact requested instruction below. The command user prompt is unchanged. The successful edit-flow spec asserts the exact instruction at `evidence-harness.spec.ts:1895`.
3. **Missing approvals after steering and duplicate notes:** `evidence-harness.ts:2074` compares validated marker-approval count against two for edit and one otherwise. Completed command cases below that threshold receive exactly one count-based note. The granular-ask note is now restricted to non-command cases at line 2084. Validated marker approvals exclude incidental tolerated-read approvals.
   - Specs: `evidence-harness.spec.ts:1907` covers zero-of-two with and without agent text, one-of-two after successful steer with only a message, and zero-of-one for a non-edit accept case. Each checks one diagnostic and no duplicate granular-ask note. At line 1928, an interrupted terminal produces no missing-command-approval diagnostic. Existing non-command missing-approval coverage remains passing.
4. **Latest-message retention:** `evidence-harness.ts:660` drops the oldest message when a fourth arrives. `evidence-harness.spec.ts:2675` first verifies sanitization and the length cap, then verifies that the fourth message replaces the first and the final three remain in order.
5. **Regression coverage:** All requested categories above are covered by the assigned harness spec. Existing event-summary privacy assertions remain intact: message text is never added to events.

## Developer instruction (verbatim)

> Evidence experiment. Only the single requested marker may be touched. Do not inspect credentials, config, home, environment or network. No subagents. No retries. Stop after one tool action per user message; a later user message may request a different single marker.

## Verification

Commands used PowerShell `Select-Object -Last N` as the equivalent of `tail -N`. Only the requested Jest spec, codex-runtime typecheck, changed-file lint/formatting, and required scoped diagnostics were run.

- Initial Jest run: exit 1; **2 failed, 173 passed, 175 total; 1 suite failed**, 22.102 seconds. Both failures were existing unknown-home-path command-shape assertions: generic home redaction in the shared helper changed `<PATH>` to `<USER_HOME>/private.txt`. Fixed by keeping the shared helper's original path replacement semantics and applying the new generic home rules only to agent-message evidence.
- Final `npx jest -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts --coverage=false --maxWorkers=2`: exit 0; **1 suite passed, 175 tests passed, 0 snapshots**, 21.908 seconds. Output also reported the Node ES-module config loading warning and `SKIP symlink file: OS forbids symlink creation.`
- `npx nx typecheck codex-runtime --parallel=1`: exit 0; **1 task succeeded**, 0/1 cache hits, 2.6 seconds, critical path 2.4 seconds.
- `npx eslint libs/backend/codex-runtime/tools/evidence-harness.ts libs/backend/codex-runtime/tools/evidence-harness.spec.ts libs/backend/codex-runtime/tools/evidence-failure-notes.ts`: exit 0; **0 errors, 3 warnings**. Pre-format output locations in evidence-harness.ts: 739 max-lines (2335 lines, limit 700), 1726 preserve-caught-error, 2221 no-useless-assignment.
- `npx prettier --write` on those same three files: exit 0; all three formatted.
- Final scoped `ptah_get_diagnostics` on the three changed source/spec files: TypeScript compiler, clean coverage, **0 errors and 0 warnings**.

No live harness, workspace-wide checks, build, package installation, or commits were run. Formatting followed checks as requested; final compiler diagnostics ran after formatting.

## Decisions

- **Share known-path replacement logic, keep new generic home rules in agent capture.** Options: duplicate all path rules, change command-shape normalization, or extract existing replacements and extend only agent evidence. Chosen extraction uses the expressly permitted helper file and preserves command-diagnostic behavior; two initial regression failures demonstrated why generic rules must remain local to agent evidence. Reversible: yes.
- **Count validated marker approvals.** Options: count every request, retain a single boolean, or count the existing validated marker approvals. Chosen validated count detects the missing post-steer approval and excludes tolerated marker-read requests. Evidence: existing approval gate and read-approval regression fixture. Reversible: yes.
- **Use the exact supplied instruction and latest-three retention.** These are explicit revision requirements, replacing prior wording and first-three behavior. Both are directly asserted in specs. Reversible: yes.
- **Preserve non-command diagnostics.** Command cases use the new expected-count note; non-command cases retain the existing shouldNoteMissingApproval predicate. This avoids duplicate command notes without broadening the behavior change. Reversible: yes.
