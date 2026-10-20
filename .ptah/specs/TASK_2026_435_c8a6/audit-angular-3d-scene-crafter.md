# Audit — angular-3d-scene-crafter (TASK_2026_435 batch 2d)

Scope: packaged `ptah-angular/skills/angular-3d-scene-crafter/` and its `.claude/skills/` copy. Findings refer to original `SKILL.md` line numbers (657 lines).

## Findings (rubric rule → line refs)

| Rule | Finding |
| --- | --- |
| 1. SKILL.md routes | The entry body carried both full workflows `:31–557`, template selection `:558–597`, tips `:607–615`, and a sample conversation `:617–657`. This made a 657-line entry against the ~150-line target. |
| 2. One home per rule | Component and composition lookups in the entry `:130–191`, `:304–332` overlapped the linked catalogs `:603–605`. The short entry now routes to the appropriate reference; workflow-specific mapping stays in its workflow. |
| 3. Cut model education | The overview `:12–20`, image request script `:35–40`, generic tips `:609–615`, and concluding explanation `:657` added no library contract. Cut. |
| 4. One example per mechanism | Five separate visual-analysis examples `:53–128`, the template sales dialogue `:579–597`, and the additional conversation `:617–655` loaded together. Workflow examples moved behind their route; repeated dialogues were cut. |
| 5. No history | No historical incident or task narrative found. |
| 6. Contracts over narrative | Kept the package prerequisite `:10`, visual-analysis fields `:42–128`, component configuration and complete code `:130–231`, `:282–538`; removed sales prose around templates `:560`, `:579–597`. |
| 7. No rosters/counts/versions | The template roster `:564–571` belonged behind a template load condition. It now lives in `references/templates.md`; library components remain discoverable in `references/components.md`. |
| 8. Role-gated | No role-specific tool capability was present. |
| 9. Brand/stack | `@hive-academy/angular-3d` is the named subject of this skill, so its package name stays. |
| 10. Measure what loads | Entry bytes fell 21,006 → 1,615. See measurements below. |

## Cuts and moves

- `references/image-workflow.md` holds original Workflow A `:31–248`, including visual analysis, component mapping, reconstruction, and customization. Relative reference links were adjusted for its new directory.
- `references/text-workflow.md` holds original Workflow B `:251–557`, including incremental scene setup and the full component example. Relative reference links were adjusted.
- `references/templates.md` holds the template selection table `:558–571` and the three usage rules `:573–577`; its asset links point to the unchanged starters. The duplicate template conversation `:579–597` was cut.
- Entry overview `:12–29`, generic tips `:607–615`, and scripted interaction `:617–657` were cut. The entry now has four operational rules and six direct reference links, each with a load condition. Frontmatter description was preserved.

## Trigger-time KB

Bytes use `wc -c` semantics; KB is decimal. Directory totals include all assets and references.

| Measure | Before | After |
| --- | ---: | ---: |
| `SKILL.md` (trigger time) | 21,006 B / 21.006 KB / 657 lines | 1,615 B / 1.615 KB / 22 lines |
| `references/image-workflow.md` | — | 6,942 B |
| `references/text-workflow.md` | — | 8,237 B |
| `references/templates.md` | — | 2,344 B |
| Whole directory | 132,488 B / 132.488 KB | 130,620 B / 130.620 KB |

Entry reduction: 19,391 B (92.3%). Existing references and `assets/*.ts` were unchanged.

## Checks

- `diff -r` packaged vs `.claude` copy: exit 0, byte-identical files.
- Every Markdown link in the edited `SKILL.md` and new references resolves to a file.
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite passed, 11 tests passed.
- Representative route: a reference-image request loads `image-workflow.md`, which retains analysis → component mapping → reconstruction; a written brief loads `text-workflow.md`, which retains the complete component path.

## Decisions

- Starter assets remain opt-in and untouched. Template selection moved to a direct entry link with a load condition.
- Existing component, pattern, and best-practice references stay directly linked from `SKILL.md`, so workflow references are only one level from entry and can refer to their catalogs without hiding discovery.
- No manifest or file outside the two skill directories and these audit deliverables was edited.