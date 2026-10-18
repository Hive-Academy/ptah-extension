# Audit — skill-creator (TASK_2026_435 batch 2a)

Scope: `ptah-core/skills/skill-creator/**` (packaged master under
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`) plus its
`.claude/skills/skill-creator/` copy. Line numbers below refer to the
original SKILL.md (357 lines) unless a file is named.

## Findings (rubric rule → line refs)

| # | Rubric rule | Finding |
| - | ----------- | ------- |
| 1 | SKILL.md routes | Body 357 lines vs ≤ ~150 target. Longest sections carry the burden: explainer `:11–45`, anatomy `:47–112`, progressive disclosure `:114–201`, process `:203–357`. |
| 2 | One home per rule | "Avoid duplication: information should live in either SKILL.md or references" `:91` states the one-home rule in prose; no linked home existed. |
| 3 | Model education | "Skills are modular, self-contained packages… transform Claude from a general-purpose agent" `:13–16`; "What Skills Provide" `:18–23`; "The context window is a public good… Claude is already very smart" `:27–33`; "narrow bridge with cliffs" narrative `:45`. |
| 4 | One example per mechanism | Progressive disclosure: Pattern 1 `:130–146` and Pattern 3 `:178–197` show the same mechanism (index link + load condition) twice; Pattern 2 `:149–175` shows split-by-domain twice (bigquery `:152–161`, cloud-deploy `:163–175`). Step 2 `:240–254` shows three examples (pdf-editor, frontend-webapp-builder, big-query) of one mechanism (example → reusable resource). |
| 5 | No history | None found. |
| 6 | Contracts over narrative | Validation `:328–337` and packaging `:339–346` were already contracts; surrounding narrative ("Once development… it can be packaged" `:324–326`) restated them. |
| 7 | No rosters/counts/versions | None found. |
| 8 | Role-gated | n/a. |
| 9 | No hardcoded brand | No vendor brand. "Claude" used as the reader's name throughout; neutral "agent/reader" wording used in the rewrite where natural. |
| 10 | Measure what loads | Measured below (SKILL.md = trigger-time cost). |

## Cuts and moves

**New home.** `references/prompt-authoring-rubric.md` (new, 3,114 B):
the ten authoring rules plus the audit procedure. Linked from SKILL.md
with a load condition. The file itself follows rubric 5 — it carries no
tribunal/task-ID history.

**SKILL.md rewritten** (357 → 161 lines):

- Cut: the "About Skills"/"What Skills Provide" explainer (`:11–23`)
  and the "Claude is already very smart" narration (`:27–45`). The
  operative rule (only add what the using agent cannot derive) moved to
  the rubric reference (rules 3 and 10).
- Collapsed to one example per mechanism: routing kept ONE index example
  (`:130–146` form) plus one sentence for the variant-split case;
  Step 2 kept the pdf example plus a need→resource table.
- Kept as contracts: directory anatomy, frontmatter contract including
  the `license`-field exception (`:313–316`), degrees-of-freedom table
  (compressed from `:35–45` prose), body rules (500-line split
  threshold, link-with-load-condition, ToC/grep thresholds `:90`,
  `:200–201`, no-auxiliary-files `:104–112`), all six process steps,
  validation checklist, zip packaging.
- Byte-identical frontmatter (pinned by the batch-1 guard).

## Trigger-time KB (bytes of SKILL.md = what loads at trigger)

| File                    | Before             | After              |
| ----------------------- | ------------------ | ------------------ |
| SKILL.md                | 18,172 B / 357 ln  | 7,096 B / 161 ln   |
| references/prompt-authoring-rubric.md | — (new) | 3,114 B / 78 ln |
| references/workflows.md | 819 B              | 819 B (untouched)  |
| references/output-patterns.md | 1,823 B     | 1,823 B (untouched) |
| LICENSE.txt             | 11,357 B           | 11,357 B (untouched) |
| **Dir total**           | **32,171 B**       | **24,209 B**       |

Trigger-time KB: 18,172 → 7,096 (−61 %).

## cmp results

`diff -r` packaged vs `.claude/skills/skill-creator/` after copying:
IDENTICAL (the .claude copy gained the new rubric file; all five files
match byte-for-byte).

## Checks

- `skill-description-shape.spec.ts` (vscode-lm-tools, the guard pinning
  the frontmatter): 6/6 passed.
- harness-sync `-t "skill"`: the sibling-links guard that walks
  ptah-core skills passed. One suite failed —
  `harness-reconciler.skill-consent.spec.ts` (7 tests,
  `skillSyncMode` state logic). That spec never references
  `assets/plugins`, `skill-creator` or `ptah-cli-usage`, so the failure
  is pre-existing on this branch and unrelated to these edits.

## Decisions

- The rubric's home is the new reference file; SKILL.md links to it and
  keeps only the format contracts and the creation process. The 500-line
  split threshold stays in SKILL.md (format contract) while the ~150-line
  routing target lives in the rubric — different rules, one home each.
- The `license` frontmatter exception paragraph was kept: this skill
  ships `LICENSE.txt` and the exception is a factual contract.
- The rubric link from `agent-lanes` was NOT added — another task owns
  that file per the batch brief.
- `content-manifest.json` (repo root) was NOT regenerated — outside the
  allowed edit set. The new `references/prompt-authoring-rubric.md` is
  not yet listed there, so runtime download will not serve it until the
  manifest is regenerated once after all batch-2 trims land.
- Frontmatter `description` untouched per batch brief.