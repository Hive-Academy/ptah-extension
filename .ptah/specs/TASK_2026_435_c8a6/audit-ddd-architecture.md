# Audit — ddd-architecture (TASK_2026_435 batch 2c)

Scope: `ptah-core/skills/ddd-architecture/**` (packaged master under
`apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/`) plus its
`.claude/skills/ddd-architecture/` copy. Line numbers below refer to the
original SKILL.md (162 lines) unless a file is named.

Suspected density: model education. Confirmed. The trigger body also
carried a second, shorter copy of the entity and value-object mechanisms
that already live in the references, and that copy had already drifted.

## Findings (rubric rule → line refs)

| # | Rubric rule | Finding |
| - | ----------- | ------- |
| 1 | SKILL.md routes | Body 162 lines vs ≤ ~150 target. Longest sections: project structure `:44–72`, entity pattern `:74–101`, value object `:103–123`, discovery `:16–31`. The reference list `:153–161` had no load condition. |
| 2 | One home per rule | Entity sketch `:80–95` restates `references/entities-aggregates.md` and already disagrees with it (`super(id)` and `place()` vs the reference's `super()` and `submit()`). Value-object sketch `:110–119` restates `Money` in `references/value-objects.md`. Inline "Read …" lines `:98–101` and `:121–123` repeat the index `:153–161`. |
| 3 | Model education | "Strategic and tactical DDD patterns for NestJS + Angular" `:8`. Building-blocks glossary `:33–42` (entity = identity, value object = no identity, and so on). Entity prose `:76–78` and value-object prose `:105–108` teach immutability, identity, and factories the model already knows. |
| 4 | One example per mechanism | Glossary table gives six one-line examples of terms the references then implement. The `Order` signature `:80–95` is a second `Order` beside the aggregate in `entities-aggregates.md`. The `Money` signature `:110–119` is a second `Money`; `Email`, `Address`, `DateRange`, `Percentage` (`:122–123`) are already the reference's examples. |
| 5 | No history | None found. |
| 6 | Contracts over narrative | The entity and value-object sections describe the reference instead of handing it over. The warrant (decision matrix `:125–133` and score `:135–151`) is a real contract and stayed. |
| 7 | No rosters/counts/versions | The glossary is not a discovery roster. Counted under rule 3. |
| 8 | Role-gated | n/a. |
| 9 | No hardcoded brand | Description is generic DDD. Body hardcoded NestJS + Angular (`:8`) and an Nx `libs/[domain]` tree (`:46–72`). The tree moved to `references/layer-layout.md`, loaded only when organizing a domain library. The five pattern references still contain NestJS/Prisma samples; those files are the implementation home and were not rewritten. |
| 10 | Measure what loads | Measured below (SKILL.md = trigger-time cost). |

## Cuts and moves

**New homes.**

- `references/discovery.md` (new, 873 B): the nine discovery questions, moved verbatim from `:18–31`. Load when domain discovery is still open. The `saas-workspace-initializer` Step a2 handoff stays in SKILL.md ("When to Engage User") because other skills point at that section. "questions below" became "the equivalent questions" plus the load link, since the questions no longer sit below that sentence.
- `references/layer-layout.md` (new, 1,409 B): the `libs/[domain]` tree from `:46–72`, plus the NestJS + Angular scope sentence from `:8`. Load when organizing a domain library.

**SKILL.md rewritten** (162 → 57 lines):

- Cut: the building-blocks glossary (`:33–42`) and both code sketches (`:80–95`, `:110–119`). The bases to copy are `Entity`, `EntityId`, and `ValueObject` in the existing references. The sketch was the copy that had drifted; deleting it removes the disagreement rather than teaching a new pattern.
- Kept as the warrant: the five yes/no checks and the 0-1 / 2-3 / 4-5 bands (`:140–151`), and the matrix rows the score does not already say — simple CRUD stops, multiple teams still require bounded contexts, high consistency needs aggregates and domain events (`:127–133`).
- Kept: discuss with the user before implementing; do not re-ask Round 1 when invoked from `saas-workspace-initializer` Step a2 (`:12–14`).
- Two silent rules stated once, each pointing at its home: do not hand-roll the base classes; one aggregate per transaction and other aggregates by id (`entities-aggregates.md`).
- Reference index is now a load-condition table for all seven files.
- Frontmatter `description` unchanged.

## Trigger-time KB (bytes of SKILL.md = what loads at trigger)

| File | Before | After |
| ---- | ------ | ----- |
| SKILL.md | 6,568 B / 162 ln | 2,903 B / 57 ln |
| references/discovery.md | — (new) | 873 B / 18 ln |
| references/layer-layout.md | — (new) | 1,409 B / 31 ln |
| references/entities-aggregates.md | 11,127 B | 11,127 B (untouched) |
| references/value-objects.md | 9,790 B | 9,790 B (untouched) |
| references/cqrs-pattern.md | 10,731 B | 10,731 B (untouched) |
| references/domain-events.md | 10,037 B | 10,037 B (untouched) |
| references/repository-pattern.md | 11,185 B | 11,185 B (untouched) |
| **Dir total** | **59,438 B** | **58,055 B** |

Trigger-time KB: 6,568 → 2,903 (−56%).

## cmp results

`git diff --no-index` packaged vs `.claude/skills/ddd-architecture/` after copying: IDENTICAL (exit 0). The .claude copy gained `discovery.md` and `layer-layout.md`.

Every relative path named in the edited SKILL.md exists (`discovery.md`, `layer-layout.md`, `entities-aggregates.md`, `value-objects.md`, `cqrs-pattern.md`, `domain-events.md`, `repository-pattern.md`).

## Checks

- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite, 11/11 passed.
- Representative routing check (structural, no live agent): a 0-1 or simple-CRUD score still says stop; the initializer handoff is still under "When to Engage User"; each former body section has one load row. The entity and value-object mechanisms are taught only by their existing references.

## Decisions

- The warrant stays in SKILL.md. Collapsing the decision matrix into the score alone would drop "multiple teams → bounded contexts even when the rest of the score is low" and "high consistency → aggregates + domain events".
- Pattern references were not de-branded. Stripping NestJS and Prisma from those samples would change the worked examples. Rule 9 is satisfied at trigger time by moving the stack sentence and the folder tree behind `layer-layout.md`.
- `content-manifest.json` was not regenerated — outside the allowed edit set. `references/discovery.md` and `references/layer-layout.md` are not listed there, so a runtime download will not serve them until the manifest is regenerated once after the batch-2 trims land.
- Frontmatter `description` untouched per batch brief.
