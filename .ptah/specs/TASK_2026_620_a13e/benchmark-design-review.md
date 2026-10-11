Verdict: REVISE

Review of `benchmark-design.md` (647 lines) against `context.md` (primary intent, 619 agreement), `forensics.md`, `bench-infra-fit.md`, `references.md`, `ground-truth-sources.md`, and the repository code at `main` `e0ca51e6e` plus the 619 branch (`fix/task-619-tool-benchmark`, read via `git show`, no checkout).

# Findings

## 1. Blocking — 586 row: ground truth comes from the system under test

- Location: `benchmark-design.md:83` (§2.3, "Activity feed correctness" row), against R-M1 at `:104`.
- R-M1 says: "Ground truth never comes from the system under test." The 586 row names as ground truth "DB tables written by the pipeline during the fixture run". The feed events and the DB tables are both outputs of the same pipeline, so the suite checks the pipeline against itself. The framing is inherited from `forensics.md:245`, but the design's own rule contradicts its own row.
- Required change: use the fixture's scripted expected-event list (the fixture knows which operations it caused) as the ground truth, or add an explicit R-M1 carve-out for parity invariants with the reason stated.

## 2. Blocking — four ledger rows ship without a baseline

- Location: `benchmark-design.md:83` (586: "parity with DB (invariant)"), `:90` (curator trigger/admission: "invariant"), `:96` (setup-wizard seed: "none"), `:98` (replay stage: "—").
- `context.md:38` requires a baseline for every feature. R-M2 (`benchmark-design.md:106`) says: "Every suite reports at least one baseline." R-L5 (`:68`) exempts invariant suites from MinE only, not from baselines. Four rows contradict both rules, and one of them (586) is one of the nine features named in the primary intent.
- Required change: define the invariant-suite baseline in R-L5 (for example: the previous release scorecard value, or the recorded-failure entry at freeze), or give each of the four rows a real baseline.

## 3. Major — forensics failure #9 (skills backlog growth) has no metric, no ground truth, no baseline

- Location: gap — no row in §2.3 (`benchmark-design.md:78-98`), no stage metric in §4.4 (`:244-258`), no Phase 4 row in §9.2 (`:557-580`).
- `forensics.md:35` (top failure 9): prefilter queue grew 605 → 1,193; 677 queued rows older than 14 days; 2,347 of 2,587 candidates never judged. `forensics.md:171` promised "queue age p95 and net backlog slope per stage". The design's funnel runs on a 30-session synthetic fixture only, so the real backlog is never measured and no fix is tied to it.
- Required change: add a backlog suite (snapshot audit on the frozen copy: queue age p95 per stage, net backlog slope, judged share), or an explicit `not measurable yet` ledger row with the reason.

## 4. Major — R-C4's determinism proof can never fire

- Location: `benchmark-design.md:488` (R-C4 step 2: "10 consecutive nightly runs on `main` produced byte-identical metric values"), against `:449` (cost `latency_ms {p50,p95}`) and `:436` (per-case `latencyMs`).
- Latency values change on every run. As written, no suite that reports cost can ever satisfy R-C4, so the flip to enforcing is a dead rule.
- Required change: scope "byte-identical" to the quality metrics of the suite and exclude cost, latency and timing fields.

## 5. Major — wall-clock and concurrency invariants sit inside CI suites that R-C2 declares deterministic

- Location: `benchmark-design.md:255` (retire: "reconcile completes within 30 s with a hung dependency"), `:254` (promote: "count ≤ cap under 2 concurrent promotions"), against R-C2 at `:466`.
- The 30 s bound is a wall-clock measurement; it will flake on loaded CI runners and its value breaks byte-identity (finding 4). The over-cap race has no stated deterministic interleaving, so it is either flaky or vacuous.
- Required change: drive the timeout check from an injected clock or a fake hung dependency with a deterministic wait; specify how the two concurrent promotions are orchestrated (for example, both scheduled through the replay double at chosen points).

## 6. Major — outcome study: the repeat-aggregation rule is unspecified

- Location: `benchmark-design.md:286-300` (§5.2 "2 repeats per task × condition"; §5.3 MDE 22/31 pts; `:299` MinE set near the MDE).
- The paired test needs one binary outcome per pair. The design does not say whether task success means both repeats succeed, one of two, or the mean. Each choice changes the effective MDE, so the quoted 22/31-point figures are not yet justified for any stated rule.
- Required change: state the aggregation rule (for example: task success = all repeats succeed, pairing at task level), and recompute the MDE under that rule.

## 7. Moderate — the inert reranker has no metric and no fix row

- Location: gap — `benchmark-design.md` §3.2 (`:128-134`) measures merge precision/recall, F1, cluster rate, calls per merge; §9.2 has no reranker row.
- `forensics.md:90` records the reranker as an inert no-op (always score 1, `embedder-worker.ts:277-295`). Merge precision and recall cannot detect a no-op reranker, because candidate order does not change merge decisions.
- Required change: add a reranker-effect metric (ranking delta vs a no-rerank arm over the merge candidate sets), or record the component as `not measurable yet` in the ledger with the reason.

## 8. Moderate — archaeology verdict accuracy is unmeasured

- Location: `benchmark-design.md:250` (§4.4 archaeology invariant: ordering and rejection-with-reason only); the fixture already carries labels (`:244`: `routine: id | none`, `degraded: bool`).
- `forensics.md:167` (S3): "Whether `routine` is correct is unmeasured; ground truth = human-labelled sessions." The design checks that degraded sessions are rejected, but not that the verdict matches the label, although the labels are already in the fixture.
- Required change: add verdict-vs-label accuracy to the archaeology stage of `skill.funnel`.

## 9. Moderate — forensics M2 silent-drop modes (d) and (e) have no case

- Location: `benchmark-design.md:184-187` (§3.8 fault cases cover modes (a), (b), (c), (b′) only); `:115` (§3.1 seeded sessions are templated, no length requirement).
- `forensics.md:70-71` records mode (d): windows beyond 8 lose the middle (`clamp-transcript.ts`, 25 % head); and mode (e): no transcript-hash dedup, so boot scan re-extracts. Nothing in the extraction or liveness suites plants facts in the middle windows of a long session, and nothing measures re-extraction cost or duplication.
- Required change: add a long-session case class (facts in middle windows beyond window 8) and a re-scan duplication/cost assertion to the liveness or extraction suite.

## 10. Moderate — known-failure semantics: "better" has no defined direction

- Location: `benchmark-design.md:480-483` (§7 recorded-failure semantics; entry schema `{suiteId, metric, recordedValue, tolerance, ledgerRow, since}`).
- "At or better than its recorded value within tolerance" needs a per-metric direction (higher-is-better or lower-is-better). The schema has no direction field, so the evaluator cannot decide "better", and a value that worsened but stayed inside the tolerance could pass the job. This is the one place a suite can pass vacuously.
- Required change: add a direction field (or a signed tolerance) to every known-failures entry.

## 11. Minor — no zero-case guard

- Location: `benchmark-design.md:464-491` (§7), `:413-423` (funnel details).
- Nothing states that a suite which executes zero cases is `na` rather than `pass` with empty or perfect rates (a mis-configured plan could then look green).
- Required change: state "zero executed cases ⇒ `na` ⇒ fails the CI job".

## 12. Minor — discordant-pair share 0.3 is an untested assumption

- Location: `benchmark-design.md:296-299` (§5.3).
- The MDE scales with √(discordant share). The 0.3 value has no pilot behind it.
- Required change: re-estimate the share from the first repeat and restate the MDE before any `no effect` verdict is read from the study.

## 13. Minor — matcher trust bar is noise-sensitive at n = 60

- Location: `benchmark-design.md:107` (R-M4: κ ≥ 0.8 on 60 sampled pairs).
- At n = 60 the 95 % CI on κ is roughly ±0.10–0.12, so a true κ of 0.75 can pass and 0.85 can fail.
- Required change: report the CI with the point estimate, and raise the sample to ≥ 100 pairs if the bar must discriminate near 0.8.

## 14. Minor — B9's verification depends on a batch it does not list

- Location: `benchmark-design.md:548` (§9.1, P3-B9: "Depends on P3-B2, B3", verification "κ/ρ computed by B7's suite").
- B9 also completes `fixtures/task-620/memory-facts.v1.jsonl` (created by B3) and adds to `MANIFEST.json`. B9 is not parallel with B3, so the outline stays file-disjoint, but the dependency list is wrong as written.
- Required change: name B7 (or the P3-B1 metrics module) as the verification dependency, and note in the batch table that B9 modifies B3's files.

## 15. Minor — offline suites in the parent stretches the 619 agreement sentence

- Location: `benchmark-design.md:323` (§6.1: offline suites "run in the parent inside the guarded window"), against `context.md:89` ("Every 620 run goes through `launchBenchHost`").
- The reading is defensible for pure CSV computations, but the parent process is not launched by `launchBenchHost`, and the agreement sentence is absolute.
- Required change: confirm this reading with 619 (add it to the 6.6 request list) before Phase 3 builds the runner.

## 16. Minor — "[user-requested: labels in the repo]" tag is not traceable

- Location: `benchmark-design.md:620` (§10.3 row 1), `:227` (§4.2 label storage).
- Per the design's own §0 convention, [user-requested] means stated in `context.md` or the Phase 2 request. The committed-CSV idea comes from `ground-truth-sources.md:125` (a Phase 1 researcher proposal). The tag as applied is a misattribution unless the Phase 2 request said it.
- Required change: re-tag as [proposed], or cite the request line that asked for labels in the repository.

## 17. Minor — `judged-model` stratum is sampled by the pipeline's own scores

- Location: `benchmark-design.md:204` (§4.1: "stratified by pipeline judge-score band among model-synthesized candidates").
- The human-labelled set's composition is conditioned on the system's own judge output. The labels stay human, so this is not a leak, but the judge-agreement figures (§4.3) are computed on a set the judge itself helped select.
- Required change: state this as a known limit in §4.3, or stratify by an independent axis (cluster size, date, session count).

# What was checked and passed

## Feasibility spot-checks against the code (8 of 8 verified)

1. **`launchBenchHost` has no fixture-seeding hook** (design §1.2, K3). `tools/mcp-bench/src/transport/host-launcher.ts` on `fix/task-619-tool-benchmark`: `HostLaunchOptions` carries `workspaceRoot`, `hostScript`, `realHome`, guard tuning, timeouts, `keepAlive`, `requestTimeoutMs` only; the temp home is created inside the launcher. The 620 host-script plan (§6.1) is the only route that fits.
2. **Lifecycle and retention accept an injected clock.** `libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:80-83` (`runStep(budget, nowMs)`) and `memory-retention.service.ts:188` (`options.now ?? Date.now`). Simulated days need no product change.
3. **No memory-injection off switch.** `'memory.enabled'` is read only at `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:1048` (capture + curate gate); `memory-prompt-injector.ts` never reads it. The empty-DB arm for M0 is the correct construction.
4. **Retirement default is 30 days.** `libs/backend/skill-synthesis/src/lib/lifecycle/skill-retirement.service.ts:48` (`RETIREMENT_DAYS_DEFAULT = 30`). K2 is right; forensics S8's 60 belongs to a different key.
5. **Rubric scale is 0-10, pass ≥ 64/80, no criterion < 6.** `471/skill-quality-criteria.md:51-66`. K4 is right.
6. **`MIN_SCORE = 0.05`.** `libs/backend/agent-sdk/src/lib/helpers/memory-prompt-injector.ts:62`.
7. **Bait classes are real.** `libs/backend/agent-sdk/src/lib/curator-llm-adapter/extract-prompt.ts:54-66` lists the sediment classes (transient events, task/worktree chatter, repo-restated rules) the design's bait plan copies.
8. **Curator seam.** `memory-curator.service.ts:457` (`async curate(input)`) with `transcript?` at `:134` — the replay double can drive the real path.

Also verified: `.github/workflows/` holds 21 files; the nightly precedent at `nightly-coverage.yml:9-11` exists as cited. `git status` confirms `.claude/skills/ptah-surface-authoring/` is untracked, so K1's "23 human-authored positives" treatment is correct.

## Coverage (context.md primary intent)

All nine named features (440, 443, 461, 586, 473 Track A, 563, 578, memory injection, skill injection) have a §2.3 row with a metric, a ground-truth source and a verdict rule; `na` maps to `not measurable yet` (R-L2) and `proven` requires frozen independent ground truth plus a baseline plus a moved metric (R-L3). Gaps are findings 2, 3, 7, 8, 9. Real-lifecycle scenarios (new session, update/contradiction, deletion, two workspaces, worktrees) and the cost dimensions (tokens, calls, latency, error rate) are all present (§3.3, §3.6, §3.7, §6.5).

## Circularity

The rubric-from-exemplars problem is acknowledged (K5) and mitigated correctly: ledger rows may say "rubric-proven", never "useful", and the outcome study is the only usefulness evidence. Seeded facts cite git artefacts only, with a drafting lane barred from `~/.ptah` and human acceptance per fact (§10.1). The trigger-eval self-generated prompts are used only as a labelled self-consistency baseline (§4.4). Live-DB rows are rejected as ground truth everywhere except the two rows in finding 1. Remaining limits are findings 1 and 17.

## Determinism

CI suites are replay-based and model-free; the embedder cache is filled in a setup step with network, and execution runs under the net recorder (§6.2). The cross-platform embedding assumption is flagged with a check and a fallback. The two CI determinism breaks are findings 4 and 5. No CI suite needs wall-clock time or unpinned data otherwise; the `created_at` injectability assumption (§3.3) is flagged with a fallback.

## Statistical soundness

The MDE arithmetic is correct (2.8 × √(0.3/48) ≈ 0.22; 2.8 × √(0.3/24) ≈ 0.31), and setting MinE at the detection limit is honest — smaller effects land in `no effect` with the interval shown. The κ ≥ 0.6 / ρ ≥ 0.7 trust bar is carried from `ground-truth-sources.md:126` as claimed; candidates-only κ handling (undefined when all fail) is handled with raw agreement. The 105-document composition sums correctly (23+2+10+18+20+20+12). Open statistical gaps are findings 6, 12, 13.

## CI gate logic

`na` on a CI suite fails the job; an unlisted `fail` fails the job; a listed failure that now passes fails the job with a ratchet instruction; cassette misses and guard trips fail the job. Recorded-failure mode cannot pass vacuously through `na`. The two vacuous-pass risks are findings 10 and 11.

## Gate SR

All 20 SR rows trace to real forensics claims: C-S12, C-S1, C-S2, C-S4, C-S3, C-S9, C-S5, C-S6 (skills) and C-M9, C-M11, C-M3, C-M4, C-M5, C-M6, C-M8, C-M10 (memory), plus three ledger-level absolutes and the tracker doc. The remaining claims (C-S7, C-S8, C-S11, C-M7) are correctly listed as measured. No forensics claim is dropped: C-S10 does not exist in the forensics numbering, and C-M1/C-M2 are 619-owned. No missing SR claim was found. One judgement note: SR-11 rewords C-M3, which forensics scored "HOLDS, narrow" — defensible as a presentation fix, and the user decides per row.

## Batch outline (§9.1)

File-disjoint within each parallel set ({B1, B2, B3} and {B6, B7} touch no shared file). `npx prettier --check <changed paths>` is in the common verification of every batch, and B8 also checks the workflow file. No batch edits `scorecard.types.ts` or `scorecard-writers.ts`; B4's verification even asserts no diff against the 619 SHA. The conditional `project.json` modification in B5 is gated on 619's answer (§6.6(3)). Bench data stays outside the repository and outside `~/.ptah` (§10.3). The only outline defect is finding 14.

# Summary

The design is strong: it corrects the record where forensics was wrong (K1-K5), builds every ground-truth set from sources the system did not produce, keeps the 619 boundary, and its recorded-failure gate cannot pass through `na`. The verdict is REVISE for two blocking contract contradictions (findings 1, 2), four major design defects that would make parts of the gate dead or unjustified (findings 3-6), and the moderate and minor items above. All blocking and major fixes are small, localized edits to the design text; none requires re-architecting.