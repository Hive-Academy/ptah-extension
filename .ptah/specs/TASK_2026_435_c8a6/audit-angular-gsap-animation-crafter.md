# Audit — angular-gsap-animation-crafter (TASK_2026_435 batch 2d)

Scope: packaged `ptah-angular/skills/angular-gsap-animation-crafter/` and its `.claude/skills/` copy. Findings refer to original `SKILL.md` line numbers (573 lines).

## Findings (rubric rule → line refs)

| Rule | Finding |
| --- | --- |
| 1. SKILL.md routes | Full image/video and text workflows `:21–407`, a scripted interaction `:408–477`, templates and two more sales dialogues `:478–539` made a 573-line entry. |
| 2. One home per rule | The entry repeated timing and trigger guidance `:225–256` while linking the detailed best-practices catalog `:547`; it also summarized patterns `:86–101` and linked their catalog `:546`. Workflow-specific selection remains in workflow references, with catalogs still direct from entry. |
| 3. Cut model education | Overview `:12–19`, conversational discovery script `:165–190`, and closing invitation `:573` did not add a library contract. Cut or moved behind the text route as appropriate. |
| 4. One example per mechanism | The full Workflow B component `:324–407` was followed by a second dialogue and code example `:408–477`; template sales dialogues `:502–539` repeated selection and customization. Kept the full component in its workflow; cut the repeated conversations. |
| 5. No history | No historical incident or task narrative found. |
| 6. Contracts over narrative | Kept the package prerequisite `:10`, motion-analysis dimensions `:33–71`, directive mapping `:72–85`, reconstruction code `:103–148`, text workflow configuration `:161–407`, and SSR/performance/accessibility rules `:551–557`. |
| 7. No rosters/counts/versions | The page and section template roster `:482–494` now loads only when an asset matches the requested animation. |
| 8. Role-gated | No role-specific tool capability was present. |
| 9. Brand/stack | `@hive-academy/angular-gsap` is the named subject of this skill, so its package name stays. |
| 10. Measure what loads | Entry bytes fell 17,563 → 1,792. See measurements below. |

## Cuts and moves

- `references/image-workflow.md` holds original Workflow A `:21–160`, including motion analysis, directive matching, reconstruction code, and customization.
- `references/text-workflow.md` holds original Workflow B `:161–407`, including intent, timing, trigger points, incremental setup, and the complete component.
- `references/templates.md` holds page/section selection `:478–494`, the three usage rules `:496–500`, and the quick-start asset guidance `:561–569`. Its asset links point to unchanged starters.
- Removed second interaction `:408–477` and template conversations `:502–539`; trimmed overview and closing narrative. The entry now has five operational rules and six direct reference links, each with a load condition. Frontmatter description was preserved.

## Trigger-time KB

Bytes use `wc -c` semantics; KB is decimal. Directory totals include all assets and references.

| Measure | Before | After |
| --- | ---: | ---: |
| `SKILL.md` (trigger time) | 17,563 B / 17.563 KB / 573 lines | 1,792 B / 1.792 KB / 23 lines |
| `references/image-workflow.md` | — | 5,477 B |
| `references/text-workflow.md` | — | 5,641 B |
| `references/templates.md` | — | 2,488 B |
| Whole directory | 151,617 B / 151.617 KB | 149,452 B / 149.452 KB |

Entry reduction: 15,771 B (89.8%). Existing references and `assets/*.ts` were unchanged.

## Checks

- `diff -r` packaged vs `.claude` copy: exit 0, byte-identical files.
- Every Markdown link in the edited `SKILL.md` and new references resolves to a file.
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite passed, 11 tests passed.
- Representative route: a visual motion reference loads `image-workflow.md` and retains analysis → directive mapping → reconstruction; a written brief loads `text-workflow.md` and retains configuration → complete component.

## Decisions

- SSR, one-time entrances, stagger limits, and reduced motion remain visible in the entry because these rules are easy to miss when only one workflow reference loads.
- Starter assets remain opt-in and untouched. The template roster and quick start moved behind a direct load condition.
- Existing component, pattern, and best-practice references remain directly linked from `SKILL.md`; no manifest or other lane's file was edited.