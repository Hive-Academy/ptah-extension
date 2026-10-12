# Phase 3.6 code-logic review — skills suites (Batches 21–23)

Reviewer: code-logic-reviewer (CLI lane). Scope: every file under
`tools/mcp-bench/src/memory-skills/suites/skills/` (25 files, read in full),
`host/memory-skills-host.entry.ts`, `host/suite-placement.ts` (+spec),
`host-only-imports.spec.ts`, `runner/run-memory-skills.entry.ts`, plus the
shared modules the suites sit on (`funnel-port.ts` types were read via
`funnel-port.ts` itself; `projection.ts`, `ground-truth-freshness.ts`,
`run-memory-skills.ts:590-617`), the fixture
`tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/index.json` and its
generator (`ground-truth/skill-session-fixture.ts`), the product producers in
`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`, and the task
documents (benchmark-design.md 4.2–4.4, batches.md 777–835, batch-21/22/23
reports, batch-11-1-report.md Revision 3, context.md 471 decisions 6–9).

The PROGRAM RULE (Phase 3.5): a pass/fail verdict is evidence only if the
scored operation runs the real product path, on ground truth the product did
not produce, against a named baseline; otherwise `na` with a precise reason.
Every suite was judged against it (per-suite table below).

## The five logic questions

1. **How does this fail silently?** The one silent path found: the shared 22.1
   funnel pass is memoised per `runId` but its shaping options
   (`sessionsDir`, `capMs`) are parsed per suite, so divergent per-suite plan
   options are swallowed — every later stage suite scores a pass run under the
   first suite's options while recording only its own `cassetteVersion`
   (Finding 3). Second: a `skillSynthesis:analyzeNow` RPC failure that is not
   "Method not found" is folded into `'ran'` and the error string is dropped
   (Finding 4). Everything else fails loudly: a broken fixture/labels/corpus
   throws, a cassette miss turns every affected suite `na: cassette-miss`
   (`stageVerdict`, funnel-report.ts:180-182, pinned by the empty-cassette
   spec), a capped run records `observed: "error: safety-cap"` on its run case.
2. **What user action produces unexpected behaviour?** A plan author giving
   two funnel stage suites different `sessionsDir`/`capMs` (Finding 3), or
   listing the local-only B23 suites in a `--ci` plan (Finding 7 — loud
   failure, not silent). The 30-day default backlog load under the default
   120 s cap on a slow host ends as a distinguishable `safety-cap` fail with no
   retry (judged below, accepted deviation).
3. **What input makes this produce a wrong answer rather than an error?** The
   fixture's `expectedEvents: []` for sessions 20–22 (Finding 1): the suite
   reports a permanent misleading `fail` (phantom `analyze-run`) on a product
   that behaves exactly as the fixture's own prefilter model describes. And
   the judge stage's fixture-scale `pass` read as closing the design's
   copy-scale "expected fail" row (Finding 2).
4. **What happens when a dependency fails, times out, or returns a wrong
   shape?** Covered: cassette miss → `na` (R-M5); a lane call that throws →
   `judge-calls-errored: n of m` → `na` (judge-agreement.suite.ts:694-696); an
   unscored judge call counts for neither control; the never-resolving
   repropagation → the reconcile-wait case ends at its own cap as `fail`
   (`safety-cap`, pinned by funnel-lifecycle.spec.ts:169-174); no harness
   propagation service → delivery `na` naming it; no embedder / gate off →
   trigger `na` with the product's own skip reason; an unreadable docs file →
   the replay docs invariant stays open, never passes (funnel-stages.ts:692-710).
5. **What is missing that the requirements never mentioned?** The design's
   judge-stage "expected today: fail (2,347 unjudged on the copy)" names a
   dataset (the frozen copy's backlog) that no funnel suite loads — the
   copy-scale quantity belongs to `skill.backlog.drain`'s 30-day run and the
   Phase 4 backlog audit (Finding 2). The fixture script vocabulary has no
   way to express the shared drain cycle's spillover onto sessions whose own
   script has no drain step (Finding 1).

## Numbered findings

1. **[Serious, Batch 22 (+ Batch 11-1 fixture)] `skill.funnel.feed-parity`'s
   ground truth for sessions 20–22 is unsatisfiable; every host run will
   record a permanent misleading `fail`.**
   - The fixture label is confirmed: sessions 20–22 carry
     `script: ["session-end"], expectedEvents: []`
     (skill-sessions.v1/index.json: entries `skill-session-20..22`;
     generator ground-truth/skill-session-fixture.ts:111), and the loader
     re-derives and cross-checks it (funnel-fixture.ts:53-58) — so the
     expectation is fixture-authored, independent of pipeline output.
   - But the fixture's own Revision 3 table (batch-11-1-report.md:63-67) says
     single-edit sessions **pass the prefilter by design** ("Edit work
     evidence … passes prefilter; later clustering is out of scope"), and the
     shared pass then causes one drain cycle for the whole queue
     (funnel-stages.ts:111; funnel-host-port.ts:214-234, which loops until no
     eligible frequent-tier row remains). A session the prefilter accepts is
     enqueued; every dequeued session leaves exactly one feed event —
     `analyze-run` after candidate registration
     (skill-synthesis.service.ts:1120-1125) or `ineligible` on rejection
     (:742-747, :915-920, :938-944). So `[]` is unreachable for these sessions
     under the fixture's own prefilter model: today it fails as phantom
     `analyze-run` (funnel.suite.spec.ts:229-245), and a hypothetical prefilter
     fix that rejects single edits would still fail as phantom
     `ineligible: prefilterRejected`.
   - Impact: the 586 claim row ("the feed shows exactly what the pipeline
     did") will be permanently red with phantom events attributed to the
     product, and no product change can turn it green — a misleading verdict on
     every run, and a gate that will be ignored. batch-22-report.md:190 flagged
     exactly this for reviewer confirmation; my confirmation is: **the label
     is intended, the expectation is not satisfiable** — it contradicts the
     fixture's own prefilter model plus the bench-caused shared drain.
   - Required fix (Phase 3.8 freeze, fixture version bump per
     ground-truth-freshness rules): add `drain-eligible-candidate` to
     sessions 20–22's scripts (expected `analyze-run`, which is what Revision 3
     itself predicts: prefilter accept → enqueued → the shared pass's drain
     analyzes it), or exclude sessions whose scripts carry no drain/reject step
     from the feed-parity scored set. Note the contrast that *is* honest
     fail-today ground truth: the missing `manual-run` for sessions 16–19 is a
     real product gap (the event kind is declared by
     `diagnostics.types.ts:3-18` and no skills producer emits it;
     batch-11-1-report.md:74 pins "fail today").

2. **[Moderate, Batch 22] The judge stage's observed `pass` is real at fixture
   scale, but the design's "expected today: fail" row measures a different
   quantity the suite never loads.**
   - `scoreJudge` (funnel-stages.ts:533-580) evaluates
     `panel-row-within-one-cycle` over the fixture-scale run only: 15
     model-body drafts, all paneled by the one weekly drain tick the pass
     causes (funnel.suite.spec.ts:218-227, panelShare 15/15). This is real
     product behaviour, not a synthetic-cassette artefact: the panel rows
     exist because the pass drove `SkillDrainService.drain` per tier
     (funnel-host-port.ts:214-234 → funnel-host-graph.ts:469-486) and the
     product persisted a row per draft; the cassette only supplies lane
     answers. The caveat: the `panel-scorecard-shape-constant` half does rest
     partly on the synthetic lane always answering with schema-shaped JSON
     (`valueFor` picks `min(maximum, 8)`, funnel-di.test-support.ts:82-125), so
     a degraded recorded answer could still fail it in the CI replay — the
     spec honestly labels the column "(synthetic)" and the batch report says
     the CI outcome depends on the live-recorded cassette.
   - The design's "Expected today: fail (2,347 unjudged on the copy)"
     (benchmark-design.md:273) describes the frozen copy's accumulated
     backlog — a dataset no funnel suite loads (it runs in the fresh isolated
     DB seeded only with the fixture), and a scale (2,347 > the weekly tick's
     400 cap) at which one cycle could not panel every draft anyway. The
     copy-scale quantity is measured by `skill.backlog.drain`'s
     `judged-share-is-1` over the scripted load (funnel-backlog.ts:244-252)
     and by the Phase 4 backlog audit.
   - Required action: do not let the ledger read this pass as closing the
     471-decision-7 backfill row; batch-22-report.md:67 and :191 already
     record the divergence — carry that note into the ledger row so the
     expected-fail is re-anchored to the copy-scale suites.

3. **[Moderate, Batch 22] Divergent per-suite options for the shared pass are
   silently swallowed.** `passFor` memoises the 22.1 pass per `context.runId`
   (funnel.suite.ts:235-261), but `funnelOptionsSchema.parse` runs per suite
   on that suite's own plan options (funnel.suite.ts:267). `sessionsDir` and
   `capMs` shape the shared pass, yet each suite's result records only its own
   `cassetteVersion` (funnel.suite.ts:283) — neither option appears in
   details or metrics. A plan that gives `skill.funnel.prefilter` and
   `skill.funnel.judge` different `sessionsDir` or `capMs` makes every suite
   after the first score a pass driven by the first suite's options, with
   nothing in any output showing it. `replayDocs` is per-suite and only used
   by the scorer — correct. Fix: refuse divergent pass-shaping options within
   one `runId`, or record them in the details of every suite that scores the
   memoised pass.

4. **[Minor, Batch 22] A non-"Method not found" RPC failure is folded into
   `'ran'`.** funnel-host-port.ts:195-212: `handleMessage` answering
   `success: false` for any other reason (handler error, invalid params)
   returns `'ran'` and discards the error string. The affected session then
   fails its fixture expectations (a fail, not a false pass), so the failure
   surfaces — but its cause is recorded nowhere in the result. Keep the error
   message in the trigger outcome or the run case's `observed`.

5. **[Minor, Batch 22] Child product containers and the never-resolving
   reconcile pass are never disposed.** `childProductContainer`
   (funnel-host-graph.ts:266-288) results from `restartFeed`
   (funnel-host-port.ts:278-289), the race (:435-437) and `reconcileWait`
   (:627-643) are never `.dispose()`d, and `reconcileWait()` deliberately
   leaves `curator.runManual()` pending forever (the design's "fake
   dependency never resolves"). Bounded at one pending promise plus one child
   registration set per retire-suite run, and the case itself is capped
   (`reconcileCapMs`, funnel.suite.ts:397) — no growth within a run — but the
   pending pass outlives the suite for the host process's life.

6. **[Minor, Batch 22] `skill.funnel.delivery` is order-dependent on the
   residents earlier `'last'` suites leave.** The lifecycle suites share the
   isolated DB in run order (promote → retire → delivery → backlog,
   funnel.suite.ts:366-464; host entry lines 73-76 after the judge suites' 115
   registered candidate rows). `delivery` promotes through the product's
   `readSettings().maxActiveSkills` while the promote races (3 schedules × 2
   residents) and retire's promoted seeds accumulate first. If they exhaust
   the cap, delivery returns `na` with "promotion refused (<reason>)" — honest
   and named, but the measurement depends on suite order. Consider promoting
   from a seeded-below-cap baseline or recording the resident count at entry.

7. **[Minor, Batch 23] The two local-only B23 suites do not refuse a `--ci`
   run.** The judge suites throw on `context.ci` because they are local-only
   (judge-agreement.suite.ts:803-807); `skill.namer.collisions` (private
   frozen copy) and `skill.trigger-eval.human` (U4 labels, real embedder) are
   equally local-only but never check `context.ci`
   (namer-and-trigger.suite.ts:56-79). A mis-planned `--ci` run fails loudly on
   the unseeded snapshot (`readFrozenCopy` throws, counts only) rather than
   `na` — no silent wrong result, only the asymmetry.

## Judged deviations (accepted, with evidence)

- **No re-implemented stage (B22 claim) — verified.** Every scored operation
  enters through a product entry point: `SessionEndCallbackRegistry` /
  `SessionActivityRegistry` / `PostToolUseCallbackRegistry.notifyAll`, the RPC
  method `skillSynthesis:analyzeNow`, `SkillSynthesisService.start` +
  `SkillDrainService.drain` per tier, `SkillPromotionService.promoteManually`,
  `SkillRetirementService.run`, `SkillCuratorService.start`/`runManual`,
  `SkillMdGenerator.writeCandidate`/`promoteToActive`, the product stores
  (funnel-host-port.ts throughout; funnel-host-graph.ts:386-639). The only
  overrides are exactly the sanctioned ones: the recorded lane runner shadowed
  to count calls/misses and call through (funnel-host-graph.ts:233-259), the
  observation-only store hooks in the race (log and call through,
  funnel-host-port.ts:440-455) and the commit-time re-read in retire (records
  one real event through the product recorder, then calls through,
  :530-547), the never-resolving `SKILL_REPROPAGATION_TOKEN` (:627-643), and
  the injected clock with synchronously captured trigger timers
  (captureTimers, funnel-host-graph.ts:180-227). The spec container builds
  production DI (`registerSkillSynthesisServices` over a real migrated
  better-sqlite3 file, real agent-sdk registries, real `JsonlReaderService`,
  real `CliFileSystemProvider`; LANE_RUNNER → RecordedLaneRunner over the
  synthetic inner lane) — funnel-di.test-support.ts:211-313. The scoring code
  (funnel-stages/lifecycle/backlog) is bench-side and reads product state,
  which is the bench's job.
- **Expected outcomes come from the fixture, not pipeline output — verified**
  (with Finding 1 as the one ground-truth defect): `expectedEvents` are
  re-derived from the script and cross-checked (funnel-fixture.ts:53-58);
  routine/degraded labels come from the fixture; the lifecycle scenarios seed
  state through the product's own stores and score what the product then
  does; the archaeology accuracy is scored against fixture labels with the
  majority-class baseline.
- **The no-retry deviation from R11 — sound.** `runOnceUnderCap`
  (funnel-report.ts:93-135) refuses the case runner's safety-cap retry because
  every funnel run writes the shared database: a second attempt would score
  mutated state (queue already drained, candidates reused by trajectory hash),
  and for the reconcile wait the first attempt's already-linked suggestion
  would make a retry settle falsely. The design itself (4.4) says a cap abort
  is `fail` with reason `safety-cap`, and the run case records
  `observed: "error: safety-cap"` plus `latencyMs` (funnel-report.ts:200-217),
  so a slow-machine cap abort stays distinguishable from an invariant fail.
  Residual: the 30-day default backlog load (funnel.suite.ts:112-122) under
  the default 120 s cap can end as `safety-cap` with no retry on a slow host —
  the batch report names it ("the 30-day verdict is measured only by the bench
  run"); pass a per-suite `capMs` in that plan.
- **B21 rubric suite recomputes only from committed CSVs and is `na` today —
  verified.** Reads only through the runner's read-path guard
  (rubric-agreement.suite.ts:374-377); the committed `MANIFEST.json` pins
  neither of the three label files (they do not exist), so the state is
  `absent` → `na: ground-truth-untrusted: … not committed (labels pending,
  U1)` (rubric-ground-truth.ts:288-292, :403-407); `hash-mismatch`/`unrecorded`/
  `missing` → `fail` (rubric-agreement.suite.ts:312-317); a broken label file
  throws `RubricGroundTruthError` (wrong header, quoted cell, missing rater
  row, foreign rater, duplicate row, adjudication that does not match the
  disagreement it claims to settle — rubric-ground-truth.ts:471-480, :523-660).
- **B21 judge suites run the real `SkillJudgeService`/`JudgePanelService` —
  verified.** judge-agreement-ports.ts: resolves the installed double, asserts
  it is `context.doubles.laneRunner`, builds a child container differing in
  `LANE_RUNNER_SERVICE` → pass-through `LaneTap` plus fresh service instances;
  store/settings/embedder from the host container unchanged. `na` precedence
  exactly as reported (judge-agreement.suite.ts:686-703). Raw outputs
  (`wx`-created) go only to `<runDir>/raw/<suiteId>.jsonl` inside the bench
  data folder; cases carry only ids, statuses, scores and reason tokens, and a
  spec asserts no document text or id-map slug reaches them
  (judge-agreement.suite.spec.ts:424-432). Local-only: `ci: true` throws
  (:803-807) — context.md decision "do not gate CI on LLM-judge accuracy"
  enforced in code.
- **B23 collisions on the frozen copy, counts only — verified.**
  `readFrozenCopy` re-checks the manifest hash against the pinned
  `FROZEN_CANDIDATES_MANIFEST_SHA256`, every file hash, missing/unlisted/
  non-regular entries and the directory count, and throws with counts only
  (namer-collisions.ts:143-191); the grammar probe writes only the synthetic
  `namer-probe` slug into a scratch dir removed in `finally`, and rethrows
  anything that is not the generator's own `slug collision` refusal
  (:209-261); `exampleIds` is always empty (:511-518). `na` always
  (report-only, benchmark-design.md:83) is the PROGRAM-RULE-correct call: the
  frozen names are the namer's own output — no independent ground truth, no
  named baseline — recorded with a precise reason.
- **B23 trigger scoring never calls a model — verified.** The child container
  binds `LANE_RUNNER_SERVICE` to `LabelledPromptLane` (answers the service's
  one generation call; no model, no I/O) and `SKILL_CANDIDATE_STORE` to
  `LabelledSkillLibrary`, asserts both resolve, and registers
  `TriggerEvalService` by class (trigger-human-eval.ts:343-375); everything
  after the generation call (embedding, rank, `TRIGGER_EVAL_TOP_K`,
  `TRIGGER_EVAL_MIN_SIMILARITY`, `measureRetrieval`) is the product's own code,
  with the embedder and settings from the host container. `modelCalls: 0`;
  the specs pin that the parent container's lane runner and store are never
  resolved. Verdict today `na: ground-truth-absent` (U4) with the reported
  priority list (:477-498).
- **Placement enforced — verified.** All 11 funnel suites and both judge
  suites declare `placement: 'last'` (funnel.suite.ts:265, :310;
  judge-agreement.suite.ts:801); `HOST_SUITE_PLACEMENTS` carries the same 13
  ids (suite-placement.ts), `suite-placement.spec.ts` pins table == declared,
  and the plan schema + host executor refuse a violating plan before any
  suite runs (module header; `suitePlacementProblems`). The two B23 suites are
  `'any'` and absent from the table — consistent with their declarations.
- **No user data in outputs — verified.** Namer: counts only (above). Judge:
  cases carry ids/statuses/scores/reason tokens, raw lane text only in the
  bench-data-dir raw file. Trigger: case inputs pass through `inputSha256`
  (only the hash is stored). Funnel: case records carry synthetic fixture
  session ids and `bench-*` seeded names; scenario bodies are bench-authored
  templates (benchSkillBody).
- **Every rate value == num/den — verified.** All rates go through
  `rateMetrics` (value/`.num`/`.den`); pinned by specs: the funnel stage spec
  checks every `.num`/`.den` pair (funnel.suite.spec.ts:155-172), the rubric
  spec asserts "Every rate metric triple satisfies value === num / den
  exactly" (rubric-agreement.suite.spec.ts:77), and the namer spec pins
  `slugCollisionRate` = 7/12 with its num/den
  (namer-and-trigger.suite.spec.ts:212-214).
- **Projection hash has no wall-clock — verified.** The projection whitelists
  verdict, details, the five deterministic per-case fields, ground truth,
  cassette version and `cost.calls`; `latencyMs`, `error`, `baselineOutcomes`,
  `cassetteKey`, run ids/timestamps/pid/port/safety-cap timing are dropped
  wholesale, and numbers are rounded to 6 decimals (projection.ts:4-33, :69-86).
  The Batch 21–23 suites put no wall-clock into details: the judge suites use a
  fixed `CANDIDATE_CREATED_AT = Date.UTC(2026, 9, 6)`
  (judge-agreement.suite.ts:111), the funnel details carry counts, rates and
  simulated-day figures, and every funnel/judge/trigger time is an offset on
  the injected clock.
- **The na-ratchet fix (commit b199fedde) — verified.** Only suites with
  `verdict !== 'na' && cases.length > 0` start a first-scored ground-truth
  entry (run-memory-skills.ts:597-617), so the rubric/judge/trigger suites'
  `na` results today cannot wedge out Batch 25's/U4's future labels.

## Per-suite table

| Suite id | Real product path | Verdict honest |
|---|---|---|
| `skill.rubric.inter-rater` | n/a (no product path; the scored operation is the real recomputation from committed bytes, guarded) | yes — `na` today (labels absent, U1); `fail` on manifest mismatch/unrecorded/missing; broken file throws |
| `skill.judge-agreement` | yes — record-mode local run: real `SkillJudgeService` behind the recorded lane runner, observation-only tap | yes — `na` precedence 1–5; replay → `na: lane-runner-replay`; local-only refusal on `ci` |
| `skill.judge-agreement.panel` | yes — real `JudgePanelService.evaluate` + product `registerCandidate` | yes — same precedence; degenerate lens reported as `panel.singlePanellist`, not hidden |
| `skill.funnel.prefilter` | yes — SDK trigger registries + `SkillDrainService.drain` + `analyzeSession` | yes — `na` in the spec (4 manual sessions unreachable, named); scored on the host; recall gated, precision only reported (design 4.4) |
| `skill.funnel.archaeology` | yes — nightly-tier drain over the real archaeologist and verdict store | yes — `fail` 15/15 with the real cause (archaeology row enqueued only after authoring); accuracy scored vs fixture labels with majority-class baseline |
| `skill.funnel.cluster` | yes — real candidate/suggestion stores | yes — `fail` 15/15 single-session auto-candidates; the unmeasurable half is `na`, never vacuous pass |
| `skill.funnel.draft` | yes — real candidate rows and body classification | yes — `na` (no fallback in a fully answered run); `fallback-marked` stays open with its reason |
| `skill.funnel.judge` | yes — weekly-tier drain over the real `JudgePanelService` | yes at fixture scale (Finding 2: the design's copy-scale expected-fail is not this suite's quantity; shape half depends on cassette well-formedness in CI) |
| `skill.funnel.feed-parity` | yes — real `recentEvents` ring + fresh product graph restart | verdict mechanically honest, **ground truth defective** (Finding 1: sessions 20–22 unsatisfiable `[]`); the restart fail is a real product gap (in-memory ring) |
| `skill.funnel.replay` | yes — real candidate/queue rows | yes — `na` without `options.replayDocs`; an unreadable docs file never passes |
| `skill.funnel.promote` | yes — real trigger path (Skill tool use), recorder, weekly tick, `promoteManually` race behind a pause gate | yes — `fail` (tracker has no caller); races record `no-interleaving-point` per case, closing 578 P1 as designed (benchmark-design.md:281) |
| `skill.funnel.retire` | yes — `SkillRetirementService.run`, curator reconcile, never-resolving repropagation port | yes — `fail` on the three real causes; the wait case ends at its own cap as `safety-cap` (design 4.4) |
| `skill.funnel.delivery` | yes when `HarnessSyncPropagation` is registered; `na` in the spec (no harness), named | yes — refusal and missing harness both `na` with reasons |
| `skill.backlog.drain` | yes — real `enqueueAnalyze` + the three drain tiers on the cron schedule, on the clock | yes — structure pinned on a 2-day load; the 30-day verdict honestly left to the bench run |
| `skill.namer.collisions` | yes — real `SkillMdGenerator.writeCandidate` grammar probe; classification is bench-side over the verified frozen copy | yes — `na` always (report-only, no threshold, no independent ground truth), counts only leave the suite |
| `skill.trigger-eval.human` | yes — real `TriggerEvalService.evaluate` scoring path; generation call answered by the labelled lane (no model) | yes — `na: ground-truth-absent` (U4) with the priority list; `modelCalls: 0` |

## Checks

- Allowed scoped run (the only check run by this review):
  `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand`
  → `Test Suites: 51 passed, 51 total` / `Tests: 573 passed, 573 total` /
  `Time: 157.651 s`. All Batch 21–23 spec files pass inside it
  (judge-agreement, namer-and-trigger, funnel-lifecycle, rubric-agreement,
  funnel.suite, suite-placement, host-only-imports).
- Not run (per the task rules): `nx run mcp-bench:test`, any real bench or
  bench host, `withPinnedCorpus`. No source file was modified; no git state
  changed.

## Verdict

**REVISE** — 0 blocking, 1 serious, 2 moderate, 4 minor.

What separates this from APPROVED: the real-path wiring is genuinely clean —
production DI everywhere, sanctioned overrides only, honest `na` discipline
per the PROGRAM RULE, cassette-miss never scored, no user data, exact rates,
wall-clock-free projection — and the specs are honest about what they pin.
But Finding 1 must be resolved before `skill.funnel.feed-parity`'s verdict
becomes ledger evidence: as authored, the fixture guarantees a permanent,
misleading `fail` on the 586 row that no product change can clear, and the
batch report explicitly left it for this review to confirm. Findings 2 and 3
should land at the Phase 3.8 freeze (re-anchor the judge expected-fail row to
the copy-scale suites; refuse or record divergent shared-pass options); 4–7
are polish. Everything else examined — including the R11 no-retry deviation
and the B23 report-only `na`s — is accepted with the evidence above.
