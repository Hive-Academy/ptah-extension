# B1c Chat Timeout Investigation

## Question and decision

Does the chat test timeout plausibly arise from the onboarding changes, a test lifecycle or import issue, or execution contention?

The decision is whether TASK_2026_ONBOARDING needs a code change before verification continues. The evidence does not support an onboarding code change. It supports a timing-sensitive async failure, with execution contention as a plausible contributor. The original cause remains unproven.

## Proven facts

1. The saved failure is a 5000 ms Jest timeout, not an assertion mismatch. Jest identifies the test at `chat-transcript.display.spec.ts:391` and provides no later application stack frame (`/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/15631162254550893547:16-38`).
2. The full chat run passed 5301 tests, skipped two, and failed this one test. It ran 300 suites in 541.678 seconds (`/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/15631162254550893547:69-73`).
3. Jest also reported a worker that did not exit gracefully. The warning does not name an open handle or connect the handle to this test (`/home/amun/.nx/8b7110c7390b9603/cache/terminalOutputs/15631162254550893547:40`).
4. The coordinator's isolated rerun used the required scoped verification command with a test path filter (`/tmp/onb-chat-isolated.log:2-3`). It passed all 15 tests in the spec (`/tmp/onb-chat-isolated.log:40-48`).
5. Before the isolated run started, two verification slots were held. Free memory was then between 7.0 and 7.5 GB, below the 8.0 GB threshold for a second run (`/tmp/onb-chat-isolated.log:5-15`). These observations apply to the rerun period, not directly to the earlier failure.
6. The timed-out test is the first test in this spec file. It uses the real root loader and then awaits `settle` (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts:377-398`).
7. `settle` performs four rounds of change detection, `fixture.whenStable()`, and a zero-delay timer (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts:333-342`). The test has no explicit timeout override (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts:391-415`).
8. The spec resets the RPC mock and console spy. Its `afterEach` restores the spy and resets the Angular testing module (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts:380-388`).
9. The root loader calls the real dynamic import of `@ptah-extension/chat-ui/turn-recap` (`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-recap-loader.ts:46-50`). Its wrapper shares an in-flight promise and clears a rejected attempt (`libs/frontend/chat/src/lib/components/organisms/transcript/transcript-turn-recap-loader.ts:23-37`).
10. The spec's import list contains chat, core, markdown, and shared modules. It contains no onboarding module or webview application import (`libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.display.spec.ts:53-108`).
11. A targeted `git diff` showed no uncommitted changes to the spec, loader, or transcript harness. A targeted `git diff --name-only main...HEAD -- libs/frontend/chat` listed only provider settings, credentials settings, and `settings-embed.ts`. It did not list the transcript spec, loader, harness, or component.

## Ranked root-cause hypotheses

### 1. Execution contention exposed a timing-sensitive async test — medium confidence

The real dynamic import and Angular stability waits can exceed 5000 ms when a worker receives insufficient CPU or memory time. The long full run and the single timeout are consistent with this mechanism. The isolated pass and the observed lock and memory pressure also support it.

This is not a proven cause. The saved failure has no CPU, memory, or event-loop measurements. The isolated run also had a different scope and execution order.

### 2. A test lifecycle or import interaction delayed completion — medium-low confidence

The test awaits a real lazy import and Angular stability. A delayed chunk, cross-file worker state, or an unfinished async task could keep `settle` unresolved. The worker exit warning makes an open-handle investigation reasonable if the failure repeats.

The isolated pass rules out a deterministic broken import in this spec. It does not rule out an order-dependent interaction. The warning alone does not prove a teardown defect in this test.

### 3. The onboarding changes caused the timeout — very low confidence

The targeted branch diffs are disjoint from the transcript test and loader. The spec has no onboarding or webview application import. No evidence connects the onboarding code to this async wait.

This ranking is not a categorical proof of independence. It is the supported conclusion from the targeted import and diff evidence.

## Relationship to TASK_2026_ONBOARDING

No task relationship was found. The current task changes the onboarding library and webview routing. Its uncommitted changes do not touch the chat transcript test, loader, or harness. The branch's chat changes concern provider and credentials settings, not the transcript display path.

The evidence does not establish that the failure is pre-existing or flaky. Those labels require recurrence or baseline evidence that this investigation does not have.

## Recommended next step

1. Keep the test, loader, timeout, and onboarding code unchanged for now.
2. Have the coordinator repeat the original scoped check with `npm run verify -- -t test -p @ptah-extension/chat` and preserve its log.
3. Treat the isolated pass as evidence against a deterministic task regression, not as proof of flakiness.
4. If the same test times out again, capture open-handle and timing evidence under the scoped verification command. Do not increase the timeout before that evidence exists.

## Decisions

- **Decision:** Rank contention-sensitive async timing first. **Options:** onboarding regression, lifecycle or import defect, execution contention. **Evidence:** isolated pass, real dynamic import, full-run timeout, and observed resource pressure. **Reversible:** yes, if a scoped rerun reproduces the failure.
- **Decision:** Make no code or configuration change. **Options:** change the loader, increase the timeout, or preserve the implementation. **Evidence:** no deterministic failure or onboarding dependency was found. **Reversible:** yes.
- **Decision:** Use the coordinator's completed isolated run instead of another test run. **Options:** read the existing result or execute a duplicate run. **Evidence:** the completed log contains a definitive pass. **Reversible:** yes.

## Limitations

- No test was run during this investigation.
- The original run has no resource telemetry, worker assignment history, per-test timing trace, or open-handle report.
- The isolated run does not reproduce the original suite order or load conditions.
- The targeted Git comparison reported multiple merge bases and used `fd2fcb9fe829dc69b7f127a6ddb90b668e602023`.
- The later overall-check stop and interrupted typecheck were outside this bounded question.
