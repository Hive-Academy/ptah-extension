# Context

## The problem

`allocateTaskId` (`libs/backend/task-specs/src/lib/id-allocator.ts:12`) and every agent
prompt (`libs/shared/src/lib/types/task-spec.contract.ts:475,523`, the 15 files under
`.claude/agents/*.md:47`, orchestration `SKILL.md:144`, `task-tracking.md:191`, tribunal
`relay.md:40`, plus the shipped plugin copy under
`apps/ptah-extension-vscode/assets/plugins/ptah-core`) allocate an id as "highest NNN in
the local `.ptah/specs` folder plus one". A worktree branched from main yesterday cannot
see the ids that main or another PR took since. The `mkdir` lock in the orchestration
skill protects one checkout only.

Because both sides use the same folder name, git resolves the clash silently: a rebase
or merge writes one `task.md` over the other with no conflict marker.

## Evidence (2026-09-08 to 2026-09-09)

- TASK_2026_392 minted twice (canvas scaling vs CI investigation). PR #480 was opened to
  restore 392 and move the CI investigation to 400.
- PR #480 itself collides again: it adds TASK_2026_400 (CI test step killed after Nx
  success) while `origin/main` already holds TASK_2026_400 (compaction leaves the tile
  empty, from fix/empty-assistant-bubbles). Landing #480 as-is overwrites main's 400.
- TASK_2026_393 (peer-session research) on fix/empty-assistant-bubbles was overwritten
  by main's own 393 (license-server dependency guard) during a rebase. The report had to
  be recovered from the research agent's transcript and refiled as 402.
- Open PRs at the time of filing: #480 (touches 392, 400), #477 (touches 386, which main
  already has and which is its own task), #476 (no spec changes), #457 (release).

## Decision

Format: `TASK_YYYY_NNN_xxxx`. The number stays first so folders sort and people can
still say "task 403". `xxxx` is four lowercase hex characters chosen at creation. Two
branches that both pick 403 produce two distinct folders. The board may show two 403s,
which is visible and harmless. The existing allocator already tolerates suffixes
(`TASK_2026_146_ORCHESTRA` is a pinned case in `id-allocator.spec.ts:21`), so only the
output format and the scan inputs change. Existing folders are not renamed.

## Touch points

1. `id-allocator.ts`: emit the suffix. Accept an optional folder-name union from
   `git ls-tree origin/main .ptah/specs` and every `git worktree list` path so the
   number is chosen against everything visible, not the local folder only.
2. `task-writer.service.ts:273` caller, `ptah_task_create` MCP tool, tasks-ui create
   dialog.
3. `task-spec.contract.ts:475,523` shared prompt text, the 15 agent files, orchestration
   `SKILL.md`, `task-tracking.md`, tribunal `relay.md`, both `.claude` and the plugin copy.
4. `skill-synthesis/src/lib/subagent-metrics-extractor.ts:46-48`: the regexes end in
   `\b` after three digits and will not match a suffixed id. Widen them.
5. `task-doctor.service.ts` and the tasks-ui id parser: confirm the suffix is part of
   the id, not a frontmatter mismatch warning.
6. Root `CLAUDE.md` "ID allocation" rule and `libs/backend/task-specs/CLAUDE.md`.

## Orchestration

- Worktree: `.claude-worktrees/task-id-suffix`, branch `fix/task-id-suffix` off `origin/main` (2327e9db0).
- Strategy: REFACTORING, Partial (architect, team-leader, executor, QA).
- cli_delegation: enabled. Executor per user request: codex (`ptah_agent_spawn cli: codex`). Sub-agents for plan, batching, review.
- Orchestrator session: ptah-extension-0e.

## Corrections from peer sessions (received via SendMessage, 2026-09-09)

- ptah-extension-47: main's TASK_2026_400 was NOT minted on main. It was TASK_2026_391 on the
  PR #469 branch, collided with a different 391 (curator extract) that reached main first,
  and was renumbered to 400 during the rebase because 391-399 were all taken. That renumber
  then created the 400 collision PR #480 hit. Resolve-by-renumber only moves the collision
  forward; this is the strongest evidence for a suffix over renumbering. Main's 400 holds
  12 files; #480 would add/add `task.md` and drop `investigation.md` silently into the
  compaction task's folder.
- ptah-extension-35: TASK_2026_401 lives on the merged PR #469 branch commit e7bd3cca4 and on
  local branch fix/task-401-agent-status-durability (same task, same content, not on the
  remote yet). Not a collision, but the tooling must treat "same id, same task, two
  branches" as one task, which a content hash or the suffix does for free.
- Next free bare number after all known branches: 404.
