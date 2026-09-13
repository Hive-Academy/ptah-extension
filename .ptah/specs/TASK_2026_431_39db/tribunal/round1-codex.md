## Position — top recommendation in 2 sentences

Reduce orchestration to a routing prompt backed by small, canonical protocol references; its entry file currently repeats checkpoint, delegation, task-state, and team-leader instructions (`orchestration/SKILL.md:125–402`). Preserve Tribunal as a separate workflow, sharing transport and artifact contracts while retaining its panel selection, critique, and judging rules.

## Top cuts (ranked by savings) — table: file | problem | fix | est. saving KB

Paths below use **P** = `D:/projects/ptah-extension/apps/ptah-extension-vscode/assets/plugins`; **C** = `P/ptah-core/skills`; **O** = `C/orchestration`; **T** = `C/tribunal`; **A** = `D:/projects/ptah-extension/libs/backend/agent-generation/templates/agents`. `r/` means `references/`.

KB means KiB. Semantic savings use approximately **250 tokens/KB**, not measured tokenizer counts. **E** = less entry/spawn context; **R** = less context when references load. Estimates overlap and must not be summed.

| file | problem | fix | est. saving KB |
|---|---|---|---|
| `P/**/*.md`; examples `O/r/agent-catalog.md:82`, `T/r/crucible.md:149` | Wide table padding and long separator runs | Compact table whitespace during distribution. Read-only census found 73.8 KB removable; preserve fenced content. | **73.8 physical**; token benefit much smaller than prose, tokenizer-dependent |
| `O/r/{agent-catalog,checkpoints,strategies,task-tracking,team-leader-modes}.md` | Role profiles repeat matrices (`agent-catalog:7,37,100`); checkpoints repeat presentation/response scaffolds (`checkpoints:157,271`); strategies repeat phase/delegation machinery (`strategies:22,76,108`) | One routing matrix, one checkpoint schema, transition table, canonical artifact contract; strategy files contain only differences | **45–55 R**, ~11–14k tokens |
| `P/ptah-angular/skills/{angular-3d-scene-crafter,angular-gsap-animation-crafter}/SKILL.md` | Both workflows, incremental tutorials, complete components, and simulated conversations load together (`3d:31,251,484,617`; `gsap:21,161,324,408,502`) | Keep workflow selector and library-specific constraints; load one workflow/example on demand; remove scripted dialogue | **25–29 E**, ~6–7k |
| `A/*.template.md` | Method/output/refusal repetition; large report scaffolds (`backend-developer:77,162,199`; `team-leader:159–464`; `technical-content-writer:76–299`) | Compact role contracts and return schemas; load content-type formats selectively | **18–25 E** across the template set, ~4.5–6k |
| `O/r/cli-agent-delegation.md`; `T/{SKILL.md,r/vendor-panel.md,r/relay.md,r/crucible.md}` | Transport, selection cautions, resume explanations and comparison prose recur (`delegation:66–144,324–409`; `relay:62–104,118–143`) | Shared transport contract; Tribunal references contain move-specific differences | **16–22 E/R**, ~4–5.5k |
| `O/SKILL.md:45–402` | 20.4 KB mixes routing with reference-level procedures; clarification loop appears at `:64` and `:241` | Target 5–7 KB total: route, boundaries, required gates, reference load conditions | **17–19 E**, ~4–5k |
| `C/technical-content-writer/{DESIGN-SYSTEM,LANDING-PAGES}.md`; `C/ui-ux-designer/SKILL.md:177` | Mandatory Ptah branding (`writer/SKILL.md:86`), repeated visual tokens (`LANDING-PAGES:17–51`), historical design story | Make brand a project input; retain Ptah only as an optional example; remove duplicated tokens/history | **12–17 E/R**, ~3–4k |
| `C/skill-creator/SKILL.md:11–201,216–348` | Explains skills at length; repeats progressive disclosure through PDF, BigQuery, cloud, DOCX examples | Keep packaging constraints, procedure, one complete example, and the concise-authoring rule at `:31` | **7–10 E**, ~1.8–2.5k |
| `C/ptah-cli-usage/SKILL.md:112–224` | Hard rules recur in “Quick don’ts”; command-family exceptions remain in entry text | Keep protocol invariants once; move family-specific exceptions to existing references | **3–5 E**, ~0.8–1.3k |

The earlier repeated-spawn-example cut is already implemented: `O/r/cli-agent-delegation.md:435–472` now uses one example plus a table. Likewise, `C/ptah-cli-usage/SKILL.md:195–207` already routes to references; its directory size is not its trigger cost.

## Tribunal vs Orchestration repetitions — table: concept | where in tribunal | where in orchestration | single source of truth | fix

Proposed shared files below are new destinations, not existing files.

| concept | where in tribunal | where in orchestration | single source of truth | fix |
|---|---|---|---|---|
| Discovery, addressing, model overrides | `T/r/vendor-panel.md:40–71`; `relay.md:62–80` | `O/r/cli-agent-delegation.md:66–120,411–429` | Shared `cli-runtime.md` | Both link to transport rules; Tribunal retains explicit-panel override and family-spread policy |
| Spawn → poll → read; resume | `vendor-panel.md:73–96`; `relay.md:118–136`; `crucible.md:119–135` | `cli-agent-delegation.md:92–144,324–409`; `O/SKILL.md:350–374` | Shared `cli-runtime.md` | One lifecycle and failure table; moves specify only payload and retry policy |
| Concurrency and cost | `T/SKILL.md:71–74`; `vendor-panel.md:122–126` | `O/SKILL.md:319,366`; delegation `:196–220,56` | Shared runtime default; workflow overrides local | State default once; preserve Council widening and Crucible sequencing |
| Self-contained assignments and deliverables | `relay.md:34,123–133` | `O/SKILL.md:162–194`; delegation `:148–175` | Shared assignment schema | Required objective, ownership, inputs, output destination, evidence; explicitly distinguish stdout from artifact output |
| Task folder, ID, carrier | `relay.md:36–49`; `crucible.md:117,162–171` | `O/SKILL.md:136–160`; `task-tracking.md:28–99,184–213` | Task-spec contract, rendered as a compact shipped reference | Link from both; Relay’s initialization currently omits explicit carrier creation |
| Checkpoints and clarification returns | `relay.md:138–143` | `O/SKILL.md:198–249`; `checkpoints.md:414–470` | Small checkpoint protocol extracted from orchestration | Relay names applicable gates and links; avoid importing the full hierarchy |
| Independent review and revision limits | `crucible.md:57–155` | delegation `:34–62`; `O/SKILL.md:370–372` | Shared minimal review invariant; Crucible owns full judging protocol | Keep orchestration’s lightweight review; reference Crucible for frozen rubric, mentor note, regression stop |

## Authoring rubric — numbered checklist (keep/cut rules) applicable to any skill or subagent prompt

1. **State the behavioral delta.** Keep instructions that change decisions or prevent a specific failure. Cut expertise claims, motivational prose, and textbook explanations (`C/skill-creator/SKILL.md:27–33`).
2. **Keep a compact contract:** trigger, scope, inputs, ownership, method, output, verification, failure exit. The template layering already calls for this (`.ptah/specs/TASK_2026_359/context.md:16–26`).
3. **Route before teaching.** Entry text selects the applicable branch; references teach it. Every link needs a load condition (`skill-creator/SKILL.md:124–126`).
4. **Keep one example per distinct mechanism.** Replace variants differing only in names or task strings with a parameter table (`O/r/cli-agent-delegation.md:435–472`).
5. **Give every rule one owner.** References should point to that rule, not summarize it differently. Retain only essential boundary reminders in independently loaded prompts.
6. **Preserve advanced constraints:** failure semantics, concurrency, ownership, evidence requirements, and stopping conditions. Cut surrounding persuasion (`T/r/crucible.md:75–155`).
7. **Specify output fields, not padded reports.** Keep parser-sensitive labels; make irrelevant sections optional. Avoid forcing duplicate findings into multiple sections (`A/code-logic-reviewer.template.md:147–228`).
8. **Separate reusable method from local facts.** Preserve bounded, evidence-backed LLM sections; exclude version censuses, past-task stories, and foreign brand defaults (`TASK_2026_359/context.md:23–26`).
9. **Measure rendered loading paths.** Budget trigger, selected references, expanded agent, and generated handoff separately. Validate shortened prompts on representative tasks before accepting savings.

## Template findings — bullets

- **Team-leader:** preserve advisory authority, file ownership and review-before-commit gates (`A/team-leader.template.md:56–69,146–153,306–337`). Replace repeated return blocks with a transition schema: **5–7 KB/spawn**.
- **Backend/frontend/devops:** inputs, discovery methods, generic LLM fallbacks and refusals restate conventions (`backend:58–160`; `frontend:58–171`; `devops:55–118`). Retain LLM slots; shorten fallback instructions and repeated prohibitions: **5–7 KB combined**.
- **Logic/style/visual reviewers:** preserve specialist hunt lists; compress report skeletons (`logic:137–228`; `style:133–218`; `visual:173–249`): **3–4 KB combined**. Remove unsupported score-distribution percentages from `_shared/reviewer-stance.md:8–20`: **0.6–0.9 KB per reviewer**, while retaining evidence and severity.
- **PM/architect/tester/researcher/modernization:** preserve acceptance criteria, verified contracts, executed-test evidence and uncertainty. Condense field explanations and repeated summaries (`project-manager:103–195`; `software-architect:136–226`; `senior-tester:121–219`; `researcher-expert:82–133`; `modernization-detector:89–126`): **4–6 KB combined**.
- **Content/UI/video:** writer loads every content format (`technical-content-writer:76–299`): **3–4 KB** avoidable. UI treats the bundled design system as authoritative (`ui-ux-designer:64–65`); make it project-owned. Video’s pipeline-specific instructions belong in its skill (`video-director:50–73`): **0.8–1.2 KB**.
- **Partials:** composition already exists (`libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts:122`). Shorten partials themselves; hoisting alone saves no expanded context. `_shared/cli-delegation.md:13–14` also needs the conditional-resume rule already present in `T/r/vendor-panel.md:96`.

## Tradeoffs / risks

Resolve contradictions before compression: orchestration calls the parent the sole spawner yet permits secondary delegation (`O/SKILL.md:316,335`); its catalog lets developers update task state (`agent-catalog.md:85`) while the template reserves that to team-leader (`A/team-leader.template.md:151–153`).

Cross-skill links must resolve in every installed harness. Moving examples saves trigger context only when they remain selectively loaded; generated partials and report artifacts still incur downstream costs.

## Confidence — high/medium/low + biggest risk

**Medium.** Repetitions and contradictions are directly evidenced; savings are editorial estimates. Biggest risk: shortening independently loaded prompts removes essential constraints unless distribution and representative workflow behavior are verified.