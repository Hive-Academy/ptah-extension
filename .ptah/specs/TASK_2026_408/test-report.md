# Test Report - TASK_2026_408 (Final QA, phases 1-2)

Worktree `D:\projects\ptah-extension-task-408`, branch `fix/task-408-codex-proxy-phase-1-2`, HEAD `f29e56974`, all 11 batches committed. This pass added two test-only files for the deferred Batch 6 review coverage and ran every scoped project's `test`, `lint`, `typecheck`. No production code was changed in this pass.

## Scope

- User request: Final QA for TASK_2026_408 phases 1-2 — scoped suite runs, the deferred raw-byte parity cases from `code-logic-review-b6.md`, and a test-report with exact counts, acceptance-criterion mapping, MOCKED/LIVE split and known limits.
- Criteria tested: the five criteria named in the launch brief, taken from `implementation-plan.md`'s "Test specifications (by acceptance criterion)" table (lines 489-506) — see the mapping table below. Extracted reading: the brief's "acceptance criteria 1-5" are read as the plan's five architecture-level functional requirements (implementation-plan.md:474-479): (1) overflow maps to the prompt-too-long contract on both paths; (2) every terminal-table row yields the same outcome on all three response paths; (3) aliased tool names never reach the SDK; (4) no `tool_use.input` is fabricated `{}`; (5) block indexes are unique and dense. Each is already pinned by the batch-level unit/HTTP/integration specs shipped in Batches 1-6, 9 and 11; this pass re-ran them and added the two deferred raw-byte cases on top.
- Regressions covered: Batch 11's error-first streaming fix (S6b) was already pinned by `code-logic-review-b9-b11-r1.md`'s approval and by `translation-proxy-base.spec.ts` / `translation-proxy.sdk.integration.spec.ts`; this pass re-ran both and both are green.
- Review findings covered: `code-logic-review-b6.md`'s deferred minor coverage note — Codex retry and text-only checks compared parsed bodies rather than raw bytes, and OpenCode's full text-only/retry byte comparisons covered only one of its two lanes (Zen or Go) each. Fixed by the four new/changed test cases below (test-only; see "New tests added").
- Deliberately not tested: no production code changed, so there is no new behaviour to test beyond the deferred coverage; no live-provider probe (phase-3 probe P7 not authorized, per Gate 2 and the plan's Assumption A1/A5 notes); no re-litigation of already-APPROVED review rounds.

## MOCKED vs LIVE

- `translation-proxy.sdk.integration.spec.ts` (Batch 9/11): **REAL** pinned `@anthropic-ai/claude-agent-sdk@0.3.278` `query()`, **REAL** platform CLI binary it spawns, **REAL** `CodexTranslationProxy` running in-process. **MOCKED**: the upstream Responses HTTP server only (plain `http.createServer`, scripted by request content).
- `codex-stream-parity.spec.ts` / `opencode-translation-proxy.spec.ts` (this pass's new cases and all existing HTTP-level specs): **REAL** `CodexTranslationProxy` / `OpenCodeTranslationProxy` instances and a **REAL** loopback HTTP server standing in for upstream; the "upstream" responses are scripted fixtures, not a live provider.
- **LIVE provider checks: none.** No call ever reaches `api.openai.com`, `chatgpt.com`, or any real OpenCode/Codex endpoint. Live probe P7 (overflow message-pattern verification) remains unauthorized (Gate 2 / plan Assumption A1).

## Suites

### `codex-stream-parity.spec.ts` — integration (real proxy + loopback HTTP, mocked upstream)

- Requirement: Codex tool-result image translation and raw-wire parity across the 401-retry and text-only cases (deferred from `code-logic-review-b6.md`).
- Cases added/changed:
  - `run()` now returns both `parsed` (JSON.parse'd bodies) and `raw` (the literal wire strings), and accepts an optional request override.
  - "resends the same image array on the 401 refresh retry" now asserts `raw[1] === raw[0]` (byte-for-byte, not just structurally-equal parsed objects) in addition to the existing parsed-object check.
  - New case "sends a text-only tool_result byte-identical to the translator output": builds a text-only tool-result request, sends it through the real `CodexTranslationProxy`, and asserts the exact upstream wire body equals `JSON.stringify(guardResponsesToolNames(translateAnthropicToResponses(request, {modelPrefix:''})).request)` — the same byte-identity pattern OpenCode's spec already used.
- Files: `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\codex\codex-stream-parity.spec.ts`

### `opencode-translation-proxy.spec.ts` — integration (real proxy + loopback HTTP, mocked upstream)

- Requirement: the byte-identity text-only and 401-retry checks (previously proven for only one of OpenCode's two lanes each) now cover both.
- Cases added/changed:
  - "sends a text-only tool_result byte-identical to the translator output" converted from a Zen-only `it` to `it.each(['opencode-zen','opencode-go'])`, so the raw-wire byte comparison against the translator's own output runs on both lanes.
  - "resends the same placeholder string on the 401 refresh retry" converted from a Go-only `it` to the same `it.each`, so the byte-identical resend assertion (`requests[1].raw === requests[0].raw`) runs on both lanes.
- Files: `D:\projects\ptah-extension-task-408\libs\backend\auth-providers\src\lib\providers\opencode\opencode-translation-proxy.spec.ts`

No other test files were added or modified in this pass.

## New tests added (net count)

- `codex-stream-parity.spec.ts`: +1 test ("text-only byte-identical") plus a strengthened assertion (raw-byte check) on the existing retry test (no new test, same test).
- `opencode-translation-proxy.spec.ts`: +1 test each on two existing single-provider tests (each became a 2-row `it.each`): +2 tests.
- Total: **+3 tests** in `@ptah-extension/auth-providers` (1315 → 1318 in the clean rerun below, an exact match).

## Acceptance criteria mapping (implementation-plan.md:474-479, 489-506)

| # | Criterion | Proving spec(s) | Result |
| - | --- | --- | --- |
| 1 | Overflow (HTTP and streamed) maps to the exact prompt-too-long contract on every lane | `responses-error-mapping.spec.ts`, `translation-proxy-base.spec.ts` (both `stream` values), `responses-stream-translator.spec.ts`, integration S6a/S6b | **PASS** — re-run green (see Execution) |
| 2 | Every terminal-table row (`completed`, `incomplete`×reason×tool-arg-validity, `failed`, standalone `error`) yields the same outcome on the streaming, forced-SSE-collector and JSON paths | `responses-stream-collector.spec.ts` + `translation-proxy-base.spec.ts` shared `it.each` parity table | **PASS** |
| 3 | Aliased/long tool names never reach the SDK; round-trip through history and replay | `responses-tool-names.spec.ts`, `translation-proxy-base.spec.ts`, integration S5 | **PASS** |
| 4 | No `tool_use.input` is a fabricated `{}` unless upstream sent `{}`; args-only-in-`.done` and delayed-name cases are exact | `responses-stream-translator.spec.ts` (installed `MessageStream` accumulator cases) | **PASS** |
| 5 | Block indexes are unique and dense for interleaved tool calls | `responses-stream-translator.spec.ts` (existing index-allocation cases, `:274-386` behaviour preserved) | **PASS** |

All five were already established by Batches 1-6/9/11 and APPROVED in their respective code-logic reviews; this pass's job was to re-verify them still hold and to close the one deferred coverage gap (raw-byte parity), which the two edited spec files above now do.

## Execution

### Scoped run 1 — `npx nx run-many -t test,lint,typecheck -p @ptah-extension/auth-providers @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime ptah-cli --parallel=2 --skip-nx-cache --outputStyle=stream`

First pass (before the two edited spec files were fixed) failed on 3 tasks: a typecheck error in the then-unfinished `codex-stream-parity.spec.ts` new case (fixed — see "Failures" below), plus the two flaky/environment items also seen later. Superseded by the per-project reruns below, which are the numbers of record.

### Per-project reruns (`--skip-nx-cache`, after the typecheck fix)

| Project | Command | Test result | Lint | Typecheck |
| --- | --- | --- | --- | --- |
| `@ptah-extension/shared` | `nx test` | 81 suites / 2202 tests passed, 0 failed | 0 errors | 0 errors |
| `@ptah-extension/agent-sdk` | `nx test` | 122/124 suites passed (2 skipped) / 2255 tests, 2252 passed, 3 skipped, 0 failed | 0 errors | 0 errors |
| `@ptah-extension/auth-providers` | `nx test` (clean rerun, no concurrent jobs) | **53/53 suites, 1318/1318 tests, 2/2 snapshots passed, 0 failed** | 0 errors | 0 errors |
| `@ptah-extension/cli-agent-runtime` | `nx test`, normal TEMP | 67/68 suites passed, 1 suite (agent-role-resolver) failed; 1190/1208 tests passed, 17 failed, 1 skipped | 0 errors | 0 errors |
| `@ptah-extension/cli-agent-runtime` | `nx test`, isolated TEMP (see below) | Same: 67/68 suites, 1190/1208 tests, 17 failed, 1 skipped | n/a | n/a |
| `ptah-cli` | `nx test` | 68/69 suites passed (1 skipped), 1098/1101 tests passed, 3 skipped, 0 failed | 0 errors, 136 warnings (all `@typescript-eslint/no-non-null-assertion` in test files, plus one `no-useless-assignment` and one `preserve-caught-error`; all pre-existing, not touched by this task) | 0 errors |
| `@ptah-extension/output-styles` (targeted guard) | `nx test --testPathPattern=output-style-activation.resolver` | 9/9 suites, 250/250 tests passed (served from Nx cache; flag accepted, not forced) | — | — |

`auth-providers` was flaky under concurrent load: an interleaved run (while other scoped projects were also compiling/testing) additionally failed `opencode-translation-proxy.spec.ts`'s "times out native upstream requests without retrying" (a timing-based test) and the integration spec's Windows tree-kill CIM check. A subsequent **clean, isolated rerun** (no other jobs in flight) passed all 53 suites / 1318 tests, and Nx itself flagged the task as flaky (`Nx detected a flaky task`). Both transient failures are timing/OS-process sensitive tests, not caused by the two new spec files (neither touches those tests), and are recorded here as flaky rather than defects.

### `cli-agent-runtime` isolated-TEMP finding (differs from `integration-observations.md`)

The Batch 9 note claims the 17 `agent-role-resolver` failures come from a stray `C:\Users\abdal\AppData\Local\Temp\.claude` folder and that "the suite passes with an isolated TEMP." This pass could **not reproduce that fix**:
- Normal TEMP: 17 failures (matches the documented count).
- `TEMP`/`TMP` set to a fresh, empty POSIX-style temp folder: same 17 failures, identical failure text.
- `TEMP`/`TMP` set to a fresh, empty native Windows-style path (`D:\projects\ptah-extension-task-408\.tmp-qa-isolated`): same 17 failures, identical failure text.
- Root-cause note from reading `agent-role-resolver.service.spec.ts`: the suite's `beforeEach` calls real `mkdtempSync(join(tmpdir(), 'ptah-role-resolver-'))` and creates a real `.git` marker inside it, but `resolve()`/`listRoles()` are exercised against a fully in-memory fake `IFileSystemProvider` keyed by the same path strings. The stray `C:\...\Temp\.claude\{commands,skills}` folder (confirmed still present, both empty) shares no path segment with the fake-fs keys (`{workspaceRoot}\.claude\agents`) and there is no `os.tmpdir()`/`homedir()` read anywhere in `agent-role-resolver.service.ts` itself. The actual failure (`listRoles` and every `resolve()` case returning empty/ENOENT against a populated fake fs) looks like a harness-root-detection mismatch between the fake provider's keys and whatever real-path normalization the resolver's `.git`-walk performs in this environment, independent of TEMP location.
- This is reported as an **open environment discrepancy**, not confirmed to be the documented stray-folder cause, and not something this pass is authorized to fix (test-only QA role, and the failure is pre-existing — no file in `cli-agent-runtime` was touched by TASK_2026_408 except a comment-only header in `codex-cli.adapter.ts`).

## Failures

- **Fixed during this pass (test-defect, not product defect):** the new "text-only byte-identical" case in `codex-stream-parity.spec.ts` initially failed to typecheck — `textOnlyRequest` was typed `Anthropic.MessageCreateParamsNonStreaming` (the SDK client's own type, which permits `ImageBlockParam` variants like `URLImageSource` that the project's narrower `AnthropicImageBlock` type doesn't accept) but was passed directly into `translateAnthropicToResponses`, which expects the project's own `AnthropicMessagesRequest` type. Fixed by asserting `as unknown as AnthropicMessagesRequest` at that one call site (the object is still passed to `client.messages.create()` under its original SDK type). This is a test-only fix; no production file changed.
- **Flaky, not a defect:** `opencode-translation-proxy.spec.ts` › "times out native upstream requests without retrying" and the integration spec's "the timeout kill ends the whole child tree and verifies it exited" (a `Get-CimInstance` PowerShell call) both failed once under concurrent system load and passed on a clean rerun. Neither test was touched by this pass.
- **Not resolved, reported as a defect in test infrastructure documentation, not product code:** the `cli-agent-runtime` 17 `agent-role-resolver` failures persist under normal TEMP and under two different isolated-TEMP configurations, contradicting `integration-observations.md`'s claim that isolation fixes them. See analysis above. No product code was touched or is implicated; this is pre-existing and outside this task's mandate to fix.
- Not executed: the live-provider probe P7 (overflow message-pattern verification against a real upstream) — not authorized (Gate 2, plan Assumption A1/A5).

## Defects Found

None in production code. The single defect-shaped finding is documentation drift: `integration-observations.md`'s claim that isolating TEMP fixes the 17 `agent-role-resolver` failures could not be reproduced in this session (see above). No `codex-stream-parity.spec.ts` / `opencode-translation-proxy.spec.ts` case exposed a production defect — every new/changed assertion passed against the current translation code on the first correctly-typed run.

## Verdict

- Criteria proven: all five acceptance criteria (overflow contract, terminal-table parity across three paths, tool-name aliasing round-trip, no fabricated tool args, dense block indexes) — PASS, re-confirmed by the existing suites plus the two newly-added raw-byte parity cases.
- Criteria not proven: none within this task's authorized scope. The only unproven claim is the live-provider overflow-pattern set (P7), explicitly deferred to a future authorized probe.
- Risks a reader should know about:
  - `auth-providers`'s test suite is measurably flaky under concurrent machine load (two tests observed to fail once, then pass clean); rely on the clean, isolated 53/53 / 1318/1318 result as the number of record, not the concurrent-load run.
  - The `cli-agent-runtime` stray-TEMP explanation for its 17 `agent-role-resolver` failures does not hold up under this session's isolation attempts; the true cause is still open and should be re-investigated (likely a `.git`-walk / realpath mismatch between the fake `IFileSystemProvider` and the resolver's own path handling, not TEMP contents). Since the affected file was never touched by TASK_2026_408, this is pre-existing and does not block phases 1-2, but it is not the "known limit" the batch notes describe.
  - The S6b residual (an SSE error arriving *after* output has already streamed is retried, not compacted, per `ownership.md`) is unchanged and remains a documented limit, not a defect.
  - `[DONE]`-only streams still finish as `end_turn` (R4, spec-pinned, unchanged).
  - Overflow message patterns remain Assumption A1 (conservative, unverified against a live upstream) until probe P7 is authorized.

## Orchestrator check: agent-role-resolver failures are pre-existing

The same spec run on the unchanged main checkout (D:\projects\ptah-extension, base ebfc73321) gives the same result: `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts agent-role-resolver.service.spec` → 1 suite failed, 17 tests failed, 18 passed (35 total). This branch changes only a 5-line comment in cli-agent-runtime (`codex-cli.adapter.ts`). The 17 failures are therefore a pre-existing issue on main in this environment, not a regression from TASK_2026_408. The earlier "isolated TEMP fixes it" note is not confirmed; the cause stays open outside this task.

## Orchestrator decision on the QA test review (code-logic-review-qa.md, 6/10)

The one moderate finding says the text-only expected bodies are computed with the production translator and name guard. This is accepted as intended: those tests prove that `downgradeToolOutputImages` and the HTTP transport leave a text-only request byte-identical to the translator output, so the translator output is the correct reference. The same method is used by the Batch 6 test approved in code-logic-review-b6.md. The raw-string retry comparisons and both OpenCode Responses routes were confirmed valid by the reviewer (2 suites, 37 tests passed). `git diff --stat` confirms only the two spec files changed (no production code).
