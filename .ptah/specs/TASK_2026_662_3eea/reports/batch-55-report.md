# Batch 55 report

## Files changed

| File | Change |
| --- | --- |
| `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md` | Replaced removed pipeline settings with the two Library switches and the manual enhancement provider, model, and timeout keys. |
| `apps/ptah-docs/src/content/docs/skill-synthesis/the-skills-tab.mdx` | Replaced the five old subviews and candidate housekeeping with Library cards, editing, divergence, history, enhancement, grades, and switches. |
| `apps/ptah-docs/src/content/docs/skill-synthesis/skill-md-anatomy.mdx` | Described a user-layer skill file and removed generated-skill provenance and candidate claims. |
| `apps/ptah-docs/astro.config.mjs` | Removed the two sidebar links to retired Background Learning and Reviewing Candidates topics. Other sidebar entries were left intact. |

## Claim to source file

| Claim in pages | Source file |
| --- | --- |
| The Skills tab shows the Library in desktop, a desktop notice in VS Code, and separate Skills and telemetry switches. | `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`; `libs/frontend/skill-synthesis-ui/src/lib/components/skills-pause-switch.component.ts` |
| The Skills switch uses `skillSynthesis.enabled`; telemetry uses `skills.telemetry.enabled` and defaults to on. | `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`; `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` |
| The Library shows user-layer copies of skills, agents, and commands. Skill files live under `~/.ptah/user/skills/<slug>/SKILL.md`. | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`; `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` |
| Cards and drawers support editing, history, revert, rebase, and keep. | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` |
| Manual enhancement has usage and cooldown gates, a preview, and a snapshot on apply; pause blocks it. | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`; `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts`; `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts` |
| Success uses graded task reviews in the current workspace and shows No grade when none exist. | `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts`; `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts`; `libs/frontend/skill-synthesis-ui/src/lib/components/clones/clone-action-gating.ts` |
| Manual enhancement reads `skills.enhancement.provider`, `.model`, and `.timeoutMs`; the controls are in Agent Orchestration's Background models section. | `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`; `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts`; `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts` |
| The remaining settings are file-based keys in `~/.ptah/settings.json`. | `libs/backend/platform-core/src/file-settings-keys.ts` |
| `SKILL.md` uses frontmatter with `name` and `description` and a Markdown body. | `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`; `apps/ptah-docs/src/content/docs/mcp-and-skills/skills.md` |

## Decisions

- Removed the two retired-topic sidebar entries. The rewritten pages remain available at their existing URLs.
- Kept the other sidebar entries byte-identical, including the existing section title.
- Documented only the remaining settings. The settings registry still contains old pipeline keys pending the later removal batch, so this report follows the requested shipped target behavior.
- Did not run formatting, build, or other checks, as instructed. Used read and search commands to review the edits.

## Clarifications Needed

None.
