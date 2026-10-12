# Code Logic Review — `TASK_2026_620_a13e` Batch A1

## Summary

| Metric              | Value  |
| ------------------- | ------ |
| Overall score       | 4/10   |
| Verdict             | REVISE |
| Blocking issues     | 1      |
| Serious issues      | 1      |
| Moderate issues     | 1      |
| Failure modes found | 3      |

The score is in the significant-problems band: the record-mode safety boundary is installed after engine construction, and a normal structured-output fallback produces more dispatches than cassette entries. It is above 1–2 because auth-source validation, settings validation/read-back, hash checking, and rejection before completion are substantively implemented and the mandated scoped Jest command passed. It is below 5–6 because the two principal record paths cannot meet their intended contract.

## Five logic questions

### 1. How does this fail silently?

The OAuth refresh block is absent during engine boot. If an already-constructed Codex provider finds a stale token during that window, it reads the default endpoint and can attempt a real refresh before the later configuration write. The run may only fail much later when the changed copied auth hash rejects the cassette, leaving the external refresh attempt as the misleadingly unguarded side effect. Evidence: `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:252-290`; `tools/mcp-bench/src/transport/bench-host-boot.ts:401-444`; `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts:403-407,445-486,517-525`.

### 2. What user action produces unexpected behaviour?

A plan that records a structured-output skill lane against a provider which ignores `outputFormat` can validly succeed on the lane runner's one allowed retry, but produces two provenance callbacks and one outer `RecordedLaneRunner` cassette entry. End-of-run provenance then rejects and deletes the cassette. Evidence: `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:487-494,554-574,628-671`; `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts:88-113`; `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:520-549`.

### 3. What input data produces a wrong answer?

No supported finding that a valid settings map produces a wrong value: secret-like names are rejected except the explicit endpoint key, settings are sorted for hashing, and host read-back uses exact equality. Evidence: `tools/mcp-bench/src/memory-skills/runner/runner-plan.ts:71-110`; `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:448-478`.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

Malformed cassette JSON/key data and provenance/count mismatches reject recording before completion and discard the cassette/sidecar. However, a failure while writing the second provenance sidecar escapes after any earlier sidecar has been written, without the required cleanup. Evidence: `tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:67-95,164-196`; `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:519-559`.

### 5. What is missing that the requirements never mentioned?

The implementation needs an atomic acceptance/rollback boundary for sidecar creation. It also needs provenance granularity to match the cassette unit (one outer lane invocation) or cassette recording to emit one entry per actual dispatch, including the structured-output retry.

## Findings

### Blocking — OAuth refresh guard is installed after engine boot (N1 remains)

- File: `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:252-290`
- Scenario: A record run has a copied Codex auth file and a stale access token while `withEngine` constructs/initializes a Codex-auth consumer.
- Evidence: `beforeEngineBoot` copies the auth and sets `CODEX_HOME` at lines 254-276, but the loopback setting is only applied in `afterContainerReady` at lines 278-282. The shared boot implementation invokes `beforeEngineBoot`, then starts `withEngine`, and invokes `afterContainerReady` only from its engine callback (`tools/mcp-bench/src/transport/bench-host-boot.ts:401-444`). `CodexAuthService` calls `refreshAccessToken` for stale tokens and reads the workspace setting at refresh time (`libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts:403-407,445-486,517-525`).
- Impact: The promised unreachable loopback protection does not cover the phase in which a provider may first refresh. An operator refresh token may be sent to the real OAuth endpoint before the cassette is later discarded on copied-auth hash change.
- Fix: Apply the isolated configuration value before `withEngine` starts (through the isolated config mechanism available to `beforeEngineBoot`), then retain post-boot read-back verification. Add an integration-order test that attempts a stale-token refresh during boot and proves it sees the loopback endpoint.

### Serious — Structured-output fallback makes valid recordings unrecordable

- File: `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:520-530`
- Scenario: A skill lane requests JSON, its provider returns no parseable structured result on the first response, and the permitted unstructured retry succeeds.
- Evidence: The lane runner calls `callOnce` at `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:487-494` and again at lines 554-574. Each `callOnce` supplies `dispatch` to `internalQuery.execute` at lines 648-671, causing a dispatch event. The record double records exactly one entry only after the _outer_ `inner.run(req)` succeeds (`tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts:97-113`). `provenanceProblems` rejects unequal entry and dispatch counts (`tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:164-176`).
- Impact: A documented, successful degraded lane path is rejected as an invalid cassette, so record mode cannot capture the response that replay is intended to use.
- Fix: Associate dispatches with the outer cassette key and accept all verified attempts for that entry, or change cassette recording to persist one entry per model dispatch. Add a host-level test for the two-call structured-output ladder and a zero-dispatch/zero-entry case.

### Moderate — Sidecar write failure leaves accepted-looking artifacts

- File: `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:551-559`
- Scenario: Both cassette sides validate, the first sidecar write succeeds, and the second `writeFileSync` fails (for example disk-full or a permission error).
- Evidence: Cleanup wraps cassette reading/validation only (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:519-541`) and the mismatch branch at lines 547-549. The sidecar loop is outside either cleanup path. `writeProvenanceSidecar` performs a synchronous file write (`tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:203-226`).
- Impact: A failed recording can retain a cassette and one provenance sidecar despite no completion record, violating the required all-artifact discard rule and making later consumption/diagnosis ambiguous.
- Fix: Stage sidecars, or wrap the write loop in `try/catch` that calls `discardStagedCassettes(paths)` before rethrowing; test failure on the second write.

## Data flow

1. Runner validates `codexAuthSource` as absolute and passes it only in child launch env — OK (`tools/mcp-bench/src/memory-skills/runner/run-memory-skills.ts:280-293,525-528`). Diff review found no plan, completion, cassette, sidecar, log, or bench-data serialization of that option.
2. Host boot hook rejects symlink/non-regular input, copies into isolated `.codex`, validates realpath/expiry, hashes, and sets `CODEX_HOME` — OK (`tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:96-187,212-269`).
3. Engine starts before the loopback endpoint is written — BLOCKING gap (`tools/mcp-bench/src/transport/bench-host-boot.ts:401-444`; `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:278-282`).
4. Host writes settings with exact read-back and canonical hash metadata — OK (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:448-478`).
5. Record mode collects provider/model callbacks and records outer cassette calls — gap for lane fallback cardinality (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:283-289,520-530`; `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts:97-113`).
6. Acceptance verifies exact provenance and copied-auth hash before completion — OK for validation failure (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:542-550`); sidecar write rollback is incomplete.

## Requirements fulfilment

| Requirement                                         | Status   | Gap                                                                                                                                                |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1 loopback endpoint before any refresh             | MISSING  | Written only after engine boot.                                                                                                                    |
| Auth source private to child env                    | COMPLETE | Diff inspection found it only in `hostLaunchEnv`; no serialization path.                                                                           |
| Auth bootstrap validation/expiry/no token in errors | COMPLETE | Symlink/non-file, containment, seconds-to-ms conversion and token-free messages are present.                                                       |
| Exact provenance and rejection before completion    | PARTIAL  | Exact checks work, but fallback retry cardinality rejects valid work.                                                                              |
| Discard all artifacts on recording failure          | PARTIAL  | Sidecar write exception has no rollback.                                                                                                           |
| Settings filter/read-back/canonical hash            | COMPLETE | Implemented and covered by scoped tests.                                                                                                           |
| Replay and plans without settings unchanged         | COMPLETE | No record-only endpoint is added in replay; absent settings remain optional.                                                                       |
| Changes confined to A1 file list                    | COMPLETE | `git status --short` listed only the stated A1 source/spec files plus its report; no scorecard, transport, corpus, bench-data.ts, or libs changes. |

## Edge cases

| Case                                      | Handled | Concern                                               |
| ----------------------------------------- | ------- | ----------------------------------------------------- |
| Symlink/non-regular auth source           | YES     | Rejected before copy.                                 |
| JWT `exp` seconds versus milliseconds     | YES     | Converted with `* 1000`.                              |
| Copied auth changes during run            | YES     | Hash mismatch rejects and deletes cassette artifacts. |
| Missing/empty/alias provenance            | YES     | Exact-match validation rejects it.                    |
| Zero cassette entries and zero dispatches | YES     | Counts agree and no sidecar is written.               |
| Structured-output second dispatch         | NO      | Two callbacks map to one outer cassette entry.        |
| Second sidecar cannot be written          | NO      | First written artifact is not rolled back.            |

## Verification

Ran exactly once, as requested:

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts tools/mcp-bench/src/memory-skills/runner/run-memory-skills.spec.ts tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts --coverage=false --maxWorkers=2
```

Exact tail observed:

```text
node.exe :
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

Test Suites: 6 passed, 6 total
Tests:       83 passed, 83 total
Snapshots:   0 total
Time:        11.076 s, estimated 21 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts|tools/mcp-bench/src/memory-sk
ills/runner/run-memory-skills.spec.ts|tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts|tools/mcp-bench/src/me
mory-skills/host/memory-skills-host.spec.ts|tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts|tools/mc
p-bench/src/memory-skills/recorder/provider-provenance.spec.ts.
EXIT:0
```

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: A stale Codex token can refresh against the real endpoint during engine boot, before record-mode isolation is active.
- A robust implementation would configure the loopback endpoint before engine construction, model provenance at actual-dispatch granularity, and make sidecar acceptance rollback atomic.
