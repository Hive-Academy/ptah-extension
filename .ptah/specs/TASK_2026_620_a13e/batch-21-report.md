# Batch 21 report: Rubric agreement and judge agreement

Executor: backend-developer sub-agent. Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`. Nothing was committed and
nothing was run live. No real `~/.ptah`, private bench data or bench host was touched.

Status: implemented and specced. Both suites report `na` today, because the real labels (U1) do not
exist yet.

## BLOCKER for the committer: `.gitignore` hides this folder

`.gitignore:202` contains `skills/`. It ignores **every file under
`tools/mcp-bench/src/memory-skills/suites/skills/`**, so `git status` does not list any of the files
below. The same rule also hides Batches 22 and 23 (`funnel*`, `namer-and-trigger*`). `git check-ignore -v`
confirms it: `.gitignore:202:skills/ tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.ts`.

There is a second effect. The runner's read-path guard and the ground-truth freshness check only
accept committed files, so an ignored suite file can never be "committed" by accident either. Add
these lines next to the existing negations (`.gitignore:203-206`):

```
!tools/mcp-bench/src/memory-skills/suites/skills/
!tools/mcp-bench/src/memory-skills/suites/skills/**
```

The alternative is `git add -f`. I did not edit `.gitignore` because it is outside this batch.

## Files

All files are under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\suites\skills\`:

- CREATED `rubric-ground-truth.ts`: the shared `gt-skill-rubric@v1` loader. It checks the
  MANIFEST.json hashes, parses the CSVs (with `rubricScoreRowSchema` / `adjudicationRowSchema`), works
  out the human consensus and adjudication, computes full-set and candidates-only agreement and anchor
  stability, and evaluates the trust bar (`evaluateTrustBar`). It also produces the
  `ground-truth-untrusted` reason.
- CREATED `rubric-agreement.suite.ts`: the offline suite `skill.rubric.inter-rater` (Task 21.1).
- CREATED `rubric-agreement.suite.spec.ts`: 12 tests.
- CREATED `rubric-ground-truth.test-support.ts`: a writer for synthetic labels, adjudication, docs
  and the manifest. Both specs use it.
- CREATED `judge-corpus.ts`: loads the blinded packet documents and the planted negatives from the
  isolated home and checks every sha256.
- CREATED `judge-lane-tap.ts`: a pass-through lane-runner observer that records the lane, the
  system-prompt and prompt sha256, the reported model, the status and the raw text.
- CREATED `judge-agreement.suite.ts`: the host suites `skill.judge-agreement` and
  `skill.judge-agreement.panel` (Task 21.2).
- CREATED `judge-agreement-ports.ts`: the HOST-ONLY adapter. It resolves the real services through a
  child container.
- CREATED `judge-agreement.suite.spec.ts`: 9 tests.

No other file was edited.

## Design

### 21.1 `skill.rubric.inter-rater` (offline, model-free)

- **Reads.** It reads only through the runner's `ReadPathGuard` (`context.read.readBytes`), from
  `<repo>/tools/mcp-bench/fixtures/memory-skills/`. The files are `skill-labels.v1.csv`,
  `skill-adjudication.v1.csv`, `skill-docs.v1.json` and `MANIFEST.json`. If a file does not exist, the
  suite treats it as absent; it does not read it.
- **File check** (`checkGroundTruthFiles`), per file:
  - `ok`: the bytes match the manifest.
  - `hash-mismatch`: the bytes differ from the manifest.
  - `unrecorded`: the file exists, but the manifest does not pin it.
  - `missing`: the manifest pins the file, but the file is gone.
  - `absent`: the file does not exist and the manifest does not pin it.
- **Verdict.**
  - Any `hash-mismatch`, `unrecorded` or `missing` gives **`fail`**.
  - Any `absent` gives **`na: ground-truth-untrusted: <files> not committed (labels pending, U1)`**.
    This is the result today.
  - If the files load but the trust bar is not met, the verdict is
    **`na: ground-truth-untrusted: <every failing condition with its value>`**. The conditions are:
    strata not yet recorded (R2), adjudication pending, full κ < 0.6, full ρ < 0.7, candidates-only
    ρ < 0.6, and anchors below 8/10.
  - Otherwise the verdict is **`pass`**.
- **Errors.** A structurally broken file throws `RubricGroundTruthError`, so the runner records a
  suite error, never a pass. Examples: a wrong header, a quoted cell, a missing rater row, a rater
  outside the two configured raters, a duplicate row, or an adjudication whose `triggers` do not match
  the raters' actual disagreement.
- **Consensus.** An adjudicated document takes the adjudicator's total and pass. A document that
  needs no adjudication takes the mean of the two raters' totals and their shared pass. Adjudication
  is needed when pass/fail differs or the totals differ by more than 12.
- **Figures.**
  - Full set (`full.*`) and candidates-only (`candidates.*`, strata other than
    `authored`/`promoted-synthesized`).
  - For each: κ with a seeded 95% CI, Spearman ρ on totals, raw agreement (as `value` plus `.num` and
    `.den`), and the quadratic-weighted κ for each criterion.
  - Also: anchor stability (`anchorStability`, `.num`, `.den`), `adjudicated`, `adjudication.pending`
    and `strata.missing`.
- **Details.** The strict `rubric`/`inter-rater` details schema holds the headline numbers. The
  candidates-only κ and raw agreement are in `metrics`, because the schema has no field for them.
- **Baselines.** `chance` (κ = ρ = 0) and `trust-bar` (the design thresholds), with deltas.
- **New format.** `skill-docs.v1.json` is defined here (`skillDocsSchema`) as
  `{schemaVersion: 1, documents: [{opaqueId, sha256, stratum?, anchor471Total?}]}`.
  `anchor471Total` is required on `anchor-471` documents and forbidden on all others, and `stratum`
  stays optional until adjudication closes (R2). Batch 25 must write this shape.
- **CSV formats** for Batch 25:
  - Labels: `opaqueId,raterId,c1..c8,total,pass,ratedAt`. `pass` is `true`/`false`; `ratedAt` is an
    ISO date-time (Batch 9 follow-up: normalise `YYYY-MM-DD`).
  - Adjudication: `opaqueId,adjudicatorId,c1..c8,total,pass,triggers,decidedAt`, with `triggers`
    joined by `;`.

### 21.2 `skill.judge-agreement` and `skill.judge-agreement.panel` (host, LOCAL only)

- **Real path.**
  - `judge-agreement-ports.ts` resolves the installed lane double from the host container and asserts
    it is `context.doubles.laneRunner`. In record mode, that double wraps the real `LaneRunnerService`
    (`host/doubles-override.ts`).
  - It wraps the double in a `LaneTap` and builds a **child container**. The child differs from the
    host container in one registration, `LANE_RUNNER_SERVICE` → tap, plus fresh `SkillJudgeService`
    and `JudgePanelService` instances built by the product's own DI wiring.
  - The candidate store, the workspace settings and the embedder come from the host container
    unchanged. The settings come from the product's `SkillSynthesisService.readSettings()`, so
    `minJudgeScore` is the product's; only `judgeEnabled` is forced to `true`. The host's singletons
    are untouched, so no later suite sees the tap.
- **Corpus.**
  - The 105 blinded packet documents are judged as the raters read them: `name` is the opaque id,
    references are inlined, and the body is everything after the frontmatter.
  - Strata come from `private/id-map.json`. Only `stratum` and `sha256` are parsed; slugs and
    candidate ids are dropped.
  - The 10 committed planted negatives are added.
  - Every file's sha256 is checked (id-map / `index.json`). Any mismatch, a foreign document, or a
    `name` that is not the opaque id throws.
- **Repeats.** Each document is judged `repeats` times (default 3), one case per call (`recordCase`,
  under the 120 s safety cap). Each document is registered once through the product's
  `registerCandidate`, keyed by `trajectoryHash = judge-agreement:<id>:<sha256>`, so the panel can
  persist its verdict. That write into the shared database is why both suites declare
  `placement: 'last'`.
- **Metrics.** Each is reported for `all.*` and for `withoutAnchor.*` (the `anchor-471` stratum
  removed):
  - Spearman(mean judge composite, human consensus total).
  - κ(mean composite ≥ `minJudgeScore`, human pass), with a seeded CI.
  - `lengthSpearman` (body characters) and `randomSpearman` (seeded sha256 → [0,1)).
  - `marginOverLength`.

  Also reported:
  - `meanRepeatSd`: the mean of each document's population SD over its scored repeats.
  - `saturationShare`: score = 10 over scored calls.
  - `unscoredShare`.
  - For the panel only: `panel.singlePanellist` and `panel.escalated`.
- **Controls** are counted per call; an `unscored` call counts for neither control.
  - Positive control: `authored` calls scored ≥ `minJudgeScore`, bar 90%.
  - Negative control: `fallback` and planted calls scored < `minJudgeScore`, bar 90%.
- **Pins.**
  - **Model:** the `model` option, checked against every reported `LaneRun.lane.model`. Escalation
    calls on the `synthesis` lane are checked against `escalationModel`, which defaults to `model`.
  - **Prompt:** `promptSha256` is the sha256 of the system prompt of the *first* lane call of each run.
    That is the judge rubric, or panellist A's rubric; later panel calls carry a per-document lens.
    There must be exactly one distinct value. An optional `promptSha256` option turns a later change
    into `prompt-drift`.
- **`na` precedence.** The first reason that applies is reported:
  1. `ground-truth-untrusted` (absent, hash mismatch, trust bar unmet, or the labels describe other
     documents than the judged packet).
  2. `lane-runner-replay` (cassette outputs).
  3. `judge-calls-errored`.
  4. `model-not-pinned`.
  5. `prompt-not-pinned`, then `prompt-drift`.
- **Verdict when no `na` applies.** The verdict is `pass` only when both controls are ≥ 0.9 **and**
  ρ_judge − ρ_length ≥ 0.2 on the full set **and** without `anchor-471`. Otherwise it is `fail`.
- **CI.** A `ci: true` context throws (`local-only`), so the suite can never gate CI.
- **Raw outputs.** Raw outputs, including lane text, are appended to `<runDir>/raw/<suiteId>.jsonl`.
  The file is created with `wx`, so it is never overwritten. `runDir` is strictly inside the bench data
  folder (`host/plan.schema.ts` refine). Cases hold only opaque ids, statuses, scores and stable reason
  tokens. A spec asserts that no document text and no id-map slug reach the cases.
- **Details.** `rubric`/`judge-vs-human` is validated by `rubricDetailsSchema`. `judge` is
  `skill-judge` or `judge-panel`, `model` is the pin, `promptSha256` is the observed rubric sha.
  `positiveControl.n` and `negativeControl.n` are numbers of calls.

## Real path / double / na today

| Suite id | Scored operation | Real product path? | Double in the scored path | Ground truth | Verdict today |
|---|---|---|---|---|---|
| `skill.rubric.inter-rater` | recomputes 2-rater agreement from committed CSVs | n/a (no product); the real recomputation from committed bytes | none | `gt-skill-rubric@v1` human labels (absent) | `na: ground-truth-untrusted: skill-labels.v1.csv, skill-adjudication.v1.csv, skill-docs.v1.json not committed (labels pending, U1)` (pinned by a spec over the real committed fixtures dir) |
| `skill.judge-agreement` | `SkillJudgeService.judge` via the real lane runner (record mode) | yes, in a record-mode local run; observation-only tap | none in record mode; the cassette in replay (→ `na`) | same (absent) | `na: ground-truth-untrusted: …`; controls and repeat SD still measured in details |
| `skill.judge-agreement.panel` | `JudgePanelService.evaluate` (+ product `registerCandidate`) | yes, same conditions | same | same (absent) | `na: ground-truth-untrusted: …` |

The specs' "model" is a synthetic lane, recorded through the real `RecordedLaneRunner` into the spec
temp dir and then replayed. The real `SkillJudgeService` and `JudgePanelService` are constructed
positionally. The candidate store and the workspace provider are in-memory spec doubles.

## Checks

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/judge-agreement.suite.spec.ts --runInBand`
  → `Test Suites: 2 passed, 2 total` / `Tests: 21 passed, 21 total`.
- `npx eslint tools/mcp-bench/src/memory-skills/suites/skills/` → no output (clean). One error was
  fixed on the way: a literal BOM in a regex became `String.fromCharCode(0xfeff)`, as
  `build-labelling-packet.ts:299` does.
- `npx prettier --check tools/mcp-bench/src/memory-skills/suites/skills/rubric-* tools/mcp-bench/src/memory-skills/suites/skills/judge-*`
  → `All matched files use Prettier code style!`
- `npx tsc --noEmit -p tools/mcp-bench/tsconfig.json` (includes `src/**/*.ts`, specs included) → 0
  `error TS` lines in the whole project, so none in Batch 21 files.
- I did not run these: `nx run mcp-bench:test`, `host-only-imports.spec.ts`, `suite-placement.spec.ts`,
  `bench-memory-skills` and the bench host (all excluded by the task rules).

## Registration

Apply these lines in the files this batch must not edit. The two judge suites are `'last'` and may
only be followed by other `'last'` suites.

`tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts`:

```ts
import { resolveJudgeServices } from '../suites/skills/judge-agreement-ports';
import { createJudgeAgreementSuites } from '../suites/skills/judge-agreement.suite';
// in HOST_SUITES:
  // Local only, `placement: 'last'` (register one candidate row per judged document).
  ...createJudgeAgreementSuites({ resolveServices: resolveJudgeServices }),
```

`tools/mcp-bench/src/memory-skills/host/suite-placement.ts`, `HOST_SUITE_PLACEMENTS`:

```ts
  'skill.judge-agreement': 'last',
  'skill.judge-agreement.panel': 'last',
```

`tools/mcp-bench/src/memory-skills/host-only-imports.spec.ts`, `HOST_ONLY_MODULES`:

```ts
  // Batch 21 host adapter: value-imports the skill-synthesis barrel (tsyringe,
  // vscode-core); wired only by the host entry.
  'suites/skills/judge-agreement-ports.ts',
```

This guard only checks the `@ptah-extension/memory-curator` barrel, so it does not catch the
`@ptah-extension/skill-synthesis` barrel. I suggest making `BARREL` a set of both. Every other Batch 21
module imports `@ptah-extension/skill-synthesis` type-only.

`tools/mcp-bench/src/memory-skills/runner/run-memory-skills.entry.ts`: the suite needs the repo root,
which is only known inside `main()`:

```ts
import { createRubricAgreementSuite } from '../suites/skills/rubric-agreement.suite';
import { COMMITTED_FIXTURES_DIR } from './runner-plan';
// in main(), the runMemorySkills deps:
      offlineSuites: [
        ...OFFLINE_SUITES,
        createRubricAgreementSuite({
          fixturesDir: resolve(repoRoot, COMMITTED_FIXTURES_DIR),
        }),
      ],
```

Plan entries:

- Offline `{ "id": "skill.rubric.inter-rater", "groundTruth": { "id": "gt-skill-rubric@v1", "paths": [ ...the four paths below ] } }`.
- Host `skill.judge-agreement` / `.panel` with the same `groundTruth`, because `mergeGroundTruthRefs`
  requires identical path sets for one id.
- The four paths: `tools/mcp-bench/fixtures/memory-skills/skill-labels.v1.csv`,
  `…/skill-adjudication.v1.csv`, `…/skill-docs.v1.json`, `…/MANIFEST.json`.

## Pending live run

Not run. Run it **after Batch 25 commits the labels** (see the first-scored trap below), locally on
Windows, with Ptah.exe closed or the default guard. Write a runner plan, e.g.
`%LOCALAPPDATA%\ptah-mcp-bench\plans\judge-agreement.json`. `<BENCH>` is the resolved bench data dir and
`<REPO>` is the worktree root. All paths must be absolute.

```json
{
  "schemaId": "620.runner-plan.v1",
  "cassetteMode": "record",
  "cassettes": {
    "curator": { "path": "<BENCH>\\cassettes\\judge-agreement\\curator.jsonl", "model": "none" },
    "laneRunner": { "path": "<BENCH>\\cassettes\\judge-agreement\\lane-runner.jsonl", "model": "<judge-lane model id>" }
  },
  "fixtures": [
    { "kind": "directory", "source": "<BENCH>\\labelling\\skill-rubric-v1\\raters\\rater-r1\\documents", "target": "judge-agreement/documents" },
    { "kind": "file", "source": "<BENCH>\\labelling\\skill-rubric-v1\\private\\id-map.json", "target": "judge-agreement/id-map.json" },
    { "kind": "directory", "source": "<REPO>\\tools\\mcp-bench\\fixtures\\memory-skills\\planted-negatives.v1", "target": "fixtures/memory-skills/planted-negatives.v1" },
    { "kind": "file", "source": "<REPO>\\tools\\mcp-bench\\fixtures\\memory-skills\\MANIFEST.json", "target": "fixtures/memory-skills/MANIFEST.json" },
    { "kind": "file", "source": "<REPO>\\tools\\mcp-bench\\fixtures\\memory-skills\\skill-labels.v1.csv", "target": "fixtures/memory-skills/skill-labels.v1.csv" },
    { "kind": "file", "source": "<REPO>\\tools\\mcp-bench\\fixtures\\memory-skills\\skill-adjudication.v1.csv", "target": "fixtures/memory-skills/skill-adjudication.v1.csv" },
    { "kind": "file", "source": "<REPO>\\tools\\mcp-bench\\fixtures\\memory-skills\\skill-docs.v1.json", "target": "fixtures/memory-skills/skill-docs.v1.json" }
  ],
  "hostSuites": [
    { "id": "skill.judge-agreement", "options": { "model": "<judge-lane model id>" }, "groundTruth": { "id": "gt-skill-rubric@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/MANIFEST.json", "tools/mcp-bench/fixtures/memory-skills/skill-adjudication.v1.csv", "tools/mcp-bench/fixtures/memory-skills/skill-docs.v1.json", "tools/mcp-bench/fixtures/memory-skills/skill-labels.v1.csv"] } },
    { "id": "skill.judge-agreement.panel", "options": { "model": "<judge-lane model id>", "escalationModel": "<synthesis-lane model id>" }, "groundTruth": { "id": "gt-skill-rubric@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/MANIFEST.json", "tools/mcp-bench/fixtures/memory-skills/skill-adjudication.v1.csv", "tools/mcp-bench/fixtures/memory-skills/skill-docs.v1.json", "tools/mcp-bench/fixtures/memory-skills/skill-labels.v1.csv"] } }
  ],
  "offlineSuites": [
    { "id": "skill.rubric.inter-rater", "groundTruth": { "id": "gt-skill-rubric@v1", "paths": ["tools/mcp-bench/fixtures/memory-skills/MANIFEST.json", "tools/mcp-bench/fixtures/memory-skills/skill-adjudication.v1.csv", "tools/mcp-bench/fixtures/memory-skills/skill-docs.v1.json", "tools/mcp-bench/fixtures/memory-skills/skill-labels.v1.csv"] } }
  ]
}
```

Notes on the plan:

- The committed fixtures dir cannot itself be a `directory` fixture source. The plan schema requires a
  source strictly inside `committedFixturesDir`, so the plan lists the files one by one.
- Leave the three label files out until Batch 25 commits them. The fixture seeder refuses a missing
  source, and a home without them makes the suites `na`, which is the intended result.

Command (the 619 warning applies: no concurrent `withPinnedCorpus` bench):

```
npx nx run mcp-bench:bench-memory-skills -- --plan "<BENCH>\plans\judge-agreement.json" --run-id judge-agreement-<yyyymmdd>
```

Expected cost: 115 documents × 3 repeats = 345 judge-lane calls for the single judge. The panel makes
at least 345 more: 1 call per run while the library is empty, because the lens is degenerate.
Raw outputs land in `<BENCH>\runs\<runId>\raw\` and the record cassette in
`<BENCH>\cassettes\judge-agreement\`. Pass the recorded `details.promptSha256` as the `promptSha256`
option of later runs to detect rubric drift.

## Deviations

1. **Two judge suite ids.** The details schema allows a single `judge` per suite, so 21.2 has two
   suites: `skill.judge-agreement` (`SkillJudgeService`) and `skill.judge-agreement.panel`
   (`JudgePanelService`).
2. **Controls are per call, not per document.** Each call is one gate decision; `n` is the number of
   calls. An `unscored` call counts for neither control.
3. **`informative` must hold on both sets.** The design says "informative only if ρ beats length by
   ≥ 0.2". The verdict requires this on the full set **and** without `anchor-471` (the stricter
   reading, given the anchor selection bias).
4. **New input formats.** `skill-docs.v1.json` and the two CSV layouts were not specified anywhere, so
   they are defined here (see Design). Batch 25 must write them in this shape.
5. **The panel measures with an empty library.** The panel's lens is degenerate in the isolated home:
   there are no promoted rows and no gate measurements. Every panel verdict is therefore one panellist
   (the product's own `lensDegenerate` path). This is reported as `panel.singlePanellist`, not hidden.
   Seeding promoted skills would change what the panel judges, and the plan does not ask for it.
6. **Replay is `na`.** `CassetteStore.record` keeps only the last response per key, so three repeats of
   one request replay identically (SD = 0). Replay is a double in any case, which is why it is `na`.

## Out-of-scope observations

- **`.gitignore:202` `skills/`** hides `suites/skills/` (see the top of this report). This affects
  Batches 21, 22 and 23.
- **First-scored trap** (`runner/run-memory-skills.ts:597-608`). Any run that names
  `gt-skill-rubric@v1` records it as first-scored, even when the suite's verdict is `na`. When Batch 25
  then commits the labels, the commit is newer than that run, and `ground-truth-freshness.ts:162-180`
  refuses every later run ("ground truth changed after it was first scored"). Until the runner records
  only non-`na` suites (or skips `ground-truth-untrusted`), do not run a plan with this id before
  Batch 25. Use another id for a pre-label control run.
- **`host-only-imports.spec.ts`** guards only the memory-curator barrel. A value import of the
  `@ptah-extension/skill-synthesis` barrel from a non-host module would not be caught.
