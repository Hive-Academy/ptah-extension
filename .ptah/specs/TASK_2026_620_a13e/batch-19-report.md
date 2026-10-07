# Batch 19 report: read side and scope

The executor was a backend-developer sub-agent working in the worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.

- It ran no git command against the real repository. It committed nothing and left the working tree dirty.
- It did not edit the host entry, the runner entry, or any file owned by 619 (`scorecard/`, `transport/`, `corpus/`, `bench-data.ts`).
- It did not launch the bench host and did not run `bench-memory-skills`.
- It did not call `withPinnedCorpus` and did not read `~/.ptah`.

## Files

All files are new and live under
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\memory\`.

| File | Task | Role |
|---|---|---|
| `read-side.suite.ts` | 19.1 | Defines the host suites `mem.search.fts-and`, `mem.injection.recall` and `mem.abstention`. Exports `READ_SIDE_SUITES` and `createReadSideSuites(portOf?)`. |
| `read-side.suite.spec.ts` | 19.1 | 10 tests, using an in-memory fake port and the committed `memory-facts.v1` and `distractors.v1` fixtures copied into a temporary home. |
| `read-side-port.ts` | 19.1 | `ReadSidePort` plus `containerReadSidePort(container)`. This is a narrow adapter over the product read path, and it holds the pinned OR SQL. |
| `scope-write.suite.ts` | 19.2 | Defines `mem.scope.write` (`SCOPE_WRITE_SUITE`, `createScopeWriteSuite(deps?)`), creates the scratch git repositories, and computes canonical keys. |
| `scope-write.suite.spec.ts` | 19.2 | 8 tests. They use real git in a temporary bench folder, a synthetic replay cassette and `RecordedCuratorLlm`. |
| `memory-suite-support.ts` | both | Helpers shared by the two suites: `recordCase` (safety cap, error records), `costOf`, `rateMetrics`, `deltaOf`, `resolveHomeFile`, `parseJsonLines`, `readSessionMessages`. |

## Design

### Read side (19.1)

**Seeded read world.** Each suite gets its own world under its own workspace key: `<runDir>/workspaces/<suiteId>`. The DB keys rows by the exact `workspace_root` string, and the suites always query with the exact key they wrote under. Seeding has two modes, set by `options.seed`:

- **`insert-statements` (the default).** Each seeded fact statement and each `distractor` record becomes one row with one chunk and no subject. Rows are written with `MemoryStore.insertMemoryWithChunks`, so no model is involved.
  - Held-out facts are not written. The default held-out set is the facts with category `abstention`, which is F-009 today. Their questions become abstention cases (design 3.5 c).
  - The baselines read the same statements as one dated stream: distractors first, then facts by date.
- **`fixture-db`.** The plan's database fixture is the seeded DB. Rows are read under `seed.workspaceRoot`, and the baselines read `seed.sessionFiles`, which are SDK-shaped JSONL files.

**Relevance comes from the DB.** A row is relevant when the R-M4 `matchesFact` accepts its subject, content and chunk. A question with no relevant row is recorded as a failing case (`relevant=0; no stored row matches the fact`) and is left out of the ranking denominators.

**`mem.search.fts-and`** (kind `curation`, operation `ranking`, target `fts-and`):
- It compares `searchRich` top-10 against the pinned pre-473 OR builder (`baselines/fts-or-query.ts`).
- The OR builder runs through the same SQL shape as the product's BM25 leg: FTS5 MATCH, the quarantine predicate, `workspace_root IS ?` and `bm25` ordering.
- Scoring uses 619's `recallAtK` and `ndcgAtK` unchanged.
- The verdict is `pass` when the product's recall@10 and NDCG@10 are both at least the OR builder's and no case errored.

**`mem.injection.recall`** (operation `injection-recall`, k = 5):
- For each question, the suite builds the injected text from two sources: the hit lines of `buildBlock(question, root)` and the roster lines of `buildSessionStartBlock(root)`.
- The R-M4 matcher runs on each line separately, so one fact cannot be assembled from two hits.
- Baselines are last-N (N = 50), raw transcript grep top-5 (keywords are the question's words of 4+ characters minus a fixed list of question words), and no memory.
- `accAllCorrect` equals `recall`, because each seeded question needs exactly one fact.
- The verdict is `pass` when recall is at least the better of last-N and grep.

**`mem.abstention`** (operation `abstention`):
- Abstention cases come from held-out facts plus the optional `abstentionFile` (lines in the `abstentionCaseSchema` format).
- The false-injection rate is the share of cases where `buildBlock` returned hit lines.
- The suite also reports mean injected hits and the scores of injected hits: min, p50 and max, against `MIN_SCORE` 0.05. That constant is mirrored from `memory-prompt-injector.ts:62`, which does not export it.
- The baseline is no memory, with a rate of 0.
- With fewer than 15 cases the suite is `na` with reason `cases-below-design-minimum: n of 15`. `na` never counts as a pass.

### Scope (19.2)

- **Scratch area.** The scratch area is `<benchData>/git-scope/<runId>/`, created non-recursively so an existing one is refused. It contains:
  - `repo`, with one commit;
  - `repo-wt`, created by `git worktree add -b scope-wt`;
  - `repo-b`, a second repository;
  - `no-hooks`, an empty directory.
- **Git safety.** Every git call follows these rules:
  - It takes an argument array and has a 30 s timeout.
  - It runs with `GIT_TERMINAL_PROMPT=0`, and every repository-redirect variable is removed from the environment (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, and the others in `REPOSITORY_REDIRECTS`).
  - `GIT_CEILING_DIRECTORIES` is set to the parent of `cwd`.
  - It passes `-c core.hooksPath=<no-hooks>` and `-c commit.gpgsign=false`. These apply only to the scratch commits in the bench folder.
- **Top-level check.** After `git init`, the suite checks that `git rev-parse --show-toplevel` equals the scratch directory, and refuses to continue otherwise.
- **Locating `<benchData>`.** The suite derives it from `context.runDir`, which Batch 16 creates as `<benchData>/runs/<runId>`. It refuses any other shape (see Deviation 1). The specs pass a temporary bench folder.
- **Cases.** One session JSONL (`options.sessionFile`) is flattened exactly like the session writer does (`ROLE: text`, joined by `RECORD_SEPARATOR`). It is then curated through `MemoryCuratorService.curate` under seven keys, in this order: `''`, `null`, main, worktree, case-variant, trailing-slash, workspace-b.
  - The order matters. `''` widens the merge-candidate search to every workspace, so it must run while the DB holds no other rows. Otherwise the resolve cassette key would include candidate ids, which are random ulids.
  - The suite records `preexistingRows` (see Pending live recording).
- **Metrics.**
  - Rows by stored key class. Classes are named without any run path, so the projection stays stable.
  - Non-canonical share: among rows whose git common directory canonicalises to main (case-folded on win32), the share whose key differs from main's key.
  - `emptyRootRows`.
  - `crossWorkspaceLeaks`.
- **Verdict.** `pass` requires all of the following: no errors, every path case wrote rows, a share of 0, zero `''` rows and zero leaks. The verdict is `na` (`no-rows-written`) when nothing was written.

### Shared contract

- Every rate metric is written as `<name>`, `<name>.num` and `<name>.den`, built through `rate(num, den)`. The specs check `value === num / den` (or `null` when `den` is 0) for every product and baseline rate.
- Each suite writes the `620.suite-result.v1` file and `<id>.cases.jsonl` through `writeSuiteResult`. The runner records the artefact as `620.case.curation.v1`.
- `inputSha256` and `observed` contain no run path and no generated id, so the projection hash does not vary between runs. A spec shows that two runs in different directories produce the same `projectionSha256` through `toScorecardSuite`.
- The runner sets `cost.source`. The specs show it is `none` for the read side (`modelCalls` 0) and `cassette` for a replayed scope-write run.
- A case that throws or hits the safety cap twice is kept as a `fail` record with its `error`. It is left out of the rate denominators and counted in `cost.error_rate`, and any error makes the verdict `fail`.

## Expected failures today

These are recorded in the metrics, not hidden. Entries for `known-failures.v1.json` belong to whoever owns that file.

- **`mem.scope.write`** (forensics M5). The spec runs it against a fake that stores keys the way the product does today (`memory-curator.service.ts:867` stores `workspaceRoot ?? null` verbatim):
  - non-canonical share is 6/8 on win32, or 4/6 elsewhere;
  - `emptyRootRows` is 2;
  - the verdict is `fail`.

  A canonicalising writer makes the suite pass, and the spec covers that case too.
- **`mem.abstention`.** On today's 10-fact seed there is 1 case (F-009), so the suite is `na: cases-below-design-minimum: 1 of 15`, with `falseInjectionRate.den = 1`. The ≥ 15 cases the design asks for need labelled abstention questions (see Requests).
- **`mem.search.fts-and` and `mem.injection.recall`.** No expected-failure claim is made for these. Their real values exist only after a host run.

## Registration

Do not apply these lines in parallel with Batches 17 and 18. They go in `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`:

```ts
import { READ_SIDE_SUITES } from '../suites/memory/read-side.suite';
import { SCOPE_WRITE_SUITE } from '../suites/memory/scope-write.suite';

const HOST_SUITES: readonly MemorySkillsHostSuite[] = [
  // …other batches…
  ...READ_SIDE_SUITES,
  SCOPE_WRITE_SUITE,
];
```

- No `OFFLINE_SUITES` entry is needed: all four suites run in the host.
- These modules import no host-only module, and no memory-curator barrel at runtime. They resolve `Symbol.for(...)` tokens instead.

Example plan entries for the runner:

```json
{ "id": "mem.scope.write", "options": { "sessionFile": "fixtures/scope-session.jsonl" }, "groundTruth": { "id": "gt-scope-write@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/skill-session-01.jsonl"] } }
{ "id": "mem.search.fts-and", "options": { "factsFile": "fixtures/memory-facts.v1.jsonl", "distractorsFile": "fixtures/distractors.v1.jsonl" }, "groundTruth": { "id": "gt-memory@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/memory-facts.v1.jsonl", "tools/mcp-bench/fixtures/memory-skills/distractors.v1.jsonl"] } }
```

- `mem.injection.recall` and `mem.abstention` take the same options as `mem.search.fts-and`.
- Each file must be listed as a `file` fixture in the plan, with `target` set to the home-relative path.
- Put `mem.scope.write` first in the plan, or run it alone.

## Pending live recording

The read-side suites make no model calls and need no cassette. `mem.scope.write` replays the curator's `extract` and `resolve` calls. Recording them is a local, live step, and I did not run it:

1. Write a runner plan at `<benchData>/plans/scope-write.record.json` with these settings:
   - `cassetteMode: "record"`;
   - a curator cassette at a path inside `<benchData>`;
   - fixture `{kind:"file", source:"<repo>/tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/skill-session-01.jsonl", target:"fixtures/scope-session.jsonl"}`;
   - one host suite, `mem.scope.write`, with options `{"sessionFile":"fixtures/scope-session.jsonl"}`. It must be the only suite, so `preexistingRows` is 0.
2. Run `npx nx run mcp-bench:bench-memory-skills -- --plan <benchData>/plans/scope-write.record.json`.
3. Copy the recorded cassette to `tools/mcp-bench/fixtures/memory-skills/cassettes/memory/scope-write.v1.jsonl` and add it to `MANIFEST.json`. This matches `SCOPE_WRITE_CASSETTE_VERSION = 'memory/scope-write.v1'`.
4. Replay with the same plan, using `cassetteMode: "replay"` and the committed cassette.

The specs use a synthetic cassette written into the spec's temporary folder.

## Checks (exact output)

- Scoped jest: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/memory/read-side.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/memory/scope-write.suite.spec.ts tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts --runInBand`
  - Final result: `Test Suites: 3 passed, 3 total` / `Tests: 21 passed, 21 total`.
  - The first run failed `host-only-imports.spec.ts` on Batch 18's `suites/memory/merge-update-ports.ts`. Batch 18 then added that module to `HOST_ONLY_MODULES` (their edit, not mine), and the re-run above passed.
- `npx eslint <my 6 files>`: exit 0, no output.
- `npx prettier --check --ignore-unknown <my 6 files>`: `All matched files use Prettier code style!`
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`: 0 `error TS` lines. This covers the whole project, including the specs and the other batches' files at the time of the run.
- `ptah_get_diagnostics` on my 6 files: 0 errors, but coverage was reported as `analyzed: null`, so the `tsc` run above is the evidence.
- Not run, as instructed: `nx run mcp-bench:test`, `bench-memory-skills`, and any host launch. The "one replay run" from the Batch 17/19 verification is therefore still pending, together with the recording above.

## Deviations

1. **`<benchData>` is derived, not passed in directly.** `MemorySkillsHostSuiteContext` has no `benchDataDir`, and the host child cannot call `resolveBenchDataDir` because its HOME is the isolated one. `benchDataDirOf(context)` therefore takes `<benchData>` from `runDir`: the parent resolves `runDir` as `<resolveBenchDataDir()>/runs/<runId>`. Any other shape is refused, and a spec covers the refusal.
   - Request to the Batch 15 owner: add `benchDataDir` to the host suite context. That file is 620-owned, but I left it alone during parallel work.
2. **Three extra files:** `read-side-port.ts`, `memory-suite-support.ts`, and the specs' use of real git.
   - The port keeps product calls out of the suites, so the specs never boot an engine.
   - The support module avoids copying the same helpers into both suites.
3. **Ground-truth ids.** The read side uses `gt-memory@v1` (`seeded`). Scope-write uses `gt-scope-write@v1` (`generated`), because its truth is the generated scratch layout, not labels.
4. **No baselines for `mem.scope.write`.** Design 3.6 names none, and the claim is an invariant (share 0), so `baselines` is `[]`.
5. **The seeding default is a design choice.** The design says "on the seeded DB". `insert-statements` makes the suites runnable today without a model, and it measures the read path given perfect extraction. `fixture-db` is the mode for the extraction-curated DB once Batch 17's recording exists.

## Avoiding overlap with 619

- No suite calls `ptah_memory_search` or the MCP transport. Everything runs in-process against `MemoryStore`, `MemorySearchService`, the `MemoryPromptInjector` and `MemoryCuratorService`, resolved by interned tokens.
- The read side never tests isolation or scope. Each suite queries only the exact key it wrote under, in its own folder. It measures only two things:
  - the AND vs OR builder change (473);
  - what the injector puts in the prompt (620's "does injection help" question).
- `mem.scope.write` never searches. It reads back the `workspace_root` its own sessions wrote (`SELECT … WHERE session_id IS ?`), which is the write side only (R-M10). Read-side scope, worktree-to-repo recall and the spill-root bug are left to 619.
- I reused 619's `recallAtK`, `ndcgAtK`, `p50Latency` and `p95Latency` without forking them, and edited no 619 file.

## Requests to 619

None are required. Optional: export `searchScopePredicate` or the BM25 SQL from the product, or offer a bench helper for it, so `read-side-port.ts` would not have to mirror the SQL shape.

## Out-of-scope observations

- **Fixture labelling (`memory-facts.v1.jsonl`).** F-005's statement contains its own forbidden token, "google account" ("…not the active Google account"). No row that holds the statement verbatim can ever match F-005, so it is unanswerable in insert mode, and an extractor that copies the sentence would be scored as missing it. The ground-truth owner should check this.
- **`suites/memory/merge-update-ports.ts` (Batch 18)** briefly broke `host-only-imports.spec.ts`. Batch 18 resolved it by listing the module as host-only.
- **Abstention needs labelled questions.** Reaching ≥ 15 abstention cases needs a labelled abstention-question fixture (classes a, b and c in the `abstentionCaseSchema` format). None exists yet.
