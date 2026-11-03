# Task: Make CLI lanes a first-class delegation option in the Ptah prompt and tool surface

User brief, 2026-10-30. Delivery decision (TASK_2026_853_897f decisions.md #51): own PR, stacked
on Phase C. Worktree `.claude-worktrees/cli-lane-prompt`, branch `fix/cli-lane-prompt`, created
from `feat/session-prefix-diet-c` (Phase C head `3af55a21f`), not from main. The Phase C core
prompt (`ptah-core-prompt.ts`) is already rewritten on this base; edit that version. The added
lane text raises the Phase C core-prompt budget pin in `ptah-core-prompt.spec.ts` by a recorded
amount; do not delete the pin.

## Problem
Sessions use Task subagents but rarely use CLI lanes (ptah_agent_spawn) unless the user
insists or the orchestration/agent-lanes skill is loaded. Three causes:
1. All ptah_agent_* tools are deferred (need ToolSearch first); Agent/Task is eager.
2. The core prompt routes implementation to Task only and gives CLI lanes no trigger criteria.
3. The prompt that does describe when to delegate (PTAH_SYSTEM_PROMPT) is never injected.

## Changes
### A. Tool visibility  libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts
- Add `ptah_agent_list` and `ptah_agent_spawn` to the eager set (ALWAYS_EAGER_TOOLS, ~line 686).
- Keep ptah_agent_read/status/stop/message/wait deferred.
- Keep ptah_route_decide and ptah_outcome_report deferred. Another branch is moving pre-flight
  routing to the host, so the model must not call it on its own.
- Update the comment block above the set (~679-685) and any spec asserting the eager list.

### B. Core prompt  libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts
1. Replace the "Delegation to Specialist Agents" table with one table that covers both executors:
   - Task subagent: needs this session's context, deep reasoning, or a repo specialist role.
   - CLI lane: self-contained work that a fresh agent can do from a written brief, such as an
     independent code review, test writing, docs, research, a second-vendor opinion, or
     parallel file-disjoint implementation batches.
   - Neither: trivial or single-file edits, Q&A.
2. In "3-Tier Agent Hierarchy & CLI Delegation" (~141-157), replace "for quick work" with the
   criteria above, and say: when 2+ independent subtasks exist, prefer running at least one
   as a CLI lane in parallel.
3. Orchestration Rules: change "delegate coding to specialist agents via the Task tool" to
   "delegate to a Task subagent or a CLI lane per the table".
4. Add one line: "When a `Routing:` system reminder is present, follow its taskType, depth and
   executor suggestions unless the user says otherwise." (The other branch injects this reminder.)
   Do NOT add a rule telling the model to call ptah_route_decide itself.
5. Keep the roster rule: never hard-code vendors. Call ptah_agent_list.

### C. Dead prompt  libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts
- `buildPlatformSystemPrompt` / `PTAH_SYSTEM_PROMPT` have no non-spec callers. Move anything
  still useful from "Multi-Agent Delegation  Fire-and-Check Pattern" (~205-249) into the core
  prompt (B), then delete the constant, the builder, its export (vscode-lm-tools index.ts:78)
  and its spec.
- Fix the stale comment at libs/shared/src/lib/types/ai-provider.types.ts:210 ("always injected").

### D. Skills (keep in sync)
- .claude/skills/orchestration and agent-lanes, plus the bundled copies under
  apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/. They should say that the host may
  already have run pre-flight routing: reuse a `Routing:` reminder instead of calling stage
  'pre-flight' again. Keep the gate-0.1 call as is.

## Acceptance
- A fresh Electron session lists ptah_agent_list and ptah_agent_spawn with full schemas.
- Asking "review my last commit and add tests for it" (no skill loaded) leads to at least one
  CLI lane spawn.
- No caller of PTAH_SYSTEM_PROMPT remains, and no dead export remains.

## Coordinator notes (found before implementation)
- Specs that import `PTAH_SYSTEM_PROMPT` and must move their pins to the core prompt, not be
  deleted silently: `vscode-lm-tools/.../lane-policy-sync.spec.ts` (:13, :91, :123) and
  `vendor-roster-drift.spec.ts` (:34, :70, :127).
- The agent-lanes skill §7 names `ptah-system-prompt.constant.ts` as the parent-side tool table
  that must agree with the lane policy; change that reference to the core prompt.
- `agent-generation/.../enhanced-prompts.service.ts:919` mentions PTAH_SYSTEM_PROMPT in a comment.

## Constraints (from CLAUDE.md)
- Verify: npm run verify -- -p vscode-lm-tools,agent-sdk,shared (plus dependent hosts).
  No workspace-wide runs, no build/serve/e2e.
- Electron first. Commit, push and open a PR per CLAUDE.md.
