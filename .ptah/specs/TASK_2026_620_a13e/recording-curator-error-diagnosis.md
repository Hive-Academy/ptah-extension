# Recording curator-error diagnosis

## Finding

The 255 failures reached the record/replay double (the run reports 255 model calls), but the observed evidence does **not** show that any paid model request reached OpenAI. Each call failed before a cassette record was committed, which explains the absent cassette. The supplied record plan deliberately routes only OAuth token refreshes to `http://127.0.0.1:9/oauth/token`; that alone is not evidence of model traffic.

## Ranked candidate causes

1. **Most likely: the actual SDK query fails after provider selection, and the failure is flattened before the bench sees it.** The plan pins `openai-codex` and `gpt-5.6-terra`. The curator reads and resolves that provider at `sdk-internal-query.curator-llm.ts:226-242`, then wraps every non-network query throw at `:547-563`. This exactly accounts for the identical generic case error and fast subsequent failures. The next probe's `cause-chain` and `host.log` will distinguish SDK executable, translation-proxy, auth, and model rejection.

2. **Possible: stale/invalid copied Codex auth refreshes against the intentionally unreachable endpoint.** The bench copies the source to `<isolation.home>/.codex/auth.json` and sets `CODEX_HOME` in `recording-bootstrap.ts:180-242`; `CodexHomeResolver` consumes that environment variable at `codex-home-resolver.ts:25`. Its format check requires `tokens.access_token` to be a JWT with enough remaining lifetime (`recording-bootstrap.ts:263-300`), so the copied format is the provider's expected OAuth shape. A stale token invokes `ensureTokensFresh` (`codex-auth.service.ts:394-415`) and refreshes at the configured endpoint (`:445-486`); Axios failure is caught, logged, and converted to `false`, so it is likely to surface as an auth/proxy failure rather than the curator's network classification. This is less likely if bootstrap actually completed: its expiry margin is deadline + 10 minutes + skew.

3. **Possible: the headless composition lacks a required provider/proxy or the proxy cannot start.** The auth DI registration creates the curator Codex translation proxy and resolver at `libs/backend/auth-providers/src/lib/di/register.ts:157-190`; the proxy refreshes auth on auth failure at `providers/codex/codex-translation-proxy.ts:92-95`. The curator resolver injection is optional (`sdk-internal-query.curator-llm.ts:220-221`), so an absent registration silently rides the active provider. The probe log will prove whether the required registrations and local proxy path are present.

4. **Lower likelihood: `gpt-5.6-terra` is rejected.** It is not obviously an invalid path: the Codex translation proxy normalizes `default`/tier names but accepts explicit IDs (`codex-translation-proxy.ts:114+`), and agent-SDK tests explicitly exercise `gpt-5.6-terra`. It still requires account availability and can be rejected upstream.

5. **Lower likelihood: missing Claude Code executable.** The internal query has an explicit SDK CLI-path facility (`sdk-query-options-builder.ts:782-785`), so the host must have its normal SDK/CLI resolution available. A missing executable is consistent with the generic wrapper but not yet supported by a specific run artifact; the retained log/cause chain is the needed proof.

## Visibility change

- `tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts:101-246` retains the full `Error.cause` message chain at the record/replay boundary, redacting token/header-style values.
- `tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.ts:399-404,768` appends that redacted chain to the failed case's `error` field.
- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:97,340,374-390` copies and redacts the CLI Logger's `<isolated userData>/logs/*.log` into `<runDir>/host.log`, which survives temp-home cleanup.
- `caseLimit` is a positive validated extraction option at `extraction.suite.ts:120,628`, permitting a deterministic one-case probe.

## Probe

Plan: `C:\Users\abdal\AppData\Local\Temp\extraction.probe.record.json`

It runs exactly `seeded/F-001` and writes the curator cassette to `C:\Users\abdal\AppData\Local\Temp\probe-cassettes\extraction.probe.jsonl`.

Orchestrator command:

```powershell
npx nx run mcp-bench:bench-memory-skills -- --plan C:\Users\abdal\AppData\Local\Temp\extraction.probe.record.json --run-id extraction-probe-1 --codex-auth-source C:\Users\abdal\.codex\auth.json
```

Inspect the single line in `mem.extraction.cases.jsonl` for `cause-chain`, then `<runDir>/host.log` for `[memory-curator]`, `[CodexAuth]`, proxy startup/auth messages, SDK stderr, an executable lookup failure, or a model/provider response. Do not copy credentials from either file into the repository.

## Checks

- The orchestrator later ran the initial targeted checks: 4 suites / 55 tests passed; `tsc` was clean; it also ran Prettier write on `recorded-curator-llm.ts` and `memory-skills-host.ts`.
- This follow-up ran Prettier write on the four changed source/spec files. Its first Jest attempt failed before execution on a test-only `Promise<number>` versus `Promise<void>` mismatch; that was corrected. The required redirected Jest rerun and redirected `tsc` command were then launched one at a time, but this environment returned before either produced a completion log (both output files remained empty); no further pass/fail result is claimed.
- No benchmark target or live model call was run by this agent.

## Decisions

- Kept all code edits inside `tools/mcp-bench/src/memory-skills/`; product code was inspected only.
- Used a case-field cause chain rather than persisting error objects/cassettes, so failed live calls cannot become replay data.
- Redacted likely secret-bearing key/value and Bearer forms in both case diagnostics and retained host logs.

## Root cause (probe) and fix

The one-case record probe is conclusive: `seeded/F-001` reported `The memory curator could not complete its language-model query. <- cause: SDK not available (status: initializing).` Its private retained host log shows the curator proxy started at `23:02:36.524`, the case then failed, and only at `23:02:37.265` did `SdkModuleLoader` resolve `C:\Users\abdal\.local\bin\claude.EXE`. Thus the host starts suites while the engine's asynchronous SDK initialization is still running. The query runner rejects that state at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:477-485`; no model request can be made after this guard rejects, so the 255 failures did not reach a paid model.

The readiness API is `SdkAgentAdapter.getHealth()` (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:617-619`), backed by the SDK runtime state (`helpers/sdk-runtime-state.service.ts:31-33`). `SdkAgentAdapter.initialize()` explicitly coalesces a concurrent call (`sdk-agent-adapter.ts:426-445`) but starts a new sequential pass, so the bench must not call it merely to wait.

The host now waits only in record mode, after boot and before it invokes any suite: `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:338-340`. `waitForSdkReady` at `:400-428` resolves `SDK_TOKENS.SDK_AGENT_ADAPTER`, polls `getHealth()` every 50 ms, permits only `available`, and loudly rejects an `error` state or an `initializing` state that persists beyond 60 seconds. Replay remains unchanged and does not resolve or require an SDK adapter. This observes the already-started initialization without duplicating it.

`RecordedCuratorLlm` now clears `lastFailure` at the beginning of both `extract` and `resolve` (`doubles/recorded-curator-llm.ts:156,193`), so a later successful or independently failing case cannot inherit a prior cause chain. Fake-only coverage is in `host/memory-skills-host.spec.ts:583-671` (ready runs, initializing waits, error/timeout run no suite) and `doubles/recorded-curator-llm.spec.ts:136-145` (failure diagnostic reset).

The readiness race directly explains B18/record-mode extraction and any merge/update record suite that reaches the same real curator double. It does not by itself establish a cause for scope-write or funnel: static inspection finds scope-write has no `CURATOR_LLM` call, and funnel uses its own lane-runner path. They are nevertheless protected from starting during SDK initialization by the record-mode host gate; diagnose any remaining scope-write/funnel result from its retained case diagnostics and `host.log`, not by attributing it to this curator failure.

### Spec fix (orchestrator round)

`waitForSdkReady` now checks `container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER, true)` before resolving it and reports the clear record-mode configuration error at `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:404-408`. The shared fake registration helper at `memory-skills-host.spec.ts:177-187` now supplies an available adapter to every fake record-mode boot that needs one, including the OAuth config-seeding test at `:879`; the missing-adapter failure is covered at `:677-704`. Real checks in this round: the focused host spec passed (1 suite, 24 tests, 25.845 s); `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` passed; and Prettier check passed for both changed host files. No benchmark target or live model call was run.
