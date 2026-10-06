# Phase-1 revise round 1 — Batch 5 doubles (findings 5, 8, 9)

Scope: `tools/mcp-bench/src/memory-skills/doubles/` only. The existing
guarantee is unchanged: replay mode refuses the real adapter, and a replay
miss surfaces only as `CassetteMissError`.

## Finding 5 (major): re-recording left a stale entry that replay served first

### Change

- `CassetteStore.record` no longer appends blindly. It reads the existing
  lines, drops the entry with the same key, appends the new entry, and
  rewrites the cassette atomically: a temp file, then `renameSync`
  (`doubles/cassette-store.ts:169-188`, temp write at `:186`, rename at `:187`).
  A crash can no longer leave a half-written cassette.
- `CassetteStore.load` now refuses a corrupted cassette: when one key carries
  two entries with different responses it throws the new typed
  `CassetteDuplicateError` (`doubles/cassette-store.ts:68-85`, throw at
  `:227`). Responses are compared with `canonicalJson`, so property order
  does not matter. A duplicate key with identical responses still loads —
  the two entries are the same answer, not a conflict.
- The stale "FIRST entry wins" comment and the module header were updated to
  the new contract.

### New specs

- `doubles/cassette-store.spec.ts:50` — record key K with response A,
  re-record K with B, replay returns B; an untouched second key survives the
  rewrite.
- `doubles/cassette-store.spec.ts:63` — no `.tmp` file is left behind.
- `doubles/cassette-store.spec.ts:76` — a hand-made cassette with a duplicate
  key and different responses fails to load with `CassetteDuplicateError`.
- `doubles/cassette-store.spec.ts:93` — a hand-made duplicate with identical
  responses loads.

## Finding 8 (minor): the cassette recorded provider failures forever

### Change

- New shared typed error `CassetteRecordRefusalError` in
  `doubles/cassette-store.ts:89-107`, with `method` and `key` fields and a
  message that names the `recordFailures: true` opt-in.
- `RecordedCuratorLlm.extract` refuses to record a `stalled` extraction in
  record mode and throws the typed error
  (`doubles/recorded-curator-llm.ts:161-166`). `resolve` has no stalled arm
  in the port contract, so it needs no check.
- `RecordedLaneRunner.run` refuses to record a non-ok result in record mode
  and throws the typed error
  (`doubles/recorded-lane-runner.ts:98-104`).
- Both doubles take a new optional `recordFailures` option
  (`doubles/recorded-curator-llm.ts:58`, `doubles/recorded-lane-runner.ts:55`);
  when set, the failure is persisted deliberately.

### New specs

- `doubles/recorded-curator-llm.spec.ts:135` — a stalled extraction in record
  mode rejects with `CassetteRecordRefusalError` (name, method, message) and
  nothing is persisted: replay of the same key still throws
  `CassetteMissError`.
- `doubles/recorded-curator-llm.spec.ts:160` — with `recordFailures: true`
  the stalled extraction is recorded and replays.
- `doubles/recorded-lane-runner.spec.ts:144` — a `failed` lane result in
  record mode rejects with `CassetteRecordRefusalError` and nothing is
  persisted (replay still misses).
- `doubles/recorded-lane-runner.spec.ts:172` — the pre-existing
  "omits usage when the run failed" spec now opts in with
  `recordFailures: true`, so it still pins the usage-omitted entry shape.

## Finding 9 (minor): configured fault keys were never checked

### Change

- `RecordedCuratorLlm` now tracks which configured fault keys fired
  (`doubles/recorded-curator-llm.ts:217`) and exposes
  `assertAllFaultsHit()` (`doubles/recorded-curator-llm.ts:129-141`): it
  throws and lists every configured fault key that was never hit. Faults are
  replay-only, so the liveness suites call this after the run.

### New specs

- `doubles/recorded-curator-llm.spec.ts:268` — a typo'd fault key
  (`deadbeef`) is reported by name after the real fault fired.
- `doubles/recorded-curator-llm.spec.ts:279` — with two configured keys the
  assert throws until both fired, then passes.
- `doubles/recorded-curator-llm.spec.ts:265` — the stalled-fault spec now
  also asserts `assertAllFaultsHit()` passes once its fault fired.

## Verification

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/doubles --runInBand`
  - `Test Suites: 3 passed, 3 total`
  - `Tests:       30 passed, 30 total` (21 before this round; 9 new specs)
- `npx eslint <6 changed files>` — exit code 0, no output (0 errors,
  0 warnings).
- `npx prettier --check --ignore-unknown <6 changed files>`
  - `All matched files use Prettier code style!`
- `npx nx run-many -t typecheck -p mcp-bench` — FAILED, but the only error
  is in another agent's in-flight directory, not in the doubles:
  `tools/mcp-bench/src/memory-skills/data/verify-candidate-manifest.spec.ts:5 - error TS2305: Module '"./verify-candidate-manifest"' has no exported member 'assertSafeBenchDataDir'.`
  No type error in any file under `doubles/`.

Not committed, per instruction.