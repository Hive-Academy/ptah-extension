# Batch 18 report: dedup, rerank, update, temporal, seed

Executor: backend-developer sub-agent (b18).

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.
- No git command was run and nothing is committed.
- No 619-owned file was edited.
- `HOST_SUITES` and `OFFLINE_SUITES` were not edited.
- No bench run took place, the bench host was never launched, and no live model was called.

## Files

All paths are under
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\`.

| Status | File | Responsibility |
|---|---|---|
| CREATED | `suites\memory\dedup.suite.ts` | `mem.dedup` and `mem.dedup.rerank`, through `createDedupSuites(deps)` |
| CREATED | `suites\memory\dedup.suite.spec.ts` | 10 tests |
| CREATED | `suites\memory\update.suite.ts` | `mem.update` and `mem.temporal`. `createUpdateSuites(deps)` returns all three update-family suites. |
| CREATED | `suites\memory\update.suite.spec.ts` | 8 tests |
| CREATED | `suites\memory\update-seed.suite.ts` | `mem.update.seed` (split out to stay under max-lines 700) |
| CREATED | `suites\memory\update-reading.ts` | Shared code for the update family: planted-session shape, value matcher, update triple, one curation pass of a session |
| CREATED | `suites\memory\merge-update-pass.ts` | The replayable curation pass, plus case recording, rate metrics, `na` reasons and ground-truth reading |
| CREATED | `suites\memory\merge-update-ports.ts` | **Host-only** adapter. It resolves the product collaborators from the booted container. |
| CREATED | `suites\memory\merge-update.test-support.ts` | Spec-only fakes: an in-memory `MergeUpdatePorts` that follows the product rules, a synthetic cassette writer, and a suite context. |
| MODIFIED | `host-only-imports.spec.ts` | One entry added: `'suites/memory/merge-update-ports.ts'` (see the Host-only section) |

## Design

### Why the suites run the curation pass themselves

This is a finding about the Batch 5 double.

`MemoryCuratorService.curate()` sends the resolver the candidate rows' ULIDs (`memory-curator.service.ts:775-794`). `RecordedCuratorLlm` keys `resolve` on `related` including those ids (`doubles/recorded-curator-llm.ts:85-93`). A ULID is new on every run, so **a recorded resolve entry can never replay**: every pass with a merge candidate would be a CI cassette miss, even right after a local recording.

`merge-update-pass.ts` `commitDrafts` therefore runs the curator's own steps with the real collaborators, and changes only the ids the resolver sees:

1. **Collect.** It calls the curator's own `MergeCandidateCollector` instance, read from the singleton `MemoryCuratorService.mergeCandidates`. The collector is not exported and has no public seam. The access is checked at runtime and the result is zod-validated, so a refactor fails loudly.
2. **Resolve.** Each candidate is shown to the resolver under a content-derived id (`cand-<sha16(subject, content)>`), and the answer is mapped back to the real row id. When there are no candidates, nothing is called; the product adapter does the same (`sdk-internal-query.curator-llm.ts:360-362`).
3. **Commit.** It applies the curator's own rule: the target must be in the candidate set, and `getMergeTarget` must accept it, before `appendChunks`; otherwise the row is inserted as new (`memory-curator.service.ts:818-890`).

Extraction goes through the product's windows: `planCuratorWindows` makes one `extract` call per window (`:721-766`).

### `mem.dedup`

- Each `gt-merge@v1` pair gets its own scope (`workspace_root`). The left side and then the right side are each committed as one pass over the labelled draft. Drafts are labelled sides, so the baselines and the product decide over the same drafts, as design 3.2 requires.
- **Metrics.** Each comes with `.num` and `.den` in `metrics`, and every `value` is exactly `num/den`:
  - merge precision, recall and F1;
  - duplicate-cluster rate;
  - singleton-subject share;
  - `callsPerMerge`;
  - candidate recall.
- **Baselines** (pure functions from `write-side-baselines.ts`): byte-equal subject, never merge, tier-1-only.
- **Verdict:** pass when F1 − byte-equal F1 ≥ 0.10 (ledger `:86`).

### `mem.dedup.rerank`

- Every pair's left row goes into one shared scope.
- For each should-merge pair, the right draft's tier-2 query is run through `searchRich` with top-5. NDCG@5 of the left row is computed twice: on the returned (reranked) order, and on the RRF order of the same hits (RRF score, then BM25 rank, then vector rank).
- Reranker score variance is measured per list with the embedder's own `rerank`.
- **Verdict:** pass when the NDCG delta ≥ 0.05 (ledger `:93`). The result is `na: no-reranker` when the embedder is not the worker client.
- **Limitation:** this does not separate the effect of which 5 of the top 20 the reranker keeps.

### `mem.update`

- Each case gets its own scope.
- v1 is planted in its own session, together with the bait v′ stated once as a rejected hypothesis. v2 is planted in a second session. The sessions are curated in date order.
- The question is read through `searchRich` top-10 (the headline) and through `buildBlock`, then classified by `classifyUpdate`.
- **Baselines:**
  - latest-chunk-wins, over the same top-10 chunks;
  - raw transcript grep, where the newest line naming the slot wins;
  - no memory.
- **Verdict:** pass when correct − latest-chunk-wins correct ≥ 0.10 (ledger `:94`).

### `mem.temporal`

- All temporal sessions share one scope.
- **Accuracy:** the dated answer appears in the top 10.
- **Date visibility:** the share of `buildBlock` lines that contain an ISO date.
- **Baselines:** raw grep over the timestamped session records for the case date, and no memory.
- **Verdict:** pass when accuracy − raw-grep accuracy ≥ 0.10 (ledger `:95`).
- If a session hits a cassette miss, its question records that miss.

### `mem.update.seed`

- `MemoryWriterAdapter.upsert` is called with the wizard's core seed shape (`setup-rpc.handlers.ts:960-970`): first v1, then v2 with the same subject and fingerprint. The fingerprint is unique per case and per attempt.
- **Invariant:** correct on every case.
- **Baselines:** append-only seed, and no memory.
- The suite is model-free.

### Common to all five suites

- Every case runs under `runCaseWithSafetyCap`, and retries use a fresh scope.
- Results are written with `writeSuiteResult`. The kind is `curation`, so the runner writes per-case JSONL `620.case.curation.v1`. The details validate against `curationDetailsSchema`.
- Case `observed` strings never contain row ids. The spec shows that the projection hash is identical across two runs with different id sequences (`toScorecardSuite`).
- `cost.source` comes from `modelCalls`: the spec asserts `cassette` in replay.
- **`na` reasons, in priority order:**
  1. `cassette-miss`: the case keeps its `cassetteKey`. R-M5 applies: any miss means the suite cannot pass.
  2. `case-errors`.
  3. `ground-truth-below-minimum`: fewer than 40+40 pairs, 25 update cases or 15 temporal cases.
- **Clock:** only the injected `now` is used, for latencies. Dates come from the ground truth.

## Validation notes

1. **Tier 2 is not configurable (assumption fails).**
   - `MergeCandidateCollector` (`merge-candidate-collector.ts:134`) takes only `(logger, store, search, now)` (`:144-150`).
   - Tier 2 is skipped without condition when tier 1 is empty (`:187`, `tier1Only('tier1-empty')`).
   - The service builds it with no options (`memory-curator.service.ts:243-247`).
   - **Consequence:** the 563 "tier 2 always" variant cannot be configured, so no variant was added. It becomes a Phase 4 fix variant.
2. **`created_at` is not injectable (assumption fails).** `MemoryStore.insertMemoryWithChunks` stamps `const now = Date.now()` (`memory.store.ts:199`) on `created_at` (`:228`) and on the chunk `created_at` (`:293`). `MemoryInsert` has no time field (`memory.types.ts`). The suites measure what the product stores and record this finding: `created_at` is the curation time. Recency order still follows the case dates, because curation runs in date order.

## Expected failures today (recorded, not hidden)

The figures for `mem.dedup`, `mem.update` and `mem.temporal` assume a cassette exists.

| Suite | Expected | Why (file:line) |
|---|---|---|
| `mem.dedup` | Should-merge pairs whose subjects differ after case folding never reach the resolver. Candidate recall is about the tier-1-only recall. | `merge-candidate-collector.ts:187` |
| `mem.dedup.rerank` | `fail`: delta 0 and variance 0 on every list | Forensics M3, `embedder-worker.ts:277-295` |
| `mem.update` | `fail`: mostly `stale`. A merge appends v2 to the v1 row and both chunks stay retrievable; there is no supersede marker. | Forensics M6; `memory-curator.service.ts:836-846` |
| `mem.temporal` | `fail`: date visibility 0 | The block prints `[subject]: chunk` only (`memory-prompt-injector.ts:117-128`), and the transcript carries no dates |
| `mem.update.seed` | Expected to pass: the adapter deletes the matches before the insert | `memory-writer.adapter.ts:71` |
| all model suites in CI | `na: cassette-miss`. No cassette is committed, and the ground truth is not frozen. | See "Pending live recording" |

The spec scenarios pin these shapes: an inert reranker gives `fail` with zero variance, stale updates give `fail` against latest-chunk-wins at 1.0, and temporal gives a date visibility of 0.

## Checks

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/dedup.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/update.suite.spec.ts tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts --runInBand` → `Test Suites: 3 passed, 3 total` / `Tests: 21 passed, 21 total`.
- `npx eslint` on the 10 files above → 0 problems. The earlier `max-lines` warning on `update.suite.ts` (809 lines) was fixed by the split; the file is now about 623 lines.
- `npx prettier --check --ignore-unknown` on the 10 files → `All matched files use Prettier code style!`
- `npx tsc --noEmit -p tools/mcp-bench/tsconfig.json` → 0 `error TS` lines.
- Not run, as instructed:
  - `nx run mcp-bench:test`;
  - `bench-memory-skills`;
  - any real host launch, so the container port resolution (`resolveMergeUpdatePorts`) is unexercised. Its first real run is the replay or record run below.

## Registration

Add these to `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`:

```ts
import { createDedupSuites } from '../suites/memory/dedup.suite';
import { resolveMergeUpdatePorts } from '../suites/memory/merge-update-ports';
import { createUpdateSuites } from '../suites/memory/update.suite';

const HOST_SUITES: readonly MemorySkillsHostSuite[] = [
  // …other batches…
  ...createDedupSuites({ resolvePorts: resolveMergeUpdatePorts }),
  ...createUpdateSuites({ resolvePorts: resolveMergeUpdatePorts }),
];
```

The ids registered are `mem.dedup`, `mem.dedup.rerank`, `mem.update`, `mem.temporal` and `mem.update.seed`. Nothing goes in `OFFLINE_SUITES`.

## Host-only

`merge-update-ports.ts` value-imports the memory-curator barrel for `planCuratorWindows`, `EmbedderWorkerClient` (the `instanceof` test the product uses), `MEMORY_TOKENS`, `baseSalience` and `memoryId`. It was added to `HOST_ONLY_MODULES`.

- Only the host entry value-imports it.
- The suites, the pass and the test support import its types only, so rule 2 holds.
- Batch 19 instead uses `Symbol.for` tokens. I told b19 about this choice.
- The agent-sdk injector is resolved through `Symbol.for('SdkMemoryPromptInjector')` (`agent-sdk/src/lib/di/tokens.ts:118`), so the SDK barrel is not loaded.

## Pending live recording

Prerequisites:

- Batch 25 has frozen and committed `gt-merge@v1` and the update and temporal slices of `gt-memory@v1`.
- The Batch 5 key question has been answered (see Requests).

Record locally from synthetic input only. Example runner plan, placed in `<benchData>/plans/b18-record.json`:

```json
{
  "schemaId": "620.runner-plan.v1",
  "cassetteMode": "record",
  "cassettes": {
    "curator": { "path": "<benchData>/cassettes/memory/merge-update.v1.jsonl", "model": "<curator model id>" },
    "laneRunner": { "path": "<benchData>/cassettes/memory/lane-unused.jsonl", "model": "none" }
  },
  "fixtures": [
    { "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/merge-pairs.v1.jsonl", "target": "gt/merge-pairs.v1.jsonl" },
    { "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/update-cases.v1.jsonl", "target": "gt/update-cases.v1.jsonl" },
    { "kind": "file", "source": "<repo>/tools/mcp-bench/fixtures/memory-skills/temporal-cases.v1.jsonl", "target": "gt/temporal-cases.v1.jsonl" }
  ],
  "hostSuites": [
    { "id": "mem.dedup", "options": { "mergePairs": "gt/merge-pairs.v1.jsonl", "cassetteVersion": "merge-update.v1" }, "groundTruth": { "id": "gt-merge@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/merge-pairs.v1.jsonl"] } },
    { "id": "mem.update", "options": { "updateCases": "gt/update-cases.v1.jsonl", "cassetteVersion": "merge-update.v1" }, "groundTruth": { "id": "gt-memory@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/update-cases.v1.jsonl"] } },
    { "id": "mem.temporal", "options": { "temporalCases": "gt/temporal-cases.v1.jsonl", "cassetteVersion": "merge-update.v1" }, "groundTruth": { "id": "gt-memory@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/temporal-cases.v1.jsonl"] } }
  ]
}
```

Command: `npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/b18-record.json`.

After recording:

- Copy the cassette into `tools/mcp-bench/fixtures/memory-skills/cassettes/memory/merge-update.v1.jsonl`.
- Replay with `cassetteMode: "replay"`.
- `mem.dedup.rerank` and `mem.update.seed` need no cassette and can run in replay at once (`options` as above, without `cassetteVersion`).

The fixture file names are proposals for Batch 25. The specs use synthetic cassettes in their temp dirs only.

## Deviations

1. **Files beyond the two listed, all in `suites/memory/`:**
   - `merge-update-ports.ts` (host adapter);
   - `merge-update-pass.ts` (shared pass and helpers);
   - `update-reading.ts` and `update-seed.suite.ts` (to stay under max-lines);
   - `merge-update.test-support.ts` (the precedent is `retention-sqlite.test-support.ts`).
2. **The suites drive the curation pass instead of calling `curate()`**, because of the ULID key problem described in Design. The collector is the real one, reached through a runtime-checked private field (`Reflect.get(service, 'mergeCandidates')`). This is the one escape hatch. The alternative would have been a fork of the collector.
3. **Sessions are minimal deterministic transcripts built in the suite, not from `seeded-session-generator.ts`.** The update, temporal and merge records are not `Fact` records, and the generator is host-only.
4. **Value matching uses full-value containment** (R-M4 `matchesFact` with the value as the only key token), because update and temporal cases carry no `keyTokens`. Paraphrased extractions count as absent.
5. **The `mem.update.seed` details reuse the `update` operation**, with `readPath: 'searchRich'`, because no seed variant exists in `curationDetailsSchema`.
6. **Another agent ran `prettier --write` over `suites/memory/` while I was working.** Only formatting changed. I verified that the final files are mine and that they pass.

## Requests

- **Batch 5 (`recorded-curator-llm.ts`):** key `resolve` on candidate `(subject, content)` and remap `mergeTargetId` at replay. Until then, any product path that calls `curate()` (for example `mem.extraction` multi-session cases) cannot replay a resolve with candidates.
- **Batch 25 / label schemas:** add `keyTokens` per value to update and temporal cases, and a link from each temporal case to its update slot, so the matcher tolerates paraphrase and temporal questions can compete within one slot.
- **619:** none.

## Out-of-scope observations

- Batch 19's `memory-suite-support.ts` and this batch's `merge-update-pass.ts` both hold `inputSha256`, home-relative path resolution, `rateMetrics` and `deltaOf`. Consolidating them is a candidate for after Phase 3.5 (third use).
- `buildBlock` calls `recordUse`, which bumps salience on the rows it injects. The suites accept this because it is product behaviour, but it makes a row read twice rank differently.
