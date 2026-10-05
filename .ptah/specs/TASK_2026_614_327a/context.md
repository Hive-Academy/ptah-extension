# Task Context - TASK_2026_614_327a

## User Request

"can we combine all the remaining and follow up in a task and file it and commit to the PR we opened and give me a
prompt to start on them once i merge that PR in a new session" (2026-10-05, after PR #647 opened).

## Task Type

BUGFIX (continuation of TASK_2026_597_ab22, same strategy).

## Complexity

Complex.

## Strategy

BUGFIX, Partial depth. The plan and Gate 1/2 approvals of TASK_2026_597_ab22 still apply to the deferred stages
(implementation-plan.md, implementation-plan-addendum-n7-n8.md, decisions 1-11 in its context.md). The follow-up
items are review findings with file:line evidence, so they need no new architect pass: a team-leader decomposes them
into batches of about 6 files. New design work (only where an item below says "design call") goes to the user first.

## CLI Lanes

Disabled unless the user enables them at Gate 0.1 of the new session.

## Rules (carried over, strict)

- Decision 8 token rules R1-R5 and decision 11 review policy from TASK_2026_597_ab22 context.md § User Decisions:
  R1 each developer/reviewer run stops at about 150k context or 60 tool calls and writes a progress note; R2 batches of
  about 6 files; R3 the orchestrator commits a clean batch after `di-lint:lint`, `degradation-audit:lint` and the
  scoped typecheck (all importers when a libs/shared type changes); R4 Sonnet for mechanical roles, Opus for logic and
  code-logic review; R5 short check output. One code-logic review per phase on the combined diff (+ Sonnet style only
  for new public API), at most one fix round, one short re-review.
- Restore rewritten baseline PNGs before each commit. Commit messages through a Bash heredoc; commits in the background.
  Skills/agents/plugin asset changes: `npm run manifest:generate` and commit `content-manifest.json`.
- Max 3 agents at once. Ask before push/PR unless the user says otherwise in the new session.
- Avoid the files of TASK_2026_609_c495 (agent-generation services/templates, `.claude/agents`, the system-prompt parts
  of `sdk-query-options-builder.ts`).

## Workspace lessons (from TASK_2026_597 Handoff 5)

- A new worktree needs a `node_modules` junction to the main checkout. Without a generated Prisma client, `api-*`,
  `ptah-license-server` and `ptah-landing-page-e2e` fail typecheck: exclude them from affected sets (CI checks them).
- Judge checks by exit code, not by grepping colored Nx output.
- Load flakes that pass alone: `session-handoff-writer.spec.ts`, `subagent-message-dispatcher.spec.ts`,
  `markdown.reducer.spec.ts`, `electron-shell.review-dock.spec.ts`.
- Merge the latest `origin/main` and re-run scoped checks on the merged branch BEFORE pushing.

## Work list

Source of truth for details: the file named in each line (paths under `../TASK_2026_597_ab22/`).

### Stage A — S3 rest (compaction settings, Codex config, usage UI)

Batch bodies: `batches.md` Batches 12-15, 16 (Task 16.1 only), 17 (Task 17.2 only), 18-22. Re-validate paths first:
the bodies still name the old `task-597-lane-token-burn` worktree, and Wave D already landed 16.2, 16.3, 17.1, 17.3-17.5.

- A.1 Batches 12-15: Ollama window, proxied predicate, Responses translator, OpenCode lane config and usage split,
  strict MCP on proxied routes, cache flag, ledger cost, skill budget cache columns.
- A.2 Task 16.1 + Task 17.2: `compaction:getConfig`/`setConfig` RPC with the one-shot migration of
  `compaction.threshold` into the file store (never clobbers; reads the raw VS Code value, `inspect()` if needed).
  Wave D kept `compaction.threshold` in VS Code settings on purpose (R-W1).
- A.3 PR1-M2: a live change to `compaction.enabled` is not applied (`session-lifecycle-manager.ts:~409`).
- A.4 Batches 18-19: Codex config TOML writer and RPC (opt-in, diff preview, rule 561 A9).
- A.5 Batches 20-22: frontend settings state, lane budgets card (also binds the Wave D lane-guard and compaction
  keys), usage displays and the no-cache hint.

### Stage B — S1b and S2

- B.1 Batches 8-9: `CodexExecRunner` and the adapter switch to the runner, with Task 9.3 (model-rejection matcher
  accepts dotted model names).
- B.2 Batch 11: lane capture entries for tool M.

### Stage C — QA session (decisions 5-7 of TASK_2026_597)

Small budgeted runs only (at most 5 short headless runs per runtime). Items: experiment E2 (does the SDK honor
`autoCompactWindow`; gates decision 2 and the tighten stage, and is the condition for leaving OBSERVE_ONLY in the
compaction coordinator); N1 "after" measurement (needs `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` cleared, user
approval); before/after screenshots (dark + light) for Batches 39, 47, 60, 61; PR 3 scripted 2M-token session; one
proxied-route run in the cost unit; the transcript-fix check; Batch 36 p95 to set the final
`compaction.subagentStopWeightedTokens` (provisional 3,000,000).

### Stage D — follow-ups from the S4-b review (PR #647)

Files: `reviews/s4b-code-logic-review-a.md`, `-b.md`, `s4b-code-style-review.md`, `s4b-code-logic-rereview.md`.

- D.1 A-M1: the Read outline keeps the original line numbers/counts (`tool-output-capper.ts:~296-306`).
- D.2 A-M2: compaction tracker and subagent monitor are released only on abort; a run that ends normally keeps state
  (`session-query-executor.service.ts:~508-512`).
- D.3 A-M4: the subagent stop has no off switch and ignores `compaction.enabled` (`subagent-budget-monitor.ts:~257-270`).
- D.4 B-M3: OpenCode bash calls arrive as `command` segments, which the lane guard does not count
  (`opencode-cli.adapter.ts:~833-848`).
- D.5 B-M5: "Keep this session" is lost when the banner is rebuilt (`chat-view.component.html:~136`).
- D.6 B-M6: "Rotate session" can reuse an older handoff copy (`session-budget.service.ts:~700-703`).
- D.7 28b: the effective subagent prompt-cache TTL is not passed to the monitor (5m weight used).
- D.8 28a: the parent handoff message has no task text and skips the dispatcher ordering lock; a failed
  `stopSubagent` is never retried; coordinator listener errors are rethrown uncaught (review A notes).
- D.9 Re-review Minors: N1 the fallback warn logs the defaults, not the invalid values
  (`agent-spawn-environment.service.ts:~215-234`); N2 unchecked `as number` on the defaults lookup
  (`compaction-config-provider.ts:~148`); N3 the spool `.gitignore` catch logs nothing (`spool.ts:~181-184`).
- D.10 The CLI host does not bind `SDK_CODE_OUTLINER` (reducer fallback; needs a `vscode-lm-tools` import in
  cli-engine and `TREE_SITTER_PARSER_SERVICE`).
- D.11 Design note from review A: the 27b message tap is a watchdog subclass in the executor file; an explicit
  message callback on the stream transformer is cleaner (design call: refactor or accept).
- D.12 The Minors listed in the three S4-b review files.

### Stage E — follow-ups from S4-a (PR #642)

Files: `reviews/s4a-code-logic-review.md`, `s4a-code-logic-rereview.md`, `s4a-code-style-review.md`.

- E.1 M3: a Codex lane with no rollout figure falls back to the turn total.
- E.2 M4: the `run_check` Nx process is not killed on cancel or host exit.
- E.3 M5: waits cannot be cancelled.
- E.4 M6: idle-lane continuation and `spawnFromSdkHandle` skip the resume gate.
- E.5 RM1: the `ptah_run_check` description still says "worktrees too" while HTTP refuses a worktree outside every open
  folder. RM2: a worktree without `node_modules/nx` gets "Nx was not found".
- E.6 SM1: the 900 s wait ceiling is defined twice. SM2: `openWorldHint: false` on run_check.

### Stage F — follow-ups from PR 3 (#639) and PR 2 (#637)

Files: `batches.md` § "PR 3 phase-end reviews", § "Batch 47a", the PR 2 review block before it, and § "Named later
tasks"; review files `pr3-phase-end-code-logic-review.md`, `pr3-phase-end-code-style-review.md`,
`pr2-phase-end-code-logic-review.md`.

- F.1 PR3-M1 restore `failed` shape vs `session-budget.types.ts`; PR3-M3 empty/failed handoff read not flagged; PR3-M4
  v4-only UUID check; PR3-M5 handoff actions accepted for unknown sessions; PR3-M6 chat-view `resolvedSessionBudget`
  ordering and clearing; PR3-M7 entry release on eviction, `/clear` and headless child sessions; PR3-M8 `/compact`
  exemption cannot lower a cumulative measure.
- F.2 PR3-S1 split `chat-view.component.ts` and `session-stats-summary.component.ts`; move the "Continue in new
  session" and the new "Rotate session" flows out of chat-view (style Moderates; use the `humanize-library` skill).
- F.3 #639 CI-fix review Moderates: the sibling percent draft can auto-save before blur; `settings:set` keeps the 30 s
  default timeout.
- F.4 N7-M1: `canSend` reads `sessionBudget.enabled` directly; turning it off at `limit` keeps blocking until the next
  result or resume. The `sessionBudget.enabled` Moderate from decision 7.
- F.5 PR2-M1 `markAllInterrupted` does not stamp `lastActivityAt`; PR2-M2 subagent usage entries without a record are
  never evicted; PR2-M3 cost estimate low without a cache price or on a mid-run model change; PR2-M4 rekey a pending
  identity that holds a placeholder tab id; PR2-M5 evict pending identities when `agent_start` never arrives; PR2-B1
  backend binding of `agentId` when SubagentStart has no `toolUseId`.
- F.6 The PR 2 / PR 3 Minors in their review files (tooltip hard-codes 50/80/100%, failed preview keeps "Loading…",
  `.tmp` orphan, `keepPreviousFigure`).

### Stage G — follow-ups from the D + E phase review

Files: `reviews/de-code-logic-review-a.md`, `de-code-logic-review-b.md`, `de-code-style-review.md` (this folder). FM-3 was
fixed in the D + E fix round. These Moderates are named later tasks (they cannot break a lane config or lose data):

- G.1 A FM-1: threshold and env-window warns still fire on every `getConfig()` (A-m7 partial).
- G.2 A FM-2: monitor rekey loses ordering against buffered old-id subagent messages (stop fires late).
- G.3 B-1: a failed tree kill still replies "the process tree was killed" and drops the pid after 10 s
  (`run-check.tool.ts:468, 489-495`).
- G.4 B-2/B-3 + style 1: one shutdown contract for `killRunningChecks` — VS Code awaits it before reaping agents (up to
  5 s), Electron fires it without a wait (`shutdown.ts:194-198`); drop the redundant catch or the "never rejects" doc.
- G.5 B-4: pin tests for `mcp-serve` passing the peer JSON-RPC id and the drain calling `dispose()`.
- G.6 B-5: the RPC reply and log do not say when a UI resume became a fresh lane (`agent-rpc.handlers.ts:1068-1074`).
- G.7 style 2: rename `SubagentStopPort` (it now also pushes parent messages).
- G.8 The Minors in the three review files; Task 8.3 gap (`execute_code` has no cancel hook, so `ptah.agent.waitFor`
  ends only at its timer); review-A m5 (`stopped` subagent status, libs/shared change); CLI default-model blocked check;
  the vscode-lm-tools dispatcher does not log the spool `gitignoreFailure`; Batch 13 before/after screenshots (dark +
  light) of the session budget banner go to the Stage C QA session.

### Stage H — follow-ups from the F + G phase review (PR for F + G)

Files: `reviews/fg-code-logic-review-a.md`, `-b.md`, `-c.md`, `fg-code-style-review.md`, `fg-code-logic-rereview.md`
(this folder); `batches.md` § "Named later tasks (Stage F + G)". Fixed in the F + G fix round: A-S1 (partial), A-M5,
B-M1, B-M2, C-S1, style-S1. These Moderates are named later tasks (they cannot break a lane config or lose data):

- H.1 NL-F2 (needs a user decision): A-S1 rest. With F-F exact `agentId:` matching, a foreground Task returns its
  `agentId:` line only after the subagent stops, so a running foreground subagent whose start has no `toolUseId` cannot
  be stopped or steered. Option: bind when exactly one candidate Task call is in flight (revisit F-F).
- H.2 A-M1: after `release`, an old-id message creates a fresh monitor record that is never released
  (`subagent-budget-monitor.ts:~421-456`; the spec does not check the old id).
- H.3 A-M2: an exact `agentId` match on a `completed` record is logged "bound" but stays `completed`
  (`subagent-hook-handler.ts:~352-375`).
- H.4 A-M3: the preview and rotation-seed handoff drop `readStatus` (`session-budget.service.ts:~767`).
- H.5 A-M4: a failed child interrupt lets a late figure recreate a budget entry that is never released.
- H.6 B-M3: after an `execute_code` cancel or timeout, later `ptah.*` bridge calls still run (no abort check); a
  timeout does not end `waitFor`.
- H.7 B-M4: a check that starts after the shutdown kill snapshot is not killed (`shutdown.ts:~426-446`, `main.ts`).
- H.8 C-M1: a stale stats snapshot after F-D can re-show the paused limit banner (`tab-manager.service.ts:~2280-2292`).
- H.9 Style M1 (naming drift after the `SubagentBudgetDispatcherPort` rename) and style M2 (`clearSessionBudgets()`
  reaches into `workspacePartition.findBackgroundTabIds` with an inline predicate).
- H.10 NL-F1 (Task 33.6): the stats-chip tooltip hard-codes 50/80/100%; using the configured percents needs a
  `SessionBudgetState` field (libs/shared) and backend data.
- H.11 G-C: the `stopped` subagent status (libs/shared union, saved history, frontend badges) — a feature, deferred by
  the user.
- H.12 The Minors in the four review files and the re-review: review A m1-m5, review B five Minors (late-`close` kill
  text, duplicate-id reply, `.gitignore` suppression reset, unbounded `setConfigQueue` write, Electron kill before the
  final flush), review C m1-m8, the style Minors, and the 4 re-review Minors (e.g. the held-start binding check runs on every tool
  result, not only Task results).
- H.13 Process note: R1 breaches in this stage (Batch 16: 94, 22: 84, 33: 117, 25: 71, 29: 64, 28: 61, fix A: 77 tool
  calls); briefs for Stage A must split work smaller (about 4 files, at most 4 tasks per batch).

## Suggested order

1. Stage D + Stage E (small, file-local fixes; can share the first PR).
2. Stage F (F.2 is a refactor of chat-view: run it after D.5/F.1 touch chat-view, not in parallel).
3. Stage A, then Stage B.
4. Stage C last (QA with live proof), then close TASK_2026_597_ab22 and this task.

## User Decisions (Stage F + G, 2026-10-05)

All recommended options from `batches.md` § "Stage F + G batches" › "Decisions for the user":

- F-A: new `restore-failed` reason. F-B: proposed UI wording accepted. F-C: `/compact` at the limit is a copy change
  only. F-D: clear the limit banner state on every tab when `sessionBudget.enabled` is saved off. F-E: price each
  request with its own model, "unknown" (not 0) when the cache price is missing. F-F: exact `agentId:` match only.
- G-A (G.4): `killRunningChecks` is awaited with a timeout (up to 5 s) on both hosts. G-B (G.7): rename
  `SubagentStopPort` to `SubagentBudgetDispatcherPort`. G-C (G.8 m5): the `stopped` subagent status is deferred as a
  named later task (Batch 34 dropped). G-D (G.6): RPC result and log only. G-E (FM-7): accept and document (Task 18.4
  becomes a doc note).
- CLI lanes stay disabled (Gate 0.1). Push and open the F + G PR without asking.

## Conversation Summary

- 2026-10-05: created at the end of the fifth TASK_2026_597 orchestration session, committed with PR #647. The user will
  start it in a new session after PR #647 merges.
- 2026-10-05: Stage D + E merged as PR #650. Stage F + G done on `fix/task-614-stage-f-g` (Batches 16-33, 35, 36;
  Batch 34 dropped by G-C), one phase review (logic A/B/C + style), one fix round, one re-review. Deferred items are
  Stage H. Next: Stage A, then B, then C (Stage H items can join Stage A batches that touch the same files).
