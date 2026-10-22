# Batch 1 report — shared skill-use rule

Headline: Appended one generic `## Skill use` section to the existing tooling partial and locked clauses 1, 4, 5, and 6 in the resolved-role guard.

## Edits

- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/agent-generation/templates/agents/_shared/tooling-precedence.md`
  - Kept `## Working rules` and its table.
  - Appended `## Skill use` with seven bullets. No new marker, block id, or `{{`.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts`
  - Extended `describe('partial resolution')` with one test over all 15 templates.
  - Extended `describe('role grants')`: non-delegating roles must contain the permission substring and still omit `ptah_agent_list`; the new section must be seven bullets and match no `\bptah_[a-z_]+\b`.
  - `ROLE_PARTIALS` was not edited.

No other files. No runtime code, generated roles, or template sources.

## What the section says

Seven bullets, one proposition each:

1. Assignment, host load of each allowed assigned skill, and other relevant permitted supporting skills after a primary. A catalogue name is not an assignment. Seeing a name is not loading.
2. Unassigned entry only: select by description and repository evidence. Do not load from a catalogue listing, from this product's stack, or from name recognition.
3. Load through the host's skill-loading tool when it is listed. Do not recite or reconstruct an unloaded skill.
4. A denied load is not another path and is not permission to perform the denied action, and it is not reconstructed steps. Report the denial. Continue only work that does not depend on that skill.
5. An optional miss continues independent permitted work. Do not invent that skill's steps.
6. A required miss stops the dependent work. Report it on the channel this role already uses for a blocked step. Independent permitted work may continue.
7. The skill body remains the home of its rules. Do not copy those rules into the role file.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| New H2 `## Skill use` on the existing partial | Reuse `## Working rules`; add a STATIC id | Batch 1.1 forbids reusing that heading and adding a marker. Plan lines 144-169. | Yes |
| Third person ("This role") | Imperative "you", matching older bullets | Batch 1.1 requires third-person instructions. | Yes |
| Clause 2 is only the unassigned entry; a primary assignment still allows other relevant permitted supporting skills | Ban supporting skills after a primary; require every compatible skill | Review caution 1. Plan clause 1 already allows a loaded skill to name further work. | Yes |
| Permission substring is `not permission to perform the denied action` | A new grant sentence for the two restricted roles | Plan lines 167 and 185-186. Both roles already receive `TOOLING_PRECEDENCE`. | Yes |
| Phrase asserts, not a partial snapshot | Freeze the whole file in the spec | Batch 1.2. | Yes |

## Static inspection (not Jest)

Node read of the partial and the fifteen `*.template.md` files:

- Skill-use bullets: 7
- `## Working rules` still present
- Section `ptah_*` matches: none
- Section contains `{{`: no
- Four clause phrases present in the section: 4/4
- Template files: 15
- Those phrases duplicated into template sources: none
- Section hits for role names, framework names, wizard slots, `{{`, or "you ": none

`ROLE_PARTIALS` still lists 15 roles. `ui-ux-designer` has no `CLI_DELEGATION`. `visual-reviewer` has no `CLI_DELEGATION`. The spec expects both resolved bodies to contain the permission substring and not `ptah_agent_list`.

## Checks NOT RUN

Jest, Nx, lint, tsc, and manifest were not run. Mode 2 owns:

`npx jest -c libs/backend/agent-generation/jest.config.ts libs/backend/agent-generation/src/lib/services/template-sharing.guard.spec.ts --coverage=false --maxWorkers=2`

## Blockers

None in the batch scope. `ptah_agent_report` is not available in this session: tool search for ptah symbol, AST, and agent-report tools returned no tools. The connected server exposes tasks automation tools only. This report is the handoff.

## Out of scope left untouched

Fifteen `*.template.md` files, skill descriptions, wizard variables, `LLM:` fallbacks, `SHARED_BLOCK_IDS`, discovery, and `contentHash`.
