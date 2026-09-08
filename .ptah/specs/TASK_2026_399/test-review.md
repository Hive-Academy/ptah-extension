## Verdict

REJECT — the six tests pin the reported non-empty resume regression and the frontend branches, but the backend suite omits the explicitly required empty-task resume behavior and therefore accepts the current unconditional removal of the canned fallback.

## Per-test judgement

| Test | Production line pinned | Fails on revert | Verdict |
| --- | --- | --- | --- |
| 1. renders the box when `supportsContinuation` is absent but a `cliSessionId` exists | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:104-105` (`|| !!this.agent().cliSessionId`) | Yes | Strong regression test. Reverting the gate to `supportsContinuation === true` hides the textarea asserted at `agent-continue-input.component.spec.ts:272`. |
| 2. renders nothing when neither capability nor session exists | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:102-106` (the complete `visible` predicate) | No | Not fix-reversion-sensitive: removing line 105 still leaves this fixture invisible. Worthless as a direct regression pin under the question's criterion, though it is a useful negative guard against widening `visible` unconditionally. |
| 3. resumes instead of continuing for a resume-only agent | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:137-139` (session guard plus `supportsContinuation !== true`) | Yes | Strong regression test. Restoring the old expired-only predicate makes the subtitle plain and calls `continueAgent`, contradicting assertions at spec lines 288-299. |
| 4. still continues a supported, unexpired agent | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:137-139` (the bounded `resumesInstead` predicate) | No | Not sensitive to restoring the old expired-only predicate, so it is worthless as a direct fix-reversion pin. It remains valuable paired isolation because it fails if `resumesInstead` is made unconditional. |
| 5. falls back to resume on `unsupported` | `libs/frontend/chat/src/lib/components/molecules/agent-continue-input/agent-continue-input.component.ts:230` | Yes | Strong regression test. Removing only the `unsupported` alternative prevents the resume call asserted at spec lines 330-333 and enters the generic-error branch. |
| 6. hands the SDK the caller task on resume | `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:684` | Yes | Strong for a non-empty task. Reinstating the resume-specific canned value at the mailbox construction makes the first yielded content differ from `task` at spec line 307. Incomplete for the empty-task requirement. |

## Findings

1. **HIGH — The backend regression coverage omits an explicit acceptance case and permits the current implementation to violate it.** `.ptah/specs/TASK_2026_397/task.md:53-63` says not to simply delete the substitution, says an empty resume should retain the canned fallback, and requires a regression test to pin both empty and non-empty tasks. The sole added backend test supplies only a non-empty task at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry-spawn-model.spec.ts:297-307`. Consequently, `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:684` can—and currently does—pass an empty string directly to `createPromptMailbox` without any test failure. Scenario: a resume reaches `spawnAgent(..., '', { resumeSessionId })`; the SDK receives an empty initial user message instead of the prior canned resume instruction.

2. **LOW — Two frontend additions are not independently sensitive to reversion of the changes they are presented alongside.** Test 2 at `agent-continue-input.component.spec.ts:275-281` remains green when the new `cliSessionId` arm at production line 105 is removed. Test 4 at spec lines 302-318 remains green when the old expired-only `resumesInstead` predicate is restored. Under the requested per-test criterion, both are worthless as direct revert detectors. They still have suite-level value as negative/paired guards, especially test 4's protection against an unconditional-resume implementation.

3. **MEDIUM — The newly visible running resume-only path is not exercised.** Existing queue and backend-`busy` coverage at `agent-continue-input.component.spec.ts:67-97` uses `makeAgent()`'s default `supportsContinuation: true`; the new tests never combine `supportsContinuation: undefined`, a `cliSessionId`, and `status: 'running'`. Production lines `agent-continue-input.component.ts:102-106` now expose that combination, while lines 169-171 queue it and lines 120-126 later flush it. Scenario: an antigravity/opencode card remains running, the user queues a follow-up through the newly visible box, then completion should flush by resume rather than strand or continue it. The literal `busy` result branch cannot be reached by an idle resume-only agent because lines 211-213 resume before calling `continueAgent`; the material gap is the running queue-to-resume transition introduced by the widened gate.

## Answers

### Q1

- Test 1 pins production lines 104-105 and fails if the `cliSessionId` arm is reverted.
- Test 2 exercises the full gate at lines 102-106 but survives removal of the new line 105. It is therefore worthless as an independent fix-reversion test, while still guarding against an overbroad gate.
- Test 3 pins lines 137-139 and fails if the old `continuationExpired === true && !!cliSessionId` behavior is restored: both its exact subtitle assertion and routing assertions fail.
- Test 4 exercises lines 137-139 but survives that historical revert. It is worthless as an independent revert detector, but is a legitimate paired-isolation test for an overbroad implementation.
- Test 5 pins line 230 and fails if only `unsupported` is removed, matching the author's mutation reasoning.
- The backend test pins line 684 and fails if resume construction again substitutes the canned string for the non-empty caller task.

The author's mutation reasoning for tests 1 and 5 is sound. The independently reasoned results for the unmutated tests are: test 2 no, test 3 yes, test 4 no for the historical revert, and backend yes.

### Q2

Asserting the first yield is sufficient for the reported substitution defect. `createPromptMailbox` initializes its queue with exactly one message made from `initialTask` at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-prompt-mailbox.ts:23-24`; later yields can arise only from explicit `push(message)` calls at lines 58-63. The registry's only push passes a future continuation caller's message at `ptah-cli-registry.ts:818-824`; no mailbox code can synthesize the canned string later. Thus a later hidden canned yield is not possible in this harness.

The test does set `resumeSessionId: 'prev-session-1'` at `ptah-cli-registry-spawn-model.spec.ts:299-301`, so it exercises the branch that was broken. Its deficiency is different: it covers only the non-empty half of TASK_2026_397.

### Q3

Yes. If `resumesInstead` were unconditional, test 4's supported, unexpired fixture at spec lines 305-310 would route through `sendByResuming`; the expected exact plain subtitle at line 312, expected `continueAgent` call at line 317, and expected absence of a resume call at line 318 would all fail. Test 4 therefore genuinely supplies the paired isolation claimed for test 3, even though it is not sensitive to restoring the historical predicate.

### Q4

Frontend mock hygiene is sound. There is no `beforeEach`, but every test calls `setup`, which creates fresh `continueAgent` and `resumeAgentWithMessage` mocks, resets and reconfigures `TestBed`, creates a new fixture, sets its input, and runs change detection at `agent-continue-input.component.spec.ts:33-49`. The one pre-existing test that invokes `setup` twice (`:254-261`) also resets the module between fixtures. The new block does not retain component signals or mock implementations across tests.

Backend isolation is also sound. `buildHarness` allocates `capturedOptions`, `capturedPrompt`, `queryFn`, logger, registry, and all dependency mocks in a new closure for each call at `ptah-cli-registry-spawn-model.spec.ts:78-154`. Every pre-existing test and the new test constructs its own harness. The new prompt consumption cannot affect the model-capture tests, and the new describe has no shared hooks or mutable capture state.

### Q5

- Missing and blocking: no empty-task resume test, despite `.ptah/specs/TASK_2026_397/task.md:61-63` requiring both empty and non-empty prompt behavior.
- Missing: no newly visible running resume-only agent test that queues while running and flushes through `resumeAgentWithMessage` when idle. The existing `busy` response test covers a continuation-capable agent, not the widened gate. An idle resume-only agent cannot itself reach the `busy` response branch because `resumesInstead` bypasses `continueAgent`.
- Already covered outside the new block: `agent-continue-input.component.spec.ts:226-251` covers `sendByResuming` finding no usable session—both no `cliSessionId` and a handler-level `no such session file` failure—and verifies draft restoration/error reporting. What is not combined is that failure with the new `supportsContinuation: undefined` visibility case.
- Subtitle text is pinned, not merely inferred from routing: test 3 asserts the full resume subtitle at spec lines 288-290, and test 4 asserts the full plain subtitle at line 312. The older test at lines 254-261 also checks both subtitle modes, although its resume assertion uses `toContain`.

The test report's `Gaps: None` claim at `.ptah/specs/TASK_2026_399/test-report.md:112-114` is therefore unsupported.
