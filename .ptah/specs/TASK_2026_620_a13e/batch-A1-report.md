# Batch A1 report — Plan, config and auth recording seam

Settings travel on the strict runner and host plans. Record mode forces an unreachable Codex token URL, copies an operator auth file into the isolated home, and keeps a cassette only when dispatch provenance matches and that file did not change.

## Files changed

- `tools/mcp-bench/src/memory-skills/runner/runner-plan.ts` and `runner-plan.spec.ts`
- `tools/mcp-bench/src/memory-skills/runner/run-memory-skills.ts` and `run-memory-skills.spec.ts`
- `tools/mcp-bench/src/memory-skills/host/plan.schema.ts` and `plan.schema.spec.ts`
- `tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts` and `memory-skills-host.spec.ts`
- `tools/mcp-bench/src/memory-skills/host/recording-bootstrap.ts` and `recording-bootstrap.spec.ts` (new)
- `tools/mcp-bench/src/memory-skills/recorder/provider-provenance.ts` and `provider-provenance.spec.ts` (new)

`host/fixture-seeder.ts` was not changed. The auth file is outside the fixture roots, so the seeder must not copy it.

## Design decisions

- One settings schema, `productSettingsSchema`, lives in `runner-plan.ts:84`. Values are `string | number | boolean`. A key is rejected when it matches `/token|secret|key|password|auth/i`, except the exact allowlisted key `provider.openai-codex.oauthTokenEndpoint` (`runner-plan.ts:71`). The host plan uses the same schema (`plan.schema.ts:138`). Absent `settings` stays off the parsed object, so plans without it do not grow a key.
- `run-memory-skills.ts` copies `plan.settings` into the host plan only when the runner plan has the field. `codexAuthSource` is a `RunMemorySkillsOptions` field, not a plan field. It must be absolute (`MemorySkillsRunError`, message does not include the path). `hostLaunchEnv` (`run-memory-skills.ts:280`) puts it on the launch env as `PTAH_BENCH_CODEX_AUTH_SOURCE`, plus `PTAH_BENCH_RECORDING_DEADLINE_MS` (the host completion timeout). Those vars are not written into runner-plan, host-plan, or the run summary.
- Product settings are applied in `afterContainerReady`, after `withEngine` has opened the container and before `installRecordReplayDoubles` resolves providers (`memory-skills-host.ts`). Each entry is `setConfiguration('ptah', key, value)` and must read back with `===`. Completion gains `settings: { names, sha256 }` only when a map was written. The hash is sorted-key JSON (`canonicalProductSettingsSha256`).
- Record mode always adds `provider.openai-codex.oauthTokenEndpoint` = `http://127.0.0.1:9/oauth/token` (`recording-bootstrap.ts:47`, `appliedProductSettings` at `memory-skills-host.ts:438`), overwriting a plan value of that key. Replay does not add it. That is the key `CodexAuthService.getOAuthTokenEndpoint` reads: section `ptah`, key `provider.openai-codex.oauthTokenEndpoint` (`codex-auth.service.ts:518-524`).
- `bootstrapIsolatedCodexAuth` runs from `beforeEngineBoot` only when `PTAH_BENCH_CODEX_AUTH_SOURCE` is set. It `lstat`s the source, rejects a symlink and any non-regular file, copies to `<isolation.home>/.codex/auth.json`, `chmod 0o600` (failure ignored only on win32), then `realpath`s the Codex home and the auth file and requires both to stay inside that tree. `CODEX_HOME` is set to `<isolation.home>/.codex` on `process.env` after those checks. The access token is `tokens.access_token`; its JWT `exp` must exceed now + deadline + 10 minutes + `CODEX_TOKEN_EXPIRY_SKEW_MS` (see Revise round 1). Token text is not logged. Node `errno` is read without `instanceof Error`, because Jest's vm does not share Node's error realm (`errorCode` in `recording-bootstrap.ts`).
- Cassettes have no staging directory. `CassetteStore.record` writes the final JSONL (`doubles/cassette-store.ts`). Those files are not owned by this batch, so provenance is a sidecar `<cassette>.provenance.json` (`provider-provenance.ts`). The tap token is `Symbol.for('PtahModelDispatchProvenanceTap')`, registered on the host container only in record mode (`memory-skills-host.ts:285`). At the end of record mode, `acceptRecording` (`memory-skills-host.ts:485`) checks dispatch provenance (exact provider and model; skill-lane may record one retry — see Revise round 1) and an unchanged sha256 of the copied auth file when a copy was made. On failure it deletes the JSONL and the sidecar and throws `RecordingRejectedError` before the completion record is written.

## Checks

Command:

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts tools/mcp-bench/src/memory-skills/runner/run-memory-skills.spec.ts tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts --coverage=false --maxWorkers=2
```

Tail (`%TEMP%\a1-jest.txt`), exit 1:

```
Test Suites: 1 failed, 5 passed, 6 total
Tests:       66 passed, 66 total
Snapshots:   0 total
Time:        19.976 s
EXIT:1
```

The failed suite did not execute. `memory-skills-host.spec.ts` dies while loading `memory-skills-host.ts` → `doubles-override.ts:23` → `@ptah-extension/skill-synthesis`, which imports `marked`. Jest maps `marked` to this worktree's `node_modules/marked/lib/marked.umd.js`, and that file is not there (the worktree has no `node_modules`). The five other suites passed, including settings strictness, host-plan copy-through, auth bootstrap (symlink, non-file, expiry, path escape, `CODEX_HOME`), and provenance unit checks (alias, empty provider, missing dispatch, sidecar discard).

Command:

```
npx tsc -p tools/mcp-bench/tsconfig.json --noEmit --pretty false
```

`tools/mcp-bench/tsconfig.spec.json` does not exist. `tsconfig.json` includes `src/**/*.ts`, which includes these specs. Exit 0. `Select-String memory-skills` on the log returned no lines. The log tail is the Node `NO_COLOR`/`FORCE_COLOR` warning and `EXIT:0`.

## Open issues

- `memory-skills-host.spec.ts` did not run, so these host-level cases are unexecuted here: read-back mismatch, the unreachable OAuth endpoint written only in record mode, alias provenance discarding the cassette, and an auth-file hash change discarding the cassette. The code for them is in `memory-skills-host.ts`. Re-run that spec where `marked` resolves.
- There is no CLI flag yet. `run-memory-skills.entry.ts` uses strict `parseArgs` and is outside this batch's file list. Callers pass `codexAuthSource` on `RunMemorySkillsOptions`.
- Provenance is a sidecar, not a field on the cassette line. Discard deletes the JSONL the double already wrote; nothing is copied to a second "promoted" path.
- `ptah_agent_report` is not available in this session (no MCP tools connected).

## Revise round 1

The code-logic review was REVISE. Three findings, all in the A1 files. No commit.

### N1 — loopback endpoint before the engine

`CliWorkspaceProvider` stores non-file settings in `{globalStoragePath}/config.json` (`cli-workspace-provider.ts`, `configFilePath` / `loadConfigSync` / `persistConfig`). `withEngine` sets that directory from `PTAH_CONFIG_PATH` / `userDataPath` (`with-engine.ts:257-259`). `provider.openai-codex.oauthTokenEndpoint` is not a file-based key (`file-settings-keys.ts` `isFileBasedSettingKey`), so the pre-seed target is `{userDataPath}/config.json` with section `ptah`, not `settings.json`.

- `seedRecordModeOAuthEndpoint` (`recording-bootstrap.ts:68`) merges `ptah["provider.openai-codex.oauthTokenEndpoint"] = http://127.0.0.1:9/oauth/token` into that file and keeps other keys.
- Record mode calls it at the start of `beforeEngineBoot`, before auth copy and fixture seed, and before the boot callback returns to `withEngine` (`memory-skills-host.ts:262-264`).
- The post-boot `setConfiguration` plus read-back is unchanged and still runs as verification.
- Order spec: `memory-skills-host.spec.ts:718` reads `config.json` after `beforeEngineBoot` returns and before the engine marker. Replay spec `memory-skills-host.spec.ts:767` asserts the file is absent at that same point.

### N1 — token life includes the Codex skew

`isCodexAccessTokenStale` (`codex-token-freshness.ts:109-117`) treats a JWT as stale when `exp * 1000 - now < CODEX_TOKEN_EXPIRY_SKEW_MS` (`codex-token-freshness.ts:37`, 5 minutes). `assertAccessTokenCoversRecording` (`recording-bootstrap.ts:285-287`) now rejects when `expMs <= now + deadline + 10 minutes + CODEX_TOKEN_EXPIRY_SKEW_MS`, so `ensureTokensFresh` does not reach `refreshAccessToken` during the run. Specs: a token that only clears the 10-minute slack is rejected (`recording-bootstrap.spec.ts:113`); a token one second past deadline + slack + skew is accepted (`recording-bootstrap.spec.ts:120`).

### Provenance counts

`provenanceProblems` (`provider-provenance.ts:187`) groups dispatches by `component` and `laneId` and requires every dispatch to match its expected provider and model, both non-empty. Cassette lines have no lane id, so the numeric window is the component cassette: dispatches must be at least the entry count, the curator must be exactly one per entry, and `skill-lane` may go up to two per entry (one structured-output retry). Zero entries with zero dispatches is accepted (`provider-provenance.ts:190-192`). Specs: the two-call ladder and the curator extra (`provider-provenance.spec.ts:107`), and zero/zero (`provider-provenance.spec.ts:160`).

### Sidecar write rollback

`commitProvenanceSidecars` (`provider-provenance.ts:294`) writes sidecars for non-empty cassettes. The loop is in try/catch (`provider-provenance.ts:304-311`): any throw calls `discardStagedCassettes` on every path in the batch (JSONL and any sidecar already written) and rethrows. `acceptRecording` calls it at `memory-skills-host.ts:556`. Spec: the second write throws and both cassettes and the first sidecar are gone (`provider-provenance.spec.ts:241`).

### Checks (this round)

Jest once, `--coverage=false --maxWorkers=2`, the six A1 specs, log `%TEMP%\a1-r1-jest.txt`. All six suites ran. Tail:

```
PASS tools/mcp-bench/src/memory-skills/host/recording-bootstrap.spec.ts
PASS tools/mcp-bench/src/memory-skills/runner/run-memory-skills.spec.ts
PASS tools/mcp-bench/src/memory-skills/host/plan.schema.spec.ts
PASS tools/mcp-bench/src/memory-skills/runner/runner-plan.spec.ts
PASS tools/mcp-bench/src/memory-skills/host/memory-skills-host.spec.ts
PASS tools/mcp-bench/src/memory-skills/recorder/provider-provenance.spec.ts

Test Suites: 6 passed, 6 total
Tests:       91 passed, 91 total
Snapshots:   0 total
Time:        17.042 s
```

`npx tsc -p tools/mcp-bench/tsconfig.json --noEmit --pretty false` once. Exit 0. The log is only the Node `NO_COLOR` / `FORCE_COLOR` warning. No `memory-skills` diagnostic.

The earlier open issue that `memory-skills-host.spec.ts` did not load is closed: that suite passed in this run (91 tests, up from 66). Still open: no CLI flag (`run-memory-skills.entry.ts` is unowned), and provenance stays a sidecar rather than a cassette field.
