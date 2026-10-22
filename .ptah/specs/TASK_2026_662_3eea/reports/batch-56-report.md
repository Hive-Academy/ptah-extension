# Batch 56 report

## Files changed

| File | Change |
| --- | --- |
| `apps/ptah-docs/src/content/docs/mcp-and-skills/skills.md` | Replaced automatic discovery, promotion, and candidate review with a short Skills Library description and link. |
| `apps/ptah-docs/src/content/docs/reference/file-locations.md` | Removed the obsolete auto-promoted skills path. Described the user-layer copies, their history and origin files, and retained SQLite grade and use data. |
| `apps/ptah-docs/src/content/docs/index.mdx` | Replaced the Skill Synthesis card with a Skills Library card. |
| `apps/ptah-docs/src/content/docs/cli/commands.md` | Removed the retired `ptah skill-synthesis` row and corrected the group count. Kept `ptah skill` and `ptah plugin skills`. |

## Claim to source file

| Changed claim | Source file |
| --- | --- |
| Thoth Skills manages user-layer copies of skills, agents, and commands. | `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` |
| Library copies support editing, history, revert, rebase, and keep. | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`; `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` |
| Manual enhancement offers a preview before applying a proposal. | `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`; `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts` |
| The user layer has skills, agents, and commands roots; skill bodies use `skills/<slug>/SKILL.md`. | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts` |
| The user layer stores `.history/` snapshots and origin sidecars. | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts`; `libs/backend/agent-generation/src/lib/services/user-layer/origin-sidecar.types.ts` |
| The Ptah SQLite database holds task-review grades and skill invocation events. | `libs/backend/persistence-sqlite/src/lib/migrations/0056_skill_nullable_grades.ts`; `libs/backend/persistence-sqlite/src/lib/migrations/0021_skill_invocation_events.ts`; `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts` |
| `ptah skill` and `ptah plugin skills` remain; `ptah skill-synthesis` is removed. | `apps/ptah-cli/src/cli/router.ts`; `.ptah/specs/TASK_2026_662_3eea/reports/batch-30-report.md` |

## Decisions

- Kept the remaining page content as written and removed only claims tied to the retired pipeline.
- Kept `skillSynthesis.enabled` in the settings-path row because it is still the Skills Library pause switch (`apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`; `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`).
- Did not document pipeline tables as current data. The file-locations page names only retained grades and invocation events.
- Followed the instruction to use read-only inspection only; no formatter, build, serve, or test was run.

## Clarifications Needed

None.
