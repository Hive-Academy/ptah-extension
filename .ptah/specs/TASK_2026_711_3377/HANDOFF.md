# HANDOFF — TASK_2026_711_3377

Lanes adhere to the Ptah lane system prompt; the browser tool can open workspace `file://` pages.

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/lane-system-prompt` (branch `fix/lane-system-prompt`, base `main` at `0fc0c3a09`)
- Task folder: `<worktree>/.ptah/specs/TASK_2026_711_3377`
- PR: **#803** https://github.com/Hive-Academy/ptah-extension/pull/803
- `node_modules` in the worktree is a junction to `D:/projects/ptah-extension/node_modules`. Never run `npm install` there. Before `git worktree remove`, run `cmd //c rmdir node_modules`.

## Goal

The full user request is in `context.md` (verbatim) with the APPROVED AMENDMENTS at its end. In short:
- **Part A:** one vendor-neutral `PTAH_LANE_POLICY`, delivered on each CLI's strongest supported channel.
- **Part B:** `validateBrowserUrl` accepts `file:` only inside a workspace root, with a full security review.
- **Part C:** docs. Acceptance criteria 1-6 are in `context.md`.

## Done

| Commit | Content |
| --- | --- |
| `cd346800f` | Part A: `PTAH_LANE_POLICY` (canary `Lane policy id: ptah-lane-policy-v1`), channels, `LaneInstructionFileStore`, guidance cap only on argv, resume bookkeeping, sync spec, parent prompt. Subject is 77 chars (over the 72 rule; commitlint accepted; not amended). |
| `7ba5de3bd` | Part B: `browser-file-url.ts`, CDP Fetch guard on Chrome and Electron, popup denial, page re-checks. |
| `9430dea0b` | Part C docs (agent-lanes SKILL.md §3/§7, orchestration and tribunal refs, packaged twins) and the task record. |
| `62dd0f4cd` | CI fix: degradation-audit suppression comments on 6 fail-closed catches; regenerated `content-manifest.json`. Pushed to origin (second attempt; the first failed on a network error). |

Coded channels (`lane-channels.md`):
- codex: `developer_instructions`.
- ptah-cli: SDK `systemPrompt` append.
- pi: `--append-system-prompt` file under `.ptah/lanes/<agentId>/` (from docs; pi not installed).
- copilot, antigravity, opencode, grok and cursor: task prompt. One-time probes of their stronger channels failed.

Reviews (`code-logic-review.md`): Part A grok → APPROVED 9/10. Part B codex → APPROVED WITH FIXES 7/10 (2 revise rounds + 1 bounded correction by the orchestrator). C.3 report: keep `SUBAGENT_DISALLOWED_TOOLS` (about 1,834 tokens per spawn).

Local tests (before `62dd0f4cd`, which changed comments and the manifest only):
- `vscode-lm-tools` 3,147 pass, `agent-generation` 1,303, `ptah-electron` 1,249, `ptah-cli` 1,145, `ptah-extension-vscode` 199.
- `cli-agent-runtime` 2,339 pass. The 3 real-git cases in `capabilities/claude-approval.reader.spec.ts` time out (5 s) and hit `EPERM` under load; that file is untouched, and the spec passes alone.

Other PRs, done in this session at the user's request:
- #797: 4 CodeRabbit fixes pushed (`9080f8003`).
- #800: no change needed (comment already fixed by `bad479217`; the thread can be resolved).

## In progress / open

1. **CI on #803** after the `62dd0f4cd` push: `check` (manifest) and `checks` (degradation-audit) should now pass. `electron-e2e (shard 4/4)` failed on `apps/ptah-electron-e2e/src/specs/state.spec.ts:76` (after a reload the state holds only `ptahRoute`). This branch does not touch state/IPC code and main is green, so it is probably unstable. If it fails again, reproduce that one spec and investigate.
2. **Live adherence probes (acceptance 2) — USER DECISION: run after #803 merges and a new build is installed.**
   - Lanes: codex, grok, antigravity, opencode. Glm was AT LIMIT; copilot disabled; cursor/pi not installed.
   - At most 3 at a time, ≤ 15 tool calls each, `timeout: 600000`.
   - Neutral task text (amendment 1): "Build a small static HTML status card in <path> and confirm it looks right. State your lane policy id in your report."
   - Pass rules (a)-(d) are in `context.md`. Write `adherence-report.md`.
3. **Open review follow-up (fails closed):** `chrome-launcher-browser-capabilities.ts:848-851,871-883` does not catch a rejected `Runtime.runIfWaitingForDebugger`, so the target stays paused and is not closed.
4. **Grok lanes see no Ptah MCP tools.** The grok log shows a `folder_trust` phase. Neither the project nor the worktree is in `~/.grok/trusted_folders.toml` (user-global — do not change it without user approval). The grok probe in step 2 will show whether this blocks criteria (b)/(d).
5. `context.md` (probe decision) and this `HANDOFF.md` are uncommitted in the worktree. Commit them with `adherence-report.md`.

## Key files

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (`PTAH_LANE_POLICY` ~416, `buildTaskPrompt`, argv cap helper)
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-instruction-file-store.ts`, `agent-process-manager.service.ts`
- Adapters: `codex-cli.adapter.ts`, `pi-cli.adapter.ts`, `cursor-cli.adapter.ts`, `copilot-sdk.adapter.ts`, `antigravity-cli.adapter.ts`, `opencode-cli.adapter.ts`, `acp/acp-session-handle.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-file-url.ts`, `browser-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts`
- `apps/ptah-electron/src/services/electron-browser-capabilities.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-policy-sync.spec.ts`
- Task folder: `context.md`, `lane-channels.md`, `implementation-plan.md`, `batch-*-report.md`, `code-logic-review*.md`

## Next steps

1. Confirm the push: `git -C D:/projects/ptah-extension/.claude-worktrees/lane-system-prompt status -sb` (no "ahead"), then `gh pr checks 803`.
2. If a check fails, read only the failed step: `gh run view --job <id> --log-failed | tail -40`. Reproduce only the failing spec, for example `npx jest -c libs/backend/vscode-lm-tools/jest.config.ts <spec> --coverage=false --maxWorkers=2`.
3. Local re-checks if needed, one at a time:
   - `npx nx test <project> --parallel=1` for `@ptah-extension/cli-agent-runtime`, `@ptah-extension/agent-generation`, `@ptah-extension/vscode-lm-tools`, `ptah-electron`, `ptah-cli`, `ptah-extension-vscode`
   - `npx nx run degradation-audit:lint` and `npm run manifest:check`
4. Before a push, ask other sessions on the machine whether the heavy-check slot is free. The pre-push gate is heavy. (The analytics-v2 session, #801, was told "checks: free" at handoff.)
5. After #803 merges and the user installs the new build, run the adherence probes (open item 2) and write `adherence-report.md`. Then commit it with `context.md` on a new branch from main, and open a PR.
6. Optional follow-up PR for open item 3.

Rules: memory-safe verification (CLAUDE.md). Electron first. No `any` / `@ts-ignore` / `as unknown as`. Do not raise degradation-audit baselines. Commit in the foreground; push in the background. Read `.commitlintrc.json` (subject ≤ 72). Until 2026-10-24, the user prefers CLI lanes over Claude subagents (global CLAUDE.md).
