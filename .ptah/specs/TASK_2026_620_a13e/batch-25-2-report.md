# Batch 25.2 — Commit skill labels and U4 panel labels

Committed numeric U1 rubric labels and frozen U4 trigger and real-session labels. No git commit.

## Files

Created under `tools/mcp-bench/fixtures/memory-skills/`:

| File                        | Rows | sha256                                                             |
| --------------------------- | ---: | ------------------------------------------------------------------ |
| `skill-labels.v1.csv`       |  210 | `9f965ce89a48dd07d3f9787afa1def30bddadc0fbf9d3b307d8e97768e023c42` |
| `skill-adjudication.v1.csv` |   37 | `0ac801d55eae65b131e097570b7444075286a025506d922e5427be421cf77c23` |
| `skill-docs.v1.json`        |  105 | `60a505ab5735bd35b45c8915fd1b34731e554d6879163f3bb7f07365884a301b` |
| `skill-triggers.v1.jsonl`   |   23 | `7d9a4afc58a68990df4172ba0be11284f7c19cf1ce694a3aba63f08a1f255ea9` |
| `real-sessions.v1.jsonl`    |   20 | `4b11da4f1632a394180beadf38ddad9aba41ec113b8b62623fa64d73deb8e03c` |

Updated:

- `tools/mcp-bench/fixtures/memory-skills/MANIFEST.json` — the five new paths, sorted with the existing file map. Previous hashes were left as they were.
- `tools/mcp-bench/src/memory-skills/labelling/build-labelling-packet.ts` — rater `ratedAt` instruction.
- `tools/mcp-bench/src/memory-skills/labelling/build-labelling-packet.spec.ts` — pins the new instruction sentence.
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts` — the committed-fixture case now loads U1.
- `tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts` — new. Parses the two U4 files with the suite schemas.

Memory fact, merge, update, and temporal fixtures were not edited. `scorecard/`, `transport/`, `corpus/`, `suites/question-sets.ts`, and `bench-data.ts` were not edited.

## Decisions

**Stratum is in `skill-docs.v1.json`.** R2 keeps the stratum map out of the repo until adjudication closes, then adds it. The private U1 manifest has `unresolvedCount` 0 and `population` 105. Every document has one `r1` row and one `r2` row. All 37 adjudication rows match a real disagreement (`pass` differs or totals differ by more than 12), and no disagreement is missing a row (`pending` 0, trigger text rewritten 0). `skillDocsSchema` requires `anchor471Total` exactly when `stratum` is `anchor-471`. The private id map has an integer total on all 10 anchor documents and on no other document. Each committed document is `{opaqueId, sha256, stratum}` plus `anchor471Total` on those 10. Stratum counts: authored 23, promoted-synthesized 2, anchor-471 10, suggestion 18, judged-model 20, fallback 20, random 12. Slug, source kind, candidate id, suggestion id, cell, source hash, and dropped-frontmatter keys stay in the private id map.

**`sha256` on a skill doc is the rendered-document hash** from that id map (the bytes the raters read), not the raw source hash.

**Trigger file name is `skill-triggers.v1.jsonl`.** `TRIGGER_LABELS_TARGET` is the home path `memory-skills/skill-triggers.v1.jsonl`. The committed source uses that file name. Rows are `committedTriggerLabelSchema` / `triggerLabelSchema`: `skillId`, `description`, `shouldTrigger`, `nearMiss`, `panel`. Every row's panel is `xAI+Google; adjudicator=GLM`, so a load reports method `model-panel`.

**Session file name is `real-sessions.v1.jsonl`.** `realSessionLabelSchema` is parsed by `toRealSessionLabel` in `model-panel.ts` and by its spec. No suite names a committed path for these rows. Design §10.2 says the repo holds `{opaqueId, sha256, lineRefs}` only. The file is JSONL of those three fields, 20 rows, sorted by opaque id. Line refs were already unique and ascending.

**`MANIFEST.json` has no notes.** `manifestSchema` is `{schemaVersion: 1, files}` and rejects other keys, so a notes field would fail `verifyManifest` and the rubric hash check. Counts and the panel string are in this report. Private manifests say U1 population 105 unresolved 0, U4 triggers population 23 unresolved 0, U4 sessions population 20 unresolved 0, panel families xAI, Google, and GLM.

**`ratedAt` instruction.** `rubricScoreRowSchema.ratedAt` is `z.string().datetime()` (ISO-8601 with a timezone). The sheet at `build-labelling-packet.ts` now asks for an ISO-8601 UTC date-time, with example `2026-10-07T00:00:00Z`. No spec contained the old `YYYY-MM-DD` sentence. The packet spec now requires the new sentence. Committed U1 `ratedAt` values were already datetimes (210/210); they were copied unchanged.

## Checks

Jest, first run (the U4 spec failed to load; the other five suites passed):

```
FAIL mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts
  tsyringe requires a reflect polyfill
PASS seeded-session-generator.spec.ts
PASS build-labelling-packet.spec.ts
PASS skill-session-fixture.spec.ts
PASS rubric-ground-truth.spec.ts
PASS rubric-agreement.suite.spec.ts (20.704 s)
Test Suites: 1 failed, 5 passed, 6 total
Tests:       62 passed, 62 total
```

Cause: importing `trigger-human-eval.ts` loads skill-synthesis. The spec now imports `reflect-metadata` and the virtual `vscode` mock, the same pair `namer-and-trigger.suite.spec.ts` uses. Re-run of that spec only:

```
PASS mcp-bench tools/mcp-bench/src/memory-skills/ground-truth/committed-u4-labels.spec.ts (13.645 s)
Tests: 2 passed, 2 total
```

The committed U1 case in `rubric-agreement.suite.spec.ts` passed on the first run. It requires 105 items, population 105, unresolved 0, 37 adjudications, 0 pending, 0 strata missing, 80 candidate items, numeric full-set kappa and Spearman, method `model-panel`, and panel `xAI+Google; adjudicator=GLM`. File checks for the three rubric files are `pass`. `skill-session-fixture.spec.ts` `verifyManifest` on the fixture directory passed, so the new manifest hashes match the bytes.

`npx tsc -p tools/mcp-bench/tsconfig.json --noEmit` exited 0. Tail:

```
(node:17412) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
```

`npx prettier --check --ignore-unknown` on the new and edited files exited 0. Tail: `All matched files use Prettier code style!` JSONL is ignored (R8).

## Privacy grep

Searched the five new files for `note`, `slug`, `sourceKind`, `candidateId`, `suggestionId`, `sourceSha256`, `droppedFrontmatter`, `AppData`, `.claude`, `SKILL.md`, and path shapes, and for private id-map slug strings.

- `skill-docs.v1.json` keys are only `opaqueId`, `sha256`, `stratum`, and `anchor471Total`. No slug hits.
- The two CSVs and `real-sessions.v1.jsonl` had no hits. CSV headers are the loader columns. No `note` column.
- `skill-triggers.v1.jsonl` keys are only `skillId`, `description`, `shouldTrigger`, `nearMiss`, `panel`.
- The letters `note` occur once, inside a synthetic prompt (`skill with notes and a help`). There is no notes field.
- Ten private id-map slugs occur as whole words inside trigger description or prompt text (lengths 8–25). They are not a slug column. `triggerLabelSchema` requires that prompt text. Near-miss prompts name other skills. Those strings were not copied from the id map as metadata.

No source paths, document bodies, candidate bodies, transcript text, or rater notes were written.

## Revise round 1

Addressed review finding 1 without reading, copying, or logging the private
manifest contents.

Files changed:

- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-panel-manifest.ts`
  loads only `<benchDataDir>/labelling/merged/u1-rubric.manifest.json`, parses
  it with `panelManifestSchema`, and returns either the parsed panel or a
  content-free missing/invalid reason.
- `tools/mcp-bench/src/memory-skills/runner/run-memory-skills.entry.ts` resolves
  the bench-data directory once and supplies that loader result to the rubric
  suite.
- `tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.ts`
  makes a missing or invalid production manifest an untrusted `na` result with
  `ground-truth-untrusted: panel-manifest-missing` or
  `ground-truth-untrusted: panel-manifest-invalid`; its ground-truth method is
  `model-panel` with an `unverified` panel marker, never `labelled`.
- `rubric-panel-manifest.spec.ts` covers missing file, malformed JSON, schema
  failure, and the U1 grok/gemini/GLM lane identities. The rubric suite spec
  now uses those real identities and covers committed U1 fixtures with a
  missing manifest.

Decision: direct `panel` options remain supported by `runRubricAgreement` for
its focused unit tests. The registered production suite always receives the
loader outcome, so model-panel U1 labels cannot silently be rendered as human
labels when the private manifest is unavailable.

Checks:

```text
npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-agreement.suite.spec.ts tools/mcp-bench/src/memory-skills/suites/skills/rubric-panel-manifest.spec.ts --coverage=false --maxWorkers=2
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total
```

```text
npx tsc -p tools/mcp-bench/tsconfig.json --noEmit
(empty error tail; command completed successfully)
```

```text
npx prettier --check <changed files>
All matched files use Prettier code style!
```
