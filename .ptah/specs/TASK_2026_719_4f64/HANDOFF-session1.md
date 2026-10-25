# Session handoff — TASK_2026_719_4f64 (2026-10-25, session 1)

## Goal

Make named Claude accounts usable end to end in the Electron app (task B, follow-up of
TASK_2026_712_5d7c). Real named sign-in, status and sign-out into each profile's own
`CLAUDE_CONFIG_DIR`. Certification of the exact Claude executable and environment (A1-A3). Real
lane admission with the stored lane selection read at spawn (D37). Main chat `accountSelection`
(D22). Lift the D7 release hold fully (user decision D41 of TASK_2026_712).
**Acceptance:** a live Electron test with the user's two real Claude accounts on Haiku. The main
chat runs on account 1, a Claude CLI lane runs on account 2, and each run is proved to use its own
account. The user signs in personally. The agent never sees or stores credentials.

## Workspace, branches and PRs

| Item | Value |
|---|---|
| Worktree | `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts` |
| Branch | `feat/claude-named-accounts`, created from `origin/main` 396f0135b (includes #808 and #820). **Not pushed. No commits yet. No PR yet.** |
| node_modules | Junction to `D:\projects\ptah-extension\node_modules` (already created). Never run `npm ci` / `npm install` in a worktree. |
| Task folder | `.ptah/specs/TASK_2026_719_4f64/` in the worktree (untracked, not committed yet) |
| Predecessor | `.ptah/specs/TASK_2026_712_5d7c/` (on main). PR #808 and PR #820 are MERGED. |
| Predecessor worktrees | `.claude-worktrees/provider-accounts` (#808) and `.claude-worktrees/provider-accounts-p1e` (#820). Keep them until the user authorizes cleanup. |

## Done in this session

TASK_2026_712 / PR #820 (before this task started):
- Merged `origin/main` into `feat/provider-accounts-p1e` (merge commit 01b500920). Fixed the one conflict in `agent-process-manager.service.spec.ts`.
- Fixed the CodeRabbit finding: a committed write whose snapshot read-back fails now returns `timeout` (commit d321ec637). D41 recorded in that task's decisions.md.
- #820 passed all CI checks, and the user merged it.

TASK_2026_719_4f64 (this task), documents only, no code yet:
- `task.md`, `context.md`, `decisions.md` (D1-D6).
- `research-report.md`: real CLI facts (researcher subagent). Installed CLI 2.1.310, SDK-bundled 2.1.278. `auth status --json` keys are `loggedIn`, `authMethod`, `apiProvider`, `configDirectory`, and others. Exit code 1 means signed out. Use `auth login --claudeai`. Set `CLAUDE_SECURESTORAGE_CONFIG_DIR` too. A Windows Credential Manager backend sits behind `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN` / `tengu_windows_credman`.
- `task-description.md`: **Gate 1 APPROVED**. PM subagent wrote it. A codex lane reviewed it in 2 rounds (`task-description-review.md`).
- `implementation-plan.md`: architect subagent, revision 1. It has 11 components and an 18-batch manifest (B1-B18, at most 6 files each, exact Nx project names, in the "Team-leader handoff" section, line ~533).
- `implementation-plan-review-round0.md`: the codex Gate 2 round 0 review (REVISE, 11 findings). It is a backup copy.

## In progress at handoff

- Nothing is running. Every subagent and CLI lane has finished.
- **Gate 2 is at REVISE after round 1** (decisions.md D7). The codex re-review in `implementation-plan-review.md` lists 7 remaining findings: 1 Blocking, 4 Serious, 2 Moderate. The round 0 review is backed up in `implementation-plan-review-round0.md`.
  - Blocking: `reg.exe query` exit 1 is treated as absence. A missing key must be told apart from an unreadable or failed query.
  - Serious: migration 0060 loses existing reservation epochs.
  - Serious: fallback completion bypasses the uncertainty of owned status probes.
  - Serious: the fallback scripts run outside the certified cwd.
  - Serious: the batch graph has forward dependencies (B7 registers `CLAUDE_CLI_PROBE` before B8 implements it).
  - Moderate: `ACCOUNT_HELD_NOTE` (`libs/frontend/chat/src/lib/settings/providers/accounts/accounts-section.component.ts:70-72`) has no owner.
  - Moderate: the key regression tests are not committed per batch.

## Open problems and decisions

- **D5 (current):** sign-in opens a separate OS console window (`conhost.exe` on Windows). Ptah starts it with the named stripped env and `['auth','login','--claudeai']`, and never reads its output. Completion is detected only by sanitized `auth status --json` polling. On a failure, a read-only fallback shows the command and directory. Reason: Ptah has no in-app terminal (no app code imports `node-pty`, and `@xterm/headless` only). D2/D3 (embedded terminal) are superseded.
- **D5 UI scope:** U1-U6 add no new surface, so there is no designer step and no Gate 1.7. Completion needs visual-reviewer before/after screenshots (dark and light) in Electron for the account drawer, the lane card and the chat session row.
- **Live checks with the user (plan section "Live evidence"):** E1 proves that the console window gives the CLI a console and keeps the env. E2 proves pre-prompt identity: a no-prompt script on the ambient login that reports only booleans and the version. Run E2 before named runs. Until E2 passes, named runs refuse at the 15 s deadline. E5 is the Credential Manager mapping. It is "unresolved" unless an evidenced naming rule exists, and "unresolved" is never reported as passed.
- **Architect points for Gate 2:** D-D keeps `release-held` in the shared union type (no producer, new copy "Named accounts are not available on this host."). D-K makes the `launch` field optional (consumers refuse with `identity-unproved`). Batch-order caveat: B7 registers the CLI probe token before B8 implements the probe. The round 1 re-review judged this order unsafe (Serious finding 5), so round 2 must fix it. The re-review accepted D-D in principle, but the copy change must also cover the `ACCOUNT_HELD_NOTE` UI copy (finding 6). It accepted D-K, because every named boundary refuses when `launch` is absent. Details are in `implementation-plan-review.md` under "Architect points".
- **Gate 0.1:** lanes `enabled`, approval `lane-review`. Claude subagents implement (at most 6 files each). Codex lanes without a role review (cross-side and other family). Codex had confirmed room at the last check. opencode is AT LIMIT.
- **Known pre-existing lint errors on main (not ours):** `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15,28` (`interactive-supports-focus`). `@ptah-extension/core:lint` fails locally because of it.
- **User-reserved:** merges, live sign-in (the user does it), and paid calls beyond the Haiku live-test messages.

## Key files

- Task folder: `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/.ptah/specs/TASK_2026_719_4f64/`. It contains `task-description.md`, `research-report.md`, `implementation-plan.md`, `implementation-plan-review.md`, `implementation-plan-review-round0.md`, `decisions.md` and `context.md`.
- Code blocking named use today:
  - `libs/backend/auth-providers/src/lib/accounts/claude-account-command.ts:109` (`authorization()` returns `release-held`) and `:114` (`environment()` throws).
  - `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:78`.
  - `libs/backend/auth-providers/src/lib/di/register.ts:165-175`.
  - `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1182-1185,1653`.
  - `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (D37).

## Next steps

1. **Finish Gate 2 (revise round 2 of 2, the last round).**
   - Spawn a fresh software-architect subagent. Give it the task folder, `implementation-plan.md`, `implementation-plan-review.md` (7 findings) and decisions.md D5-D7. It applies all 7 findings in place, and it must make the batch graph free of forward dependencies.
   - Then spawn a fresh codex review lane, without a role, with `workingDirectory` set to the worktree and the deliverable `implementation-plan-review.md`. Give it a full brief: check the 7 findings and look for new contradictions. You can try `resume_session_id` `01a173e3-d675-7980-bafe-c773842bc374` (the round 1 reviewer), but Ptah starts a fresh lane when the session context is too large. A fresh lane has no memory of the earlier rounds, so back up the current review first (`cp implementation-plan-review.md implementation-plan-review-round1.md`) and tell the lane to read that backup before it overwrites the review.
   - APPROVED → record D8 (Gate 2 passed, lane-review).
   - REVISE → present the open items to the user (the cap is reached).
2. **Team-leader (decomposition mode):** write `batches.md` from the plan's B1-B18 manifest. Then run each batch with a Claude developer subagent (backend-developer or frontend-developer, at most 6 files, tool-call ceiling 45). Give each one the worktree path and these rules:
   - Use no `process.cwd()` and no `jest.spyOn` on module namespaces in specs.
   - Register every new `@inject` token.
   - List the existing specs that mock changed members.
   - Run `ptah_get_diagnostics` on changed files only.
   - Lanes never commit.
3. **After each batch,** the orchestrator verifies from the worktree and commits with explicit paths (commit in the foreground; commitlint scopes are in `.commitlintrc.json`):
   `npm run verify -- -p <batch projects from the manifest>` (it takes the machine-wide lock; `node scripts/verify.mjs --status` shows the queue). Confirm that the header shows "Running target ... for N projects".
4. **Per phase,** run one codex code-logic review (no role, so it can read `git diff main...HEAD`), then one fix round and one short re-review. Then the senior-tester and the visual-reviewer (Electron, dark and light, before/after for drawer, lane card and chat row).
5. **B18 host check:** `npm run verify -- -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`.
6. **Push and PR:** push `feat/claude-named-accounts` in the background, then open a PR against `main` (title under 70 characters, `## Summary` and `## Test plan`). Watch CI and CodeRabbit, and fix confirmed defects. Never merge.
7. **Live test with the user (Requirement 8, steps 1-8), in this order:**
   1. Check E1, then check E2.
   2. Add two accounts. The user signs in to each in the console window.
   3. Run the main chat on Account 1 and a Claude lane on Account 2, both on Haiku.
   4. Verify the identity references and the sanitized ambient status before and after.
   5. Sign out of Account 2.

   The senior-tester writes `test-report.md`.
