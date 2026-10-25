# Batch 22 implementation report

## Summary

Extended all four assigned specs with 33 additional parameter-expanded cases, using their existing fixtures and helpers. No production files or existing assertions were removed or weakened. New describe blocks explicitly label A2 mocked evidence. The main fixture now permits pausing a numbered occurrence of an await, supplying a changed final identity, and explicitly resolving child termination; existing fixture defaults remain unchanged.

Tests were authored but NOT executed, as instructed. Executed-test counts: 0 passed, 0 failed, 33 new cases unexecuted. This is not a runtime pass result. Both projects have existing Jest/ts-jest Node configurations extending the root preset. No Nx, Jest, tsc, lint, build, npm, sign-in, credential mutation, inference, package, serve or e2e command was run. Scoped diagnostics are clean.

## Matrix table

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/`:

- **M**: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
- **E**: `libs/backend/agent-sdk/src/lib/helpers/claude-account-route-env.spec.ts`
- **P**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.account-binding.spec.ts`
- **L**: `libs/backend/cli-agent-runtime/src/lib/claude/claude-sdk-lane-runner.spec.ts`

?Covered? means an authored assertion, not an executed passing test. Existing cases are identified explicitly.

| Case | Spec file:line | Test name | Status |
| --- | --- | --- | --- |
| Distinct simultaneous main route construction | E:353 | keeps simultaneous distinct route construction independent of ambient selectors | covered; concurrent constructors, no SDK launch |
| Distinct overlapping parentless lane bindings | P:405 | keeps two parentless resumed bindings independent while validation overlaps | covered; separate authoritative receipts |
| Distinct lane env snapshots | L:495 | pins the lane route after hostile ambient and auth env without changing prompt or MCP policy | covered |
| Simultaneous main session and lane against one shared authority | M:296 / P:405 | Separate main admission and overlapping lane fixtures | not-covered-with-reason: existing allowed harnesses do not compose main admission and lane admission against a shared authority; no new integration harness permitted |
| Ambient adds no account env | E:345 | adds no account env to a clean ambient constructor | covered; ambient and omitted route, main and one-shot |
| Ambient inherited env unchanged | E:297 | keeps ambient/omitted env byte-equivalent to the existing constructor | covered, existing |
| Final named env wins over later spreads | E:316 / L:495 | applies the named route after all env spreads and preserves permission policy; pins the lane route after hostile ambient and auth env without changing prompt or MCP policy | covered; main, one-shot, lane |
| Rename/default do not replace durable receipt | P:188 | retains the original immutable route through a fresh handoff and label/default changes | covered at receipt seam, existing; no actual registry rename/default mutation simulated |
| Remove/retarget/sign-out refusals | P:388 | refuses %s on a parentless restored lane before context evaluation | covered at authority-result seam; missing-profile, route-changed, identity-unproved |
| Same-identity re-authentication | M:381 | resumes after same-identity re-auth without rewriting the old binding epoch | covered; newer admitted epoch preserves old durable binding |
| Different re-authentication identity | P:388 / M:216 | refuses %s on a parentless restored lane before context evaluation; never downgrades a known final identity mismatch | covered; mocked authority and query mismatch |
| Unknown current identity with known historical binding | M:396 | refuses a previously known resume when the current query identity is unknown | covered; refuses before final options/attachment |
| Old unknown never relabelled known | M:371 / P:377 | never promotes an old unknown binding using a newly known query; rejects an old unknown identity even when the current authority would validate it | covered; no query launch, binding write, attachment or metadata promotion |
| Real rename/default/remove/retarget/sign-out/re-auth service transitions | P:188 / P:388 / M:381 | Receipt and authority-result contracts only | not-covered-with-reason: account lifecycle service is outside these four harnesses; no credential mutation authorized |
| Malformed legacy metadata fails closed | P:138 / P:146 / P:253 | refuses corrupt references before cost evaluation; refuses incomplete or conflicting linkage; retains corrupt restore evidence and refuses instead of returning a retryable released code | covered, existing |
| Run commit failure | M:173 | refuses %s failure without yielding or writing unbound metadata | covered, existing commit row |
| SDK attachment failure | M:173 | refuses %s failure without yielding or writing unbound metadata | covered, existing attach row |
| Metadata linkage failure | M:173 / P:281 | refuses %s failure without yielding or writing unbound metadata; does not retry a failed named persistence checkpoint as ambient | covered, existing |
| No prompt while each write remains pending | M:296 | keeps the prompt pending until %s completes | covered; commit, attach, metadata separately paused |
| Final accountInfo remains pending after writes | M:296 | keeps the prompt pending until %s completes | covered; final-identity:2 explicitly paused |
| Own-query changed identity after writes beats earlier known identity | M:331 | refuses changed own-query identity after durable writes | covered; changed-known and unknown responses; metadata remains original evidence and no prompt yields |
| Stale identity belonging to another live session | M:331 / P:405 | Same-query change and separate lane receipts | not-covered-with-reason: no shared query registry/owner resolver in these fixtures; own-query checks do not certify cross-session discovery |
| Cancellation while admission awaits remain pending | M:313 | ignores late %s completion after cancellation and settles once | covered for lookup, admission, route-current, bootstrap identity, first final identity, init, commit, attach, metadata, post-write route-current and final identity |
| Cancellation at bootstrap close / registry boundary | M:182 | cancels at %s with closed gates and a single settlement | covered, existing synchronous-boundary cases |
| No lease release before final child close proof | M:341 | waits for final child close proof before releasing the lease | covered; close request alone cannot release; explicit termination proof then releases once |
| Uncertain final child retains lease | M:357 | retains an uncertain final child after cancellation without yielding | covered; fake deadline and one retain, no release |
| Uncertain bootstrap / failed launch retains lease | M:193 / M:205 | retains the reservation when bootstrap termination cannot be proved; retains after a %s launch throws with unproved process state | covered, existing |
| Every await of lane admission coordinator itself | L:470 | settles turns and cleans listeners once on named abort even when the stream stays pending | not-covered-with-reason: existing runner fixture supplies an admitted-query object; coordinator acquisition/persistence await matrix lives outside this allowed harness (adapter spec). Runner abort settlement is covered, existing |
| Parentless restored lane | P:214 / P:224 / P:388 | restores bindings without a parent and resolves explicit resume from the registry; looks up parentless explicit resume even without a local lane record; refuses %s on a parentless restored lane before context evaluation | covered |
| No transcript-bearing bootstrap | M:145 | closes bootstrap before final launch, then awaits both durable checkpoints before releasing input | covered, existing; empty prompt, no resume/title/hooks/agents/plugins, empty system/tools/MCP |
| Permission and MCP policy retained | E:316 / L:495 | applies the named route after all env spreads and preserves permission policy; pins the lane route after hostile ambient and auth env without changing prompt or MCP policy | covered; lane callback result, tools, strict MCP, MCP object, permission mode and bypass setting compared |
| Prompt does not disclose account paths or ids | L:495 / M:296 | pins the lane route after hostile ambient and auth env without changing prompt or MCP policy; keeps the prompt pending until %s completes | covered; lane system prompt equals baseline and excludes three identifiers, main yielded message equals original message exactly |
| Electron installed-SDK empty-gate compatibility | M:290 / L:491 | A2 mocked-evidence labels | not-covered-with-reason: no live certification or host execution authorized |

## Defects found

No new production defect established by source inspection. No `todo-defect` cases were added. Unexecuted tests cannot establish runtime correctness or absence of defects. Coverage gaps above are not asserted to be production defects.

## Mocked-evidence vs live statement

All additions are A2 mocked evidence. Registry responses, SDK accountInfo, prompt reads and termination promises are controlled doubles; route brands are already-admitted fixtures. No live SDK, process, filesystem, network, account authentication or paid inference was used by the additions. The tests do not certify installed-SDK empty-gate behavior, physical route ownership, host composition, keychain isolation, or Electron compatibility. D20-D24 admission/certification holds remain unchanged. Electron-first live validation belongs to the authorized certification workflow.

## Decisions

1. **Keep the existing unit/contract seams.** Options: extend existing fixtures or build a new cross-project integration harness. Selected the former because the task explicitly requires existing helpers and no new harnesses. Simultaneous cross-main/lane integration and complete lane coordinator await coverage are explicitly not claimed. Reversible by a later authorized integration batch.
2. **Use numbered await occurrences and deferred termination.** Options: real delays, new fixture, or minimal controls in the current fixture. Selected minimal controls; assertions can distinguish the first final accountInfo from the post-write accountInfo and child close request from termination proof. New main cases use fake timers and deferred promises. Reversible test-only change.
3. **Treat lifecycle outcomes as authority contracts.** Options: mutate credentials/profile storage or inject the already-defined port outcomes. Selected port outcomes plus a newer admitted epoch for same-identity resume. Evidence: LaneResumeGate delegates current-account validation to LaneAccountBindingPort; production service mutation is outside scope. Report distinguishes contract evidence from lifecycle integration. Reversible test-only choice.
4. **Do not run suites.** The explicit task prohibition overrides normal tester execution protocol. Existing project Jest configs identify a viable runner, but runtime/coverage results remain unverified. No infrastructure escalation artifact was created because no runner failure was observed and only this report is authorized.

## Diagnostics result

Called `ptah_get_diagnostics` with exactly the four absolute spec paths. First response: TypeScript check still running after 45 seconds, four files unchecked. Retried once as instructed. Final result: **typescript-compiler; coverage clean; 0 errors; 0 warnings; 0 requested-file or sibling diagnostics**.

`git diff --check` scoped to the four specs completed successfully. No test, type-check CLI, build or lint command was run. The diagnostics tool is the only TypeScript verification performed.
