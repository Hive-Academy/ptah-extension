# R4 options and a user setting for subagent budget stops (2026-10-14, session 4)

## Facts

- `main` already stops subagents (`SubagentBudgetMonitor`, commit 221537118). On `main` a failed
  handoff is lost. Branch `fix/subagent-handoff-notice` (74347fc75) adds retries, a pending record
  and an undelivered notice. All agent-sdk checks pass on 74347fc75.
- Both R4 defects need `pushParentMessage` to fail first (rare). Normal delivery works.
  - Serious: two close parent messages after a failed push can push one record twice.
  - Partial Blocking: after 5 failed retries, if the turn ends before a tool result drains the
    terminal notice and the session then ends, the parent never sees it.
- Settings today: `compaction.subagentHandoffTokens` (default 150000, context size that stops a
  subagent), `compaction.subagentStopWeightedTokens` (default 3000000, cost guard). The only off
  switch is `compaction.enabled=false`, which also turns off main-session auto-compaction.
- The advanced settings UI branch shows both numbers, but its help text for
  `compaction.subagentHandoffTokens` says the result is "summarised". It is wrong: the subagent is
  stopped and the parent gets a handoff.

## Options

| Option | Effect | Cost / risk |
| --- | --- | --- |
| A. PR now, gaps listed | Users get the much better delivery now | Rare duplicate handoff or lost terminal notice |
| B. One more fix round | Single owner loop per record; record kept until the parent sees it | Fifth round on a 384-line file; new findings possible |
| C. Keep local | Nothing ships | `main` keeps the worse behaviour |
| D. Setting | User can turn the automatic stop off without turning off compaction | Small, separate change |

## Setting design (option D)

- Key: `compaction.subagentAutoStop` (boolean, default `true`). Boolean, so it uses the existing
  toggle control of the advanced settings UI. No new control type.
- `true`: current behaviour. `false`: the near-budget "write your notes" warning stays, but the
  monitor never stops a subagent. No handoff is needed, so the R4 paths cannot run. The subagent
  result comes back through the normal Task tool result.
- Files: `platform-core/src/file-settings-keys.ts` (key + default), `compaction-config-provider.ts`
  (read), `subagent-budget-monitor.ts` (gate next to `compaction.enabled`),
  `settings-export.types.ts`, shared `advanced-settings.types.ts` (one boolean row).
- Not recommended: settings for `PENDING_HANDOFF_MAX_RETRIES` or the push backoff. They do not fix
  either defect and users cannot choose good values.

## Recommendation

A now, then D, then B as a tracked task:
1. Push and open the PR for 74347fc75 with both R4 findings listed as known gaps.
2. Fix the wrong help text on `feat/advanced-settings-ui` before its PR.
3. Task: add `compaction.subagentAutoStop` after the advanced settings PR merges.
4. Task: owner-loop fix (R4 fix text) with one codex review.

## Option E (user proposal, session 4): file-backed handoff

- At the stop, the host writes the full handoff text to a file before any delivery attempt.
  Location: `<Task Folder>/subagent-handoff-<agent-type>-<id8>.md` when the spawning prompt has a
  `**Task Folder**` line that resolves inside `<workspace>/.ptah/specs/`; else the existing
  `.ptah/subagent-handoffs/<id>.handoff.md` (git-ignored). Frontmatter `status: pending`.
- Discovery: (1) convention in the orchestration skill and agent definitions: read any
  `subagent-handoff-*.md` with `status: pending` in the task folder before you start, continue
  from it, then set `status: consumed`; (2) host pointer: while a pending file exists, the
  existing prompt-injection path (`memory-prompt-injector.ts` pattern) adds one line with its path
  to the next main-thread prompt, also in a later session of the same workspace.
- Delivery: keep the 3 push attempts. Success sets `status: delivered`. Then delete the pending
  record, `missed`, retry cap and undelivered notice code. Both R4 defects live in that code.
- Existing parts reused: `.task.md` (prompt) and `<id>.md` (notes) in `subagent-handoff-files.ts`.
