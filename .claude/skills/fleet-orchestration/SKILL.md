---
name: fleet-orchestration
description: 'Operating rules for running a multi-agent fix fleet through plan, implement, adversarial judge, and commit. Use when the user says fleet, multi-agent fix, judge loop, or resume workflow. Covers checkpoint resume, disjoint-lib batching, the commit window, commitlint gates, and the nx run-many test rule.'
---

# Fleet Orchestration Skill

Run N independent bugfix or perf tasks as one fleet. Each task is a
`.ptah/specs/TASK_YYYY_NNN` folder. The fleet moves every task through
plan, implement, adversarial judge, and commit. Use subagents or CLI
agents as the workers. You are the orchestrator. You compute state from
disk, you batch the work, and you commit.

## 1. WHEN TO USE

Use this skill when the user asks to run several independent bugfix or
perf tasks at once, each with its own task spec folder.

- Each task is a `.ptah/specs/TASK_YYYY_NNN` folder.
- Each task moves through: plan, implement, adversarial judge, commit.
- Workers are subagents (Task tool) or CLI agents (ptah_agent_spawn).
- You are the orchestrator: you batch, you verify, you commit.

Worked example:

> Run TASK_2026_341..354 as one fleet. Group them by area. Plan each,
> implement each, judge each, then commit in one window.

## 2. HARNESS LIMITATION

This skill exists because of a Claude Code Workflow resume bug. Resume
replays the longest unchanged PREFIX of agent() calls. parallel() starts
calls in non-deterministic order. After a host crash, a resume re-runs
finished agents and can flip completed task statuses back to in_progress.

Rule: never rely on resumeFromRunId for a parallel fleet. Resume by
recomputing state from disk artifacts. Re-invoke the workflow with fresh
args. The `.claude/workflows/fleet-fix.js` script takes that args shape.

Worked example:

> A crash hits mid-batch. Do not call resumeFromRunId. Read each
> task.md status line and each judge-round-N.json. Build fresh args.
> Re-invoke fleet-fix.js with the new args.

## 3. ARTIFACT CHECKPOINTS

Three artifacts mark progress. Each proves one stage is done.

1. `context.md` exists: planning is done.
2. `task.md` `status:` line is `in_review` or `done`: implementation is
   done. Edit exactly the status line. Never rewrite the carrier.
3. `.ptah/specs/<id>/judge-round-<n>.json`: judge round n is done.
   Schema: `{ taskId, round, pass, defects[], testsRan, mentorNote }`.

Agents write their artifact BEFORE they return. A re-spawned agent that
finds its artifact must no-op and return.

Worked example:

> Implementer returns. You check task.md: status is `in_review`. You
> check judge-round-1.json: it is missing. You run judge round 1.

## 4. DISJOINT-LIB BATCHING

Two concurrent implementers must never edit the same lib. Group tasks by
area. Same area runs sequential. Different areas run parallel.

This prevents a named failure: Edit-tool conflicts and test flakes from
concurrent edits in one working tree.

Worked example:

> TASK_341 and TASK_342 both touch `agent-sdk`. Run them sequential.
> TASK_343 touches `chat-ui`. Run it parallel with the agent-sdk pair.

## 5. COMMIT WINDOW

Commit ONLY when no implementer is editing. The pre-commit hook runs
lint-staged. lint-staged backs the tree up to a git stash and restores
it after tasks. Concurrent agent edits made during the hook window are
silently reverted.

Also: never run `git commit` from inside a workflow agent. The
orchestrator commits, in a quiet window, after all implementers stop.

Worked example:

> All implementers return. All task.md status lines are `done` or
> `in_review`. No judge is writing. You commit now.

## 6. COMMITLINT GATES

This repo enforces commitlint. Follow these gates.

- Subject line: at most 72 chars.
- Every body line: at most 100 chars. Wrap at 72.
- Scope must be in the scope enum in commitlint config. Examples:
  `agent-sdk`, `rpc-handlers`, `electron`, `chat`, `vscode-core`.
- `security` and `git` are NOT scopes.
- Multi-scope with commas is allowed.

Worked example:

> `fix(agent-sdk,chat-streaming): scope the panel request` - valid.
> `fix(git): ...` - rejected, `git` is not a scope.

## 7. NX TEST RULE

Never run `nx test projA projB`. The positional names become Jest path
filters. Zero tests run. The command exits 0. You get a green lie.

Always run `npx nx run-many -t test -p <projects>`. Then READ the
"Running target test for N projects" header. Check that N is the number
you asked for. A misspelled project name is silently dropped.

Worked example:

> `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/markdown`
> Print "Running target test for 2 projects". 2 matches the ask. Proceed.

## 8. JUDGE PROTOCOL

The judge stance is to refute. The default verdict is fail.

- Number every defect with a `file:line` anchor and a concrete failing
  scenario.
- Max 2 judge rounds. Then escalate to the orchestrator.
- Judges are read-only. No source edits. No task.md edits.
- A judge writes `judge-round-<n>.json` before it returns.

Worked example:

> Judge round 1 finds 2 defects. The revise stage consumes the defects.
> Judge round 2 finds 0 defects. It sets `pass: true`. You commit.

## 9. CLI AGENT LANES

CLI agents (codex, ollama-cloud via ptah-cli) have NO shared context.
Prompts must be fully self-contained. Use absolute Windows paths. State
an explicit output format.

Flow: Spawn, then Poll, then Read.

- `ptah_agent_spawn { task, cli, files }`
- `ptah_agent_status { agentId }` until not running
- `ptah_agent_read { agentId }`
- Max 3 concurrent CLI agents.

Worked example:

> Spawn codex on TASK_341 with a self-contained prompt and the absolute
> path `D:/projects/ptah-extension/libs/backend/agent-sdk/`. Poll until
> done. Read the output. Verify before you trust it.
