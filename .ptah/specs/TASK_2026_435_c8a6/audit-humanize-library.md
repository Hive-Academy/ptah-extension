# Audit — humanize-library (TASK_2026_435 batch 2c)

Scope: `ptah-core/skills/humanize-library/**` (packaged master under
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`) plus its
`.claude/skills/humanize-library/` copy. Line numbers below refer to the
original SKILL.md (135 lines) unless a file is named.

Suspected density: example repetition. Confirmed. The trigger body
restated the quality rubric (shape weights, scoring axes, and the
"human-written" definition) and listed several filenames for each of
three discovery mechanisms.

## Findings (rubric rule → line refs)

| # | Rubric rule | Finding |
| - | ----------- | ------- |
| 1 | SKILL.md routes | Body 135 lines, inside the ~150 target. Six operating principles (`:17–28`). All six break silently (silent bugfix, foreign conventions, a gate that never runs, editing before sign-off, one giant rewrite, `git add -A` on a shared tree), so none was dropped. Extra detail moved to the reference that already owned it. |
| 2 | One home per rule | Shape table `:76–83` paraphrases `references/quality-rubric.md` §0. Axes `:85–91` paraphrase rubric §§1, 5, 8 and 9. Ordering `:99–106` paraphrases §Severity ordering, except "batches touching the same file are strictly serial", which the rubric does not say. "What human-written means" `:126–135` paraphrases rubric §§1, 3, 4, 6 and 7. Step 5's dependent lookup `:114–115` paraphrases Recipe 9. The callout `:56–58` restates principles 2 and 3. |
| 3 | Model education | `:126–135` teaches one-job files, intent-revealing names, and "comments explain why". The rubric names SOLID as model education. The frontmatter still says SOLID; that line was not edited. |
| 4 | One example per mechanism | Manifest filenames `:36–37` (seven), entry-point filenames `:38` (four), and instruction-file filenames `:41–42` (five) are one mechanism each. The shape table is a second calibration example beside rubric §0, including a second 900-line registry illustration (`:128–129` vs rubric §0). |
| 5 | No history | None found. |
| 6 | Contracts over narrative | The shape table and the four axes describe the rubric. Kept the plan fields (smell, target shape, files, risk, gate command) and the step 6 output fields (`:121–122`). |
| 7 | No rosters that discovery supplies | Which file is the manifest, the entry point, or a local instruction file is visible by reading the folder. Instruction filenames already have a home in `discover-the-repo.md` A2. The ecosystem command table in that file's Part B was left as the discovery procedure. |
| 8 | Role-gated | n/a. |
| 9 | No hardcoded brand | The skill says it is repo-agnostic (`:11–13`) and then names `ptah_get_dependents` and `ptah_lsp_references` (`:114–115`). Recipe 9 also named `ptah.ide.actions.rename` and `ptah_lsp_references`. Those brand examples were removed. The mechanism kept is an IDE rename, or grep, then check dependents. |
| 10 | Measure what loads | Measured below (SKILL.md = trigger-time cost). |

## Cuts and moves

No new reference. The homes already existed.

**SKILL.md rewritten** (135 → 65 lines):

- Cut the filename rosters in step 1. The rules stayed: read the manifest, treat the public entry point as the contract, read local instruction files up to the repo root. A2 is the list of instruction filenames.
- Cut the "looks like a repo you know" callout (`:56–58`). Principles 2 and 3 and Part B already say it.
- Cut the shape table (`:76–83`) and the four axes (`:85–91`). Step 3 still runs `scripts/analyze_library.mjs` and still reports shape (`logic` / `registry` / `types` / `generated`). Weights load from quality-rubric §0 only.
- Cut the ordering bullets that repeat §Severity ordering. Kept the one constraint that file does not state: same-file batches are strictly serial. Kept "present the plan and wait".
- Cut "What human-written means" (`:126–135`). That definition's home is quality-rubric §§1–7.
- Step 5 no longer names `ptah_*` tools. It points at Recipe 9.
- Step 6 output fields unchanged: what changed, before/after on the worst offenders, duplication removed, bugs spotted-but-not-fixed, behavior changes that needed sign-off, final gate status.
- Frontmatter `description` unchanged.

**`references/refactor-recipes.md` Recipe 9** (214 → 212 lines): the rename move no longer lists `ptah.ide.actions.rename` or `ptah_lsp_references`. It still says to rename through the language server (IDE rename or grep) and to check dependents before renaming an export. The rest of the recipe file is unchanged.

## Trigger-time KB (bytes of SKILL.md = what loads at trigger)

| File | Before | After |
| ---- | ------ | ----- |
| SKILL.md | 7,509 B / 135 ln | 4,768 B / 65 ln |
| references/discover-the-repo.md | 8,812 B | 8,812 B (untouched) |
| references/quality-rubric.md | 8,624 B | 8,624 B (untouched) |
| references/refactor-recipes.md | 11,275 B / 214 ln | 11,198 B / 212 ln |
| scripts/analyze_library.mjs | 15,718 B | 15,718 B (untouched) |
| **Dir total** | **51,938 B** | **49,120 B** |

Trigger-time KB: 7,509 → 4,768 (−36%).

## cmp results

`git diff --no-index` packaged vs `.claude/skills/humanize-library/` after copying: IDENTICAL (exit 0).

Every relative path named in the edited SKILL.md exists (`references/discover-the-repo.md`, `references/quality-rubric.md`, `references/refactor-recipes.md`). The analyzer command is a script path, not a markdown link; `scripts/analyze_library.mjs` is present.

## Checks

- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite, 11/11 passed.
- Representative routing check (structural, no live agent): the six silent rules, the analyzer command, the plan fields, the same-file serial rule, and the step 6 report fields are still in SKILL.md. Shape weights, severity order, git safety beyond `git add -A`, and the rename procedure each have one home in the existing references.

## Decisions

- All six operating principles stayed in the trigger body. The rubric's "more than five, move the extras" applies to rules that do not break silently; each of these six does.
- Recipe 9 was edited even though the suspected repetition was in SKILL.md. Leaving the `ptah_*` names there would have kept a brand hardcoded in a skill whose own rule is that it carries no project conventions. The edit removes the second example of "find references", not the procedure.
- `content-manifest.json` was not touched. This skill added no files, so the manifest's humanize-library list is still complete.
- Frontmatter `description` untouched per batch brief.
