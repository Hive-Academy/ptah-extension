# Code Logic Review — `TASK_2026_620_a13e`, Phase 3.5

## Summary

| Metric | Value |
| --- | --- |
| Assessment | REVISE |
| Blocking | 0 |
| Serious | 5 |
| Moderate | 0 |
| Failure modes | 5 |
| Scope | Batches 17–20 memory suites, host registration/plan constraints, snapshot audits, and host-only-import guard |

The score is **4/10**: the suites exercise substantial real infrastructure and the snapshot-copy and clock restoration paths are present, but five defects can produce benchmark results that are not evidence of the stated product claim. This is below the 5–6 band because the affected scores can be materially wrong rather than merely incomplete. It is above 1–2 because the product host wiring, fixture isolation, result schema, and several direct product ports are implemented.

## Findings

1. **Serious — B18 — the shared commit simulation persists a different draft from the one the product commits.** `merge-update-pass.ts:213-237` retains only `mergeTargetId` from the resolver response, then appends/inserts the original `draft`. The product iterates each resolved draft and persists its returned `content`, `subject`, salience, and related fields (`memory-curator.service.ts:825-889`). A resolver that corrects a fact, subject, or salience can therefore score as a correct merge/update/temporal outcome in the suite while the product would store a different row, or vice versa. This affects `mem.dedup`, `mem.update`, and `mem.temporal`; their pass/fail results are not evidence for the real commit path. The Batch 18 report's description of a product port does not disclose this behavioural reimplementation.

2. **Serious — B18 — `mem.dedup.rerank` compares reranked hits with a purported no-rerank order derived after reranking.** `dedup.suite.ts:545-552` calls product `searchRich`, assigns those output hits to `reranked`, then calls `rrfOrder(hits)` on the same already reranked/pruned set. It never obtains the collector's pre-rerank candidate set/order. Consequently a positive NDCG delta can be caused by filtering or post-rerank ordering, and a harmful reranker can be masked. The baseline is not the named no-rerank baseline, so the suite verdict is not honest for the reranking claim.

3. **Serious — B17 — liveness fault and rescan results are pass/fail evidence from a scripted curator, not the product's curator path.** `liveness.suite.ts:7-22` explicitly substitutes `ScriptedLivenessCurator`; `liveness-harness.ts:316-319` registers it in the child container; and `liveness-harness.ts:235-258` reaches private trigger methods through a cast. Nevertheless the fault suite emits `pass`/`fail` when its scripted control and fault arms pass (`liveness.suite.ts:453-477`), and the rescan suite does likewise for its scripted observations. The report candidly calls out the scripted curator, but that disclosure does not satisfy the task rule: where the result is not the real product path it must be `na`, not a product pass/fail. A scripted double can prove only the harness's injected shapes, not provider failures, cancellation, or the public trigger path.

4. **Serious — B19 — scope-write's required isolation/order is documented but not represented in the plan contract.** The suite reads `preexistingRows` (`scope-write.suite.ts:422`) but never uses it in `pass` or `naReason` (`scope-write.suite.ts:506-512`); it can therefore emit `pass` after another suite has changed the shared database. The Batch 19 report requires it to be the only suite so `preexistingRows` is zero (`batch-19-report.md:136-141`), while both plan schemas only reject duplicate ids (`runner-plan.ts:71-89`; `host/plan.schema.ts:247-253`) and the host executes arbitrary plan order (`memory-skills-host.ts:308-336`). A normal composed plan can silently yield a success-looking scope result under the precondition the report says is necessary.

5. **Serious — B20 — destructive retention suites have only a comment-level ordering constraint.** The suites state that they archive/delete every other row and must run last or alone (`retention.suite.ts:17-18`), but register as ordinary host suites (`memory-skills-host.entry.ts:52-64`). As above, `runner-plan.ts:71-89` and `host/plan.schema.ts:247-253` do not encode exclusion or last-position constraints, while `memory-skills-host.ts:308-336` runs the caller's list in order. A plan can put lifecycle/growth/roster before another measurement and silently change that measurement's seeded database; its later pass/fail then describes the mutated state, not its declared fixture. Batch 20 reports this as an out-of-scope observation, but leaves its own and downstream verdicts authoritative.

## Five logic questions

1. **How does this fail silently?** A plan with prior rows can still produce a `mem.scope.write` pass because the observed precondition is only reported, not gated (`scope-write.suite.ts:422`, `scope-write.suite.ts:506-512`). Likewise an arbitrary plan can run retention before a later suite and receive a normal completion record (`memory-skills-host.ts:308-336`).
2. **What user action produces unexpected behaviour?** Adding any host suite before `mem.scope.write`, or placing a retention suite before another database-dependent suite, is accepted by the schemas (`runner-plan.ts:71-89`; `host/plan.schema.ts:247-253`) despite the batch reports' required ordering.
3. **What input data produces a wrong answer?** A curator response that changes any resolved draft field other than `mergeTargetId` is scored using the original draft (`merge-update-pass.ts:213-237`). A reranker that changes the candidate population/order is compared with a post-rerank reconstruction, not the required pre-rerank baseline (`dedup.suite.ts:545-552`).
4. **What happens when a dependency fails, times out, or returns a shape it should not?** B17's scripted double supplies the fault results and private-method harness, so a pass/fail result proves that stand-in's behaviour rather than an actual curator/provider failure (`liveness.suite.ts:7-22`; `liveness-harness.ts:316-319`). The lifecycle clock itself is restored with `finally` in the examined retention paths; no separate finding is supported for a normal thrown suite error.
5. **What is missing that the requirements never mentioned?** The plan schema needs explicit suite capabilities/constraints (exclusive, first, last, or fresh DB) rather than comments and report instructions. It also needs a way for a suite using an intentional harness double to publish `na`/harness-only evidence instead of a product verdict.

## Per-suite evidence table

“Real product path” means the scored operation reaches the product behaviour claimed by the suite, not merely product stores around a replacement implementation. “Verdict honest” means the current pass/fail/na state follows that distinction.

| Suite id | Measures real product path? | Verdict honest? |
| --- | --- | --- |
| `mem.extraction` | partly | yes |
| `mem.liveness.faults` | partly | no |
| `mem.liveness.rescan` | partly | no |
| `mem.dedup` | partly | no |
| `mem.dedup.rerank` | no | no |
| `mem.update` | partly | no |
| `mem.temporal` | partly | no |
| `mem.update.seed` | yes | yes |
| `mem.search.fts-and` | yes | yes |
| `mem.injection.recall` | yes | yes |
| `mem.abstention` | yes | yes |
| `mem.scope.write` | yes | no |
| `mem.retention.lifecycle` | yes | no |
| `mem.retention.growth` | yes | no |
| `mem.ranking.roster` | yes | no |
| `mem.liveness.audit` | yes (snapshot audit) | yes |
| `skill.backlog.audit` | yes (snapshot audit) | yes |

## Checks and residual evidence

- Invoked the permitted scoped command: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand`. The requested `^Tests:` filter emitted no matching line in the captured output, so no Jest total is claimed here.
- `ptah_get_diagnostics` did not complete a targeted compiler analysis; it reported the broad TypeScript check still running/unchecked. No diagnostic-clean claim is made.
- Reviewed the complete B17–B20 suite/adapter/test surfaces identified in the task, relevant plan/host execution code, B17–B20 reports, design/context requirements, and root contributor instructions. Snapshot audit safety is supported by the isolated-home resolution and read-only/hash-checked path documented in `snapshot-audits.suite.ts:7-19`; no data-safety finding was evidenced. `host-only-imports.spec.ts:88-100` still prevents non-host, non-host-only value imports, so allowing host-only modules to import one another has not made that guard vacuous.

## Verdict

**REVISE.** Fix the B18 shared commit and rerank baseline first, mark scripted-liveness results `na` until a supported public/product seam exists, and encode plan isolation/order constraints so composition cannot silently invalidate a suite result.
