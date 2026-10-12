Verdict: APPROVED

Re-review of `benchmark-design.md` (revised) against the 17 numbered findings in `benchmark-design-review.md`. Method: the Revision log (line 712) was read first; only the sections it names were read (2.1, 2.3, 3, 3.1, 3.2, 3.8, 4.1, 4.3, 4.4, 5.3, 6.1, 6.2, 6.3, 6.6, 7, 9.1, 9.2, 10.3). The revision did not touch the parts the round-1 spot-checks passed.

## Finding status

| # | Severity | Status | Evidence (design section) |
|---|---|---|---|
| 1 | Blocking | RESOLVED | §2.3 row 84 and §4.4 line 261/277: feed-parity ground truth is the expected event list derived from the fixture script, "not from anything the pipeline writes"; DB-table parity is demoted to a secondary diagnostic. The script declares the operations the bench causes, so the truth source is independent of the pipeline. R-M1a (line 108) bars quality claims from the audit carve-out. |
| 2 | Blocking | RESOLVED | R-L5 (line 68) now requires a baseline on invariant rows: a real one where it exists, else the value recorded at freeze, and the row says so. All four rows comply: 586 = recorded at freeze (row 84); curator trigger = recorded at freeze + previous snapshot (row 91); setup-wizard seed = append-only policy (row 99); replay = recorded at freeze, coverage 0 (row 101). |
| 3 | Major | RESOLVED | New row 92 (§2.3); `skill.backlog.drain` (§4.4 line 279: queue age p95 per stage, net backlog slope, judged share, scripted load, injected clock) and `skill.backlog.audit` (§4.4 lines 283-288, read-only SQL on the frozen snapshot, baselines = 471 and the 2026-10-06 copy); R-M1a carve-out with the reason stated (line 108); CI table lines 517/519; Phase 4 row line 640; zod lines 457-464. |
| 4 | Major | RESOLVED | §7 R-C4 step 2 (lines 539-545): the determinism proof hashes a canonical-JSON projection that excludes `cost` latency and tokens, per-case `latencyMs`, run id, timestamps, host pid and port, and safety-cap timing; `calls` is kept. A suite that reports cost can now satisfy the proof. Core-field request 6.6 item 7 (line 507). |
| 5 | Major | RESOLVED | §4.4 lines 262-264: time-based invariants run on an injected clock or scheduler; wall-clock durations are never asserted and never enter the projection; the 120 s cap only aborts a hung case. Retire/reconcile row (line 275) uses the injected clock and a fake dependency. The over-cap race uses scripted interleavings with a stated outcome when no pause point exists (line 281). |
| 6 | Major | RESOLVED | §5.3 (lines 326-336): aggregation rule stated — per-task mean of r = 2 repeats, paired at task level, fixed-seed bootstrap. The MDE was recomputed under that rule: memory n = 48 gives 16-22 pts, skills n = 24 gives 22-31 pts (2.8 × σ_d / √n with σ_d² between 0.15 and 0.30 checks out against the stated bounds), and MinE is set at the conservative ends 22 / 31 pts (rows 88-89). The figures now follow from the stated aggregation and sample size. |
| 7 | Moderate | RESOLVED | §3.2 lines 140-144: `mem.dedup.rerank` measures NDCG@5 vs the no-rerank identity order and reranker score variance (0 ⇒ inert); row 93; Phase 4 fix-or-delete row line 639; zod line 420; CI table line 518. |
| 8 | Moderate | RESOLVED | §4.4 archaeology row (line 270): verdict accuracy vs fixture labels for `routine` and `degraded`, with a majority-class baseline; Phase 4 row line 643. |
| 9 | Moderate | RESOLVED | Mode (d): long-session class in §3.1 (line 120, facts in windows 4 through n-4, middle-window recall, expected ≈ 0 today). Mode (e): `mem.liveness.rescan` in §3.8 (lines 196-200, 0 new rows, 0 extra model calls, `fs.utimes` past the watermark). CI table line 517; Phase 4 rows 641-642; zod line 429. |
| 10 | Moderate | RESOLVED | §7 lines 528-532: `direction` is mandatory per known-failure entry; tolerance defaults to 0 for CI and needs a written reason otherwise; an improving-but-still-failing entry forces tightening the recorded value. |
| 11 | Minor | RESOLVED | R-L5a (line 69) and §7 line 533: zero executed cases ⇒ `na` (reason `zero-cases`) ⇒ fails the job. |
| 12 | Minor | RESOLVED | §5.3 lines 332-336: σ_d is re-estimated from the first repeat; MDE and MinE restated in the ledger before any `no effect` verdict; if the restated MDE exceeds MinE by more than 5 pts the row stays `not measurable yet`. |
| 13 | Minor | RESOLVED | R-M4 (line 111): sample ≥ 100 pairs with ≥ 40 true matches; κ always reported with its 95% interval; lower bound ≥ 0.7 to gate. |
| 14 | Minor | RESOLVED | §9.1 P3-B9 (line 606): verification dependencies named as P3-B1 + P3-B7; the row states B9 modifies B3's files and runs after B3 is committed, never in parallel. |
| 15 | Minor | RESOLVED | §6.1 line 360: the runner-process reading is flagged as needing 619's confirmation before P3-B8, with the fallback (move the computations into the host plan) stated; request 6.6 item 6 (line 506). |
| 16 | Minor | NOT RESOLVED | §10.3 line 683 still tags the committed-CSV location "[user-requested: Phase 2 request item 5, 'labels in the repo']". The rule was written by the orchestrator, not requested by the user, so the citation does not make the tag traceable. The tag must be [proposed]; only the path qualifier may stay. |
| 17 | Minor | RESOLVED | §4.1 line 219: `judged-model` is stratified by creation week × transcript size, independent of the judge; §4.3 line 256 states the `anchor-471` selection as a known limit and reports agreement without that stratum as well. |

## New findings

None blocking or major. One minor observation:

- **Minor** — §4.4 line 264 (and §7 line 545). The 120 s wall-clock safety cap writes a `fail` verdict for a case that is merely slow on a loaded runner, not hung. The projection excludes the cap timing, but the verdict field is inside the projection, so a load-induced abort breaks the R-C4 determinism proof instead of silently passing. Required change: record per-case CI runtime when the suites first run and confirm it is far below 120 s before any R-C4 flip, or retry a safety-cap abort once before recording `fail`.

## Verdict reasoning

Findings 1-5 (both blocking, three major) and finding 6 are resolved with verifiable evidence. No new blocking or major problem was introduced by the revision. Finding 16 remains open at its round-1 severity (Minor): the [user-requested] tag at line 683 must be re-tagged [proposed] before the design text is treated as final, but it does not gate approval under the verdict rule. The new minor safety-cap observation likewise does not block.