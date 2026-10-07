# Batch 17 report — `mem.extraction`, `mem.liveness.fault`, `mem.liveness.rescan`

I worked as the backend-developer sub-agent in the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.

- I made no git state change and committed nothing.
- I did not edit `host/memory-skills-host.entry.ts`, `runner/run-memory-skills.entry.ts`, any 619-owned file, or any other batch's file under `suites/`.
- I did not run `nx run mcp-bench:test`, `bench-memory-skills` or the bench host, and I did not call `withPinnedCorpus`.
- No live model was used anywhere. The cassette `fixtures/memory-skills/cassettes/memory/extraction.v1.jsonl` was NOT recorded (see "Pending live recording").

## Files

All files are under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`.

| File | Status | Responsibility |
|---|---|---|
| `suites\memory\extraction.suite.ts` | CREATED | `mem.extraction`. Plans the cases, curates them through the real `MemoryCuratorService`, labels rows, computes rates, baselines and deltas, and wires the host. |
| `suites\memory\extraction.suite.spec.ts` | CREATED | 10 tests. Runs the real curator service with the real `RecordedCuratorLlm`, recording a synthetic cassette into a temp dir and then replaying it. |
| `suites\memory\bait-signatures.ts` | CREATED (extra) | Provisional bait signatures for FMR (see Deviations 1). |
| `suites\memory\liveness.suite.ts` | CREATED | `mem.liveness.fault` (fault modes (a)–(d) plus a stalled control) and `mem.liveness.rescan`. |
| `suites\memory\liveness-harness.ts` | CREATED (extra) | Holds the scripted curator, access to the two private trigger methods, and the child-container host wiring (see Deviations 1). |
| `suites\memory\liveness.suite.spec.ts` | CREATED | 10 tests. Runs the real `MemoryTriggerService`, `MemoryCuratorService` and `BootScanRunner` over a real temp sessions dir, using `fs.utimes`. |
| `host-only-imports.spec.ts` | MODIFIED | Allowlist plus rule 2 (see "host-only-imports change"). |

## Design

### `mem.extraction` (design 3.1)

**How a case runs**

- This is a host suite. It drives the container's `MEMORY_CURATOR` through `curate({sessionId, workspaceRoot, transcript, signal, userInitiated: true})` (R-M3).
- `CURATOR_LLM` is the plan's record/replay double. Rows are read back with `MemoryStore.list` and `getChunks`.
- `userInitiated: true` skips the background-work governor wait, as `memory:runNow` does. That option is not part of the cassette key.

**Cases.** These come from the fixtures the plan seeds into the isolated home (`memory-skills/memory-facts.v1.jsonl` and `memory-skills/distractors.v1.jsonl`):

- `seeded/<factId>`: one standard seeded session per fact (10). Each carries one bait.
- `long-middle/<n>` and `long-head/<n>`: groups of the 9 durable facts, as pairs with the last group taking 3, so 4 groups. Each group is generated twice with `generateLongSeededSession`: once with the facts in the clamp-dropped middle windows, and once with them in window 1 (the head baseline).

**Isolation.** Each case curates into its own workspace key, `<workspace>/.memory-skills-bench/mem.extraction/<case>`. Two consequences:

- No case can merge into another case's rows.
- Tier 1 is always empty, so every `resolve` key depends only on the drafts. That makes the keys independent of case order and of embedder ranking (R9).

Cross-session merge is `mem.dedup`'s job.

**Labelling.**

- A fact is present when a row matches it with the R-M4 `matchesFact` over subject, content and chunks.
- A bait is written when a row matches any of its signatures.
- Row labels:
  - `seeded`: the row matches a target fact;
  - `other`: it matches a bait or the abstention fact (F-009);
  - `unlabelled`: anything else, excluded from precision.
- Abstention facts are not recall targets. They appear in `byCategory.abstention` as fp (written) or tn (not written).

**Rates.** Every rate is `rate(num, den)` from `curation-metrics.ts`, so its value is exactly `num/den`.

- `details` (strict `curation`/`extraction` schema):
  - `recall`, `precision` and `fmr` of the seeded slice;
  - the head and middle counts in `byCategory['long-head' | 'long-middle']` as `{tp, fn}`;
  - `bySedimentClass` as `<class>.planted` and `<class>.written`;
  - `confusion`: row-level tp/fp/unlabelled plus fact-level fn.
- `f1` is a derived score (2PR/(P+R)), not a count rate.
- `overSuppression` is `null`. It needs the real slice and the old prompt, which run locally only.

**Head versus middle recall.** These are reported separately in three places:

- the gate metrics `recall.longHead` and `recall.longMiddle`;
- `byCategory`;
- each baseline row.

**Baselines (R-M2).**

- `extract-all` (`extractAllBaseline`): every user/assistant message is a row.
- `no-memory`.
- Each baseline row carries `<metric>`, `<metric>.num` and `<metric>.den` for `recall.seeded`, `recall.longMiddle`, `recall.longHead`, `precision.seeded` and `fmr.seeded`.
- The old-prompt baseline is local and live-only (design 3.1), so it is not part of this suite.

**Deltas.** `deltas[baseline]` holds system minus baseline for each rate. It also holds `recall.seeded.ci95.lo/hi`, a paired bootstrap over per-fact indicators (`pairedBootstrapDelta`, 10,000 resamples, seed `TASK_2026_620`; R-M6).

**Gate metrics** (`metrics`, read by the known-failures gate): `recall.seeded`, `recall.longMiddle`, `recall.longHead`, `precision.seeded`, `fmr.seeded`. The counts are deliberately not gate metrics, because every non-null metric of a failing suite needs its own `known-failures.v1.json` entry (`gate/known-failures.ts:148-160`).

**Cassette miss (R-M5).** The product swallows a miss:

1. `CuratorWindowRunner` turns the throw into `failed` (`curator-window-runner.ts:196-216`).
2. The service records it with `recordError` (`memory-curator.service.ts:745-750`).
3. That emits a `curator-error` event (`curator-activity-log.ts:339-371`).

The suite subscribes with `onEvent`. For each case it maps a `Cassette miss for …` error to `error: "cassette-miss: …"`, which is the prefix the runner's gate signal reads (`run-memory-skills.ts:469-472`). Any other curator error becomes `curator-error: …`.

**Fail closed.** If the double's call count has not moved after the first case, the curator was constructed with the real adapter (the B15 residual risk), so the suite throws.

**Verdict.**

- `na: cassette-miss` if any case missed.
- Otherwise `na: matcher-unvalidated` while option `matcherValidated` is false. That is the default, because the R-M4 agreement bar (`gt-matcher@v1`, U3) is not met.
- Otherwise `pass` only if every case passed, else `fail`.

**Expected today** (pinned by the spec with the synthetic model): `recall.longMiddle = 0`, and the `long-middle/*` cases fail. Once `matcherValidated` is true the verdict is `fail`; that failure is recorded, not hidden.

**Other result fields.**

- Per-case JSONL: `writeSuiteResult` writes it. The runner labels it `620.case.curation.v1` (`run-scorecard`/`run-memory-skills.ts:390`).
- `cassetteKey` is the window-1 extract key.
- `inputSha256` is the sha256 of the transcript.
- `cost.calls` and `modelCalls` are the double's extract+resolve calls. `cost.source` and `projectionSha256` are set by the runner (`run-scorecard.ts:194-247`). The spec checks `cassette` in replay, `live` in record, and an identical hash across two replays.

### `mem.liveness.fault` and `mem.liveness.rescan` (design 3.8)

**Product code under test.** The suites run the product's own trigger code, not a copy:

- `MemoryTriggerService.invokeCurate`: drain, curate, then `markProcessed` unless the pass stalled (`memory-trigger.service.ts:823-884`).
- `MemoryTriggerService.runBootScan`, which runs `BootScanRunner` and the watermark (`memory-trigger.service.ts:915-1034`, `boot-scan-runner.ts:90-229`).

Both methods are private. They are reached through `triggerInternals()`, which throws if either is renamed.

**Wiring (`hostLivenessParts`).**

1. Resolve the shared singletons from the parent container: `OBSERVATION_QUEUE_STORE`, `MEMORY_STORE`, `SQLITE_CONNECTION`.
2. Create a child container and register `CURATOR_LLM` there as the `ScriptedLivenessCurator`.
3. `child.resolve(MemoryCuratorService)` gives a new suite-local curator.
4. Register it as `MEMORY_CURATOR`, wrapped in a proxy that records every `curate` outcome.
5. `child.resolve(MemoryTriggerService)` gives a new suite-local trigger.

Everything else is the booted host's: stores, SQLite, transcript reader, rate limiter and workspace provider.

**Why a scripted curator.** Plan faults are keyed by cassette key. The observation path's transcript (`composeTranscript`) only exists inside the trigger, so the parent cannot key faults on it.

- The scripted curator picks a mode by a marker the suite plants (`LV-…`). It reproduces each fault through `RecordedCuratorLlm`'s own fault arm, so the error shapes are the double's (`TimeoutError`, injected throw).
- It is not a model and has no cassette: `modelCalls: 0` (so `cost.source` is `none`), `cassetteVersion: null`, and `cost.calls` counts its calls.

**Fault cases.**

- **(a) throw, (b) zero-drafts, (c) timeout** — observation path. The suite enqueues 3 `user-prompt` observations, sets the fault, runs `invokeCurate`, and checks:
  - all 3 observations are still unprocessed, for (a)–(c);
  - the outcome is not `'ran'`, for (a) and (c).
- **(d) boot scan.** The suite writes 3 seeded sessions to `~/.claude/projects/<escaped workspace>` with fixed mtimes 2100-01-01 + 0, 60 and 120 s. The middle one throws. Pass condition: the watermark stays below the failed session's mtime.
- **Control `control/stalled`.** This must pass. If it fails, the verdict is `na: control-failed`.
  - It runs last, because a `provider-unreachable` stall opens the curator's network back-off (`curator-pass-admission.ts:172-178`).
  - It is a case only. It is not in `details.faults`, so the `x/4 pass` renderer counts (a)–(d) only.

**Rescan.**

1. Write 3 sessions with fixed mtimes on 2100-01-02.
2. Boot-scan them.
3. Move the mtimes with `fs.utimes` to fixed values on 2100-01-03. Content is unchanged; the sha256 is checked.
4. Boot-scan again.

Cases `rescan/new-rows`, `rescan/new-chunks`, `rescan/extra-model-calls` and `rescan/duplicate-groups` each pass only when the value is 0. Details are `rescan {newRows, extraModelCalls, duplicateGroupsDelta}`.

**Why mtimes in 2100.** A cold watermark floors at now − 7 days (`boot-scan-runner.ts:81, 108`), so a fixed past date would age out. A far-future date stays deterministic.

**Vacuity guards.**

- (d) throws when the scan never reached the curator for every session.
- The rescan is `na: vacuous-first-scan` when the first scan made fewer calls than sessions, or added no rows.
- Either suite is `na: boot-scan-stalled` if a gate stalled the scan.

**Baselines.**

- `recorded-at-freeze` (R-L5): the values come from the optional `recordedAtFreeze` option and are null until the orchestrator records them. When they are present, `deltas` holds the differences.
- The rescan also has `transcript-hash-dedup`, a pure policy (skip a session whose content sha256 was already curated) computed from the two scans' hashes. It gives `rescan.sessionsRecurated = 0`, against the system's 3.

**Gate metrics.**

- fault: `faults.passRate` and `ranPassesWithError`;
- rescan: `rescan.newRows`, `rescan.newChunks`, `rescan.extraModelCalls`, `rescan.duplicateGroupsDelta`, `rescan.sessionsRecurated`.

**Expected today, pinned by the spec (recorded, not hidden).**

| Case | Observed today |
|---|---|
| (a) | `pass outcome 'ran'; 0 of 3 observations unprocessed` |
| (b) | fail |
| (c) | `pass outcome 'ran'; 0 of 3` |
| (d) | the watermark passes the failed session (2100-01-01T00:02:00Z); outcomes `ran, ran, ran` |
| control | pass (`'stalled'`, 3 of 3 kept) |

- `ranPassesWithError = 3` and `faults.passRate = 0/4`, so the verdict is `fail`.
- Rescan: `newRows 3`, `newChunks 3`, `extraModelCalls 6`, `duplicateGroupsDelta 3`, verdict `fail`.

**Cleanup.** The suites delete their own session files from the isolated home after each boot-scan case.

## ASSUMPTION checks

| # | Assumption | Result | Evidence |
|---|---|---|---|
| A1 | Provider auth in the isolated home works for live recording (batches.md:101-102, :694) | **NOT CHECKED.** No recording was made, per instruction. The recorder must check it first, and a missing credential is a run failure. | — |
| A2 | The curator uses the double installed in `afterContainerReady` | The service captures `llm` at construction (`memory-curator.service.ts:215, 239`). The suite fails closed if the first case moves no double call. | `extraction.suite.ts`, the "CURATOR_LLM was not replaced" throw (spec-pinned) |
| A3 | A cassette miss surfaces to the suite | Only as a `curator-error` event, because the product converts the throw to `recordError` → `'ran'`. | `curator-window-runner.ts:196-216`, `memory-curator.service.ts:745-750`, `curator-activity-log.ts:339-371` |
| A4 | `resolve` keys are deterministic | `resolve` is always called (`memory-curator.service.ts:917-937`). With per-case workspaces tier 1 is empty, so the set is tier-1 only (`merge-candidate-collector.ts:166-187`) and `related = []`. | spec: record, then replay identical |
| A5 | (a)/(c) report `'ran'` today | `recordError` returns `outcome: 'ran'`. | `curator-activity-log.ts:339-363` |
| A6 | The observation path consumes on any non-stalled outcome | `markProcessed` runs unless the outcome is `'stalled'`. | `memory-trigger.service.ts:855-867` |
| A7 | The boot-scan watermark can pass a failed session | `runBootScan` maps only `stalled` (`memory-trigger.service.ts:1008-1012`). The runner advances `maxMtime` per `'ran'` item (`boot-scan-runner.ts:171-199, 218-226`). | spec (d) |
| A8 | The sessions dir is derivable in the host | `os.homedir()/.claude/projects` (`jsonl-reader.service.ts:283-285`), with the workspace escaped by `/[:\\/]/g → '-'` (`scanForSessionsDirectory`). `os.homedir()` is the isolated home (`bench-host-boot.ts:67`). | `sessionsDirFor` (spec) |
| A9 | Child-container construction is safe | Neither constructor has side effects (`memory-trigger.service.ts:133-169`). `MEMORY_CURATOR` and `MEMORY_TRIGGER_SERVICE` are parent singletons (`di/register.ts:156-176`). `CURATOR_LLM` is `Symbol.for('PtahCuratorLlm')` (`di/tokens.ts:17`). | code read |
| A10 | `SdkTranscriptReaderAdapter` reads the generator's `gen-xxxxxxxx` session files in the host | **UNVERIFIED in a real host.** If it does not, the vacuity guards fire: (d) throws and rescan is `na`. Nothing passes silently. | `sdk-transcript-reader.adapter.ts:25-49` |
| A11 | The host's own `MemoryTriggerService` singleton does not run its boot scan during the run | **UNVERIFIED.** Batch 15 notes the Thoth `oneshot` boot returns before the curator services resolve, and the scan defaults to a delay. An unexpected scan would move the watermark, and the "already covers" precondition would throw. | `memory-skills-host.ts` / batch-15-report |
| A12 | The trigger's workspace root equals `context.workspaceRoot` | **UNVERIFIED in a real host.** A mismatch makes the sessions dir wrong, so the vacuity guards fire. | — |

## Findings

1. **`gt-memory@v1` label defect: F-005 can never be recalled.** Its `forbiddenTokens: ["google account"]` matches its own statement ("…not the active Google account"). Because of this:
   - extract-all `recall.seeded` is 8/9;
   - any verbatim policy is capped at 8/9.

   The fix belongs to the ground-truth owners (U2 / Batch 25). For example, the forbidden token could be `keyed on the active google account`. The spec derives the ceiling from the matcher instead of hard-coding 1.
2. **`gt-memory@v1` is smaller than the design requires.** It has 10 facts against the design's ≥ 110 seeded facts, and gives 4 long sessions against ≥ 10. Every fact is still `labeller: draft:lane`. The suite runs on whatever is frozen.

## Check results

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/extraction.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/liveness.suite.spec.ts tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts --runInBand`
  → `Test Suites: 3 passed, 3 total` / `Tests:       23 passed, 23 total`. ts-jest diagnostics are on, so these files are type-checked.
- `npx eslint <the 7 files>` → exit 0, no output.
  - Before the split there were `max-lines` warnings (liveness 912, extraction 721) and two `no-useless-assignment` warnings; all are fixed.
- `npx prettier --check --ignore-unknown <the 7 files>` → `All matched files use Prettier code style!`
- Typecheck: `tools/mcp-bench/tsconfig.spec.json` does not exist, so it was skipped as instructed. The orchestrator runs the project typecheck.
- Not run, as instructed: `nx run mcp-bench:test`, and the batch's "one replay run through `bench-memory-skills` on the 10-fact seed". The replay run also cannot pass yet, because the cassette is not recorded. The host wiring (`hostExtractionEnv`, `hostLivenessParts`) is therefore exercised only by type-checking, not by a booted host.

## Registration

Add these to `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`. Nothing goes in `OFFLINE_SUITES`, because all three suites are host suites.

```ts
import { createExtractionSuite } from '../suites/memory/extraction.suite';
import { createLivenessSuites } from '../suites/memory/liveness.suite';

const HOST_SUITES: readonly MemorySkillsHostSuite[] = [
  createExtractionSuite(),   // 'mem.extraction'
  ...createLivenessSuites(), // 'mem.liveness.fault', 'mem.liveness.rescan'
];
```

**Plan entries** (runner plan `hostSuites`):

```json
{ "id": "mem.extraction", "options": { "cassetteVersion": "extraction.v1" },
  "groundTruth": { "id": "gt-memory@v1", "paths": [
    "tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl",
    "tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl" ] } },
{ "id": "mem.liveness.fault", "groundTruth": { "id": "liveness-fault-cases@v1",
  "paths": [ "tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl" ] } },
{ "id": "mem.liveness.rescan", "groundTruth": { "id": "liveness-fault-cases@v1",
  "paths": [ "tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl" ] } }
```

**Required plan fixtures.** The suites read these from the isolated home:

```json
{ "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl", "target": "memory-skills/memory-facts.v1.jsonl" },
{ "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl", "target": "memory-skills/distractors.v1.jsonl" }
```

**Replay cassette** (`cassettes.curator`): `{ "path": "<repo>/tools/mcp-bench/fixtures/memory-skills/cassettes/memory/extraction.v1.jsonl", "model": "<recorded model id>" }`.

**Known failures.** CI needs `known-failures.v1.json` entries for:

- `mem.liveness.fault`: `faults.passRate` = 0 and `ranPassesWithError` = 3;
- `mem.liveness.rescan`: `rescan.newRows` = 3, `rescan.newChunks` = 3, `rescan.extraModelCalls` = 6, `rescan.duplicateGroupsDelta` = 3, `rescan.sessionsRecurated` = 3.

These are the spec values. Confirm them on the first real replay.

`mem.extraction` is `na` (`matcher-unvalidated`) until U3. An `na` suite fails the CI gate even when it is listed (`known-failures.ts:85-92, 141-147`), so keep it out of the CI plan until `gt-matcher@v1` is frozen.

**Host-only allowlist.** `host-only-imports.spec.ts` now lists:

- `suites/memory/extraction.suite.ts`
- `suites/memory/liveness.suite.ts`
- `suites/memory/liveness-harness.ts`

All three run only inside the bench host and value-import the memory-curator barrel.

Rule 2 was changed: a host-only module may import another host-only module. The suites import the host-only seeded-session generator.

Batch 18 also added `suites/memory/merge-update-ports.ts` to the same set concurrently. Both edits are present.

`bait-signatures.ts` is not host-only: it imports only the matcher type.

## Pending live recording

This is not done here. It requires a live model and provider auth inside the isolated home (A1). The cassette may be recorded only from synthetic input, which the seeded sessions are. The steps:

1. **Check A1 first.** Confirm that the provider credential the product's `CURATOR_LLM` adapter uses resolves inside the isolated home. A missing credential is a run failure, never a skip.
2. **Write a plan** inside the bench data dir (`%LOCALAPPDATA%\ptah-mcp-bench`, from `resolveBenchDataDir()`), for example `<bench>\plans\record-extraction.v1.json`:

   ```json
   {
     "schemaId": "620.runner-plan.v1",
     "cassetteMode": "record",
     "cassettes": {
       "curator":    { "path": "<bench>\\cassettes\\memory\\extraction.v1.jsonl", "model": "<the curator model id in use>" },
       "laneRunner": { "path": "<bench>\\cassettes\\memory\\extraction.v1.lane-runner.jsonl", "model": "<lane model id>" }
     },
     "fixtures": [
       { "kind": "file", "source": "<repo>\\tools\\mcp-bench\\fixtures\\memory-skills\\memory-facts.v1.jsonl", "target": "memory-skills/memory-facts.v1.jsonl" },
       { "kind": "file", "source": "<repo>\\tools\\mcp-bench\\fixtures\\memory-skills\\distractors.v1.jsonl", "target": "memory-skills/distractors.v1.jsonl" }
     ],
     "hostSuites": [
       { "id": "mem.extraction", "options": { "cassetteVersion": "extraction.v1" },
         "groundTruth": { "id": "gt-memory@v1", "paths": [
           "tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl",
           "tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl" ] } }
     ]
   }
   ```

   Record mode refuses a cassette under `committedFixturesDir` (`plan.schema.ts:199-212`), so record into the bench dir.
3. **Close the desktop app**, then run `npx nx run mcp-bench:bench-memory-skills -- --plan <bench>\plans\record-extraction.v1.json`. Do not pass `--ci`; CI forbids record mode.
4. **Check the result.** In the run's `mem.extraction.cases.jsonl`, no case may carry an `error`. A stalled extraction is refused by the double (`CassetteRecordRefusalError`), so re-run rather than recording failures.
5. **Copy the cassette** `<bench>\cassettes\memory\extraction.v1.jsonl` to `tools/mcp-bench/fixtures/memory-skills/cassettes/memory/extraction.v1.jsonl`.
   - Add its sha256 to `fixtures/memory-skills/MANIFEST.json`.
   - Every line carries the `model` id (`cassette-store.ts:41-49`). Check that no line contains transcript text from real sessions; only seeded text is allowed.
6. **Replay check.** Set `cassetteMode: "replay"` and point `cassettes.curator.path` at the committed file. Expect zero `cassette-miss` errors. Do this once on Linux/WSL as well (R9). The keys should be stable, because every `resolve` here has an empty candidate list.

## Deviations

1. **Two extra files.** `bait-signatures.ts` and `liveness-harness.ts` were added to stay under the 700-line `max-lines` rule; the single files were 721 and 912 counted lines.
   - The bait signatures are labelling decisions, not product code. They are provisional, because `distractors.v1.jsonl` carries no key tokens for baits. The spec pins that each signature matches its own bait text and none matches the in-session rebuttal.
   - They should move into the bank at freeze (Batch 25).
2. **The liveness suites use a scripted curator instead of the plan's cassette double.** Reasons are under "Why a scripted curator". The error shapes are the double's, via `RecordedCuratorLlm`'s fault arm.
3. **Private-method access.** `triggerInternals()` casts to reach `invokeCurate` and `runBootScan`. It throws if either is renamed. A product seam, such as an exported `curateSessionNow(sessionId)` and a `runBootScanNow()` returning `BootScanResult`, would remove the cast. That is a Phase 4 candidate, not done here.
4. **Matcher trust gate.** `mem.extraction` is `na: matcher-unvalidated` by default (R-M4). The underlying pass/fail is still in every case record and in `metrics`.
5. **Long-session class size.** It has 4 sessions, not the design's ≥ 10, because the gt has 9 durable facts. The suite reports whatever the frozen gt yields.
6. **Shared isolated DB.** Extraction rows live under `<workspace>/.memory-skills-bench/mem.extraction/*` keys, and liveness rows under the host workspace key. A suite that counts rows across all workspaces in the same run (for example Batch 19's `mem.scope.write`) should filter by its own keys.

## Requests to 619

None.
