# HANDOFF — TASK_2026_855_d4b6

## Goal

Fix how plugin config (skill enable/disable) is inherited by sessions that run in a child
worktree. Root cause, from `/home/amun/ptah-extension/.ptah/specs/INVESTIGATE_SKILL_OVERRIDES/report.md`:
plugin config is saved only for the main checkout. A session running in a worktree resolves
policy against its own root, finds no config there, and gets disabled skills. OpenAI lanes
always run in worktrees.

The user approved the design and plan, and they are being carried out as 6 sequential batches
(`batches.md`). Settled decisions:
- `pluginConfigAncestorRoots?: readonly string[]` on session metadata and `AISessionConfig`,
  ordered nearest ancestor first. Absent means legacy; `[]` means explicitly independent;
  malformed values fail closed.
- Precedence: child explicit setting > nearest ancestor > farther ancestors > global > defaults.
  Agent disables stay local.
- Execution cwd, MCP trust, imports/approvals, plugin files and the harness all stay at the
  execution root. MCP trust is never shared.
- Commits and pushes are held. The orchestration args say "Do not commit/push without current
  explicit request", and that overrides CLAUDE.md's standing authorization (logged in
  decisions.md). Ask the user at delivery.

## Done

Everything is uncommitted in worktree
`/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy`, branch
`fix/worktree-session-policy`.
- Batches 1–5 are COMPLETE and accepted. My own verify runs: B1 59/59, B2 59/59, B3 56/56,
  B4 61/62 (the rpc-handlers failure was inconclusive because a lane was editing it at the
  time), B5 59/59 (rpc-handlers, agent-sdk and the 3 hosts; this settles B4).
- Each batch has a report: `batch-N-report.md` in the task folder.
- Batch 4 changed:
  - `libs/shared/.../ai-provider.types.ts`
  - `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`: lineage field, a static
    `readPluginConfigAncestorRoots`, `upgradeLegacyPluginConfigAncestorRoots`, and
    preservation of lineage on save.
  - `sdk-agent-adapter.ts`
  - `session-query-executor.service.ts`
- Batch 5 changed `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
  (lineage capture and restore, refusal for a mismatched or unresolved source) plus specs.
  It also added `session-metadata-store.lineage.spec.ts` and `sdk-agent-adapter.lineage.spec.ts`.

## In progress

Batch 6 (final) is IN_PROGRESS on Codex lane `b27fc7bd-c609-437a-aefa-1b2cc275f7f8` (CLI
session `01a18cc3-85bc-72a1-ba7e-f1336278d3f1`). It started 12:23 and was still running at
handoff. Its deliverable is `batch-6-report.md`. Its scope:
- `libs/backend/rpc-handlers/src/lib/chat/session/session-folder.ts` and its spec: physical
  validation of every governing root (realpath, authorization, safety, availability, symlink
  escapes and aliases, physical dedupe) before any read or SDK call.
- Remove the fallback from a distinct saved cwd to the parent. That case must return
  `SESSION_FOLDER_UNAVAILABLE` with no parent SDK resume, and the old fallback tests near
  spec lines 59-62 and 82-96 get replaced.
- Apply the same validation in `chat-session.service.ts` at every entry point: child/handoff,
  activation, inactive continue, rewind and restore. Update the related specs.

## Open problems and decisions

- No blockers.
- Commit/push and PR need the user's explicit go-ahead.

## Key files

All paths are under the task folder
`/home/amun/ptah-extension/.claude-worktrees/worktree-session-policy/.ptah/specs/TASK_2026_855_d4b6/`:
- `implementation-plan.md`: the approved design.
- `batches.md`: batch statuses. Set Batch 6 to COMPLETE when it is accepted.
- `decisions.md`: append-only decision log.
- `batch-5-report.md`: Batch 6's handoff notes.

## Background work

- Lane `b27fc7bd-c609-437a-aefa-1b2cc275f7f8` (codex), Batch 6, running. Its completion
  signal goes to the new session. Read it with `ptah_agent_read`.

## Next steps

1. When Batch 6's `<agent-lane-completed>` arrives, read `batch-6-report.md`. Inspect the
   `git diff` of `session-folder.ts` and `chat-session.service.ts` and confirm two things: the
   parent fallback is gone, and validation is physical (realpath), not lexical.
2. Run from the worktree:
   `npm run verify -- -t test,lint,typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/agent-sdk,ptah-electron,ptah-tui,ptah-extension-vscode > /tmp/b6-verify.log 2>&1; grep -aE "NX +[0-9]+ tasks|✖" /tmp/b6-verify.log`
3. Mark Batch 6 COMPLETE in `batches.md` and log it in `decisions.md`.
4. Spawn an independent code-logic review on the combined task diff (`git diff main`) using a
   grok lane, which is a different family from codex. Deliverable: `code-logic-review.md` in
   the task folder. Fix Blocking and Serious findings in one round (via a lane), re-review the
   fixes, then re-run the verify from step 2.
5. Deliver: summarize the result, then ask the user whether to commit, push and open a PR.
   Keep the worktree and branch either way.
