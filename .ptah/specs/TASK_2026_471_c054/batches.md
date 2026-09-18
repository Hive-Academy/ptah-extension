# Batches

All work happens in the worktree
`D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents`
on branch `feat/tasks-page-agent-assign`.

Batch 0 already landed on the branch before decomposition. Batches A and B are
file-disjoint and run in parallel in the same worktree.

## Batch 0 — registry DI fix (DONE, uncommitted on the branch)

| File | Change |
| --- | --- |
| `libs/backend/task-specs/src/lib/registry-generator.service.ts` | `@inject(TASK_SPECS_TOKENS.TASK_SCANNER)` on the scanner parameter |
| `libs/backend/task-specs/src/lib/task-doctor.service.ts` | `@inject(TASK_SPECS_TOKENS.TASK_WRITER)` on the writer parameter |
| `libs/backend/task-specs/src/lib/registry-generator.service.spec.ts` | Regression test asserting the token metadata |

Verified: 517 tests pass, lint and typecheck pass.

## Batch A — Get Started card refresh

**Executor**: ollama cloud lane.
**Files**: `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts` only.

Replace the hard-coded `categories` array (lines 181-335) with the card set in
`get-started-content-spec.md`, subject to the correction recorded in
`context.md`. Keep the six existing category names. Do not change the component
API, the `promptSelected` output, or the template.

**Acceptance**: every card's prompt names a skill in `.claude/skills/` or a
command in `.claude/commands/`. No card invents a capability.

## Batch B — assign a task to an agent from the board

**Executor**: codex lane.
**Files**: everything under `libs/frontend/tasks-ui/src/lib/` plus that lib's
`src/index.ts`. Does not touch `chat-ui`.

Implement `## Proposed design` of `implementation-plan.md`, sections 1 to 3.
Section 4 ("Running State and Agent Completion") is deferred.

**Acceptance**: no new RPC method, no new namespace prefix, no frontmatter
schema change. `ChangeDetectionStrategy.OnPush` on every component touched. No
backend import from a frontend lib.

## Batch C — review

**Executor**: antigravity lane. Different family from both implementers.

Reviews the diff of batches A and B against the repository conventions and the
acceptance criteria above.

## Gate — orchestrator verifies

`nx run-many -t test lint typecheck` over the affected projects. A lane's PASS
is an opinion, not proof.
