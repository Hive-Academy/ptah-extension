# Code Logic Review — Batch 6 (Reachability Proof), `TASK_2026_461_639c`

Scope: `libs/backend/skill-synthesis/src/lib/skill-synthesis.reachability.integration.spec.ts` and
`skill-synthesis.reachability.test-support.ts` (untracked, worktree HEAD `55dba650c`). Read-only review;
cross-checked against `implementation-plan.md` Component 6, `batches.md` Batch 6 (including the
"re-read against Batches 1-5 as shipped" section), `batch-6-report.md`, and
`TASK_2026_439_1310/HANDOFF.md`'s reachability rule. Verified against the production sources the spec
claims to drive: `skill-synthesis.service.ts`, `skill-promotion.service.ts`,
`queue/skill-drain.service.ts`, `skill-judge.service.ts`, `lanes/lane-runner.service.ts`,
`skill-md-generator.ts`, `persistence-sqlite/src/lib/migration-runner.ts` and
`sqlite-connection.service.ts`. Did not re-run the spec (no idle-process check performed in this
session; relying on the executor's pasted outputs plus static verification that the code they exercise
matches the report).

## Verdict

**APPROVED**

**Score: 8/10**

## Summary

The proof is real. It resolves `SkillSynthesisService`, `SkillDrainService` and `SkillPromotionService`
from a child container built by the actual `registerSkillSynthesisServices`, drives the captured
production `session-end` callback, drains through the real `SkillStageHandlersService` dispatch table,
and ends at the real `SkillPromotionService.promoteManually` via `SkillSynthesisService.promote`. Every
one of the five mutations targets a real, currently-live line and the reported fail/restore pairs are
consistent with what the surrounding code actually does. No production file is left modified
(`git status --short` in the report shows only the two new files). This is the reachability proof the
phase's closing rule asks for, not a decorative unit-test wrapper.

I found no blocking or serious defect. Three moderate/minor points are worth the team-leader's attention
before Batch 7 relies on this proof as ground truth for phase 5.

## Five logic questions

### 1. How does this fail silently?

It largely doesn't — the assertions are structural (`toEqual`/`toMatchObject` on exact rows), so a wrong
code path produces a visible mismatch rather than a pass. The one place a silent pass is theoretically
possible: group 2's bounded drain loop (`skill-synthesis.reachability.integration.spec.ts:255-275`) treats
`before === 0` as done. If a bug caused zero rows to ever be enqueued in group 1 (e.g., the session-end
callback never fired), group 2 would trivially "succeed" with `before === 0` on its very first check. That
class of bug is caught downstream by group 1's own poll-to-3 assertion (`:244-252`) and group 3's row
assertions, so in practice nothing slips through — but group 2 in isolation is not itself a proof of work.

### 2. What user action produces unexpected behaviour?

Not applicable in the usual sense (no UI here), but the proof's closest analogue — clicking Promote on a
freshly-drafted, never-invoked candidate — is exactly what group 5 drives, and it is verified against the
real gate pipeline (`skill-promotion.service.ts:242-266`), not a stub.

### 3. What input data produces a wrong answer?

None identified in the fixtures. The `s-alpha`/`s-beta` transcripts are built by the same
`codeWorkTranscript(workspaceRoot)` template with only the root substituted
(`skill-synthesis.reachability.test-support.ts:113-121`), and group 1 independently proves the two hashes
are equal by calling the real `TrajectoryExtractor` before firing any callback
(`skill-synthesis.reachability.integration.spec.ts:230-236`) — this is the right way to pin V2/the
reuse-path assumption rather than asserting it by construction.

### 4. What happens when a dependency fails?

Out of scope for a reachability proof (this is not a fault-injection spec), and the plan does not ask for
one here. Teardown itself is complete: `synthesis.stop()`, `connection.close()`, `child.reset()`, and
`fs.rmSync` of the temp root all run unconditionally in `afterAll`
(`skill-synthesis.reachability.integration.spec.ts:222-227`) — a failing `beforeAll` still leaves the temp
dir if `tempRoot` was never assigned, but that is a pre-existing convention shared by every other
`*.test-support.ts` harness in this lib and not a new risk.

### 5. What is missing that the requirements never mentioned?

The plan explicitly scopes this proof to production **promote / prefilter / fake-invocation** reachability
and explicitly excludes automatic promotion, the cleanup job, and the tracker (XB4). Nothing in the batch
oversteps that boundary, and nothing required by Component 6 is missing. The one gap worth naming: the
spec never resolves or references `SKILL_BACKLOG_CLEANUP_STORE` / `SKILL_BACKLOG_CLEANUP_SERVICE`
(confirmed absent from the bound-token list and from any `child.resolve` call), which is correct per the
re-read note but means this proof gives zero evidence that those Batch 4/5 additions are *reachable* from
this same DI graph in a way that doesn't collide with the promote path — acceptable, since Batch 5's own
specs (`start-thoth-cron.spec.ts`, `cli-engine/thoth-runtime.spec.ts`) already cover that job's
reachability independently.

## Failure modes

### None found that the proof fails to catch

I looked for the standard "reachability proof that isn't" patterns (hand-built services, direct calls to
`analyzeSession`/`registerCandidate`/`passesPrefilter`, a stub standing in for a `skill-synthesis` class)
and found none:

- The only classes constructed directly are host-side fakes (`makeWorkspace`, `makeJsonlReader`,
  `makeRateLimit`, `makeReachabilityLogger`, the fake lane) — every one of them binds to a token that sits
  **outside** `skill-synthesis` (`PLATFORM_TOKENS.WORKSPACE_PROVIDER`, `SDK_TOKENS.*`,
  `INTERNAL_QUERY_SERVICE_TOKEN`, `TOKENS.LOGGER`). `SkillSynthesisService`, `SkillDrainService`,
  `SkillPromotionService`, `SkillStageHandlersService`, `SkillJudgeService`, `SkillCandidateStore`,
  `TrajectoryExtractor` and `SkillMdGenerator` are all resolved from the container that
  `registerSkillSynthesisServices` populated (`:203-219`), confirmed by the "Final host token set" list in
  `batch-6-report.md` and by reading `di/register.ts` for what those tokens map to.
- The fake LLM lane discriminates on the actual production judge rubric string,
  `'Evaluate the synthesized skill'`, which is the literal instruction text at `skill-judge.service.ts:122`
  — not an invented marker. A drift in that rubric string would make the fake fall through to the
  synthesis branch for judge calls too, which would very visibly break group 4/5 (wrong payload shape for
  `JUDGE_VERDICT_JSON_SCHEMA`), so this is a proof that would fail loudly on drift rather than pass
  silently.
- `passesPrefilter`/`hasSessionWorkEvidence` are reached through `analyzeSession`, which is reached only
  through the registered `prefilter` stage handler, which is reached only through
  `drain.drain({tier:'frequent', ...})` — confirmed by reading `skill-synthesis.service.ts:719,1129-1139`
  and the drain's claim/dispatch path (`queue/skill-drain.service.ts:988-1003`).
- `SkillSynthesisService.promote` is called directly on the resolved production instance
  (`:330`), which forwards to `promotion.promoteManually` at `skill-synthesis.service.ts:1159` — the real
  production line, not a copy.

### Moderate — test-support node:sqlite adapter's `.transaction()`/`inTransaction` diverge from the real contract, currently unexercised

- Trigger: any future extension of this reachability spec (or reuse of the test-support file) that
  resolves a code path calling `db.transaction(fn)` (e.g. `SkillCandidateStore.setPin`,
  `skill-candidate.store.ts:880`) under the `node:sqlite` binding.
- Symptom: `adaptNodeDatabase` (`skill-synthesis.reachability.test-support.ts:41-83`) implements
  `.transaction()` as a synchronous wrapper around `raw.exec('BEGIN IMMEDIATE'/'COMMIT'/'ROLLBACK')`, and
  hardcodes `get inTransaction() { return false; }` unconditionally rather than tracking real state. Any
  code that branches on `db.inTransaction` (e.g. `sqlite-page-reclaimer.ts:121`) would get a wrong answer
  under this adapter specifically, and the two bindings would silently stop "exercising the same
  assertions" (HANDOFF rule 3 / this review's item 4) the moment such a path is reached.
- Evidence: `skill-synthesis.reachability.test-support.ts:64-83`; confirmed unreached today — production
  migrations use raw `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` exec calls exclusively
  (`persistence-sqlite/src/lib/migration-runner.ts:224-266,336-353`), never `.transaction()`, and
  `setPin` (the one `skill-synthesis` caller of `.transaction()`) is not reached by this proof's five
  groups.
- Current handling: not exercised, so not currently a live defect. It is a latent trap for whoever next
  extends this file.
- Recommendation: a one-line comment on `adaptNodeDatabase` flagging that `.transaction()`/`inTransaction`
  are placeholders, not verified equivalents, would save the next author from assuming this adapter is a
  complete `SqliteDatabase` implementation.

### Minor — M4's reported failure signature undersells what the spec actually proves

- Trigger: reading `batch-6-report.md`'s M4 section in isolation.
- Symptom: the report says the mutation is caught because "candidate length: 0", which reads as if the
  spec would pass for the wrong reason under a different bug that also produces zero candidates.
- Evidence: the actual catching assertion is stronger than the report suggests. Group 3's
  `expect(rows).toEqual(expect.arrayContaining([...]))`
  (`skill-synthesis.reachability.integration.spec.ts:288-304`) requires `s-alpha`'s `prefilter` row to be
  `status:'done'`. With the registration call removed, `SkillDrainService`'s claim path marks every claimed
  row `skipped` with reason `` `no handler for stage ${stage}` `` (`queue/skill-drain.service.ts:996-1002`),
  so the row fails to match `{status:'done'}` independently of the candidate-count assertion. The review
  prompt's suspicion (M4 should assert row status/reason, not just count) is already satisfied by the
  existing group-3 assertions; the gap is only in how the report narrates it.
- Recommendation: none required in the spec; optionally tighten the report's phrasing in a future batch.

### Minor — `curatorEnabled: false` is a disclosed deviation from the production default, adequately justified

- Trigger: none — this is a settings choice, not a bug.
- Evidence: `SETTINGS_DEFAULTS.curatorEnabled = true` (`skill-synthesis.service.ts:145`); the proof's
  workspace settings map sets it to `false`
  (`skill-synthesis.reachability.integration.spec.ts:158`). `SkillCuratorService.start` no-ops entirely
  when the setting is false (`skill-curator.service.ts:195-198`), so this cannot make the proof pass on a
  path production wouldn't take — it only suppresses an unrelated 24-hour-interval timer that would not
  fire during the test's lifetime regardless. Disclosed in `batch-6-report.md`'s "Final host token set"
  section. No action needed; noted only because the task brief specifically asked about settings
  deviations from production defaults.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

See "Failure modes" above — one moderate (test-support `.transaction()`/`inTransaction` fidelity gap,
currently dormant), two minor (report narration on M4; disclosed and harmless `curatorEnabled` deviation).

## Data flow

1. `beforeAll` builds a child tsyringe container, binds only host-owned tokens, and calls the real
   `registerSkillSynthesisServices` — OK, verified against `di/register.ts` token bindings named in the
   report.
2. `connection.configure({ factory: databaseFactory.factory, vec resolvers: null })` — OK, matches V1's
   documented seam (`sqlite-connection.service.ts` `configure`).
3. Group 1: real `TrajectoryExtractor.extract` proves hash equality before firing the captured
   session-end callback for three sessions — OK, this is the correct order (prove the assumption, then
   drive production).
4. Group 2: real `SKILL_DRAIN_SERVICE.drain({tier:'frequent'})` in a bounded, strictly-decreasing loop —
   OK, not vacuous (see Q1 caveat, which downstream assertions close).
5. Group 3: real `skill_candidates` / `skill_synthesis_queue` / `skill_invocations` rows read directly —
   OK, and directly falsifiable by M2/M3/M4.
6. Group 4: real `SKILL_PROMOTION_SERVICE.evaluate` — OK, confirmed the automatic branch returns
   `below-threshold` before any judge call at `skill-promotion.service.ts:242-250`, i.e. before the judge
   gate at `:262`.
7. Group 5: real `synthesis.promote()` → real `promotion.promoteManually` → real gate pipeline in `manual`
   mode, ending in a real `SkillMdGenerator.promoteToActive` write and a real `SKILL.md` on disk — OK,
   confirmed the settings-supplied `skillSynthesis.skillsRoot` key
   (`SKILLS_ROOT_KEY = 'skillSynthesis.skillsRoot'`, `skill-md-generator.ts:34`) matches the workspace
   fake's map key exactly.
8. `afterAll` disposes the session-end registration, stops the curator, closes the connection, resets the
   container, and removes the temp directory — OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Real container via `registerSkillSynthesisServices`, no hand-built services | COMPLETE | none |
| Real SQLite, both bindings, `it.skip` only when neither loads | COMPLETE | A1 test-support adapter has a latent `.transaction()`/`inTransaction` fidelity gap (dormant, see above) |
| Session-end → drain → prefilter → manual promote is the asserted path | COMPLETE | none |
| Conversation-only session produces nothing, no chained rows | COMPLETE | none |
| Zero fake invocation rows | COMPLETE | none |
| Automatic evaluate stays `below-threshold`, zero judge calls | COMPLETE | none |
| Manual promote reaches `promoted`, judge scored, SKILL.md written | COMPLETE | none |
| M1-M5 mutations, each with fail + restore pasted, no production diff left | COMPLETE | M4's report narration is imprecise about which assertion actually catches it (see minor finding) |
| Teardown / resource hygiene | COMPLETE | none |

Implicit requirements not addressed: none identified beyond the moderate note on the test-support
adapter's transaction semantics.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two sessions, same normalized trajectory hash, different workspace roots | YES | Group 1 proves hash equality via the real extractor before relying on it | none |
| Conversation-only session (no edits, no tool uses) | YES | `s-chat`, 8 turns, >1000 chars, asserted `skipped`/`no candidate from this session`, no chained rows | none |
| Automatic promotion path still gated | YES | Group 4, real `evaluate`, zero new judge calls | none |
| Manual promotion bypasses only the threshold | YES | Group 5, real `promoteManually`, all other gates still run (dedup/cluster/judge/replay/cap/write) | Only the threshold gate is actively falsified by mutation (M1/M5); the other gates (dedup, cluster-dedup, replay, residency cap) are correctly *exercised* on the happy path but have no dedicated mutation here — acceptable, since AC2's mutation coverage for those lives in Batch 1's `skill-promotion.service.spec.ts`, not this proof |
| Stage-handler registration reachable from `start()` | YES | M4 removes the registration call; caught by both row-status and candidate-count assertions | none |
| No production file left modified after mutation runs | YES | `git diff --stat` reported empty for both mutation targets each time | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the test-support `node:sqlite` adapter's fabricated `.transaction()`/`inTransaction` members
  are not verified equivalents of the real contract; today nothing reachable from this proof exercises
  them, but a future extension of this file that does would silently get one binding's answer instead of
  proving both bindings agree.
- What a robust implementation would add: a short comment on `adaptNodeDatabase` marking `.transaction()`
  and `inTransaction` as unverified placeholders, and (optional, not required for this phase) a dedicated
  mutation or assertion in a future batch for at least one of the non-threshold manual-path gates
  (duplicate/cluster-dedup/replay/residency) to extend this proof's blast radius, since Batch 1's unit
  specs currently carry that weight alone.
