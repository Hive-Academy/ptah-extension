# Code-logic review — SDK readiness gate (7b941759f)

Reviewer: antigravity gemini-3.1-pro (cross-family)

## Verdict: REVISE (2/10)
Wrong at the foundation. The record-mode gate will hang and time out on every run because initialization is never triggered, and the redaction regex completely fails on JSON-formatted secrets. 

### Five logic questions
1. **How does this fail silently — where does a failure produce a success-looking result?**
The `caseLimit` option shrinks the suite size without being reported in the output. If a committed CI plan includes `caseLimit: 1`, the suite will silently pass based on a single case instead of the full suite, producing a success-looking result for an incomplete benchmark.
2. **What user action produces unexpected behaviour?**
Running the benchmark in record mode (`cassetteMode === 'record'`) will always time out after 60 seconds. The `waitForSdkReady` loop polls `adapter.getHealth()` waiting for `'available'`, but since the bench host is booted with `requireSdk: false` and `adapter.initialize()` is never called, the state remains permanently `'initializing'`.
3. **What input data makes this produce a wrong answer rather than an error?**
Log files containing JSON-formatted secrets (e.g., `{"access_token":"secret"}`). The redaction regex `/(...)\s*[:=]\s*/` expects a colon or equals sign immediately after the key. It completely misses JSON keys that are followed by quotes (e.g., `token":`), leaking the secrets in plain text into the benchmark logs.
4. **What happens when a dependency fails, times out, or returns a shape it should not?**
If reading or writing the log file in `retainHostLog` fails (e.g., due to a missing directory, file locks, or permission issues), it throws an exception inside the `finally` block of `runMemorySkillsHost`. This masks the original benchmark error and completely skips `await host.stop()`, causing the MCP server and engine teardown to leak. Additionally, if the `ICuratorLLM` uses a different provider (like Codex) than the primary SDK adapter, the Anthropic adapter becoming 'available' does not guarantee the curator's provider is ready, risking curator failure right after the gate passes.
5. **What is missing that the requirements never mentioned?**
The new SDK readiness gate logic (`waitForSdkReady`), the `retainHostLog` file operations, and the `redactLogSecrets` regex completely lack test coverage. The commit only added specs for `caseLimit`.

## Defects

1. **[Blocking] SDK adapter initialization is never triggered.**
   - **File:** `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:397-403`
   - **Problem:** `waitForSdkReady` loops polling `adapter.getHealth()` but `adapter.initialize()` is never called. Because `bootCodeExecutionHost` boots with `requireSdk: false`, the SDK adapter remains in `INITIAL_HEALTH` (`'initializing'`) forever, causing the 60-second loop to always time out and fail the benchmark in record mode.
   - **Fix:** Either call `adapter.initialize()` within `waitForSdkReady` before starting the loop, or have the host script trigger it if it requires it.

2. **[Blocking] Redaction regex leaks JSON-formatted secrets.**
   - **File:** `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:439` (and `recorded-curator-llm.ts:245`)
   - **Problem:** The regex `/(authorization|api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi` assumes keys are followed by a colon or equals sign. It fails to match JSON formats like `"access_token":"my-secret"` because the key is followed by a quote (`"`), not a colon or space. This causes JSON payloads to leak secrets entirely unredacted. It also ignores `cookie` headers.
   - **Fix:** Update the regex to handle JSON quotes around keys and values (e.g., matching `"\s*[:=]\s*"?`). Add `cookie` and `session` to the captured names.

3. **[Serious] Exceptions in `retainHostLog` mask errors and leak resources.**
   - **File:** `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:388` and `419-420`
   - **Problem:** In the `finally` block of `runMemorySkillsHost`, `retainHostLog` uses `writeFileSync` and `readdirSync` without try-catch blocks. If a file operation fails (e.g., permissions), it throws, masking the benchmark's original error and skipping `await host.stop()`, which leaks the MCP server and engine connection.
   - **Fix:** Wrap the entire body of `retainHostLog` in a try-catch block, ensuring it never throws.

4. **[Serious] `caseLimit` can silently shrink CI benchmark plans.**
   - **File:** `tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.ts:626`
   - **Problem:** `caseLimit` shrinks the suite via `planned.slice(0, options.caseLimit)`. It is not prominently logged or reported in the suite output. If accidentally added to a committed plan, CI will pass despite only evaluating a fraction of the suite.
   - **Fix:** Validate that `caseLimit` is only used for local diagnostic probes, or add a prominent warning to the suite's metrics output when the suite has been artificially shrunk.

5. **[Moderate] SDK readiness gate may observe the wrong provider.**
   - **File:** `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:401`
   - **Problem:** `waitForSdkReady` specifically checks the health of `SDK_TOKENS.SDK_AGENT_ADAPTER`. If the curator is configured to use a different provider (e.g., `openai-codex`), the primary adapter becoming `'available'` does not mean the curator's provider is ready.
   - **Fix:** Check the provider specifically requested by the curator, rather than only the primary adapter.

6. **[Moderate] Untested core logic.**
   - **File:** `tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts`
   - **Problem:** The new specs only test the `caseLimit` functionality. There are no tests verifying `waitForSdkReady`, `retainHostLog`, or the broken `redactLogSecrets` regex.
   - **Fix:** Add unit tests for these functions.

## Checked and OK
- `caseLimit` correctly limits the cases returned and is properly tested.
- `lastFailureMessage` from `RecordedCuratorLlm` is redacted correctly (modulo the regex flaw).
- The `double.lastFailureMessage()` is properly appended to `curator-error` when `failureDetail` exists.
- The `caseLimit` correctly slices deterministic seeded cases in plan generation.
