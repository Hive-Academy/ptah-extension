# Implementation plan — TASK_2026_432

Root: `libs/backend/agent-generation/templates/agents/` (templates), `libs/shared/src/lib/types/task-spec.contract.ts` (renderer).

## Deployment constraint that shapes every item

Templates are NOT bundled with the extension. `ContentDownloadService` mirrors
`content-manifest.json` from GitHub `main` into `~/.ptah/templates/agents/`, and the
INSTALLED extension's `TemplatePartialResolver` expands them. So after merge, released
extensions (old resolver) load the new templates. Any new `STATIC:` id in a template
fails the old resolver's closed-set check and takes the whole corpus down for every
user on an older build. Therefore:

- No new STATIC ids, no removed `_shared/` files. Content edits and marker removals only.
- The role split for item 2 is chosen by **resolver mapping on the template id**, not by
  a new marker. Old builds keep rendering the full block (no break); new builds render
  the role-aware one.

## Items

| # | Change | Consumers affected |
| - | ------ | ------------------ |
| 1 | Template side is the rule: `visual-reviewer` and `ui-ux-designer` drop `STATIC:CLI_DELEGATION` (browser / interactive-design roles, catalog `-`). Guard spec pins the exact STATIC set per role (closed table of 15) and names the non-delegating roles (`team-leader`, `visual-reviewer`, `ui-ux-designer`). | `template-sharing.guard.spec.ts` (new duty). Catalog alignment is a note for TASK_2026_431 (it owns `agent-catalog.md`). |
| 2 | `renderTaskSpecAgentBlock(audience: 'coordinator' \| 'specialist')` — required argument, no default. Coordinator (project-manager, team-leader) keeps allocation, carrier authoring and status rules. Specialist gets folder identity, carrier read-only, ownership of states, doc names. Resolver maps `TASK_SPEC_CONTRACT` through `taskSpecAudienceFor(templateId)`; unknown ids get `specialist` (least privilege). `DERIVED_BLOCKS` renderers take the template id. | `template-partial-resolver.ts` (+ spec), `template-sharing.guard.spec.ts`, `task-spec.contract.spec.ts`. No other consumer in the repo (grep: rpc-handlers, cli-engine, harness-builder, agent-sdk — none). |
| 3 | `_shared/cli-delegation.md`: resume only when `ptah_agent_status` reports a `CLI Session ID`, else respawn with context restated (wording aligned to `tribunal/references/vendor-panel.md:96`). Also: no `ptah_agent_list` in session means do the work yourself. | All 12 roles that include CLI_DELEGATION after item 1. |
| 4 | `team-leader.template.md`: one `## Return value` envelope + a per-variant table; one executor prompt shared by `DECOMPOSITION COMPLETE` and `BATCH [N] COMPLETE`. All eight literal headers kept (`team-leader-modes.md` / `orchestration/SKILL.md` match on `NEEDS REVIEW`, `ALL BATCHES COMPLETE`). | Orchestrator skill (string match only; no code parser — grep confirmed). Guard pins the headers. |
| 5 | Ownership stated once, in the renderer: task states in `batches.md` belong to the team-leader, carrier `status:` to the coordinating roles; specialists report and never edit either. Team-leader template already says this (`:151-153`). | Specialist block text; catalog note for TASK_2026_431 (`agent-catalog.md` Invocation table tells developers to "Update status to IMPLEMENTED"). |
| 6 | `_shared/tooling-precedence.md` opens availability-conditional: use `ptah_*` first when they are in the session's tool list; otherwise go straight to native tools, never probe. | All 15 roles. |

## Expanded size before (bytes, resolver output with composition markers stripped)

Measured with a throwaway esbuild bundle of the real `TemplatePartialResolver` (scratchpad, not repo).

| Template | Before |
| -------- | -----: |
| backend-developer | 14703 |
| code-logic-reviewer | 14801 |
| code-style-reviewer | 14216 |
| devops-engineer | 12152 |
| frontend-developer | 15485 |
| modernization-detector | 9590 |
| project-manager | 12974 |
| researcher-expert | 9690 |
| senior-tester | 14057 |
| software-architect | 15266 |
| team-leader | 22750 |
| technical-content-writer | 13941 |
| ui-ux-designer | 9832 |
| video-director | 9021 |
| visual-reviewer | 16593 |
| **Total** | **205071** |
