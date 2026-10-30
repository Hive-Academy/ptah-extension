# HANDOFF — TASK_2026_853_897f (session prefix diet) + CLI-lane prompt task

Written 2026-10-30 ~19:15 UTC. Supersedes the HANDOFF.md copies in the other worktrees.

## Goal
Cut Ptah's ~48.9k-token fixed session prefix in four phases, each its own PR
(implementation-plan.md:3-5): **A** built-ins default-off, **B** hide claude.ai-synced skills,
**C** remove duplicate prompt text, **D** workspace scope as install default (Batches 17–35, 41,
36–40, then F-D4 after screenshots). Specs: `batches.md`, `implementation-plan.md`,
`decisions.md` (#1–#52) in this folder.

Extra user task (decision #51): "Make CLI lanes a first-class delegation option" — brief in
`/home/amun/ptah-extension/.claude-worktrees/cli-lane-prompt/.ptah/specs/TASK_2026_853_cli_lanes/task.md`.
User chose: own PR, **stacked on Phase C**.

User decisions this session: parallelize with lanes + subagents (#48); Phase C before B shipped,
stacked PRs; token measurement with the real login was authorized once (done for B).

## Done
- **Phase A**: PR #854 **merged** (merge commit `286609dab`).
- **Phase B**: PR **#862** https://github.com/Hive-Academy/ptah-extension/pull/862 — base `main`,
  branch `feat/session-prefix-diet`, head `4ae87db85` (= `e3122346b` Phase B commit + merge of
  origin/main). CI: 19 pass / 4 skipped / 0 fail. Review: REVIEW_REQUIRED, 0 reviews, no CodeRabbit
  comments yet. Verify 79/80 (only pre-existing `ptah-extension-webview:lint`). Codex review
  APPROVED 8/10 after fix round (`code-logic-review-phase-b.md`). Electron UI PASS
  (`reports/phase-b-electron-after.md`). Tokens: −3,153 per main session and per subagent.
- **Phase C**: PR **#863** https://github.com/Hive-Academy/ptah-extension/pull/863 — base
  `feat/session-prefix-diet` (stacked), branch `feat/session-prefix-diet-c`, head `b0b2de490`.
  Commits `a4ba0f392` (Batches 13/15/16), `3af55a21f` (merge of B; manifest regenerated),
  `b0b2de490` (Batch 14). Codex APPROVED 8/10 + Batch 14 follow-up APPROVED
  (`code-logic-review-phase-c.md`). CI does not run on stacked PRs (workflows filter
  `branches: [main]`); comment posted on #863. CI will run when #862 merges and #863 retargets.
- Known load flakes (pass alone): `InternalQueryQueueTimeoutError` in agent-sdk suites
  (`user-prompt-submit-hook-handler`, `session-query-executor.input-channel-failure`,
  `session-usage-ledger-cache`), Jest 5 s timeouts in `analysis-namespace.builders.spec.ts`.
- Lane limit: kimi code (pc-7594dcab-…) hit 429 rate limit, reset unknown — skip it this run
  (`context.md`). Codex is the only lane with room.

## In progress
1. **Phase D Batch 17** (worktree `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d`,
   branch `feat/session-prefix-diet-d` from `b0b2de490`, not pushed). Uncommitted edits by a
   backend-developer subagent: `libs/shared/src/lib/types/rpc.types.ts`,
   `rpc/rpc-agents.types.ts`, `rpc/rpc-plugin-marketplace.types.ts`, plus
   `reports/batch-17.json` (status PENDING_VERIFY) and decision #52 in `decisions.md`.
   Its verify (`/tmp/tpd-b17-verify.log`) was STOPPED: 40 succeeded, 1 stopped
   (`ptah-extension-vscode:build-esbuild:production`), 27 skipped. **Unverified, unreviewed.**
   The subagent lives in the old session and is lost.
2. **CLI-lane prompt task** (worktree `/home/amun/ptah-extension/.claude-worktrees/cli-lane-prompt`,
   branch `fix/cli-lane-prompt` from `3af55a21f`, not pushed, all uncommitted — 17 files incl.
   deleted `vscode-lm-tools/.../ptah-system-prompt.constant.ts`). Codex implemented A–D
   (`implementation-report.md`; budget 3,143 → 3,219 tokens, pin 3,380). Coordinator fixed two
   stale comments (`diagnostics-cache-invalidator.service.ts`, `cli-adapter.utils.ts`).
   Targeted re-runs passed (flaky suites alone 2/2; lint+typecheck cli-agent-runtime,
   vscode-lm-tools 4/4). Claude review: REVISE 7/10 (`code-logic-review.md`). **Revise round 1
   of 2 is running in a codex lane** (see Background work): restore pre-flight
   `ptah_route_decide` fallback when no `Routing:` reminder (both orchestration skill copies),
   named browser-tool exemption in lane-policy-sync.spec, `ptah_agent_wait` in deferred test +
   no count in title, split dense lane paragraph, new core-prompt pins. Minor defect 3
   (dropped subagent_type roster) declined: the Agent tool lists its own types.

## Open problems and decisions
- PR #862 and #863: no human or CodeRabbit review yet. Never merge.
- CLI-lane acceptance criteria "fresh Electron session lists ptah_agent_list/spawn" and
  "'review my last commit and add tests' spawns a lane" need a real Electron session with the
  user's login → ask the user before running it.
- Worktree `session-prefix-diet-cifix` (detached, Phase A CI fix) can be removed now that #854
  merged — only with user authorization.
- Uncommitted HANDOFF.md / context.md edits in `session-prefix-diet` and `session-prefix-diet-c`
  are notes only; `context.md` (B worktree) has the kimi limit record — commit it with the next
  B-branch change if any, or copy into D.

## Key files
- `/home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d/.ptah/specs/TASK_2026_853_897f/batches.md` — Phase D batches 17–41, owners (line ~47), verify sets V-SHARED/V-RPC/V-LANE/V-SDK/V-GEN (lines 69–75).
- `.../TASK_2026_853_897f/decisions.md` — #1–#52; append new decisions here (D worktree is now canonical).
- `.../TASK_2026_853_897f/reports/batch-17.json` — Batch 17 type handoff and producer/consumer map.
- `/home/amun/ptah-extension/.claude-worktrees/cli-lane-prompt/.ptah/specs/TASK_2026_853_cli_lanes/{task.md,implementation-report.md,code-logic-review.md}`.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` — core prompt (Phase C and CLI-lane task edit it).

## Background work
- Codex lane **84a26913-011b-4bce-8634-87b552347711** — CLI-lane task revise round 1, workingDirectory
  `cli-lane-prompt`, deliverable: `## Revise round 1` section in `implementation-report.md`;
  its verify `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/agent-sdk`
  → `/tmp/cli-lane-verify2.log`. State at handoff: running (verify in lock slot 1).
- Batch 17 subagent: lost with the old session (its edits are on disk).

## Next steps
1. When the codex lane signals: read `## Revise round 1`, check the diff of the five fixes,
   `tail /tmp/cli-lane-verify2.log`. Then re-review (claude code-logic-reviewer subagent,
   different family from codex) → append `## Round 1 re-review` to `code-logic-review.md`.
   Cap: 1 more revise round, then one bounded correction.
2. Ask the user whether to run the CLI-lane Electron acceptance checks with their login.
3. Commit the CLI-lane task in `cli-lane-prompt` (foreground; scopes e.g.
   `fix(agent-sdk,vscode-lm-tools,shared,agent-generation)` ≤72 chars; read `.commitlintrc.json`;
   stage explicit paths incl. the deleted file, `content-manifest.json`, both skill copies,
   `.ptah/specs/TASK_2026_853_cli_lanes/`; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).
   Push in background, `gh pr create --base feat/session-prefix-diet-c` (stacked on #863), body
   ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`; add the same CI note.
4. Batch 17: inspect the diff against batches.md Batch 17 + implementation-plan.md 650-800,
   863-896. Re-run V-SHARED in the background, save + filter:
   `cd /home/amun/ptah-extension/.claude-worktrees/session-prefix-diet-d && npm run verify -- -p @ptah-extension/shared,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,@ptah-extension/cli-engine,ptah-extension-webview > /tmp/tpd-b17-verify2.log 2>&1; grep -E "tasks:|✖" /tmp/tpd-b17-verify2.log`
   Update `reports/batch-17.json`, commit Batch 17.
5. Continue Phase D in listed order (18, 20‖21, 19, 22–24, 25–26, 27–29, 30–35, 41, 36–40, F-D4
   after screenshots), claude subagents implement, codex reviews (decision #52). Phase D
   review = code-logic + style + visual after Batch 40. One PR for D stacked on #863.
6. Watch #862/#863 (`gh pr view <n> --json reviews,comments,statusCheckRollup`); fix confirmed
   CodeRabbit findings in new commits; when #862 merges, merge `origin/main` into C (and D,
   CLI-lane) branches and confirm #863 retargets to main and CI runs.

## Rules (repeat to every subagent and lane)
Worktrees only, never the main checkout. Verify only with `npm run verify -- -p <changed + dependent hosts>`
(lock queues; never workspace-wide, never nx run-many; save output to a file and filter;
background long runs). Other heavy commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
No build/serve/e2e except Electron screenshot launches, never a long-running app under the lock.
Electron first; keep all hosts compiling. Never stage node_modules links or
`.ptah/specs/TASK_2026_854_8f0d/`. No DB deletion, settings/account changes or credential use
without asking. Never merge, force-push, or remove worktrees (incl. `session-prefix-diet-cifix`).
Commit in the foreground, push in the background. Append decisions to `decisions.md`.
