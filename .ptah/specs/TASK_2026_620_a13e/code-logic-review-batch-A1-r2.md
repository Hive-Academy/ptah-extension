# Batch A1 round 2 code-logic review

Verdict: **APPROVED**  
Score: **10/10**

The three round-one findings are resolved. No new defect was identified in the revised A1 scope.

## Round-one findings

### N1 — OAuth loopback was installed too late: resolved

`seedRecordModeOAuthEndpoint` writes `{userDataPath}/config.json`, merging the `ptah` section and setting `provider.openai-codex.oauthTokenEndpoint` to the unreachable loopback URL before engine construction ([recording-bootstrap.ts:68](../../../../tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:68)). Record mode invokes it from `beforeEngineBoot` ([memory-skills-host.ts:262](../../../../tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:262)), which completes before the boot callback can start the engine.

This is the format that `CliWorkspaceProvider` reads: its config path is `{globalStoragePath}/config.json` ([cli-workspace-provider.ts:63](../../../../libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:63)), loaded synchronously in its constructor ([cli-workspace-provider.ts:64](../../../../libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:64)); non-file-based `ptah` keys come from that section ([cli-workspace-provider.ts:89](../../../../libs/backend/platform-cli/src/implementations/cli-workspace-provider.ts:89)). The key is therefore visible before a Codex provider can initialize or refresh.

The copied-token lifetime test now adds `CODEX_TOKEN_EXPIRY_SKEW_MS` to the deadline and ten-minute slack ([recording-bootstrap.ts:285](../../../../tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:285)). JWT `exp` is converted to milliseconds before that comparison ([recording-bootstrap.ts:279](../../../../tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts:279)), matching the seconds-to-ms boundary.

### N2 — provenance count rule rejected valid structured-output retry: resolved

`provenanceProblems` accepts zero entries with zero dispatches ([provider-provenance.ts:196](../../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:196)); permits one to two skill-lane dispatches per cassette entry; and requires exactly one curator dispatch per entry ([provider-provenance.ts:233](../../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:233)). Each dispatch is independently checked for non-empty, exact provider and model IDs ([provider-provenance.ts:139](../../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:139)). Aliases still fail exact equality.

### N3 — sidecar-write failure could leave recording artifacts: resolved

`commitProvenanceSidecars` wraps all writes in one transaction-like `try` block. A failed write calls `discardStagedCassettes` for every cassette path before rethrowing ([provider-provenance.ts:294](../../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:294)). That helper removes each JSONL and corresponding provenance sidecar ([provider-provenance.ts:319](../../../../tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts:319)).

## Additional review

The changed paths remain within the Batch A1 file list plus the requested review artifacts. Record rejection still happens before completion construction ([memory-skills-host.ts:331](../../../../tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:331)); replay behavior is not changed by the record-only seed ([memory-skills-host.ts:262](../../../../tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:262)).

## Scoped Jest check

Ran once:

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts tools/mcp-bench/src/memory-skills/runner/run-memory-skills.spec.ts tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts --coverage=false --maxWorkers=2 > "$TEMP/a1-r2-jest.txt" 2>&1
```

Exact tail observed:

```text
Test Suites: 6 passed, 6 total
Tests:       91 passed, 91 total
Snapshots:   0 total
Time:        10.375 s, estimated 17 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts|tools/mcp-bench/src/memory-sk
ills/runner/run-memory-skills.spec.ts|tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts|tools/mcp-bench/src/me
mory-skills/host/memory-skills-host.spec.ts|tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts|tools/mc
p-bench/src/memory-skills/recorder/provider-provenance.spec.ts.
```
