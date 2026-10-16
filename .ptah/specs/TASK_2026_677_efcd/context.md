# Task Context - TASK_2026_677_efcd

## User Request

> awesome i would like to postpone testing, and focus on doing stunning html elements thats clean and utilize proper
> icons from lucide-angular and our cli tools icons, and also validating the changes i will like to get this done with
> high quality and in record time you have the full ability to parallelize the work as you like with your subagents and
> installed cli tools u see how clean the main chat responses as the first screen shot, i think this can replace the
> compacted version which as u can see show tool calls and agent streaming first until the agent sends the complete
> message then collapse the agent streaming and show the final percised output with agents tiles working commands
> beautifully like that, can we add that to our list of work , that second screenshot explains all i need to get
> changed u can do a one to one to get the inner details and agronomics we need to apply

Earlier in the same session (TASK_2026_629 handoff-13 §5 step 7): agent and sub-agent tiles with CLI provider icons in
the RIGHT sidebar, a better sub-agent execution display, a smooth staggered animation on session switch. "YOU (Claude,
orchestrator + Claude sub-agents) build the frontend; CLI lanes (codex etc.) only review." "Approval mode lane-review;
I will not track the work; ask me only for removals or irreversible actions."

Reference screenshots: `reference/01-clean-chat-turns.png`, `reference/02-session-shell-with-inspector.png` (one-to-one
target). Carry-over items: `reference/pr730-followup-map.md` section T1 (T1-01 .. T1-40).

## Task Type

FEATURE (adds a UI surface, replaces the compact turn view).

## Complexity

Complex.

## Strategy

FEATURE, Full: PM (task-description.md + parity-inventory.md for the replaced compact view and details aside) in
parallel with ui-ux-designer (design-spec.md + prototype/) -> codex cross-side reviews -> Gate 1/1.7 (lane-review) ->
software-architect -> team-leader -> parallel Claude frontend-developer sub-agents (file-disjoint) -> codex
code-logic review -> visual-reviewer dark + light.

Testing: the user postponed testing. No new spec-writing batches; T2 (R9 parity tests) is postponed. Required checks
stay: each changed project's existing suite, typecheck and lint (CLAUDE.md).

## CLI Lanes

- Preference source: current explicit user instruction (CLI lanes review only, Claude implements the frontend).
- Mode: enabled (review only). Approval mode: lane-review.
- `ptah_agent_list` 2026-10-15: codex installed, confirmed room (weekly 0%); opencode near limit (monthly 91%);
  antigravity, grok installed, limit unknown; copilot disabled; cursor, pi not installed; Glm (ptah-cli, Ollama Cloud,
  pc-355b645d-35af-4974-84cf-9cf961ea0164) available, limit unknown.
- Reviewer for documents and code: codex (different family from the Claude implementers).

## Conversation Summary

- PR #730 merged 2026-10-15 (c57a9a1e7). This task starts from that merge.
- The Grid "valley of kings" route idea was dropped by the user (not now).
- Rules for every lane and sub-agent: checks only via `node .ptah/tmp/check-run.mjs <label> -- <command>`; changed
  projects only, `--parallel=1 --skip-nx-cache`, Jest `--maxWorkers=2`; one heavy check at a time; no workspace-wide
  runs; no build/serve/dev/e2e/package except the Electron renderer rebuild; no npm install; no git in
  D:\projects\ptah-final-run-ws; UI changes need before/after screenshots dark + light; commits foreground with
  `.commitlintrc.json` scopes; handoff file is `handoff-1.md`, never `HANDOFF.md`; at most 3 parallel CLI lanes.
