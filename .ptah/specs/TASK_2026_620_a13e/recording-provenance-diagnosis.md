# Recording provenance diagnosis

## Root cause

The intended provenance source is the SDK launch boundary, not the cassette
double or a Codex-proxy log. `SdkInternalQueryCuratorLlm` supplies a dispatch
route to `InternalQueryService` at
`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:476`.
`SdkQueryRunner` accepts the optional tap only when it is constructed
(`libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts:292-293`),
then snapshots it in `scheduleProvenance` (`:492-497`) immediately before the
real SDK launch (`:639`). That path derives and emits the resolved provider and
model, including the `openai-codex` Codex-translation-proxy route.

The bench creates and registers its `DispatchProvenanceCollector` during
`afterContainerReady` (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:318-321`).
In the failed probe, the singleton `SdkQueryRunner` was already constructed by
then, so its constructor-injected optional tap remained `null`. The real
curator calls therefore reached the Codex translation proxy, but the runner's
launch-boundary event had no recipient. This explains two confirmed real calls
and zero collected dispatches. The proxy itself was not the missing recorder.

## Fix

`installRecordReplayDoubles` now receives the record-mode collector from the
host (`memory-skills-host.ts:323`) and, before resolving the real adapters,
attaches it to an already-registered `SDK_QUERY_RUNNER`
(`host/doubles-override.ts:75-90`). The attachment is record-mode-only
(`:98-107`) and fails closed if a registered runner does not expose the product
tap field.

This does not synthesize a dispatch from a cassette entry or curator method
call. It restores the existing product tap on the live runner; the runner still
emits only at `scheduleProvenance`, where it has the actual resolved provider
and model. `provenanceProblems` retains its exact count and route checks
(`recorder/provider-provenance.ts:187-246`), so a cassette entry without a
matching model dispatch is still rejected.

Added fake-only coverage in
`host/doubles-override.spec.ts:127-164`: a pre-existing fake runner starts with
a null tap, the record override attaches the collector, and one fake real SDK
dispatch produces exactly one `openai-codex`/`gpt-5.6-terra` curator event.

## Checks run

- `npx prettier --write` on the three changed TypeScript files: completed;
  formatter reported no further changes.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/host/doubles-override.spec.ts tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts --coverage=false --maxWorkers=2` (output redirected to `%TEMP%\\620-jest.log`): passed, 3 suites and 44 tests.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`: passed with exit code 0.
- `git diff --check`: passed with no whitespace errors.

No bench probe was run and no product-code files or private bench/auth data were
changed.
