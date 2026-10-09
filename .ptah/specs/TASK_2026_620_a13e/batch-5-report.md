# Batch 5 report — record/replay doubles (TASK_2026_620_a13e)

Branch: `feat/task-620-memory-skills-bench` (worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`).
No git commands were run; no commits were made. Nothing under the real
`~/.ptah` was read or written. No file outside the batch's file list was
modified. No cassette fixture files were created — the store takes its JSONL
path from the caller, so later batches commit the fixtures.

## Task 5.1 — Cassette store and `RecordedCuratorLlm`

Done. The store, the key scheme and the miss error live in `cassette-store.ts`;
the double lives in `recorded-curator-llm.ts` and `implements ICuratorLLM`
against the real port (`libs/backend/memory-contracts/src/lib/curator-llm.port.ts:126-148`,
verified before writing).

What was built:

- `CassetteStore({ path, mode })` — one JSONL file per cassette. `record()`
  appends one `{key, method, model, promptSha, response, usage?}` line
  (design 6.2); `lookup(method, key)` serves by key, first entry wins on a
  duplicate key, and a key with no entry throws the typed `CassetteMissError`
  (fields: `key`, `method`, `path`; message names the cassette file).
- `cassetteKey(method, inputs) = sha256(method + canonicalJson(inputs))`
  exactly as design 6.2 states. `canonicalJson` sorts object keys recursively
  and drops `undefined`, so the key is stable across win32 (record) and linux
  (CI replay) property order. `signal` and `options` are excluded from the
  inputs (batches.md Assumptions, verified).
- `RecordedCuratorLlm` record mode wraps a real `ICuratorLLM` and appends one
  entry per call; replay mode serves by key. `promptSha` is
  `sha256(transcript)` for `extract` and `sha256(canonicalJson({drafts,
  related sorted}))` for `resolve`.
- `callCounts()` returns per-method call counts across the double's life in
  both modes — the hook the re-scan invariant (design 3.8: "0 extra model
  calls, counted by the replay double") reads.
- Exported helpers `curatorExtractKey(transcript)` and
  `curatorResolveKey(drafts, related)` so suites can pre-compute keys when
  selecting fault modes.
- Fault modes (design 3.8, replay-only, selected per key):
  `'throw'` throws a plain non-network `Error`; `'zero-drafts'` answers
  `{status:'extracted', drafts: []}` on `extract` and `[]` on `resolve`;
  `'timeout'` throws an `Error` with `name === 'TimeoutError'`; `'stalled'`
  answers `{status:'stalled', reason:'provider-unreachable', providerId: ''}`.

Evidence: `recorded-curator-llm.spec.ts`, 14 tests, all passing (21 tests
across both suites — see verification).

## Task 5.2 — `RecordedLaneRunner`

Done. `recorded-lane-runner.ts` defines
`type LaneRunnerDouble = Pick<LaneRunnerService, 'run'>` with the types
imported type-only from `@ptah-extension/skill-synthesis` (allowed for the
`type:tool` tag), against the verified `run()` surface
(`libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts:405`).

What was built:

- Same key and miss semantics: `laneRunKey(req) = sha256('run' + canonicalJson(
  {laneId, prompt, systemPromptAppend, cwd, maxTurns, outputSchema,
  userInitiated}))` — the model-facing fields only. Excluded and documented in
  the file header: `signal` (not serialisable), and `attempt`, `queueItemId`,
  `mcpServerRunning`, `mcpPort` (run-context and host state that differ
  between the record host and CI, never reach the model, and would make every
  cassette miss across machines). The spec pins this: a replay call with
  different run-context fields serves the recorded entry.
- `usage` is recorded from an `ok` run's `SkillBudgetUsage`
  (`{inputTokens, outputTokens, costUsd}` → `{input, output, costUsd}`) and
  omitted on `failed`/`unavailable` results.
- `pause?: () => void | Promise<void>` is awaited once per `run` call, before
  the double acts, in both modes — the test seam Batch 22's scripted
  interleaving needs.
- `promptSha = sha256(req.prompt)`.

Evidence: `recorded-lane-runner.spec.ts`, 7 tests, all passing.

## Risks and edge cases (as listed in the batch)

- **Cassette miss must throw a typed error, never fall through to a live
  call.** Both doubles REFUSE the real adapter at construction in replay mode
  ("replay mode refuses `inner`"), so a miss cannot silently dial out; it
  surfaces as `CassetteMissError` (typed, `instanceof`-able, carrying `key`,
  `method`, `path`) for the suite to map to `na: cassette-miss` (R-M5).
  Guard tests pin all three construction refusals.
- **R9 (resolve keys sort `related` by id).** `curatorResolveKey` sorts
  candidates by id before keying; the spec records with `[b, a]` and replays
  with `[a, b]` on the same entry, and asserts the two keys are equal.
- **Cross-platform keys (design 6.2 :379).** The canonical JSON form is
  key-order-independent, and resolve keys are candidate-order-independent;
  no other input in the doubles is host-derived.
- **Fault modes per key (liveness).** Selected per cassette key in replay mode
  only; supplying faults in record mode is a construction error. `'stalled'`
  on `resolve` is a configuration error, not a silent no-op — the port
  deliberately has no stalled arm on `resolve` (port header, lines 133-141),
  so a fault that cannot exist must not be accepted.
- **Call counting (rescan invariant).** `callCounts()` counts every call in
  record and replay mode; the spec asserts counts across a record→replay round
  trip.

## Files changed (all new)

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\doubles\cassette-store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\doubles\recorded-curator-llm.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\doubles\recorded-curator-llm.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\doubles\recorded-lane-runner.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\doubles\recorded-lane-runner.spec.ts`

`scorecard.types.ts`, `scorecard-writers.ts`, `host-launcher.ts`,
`bench-host.entry.ts` and every file outside the list are untouched.

## Verification (commands exactly as the batch lists them)

`npx nx run-many -t typecheck,test,lint -p mcp-bench` — final run:

```
√  nx run mcp-bench:typecheck
√  nx run mcp-bench:lint
√  nx run mcp-bench:test
```

Scoped suite run (`npx jest --config tools/mcp-bench/jest.config.ts
memory-skills/doubles`):

```
Test Suites: 2 passed, 2 total
Tests:       21 passed, 21 total
```

`npx prettier --check --ignore-unknown` on the 5 files:

```
Checking formatting...
All matched files use Prettier code style!
```

Specs the batch names: record→replay round trip (both doubles) ✓; miss →
`CassetteMissError` (both doubles, with name/method/key asserted) ✓; `resolve`
key stable under a reordered `related` list (R9) ✓.

Note for the team-leader: during an intermediate full run, lint reported one
error in `tools/mcp-bench/src/memory-skills/labelling/build-labelling-packet.ts`
(irregular whitespace) — a file outside this batch's list, belonging to
another lane; I did not touch it, and the final `run-many` above passed with
that lane's fix in place. Jest also printed its usual "worker process has
failed to exit gracefully" warning on the full run (pre-existing transport
suites spawn processes); all suites pass.

## Not done

Nothing in the batch. Two spec-side test bugs found during the first run
(a missing recorded `resolve` entry and a missing fault key for `resolve`)
were fixed in the specs before the passing run.