# HANDOFF — TASK_2026_853_897f (session prefix diet) + CLI-lane prompt task

Written 2026-10-31. Supersedes every earlier HANDOFF.md copy in other worktrees.

## Goal
Cut Ptah's ~48.9k-token fixed session prefix in four phases, each its own PR
(implementation-plan.md:3-5): **A** built-ins default-off, **B** hide claude.ai-synced skills,
**C** remove duplicate prompt text, **D** workspace scope as install default (Batches 17–35, 41,
36–40, then F-D4 after screenshots). Specs are in this folder: `batches.md`,
`implementation-plan.md`, `decisions.md` (#1–#56).

Extra user task (decision #51): CLI lanes as a first-class delegation option, PR #865.

User decisions: parallelize with lanes and subagents (#48); claude subagents implement and codex
reviews (#52); kimi is rate-limited, so skip it.

## Done
- **Phase A** #854, **Phase B** #862, **Phase C** #863: all merged to main.
- **CLI-lane PR #865** https://github.com/Hive-Academy/ptah-extension/pull/865
  - Branch `fix/cli-lane-prompt`, worktree `.claude-worktrees/cli-lane-prompt`, head `6cad35945`.
  - CodeRabbit comment 4428834485 fixed in `6cad35945` and answered (discussion_r4429112684).
  - CI on `6cad35945`: 19 pass, 4 skipped. Review state REVIEW_REQUIRED (needs a human approval).
- **Phase D** (worktree `.claude-worktrees/session-prefix-diet-d`, branch `feat/session-prefix-diet-d`, NOT pushed, PR will target `main`):
  - `850dc070c` Batch 17, `19987358a` merge of origin/main.
  - `60d9d8db8` Batch 21 retirement/proof contracts (shared, harness-sync).
  - `6da2753b5` Batch 20 skill-sync gate defaults to owned slugs.
  - `e08435c34` Batch 18 MCP intent v2 + scoped installer.
  - Combined verify 18+20+21: 74 tasks, 72 succeeded; failures only the known env spec + webview lint.

## Batch 19 (committed this session)
- Resolver boundary: listFor per canonical workspace, global ∪ local merge, retired sources on
  every resolution. Coordinator added an empty-root-id guard (decision #56).
- V-SYNC verify: 68 tasks, 66 succeeded (only the known failures). After the fix: harness-sync
  lint + typecheck pass; tests 648/650 (only agent-workspace-scope.spec.ts).

## Known non-batch failures (ignore)
- `harness-sync/.../agent-workspace-scope.spec.ts` 2 tests: environmental, because
  `/home/amun/projects/.ptah` exists. Do not touch that folder.
- `ptah-extension-webview:lint`: pre-existing on main.

## Open questions for the user
- CLI-lane Electron acceptance checks for #865 need the user's login (no answer yet).
- Worktree `session-prefix-diet-cifix` and the merged B/C worktrees may be removed only with user authorization.

## Next steps
1. Continue Phase D in order: 22–24, 25–26, 27–29, 30–35, 41, 36–40, then F-D4 after screenshots. Batch 22+ must pass `state.retired` into reconcile options and the planner (batch-21 contract). Claude backend-developer subagents implement; codex reviews code-logic + style; visual review after Batch 40. Commit each batch separately.
2. Check #865 review state with `gh pr view 865`.

## Rules (repeat to every subagent and lane)
- Worktrees only, never the main checkout.
- Verify only with `npm run verify -- -p <changed + dependent hosts>`. Never workspace-wide or nx run-many. Save output to a file and filter it. Do not pass Jest flags (`--testPathPatterns`) to a run that includes lint/typecheck: use `-t test`.
- Other heavy commands: `node scripts/verify.mjs --exec --task <name> -- <cmd>`.
- No build/serve/e2e except Electron screenshot launches.
- Electron first; keep all hosts compiling.
- Never stage node_modules links or `.ptah/specs/TASK_2026_854_8f0d/`.
- No DB deletion, settings/account changes or credential use without asking. Do not touch `/home/amun/projects/.ptah`.
- Never merge, force-push, or remove worktrees (incl. `session-prefix-diet-cifix`).
- Commit in the foreground, push in the background. Append decisions to `decisions.md`.
