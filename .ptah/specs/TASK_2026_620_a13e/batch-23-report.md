# Batch 23 report: `skill.namer.collisions` + `skill.trigger-eval.human` (Task 23.1)

Status: implemented with a spec. Nothing committed. Not run against private data.

## Files

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\namer-and-trigger.suite.ts`: wires the two host suites. Exports `namerCollisionsSuite`, `triggerEvalHumanSuite` and `NAMER_AND_TRIGGER_SUITES`.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\namer-collisions.ts`: checks the frozen copy against its manifest, probes the real generator, counts collisions and builds the result.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\trigger-human-eval.ts`: defines the label schema, the labelled lane and library doubles, scores through the product `TriggerEvalService` and builds the result.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\namer-and-trigger.suite.spec.ts`: 17 tests. They use a synthetic candidate copy and synthetic labels in temp folders.

## Placement: host or offline

Both are **local host suites** with **placement `any`**. Neither declares `placement`.

- **Why host:** both value-import `@ptah-extension/skill-synthesis` (`SkillMdGenerator`, `TriggerEvalService`, `SKILL_SYNTHESIS_TOKENS`). That barrel loads tsyringe and vscode-core. The runner parent bundle has no `reflect-metadata` banner and no `vscode` alias (`tools/mcp-bench/project.json:249`). The host bundle has both (`:187-196`).
- **Why `any`:** neither suite reads or writes the host database. The namer suite reads the seeded copy and writes only a temp folder, which it deletes. The trigger suite keeps its measurements in memory.
- **Why local only:** the namer suite reads the private frozen copy. The trigger suite needs the U4 labels and the real embedder.

## Design

### `skill.namer.collisions`

- **The 461 namer no longer exists.** `CandidateNamerService` was deleted in commit `625b3861c` ("drop namer"). Today a candidate's directory name comes from `SkillMdGenerator.writeCandidate` (`skill-md-generator.ts:169-172`, `:270-292`). It keeps the sanitized slug if it is free. Otherwise it tries `-2` … `-5`, then refuses. The name it is given is `synthesized.name || trajectory.slug` (`skill-synthesis.service.ts:802-817`). A collision is a directory the generator had to suffix.
- **Frozen copy:** the suite reads only the copy that the host seeded into its isolated home, from `snapshots/<snapshotName>/` and `snapshots/<snapshotName>.manifest.json`. `readFrozenCopy` checks the copy against the manifest before counting anything:
  - it parses the manifest with `CandidateManifestSchema`;
  - it recomputes `manifestSha256` with `computeManifestSha256` (Batch 8 code) and compares it to the pinned `FROZEN_CANDIDATES_MANIFEST_SHA256`;
  - it checks every file hash, and that no file is missing, unlisted or non-regular;
  - it checks the directory count.

  Any mismatch throws a message that contains counts only.

- **Real product path:** the suffix grammar is not copied from the generator. `probeSlugGrammar` calls the real `writeCandidate` (resolved from a child of the host container) with the synthetic slug `namer-probe` in a scratch temp folder until it refuses. The suffixes it chose (`-2`…`-5`) and the limit (5) become the classification rule. The scratch folder is removed in `finally`. Only the generator's own refusal (`slug collision`) ends the probe; any other error is rethrown.
- **Frozen names are not passed through the generator.** `writeAtRoot` logs every slug it writes at `info` (`skill-md-generator.ts:320-324`), and the frozen slugs come from the user's first messages. Passing them through it would put user data in host logs.
- **Counts:** `classifyCollisions` reports:
  - `collided`: directories that are a probed suffix of another directory in the copy;
  - `baseGroups`, `groupsWithCollision`, `largestGroup`;
  - `fullGroups`: a group at the limit, so the next same-base candidate would be refused;
  - `groupsOverLimit`: names the grammar cannot explain;
  - `suffixShapedNoBase`;
  - `sameBodyAsBase`: the base and the suffixed directory have the same SKILL.md body after the frontmatter, compared by sha256. This is one piece of work drafted twice, the defect described at `skill-synthesis.service.ts:823-838`;
  - `collidedWithoutBody`.
- **Rates:**
  - `slugCollisionRate = rate(collided, dirs)`;
  - `selfCollisionShare = rate(sameBodyAsBase, collided)`.

  Each rate is recorded as value, `.num` and `.den` through `rateMetrics`.

- **Result:**
  - kind `funnel`; `details.slugCollisionRate`;
  - one `draft` stage: `in` = directories, `out` = distinct base slugs, invariant `group-size-within-retry-limit`, with `exampleIds` always empty;
  - `groundTruth` = `{id: snapshotName, version: manifest-<sha12>, method: 'generated'}`.
- **Cases:**
  - `frozen-copy/manifest`;
  - `probe/slug-grammar`: fails if the generator never refuses;
  - `invariant/group-size-within-retry-limit`.

### `skill.trigger-eval.human`

- **Labels (`gt-skill-triggers@v1`):** a JSONL file with one line per skill: `{skillId, description, shouldTrigger[], nearMiss[]}`. The schema is `triggerLabelSchema`. A skill labelled twice is refused. The default home target is `memory-skills/skill-triggers.v1.jsonl`.
- **Real product path:** for each skill the suite calls `TriggerEvalService.evaluate` on a fresh instance, registered by class in a child container. In that child:
  - `LANE_RUNNER_SERVICE` is a `LabelledPromptLane`. It answers the service's one prompt-generation call with the labelled set. It holds no model and does no I/O.
  - `SKILL_CANDIDATE_STORE` is a `LabelledSkillLibrary`. The labelled descriptions form the retrieval corpus, and `recordTriggerEval` is kept in memory.

  Everything after the generation call is the product's own code: embedding, rank, `TRIGGER_EVAL_TOP_K`, `TRIGGER_EVAL_MIN_SIMILARITY`, `measureRetrieval`. The embedder and the workspace (gate switch) come from the host container. Settings come from the product's `SkillSynthesisService.readSettings()`. Before scoring, the suite checks that the child resolves the two doubles. The container's own singleton and the real lane runner are never resolved.

- **Aggregation:** precision and recall are micro-averaged over prompts. Per prompt, the product decides `triggered` and the human label decides the kind. `precision = rate(TP, TP+FP)` and `recall = rate(TP, positives)`, both exactly `num/den`. Per-skill cases come from the product report: `tp a/b, fp c/d, precision, recall`. A case passes when recall is 1 and there is no false positive.
- **Baseline `self-generated`:** design :100 compares against the score on prompts the product generated itself. If the plan supplies `selfGeneratedFile`, those recorded sets are scored the same way, and the suite fills `baselines`, `deltas` and per-case `baselineOutcomes`. Without the file the baseline metrics are `null`, and its label says so.
- **No model call:** `modelCalls` is 0. `cost.calls` counts the evaluations the labelled lane answered.

## Real path or `na` today, per suite

| Suite                      | Product path called directly                      | Verdict today                                                            | Why                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill.namer.collisions`   | `SkillMdGenerator.writeCandidate` (grammar probe) | `na`, always                                                             | The design sets no threshold ("collision rate reported", :83). The frozen names are the namer's own output, so there is no independent ground truth and no named baseline. The numbers are in `metrics` and `details`. |
| `skill.trigger-eval.human` | `TriggerEvalService.evaluate` (scoring path)      | `na: ground-truth-absent: gt-skill-triggers@v1 is not labelled yet (U4)` | U4 labels do not exist yet.                                                                                                                                                                                            |

With labels, `skill.trigger-eval.human` is still `na`. The reason, in priority order, is the first that applies:

1. `case-error`;
2. the product skip reason (`trigger-eval-disabled`, `trigger-eval-no-embedder`, …);
3. the product unmeasured reason;
4. `ground-truth-incomplete: N of 23 skills labelled`;
5. `report-only: benchmark-design.md:100 sets no threshold`.

U4 note (context.md:156-158): the PROVISIONAL held-out session sample affects only the `mem.extraction` real slice. The trigger labels do not depend on it. They are written against the authored skills' descriptions at the pinned commit.

## Exact check lines

```
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/namer-and-trigger.suite.spec.ts --runInBand
  -> Test Suites: 1 passed, 1 total; Tests: 17 passed, 17 total   (run twice: before and after prettier)
npx prettier --check <4 files>                                   -> All matched files use Prettier code style! (exit 0)
npx eslint --max-warnings 0 <4 files>                             -> exit 0, no output
npx tsc --noEmit -p tools/mcp-bench/tsconfig.json                 -> 0 "error TS" lines (none in my files, none elsewhere)
```

What the spec covers:

- The real generator yields suffixes `-2`…`-5` with a limit of 5, and its scratch folder is removed.
- On the synthetic copy:
  - 12 directories and 7 collided give a rate of 7/12;
  - `selfCollisionShare` is 1/7, with 5 groups, 1 full group, 1 suffix-shaped name with no base and 1 collided directory without a body;
  - every `value === num/den` (a helper checks every `.num`/`.den` pair);
  - the serialized result, cases and logger calls contain no synthetic user slug, no body and no home path.
- A tampered copy is refused with counts only. A manifest other than the pinned one is refused.
- A generator that never refuses fails the probe case. A real I/O error is rethrown. Over-limit groups and nested suffix groups are counted correctly.
- Trigger, labels absent: `na: ground-truth-absent`, no cases, and neither the embedder nor the lane is called.
- Trigger, with labels:
  - the parent container's `LANE_RUNNER_SERVICE` (the model path) and the product candidate store are jest doubles that **throw if called**, and are asserted never called;
  - `modelCalls` is 0 and the embedder is called once per skill;
  - micro precision and recall are 4/5, and per-skill observed values match the product's `measureRetrieval`;
  - the recorded measurement equals `{precision, recall, score: f1(...)}`.
- Self-generated baseline: precision 2/4, recall 2/2, with deltas and `baselineOutcomes`.
- `ground-truth-incomplete`, the gate switched off and no embedder each give `na` with the product's reason.
- A duplicate label is refused. Both host-suite wrappers write results that `readSuiteResult` reads back.

## Registration

Do not apply this while Batches 21 and 22 are editing. The orchestrator applies it in `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`.

```ts
// with the other suite imports (near line 34-41)
import { NAMER_AND_TRIGGER_SUITES } from '../suites/skills/namer-and-trigger.suite';
```

```ts
// in HOST_SUITES (line 54), anywhere BEFORE the `placement: 'last'` retention suites, e.g. right after SCOPE_WRITE_SUITE:
  ...NAMER_AND_TRIGGER_SUITES,
```

- `host/suite-placement.ts`: **no change**. Both suites are `any`, so they are absent from `HOST_SUITE_PLACEMENTS`.
- `runner/run-memory-skills.entry.ts`: **no change**. These are not offline suites.
- `host-only-imports.spec.ts`: no change is required, because its guard covers only the `@ptah-extension/memory-curator` barrel. I recommend, as optional documentation, listing the three modules as host-only. They value-import the skill-synthesis barrel, which needs `reflect-metadata` and `vscode` like memory-curator does:

```ts
  // Batch 23 host suites: value-import the skill-synthesis barrel.
  'suites/skills/namer-and-trigger.suite.ts',
  'suites/skills/namer-collisions.ts',
  'suites/skills/trigger-human-eval.ts',
```

## Pending local run

I did not run anything against private data: no bench host, no `bench-memory-skills`, no `withPinnedCorpus`.

A local plan entry needs the following.

**Fixtures** (in `plan.fixtures`, sources inside the bench data dir):

```json
{ "kind": "directory", "source": "<benchData>\\snapshots\\skill-candidates-20261006", "target": "snapshots/skill-candidates-20261006" },
{ "kind": "file", "source": "<benchData>\\snapshots\\skill-candidates-20261006.manifest.json", "target": "snapshots/skill-candidates-20261006.manifest.json" }
```

After U4, add the labels file. Add the recorded self-generated sets if they exist:

```json
{ "kind": "file", "source": "<benchData or committed fixtures>\\skill-triggers.v1.jsonl", "target": "memory-skills/skill-triggers.v1.jsonl" }
```

**Suites:**

- `{ "id": "skill.namer.collisions", "options": {} }`. The defaults pin `skill-candidates-20261006` and `73a184c5…45f3`.
- `{ "id": "skill.trigger-eval.human", "options": {} }`. Add `"selfGeneratedFile": "<home-relative>"` once a recorded set exists.

Expected on the first local run:

- `skill.namer.collisions` is `na` with the rate over 2,745 directories (the Batch 8 manifest count).
- `skill.trigger-eval.human` is `na: ground-truth-absent` until U4.

The self-generated baseline file does not exist yet. Producing it needs one generation lane call per skill, so it is a separate recorded step and must not happen in this suite.

## Phase 3.6 fixes

- **CI refusal** (`code-logic-review-phase3-6.md`, minor). Both suites now refuse a CI run the same way the judge suites do (`judge-agreement.suite.ts:803-807`).
  - **Where:** `refuseCi` in `namer-and-trigger.suite.ts` runs first in each `run`.
  - **What it does when `context.ci` is set:** it throws `<suiteId> is local-only: <why>; it never runs in CI` before any fixture is read or any service is resolved. The host then records the suite as `error`.
  - **Spec:** `refuses a CI run before reading any fixture or resolving a service` checks four things for both suites: the run rejects with that message, no result file is written, and `container.resolve` and `createChildContainer` are never called.
  - **Checks:** jest 18/18 passed, and eslint and prettier exit 0 on both files.

## Deviations

1. **Collisions are local, not "pure, CI".** The design says collisions are "pure, CI" (`benchmark-design.md:290`, `:517`). They are measured on the frozen copy, which is private user data, and the product generator needs the host runtime, so the suite is local and host-only. A CI variant would need a committed synthetic candidate tree. That was not asked for, and its counts would measure the fixture, not the product.
2. **"Namer (461)" is the generator's suffix walk.** The 461 `CandidateNamerService` was deleted (`625b3861c`), so the suite measures the collision walk of `SkillMdGenerator`. The frozen names are classified with the grammar probed from the real generator rather than passed through it, because the generator logs each slug (privacy rule).
3. **Both verdicts are always `na`.** Design :83 and :100 set no threshold ("reported" / "report only"). With labels and a baseline, `skill.trigger-eval.human` stays `na: report-only` until an architect sets a pass bar.
4. **The label schema lives in the suite helper.** The `gt-skill-triggers@v1` line schema is in `trigger-human-eval.ts`, because `ground-truth/label-schemas.ts` is outside this batch's file ownership. It could move there at the Phase 3.8 freeze.
5. **Descriptions come from the label file.** The labels file carries each skill's `description`, frozen with the labels. The suite does not read the repo's `.claude/skills` at run time, because the fixture seeder only allows the bench data dir and the committed fixtures dir.
6. **Batch verification not run.** The batch 21-23 verification line (`nx run-many -t typecheck,test,lint -p mcp-bench`, plus one `bench-memory-skills` replay run) was not run, as the brief directs. Only the scoped jest run, eslint, prettier and tsc above were run.
