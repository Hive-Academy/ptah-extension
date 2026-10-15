# HANDOFF - TASK_2026_646_136a (2026-10-15)

## Goal

An optional decision model for orchestration routing, plus a lane evaluation loop. The parts:
- A "Decision model" background role: an Ollama decision model, TypeSafe Jev, or any model with structured output.
- A `ptah_route_decide` MCP tool.
- A lane and subagent outcome record.
- A capability matrix as data (`source`, `asOf`).
- A spread rule across every spawnable lane (codex, opencode, grok, antigravity, Glm ptah-cli, Claude in-process,
  and any new `ptah_agent_list` row).

The approved requirements are in `task-description.md` (revision 3, 13 requirements).

User decisions are final. Do not reopen them. Details are in `decisions.md`.
- **#12:** with no decision model set, deterministic code ranking always chooses lanes. A model only refines it.
- **#13:** replace the Agents-tab "Success" figure with outcome signals.
- **#18, as amended by #22:** keep and fix in place. There is no carve-out home. The two focus areas are
  (a) lane evaluations and learnings (this task) and (b) the user's own agents and skills (the Library).
  New-skill suggestions are deleted by TASK_2026_662_3eea.
- **#19:** TASK_2026_535 and TASK_2026_537 are merged into this task. 535 §D/§E moved to TASK_2026_663_50d4.

## Done

- `9abb42991` docs(task-specs): file TASK_2026_646 decision-model routing task.
- `4dfc3dfec` docs(task-specs): sync task records written on the main checkout. It holds the research, the
  requirements and the Gate 1 reviews (PR #729, merged).
- Gate 1 passed in lane-review mode. Codex approved revision 3 in round 3 (`task-description-review.md`). The
  earlier rounds are in `task-description-review-round1.md` and `-round2.md`.
- Research: `research-routing-landscape.md` (grok), `research-decision-models.md` (Glm),
  `research-codebase-survey.md` (opencode) and `research-runtime-survey.md` (a verified file:line map of the lane
  runtime). There is no `research-report.md` on purpose (decision #14).
- Related, merged: PR #723 (agents steered to ptah tools). Skill synthesis is switched off in
  `~/.ptah/settings.json` (`skillSynthesis.enabled=false`, `curatorEnabled=false`). The TASK_2026_659_cec4
  evaluation is complete.
- This branch, `feat/decision-model-routing` (worktree `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`,
  from main `c57a9a1e7`): decisions #22-#24, context.md § Scope additions 3, a rewritten TASK_2026_662_3eea
  context, and this file.

## In progress

None. Architecture has not started: no `implementation-plan.md` exists. The previous architect was stopped
before it wrote the plan (decision #21). Its survey is saved as `research-runtime-survey.md`.

## Open problems and decisions

- **The research line references are dated:** they come from `4dfc3dfec`. Decision #24 lists the shifts on
  main `c57a9a1e7`. The main one: the `ptah_agent_list` case in `protocol-dispatcher.ts` is now at :1410, not
  :1402. Check every file:line before you use it.
- **Questions for the user, owned by TASK_2026_662_3eea, not this task:**
  - Replace the Skills/Commands "Success %" with a use count. This reopens part of #13.
  - The exact list of tables to drop.
  - Keep or delete `extract-and-relocate-angular-component-feature`.
- **Known lane defects (TASK_2026_663_50d4, not fixed):**
  - OpenCode lanes can lack `ptah_*` tools, so they cannot call `ptah_agent_report`.
  - Grok lanes lacked `ptah_web_search`.
  - A role's default file name can override a declared deliverable. Give each review round an explicit file
    name, and copy the earlier rounds before a new round starts.
  - Codex resume fails after 600 s idle. Give a full brief on every respawn.
- **Lane limits:** opencode's monthly window was at 86% on 2026-10-14. Check the limit state before each spawn.

## Key files

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\task-description.md`:
  the approved requirements (Gate 1).
- `...\TASK_2026_646_136a\decisions.md`: decisions #1-#24. Decisions #22-#24 are new on this branch.
- `...\TASK_2026_646_136a\context.md`: § CLI Lanes (Gate 0.1), § Scope additions 1-3.
- `...\TASK_2026_646_136a\parity-inventory.md`: the Agents-tab "Success" replacement (approved).
- `...\TASK_2026_646_136a\research-runtime-survey.md`: the starting point for the architect (LaneCompletionNotifier,
  DI, limits, `ptah_agent_list`, model discovery, MCP tool pattern, both dispatchers).
- `...\TASK_2026_646_136a\research-codebase-survey.md`: the existing telemetry and limit readers, Gaps 1-8.
- `...\TASK_2026_659_cec4\evaluation-report.md`: the evidence for #22. See Value §2-§8 and Rethink Steps 1-3.
- `...\TASK_2026_662_3eea\context.md`: the follow-on keep, fix and delete plan. This task's plan must give it a
  handoff section.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`: the HTTP MCP dispatcher.
  `ptah_session_handoff` (TASK_2026_655) is the newest always-on tool to copy.
- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`: the telemetry writers.
  `succeeded: true` is hard-coded at :510 and :675. The master switch does not gate telemetry (:996) but pauses
  the spec harvest.

## Background work

None. No lanes, subagents or child sessions are in flight.

## Next steps

1. Run `/orchestrate TASK_2026_646_136a`. Work only in
   `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing`. Lanes stay `enabled` and Approval
   stays `lane-review` (Gate 0.1, context.md § CLI Lanes). Run `ptah_agent_list` again to refresh the roster and
   limits.
2. Run the architect in-process (software-architect subagent, decision #20) in plan mode. Give it:
   - `research-runtime-survey.md` and `research-codebase-survey.md` as its starting point, so it does not survey
     the code again, and decision #24 for the line shifts;
   - the brief in decisions #20, #22 and #23 and context.md § Scope additions 2 (item 2) and 3;
   - the "Open — architect" items in `task-description.md`.

   It writes `implementation-plan.md` with:
   - verified contracts;
   - the read seam to the kept stores;
   - harvester and telemetry independent of `skillSynthesis.enabled`;
   - `skillsLoaded`;
   - the `/v1/systemone` client;
   - the lane family field, which cross-family review needs and no code has today;
   - wiring of `ptah_route_decide` in both the HTTP and the stdio dispatcher;
   - file-disjoint batches with the batches that can run in parallel on lanes;
   - a handoff section for TASK_2026_662_3eea.
3. Gate 2: a cross-side review of the plan on a CLI lane (codex, or another family when codex is at its limit).
   Use an explicit deliverable `implementation-plan-review.md`. Revise at most 2 rounds.
4. Run the team-leader in decomposition mode to write `batches.md`. Spread the batches across lanes, so that no
   single lane does all the work. Shipping code is always reviewed by a different family than the implementer.
5. After each batch, verify only the changed projects: `npx nx test <project> --parallel=1`, or
   `npx nx run-many -t test -p A B --parallel=1` (check that the header says N projects). Run one heavy check at
   a time. Commit in the foreground. Push and open the PR in the background. Never commit to main.
