# Task Context - TASK_2026_613_8f34

## User Request

2026-10-04, during TASK_2026_597_ab22 (S4 session):

> i approve them and i would like to make the changes inside our ptah asstes and plugins files so they
> get shipped to all users not only my current setup also if we can utilize our settings to provide
> visual capability for users to set or teak would be great as well

> open PR for the last part as well and for that new task commit its filed specs in that pr that would
> hold s4

## Task Type

FEATURE

## Complexity

Medium

## Strategy

FEATURE, Partial depth: project-manager (short task-description) → software-architect → team-leader → QA.
Start in a NEW session after PR #639 (TASK_2026_597 PR 3) merges, and coordinate with TASK_2026_609_c495
(it owns `.claude/agents`, the agent-generation services and templates, and the system-prompt parts of
`sdk-query-options-builder.ts`).

## CLI Lanes

Not decided. Run Gate 0.1 at the start.

## Approved rules (user, 2026-10-04)

These rules apply now to the rest of TASK_2026_597. This task ships them.

1. **Relay per agent run**: a developer or reviewer stops at about **150k context** (main trigger) or
   **60 tool calls** (backup), writes a progress note, and a fresh agent continues from the note. Applies
   to one agent run only, not to a task or a session. The main session uses the PR 3 session budget and
   handoff instead (50M, handoff at 80%). Reason: a fresh agent restarts at about 33k (about 60k after it
   re-reads its files), so the relay pays back once context is above about 120k.
2. **Batch size**: the team-leader decomposes into batches of about 6 files.
3. **Orchestrator commits a clean batch**: when a batch report shows all checks green and no deviation to
   judge, the orchestrator commits it after re-running only `di-lint`, `degradation-audit` and the scoped
   typecheck. The team-leader keeps decomposition, deviation calls and phase completion.
4. **Model per role**: Sonnet for verify-and-commit, style review and mechanical batches (types, specs,
   fixtures, wiring). Opus stays for design, code-logic review and complex batches. The team-leader marks
   the model per batch.
5. **Short check output**: use `ptah_run_check` (TASK_2026_597 Batch 33, output capped at 4,000
   characters) or filtered output (`tail`, summary/failure grep); re-run one failing spec, not the suite.
6. (Proposed, not yet approved as a rule) **Hard turn limit**: `maxTurns` in the agent definitions, so the
   limit is enforced and not only advised.

## Scope

- **Shipped skills**: encode rules 1-5 in
  `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration/` (SKILL.md and
  `references/team-leader-modes.md`, `agent-catalog.md`) and `.../skills/agent-lanes/`, keeping the
  `.claude/skills` copies in sync. Run `npm run manifest:generate` and commit `content-manifest.json`.
- **Generated agents**: model per role and a `maxTurns` value in the agent-generation templates (owned by
  TASK_2026_609; coordinate, do not edit in parallel).
- **Settings UI**: controls for the relay limits (context and calls), the batch size, the model per role
  and the turn limit. Extend the existing controls, do not add a second set:
  - the orchestration matrix popovers (per-role model and effort already exist);
  - the PR 3 session-budget card (150k resume limit, 3M per-subagent safety stop).
- **Runtime link**: where Ptah enforces a limit (TASK_2026_597 Batch 28 A5 per-subagent budget monitor,
  PR 3 per-subagent advice), the skill text and the settings must use the same keys and defaults.

## Evidence (tool M, `scripts/agent-usage-report.ts --date=2026-10-04`)

| Vendor   | Sessions | Requests | Input   | Cached | Avg context            |
| -------- | -------- | -------- | ------- | ------ | ---------------------- |
| Claude   | 98       | 3,270    | 398.8M  | 97%    | 122k (268 over 200k)   |
| Codex    | 18       | 594      | 36.2M   | 94%    | 61k                    |
| OpenCode | 4        | 198      | 19.3M   | 97%    | 97k                    |

- Claude subagents: 329.7M of 398.8M (83%). 81 of 98 Claude sessions on Opus.
- Start prefix per subagent: about 33k (`first=`).
- Largest runs: Batch 34 developer 103 requests / 22.3M (context up to 310k); Batch 32 70 / 9.3M;
  Batch 33 64 / 7.8M. Batches of about 40 calls cost 2-3M each.

## Conversation Summary

- The user asked whether this should be a new session or a batch of TASK_2026_597. Recommendation
  accepted: a new task (different owners of the files, existing settings to extend, TASK_2026_597 already
  large). The spec files are committed in the TASK_2026_597 S4 PR (branch `fix/task-597-s4-lane-guards`)
  at the user's request.
