# Bench infrastructure fit — TASK_2026_620

## Decision supported

Whether Phase 3 of TASK_2026_620 can extend (rather than fork) the `tools/mcp-bench` infrastructure on `fix/task-619-tool-benchmark` for memory-curation and skill-trajectory measurement, and which changes require coordination with TASK_2026_619.

## Answer

It can carry the benchmark shell: frozen repository corpus, disposable lifecycle copies, real headless MCP transport, isolation, retrieval measures, and operational-cost collection are already reusable. It cannot yet represent the labelled, non-retrieval outcomes that 620 owns—extraction/dedup/update/retention confusion counts and human-rubric agreement—because the scorecard is structurally a tool-versus-native retrieval-suite model. Keep the shared project and add pure metric modules for curation/agreement; coordinate one schema evolution with the 619 session before emitting those results.

## Evidence and module fit

### `metrics/retrieval-metrics.ts`

Public API: `Answer { ranked, abstained }`, `Truth { items, abstain? }`, path normalisation, `hitAt1`, `hitAt5`, `hitAtK`, `meanReciprocalRank`, `recallAtK`, `recallAtAll`, `precision`, `strictAccuracyAtK`, `ndcgAtK`, and `callsPerAnswer`; `MetricName`/`LOWER_IS_BETTER` declare comparison direction ([branch:retrieval-metrics.ts:1-47](../../../../tools/mcp-bench/src/metrics/retrieval-metrics.ts)). The source normalises workspace-relative paths before matching ([branch:retrieval-metrics.ts:57-77](../../../../tools/mcp-bench/src/metrics/retrieval-metrics.ts)); that is useful for corpus/file retrieval, but curation needs stable memory/candidate IDs rather than path normalisation.

Fit: **as-is for recall@k, NDCG@k and rank precision** when labelled memory/skill targets can be expressed as ranked IDs. `precision()` covers the whole returned ranking, not configurable precision@k ([branch:retrieval-metrics.ts:145-154](../../../../tools/mcp-bench/src/metrics/retrieval-metrics.ts)); add a pure `precisionAtK` helper if the design requires that exact measure. It does not calculate extraction precision/recall, dedup/merge accuracy, contradiction/update correctness, retention false-delete rate, Cohen’s kappa, or Spearman correlation.

### `metrics/cost-metrics.ts` and `transport/call-recorder.ts`

Public cost API is `resultTokens(result)`, `p50Latency`, `p95Latency`, `errorRate`, and `truncationRate` over `CallOutcome` ([branch:cost-metrics.ts:3-24](../../../../tools/mcp-bench/src/metrics/cost-metrics.ts)). The recorder exports classified calls/results, retry policy, `CallRecorder`, and `CallSummary` ([branch:call-recorder.ts:25-209](../../../../tools/mcp-bench/src/transport/call-recorder.ts)).

Fit: **as-is for returned-result tokens, calls per answer, p50/p95 latency, error rate, and truncation rate**. It is not evidence of model input/output/billed tokens for extraction or synthesis unless the benchmark’s LLM adapter records those separately; `resultTokens` tokenizes a returned string, so it is not a provider usage counter. Cost aggregation is a pure addition; adding named token dimensions to the shared scorecard is a schema change.

### `scorecard/scorecard.types.ts` and `scorecard-writers.ts`

The Zod schema fixes run metadata, pinned corpus metadata, suites, lifecycle rows, and eager selection ([branch:scorecard.types.ts:69-99](../../../../tools/mcp-bench/src/scorecard/scorecard.types.ts)). A suite requires `tool`, a claim ending in `ptah-core-prompt.ts:<line>`, question count, tool/native metrics, a four-field delta, verdict, and retrieval-style failures ([branch:scorecard.types.ts:25-68](../../../../tools/mcp-bench/src/scorecard/scorecard.types.ts)). Its metrics object permits extra **numeric/null** keys through `catchall`, but cannot hold confusion matrices, label provenance, judge/rater identities, agreement method, or structured per-case outcomes ([branch:scorecard.types.ts:3-24](../../../../tools/mcp-bench/src/scorecard/scorecard.types.ts)). `na` requires a reason and is only counted as not-applicable, never as passed ([branch:scorecard.types.ts:55-68](../../../../tools/mcp-bench/src/scorecard/scorecard.types.ts)). Writers validate before JSON/Markdown output ([branch:scorecard-writers.ts:5-34](../../../../tools/mcp-bench/src/scorecard/scorecard-writers.ts)).

Fit: reusable writer/validation/verdict discipline, **not** reusable as the full 620 result model. Adding a numeric `cohen_kappa` or `false_delete_rate` happens to parse, but it leaves no ground-truth/judging semantics and cannot describe curation cases. The required suite/claim/baseline/delta shape also misstates write-quality and skill-rubric studies.

### `corpus/corpus.ts`

`readCorpusConfig`, `withPinnedCorpus`, `withLifecycleCorpus`, and `countEligibleFiles` are the public API ([branch:corpus.ts:11-24](../../../../tools/mcp-bench/src/corpus/corpus.ts)). `withPinnedCorpus` creates a detached worktree at the configured commit and reports eligible-file count ([branch:corpus.ts:28-54](../../../../tools/mcp-bench/src/corpus/corpus.ts)); `withLifecycleCorpus` copies that checkout without `.git`, invokes a scenario, then removes the copy ([branch:corpus.ts:76-96](../../../../tools/mcp-bench/src/corpus/corpus.ts)).

Fit: **as-is** for a frozen source/fixture repository and mutation-bearing lifecycle scenarios. It does not freeze or seed the memory database, session JSONL histories, human labels, candidate/skill directories, nor provide two-workspace/worktree scenario fixtures. Those are additions around it, not changes to this helper.

### `transport/host-launcher.ts`, `bench-host.entry.ts`, and `mcp-client.ts`

`launchBenchHost` exposes a real CLI-headless HTTP MCP host; it waits for readiness, confirms the host-reported home equals its temporary home, probes `tools/list`, and records cold-start time ([branch:host-launcher.ts:253-340](../../../../tools/mcp-bench/src/transport/host-launcher.ts)). The host uses the product transport/dispatcher/adapters without product-source changes ([branch:bench-host.entry.ts:2-12](../../../../tools/mcp-bench/src/transport/bench-host.entry.ts)).

Fit: **as-is** for MCP-tool retrieval and any Phase 5 injection outcome arm that can execute through this host. It does not itself invoke extraction, curation, clustering, judge, promotion, or retirement services, so 620 needs a bench runner/adapter for those paths. This is a pure addition unless their results must be emitted in the shared scorecard.

## 563 harness: port plan and limitations

Port the deterministic sample definitions and scenario fixtures, not the current filesystem-bound runner. `extract-eval.ts` selects the first ten eligible session JSONLs by SHA-256 of a fixed seed, uses a copied SQLite database, runs real history/window/extractor code, and alternates old/new prompt order ([extract-eval.ts:20-33](../TASK_2026_563_2939/harness/extract-eval.ts)). Put the selected JSONLs and human labels into a pinned corpus fixture; run each write/lifecycle case against a `withLifecycleCorpus` copy plus an isolated seeded database; route retrieval calls via `launchBenchHost`; feed its call records to existing cost metrics.

`merge-replay.ts` already defines a 20-item replay set and three before/after variants ([merge-replay.ts:102-115](../TASK_2026_563_2939/harness/merge-replay.ts)); convert those cases into labelled decisions (correct merge, incorrect merge, correct non-merge, incorrect non-merge) and retain the candidate IDs/input snapshots. This supplies dedup/merge precision and recall, while explicit update, contradiction and deletion cases must be newly seeded.

Weaknesses:

- The extraction sample is only 10 sessions ([extract-eval.ts:64-67](../TASK_2026_563_2939/harness/extract-eval.ts)) and the replay is 20 cases; neither supports broad generalisation or stable subgroup rates.
- Extraction explicitly disables MCP search, so it does not measure the shipped reuse-by-search behaviour ([extract-eval.ts:6-9](../TASK_2026_563_2939/harness/extract-eval.ts)).
- The harness reports model draft counts, status and LLM usage, but contains no independent correctness labels in its `UnitResult` ([extract-eval.ts:79-91](../TASK_2026_563_2939/harness/extract-eval.ts)). It therefore cannot establish extraction precision, update correctness, or retention safety without frozen human judgements.
- The older retrieval harness is explicitly a self-consistency proxy: a stored chunk is queried and sibling chunks are treated as positives; it says this must be replaced by real agent-run queries when available ([build-eval-harness.ts:11-19](../../../../scripts/build-eval-harness.ts)). It is not independent ground truth.
- Skill trigger evaluation’s generated prompts are a behavioural proxy, not a skill-correctness label. Its header says exactly one model call generates about five positives and five near misses; scoring is local precision/recall arithmetic ([trigger-eval.service.ts:16-25](../../../../libs/backend/skill-synthesis/src/lib/gates/trigger-eval.service.ts)). Use it as a secondary trigger metric, and add frozen human exemplar/rubric labels plus agreement measurement for the skill-quality claim.

## Gaps and coordination boundary

Pure additions (new files/runners, no 619 schema modification):

- `curation-metrics.ts`: binary/multiclass confusion counts and derived extraction precision/recall/F1; merge/dedup accuracy; contradiction/update correctness; false-delete/false-retain rates; case-level bootstrap/CI only if the benchmark design later asks for it.
- `agreement-metrics.ts`: Cohen’s kappa for categorical rubric decisions and Spearman rank correlation for ordinal scores, including defined missing/constant-vector handling.
- A frozen labelled curation corpus: extraction, duplicate/non-duplicate, update/contradiction, deletion/retention, two-workspace/worktree cases, and baseline outputs.
- A 620 runner/adapter that seeds isolated state, drives curation/skill paths, captures provider usage, and maps scenarios to the shared host/corpus lifecycle helpers.

Schema changes—**coordinate with the 619 session before making any**:

- Extend/replace `ScorecardSuite` so `claim` can cite the actual curation/skill code or ledger claim, rather than only `ptah-core-prompt.ts:<line>`.
- Add suite kind/arm and ground-truth provenance (frozen label-set ID/version, rater count, baseline identity), because `tool_metrics`/`native_metrics` does not describe human-labelled write-quality evaluation.
- Add structured per-case confusion/evidence fields (or a schema-validated external artefact reference) for TP/FP/TN/FN, update/contradiction/deletion outcomes, and retention false-deletes.
- Add agreement/rubric fields: rubric version, raters, ordinal scale, Cohen’s kappa/Spearman values, and adjudication status.
- Add cost fields for input tokens, output tokens, total/billed tokens, calls, latency and error rate; the current suite only names `tokens_p50`, calls, latency, and error/truncation ([branch:scorecard.types.ts:104-131](../../../../tools/mcp-bench/src/scorecard/scorecard.types.ts)).
- Generalise the baseline/delta representation so a curation arm may compare “old curator/no lifecycle/raw transcript/last-N/no injection” rather than `native_metrics` for a tool question.

## Isolation finding

**Confirmed:** the launcher creates a fresh temp home, redirects `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, XDG paths, `PTAH_CONFIG_PATH`, and `PTAH_DB_PATH`, then starts the child with that environment and cwd ([branch:host-launcher.ts:1-18](../../../../tools/mcp-bench/src/transport/host-launcher.ts), [branch:host-launcher.ts:261-281](../../../../tools/mcp-bench/src/transport/host-launcher.ts)). The host refuses startup unless `os.homedir()` is that isolated home and config/database paths are inside it ([branch:bench-host.entry.ts:84-105](../../../../tools/mcp-bench/src/transport/bench-host.entry.ts)). Before spawn and after shutdown, the launcher read-only stats and SHA-256 hashes the real `~/.ptah/state/ptah.sqlite` and `-wal`; any difference fails the run ([branch:host-launcher.ts:61-118](../../../../tools/mcp-bench/src/transport/host-launcher.ts), [branch:host-launcher.ts:306-312](../../../../tools/mcp-bench/src/transport/host-launcher.ts), [branch:host-launcher.ts:342-357](../../../../tools/mcp-bench/src/transport/host-launcher.ts)).

Hole: the guard watches only the main SQLite file and WAL, not `ptah.sqlite-shm` or any other real Ptah state/configuration. More importantly, it detects that state changed but cannot attribute a change to the bench: concurrent desktop/VS Code activity produces a fail-closed false positive, which the source documents ([branch:host-launcher.ts:13-18](../../../../tools/mcp-bench/src/transport/host-launcher.ts)). A curation runner launched outside `launchBenchHost` would bypass this protection entirely; require every 620 executable path to use the launcher/isolation contract.

## Final matrix

| Module | Reusable as-is | Gap | Change type |
| --- | --- | --- | --- |
| `retrieval-metrics.ts` | recall@k, NDCG@k, ranked precision | curation correctness; precision@k if required | addition |
| `cost-metrics.ts` + recorder | result tokens, calls, latency, errors/truncation | provider input/output/billed token accounting | addition; schema change if scorecard names dimensions |
| Scorecard schema + writers | validation, JSON/Markdown, pass/fail/na discipline | labelled curation, rubric agreement, provenance, non-tool baselines | schema change |
| `corpus.ts` | pinned repo and disposable lifecycle copy | seeded DB/session/label/skill fixtures | addition |
| Headless host + client | real MCP transport, cold start, isolated host | adapters for curation and skill paths | addition |
| 563 `extract-eval.ts` | deterministic sampling and paired prompt invocation | labels, larger sample, search-enabled evaluation, portable fixtures | addition |
| 563 `merge-replay.ts` | replay scenario skeleton and before/after variants | labelled TP/FP/TN/FN and update/deletion cases | addition |
| `build-eval-harness.ts` | only an historical self-consistency baseline | independent ground truth | addition |
| `trigger-eval.service.ts` | secondary local trigger precision/recall signal | human skill-quality rubric and agreement | addition; schema change for scorecard reporting |
