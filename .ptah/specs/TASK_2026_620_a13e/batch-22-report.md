# Batch 22 report: funnel suite (Tasks 22.1 and 22.2)

Nothing was committed. No git command changed state. No live model call was made, the bench host never ran, and I did not use `withPinnedCorpus`.

Incident: at about 06:10 the orchestrator moved my untracked `funnel*` files out of the worktree, ran its Batch 21 checks, and moved them back. It confirmed this. In the meantime I had recreated three of the files from my latest content: `funnel-port.ts`, `funnel-host-port.ts` and `funnel-fixture.ts`. For the other files I compared the restored copy with my latest edits on disk and re-applied what was missing. The specs below ran on the final files.

## Files (all CREATED, untracked)

Under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\`:

| File                        | Role                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `funnel.suite.ts`           | The 11 host suites (`createFunnelSuites({ portsOf })`), their options schema and claims, and the shared 22.1 pass memoised per `runId`. Parent-loadable.                                                                                                                                                                                                                                                                    |
| `funnel-stages.ts`          | 22.1: `runFunnelPass` (the scripted pass, capped, run once) plus the prefilter, archaeology, cluster, draft, judge, feed-parity and replay scorers. Parent-loadable.                                                                                                                                                                                                                                                        |
| `funnel-lifecycle.ts`       | 22.2: the promote (tracker and race), retire (window, commit-time, boot reconcile, reconcile wait) and delivery scenarios, and their scorers. Parent-loadable.                                                                                                                                                                                                                                                              |
| `funnel-backlog.ts`         | `skill.backlog.drain`: the scripted load over simulated days, slope, p95 and judged share. Parent-loadable.                                                                                                                                                                                                                                                                                                                 |
| `funnel-port.ts`            | Port and view types, and the injected clock (`installFunnelClock`, built on `retention-support.installSimulatedClock`). Parent-loadable.                                                                                                                                                                                                                                                                                    |
| `funnel-report.ts`          | The invariant record, the verdict rule, `runOnceUnderCap` (capped and not retried), and `funnel` result assembly validated with `funnelDetailsSchema`. Parent-loadable.                                                                                                                                                                                                                                                     |
| `funnel-fixture.ts`         | Loads and validates `gt-skill-sessions@v1` from the isolated home. Each `expectedEvents` is re-derived from its script and must match. Parent-loadable.                                                                                                                                                                                                                                                                     |
| `funnel-host-port.ts`       | **Host-only.** `hostFunnelPorts` / `funnelPortsOver`: the run, lifecycle and backlog ports over the product container.                                                                                                                                                                                                                                                                                                      |
| `funnel-host-graph.ts`      | **Host-only.** `ProductGraph` (lazily resolved product services), timer capture, lane-runner instrumentation, and the child product container.                                                                                                                                                                                                                                                                              |
| `funnel-di.test-support.ts` | **Spec-only**, but it value-imports the barrels. It builds production DI (`registerSkillSynthesisServices`) over a real better-sqlite3 file, using the real agent-sdk registries, the real `JsonlReaderService` and the real `CliFileSystemProvider`. `LANE_RUNNER_SERVICE` is bound to `RecordedLaneRunner`. `SyntheticLane` is a schema-driven inner lane, so the cassette is synthetic and written to the spec temp dir. |
| `funnel.suite.spec.ts`      | 22.1 specs: one synthetic-cassette run plus an empty-replay-cassette run.                                                                                                                                                                                                                                                                                                                                                   |
| `funnel-lifecycle.spec.ts`  | 22.2 specs and the arithmetic units.                                                                                                                                                                                                                                                                                                                                                                                        |

I did not create `tools/mcp-bench/fixtures/memory-skills/cassettes/skills/funnel.v1.jsonl`, because it must not be recorded live from here (see "Pending live recording").

## Stack observed

- tsyringe production DI: `libs/backend/skill-synthesis/src/lib/di/register.ts:65-245`, and the CLI calls it at `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:135`.
- Lane calls go through `LANE_RUNNER_SERVICE` only, at `skill-synthesizer.service.ts:289`, `skill-judge.service.ts:172`, `session-archaeologist.service.ts:384`, `judge-panel.service.ts:513` and `trigger-eval.service.ts:598`.
- I followed the conventions of the memory suites: an injected port, host-only adapters (`retention-port.ts`), `writeSuiteResult`, the safety cap, and `rateMetrics` num/den.

## How the honesty rule is met

Every scored stage runs product code, entered through a product entry point:

| Trigger          | Product entry point                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `session-end`    | `SessionEndCallbackRegistry.notifyAll`                                                                     |
| `idle-timeout`   | `SessionActivityRegistry.notifyAll`, then the trigger service's own idle timer fired on the injected clock |
| `manual-analyze` | `RpcHandler.handleMessage('skillSynthesis:analyzeNow')`                                                    |
| Skill use        | `PostToolUseCallbackRegistry.notifyAll` with a `Skill` tool use                                            |

The queue is driven by `SkillSynthesisService.start` and by `SkillDrainService.drain` per tier. Promotion, retirement, the curator reconcile and harness propagation run through their own services.

Overrides:

1. **The recorded lane runner.** The installed instance is shadowed only to count calls and `CassetteMissError`s. Any miss makes every affected suite `na: cassette-miss` (R-M5), because the product swallows a miss into its template fallback. A spec pins this.
2. **The race only:** a pause gate in front of the same recorded runner, placed in a child container built by the production registration.
3. **Observation-only store-instance hooks.**
   - In the race, the cap read (`listActiveOrderedByDecayScore`) and the compare-and-set (`promoteAtomically`) are logged and called through.
   - In retirement, the re-read before the destructive step (`findById` inside `stillRetirable`) is wrapped. The wrapper records one real event through `SkillInvocationRecorder` and then calls through.
4. **Reconcile wait only:** a never-resolving `SKILL_REPROPAGATION_TOKEN` in a child container. This is the "fake dependency never resolves" the design names.
5. **The injected clock.** `Date.now` is simulated during each suite and restored in `finally`. Timers the trigger service arms in `start()` and on one activity notification are captured synchronously; only the idle timer is fired, on the clock. Wall-clock time is never asserted and never written into results.

## Per-stage table

These are the outcomes the specs observed under production DI with a synthetic cassette. In CI the observed outcome depends on the live-recorded `funnel.v1` cassette.

| Suite id                   | Stage         | Real path / na reason                                                                                   | Design "expected today" | Observed in spec (synthetic)                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill.funnel.prefilter`   | prefilter     | real: triggers, frequent drain, `analyzeSession`                                                        | measure                 | recall 12/12 (pass); precision 12/15; accept-all baseline 12/26. Verdict `na`, because the 4 `manual-analyze` sessions are excluded where `skillSynthesis:analyzeNow` is not registered (as in the spec). The host has the RPC handler, so there they are scored.                                                                                                                                 |
| `skill.funnel.archaeology` | archaeology   | real: nightly tick, `SessionArchaeologistService`, verdict store                                        | fail; accuracy: measure | **fail**: `runs-before-authoring` 15/15 violations, because the archaeology row is enqueued only after authoring (`stage-handlers.service.ts:285-286`). Routine/degraded accuracy and the majority-"no routine" baseline are reported with num/den.                                                                                                                                               |
| `skill.funnel.cluster`     | cluster       | real: candidates from the prefilter stage                                                               | fail                    | **fail**: 15/15 single-session auto-candidates. `cluster-min-two-sessions` is open because no suggestion covers a fixture session (no curator pass runs in the cycle).                                                                                                                                                                                                                            |
| `skill.funnel.draft`       | draft         | real                                                                                                    | fail                    | **na**: no template fallback in a fully answered run, so `fallback-never-judged` is open. `fallback-marked` is always open, because `skill_candidates` has no fallback field. A vacuous pass is never reported.                                                                                                                                                                                   |
| `skill.funnel.judge`       | judge         | real: weekly tick, `JudgePanelService`                                                                  | fail                    | **pass**: 15/15 drafts get a panel row in one cycle, with constant shape. The design's "fail" is the copy's backlog; one weekly tick (cap 400) clears a 15-candidate run.                                                                                                                                                                                                                         |
| `skill.funnel.feed-parity` | feed-parity   | real: `recentEvents` ring; restart = fresh production graph in a child container over the same DB       | measure                 | **fail**: single-edit sessions 20-22 emit a phantom `analyze-run` against fixture expectations `[]`. The feed is empty after the restart (it is an in-memory ring). Queue-table parity is reported as a metric only. On the host, the `manual-run` sessions are expected to fail too, because nothing in skills produces that event.                                                              |
| `skill.funnel.replay`      | replay        | real (coverage)                                                                                         | holds                   | **na**: coverage 0/15 passes; the docs half stays open unless `options.replayDocs` is set (see Registration).                                                                                                                                                                                                                                                                                     |
| `skill.funnel.promote`     | promote       | real: trigger, recorder, weekly tick, `promoteManually` race                                            | fail                    | **fail**: the trigger records 3 events, but `success_count` is 0 and distinct contexts are 0, so nothing is promoted (the tracker has no caller). The race ran all 3 schedules; cap held; `promote.interleavingPoints` = 0, recorded per case as **`no-interleaving-point`**.                                                                                                                     |
| `skill.funnel.retire`      | retire        | real: `SkillRetirementService.run(origin, now)`, curator reconcile                                      | fail                    | **fail**. The idle positive control is retired, and a use inside the window keeps its skill. A use recorded at the commit-time re-read does not save it (`stillRetirable` re-checks status and pin, not last use). The boot reconcile deleted the promoted member's directory. The reconcile wait never settles after the clock passes the bound, and the case ends at the cap with `safety-cap`. |
| `skill.funnel.delivery`    | delivery      | real when `HarnessSyncPropagation` is registered (CLI host)                                             | measure                 | **na** in the spec, which has no harness. On the host: `promoteManually`, then `CliSkillRepropagation`, then a harness propagate for a fresh workspace.                                                                                                                                                                                                                                           |
| `skill.backlog.drain`      | backlog-drain | real: `enqueueAnalyze` per copied session; drain ticks at `*/15`, `0 3 * * *`, `0 4 * * 0` on the clock | fail                    | Structure pinned on a 2-day load: 20 sessions and 194 ticks. The 30-day verdict is measured only by the bench run.                                                                                                                                                                                                                                                                                |

K2: `retireAfterDormantDays` is read at runtime with key `skillSynthesis.retirement.retireAfterDormantDays`. The default is 30 at `skill-retirement.service.ts:48` and `platform-core/src/file-settings-keys.ts:593`, and the spec observes 30. A value the product would not accept fails closed.

Injected clock: the retirement pass takes `now`; the reconcile wait and the drain read `Date.now()`, which the suite simulates (pattern from `retention-support.ts:133`). The real `setTimeout`/`setInterval` are not faked globally; the only timers that matter are captured synchronously. This covers all the code these suites score, so there is no Phase 4 acceptance item for the clock. One exception: the reconcile wait itself has no bound to fire, so the case relies on the 120 s real cap, exactly as the design states.

## Exact check lines

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/funnel.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/funnel-lifecycle.spec.ts --runInBand
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total

npx tsc --noEmit -p tools/mcp-bench/tsconfig.json
TSC_EXIT=0 (no errors in any file)

npx eslint tools/mcp-bench/src/memory-skills/suites/skills/funnel*
(no output: 0 errors, 0 warnings)

npx prettier --check tools/mcp-bench/src/memory-skills/suites/skills/funnel*
All matched files use Prettier code style!
```

I did not run `host-only-imports.spec.ts`. Until the allowlist below lands, it will flag `funnel-host-port.ts`, `funnel-host-graph.ts` and `funnel-di.test-support.ts`, which is expected.

## Registration

`host/memory-skills-host.entry.ts`:

```ts
import { createFunnelSuites } from '../suites/skills/funnel.suite';
import { hostFunnelPorts } from '../suites/skills/funnel-host-port';
// in HOST_SUITES, with the other `placement: 'last'` suites:
  // `placement: 'last'`: they write the skill tables, the skills dir and run on a simulated clock.
  ...createFunnelSuites({ portsOf: hostFunnelPorts }),
```

`host/suite-placement.ts` `HOST_SUITE_PLACEMENTS`:

```ts
  'skill.funnel.prefilter': 'last',
  'skill.funnel.archaeology': 'last',
  'skill.funnel.cluster': 'last',
  'skill.funnel.draft': 'last',
  'skill.funnel.judge': 'last',
  'skill.funnel.feed-parity': 'last',
  'skill.funnel.replay': 'last',
  'skill.funnel.promote': 'last',
  'skill.funnel.retire': 'last',
  'skill.funnel.delivery': 'last',
  'skill.backlog.drain': 'last',
```

Why `last`: every funnel suite drains every queued skill row in the shared DB, writes candidates, promotes, retires and deletes skill directories, and simulates 30 days. The 22.1 stages share one pass, so list them together.

`host-only-imports.spec.ts` `HOST_ONLY_MODULES`:

```ts
  // Batch 22 host adapter: value-imports the skill-synthesis and agent-sdk barrels; wired only by the host entry.
  'suites/skills/funnel-host-port.ts',
  'suites/skills/funnel-host-graph.ts',
  // Batch 22 spec support: builds production DI for the funnel specs.
  'suites/skills/funnel-di.test-support.ts',
```

`runner/run-memory-skills.entry.ts` `OFFLINE_SUITES`: none.

Plan:

- `cassettes.laneRunner.path` = `<repo>/tools/mcp-bench/fixtures/memory-skills/cassettes/skills/funnel.v1.jsonl`, model = the recorded model id.
- Fixture `{ kind: 'directory', source: <committedFixturesDir>, target: 'memory-skills' }`; the default `sessionsDir` is `memory-skills/skill-sessions.v1`.
- Optional per-suite `options`:
  - `capMs`
  - `reconcileCapMs` (default 120 000)
  - `cassetteVersion` (default `funnel.v1`)
  - `backlog: { days (1-60, default 30), sessionsPerWeek (50-470, default 163; pass the snapshot audit's measured rate) }`
  - `replayDocs: { file: <abs repo>/apps/ptah-docs/src/content/docs/skill-synthesis/how-it-works.mdx }`. Without it, `skill.funnel.replay` is `na`.

## Pending live recording

Run this locally, not in CI, after Batch 24's 619 coordination. The output goes to the bench data dir, then gets copied into the committed cassette path.

```text
npx nx run mcp-bench:bench-memory-skills -- --plan <benchDataDir>/plans/funnel-record.plan.json --run-id funnel-record-v1
```

The plan (`620.host-plan.v1`) sets:

- `cassetteMode: "record"`, `ci: false`
- `cassettes.laneRunner.path: <benchDataDir>/cassettes/skills/funnel.v1.jsonl`, because record mode refuses `committedFixturesDir`
- `suites`: the 11 ids above in table order, with `backlog` options at the measured rate

Afterwards, copy the file to `tools/mcp-bench/fixtures/memory-skills/cassettes/skills/funnel.v1.jsonl`, add it to `MANIFEST.json`, and do one `--ci` replay.

Risks to check in that replay:

- Lane request keys include `cwd` and the prompts may include absolute isolated-home paths, so cross-machine misses are possible (R9). A miss shows up as `na: cassette-miss`; it never yields a false verdict.
- The backlog load copies the 12 routine transcripts, so the cassette holds about 12 distinct synthesis prompts plus per-copy archaeology prompts only if those prompts contain the session id.

## Phase 4 seams and findings

1. Skills has no `manual-run` producer: `skillSynthesis:analyzeNow` (`skills-synthesis-rpc.handlers.ts:830-869`) never pushes the event.
2. The skill feed is an in-memory ring (`skill-synthesis.service.ts:229`), so restart parity fails by construction.
3. `stillRetirable` (`skill-retirement.service.ts:269-289`) does not re-check last use at commit time.
4. The boot reconcile merges promoted members and removes their directories (`skill-curator.service.ts:438-469`, `472-490`).
5. The reconcile wait has no bound (`skill-curator.service.ts:272`).
6. Calling `SkillCuratorService.start` twice leaks the first interval (`:217-243`). The suites avoid this with `curatorEnabled: false`.
7. Nothing in the product records a template fallback, so draft `fallback-marked` can never be evaluated.
8. The replay docs claim is a repo file the host cannot read without an option. Consider an offline check.
9. The race has `no-interleaving-point`: the 578 P1 over-cap race is not reproducible in one process, so the row can be closed as such.

## Deviations

- Stage suites are one suite id per stage, not one `skill.funnel` suite, because `funnelDetailsSchema` and the known-failures gate are per suite. The seven 22.1 suites share one memoised pass.
- `funnelDetailsSchema` has no "not evaluated" invariant state. Open invariants are therefore omitted from `details` and named in `naReason`.
- The funnel pass and every lifecycle scenario are **not retried** after a capped attempt (`runOnceUnderCap`), unlike R11. A retry would score a database the first attempt had already mutated. Worse, for the reconcile wait, a retry would pass falsely once the first attempt had linked the suggestion.
- `archaeology` `routine` accuracy is presence accuracy (routine vs none). The verdict's routine is free text, so id-level agreement with the fixture labels is not measurable.
- Single-edit sessions 20-22: the fixture expects no feed event, but the product drafts them, which counts as phantom `analyze-run`s. I kept the fixture's expectation, as the honesty rule requires. A reviewer should confirm that this ground truth is intended.
- The design's "expected fail" for `judge` was observed as `pass` in the spec, and `backlog-drain` is open until the 30-day run.

## Revision 1 (Phase 3.6 review, `code-logic-review-phase3-6.md`)

1. **Serious, feed-parity ground truth for sessions 20-22: fixed at the source.** From the product code: a single edit passes the prefilter (`eligibility/session-work-evidence.ts:15-23`). The bench-caused drain then authors it and pushes `analyze-run` on registration (`skill-synthesis.service.ts:1149-1154`). Archaeology emits no feed event (no `pushEvent` in `archaeology/`, the stage handlers, the drain or the judge panel). The generator (`ground-truth/skill-session-fixture.ts`) now gives those sessions `["session-end", "drain-eligible-candidate"]`, so their expectation is `[analyze-run]`. The fixture was regenerated (index, prettier, manifest), and `batch-11-1-report.md` gained a Revision 4 explaining why Revision 3 was wrong. No product bug is hidden: drafting a single-session candidate is still scored as a `fail` by the cluster and archaeology stages. Spec result: `feed-equals-script` now passes 0/26. `feed-survives-restart` fails 26/26 (the in-memory ring), so the stage still `fail`s for a real cause. On the host, the four `manual-run` sessions are expected to fail too: nothing in skills produces that event.
2. **Moderate, judge scope.** The `skill.funnel.judge` claim text now reads: "Scope: fixture scale (gt-skill-sessions@v1, one drain cycle); does not close the 471 decision-7 copy-scale backlog row (2,347 unjudged), which skill.backlog.drain and the backlog audit measure". The panel case says "(fixture scale)". **This `pass` does not close the 471-decision-7 ledger row.** That row's expected-fail stays anchored to `skill.backlog.drain`'s `judged-share-is-1` and to the Phase 4 backlog audit.
3. **Moderate, divergent shared-pass options are refused.** The memoised pass now remembers its `sessionsDir` and `capMs`. A later stage suite in the same run that asks for different values throws `FunnelPlanError` instead of silently scoring the first suite's pass. `funnelPlanProblems(plan.suites)` is exported for plan-time refusal before any suite runs; see the registration lines below. Specs: a divergent suite is refused, an agreeing suite reuses the pass without a second run, and `funnelPlanProblems` accepts agreeing suites and names the disagreeing ones.
4. **Minors.**
   - An RPC refusal other than "Method not found" is now scored, not excluded, and its error is kept in the session's `observed` (`… (rpc refused: <error>)`). A spec pins it.
   - Child product containers (restart, race, reconcile wait) are disposed: restart at once, the others at the lifecycle port's `close`. The never-resolving reconcile pass keeps no resolver and nothing references it once its child is disposed. It is deliberately never resolved, because resuming it would run a real-time curator pass against the shared database.
   - Delivery now lifts the cap to one above the residents present at entry and records `delivery.residentAtEntry`, so earlier suites' residents cannot shape it. A spec pins that residents were present and that the promotion was not refused.

### Registration addition (do not edit these files myself)

In the runner parent's plan check (`runner/runner-plan.ts`) and in `host/plan.schema.ts`'s `superRefine`:

```ts
import { funnelPlanProblems } from '../suites/skills/funnel.suite';
for (const message of funnelPlanProblems(plan.suites)) issue(message, ['suites']);
```

`funnel.suite.ts` is parent-loadable: it imports types only from the host-only modules. `HOST_ONLY_MODULES` stays as listed above (`funnel-host-port.ts`, `funnel-host-graph.ts`, `funnel-di.test-support.ts`). `HostBacklogPort` moved into `funnel-host-graph.ts`.

### Checks (revise round 1)

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand
Test Suites: 51 passed, 51 total
Tests:       576 passed, 576 total

npx tsc --noEmit -p tools/mcp-bench/tsconfig.json          -> exit 0
npx eslint suites/skills/funnel* ground-truth/skill-session-fixture*.ts   -> no problems
npx prettier --check (same files + skill-sessions.v1/index.json + MANIFEST.json) -> clean
```

I did not touch `libs/`, the host entry, `suite-placement.ts` or `host-only-imports.spec.ts`. No git state changed.

## Revision 2 (Phase 3.6 review round 2, finding 1)

Revision 1 set sessions 20-22 to expect `analyze-run`. That encoded today's behaviour, so it is reverted here. Following the orchestrator's decision, the ground truth is now what a correct pipeline does under 588:

- The single-edit sessions expect `ineligible { reason: noRoutine }` and no `analyze-run`.
- The reason is design-required: it lives only in the fixture's expected-reason schema, and no product file was changed.
- `batch-11-1-report.md` Revision 5 records it and corrects the Revision 4 reasoning.

Feed-parity scoring compares `ineligible:<reason>` keys exactly as the product reports them and exactly as the fixture states them. No code path filters out or remaps an unknown reason. A reason the product never emits is a missing event, and whatever the product emits instead is a phantom.

Spec result: `feed-equals-script` fails on 3 sessions (20-22: expected `ineligible:noRoutine`, observed `analyze-run`; 3 missing and 3 phantom events). `feed-survives-restart` fails on 26.

Addition to the per-stage table:

| Suite id                   | Case                                                                            | Expected today                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill.funnel.feed-parity` | sessions 20-22 expect `ineligible { reason: noRoutine }` (588, design-required) | **fail**: the product drafts the session and emits `analyze-run` (`skill-synthesis.service.ts:1149-1154`), and it has no `noRoutine` reason. Closes with the Phase 4 588 fix. |

Checks (round 2):

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand
Test Suites: 51 passed, 51 total
Tests:       578 passed, 578 total
npx tsc --noEmit -p tools/mcp-bench/tsconfig.json   -> exit 0
eslint (funnel*, skill-session-fixture*.ts)          -> no problems
prettier --check (same + index.json + MANIFEST.json) -> clean
```

I did not touch `libs/` or `apps/`. No git state changed.
