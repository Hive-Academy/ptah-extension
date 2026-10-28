# Code Logic and Security Review — TASK_2026_719_4f64

Verdict: **REVISE**  
Score: **6/10**  
Findings: **1 Blocking, 0 Serious, 0 Moderate, 1 Minor**. Failure modes: **1**.

The shared personal-login predicate implements the requested acceptance set. The revision is for Batch A's new diagnostic boundary, which can copy arbitrary error data into logs. Security findings are Blocking under this role's severity definitions. The score is above 3–4 because both callers retain identity comparison and admission gates; below 7–8 because the confidentiality contract is not enforced on every new diagnostic field.

## Scope and evidence

Reviewed the supplied two-batch diff, both implementation reports, task context, root guidance, relevant task requirements/plan, and the predicate, callers, diagnostic formatter, adapter catch, and associated test cases. Structural analysis covered all eight named source/spec files. Large-file output was truncated, so this is a targeted diff/security review, not an assertion that every unchanged line of every file received full-file review. No approval of the entire lifecycle is implied.

No source edits, git operations, tests, builds, or Claude CLI execution were performed. Scoped ptah_get_diagnostics for the eight named files returned **unavailable**, with all eight unchecked: the TypeScript check was still running after 45 seconds and was not cancelled by the tool. No retry was made. The author reports lint/typecheck success for both changed projects and passing runtime tests; agent-sdk had one compaction-test failure followed by a successful isolated rerun. Those are reported evidence, not independently reproduced results. No code-style-review.md was present at the exact conventional path.

Paths below are relative to the worktree root.

## Numbered findings

### 1. Blocking — identifier-shaped error names still expose arbitrary data

**Evidence:** `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:417` and `:426`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:286` and `:290`.

The formatter returns `error.name` verbatim if it matches an identifier regex. Error.name is a writable data field, not proof of an error class. A dependency rejection such as `Object.assign(new Error('ignored'), { name: 'CustomerSecretAbc123' })` passes the regex and becomes `foreign: 'CustomerSecretAbc123'` in the warning. This is a static counterexample; no production disclosure is claimed. Alphanumeric tokens and organization identifiers can satisfy this grammar. Filtering punctuation prevents some paths/emails but does not enforce “no token or account value.”

The current tests only reject a punctuation-bearing name and accept a conventional class name (`claude-sdk-lane-runner.spec.ts:803`, `:830`), so they do not protect this boundary.

**Fix:** map recognized error categories to fixed literal labels and map every other error to a fixed fallback. Do not emit arbitrary name/constructor strings. Add a regression asserting that an identifier-shaped secret in name never reaches the adapter logger. Make the classification non-throwing for malformed foreign errors; a throwing name accessor must not replace the fixed refusal from the outer catch.

### 2. Minor — the requested refusal matrix lacks the explicit auth-token case

**Evidence:** `libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts:333`; `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts:741`.

The new refusal tables cover OAuth env/fd tokens, API keys, apiKeyHelper, providers and subscription exclusions, but do not explicitly test `tokenSource: 'ANTHROPIC_AUTH_TOKEN'`. The implementation rejects it by exact comparison (`claude-certified-launch.ts:170`); this is a coverage gap, not an observed authentication bypass. Add that named case and prefix/suffix near-misses to pin the stated contract. The added positive lane cases stop at identity comparison (`claude-sdk-lane-runner.spec.ts:726`); they establish passage through the predicate, not a complete successful named run.

## Checked

1. **PASS — acceptance and non-personal exclusion.** `claude-certified-launch.ts:164`–`:193` accepts exactly provider undefined/firstParty, key source undefined/none, token source undefined/claude.ai, and subscription Claude Pro/Claude Max/pro/max. Under the supplied decompiled Ece/nEt/WAn contract, accepting an absent tokenSource is safe **only because a personal subscription must also be present**, and Ece supplies subscription only on its mt() branch. OAuth env/fd sources explicitly fail; ANTHROPIC_AUTH_TOKEN/apiKeyHelper token sources fail; API-key sources fail; third-party providers fail (and an entirely absent account shape also fails for missing subscription); Team/Enterprise/API fail. This relies on the supplied bundled-CLI evidence, not an independent execution or decompilation.
2. **PASS — exact matching.** Equality and Set.has at `claude-certified-launch.ts:130`, `:170`–`:180` are case-sensitive. No prefix/substring acceptance or coercion exists. Unknown, empty, null or non-string subscription values cannot satisfy the set.
3. **PASS — shared predicate and certifier vocabulary.** Main chat calls the shared pair at `session-query-executor.service.ts:613`; lane calls it at `claude-sdk-lane-runner.ts:629`. Both still compare the identity reference afterward (`:615` and `:637`). `CLAUDE_PERSONAL_SUBSCRIPTIONS` remains exactly pro/max at `claude-certified-launch.ts:93`; display values are a separate constant at `:101`. Barrel exports were added without widening that original constant (`libs/backend/agent-sdk/src/index.ts:455`).
4. **PARTIAL — diagnostics.** Subscription classification uses a closed map/fallback at `claude-certified-launch.ts:117`, `:175`; returned checks are booleans. Phase/step/interrupt are fixed assignments in `claude-sdk-lane-runner.ts:477`, `:497`, `:502`, `:624`. The foreign name is the exception: finding 1. No email/organization value or error.message is directly added by the diff.
5. **PASS with finding 1's boundary caveat — refusal behavior.** Lane login failures still throw identity-unproved at `claude-sdk-lane-runner.ts:630`; main chat does so at `session-query-executor.service.ts:613`. Splitting version/key-source checks preserves their code (`claude-sdk-lane-runner.ts:754`–`:759`). The supplied diff adds no catch blocks, so there are no new catch sites needing degradation-audit markers. The adapter still disposes then maps and throws a refusal (`claude-cli.adapter.ts:279`–`:292`).
6. **PARTIAL — tests.** Shared acceptance/refusal and fixed subscription mapping tests exist at `claude-certified-launch.spec.ts:294`–`:387`; lane tests include the bundled shapes and failure diagnostics at `claude-sdk-lane-runner.spec.ts:726`–`:834`. Findings 1–2 identify missing regressions. The supplied additions contain no process.cwd() or module-namespace spyOn. Existing spies target object instances (mailbox, AbortSignal and runner), not module namespaces. No tests were executed in this review.

## Five logic questions

1. **How can this fail silently?** A named run refuses correctly while its warning quietly contains an arbitrary identifier-shaped error name (finding 1; adapter:286). No success-looking authentication fallback was found in the predicate.
2. **What user action produces unexpected behavior?** Starting a named lane whose SDK/store dependency rejects with a data-bearing error name produces that disclosure (adapter:279). Personal Pro/Max sign-in now reaches the existing identity check rather than being rejected solely for omitted tokenSource (lane runner:629).
3. **What data produces a wrong answer?** An identifier-shaped arbitrary name is incorrectly classified as safe diagnostic class data (lane runner:426). No non-personal acceptance counterexample was found within the supplied CLI reporting contract; missing subscription fails (certified launch:180).
4. **What if a dependency fails, times out or returns a bad shape?** The account-info await rejects into the adapter catch; deadlines set the fixed interrupt and abort (lane runner:493–505). Unknown fields fail exact checks; a null account object throws on access rather than gaining admission (certified launch:167). The adapter normally converts foreign failures to identity-unproved (adapter:285–292). Diagnostic property access itself is not insulated from a throwing name getter (lane runner:426).
5. **What is missing from the requirements?** A trusted definition of “error class name.” The brief excludes secret values but does not distinguish a mutable name field from a fixed category. Enforce that distinction at lane runner:417. Future SDK reporting changes remain a compatibility uncertainty; accepting new subscription vocabulary should require new evidence, not heuristic matching (certified launch:130).

## Failure mode and data flow

**FM1 — foreign-error data crosses the diagnostic boundary.** Trigger: a launch dependency rejects with an Error whose name is a sensitive identifier. Symptom: refusal warning contains the identifier. Current handling: regex accepts it (lane runner:426), adapter logs it (adapter:290). Recommendation: closed categories with a fixed unknown fallback and an adapter-level leak regression.

Normal flow: named admission → certified bootstrap → shared personal-login check → identity comparison → final child → version/key-source checks → binding/metadata persistence → repeated identity check → prompt gate. Relevant ordering is retained at `claude-sdk-lane-runner.ts:620`, `:671`, `:741`, `:754`, `:768`, `:808`, `:820`, `:855`. The changed code adds no persistent writes or new shared mutable admission state. Lease retention and concurrency behavior are outside this bugfix's changes and are not re-approved here.

## Decisions

- Treat the supplied decompiled bundled-CLI behavior as the authoritative input for this focused review; alternative: independently run/decompile Claude. Evidence: explicit root-cause excerpt and prohibition on CLI execution. Reversible by further read-only evidence.
- Request revision of the logging boundary without changing the correct login acceptance set. Alternative: accept identifier filtering as sanitization. The concrete counterexample at lane runner:426 defeats that alternative. Reversible localized formatter/test change.
- Do not repeat checks after diagnostics returned unavailable; preserve the no-tests/builds constraint and report the verification limit.

## Verdict

**REVISE, 6/10.** Fix finding 1 before approval. Add the small refusal regression from finding 2. Confidence is high in the predicate truth table and logging counterexample; full lifecycle and live Electron behavior were not independently verified.

