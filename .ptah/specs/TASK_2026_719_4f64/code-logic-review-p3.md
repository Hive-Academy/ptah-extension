# P3 code-logic review

Verdict: **REVISE**

Score: **6/10**

Review family: reviewer **codex**, implementer **Claude**.

Scope: the `libs/` changes in 00977beff, 5543e9588, 0f2298e7a, c9df5c17a and 9de15a9ee, with surrounding call paths and revision-4 requirements. No source files or git state were intentionally changed by this review.

## Findings

1. **Serious — The lane never validates init `apiKeySource`.**

   File: `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:638`.

   The final init branch checks only `claude_code_version`. A child whose `accountInfo()` reports the expected personal identity, but whose init reports an API-key source (or omits the field), proceeds through commit, attachment and task release. Revision 4 requires both independent checks; an acceptable account-info response does not replace the init-source tripwire. The adapter test fixture at `claude-cli.adapter.spec.ts:606` supplies a version without an init key source, masking this omission.

   Fix: require init `apiKeySource` to be exactly `none` or `oauth`, otherwise close/refuse `identity-unproved` before commit and task release. Test both accepted values, missing source and a disallowed source with otherwise valid account-info evidence.

2. **Serious — Omitted named-lane resume cannot reach the named lifecycle.**

   Files: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:518`, `:803`; `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:278`.

   Resume without a selection skips the workspace reader and produces no `accountAdmission`. The resume gate restores the bound account reference, and the manager forwards that reference alone. `prepareNamed()` explicitly refuses binding fields without an admission request. Thus a valid bound lane resumed with the recommended omitted selection fails before SDK startup instead of keeping its account. The B14 test at `agent-process-manager.account-binding.spec.ts:700` checks only that admission is undefined against a mocked adapter; it does not exercise the real rejection.

   Fix: after authoritative resume resolution, derive the named admission from the session's stored binding (including its run ID and the requested working directory), or make the adapter resolve that binding and construct admission itself. Do not read the current workspace default. Add a manager-to-real-adapter test proving omitted resume succeeds, reuses the binding and does not create another run binding/lease.

3. **Serious — Explicit conflicting named selection is silently replaced on lane resume.**

   File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/claude-cli.adapter.ts:322` (manager forwarding at `agent-process-manager.service.ts:516`).

   Resume a session bound to A with an explicit selection of B. B14 forwards B, but `prepareNamed()` spreads the request and then overwrites its selection with stored A, without comparing the two. The task can execute on A although the caller explicitly requested B. The later route comparison sees A on both sides and cannot detect the conflict.

   Fix: validate explicit selection against the authoritative stored binding before admission. Refuse `conflict` for another named profile or explicit ambient; preserve omitted/same-account resume. Keep explicitness through the manager-to-adapter boundary, and cover all four cases with the actual adapter.

4. **Serious — Main-chat admission certifies and runs the account folder instead of the project.**

   File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:713`.

   The request omits `workingDirectory`. `provider-account.service.ts:132` consequently certifies `route.canonicalPath`; `sdk-query-options-builder.ts:1161` then uses `launch.cwd` in place of `sessionConfig.projectPath`. A named chat opened on a repository runs in its credential/account directory, with the wrong project/local settings and working tree. Relative file operations can target the account directory. This is a functional and safety issue, not just a diagnostic discrepancy.

   Fix: pass the session's resolved project path into bootstrap/admission as `workingDirectory`, before certification. Test distinct account and project directories and assert the admission request, certified policy scan and final query all use the project directory. Never repair only the final options after certification.

5. **Moderate — Lane rejects the explicitly allowed account-info source `none`.**

   File: `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.ts:345`.

   `personalClaudeLogin()` requires `apiKeySource === undefined`. An otherwise valid personal login whose account-info source is `none` is refused as `identity-unproved`, although revision 4 explicitly allows absent or `none`. Main chat already implements that allowance. The lane tests exercise forbidden sources but omit this valid variant.

   Fix: accept undefined or `none` at the account-info tripwire, separately from the init-source allowlist. Add a successful bootstrap/final lifecycle case with `apiKeySource: 'none'`.

6. **Serious — Newly enabled named main-chat path logs raw child diagnostics.**

   File: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1452`, especially `:1483`.

   Named final options retain the ambient stderr callback, which interpolates every CLI stderr chunk into error/warn/debug logs. A diagnostic containing a config path, email, organization ID or credential therefore escapes unchanged, including before admission completes. The lane already uses a fixed diagnostic message for named children. The callback itself predates this change, but B15 now enables named chat to reach it; B13 does not provide the named-path protection.

   Fix: branch on the named route and emit only fixed, sanitized diagnostic classifications. Preserve ambient behavior. Test adversarial stderr values and assert they do not appear in logger/RPC calls, including during failed admission.

7. **Moderate — Missing main-chat persistence reports `release-held` rather than `unavailable-storage`.**

   File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:1019`.

   With the intentionally null persistence binding until B17, an explicit named main-chat run refuses `release-held` before acquiring a reservation. The same misleading result persists on hosts without storage. There is no held run to recover; the promised typed result is `unavailable-storage`.

   Fix: return `unavailable-storage` for unavailable admission/persistence ports. Keep `release-held` for actual unresolved lifecycle/settlement conditions. Test the executor with each port missing and assert no admission/query call.

## Decisions

- **Gap (a): confirmed; revise.** Finding 7 is a typed-contract defect, although it fails closed and releases no conversation. B17 wiring will hide it on Electron but will not correct unsupported-host behavior. The B13 report's choice to group missing ports with generic plumbing failures is not consistent with the B15 safety requirement.
- **Gap (b): confirmed; revise before enabling named runs.** Finding 4 affects both working-tree behavior and the directory whose settings are certified.
- **D27: accept the policy, reject the incomplete implementation.** An omitted resume must retain the session account and must not consult a newer workspace default. Skipping the default read is correct, but passing a binding without the required admission request makes that resume fail. Explicit selections must also be checked rather than discarded (findings 2–3).
- D21 runner deletion is coherent with B13 ownership. The ambient runner env entries remain the same after removing the wrapper. Named model discovery returns an empty catalog without a launch and uses the certified env/cwd/executable with one, as B11 specifies.
- Both run owners await boundary checks before bootstrap and final child creation. Main chat validates init version and source. The inspected gates defer conversation consumption until binding/attachment/save and identity verification. Stored-binding branches skip `commitRunBinding`; live main-chat continuation uses its existing owner. Settlement has a single-promise guard, and unproved boundary children cause retention. These positive checks do not resolve the findings above.
- B15's shared gate resolves fresh/bound selections, rejects bound conflicts, and forwards named selection through resume and slash relaunch. The adapter's live omitted/same-account policy is reasonable because the owner revalidates before each admitted turn.
- No new `process.env` assignment or managed-settings option was found in the reviewed production diffs. The newly injected selection-reader token has an existing registration in `auth-providers/src/lib/di/register.ts:213`. Full host persistence activation remains B17 work.
- Spec quality: useful adversarial boundary and cancellation cases exist, but the init fixture and mocked manager/adapter seam miss findings 1–3. Targeted searches of the central account/run specs found no `process.cwd()` and no module-namespace spies; the observed spies target instances.

## Not checked

- No P2 fix review: 9ba611cde and ad2a09acc were excluded.
- No real Claude, Electron launch, paid probe, build, install, full suite, or broad verification was run. Runtime certification assumptions and real CLI behavior were not independently re-established.
- One scoped command was launched: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts --maxWorkers=2 --silent`. It emitted a TypeScript-config ES-module warning and remained pending at the single completion check. No pass/fail result is claimed; findings are based on static control/data-flow evidence. No suite was rerun.
- This is not an exhaustive logging audit of unchanged subsystems or a complete audit of every existing spec. No claim is made that pending P4 host wiring is complete.
- Source changes to `apps/ptah-cli/src/cli/commands/agent-cli.ts` and its spec appeared during the review from concurrent work. They were not edited or reviewed here.
