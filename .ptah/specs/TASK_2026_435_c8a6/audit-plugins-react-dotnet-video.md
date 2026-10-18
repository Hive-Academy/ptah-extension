# Audit — ptah-react, ptah-dotnet, ptah-video skills (TASK_2026_435 batch 2f)

Scope: the 7 packaged skills below plus the `.claude/skills/` copy of `video-showcase`
(the only one that exists). Findings refer to the original `SKILL.md` line numbers.

## Findings, cuts and moves (rubric rule → line refs)

### 1. composition-patterns (ptah-react)

| Rule | Finding |
| --- | --- |
| 1. SKILL.md routes | 83-line entry was within target, but carried trigger duplication. |
| 1 (triggers) | "When to Apply" `:13–21` restated the frontmatter description. Cut. |
| 3. Model education | Intro mission prose `:8–11` ("...easier for both humans and AI agents...") taught nothing. Cut. |
| 4. One example | Code fence `:68–71` was a second example of the file-naming mechanism the Quick Reference already shows. Cut. |
| 5. No history | "by design: it duplicated the same content a second time and defeated the point" `:80–82` is the file's own history. Kept the operative fact ("There is no compiled all-in-one document"); cut the story. |
| 7. Rosters | The 8-rule Quick Reference stays: `rules/` files have no discovery command, so the one-line index IS the routing mechanism rubric rule 1 requires. |

Frontmatter description unchanged. The priority table and the full rule index are
byte-preserved; only the narrative wrapper and duplication were removed.

### 2. react-best-practices (ptah-react)

| Rule | Finding |
| --- | --- |
| 7. Counts | "Contains 57 rules across 8 categories" `:8` is a count the index itself supplies. Cut. |
| 3. Model education | "Comprehensive performance optimization guide... to guide automated refactoring and code generation" `:8` is narrative. Cut. |
| 1 (triggers) | "When to Apply" `:10–18` restated the frontmatter description. Cut. |
| 4. One example | Code fence `:122–125` was a second example of the `rules/` file naming. Cut. |
| 5. No history | Closing rationale "loading 57 rules to apply two of them costs context..." `:134–136`. Kept the fact, cut the justification. |
| 7. Rosters | The 57-rule index stays, same reasoning as composition-patterns: it is the load-condition index; no runtime command lists `rules/`. |

Frontmatter description unchanged; the category table and all 57 index entries are
byte-preserved.

### 3. react-nx-patterns (ptah-react)

| Rule | Finding |
| --- | --- |
| 1. SKILL.md routes | 384-line entry vs the ~150 target. The worked examples carried the burden of proof. |
| 4 / 2. One example | Five worked examples `:62–141` (RSC page, client container, presentational card) and `:143–229` (`React.cache`, server actions, React Query hooks, Zustand store) were second examples of mechanisms `references/server-components.md` and `references/client-components.md` already teach in richer form (e.g. Zustand with devtools/persist, React Query with mutations). Cut; the references are the home. |
| 2. One home | "Characteristics" `:136–141` duplicated `references/client-components.md` "Rules for presentational components". Cut. |
| 6. Contracts over narrative | Per-topic detail moved out: eslint `@nx/enforce-module-boundaries` config `:231–277` + tagging strategy `:329–343` → new `references/module-boundaries.md`; `create-nx-workspace`/generator commands `:279–308` + `tsconfig.base.json` paths `:310–327` → new `references/workspace-setup.md`; app-router integration `:345–363` appended to `references/server-components.md`. |
| Kept in entry | Core principle, library-type table, domain tree, decision matrix — the contracts that route "where does this go". |

Frontmatter description unchanged.

### 4. dotnet-solution-architect (ptah-dotnet)

| Rule | Finding |
| --- | --- |
| 2. One home | Layout trees `:30–64` duplicated the richer worked examples already in `references/clean-architecture-vs-vertical-slices.md:34–77`. Cut from the entry; the reference is the home. |
| 2. One home | "Both are valid... Clean Architecture optimizes for protecting domain invariants... Vertical slices optimizes for shipping speed" `:28` paraphrased the reference's "What each shape optimizes for" table. Cut; the do-not-mix-within-one-context rule stays, compact, next to the reference link. |
| 2. One home | The three solution-root XML baselines `:98–152` duplicated `references/central-package-management.md`, which holds all three files plus the per-project override escape hatch. Replaced with three one-line contracts + a load-condition link. |
| 2 / 7. Rosters | "Companion skills" `:169–175` restated the Activation scope `:12`, the Handoff boundary `:162`, and facts each sibling skill states about itself. Cut; the one unique fact (Nx wraps the projects, does not change the layout) folded into Handoff boundary. |
| Kept in entry | Decision table, Project Naming, `ProjectReference` direction rules, test placement, handoff boundary — all byte-preserved. |

Frontmatter description unchanged.

### 5. dotnet-solution-initializer (ptah-dotnet)

| Rule | Finding |
| --- | --- |
| 1 (triggers) | "Trigger Keywords" `:10–15` restated the frontmatter description. Cut. |
| 5 / 6. History | Round 1 justification tail `:48` ("...which is the whole point of stating them once in the shared contract instead of here"). Kept the contract ("Nothing about Round 1 changes for .NET -- the business questions are stack-agnostic by design"); cut the story. |
| 2 / 7. Rosters | The end-of-file References `:157–178` (Shared Stage A contract, Companion skills, External skills) restated the Division of labour `:16–21` and the inline links already at `:18`, `:48`, `:86`. Cut; the inline links are the homes. |
| Kept verbatim | Stage A contract, Round 1/2 discovery, Step a2 invocations, roadmap notes, foundation table, verification, handoff block, STOP rules. |

Frontmatter description unchanged.

### 6. nx-dotnet-workspace (ptah-dotnet)

| Rule | Finding |
| --- | --- |
| 7. Versions | "Nx 23.1.1 is the latest as of this skill's authoring" `:26` is a version discovery supplies. Cut the latest-version note; kept the `>= 22.0.0` floor and "check the Nx version in the workspace". |
| 2. One home | "When NOT to use Nx" `:102–110` re-expanded decision-table rows 3–5 (`:18–20`) as prose. Cut; the unique rule (say plainly that Nx is unnecessary, name plain `dotnet new sln` explicitly) folded into the decision section after `:22`. |
| 5. No history | "despite the Nx 22 release marketing presenting it as a first-class technology" `:92`. Cut. |
| 2. Rosters | References `:112–117` restated `:12` (initializer asks in Round 2), `:8` (architect designs the layout), `:88` (template-engine scaffolds). Cut. |
| Kept | Decision table, prerequisites, project-inference contract, inferred-targets table, all four gotchas, cross-language `implicitDependencies` fix, no-generators rule, experimental warning + issue link, archived `@nx-dotnet/core` warning, `NX_DOTNET_DISABLE` debugging. |

Frontmatter description unchanged.

### 7. video-showcase (ptah-video)

| Rule | Finding |
| --- | --- |
| 4 / 2. One example | "Quick commands" `:39–51` repeated the render and studio commands already in Workflow steps 4–5; `--out-res 1080p` is documented at `reference/brand-and-runtime.md:124`. Section cut; its unique facts folded into workflow step 4 (omit `--scene` renders all scenes; full output path `dist/apps/ptah-electron-e2e/recordings/<scene>/out/<scene>.mp4`; raw capture location). |
| 9. Brand | The `brand.config.ts` re-skin contract `:57–59` is untouched — it is a contract, not a hardcoded brand. |
| Otherwise | Architecture diagram, engine-units table, golden rule, camera grammar, porting section and reference index already met the rubric. Only the Quick-commands duplication was cut. |

Frontmatter description unchanged. Packaged dir and `.claude/skills/video-showcase` are
byte-identical after the edit.

## KB before/after (all 7, `wc -c` semantics, decimal KB)

| Skill | SKILL.md before | SKILL.md after | Dir before | Dir after |
| --- | ---: | ---: | ---: | ---: |
| composition-patterns | 2,967 B / 83 ln | 2,099 B / 52 ln | 23,726 B | 22,858 B |
| react-best-practices | 6,376 B / 137 ln | 5,611 B / 108 ln | 87,395 B | 86,630 B |
| react-nx-patterns | 12,077 B / 384 ln | 5,267 B / 97 ln | 34,759 B | 31,682 B |
| dotnet-solution-architect | 11,365 B / 176 ln | 8,683 B / 82 ln | 20,845 B | 18,163 B |
| dotnet-solution-initializer | 14,470 B / 179 ln | 12,674 B / 149 ln | 14,470 B | 12,674 B |
| nx-dotnet-workspace | 11,625 B / 117 ln | 9,912 B / 100 ln | 11,625 B | 9,912 B |
| video-showcase | 5,546 B / 73 ln | 5,258 B / 58 ln | 57,824 B | 57,536 B |
| **Total** | **64,426 B** | **45,504 B** | **250,944 B** | **239,455 B** |

Trigger-time (SKILL.md) reduction: 18,922 B (−29.4%). Whole-directory reduction:
11,489 B (−4.6%) — react-nx-patterns shrank even though content moved into two new
references, because the moved code examples were cut as duplicates of the existing
references rather than re-homed.

New/moved files in react-nx-patterns:

| File | Size | Origin |
| --- | ---: | --- |
| `references/module-boundaries.md` | 1,712 B | SKILL.md `:231–277` + `:329–343` |
| `references/workspace-setup.md` | 1,515 B | SKILL.md `:279–327` |
| `references/server-components.md` | +506 B (9,522 → 10,028) | SKILL.md `:345–363` appended as "App Router Integration" |

## Checks

- `diff -r` packaged vs `.claude` copy (video-showcase, the only copy that exists): exit 0, byte-identical. The other six skills have no `.claude/skills/` copies.
- Every path named in each edited SKILL.md (markdown links and backticked paths) exists. The one checker report was a false positive — the link text `references/roadmap-format.md` inside the `../saas-workspace-initializer/references/roadmap-format.md` link, whose target resolves in the flat sibling layout (ptah-nx-saas plugin).
- `npx jest -c libs/backend/harness-sync/jest.config.ts --coverage=false --maxWorkers=2 skill-sibling-links`: 1 suite passed, 11 tests passed.
- Representative routing after the trim: a react "where does this component go" question loads the react-nx-patterns entry (type table, domain tree, decision matrix) and routes boundary wiring to `references/module-boundaries.md`; a "write a client component" question routes to `references/client-components.md`, which retains the complete presentational-rules and client-state teaching. Step a2 in dotnet-solution-initializer still routes to dotnet-solution-architect, whose layout reference retains both worked layouts in full.

## Decisions

- The rule rosters in react-best-practices and composition-patterns stay: they are the reference index with a load condition per rule, and no runtime command can list `rules/` files. Rubric rule 7 only bans rosters that discovery supplies.
- react-nx-patterns: the partial structure subtrees inside the two pattern references (feature-lib view in server-components.md, ui-lib view in client-components.md) were left untouched; they are per-topic views that keep each reference self-contained, while the entry tree remains the single home of the overall layout.
- dotnet-solution-architect: the per-shape layout trees now live only in the comparison reference. Because Step a2 always derives a layout, the entry states an explicit load condition on that reference ("load it whenever a layout is being derived"), keeping it one level deep.
- nx-dotnet-workspace: the `@nx-dotnet/core` archived-package warning and the EXPERIMENTAL warning stay in full — both prevent wrong recommendations, so they are current contracts, not history.
- video-showcase: the `brand.config.ts` contract and the porting kit are untouched per the task note.
- No `## Requires` sections existed in any of the seven skills; none were added or changed (batch 3 owns them).
- Nothing outside the 7 skill dirs (plus this file) was edited; the ptah-nx-saas skills the parallel lane owns were not touched, and cross-links into them still resolve.