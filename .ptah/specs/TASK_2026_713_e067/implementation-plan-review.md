# Implementation Plan Review — TASK_2026_713_e067

## Verdict: APPROVED

**Approval scope:** revised implementation plan only, for decomposition and implementation within the agreed boundary. This is not approval of implemented descriptions, a passing routing evaluation, or proof that any skill actually loaded.

**Execution sides:** author — **grok CLI lane**; independent reviewer — **in-process software-architect**, not the authoring lane. No delegation. The reviewer loaded the scoped skill-creator skill and read its prompt-authoring rubric. Review covered `context.md`, `decisions.md`, both plan versions and concrete source evidence. Revision 1 was read in targeted chunks, including its description contracts, complete corpus audit, generic rule, routing matrix and verification handoff.

All paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/skill-routing/` unless absolute. Plan references identify `.ptah/specs/TASK_2026_713_e067/implementation-plan.md` as currently revised.

## Round record

| Review round | Artifact | Verdict | Result |
| --- | --- | --- | --- |
| Initial review | Original plan: nine revised descriptions / nineteen retained | REVISE | Five blockers: catalogue versus assignment, unsafe unconditional fallback, unsupported corpus-selection rationale, exclusive routing evaluation, and CLI operating-fact removal. Three nonblocking suggestions covered retained-description snapshots, constraint labels, and exact memory-safe test commands. |
| Re-review after revision 1 | Current plan: eight revised descriptions / twenty retained | APPROVED | All five blockers resolved in the operative contract. Suggestions substantially adopted. No new blocking defect found. |

## Prioritized findings — blocker dispositions

### P1 — Catalogue discovery versus assignment: RESOLVED

**Revised plan:** `implementation-plan.md:153-160,180,185-186`.

Clause 1 now explicitly defines assignment and says a catalogue name is only a candidate, not an assignment or loaded instructions. Assigned and description-matched skills are constrained by host availability and role permission. Clause 2 requires task/repository evidence, not recognition of a name or this product's stack. The contract preserves actual loading rather than recitation from memory. Regression requirements include the candidate/assignment and permission propositions for every resolved role, including non-delegating roles.

**Verified source:** `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:78-85` formats named catalogue entries. `libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts:1001-1017,1019-1027,1073-1080` proves that universal tooling text must coexist with restricted role grants. `.claude/skills/skill-creator/references/prompt-authoring-rubric.md:50-53` requires role-gated capabilities.

### P1 — Access-safe missing/blocked prerequisite handling: RESOLVED

**Revised plan:** `implementation-plan.md:157-162,185-186,238`.

The operative rule now distinguishes denial, optional absence/failure, and a mandatory missing prerequisite. Denial is not permission to use another path, reconstruct instructions or perform the denied action. Mandatory absence stops dependent work and is reported through the role's existing blocked-step channel; only independent permitted work can continue. This is prompt content, not a runtime access-policy change. Assertions must preserve these distinct outcomes.

**Verified source:** `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md:65-68,81-86` requires lane mechanics and forbids improvisation if the required skill is missing. Re-read `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md:212-215`: missing `agent-lanes` prevents lanes, while the task may continue with subagents. The revised generic rule can honour both contracts without hardcoding either skill.

### P2 — All-shipped-skills audit and edit selection: RESOLVED

**Revised plan:** `implementation-plan.md:86-127,134-142`.

The audit covers all twenty-eight shipped skills: eight revised and twenty retained. Each retained skill now has a specific task-trigger/overlap justification. The false universal requirement for negative boundaries is withdrawn. Positive-only `video-showcase` and `nestjs-deployment` descriptions are correctly retained for their already-specific subjects. `skill-creator` leaves the edit set because an additional negative boundary lacked evidence. The malformed unchanged-list fragment is gone. `session-handoff` remains command-gated.

**Verified source:** the shipped frontmatter descriptions were checked across the corpus. Particularly relevant examples are `apps/ptah-extension-vscode/assets/plugins/ptah-video/skills/video-showcase/SKILL.md:3`, `apps/ptah-extension-vscode/assets/plugins/ptah-nx-saas/skills/nestjs-deployment/SKILL.md:3`, and `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/skill-creator/SKILL.md:3`. The shape spec supplies syntax/length evidence, not routing relevance: `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts:79-115`.

The plan specifies description requirements rather than final authored strings. Implementers still need to demonstrate the eight finished lines fit the existing cap without dropping their useful WHAT/WHEN or capability scope.

### P2 — Compositional routing and representative evaluation: RESOLVED

**Revised plan:** `implementation-plan.md:90-97,187-214`.

The matrix now distinguishes primary, required supporting, optional compatible and irrelevant skills. Tribunal's lane dependency is explicitly required; orchestration and lane mechanics can compose. Angular component/state guidance can support scene or motion work, and the 3D skill is no longer barred from all animation. The .NET layout/bootstrap ambiguity is retained rather than forcing a false single winner. Positive, negative and overlap requests remain represented, and the human evaluator must consider the entire corpus.

**Verified source:** `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/SKILL.md:65-68,81-86`; `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/SKILL.md:3,212-215`; `apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-3d-scene-crafter/SKILL.md:12,22`. The revised scene/scroll relation is consistent with `apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md:10-14,18-23`.

Class S remains a text lock, Class R a human routing assessment, and Class L actual invocation is not claimed. This is the correct evidence boundary for this task. The matrix is an evaluation prescription, not an already-passing result.

### P2 — CLI operational-fact preservation: RESOLVED

**Revised plan:** `implementation-plan.md:97-103,181,236`.

Only task-selection prose moves. The body explicitly retains JSON-RPC/NDJSON transport, no clickable UI, stdin-closure lifetime, command rows, install steps and hard rules. The retitled surface section is a suitable home for the lifetime fact; the existing NDJSON hard-rule section stays authoritative for stdout. A regression assertion preserves “exits when stdin closes.”

**Verified source:** `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md:10-17,19-33,35-55,112-123`. The previous removal instruction is expressly withdrawn at `implementation-plan.md:5`.

## Constraint tags and source boundary

| Tag / constraint | Re-review result |
| --- | --- |
| **[User-requested]** Audit every shipped skill, not only Angular | Satisfied by eight revise dispositions and twenty retain dispositions with task-shaped reasons. No universal “Not for” requirement remains. |
| **[User-requested]** Generic shared skill-use rule, actual loading, placeholders intact | Satisfied at plan level. One existing partial; no generated agents or local skill copies. Final text must preserve all seven propositions. |
| **[Project-rule]** Existing description guard | Verified at `libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts:17-18,86-115`: ≤400 characters, single-line scalar, quote and numbered-list constraints. No cap increase proposed. |
| **[Compatibility evidence]** Existing shared partial rather than new STATIC id | Correctly tagged. Old-release incompatibility is documented at `libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts:1089-1099`; current file-backed fallback is implemented at `template-partial-resolver.ts:316-350`. Reusing `TOOLING_PRECEDENCE` avoids an installed-resolver update. This review did not run old releases. |
| **[Project-rule]** Wizard variables and LLM fallbacks | Retained. Example variables and markers are at `libs/backend/agent-generation/templates/agents/frontend-developer.template.md:23-40`; slot replacement/failure rules are at `template-partial-resolver.ts:355-410`. Proposed regression uses the existing resolve seam without touching variables or fallbacks. |
| **[Project-rule]** Manifest implications | Regeneration required. `scripts/generate-content-manifest.js:134-155` hashes plugin and template content; `:180-211` checks drift. `package.json:67-68` defines the commands. Regeneration is not publishing, committing or pushing. |
| **[Evidence limit]** Descriptions are not proof of loading | Correctly preserved. `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts:78-107` proves extraction/formatting only. No runtime selector, loader or policy change is proposed. |
| **[Lane-proposed]** Blanket token ban and frozen retained descriptions | Broad restrictions are withdrawn. Avoiding new tool identifiers in the generic partial is a narrow design choice, not the substitution guard's universal contract. No byte-exact retained-description fixtures remain. |
| **[User-requested / project-rule]** Electron first, no VS Code/TUI polish | Satisfied. Extension assets are the shipped content source, not authorization for a host feature. No UI or visual work is proposed. |
| **[Project-rule]** Memory-safe verification | Exact single-spec Jest commands use `--coverage=false --maxWorkers=2`, sequentially, followed by manifest check (`implementation-plan.md:267-271`). No workspace-wide checks or forbidden targets. |

## Nonblocking implementation cautions

1. **Assignment does not need to exclude other relevant support.** Clause 2 currently introduces implicit selection with “When the task assigns none” (`implementation-plan.md:155`). Read this as the unassigned entry case, not a ban on additional relevant, permitted supporting skills once a primary skill is assigned. The plan's composition requirements and clause 1's loaded-skill referrals provide that context. Keeping that meaning explicit when tightening the final prose would avoid an unnecessary either/or interpretation.
2. **Keep the cap focused on useful triggers.** The Angular frontend contract names four siblings as well as existing component/state/form/routing subjects (`implementation-plan.md:90`). Use concise prose and validate the finished line; do not satisfy sibling-name phrase checks at the cost of WHAT/WHEN clarity. The plan correctly leaves this to the existing guard plus human evaluation rather than assuming a finished description fits.
3. **Do not overstate the source audit.** `agent-lanes`' current description already says spawning/resuming/messaging in its WHAT text. Its revision improves the prominence and implicit task framing; it does not repair a proven inability to match such requests. The plan's phrase “does not match” at `implementation-plan.md:93` should be understood as the author's routing-risk assessment, not measured model behaviour.

None of these cautions requires a further architecture revision or expanded implementation scope.

## Handoff and verification limits

Proceed with the three components and the narrow file list in the revised plan. Preserve names, invocation identifiers, capability bodies, current grants, placeholders and existing fallbacks. Conduct the Class R matrix against finished descriptions and record ambiguity honestly; do not mark it passed merely because phrase assertions pass. Do not claim actual skill loading without an observed invocation, which this task does not require.

No tests, diagnostics, builds or other heavy checks were run during either review round. No production files, skill files, templates, manifest, plan, carrier or task state were edited by the reviewer. Only this report was written. No commits, pushes or discard operations occurred.
