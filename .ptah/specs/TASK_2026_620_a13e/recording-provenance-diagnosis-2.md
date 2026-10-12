# TASK_2026_620 — recording provenance diagnosis, probe 6

## Root cause

This was candidate 1, not a second untapped launch path and not an acceptance
ordering race.

`SdkInternalQueryCuratorLlm.resolve()` has two intentional model-free paths:
it returns `[]` for no drafts and returns the drafts with `mergeTargetId: null`
when there are no related candidates
([sdk-internal-query.curator-llm.ts:361-370](../../../libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts)).
Neither path reaches `runQuery()`.

Before this change, `RecordedCuratorLlm.resolve()` always called the inner
curator and unconditionally recorded a `resolve` cassette line after it
returned ([recorded-curator-llm.ts, pre-fix:205-216]). Thus the probe could
stage extract plus a model-free resolve even though only extract launched a
curator query. That exactly explains the observed two staged curator entries
and one provenance dispatch. The retained probe-6 host log corroborates that
there was one `SdkQueryRunner` terra launch; its unrelated session-title proxy
traffic is not a curator dispatch.

The real query path is single and already tapped: the curator calls
`InternalQueryService.execute()` with its dispatch route
([sdk-internal-query.curator-llm.ts:453-476](../../../libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts));
that service forwards the same route to `SdkQueryRunner.runOneShot()`
([internal-query.service.ts:115-134](../../../libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts)).
The runner schedules the provenance callback while building query options
([sdk-query-runner.service.ts:492-526](../../../libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts),
[638-641](../../../libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts)).
Since each curator call awaits the complete stream before the suite completes,
that microtask runs before host acceptance; it does not explain a stable 2:1
mismatch.

## Fix

- `RecordedCuratorLlm` now mirrors both model-free resolve paths in record and
  replay mode, after replay fault injection but before an inner call or cassette
  lookup ([recorded-curator-llm.ts:188-217](../../../tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.ts)). No cassette entry is created when the product would not dispatch. Real-model entries remain subject to the unchanged exact provenance gate.
- Staged-entry parsing retains only the cassette method for diagnostics
  ([provider-provenance.ts:60-101](../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts)).
- On every normal `RecordingRejectedError` path, the host writes
  `<runDir>/recording-rejection.json` before deleting staged cassettes
  ([memory-skills-host.ts:644-764](../../../tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts)). Its entries are restricted to component, `extract`/`resolve`/`unknown`, a 12-character key prefix, and whether an exactly expected provider/model dispatch is present in that entry's dispatch slot. It contains no prompt, response, or model content.

No product code was required or changed.

## Fake-only coverage

- `RecordedCuratorLlm` test proves both no-drafts and no-related-candidates
  resolves bypass the inner adapter, leave no cassette, and replay
  deterministically ([recorded-curator-llm.spec.ts:125-139](../../../tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.spec.ts)).
- Host rejection coverage proves the redacted artifact survives a provenance
  rejection while the cassette and sidecar are discarded
  ([memory-skills-host.spec.ts:815-880](../../../tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts)).

## Checks run

- `npx prettier --write` on all six changed TypeScript/spec files — completed.
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/doubles/recorded-curator-llm.spec.ts tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts --coverage=false --maxWorkers=2` — passed: 3 suites, 57 tests.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` — passed.

The memory-skills bench was not run.
