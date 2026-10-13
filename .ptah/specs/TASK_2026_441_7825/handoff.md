# Handoff - TASK_2026_441_7825 (after Phase 1)

Date: 2026-10-13. Written by the orchestrator at the end of session 1.

## Where the work is

| Item | Value |
| --- | --- |
| Worktree | `D:\projects\ptah-extension\.claude-worktrees\task-441-lanes-first-c89362de48e8` |
| Branch | `task-441-lanes-first` (from `origin/main` at `43803ee7e`), pushed, draft PR open |
| Task status | `in_progress` (`task.md`) |
| Strategy | REFACTORING, Partial. Gate 0.1 = `enabled` (lanes-first), Approval = `lane-review` |
| Phase 1 (Batches 1-4 + 4F) | COMPLETE and reviewed |
| Phase 2-4 (Batches 5-8) | PENDING |

## Source of truth (do not get this wrong)

- Edit the shipped plugin: `apps/ptah-extension-vscode/assets/plugins/ptah-core/` (skills
  `orchestration`, `agent-lanes`, `tribunal`; commands `orchestrate*.md`; `.claude-plugin/plugin.json`).
- Edit agent templates: `libs/backend/agent-generation/templates/agents/`.
- Never edit `.claude/skills/**`, `.claude/agents/**`, `.codex/**`, `.opencode/**` as a source. The
  `.claude/skills/{orchestration,agent-lanes,tribunal}` copies are git-tracked and now out of date with
  the plugin. That drift is known and not in scope (ask the user before syncing them).
- Exception (user-approved): delete `.claude/skills/fleet-orchestration/` in Batch 5.

## What Phase 1 shipped (commits on the branch)

| Commit | Content |
| --- | --- |
| `2e0811f0a` | Validator `scripts/validate-orchestration-skill.ts` reads the plugin + templates; lanes-first rule markers |
| `3c107d09c` | Lanes-first policy in plugin `orchestration` (SKILL, checkpoints, lane-assignment, team-leader-modes) and `agent-lanes` §4-§6 |
| `314813c3e` | Generic fleet mode: new `references/fleet.md`, `git-standards.md`, `commands/orchestrate*.md` |
| `f52ba626e` | Generic git-standards sections restored (user decision, row 12) |
| `5991b51be` | team-leader template lanes-first `batches.md` schema + `team-leader-template.policy.spec.ts` (4 tests) |
| `6c57bf67e` | Phase 1 review fixes (destructive-command list, §4 bounded re-check, checkpoints cell, prose markers) |
| (this session's last commit) | R1: `orchestration/SKILL.md:153` status-check sentence aligned with agent-lanes §4 |

Checks at handoff: `npm run validate-skill` = 0 errors, 0 warnings (9 files). Policy spec 4/4 pass.
`npx nx lint agent-generation` passed.

## Next steps (in order)

1. **Batch 5 - Repo-local fleet migration** (`batches.md` § Batch 5). Delete
   `.claude/skills/fleet-orchestration/`; keep repo-specific rules (commitlint scope enum, Nx run-many
   header check, Workflow resume caveat) repo-local in `CLAUDE.md` / `.claude/workflows/fleet-fix.js`;
   update `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts`
   (lines ~228, ~299). Risk: `fleet-fix.js:135` lets a worker write `task.md` status, which contradicts
   `fleet.md:36` (only the orchestrator writes it) — align or record.
2. **Batch 6 - Benchmark fixture** `tools/mcp-bench/fixtures/memory-skills/skill-triggers.v1.jsonl:6`.
   HIGH risk: hash-pinned in `MANIFEST.json:54`, read by `committed-u4-labels.spec.ts:31`. Investigate
   first; stop without editing if pinned.
3. **Phase 2 review** after Batch 6: one code-logic review of Batches 5-6 by a family that did not
   implement them.
4. **Batch 7 - Packaging:** bump `ptah-core/.claude-plugin/plugin.json` (1.6.0 -> next),
   `node scripts/generate-content-manifest.js` once, after all plugin edits.
5. **Batch 8 - Walkthrough:** manual Gate 0.1 + quota-fallback walkthrough recorded in
   `test-report.md` (acceptance criteria that cannot be static).
6. Team-leader Mode 3, then QA, then mark the PR ready and ask the user before merge.

## Deferred (named later tasks, not in this run)

- **L1** agent-lanes §5: name the final in-process fallback (review Finding 6, Minor).
- **L2** plugin `orchestration/SKILL.md:150` names `nx run-many` in a stack-neutral plugin.
- **Runtime follow-up** (plan revision 2, finding 5): expose `failureKind` in `ptah_agent_status`
  formatting; optional session record of an exhausted lane in memory.
- **TASK_2026_646_136a** (backlog, committed on this branch): optional decision
  model + `ptah_route_decide`. Depends on this task.

## Lane notes from session 1 (useful for routing)

| Lane | Result |
| --- | --- |
| codex | Did every Phase 1 implementation batch. Reliable; usually 2-5 min per batch. Plan revision needed a fix round |
| Glm (ptah-cli, Ollama Cloud, `pc-355b645d-35af-4974-84cf-9cf961ea0164`) | Good reviewer (found real issues) but expensive: one `repeat-call` stop on a long review; a 4-file re-review used ~215k tokens / 12 min. Give it narrow scope and "read each file once" |
| grok | AT LIMIT until 2026-10-13 17:40 UTC |
| antigravity, opencode | Installed, not used yet; candidates for the Phase 2 review (non-codex) |
| copilot | Disabled |

Runtime behaviour observed (now written into agent-lanes §4):
- One `<agent-lane-completed>` signal is sent per lane **turn**. A message queued with
  `ptah_agent_message` runs as a new turn after `delivered` and can change the deliverable again.
  Do not review while a queued message is pending; avoid queued follow-ups, put everything in the spawn.
- Resume is refused above ~60k tokens of lane context; the runtime starts a fresh lane with a handoff
  brief instead. Give complete instructions in every resume prompt.

## Files to read first in the next session

`context.md` (scope 1-7, Source of truth), `decisions.md` (rows 1-23), `batches.md` (Batch 5 onward,
Fixed vocabulary, Later tasks), `implementation-plan.md` (revision 2), this file.
