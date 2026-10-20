# Batch 54 report

## Pages changed

| Page | Change |
| --- | --- |
| skill-synthesis/index.mdx | Replaced the pipeline overview with the desktop Skills Library, its controls, manual actions, and graded success. |
| skill-synthesis/how-it-works.mdx | Replaced capture and promotion stages with user-layer copies, divergence choices, manual enhancement, history, telemetry, and workspace grades. |
| skill-synthesis/background-learning.mdx | Replaced the removed feature description with a short removal notice and a Library link. |
| skill-synthesis/reviewing-candidates.mdx | Replaced the removed review flow with a short removal notice and a Library link. |

## Claim to source file

| Claim in pages | Source file |
| --- | --- |
| Thoth Skills is the Library for skills, agents, and commands; VS Code shows a desktop notice. | libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts |
| Library lists user-layer copies of shipped skills, agents, and commands. | libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts; libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts |
| Copies can be opened and edited; history bodies, rebase, keep, and save have RPC handlers. | libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts; libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts |
| Diverged copies offer rebase or keep; keep retains content. | libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts; libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts |
| Manual enhancement previews a proposal, applies it with a snapshot, and can revert; action availability depends on usage and cooldown. | libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts; libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts; libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts |
| Skills pause uses skillSynthesis.enabled. | libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts; libs/frontend/skill-synthesis-ui/src/lib/components/skills-pause-switch.component.ts |
| Telemetry uses skills.telemetry.enabled, defaults on, and can record while Skills is paused. | libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts; libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts |
| Grades come from task-folder review files under .ptah/specs and are harvested into the grade store. | libs/backend/skill-synthesis/src/lib/spec-extractor.ts; libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts; libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts |
| Success uses passed/graded for the current workspace; no graded review yields No grade. | libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts; libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts; libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts |
| Background analysis and candidate review/promotion are removed from the Skills tab. | libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts; .ptah/specs/TASK_2026_662_3eea/implementation-plan.md (row 51) |

## Broken links

None introduced. The two retired-topic URLs remain as short pages, and their links to /skill-synthesis/ resolve to the Library page.

## Decisions

- Kept background-learning.mdx and reviewing-candidates.mdx because plan row 51 says rewrite and existing navigation links to both pages.
- Kept the original routes. Used plain MDX frontmatter without unused component imports.
- Scoped page content to current Library behavior and omitted obsolete thresholds, candidate stages, and automatic enhancement.
- Did not run formatting or other checks, as instructed.

## Clarifications Needed

Batch 55 should update astro.config.mjs navigation labels for Background Learning and Reviewing Candidates and rewrite the-skills-tab.mdx, which still describes removed tabs and links to Background Learning. These links resolve, but the surrounding descriptions are stale.
