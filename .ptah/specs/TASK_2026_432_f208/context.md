# Context — TASK_2026_432

Origin: the 2026-09-13 skills tribunal (see `TASK_2026_431_39db/tribunal/`). Every
item below was checked against the files by two panelists in round 2.

Root: `libs/backend/agent-generation/templates/agents/`.

## Items

1. **Delegation grant contradiction.** `visual-reviewer.template.md:36` and
   `ui-ux-designer.template.md:39` include `<!-- STATIC:CLI_DELEGATION -->`;
   `_shared/cli-delegation.md:3` grants delegation; the orchestration catalog
   (`agent-catalog.md:33`) says these roles should not delegate. Decide the rule once
   (catalog vs template), make both agree, and add a guard spec that maps role →
   allowed partials.
2. **Task-spec block over-privilege.** `renderTaskSpecAgentBlock`
   (`libs/shared/src/lib/types/task-spec.contract.ts:506–541`, allocation at
   :527–533) is expanded into all 15 templates via
   `template-partial-resolver.ts:74`. Split into an orchestrator/team-leader block
   (allocation, carrier status) and a specialist block (task folder, where to write
   the deliverable, never touch the carrier). ~1.1KB per specialist spawn.
3. **Conditional resume.** `_shared/cli-delegation.md:13` must match
   `tribunal/references/vendor-panel.md:96`: resume only when `ptah_agent_status`
   reports a `CLI Session ID`, otherwise respawn with context restated. After
   TASK_2026_431 lands, the wording is copied from `agent-lanes`, not re-authored.
4. **team-leader return blocks.** `team-leader.template.md:231–353` —
   DECOMPOSITION COMPLETE / BLOCKED / BATCH PARTIAL FAILURE / NEEDS REVIEW / NOT
   ACCEPTED differ by a few lines each. One envelope + a per-variant table; keep the
   literal header strings parsers and the orchestrator depend on. ~4–5KB per spawn.
5. **Status mutation ownership.** `agent-catalog.md:85` lets developers update task
   state; `team-leader.template.md:151–153` reserves it to the team-leader. Align.
6. **Tooling precedence wording.** `_shared/tooling-precedence.md` already has a
   fallback (:19); make the first line availability-conditional so agents on
   harnesses without the Ptah MCP server do not attempt `ptah_*` first.

## Constraints

- Templates ship to every user's repository: stay stack-agnostic; LLM-filled sections
  stay (TASK_2026_359 guard must keep passing).
- Frontmatter descriptions are the dispatcher signal — do not shorten them to one-liners.
- Do not add a seventh copy of any shared block; extend the closed `_shared` set.

## Acceptance

- Guard spec: non-delegating roles do not expand `CLI_DELEGATION`; specialists do not
  receive allocation text.
- Record expanded size per template before/after in this folder.
- `nx run-many -t test -p @ptah-extension/agent-generation @ptah-extension/shared` green.
