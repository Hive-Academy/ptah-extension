# Implementation Plan - TASK_2026_713_e067

## Revision

Round 1 review (`implementation-plan-review.md`) returned REVISE. This document replaces the operative contract. The previous nine-versus-nineteen split, the catalogue-as-assignment clauses, the unconditional continue-after-denial clauses, the exclusive routing matrix, the byte-exact retained-description pins, and the instruction to delete the whole `ptah-cli-usage` "When to use" section are withdrawn. Scope is unchanged: shipped plugin descriptions, the shared tooling partial, directly related specs, and the generated manifest. No runtime policy, discovery, local skill copies, or generated agents.

### Dispositions

| Review item | Tag | Disposition |
| --- | --- | --- |
| P1 catalogue name is not an assignment | Project-rule (rubric 8) | Accepted. Clauses below separate an explicit assignment from a catalogue entry. Both assigned and description-matched skills stay subject to host availability and role access. Name recognition is still not loading. The guard spec locks the relevance and permission sentences, not only the first loading sentence. |
| P1 denial is not permission to continue the denied work | Project-rule (rubric 8) plus shipped prerequisite text | Accepted. A denied load forbids another path, reconstructed instructions, and the denied action. Optional absence continues only independent permitted work. A prerequisite the task or a loaded skill marks as required stops that dependent work and is reported on the channel the role already uses. Three outcomes are specified and tested. No runtime policy code. |
| P2 nine-versus-nineteen audit | Evidence correction | Accepted. The claim that nineteen descriptions already have a "Not for" or command gate was false (`video-showcase` and `nestjs-deployment` are positive-only). Per-skill dispositions are in Component 1. Eight descriptions change. Twenty stay. No universal "Not for" phrase. `skill-creator` leaves the edit set. |
| P2 exclusive routing matrix | Evidence correction | Accepted. The matrix is primary / required supporting / optional compatible / irrelevant. `tribunal` requires `agent-lanes`. Orchestration may select lane mechanics. Angular scene skills include motion. Ambiguous rows stay ambiguous. Class S, Class R, and Class L stay separate. |
| P2 `ptah-cli-usage` body deletion | User-requested (preserve capability instructions, `context.md` line 13) | Accepted. Only task-selection prose moves into the description. Stdin-closure and the NDJSON hard rule stay in the body. |
| Suggestion: do not freeze retained description bytes | Lane-proposed constraint removed | Accepted. No byte-exact fixtures for the twenty retained descriptions. Existing shape checks stay. Targeted assertions cover only the edited descriptions and the preserved CLI facts. A diff review shows the retained files were not edited. |
| Suggestion: token and compatibility labels | Constraint retag | Accepted. The substitution guard does not ban every `ptah_*` token. The new section adds none, because this partial is granted to roles that must not receive delegation tools. A new STATIC id remains refused because Electron 0.1.69 / 0.1.70 reject unknown ids, not because the current resolver forbids a file-backed id. |
| Suggestion: exact Jest commands | Project-rule (memory-safe checks) | Accepted. Commands in the handoff use the two existing Jest configs, `--coverage=false`, and `--maxWorkers=2`, one at a time, then `npm run manifest:check`. |

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_713_e067/context.md`, `decisions.md`, `task.md`, and `implementation-plan-review.md`. Authoring rules read from `.claude/skills/skill-creator/SKILL.md` and `.claude/skills/skill-creator/references/prompt-authoring-rubric.md` (rules 1, 2, 8, 9, 10). The shipped skill under `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/skill-creator/` is the product copy. This task does not edit it. The `.claude/skills/` tree stays out of scope.
- Design handoff used: none.
- Missing decision-critical input: `task-description.md` and `research-report.md` are absent. Context, decisions, and the review already fix scope, so those absences do not block a decision.

### Constraint tags

- User-requested: improve implicit, task-shaped selection for every shipped plugin skill under `apps/ptah-extension-vscode/assets/plugins` (Angular is one domain among others); one shared generic skill-use rule in `libs/backend/agent-generation/templates`; preserve setup-wizard placeholders; preserve skill `name` values, directory names, and capability instructions; body edits only to relocate trigger text; regression proof that expanded roles still contain the rule; distinguish static checks, routing evaluation, and real skill loading; no local skill copies, no generated agents, no runtime discovery, prompt, or capability changes.
- Project-rule: heading uniqueness forbids the same H2 in two template sources outside a shared block (`template-sharing.guard.spec.ts` lines 485-495). The check reads template sources, not expanded partial text (lines 491-493), so one new H2 inside `_shared/tooling-precedence.md` does not trip it. `{{SLOT}}` substitution runs only inside an expanded partial, and an undeclared slot fails the load (`template-partial-resolver.ts` lines 355-360). Template bodies must not contain `{{` (`template-sharing.guard.spec.ts` lines 329-346). Shipped skill descriptions are one physical line, at most 400 characters, with at most four double-quoted phrases and no numbered list (`skill-description-shape.spec.ts` lines 17-18 and 86-116). `content-manifest.json` `contentHash` covers plugin files and template files (`scripts/generate-content-manifest.js` lines 170-211). Rubric rule 8: do not load instructions for actions the receiving role cannot invoke (`.claude/skills/skill-creator/references/prompt-authoring-rubric.md` lines 50-53).
- Compatibility evidence, not a current-parser ban: a new `<!-- STATIC:ID -->` on templates published from `main` stops template load on Electron 0.1.69 / 0.1.70 (`template-sharing.guard.spec.ts` lines 1089-1099). Current source accepts a file-backed id that is not in `SHARED_BLOCK_IDS` (`template-partial-resolver.ts` lines 316-350). Do not add `STATIC:SKILL_USE` anyway, because those installed resolvers do not have the fallback.
- Substitution guard, not a blanket token ban: every `ptah_*` token in `tooling-precedence.md` must appear in `PTAH_MCP_SUBSTITUTION_SECTION` (`template-sharing.guard.spec.ts` lines 1038-1056). The file already contains tokens and already passes. The new section adds no `ptah_*` token. Reason: `TOOLING_PRECEDENCE` is granted to `ui-ux-designer` and `visual-reviewer`, which are refused `CLI_DELEGATION` (lines 1014, 1016, 1019-1027, 1073-1080). A generic clause must not name delegation tools those roles are tested to lack.

## Lane-introduced constraints

None remain. Co-locating the rule in the existing tooling partial is the integration decision, not an extra product constraint. The 400-character cap and the manifest hash are existing project rules. Refusing a new STATIC id is the compatibility evidence above. Omitting tool identifiers from the new section is the role-grant evidence above, not a new ban on tokens already in the substitution source.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Verified. Fifteen role templates expand shared blocks from `<!-- STATIC:ID -->` pairs. The bytes between the markers are discarded and replaced. | `libs/backend/agent-generation/src/lib/services/template-partial-resolver.ts` lines 16-35, 67-75; `frontend-developer.template.md` lines 35-40 | A shared rule is the text of a partial an existing marker already expands. It is not copied into fifteen template bodies. |
| Verified. `TOOLING_PRECEDENCE`, `TASK_SPEC_CONTRACT`, and `CLARIFICATION_PROTOCOL` are the only blocks granted to all fifteen roles. | `template-sharing.guard.spec.ts` lines 1001-1017 | The only file-backed partial every role already expands is `_shared/tooling-precedence.md`. |
| Verified. `ui-ux-designer` and `visual-reviewer` do not receive `CLI_DELEGATION`. Resolved bodies must not contain `ptah_agent_list`. | `template-sharing.guard.spec.ts` lines 1014-1027 and 1073-1080 | The shared skill-use rule cannot treat every catalogue entry as allowed work. Access is role-specific even when discovery lists the skill. |
| Verified. Discovery formats every discovered skill as a named list entry and reads one description line. | `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts` lines 78-85 and 100-107 | A host list naming a skill is the normal catalogue, not an assignment. Selection text is the frontmatter description. Do not change this parser. |
| Verified. Tribunal assigns lane mechanics to `agent-lanes` and says not to improvise that skill's rules when it is absent. Orchestration uses CLI lanes and, when `agent-lanes` is absent, continues with subagents only. | `tribunal/SKILL.md` lines 65-68 and 81-86; `orchestration/SKILL.md` lines 3, 134-135, and 213-215 | Composition is real. A missing prerequisite stops the dependent move. Independent permitted work can continue. The generic rule must be able to say both. |
| Verified. Angular 3D scene construction includes motion and animation tuning. | `angular-3d-scene-crafter/SKILL.md` lines 12 and 22 | A description boundary that treats all animation as foreign to this skill contradicts the body. |
| Verified. The CLI "When to use" section mixes triggers with operating facts. The following in-process paragraph and the NDJSON hard rule do not state that the process exits when stdin closes. | `ptah-cli-usage/SKILL.md` lines 8-17, 31-33, and 112-123 | Move only the selection sentences. Keep the stdin-lifetime fact in the body. |
| Verified. Description shape is nonempty, one line, ≤ 400 characters, ≤ 4 double-quoted phrases, no numbered list. It does not check task relevance. | `skill-description-shape.spec.ts` lines 17-18 and 79-116 | Edited lines stay inside that spec. Do not raise 400. The rubric's 1024-character note does not override it. |
| Verified. Twenty-eight `SKILL.md` files ship under the six plugins. Audit dispositions are Component 1. | Inventory below | Edit eight descriptions. Leave twenty. Relocate trigger prose only in `ptah-cli-usage`. |

## Architecture decision

- Chosen approach: add the skill-use contract as a new section of `_shared/tooling-precedence.md`, which every role already expands through `STATIC:TOOLING_PRECEDENCE`. Rewrite the eight shipped descriptions whose current trigger is mention-gated or whose sibling overlap is real and unsettled. Keep compositional boundaries. Relocate only `ptah-cli-usage` selection prose, and keep its operational facts. Extend the two existing specs with targeted assertions. Regenerate `content-manifest.json`.
- Rationale: one home already reaches every generated role without a new block id. Skill selection remains the description string discovery injects. The rule tells the role when a catalogue entry becomes loaded instructions, and when a missing skill stops work, without a new selector.
- Rejected alternatives:
  - New `_shared/skill-use.md` plus `STATIC:SKILL_USE` on all fifteen templates. Right shape once every installed resolver accepts an unknown file-backed id. Wrong shape now: Electron 0.1.69 / 0.1.70 reject unknown ids (`template-sharing.guard.spec.ts` lines 1089-1099) even though current source falls back (`template-partial-resolver.ts` lines 316-350).
  - Inline the rule in fifteen templates. Heading uniqueness fails on a repeated H2, and fifteen copies drift.
  - Append the rule to `CLARIFICATION_PROTOCOL` or `renderTaskSpecAgentBlock`. Those own other contracts and sit outside this edit.
  - Change `plugin-skill-discovery.ts` or session prompts. Context excludes runtime discovery and prompt changes.
  - Encode the routing matrix as hard "Must reject" description lines. That would make `agent-lanes` look irrelevant to Tribunal and orchestration, and would make Angular component guidance look irrelevant to a scene that also moves.
- Assumptions: none that block the plan. Description length is checked by the existing 400-character spec.
- Effect on existing code: one partial grows a section. Eight `SKILL.md` files change frontmatter; one of those also retitles a mixed trigger section and keeps its operating facts. Two specs gain assertions. The manifest hash changes. `SHARED_BLOCK_IDS`, `ROLE_PARTIALS`, `variables` maps, `LLM:` fallbacks, skill `name` fields, directory names, and capability sections stay.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Co-locate skill-use in `tooling-precedence.md`. Do not register a new block id. | New STATIC id; inline fifteen copies; co-locate | Old resolvers reject unknown ids (guard lines 1089-1099). Current resolver would accept a file (resolver lines 316-350). All fifteen roles already grant `TOOLING_PRECEDENCE` (guard lines 1001-1017). | Yes. When installed resolvers all fall back to a `_shared/` file, move the section to `_shared/skill-use.md`, add the id to `SHARED_BLOCK_IDS` and `ROLE_PARTIALS`, and delete it from the tooling partial in the same change. |
| Revise eight descriptions. Retain twenty, including positive-only triggers that are already specific. | Rewrite all twenty-eight; add "Not for" to every skill; keep the old nine | Component 1 audit. `video-showcase/SKILL.md` line 3 and `nestjs-deployment/SKILL.md` line 3 have WHAT and WHEN and no sibling that claims the same task. | Yes |
| Keep `session-handoff` command-gated. | Add implicit "wrap up the session" triggers | `session-handoff/SKILL.md` line 3 limits use to `/session-handoff` from the user or the session-budget banner. | Yes |
| `agent-lanes` is the lane mechanic, not a rival of `orchestration` or `tribunal`. | Hard negative boundaries so each request has one winner | Tribunal lines 65-68 and 81-86 require `agent-lanes`. Orchestration lines 3 and 213-215 include lanes and name `agent-lanes` as required when a lane runs. | Yes |
| Do not raise the 400-character cap. | Raise it toward the rubric's 1024 | `skill-description-shape.spec.ts` line 17. Discovery reads one line (`plugin-skill-discovery.ts` lines 101-107). | Yes, but out of scope |
| Class S text locks, Class R human matrix, no Class L. Do not pin retained description bytes. | Byte-exact fixtures for all retained descriptions; a live model eval | Context excludes runtime discovery. A snapshot of unrelated descriptions is a maintenance constraint the review rejected. | Yes |
| The new section adds no `ptah_*` token. | Name the host tool; copy delegation tool names into the generic rule | Guard lines 1038-1056 allow tokens that exist in the substitution source. Lines 1073-1080 forbid `ptah_agent_list` in two roles that still receive this partial. | Yes |

## Component specifications

### 1. Shipped skill descriptions

- Purpose: the string the host shows before load states what the skill does and which task should select it when the user never names it. Where two skills can both apply, the description says which subject is primary and which sibling is supporting. It does not pretend a required sibling is irrelevant.
- Responsibilities: edit frontmatter `description` only, except the one trigger relocation below. Preserve `name` byte-for-byte and equal to the directory name. Do not add frontmatter fields. Do not edit references, scripts, assets, or capability sections.
- Verified contracts and entry points:
  - Discovery contract: one line matching `^description:\s*(.+)$`, wrapping quotes stripped once (`plugin-skill-discovery.ts` lines 100-107).
  - Shape contract: ≤ 400 characters after unquoting, not a `|` or `>` scalar, ≤ 4 double-quoted phrases, no numbered list (`skill-description-shape.spec.ts` lines 45-116).
  - Rubric inside that cap: third person; WHAT then WHEN; triggers live in the description; a skill may name its own subject; a sibling name is a real `name` value. A "Not for" phrase is used only for a genuine primary-subject exclusion evidenced below. Do not add one to make the corpus uniform.
- Description contract for each revised file, one physical line. Prefer bare sibling names so the four-quote cap stays intact.

| Skill | Disposition and required description change |
| --- | --- |
| `angular-frontend-patterns` | Revise. Line 3 already triggers on Angular components, signals, forms, and routing, and does not say how it sits next to the scene skills or React UI skills. Keep that WHEN as the primary subject. State that `angular-3d-scene-crafter` and `angular-gsap-animation-crafter` are compatible siblings for scene construction and scroll motion, not replacements for component and state guidance. State that React component work belongs to `composition-patterns` and `react-best-practices`. Do not write "not for animation". |
| `angular-3d-scene-crafter` | Revise. Line 3 is already a specific 3D WHEN. The body builds motion and tunes animation (lines 12 and 22), so the description must not exclude animation. Primary subject stays Angular 3D scenes. Scroll-timeline page motion is `angular-gsap-animation-crafter` and may be loaded as well when the task has both. Component structure may load `angular-frontend-patterns` with this skill. Non-Angular 3D work is outside this skill. |
| `angular-gsap-animation-crafter` | Revise. Line 3 is already scroll, parallax, and timeline WHEN for `@hive-academy/angular-gsap`. Primary subject stays that motion. A 3D scene is `angular-3d-scene-crafter` and may be loaded as well when the task has both. Component structure may load `angular-frontend-patterns`. Non-Angular animation is outside this skill. |
| `agent-lanes` | Revise. Line 3 triggers only on `ptah_agent_spawn` or a referral from the other two skills, so a task that asks to spawn or resume a lane without those words does not match. Add that implicit WHEN. Say this skill is the mechanic `orchestration` and `tribunal` load for lane work, not a substitute for the engineering workflow or for a multi-vendor panel. Do not say those skills reject a lane request. The new description must not add a `ptah_*` token beyond names that must stay to preserve the existing "load before spawn" case; if the line cannot fit the tool name inside 400 characters and four quotes, keep the existing tool-name case by referring to "the host's lane-spawn tool" only if the capability is still recognisable. Prefer keeping the existing tool-name case and cutting mention-only wording. Count quotes before landing the line. |
| `resilient-nestjs-patterns` | Revise. Line 3's WHEN includes splitting a service and layering controller, service, and db service, which overlaps `nestjs-backend-patterns` (line 3: persistence, auth, RBAC, repositories). That sibling already sends retries, events, and dynamic modules here. Inbound webhook plumbing is `webhook-architecture` line 3. Keep the resilience WHEN. Add those two primary-subject boundaries. A task that both persists and retries may load both skills; the description assigns the primary subject, it does not forbid the second skill. |
| `ddd-architecture` | Revise. Line 3 triggers on bounded contexts, aggregates, and domain events with no sibling gate. `dotnet-solution-architect` line 3 derives .NET project layout from bounded contexts. Add that boundary only: .NET project and solution layout is the dotnet skill. Do not add a Nest module-wiring boundary. `nestjs-backend-patterns` does not claim domain modelling, so that boundary was unevidenced. |
| `ptah-surface-authoring` | Revise. Line 3 leads with WHEN and buries WHAT. Lead with authoring `ptah-ui` blocks the host renders from verified data. Keep the existing WHEN list (turn summary, stats, file changes, test results, chart, usage, plan limits in Ptah chat or the display panel). Primary subject is that block. Marketing copy is `technical-content-writer`. A visual-system spec is `ui-ux-designer`. Those siblings may still apply when the task asks for copy or a design system as well as a block. |
| `ptah-cli-usage` | Revise the description and relocate selection prose only. Line 3 triggers on the user mentioning command names, while lines 12-16 already hold the implicit WHEN: headless, CI, another process, no clickable UI. Put that WHEN in the description and drop mention-only command lists until the line is ≤ 400 characters. Do not put "exits when stdin closes" only in the description. |

- Body relocation, `ptah-cli-usage/SKILL.md` only:
  - Lines 12-16's selection sentences ("Reach for it whenever…", "If a human needs to click…") move into the description in shortened form.
  - Keep in the body, under the surface table's section: the process speaks JSON-RPC 2.0 NDJSON over stdio, has no clickable UI, and exits when stdin closes (today at lines 10-17). Retitle `## When to use this skill` so the heading is no longer a when-to-use section. A title such as `## Which surface` matches the table that follows.
  - Do not duplicate the NDJSON hard rule at lines 112-123. That section remains the home of the stdout invariant. The stdin-lifetime sentence is not in that section and is not in lines 31-33, so it stays next to the surface table.
  - Do not delete command rows, install steps, or hard rules.
- Retain these descriptions with no edit. Each row is the trigger and the overlap finding that justifies leaving it.

| Skill | Why it stays |
| --- | --- |
| `composition-patterns` | React component-API WHEN, and performance is deferred to `react-best-practices` (line 3). |
| `dotnet-solution-architect` | .NET project-layout WHEN, and workspace init is deferred to `dotnet-solution-initializer` (line 3). The bounded-context overlap is settled by editing `ddd-architecture`, not this line. |
| `dotnet-solution-initializer` | New .NET workspace WHEN, Nx setup deferred, NestJS/Angular/React SaaS deferred (line 3). |
| `humanize-library` | Path-scoped cleanup WHEN, and new features or bug fixes are excluded (line 3). |
| `nestjs-backend-patterns` | Persistence, auth, RBAC, and repositories, with retries deferred to `resilient-nestjs-patterns` (line 3). |
| `nestjs-deployment` | Production container and deploy WHEN (line 3). No sibling claims Docker, health checks, or cloud deploy. A positive trigger is enough. Do not add a "Not for" line. |
| `nx-dotnet-workspace` | Adding Nx to a .NET repo, with JavaScript library layout deferred (line 3). |
| `nx-workspace-architect` | Angular and NestJS Nx layout, with React and .NET deferred (line 3). |
| `orchestration` | Default engineering workflow, including CLI lanes, with multi-vendor panels deferred to `tribunal` (line 3). Lane mechanics stay a required supporting skill in the body (lines 213-215). Do not add a line that rejects `agent-lanes`. |
| `react-best-practices` | React and Next.js performance WHEN, with component API deferred to `composition-patterns` (line 3). |
| `react-nx-patterns` | React or Next.js in Nx, with Angular and NestJS deferred (line 3). |
| `saas-platform-patterns` | Monetization and subscription WHEN, with webhook plumbing deferred (line 3). |
| `saas-workspace-initializer` | New Nx/NestJS SaaS workspace WHEN, with .NET deferred (line 3). |
| `session-handoff` | Command gate only: `/session-handoff` from the user or the budget banner (line 3). Do not add an implicit wrap-up trigger. |
| `skill-creator` | Create or update a skill (line 3). No sibling description claims skill authoring. A "not for the user's product task" line is not an evidenced overlap. Retain. |
| `technical-content-writer` | Marketing and technical copy WHEN, with visual design deferred (line 3). |
| `tribunal` | Multi-vendor second opinion WHEN, and the default build workflow is deferred to `orchestration` (line 3). The body requires `agent-lanes` (lines 81-84). Do not add a line that rejects `agent-lanes`. |
| `ui-ux-designer` | Visual specification WHEN, with copy deferred (line 3). |
| `video-showcase` | Narrated product walkthrough WHEN, including capture and render (line 3). No sibling owns that pipeline. A positive trigger is enough. Do not add a "Not for" line. |
| `webhook-architecture` | Inbound webhook WHEN, with billing deferred to `saas-platform-patterns` (line 3). |

- Dependencies: none into runtime libraries. The existing discovery helper consumes the description unchanged.
- Integration points: `formatSkillsForPrompt` prints `skillName` plus `description` (`plugin-skill-discovery.ts` lines 78-85). Sibling names in a description are the directory `name` values.
- Failure behaviour: a description that exceeds 400 characters, wraps, or adds a fifth double-quoted phrase fails `skill-description-shape.spec.ts`. Shorten the line. Do not change the cap. A `name` change is a failed edit.
- Quality requirements: no repository path, Nx layout, or "this monorepo" assumption in an edited description. Capability steps in bodies stay.
- Verification seam: shape spec plus the Class S assertions in Component 3. That seam proves the text discovery would read. It does not prove a model selected the skill, and it does not prove a skill loaded.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-frontend-patterns/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-3d-scene-crafter/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ddd-architecture/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-nx-saas/skills/resilient-nestjs-patterns/SKILL.md`

### 2. Shared skill-use contract

- Purpose: one generic instruction, present in every generated role, that says when to load a skill, when a listed name is only a candidate, and what to do when a load is denied, optional, or a required prerequisite.
- Responsibilities: add one section to the tooling partial. Do not add a marker, a block id, a role grant, or a per-role variant. Do not edit the fifteen `*.template.md` files. Do not edit `_shared/clarification-protocol.md`, `_shared/engineering-hygiene.md`, or any `LLM:` fallback.
- Verified contracts and entry points:
  - Expansion replaces the marker interior with the partial file (`template-partial-resolver.ts` lines 16-19). Empty pairs already point at this file (`frontend-developer.template.md` lines 35-36).
  - After expansion, `OrchestratorService.buildAgentFileContent` strips marker lines and emits the expanded body (`orchestrator.service.ts` lines 1164-1176).
  - Slot fill is a single pass over the expanded block (`template-partial-resolver.ts` lines 355-367). The new section must contain no `{{`.
  - The partial is on every role, including the two roles that must not receive CLI delegation (`template-sharing.guard.spec.ts` lines 1014-1016 and 1073-1080).
- Required clauses, in this partial and nowhere else. Wording may be tightened to fit the file's voice. The propositions may not be weakened.
  1. An assignment is a skill the task, this role's own instructions, or an already loaded skill names as work to do. Load each assigned skill that the host currently lists and that this role is allowed to use, before doing that work. A name in the host catalogue is a candidate, not an assignment and not loaded instructions. Seeing or repeating a name is not loading the skill.
  2. When the task assigns none, select from the host's catalogue only skills whose descriptions match the task and the repository's own evidence, and that this role is allowed to use. Do not load a skill because the catalogue lists it, because this product's repository uses that stack, or because the role recognises the name. Do not name frameworks one by one in this clause.
  3. Load through the host's skill-loading tool when that tool is listed for this role. Do not recite an unloaded skill from memory and do not reconstruct its steps.
  4. Access policy still applies after a match. A load that is denied, or an action this role's instructions forbid, is not permission to use another path, reconstruct the instructions, or perform the denied action. Report the skill name and the denial. Continue only work that does not depend on that skill and that this role is still allowed to do.
  5. When an optional skill is absent or its load fails for a reason other than denial, say so and continue the independent work the repository's instruction files already permit. Do not invent that skill's steps.
  6. When the task, or a skill already loaded, makes the missing skill mandatory for a piece of work, stop that dependent work. Report the skill name and the limitation through the channel this role already uses for a blocked step. Do not improvise the missing skill's rules. Independent permitted work may continue.
  7. The skill body remains the home of its rules. Do not copy those rules into the role file.
- The section is generic. It does not name a role, a wizard slot, a plugin id, a framework, or a `ptah_*` tool. It does not say "continue without that skill" as a single outcome for denial, absence, and a missing prerequisite.
- The shipped skills that this generic rule must remain compatible with, without naming them in the partial: Tribunal stops a move when `agent-lanes` is missing and forbids improvising (`tribunal/SKILL.md` lines 81-86). Orchestration continues on subagents when lanes cannot run (`orchestration/SKILL.md` lines 213-215). The rule defers to whichever loaded skill marked the dependency required. It does not special-case those two skills in the partial text.
- Dependencies: reads as part of `TOOLING_PRECEDENCE`. No new dependency.
- Integration points: all fifteen roles. No RPC, no DI token, no host branch.
- Failure behaviour: a `{{` in the new section fails every template load. A new `ptah_*` token that is absent from the substitution source fails the guard at lines 1038-1056. There is no runtime fallback that drops the section. Old installed resolvers keep working because the marker id does not change; they receive the new sentences only after they download the updated partial.
- Quality requirements: one home. No per-role copy. Wizard `variables` maps and `LLM:` fallbacks byte-stable.
- Verification seam: resolve all fifteen templates and assert the clause propositions below are in every resolved body, are absent from the template sources, and that each template's `CLARIFY_TRIGGER` value still appears with no raw `{{`. Also assert the two non-delegating roles still do not contain `ptah_agent_list` (the existing test) and that their resolved bodies do contain the permission proposition, so the shared rule did not grant them catalogue skills by omission.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/agent-generation/templates/agents/_shared/tooling-precedence.md`

### 3. Regression checks and publish hash

- Purpose: lock the edited description contract and the expanded-role contract, and publish the bytes the download cache serves.
- Responsibilities: extend the two existing specs. Do not add a test project, a model eval, or a browser check. Regenerate the manifest after the content edits. Do not hand-edit `contentHash`. Do not add byte-exact expected strings for the twenty retained descriptions.
- Verified contracts and entry points:
  - Shape spec already walks every shipped `SKILL.md` (`skill-description-shape.spec.ts` lines 34-42).
  - Guard already resolves every template and checks slots (`template-sharing.guard.spec.ts` lines 960-969) and role grants (lines 1065-1080).
  - `npm run manifest:check` compares file lists and `contentHash`, ignoring `generatedAt` (`scripts/generate-content-manifest.js` lines 170-211). `package.json` defines `manifest:generate` and `manifest:check`.
- Static checks to add (Class S). These lock text. They do not prove model selection or a skill load.
  - Each revised description keeps `name` equal to its directory and contains the primary WHEN subject from Component 1. Where Component 1 names a sibling, the description contains that sibling's `name`. `angular-frontend-patterns` contains both scene sibling names and does not contain a phrase that excludes animation as a class. `agent-lanes` does not describe `orchestration` or `tribunal` as skills that must not apply to a lane task.
  - `ptah-cli-usage` has no heading whose normalised text is "when to use this skill". The body still contains the stdin-lifetime fact (the words "exits when stdin closes"), the NDJSON hard-rule heading, and the command table. The description contains a headless or CI trigger that does not depend on the user mentioning a command name.
  - `session-handoff`'s description still limits itself to `/session-handoff`.
  - `video-showcase` and `nestjs-deployment` are not required to gain a "Not for" phrase. Do not snapshot their full strings.
  - No assertion compares a retained description to a frozen copy of today's line. Unchanged files are confirmed by review of the task diff.
  - After `resolveTemplate`, every role's content includes distinctive substrings of clauses 1, 4, 5, and 6: catalogue name is not an assignment; a denied load is not another path and is not permission to perform the denied action; an optional miss continues independent permitted work; a required miss stops the dependent work. The fifteen template source files do not contain those substrings. Resolved content contains no `{{`. Each file's frontmatter `CLARIFY_TRIGGER` value is present. `ROLE_PARTIALS` is unchanged. The new section of `tooling-precedence.md` matches no `\bptah_[a-z_]+\b`.
  - `ui-ux-designer` and `visual-reviewer` resolved bodies contain the permission substring and still do not contain `ptah_agent_list`.
- Routing evaluation (Class R): a human reads the matrix below against the finished descriptions and the full set of twenty-eight descriptions, not only the edited eight. Record the outcome in the review. A pass is not a Jest result and is not evidence a model will pick the skill.
  - Columns: primary selection, required supporting skill, optional compatible skill, irrelevant skill.
  - A row passes when the primary description matches, a required supporting skill is one the primary's body or description already demands, an optional skill is compatible rather than rejected, and an irrelevant skill's description does not claim that request.
  - Do not require the irrelevant column to "reject" a skill that the primary skill loads. If two primaries both fit, mark the row ambiguous and do not force a winner.
  - Class L, actual skill loading, is out of scope. No test may claim a skill tool ran.

| Request shape | Primary | Required supporting | Optional compatible | Irrelevant |
| --- | --- | --- | --- | --- |
| Build an Angular form with signals. The user never names a skill. | `angular-frontend-patterns` | none | none | `composition-patterns`, `react-best-practices`. Scene skills are irrelevant unless the form is a 3D scene or a scroll sequence. |
| Scroll-triggered Angular hero, no 3D scene, no skill name. | `angular-gsap-animation-crafter` | none | `angular-frontend-patterns` for the hosting component | `angular-3d-scene-crafter` for this request, because the request is not a 3D scene. Not a ban on using both when a later request has both. |
| Neon particle Angular 3D hero, no skill name. | `angular-3d-scene-crafter` | none | `angular-frontend-patterns`. Motion inside the scene stays inside this skill (body lines 12 and 22). | `angular-gsap-animation-crafter` unless the request also asks for scroll-timeline page motion. |
| Spawn a background CLI lane and resume it. The user does not name a workflow. | `agent-lanes` | none | `orchestration` when the same request is also an engineering workflow that uses a lane | `tribunal`, unless the request is a multi-vendor panel |
| Run Ptah headless in CI. The user does not say "ptah cli". | `ptah-cli-usage` | none | none | `session-handoff` |
| Nest service retry and fallback. | `resilient-nestjs-patterns` | none | `nestjs-backend-patterns` when the same change also touches persistence or auth | `webhook-architecture` unless the subject is an inbound webhook |
| Prisma repository and RBAC in Nest. | `nestjs-backend-patterns` | none | `resilient-nestjs-patterns` only when the task also asks for retries, events, or dynamic modules | `resilient-nestjs-patterns` for a persistence-only reading of this request |
| Inbound webhook signature. | `webhook-architecture` | none | `resilient-nestjs-patterns` when delivery recovery is also in scope. The webhook skill already covers failed-delivery recovery, so resilience is optional, not required. | `saas-platform-patterns` for signature verification. Billing remains that skill's subject. |
| Bounded contexts and aggregates, and the request is not a .NET project layout. | `ddd-architecture` | none | none | `dotnet-solution-architect` for this request. If the request also asks for .NET project layout, that skill becomes supporting or a second primary. Do not describe `ddd-architecture` as rejecting .NET domain work. |
| New .NET solution layout. | Ambiguous. `dotnet-solution-architect` is primary for layout of a solution. `dotnet-solution-initializer` is primary for bootstrapping a new workspace. Record both. Do not pick a single winner. | none | `nx-dotnet-workspace` when the request also adds Nx | `saas-workspace-initializer` |
| React component API with boolean props. | `composition-patterns` | none | `react-best-practices` only when the task also asks about re-renders or bundle size | `angular-frontend-patterns`. `react-best-practices` is irrelevant for an API-only reading because its description defers API design. |
| React Nx library boundaries. | `react-nx-patterns` | none | none | `nx-workspace-architect` (its description defers React) |
| Show a chart of test results in Ptah chat. | `ptah-surface-authoring` | none | `ui-ux-designer` only when the task also asks for a visual system | `technical-content-writer` for a data block. Copy remains that skill's subject. |
| React page re-render. | `react-best-practices` | none | none | `angular-frontend-patterns`, `composition-patterns` for a performance-only reading |
| Start a new NestJS SaaS workspace. | `saas-workspace-initializer` | none | `nx-workspace-architect` when the scaffold also sets library boundaries | `dotnet-solution-initializer`, `angular-frontend-patterns` as the bootstrap skill |
| Add Nx to an existing .NET repo. | `nx-dotnet-workspace` | none | `dotnet-solution-architect` when the project layout is also being changed | `nx-workspace-architect` |
| Second opinion from another vendor. | `tribunal` | `agent-lanes` (Tribunal lines 81-84). The row fails if `agent-lanes` is marked irrelevant. | none | `orchestration` as the primary workflow. Orchestration remains the skill Tribunal names for Relay, which this request is not. |
| User says wrap up, and does not run `/session-handoff`. | none | none | none | `session-handoff` stays command-gated. `ptah-cli-usage` does not claim session wrap-up. |
| Write the landing-page copy. | `technical-content-writer` | none | `ui-ux-designer` when the task also asks for a visual spec | `ptah-surface-authoring` unless the deliverable is a `ptah-ui` block |
| Apply Angular component patterns in a repository whose evidence is React only. | none of the Angular skills | none | the React skill whose description matches the actual React task | `angular-frontend-patterns`, because the repository evidence does not match its Angular WHEN. This is description match plus repository evidence, not a framework list in the role rule. |

- Dependencies: specs read the files under test. They do not import a new production symbol.
- Integration points: CI already runs the shape spec with `@ptah-extension/vscode-lm-tools` and the guard with `@ptah-extension/agent-generation`. `manifest:check` is the publish gate. Regenerating the manifest does not publish and does not authorise a push.
- Failure behaviour: a stale hash fails `manifest:check` (`generate-content-manifest.js` lines 206-210). A missing partial proposition fails the guard. There is no retry.
- Quality requirements: tests assert phrase presence, placeholder expansion, and name stability. They do not assert a coverage percentage and do not snapshot unrelated descriptions.
- Verification seam: the two specs and `manifest:check`.
- Files:
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts`
  - MODIFY `D:/projects/ptah-extension/.claude-worktrees/skill-routing/content-manifest.json` by `npm run manifest:generate` only

## Integration architecture

- Data flow: author edits eight `SKILL.md` descriptions, the `ptah-cli-usage` selection section, and `tooling-precedence.md`. `manifest:generate` rewrites `contentHash` over `plugins.files` and `templates.files`. An installed app downloads those paths into the plugin directory and `~/.ptah/templates/agents/`. `loadTemplateFromDisk` expands `TOOLING_PRECEDENCE` before any LLM pass. `buildAgentFileContent` strips markers and writes the role. Separately, `discoverPluginSkills` reads the new description line when a prompt lists skills. The two flows share no code. Description quality does not insert the skill-use rule, and the skill-use rule does not select a skill.
- State or persistence: the downloaded template cache and the plugin files. No new stored field. Wizard `variables` stay the slot source. Generated agents under a user workspace are not written by this task.
- External boundaries: descriptions are trusted repository content, not end-user input. No new network call. The manifest `baseUrl` stays `https://raw.githubusercontent.com/Hive-Academy/ptah-extension/main`.
- Failure and rollback: a bad description fails the shape spec before publish. A bad partial fails the guard and, if published, fails template load on slot errors. Rollback is reverting the content files and regenerating the manifest. There is no compatibility shim.
- Observability: template load already returns `TemplateError` with the block id (`template-partial-resolver.ts` lines 342-349). No new log line. A blocked skill is reported by the role in its reply, which is clauses 4 and 6, not a new metric.

## Architecture-level quality requirements

- Functional: each revised description states WHAT and a task-shaped WHEN inside 400 characters, plus only the sibling relation Component 1 requires. All fifteen resolved roles contain clauses 1 through 7. Wizard placeholders still expand. Skill `name` values are unchanged. The twenty retained descriptions are unchanged. Capability sections other than the relocated `ptah-cli-usage` selection prose are unchanged, and the stdin-lifetime fact remains in that body.
- Performance: not applicable. No new per-item timer, watcher, or prompt list. The partial is one file read already cached by `TemplatePartialResolver`.
- Security: a denied load is not permission to take another path or to perform the denied action. A missing required skill stops the dependent work. No secrets in descriptions or the partial. The shared rule does not grant `ui-ux-designer` or `visual-reviewer` delegation tools.
- Maintainability: no new block id, no second copy of the rule, no edit under `.claude/skills/`, no edit to generated agents, no change to `plugin-skill-discovery.ts` or skill synthesis. Dependency direction is unchanged. Future skill edits are not coupled to snapshots of unrelated descriptions.
- Testability: Class S is the Jest assertions and `manifest:check`. Class R is a human read of the matrix, recorded as review. Class L is not claimed.

## Out of scope findings

Report only. Do not fix in this task.

- `plugin-skill-discovery.ts` lines 101-107 read a single description line and strip only one leading and one trailing quote. A folded YAML description would not be delivered whole. The shape spec already forbids that shape. Context excludes this delivery path.
- Local copies under `.claude/skills/` can drift from `assets/plugins`. This task does not sync them.
- `orchestration/SKILL.md` lines 213-215 and `tribunal/SKILL.md` lines 81-86 already state prerequisite behaviour. This task does not rewrite those bodies. The generic role rule must not contradict them.

## Team-leader handoff

- Recommended executors: one backend-developer for Component 2 and the guard assertions, because the partial and the resolver contract live in `@ptah-extension/agent-generation`. One backend-developer, or the same person after that, for Component 1 and the shape-spec assertions. The manifest regeneration goes with whichever of those lands second. No frontend, Electron, or VS Code executor. The files sit under the extension assets tree and are content, not a VS Code feature.
- Complexity: MEDIUM. The text is small. The blast radius is the published manifest and every generated role. The 400-character cap and the composition wording are the easy places to get the eight descriptions wrong.
- Dependencies and ordering: Components 1 and 2 are file-disjoint and can proceed together. Component 3's spec edits depend on the final sentences and description lines. `manifest:generate` runs after those files are saved, then `manifest:check`.
- Parallel-safe work: the eight `SKILL.md` files are disjoint from `_shared/tooling-precedence.md`. The two spec files are disjoint from each other. `content-manifest.json` is not parallel with either content edit.
- Files affected:
  - MODIFY: the eight `SKILL.md` paths in Component 1; `libs/backend/agent-generation/templates/agents/_shared/tooling-precedence.md`; `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts`; `libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts`; `content-manifest.json`.
  - CREATE: none.
  - REWRITE: none.
- Verification points:
  - Names, directory names, and `ROLE_PARTIALS` unchanged.
  - No new `{{` in `tooling-precedence.md`. The new section adds no `ptah_*` token.
  - `CLARIFY_*` frontmatter values still appear after resolve. `LLM:` fallbacks untouched.
  - Class S assertions for the eight descriptions, the CLI stdin-lifetime fact, the command gate on `session-handoff`, and the four role-rule outcomes. No frozen strings for the twenty retained descriptions.
  - Class R is a review of the matrix, including the ambiguous .NET row and the required `agent-lanes` support on the Tribunal row. Record it as review, not as a passing test.
  - Class L is not run.
  - Commands, one at a time, changed projects only. Both Jest configs exist (`libs/backend/agent-generation/jest.config.ts`, `libs/backend/vscode-lm-tools/jest.config.ts`).
    - `npx jest -c libs/backend/agent-generation/jest.config.ts libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts --coverage=false --maxWorkers=2`
    - `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts --coverage=false --maxWorkers=2`
    - `npm run manifest:check`
  - No workspace-wide test, build, serve, dev, e2e, or package. This planning revision ran no checks.
