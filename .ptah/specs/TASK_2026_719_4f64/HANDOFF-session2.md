# Session handoff — TASK_2026_719_4f64 (2026-10-25, session 2)

The session 1 handoff is kept as `HANDOFF-session1.md` (background, key code locations, D5 details).

## Goal

Named Claude accounts usable end to end in the Electron app (Electron first). The user's words:
"add a Claude main agent with an account and also another account that I can use with the Ptah
CLI lane". Two or more accounts. The user's accounts are **personal claude.ai Max plans** (USD 200
and USD 100), no Team/Enterprise seat (D13).
**Acceptance (Requirement 8):** live Electron test with the user's two accounts on Haiku: main chat
on Account 1, a Claude CLI lane on Account 2, each run proved to use its own account. The user signs
in personally. The agent never sees, types or stores credentials.

## Workspace, branches and PRs

| Item | Value |
|---|---|
| Worktree | `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts` |
| Branch | `feat/claude-named-accounts` at main 396f0135b. **No commits, not pushed, no PR.** |
| Task folder | `.ptah/specs/TASK_2026_719_4f64/` (untracked; commit it with the first batch) |
| node_modules | Junction to the main checkout. Never run `npm ci` / `npm install` in the worktree. |

## Done in session 2 (documents only, no code)

- Gate 2 revise round 2: fresh architect → revision 2 (22 batches B1-B22). Codex review: all 7
  round-1 findings fixed, D-M accepted, 1 new Serious (unscanned policy sources). D8, D9.
- Cap reached → user chose one extra round (D10) → revision 3 (D-P exact coverage table win32 +
  CLI 2.1.310; D-Q; D-R). Codex scoped check: still REVISE, 2 Serious (D11).
- User asked for research (D12): `research-report-2.md`. t3code (pingdotgg/t3code) uses one
  `CLAUDE_CONFIG_DIR` per account, user-run `claude auth login`, no policy certification.
  A-S1 and A-S12 proved; A-S9 (server-managed settings) unprovable, docs scope it to Team/Enterprise.
- User decision D13: Option 1 + 3. Class P (personal Pro/Max) certifies; class O (Team/Enterprise
  or any unknown) refuses with `unsupported-source`. R3.5 unchanged, no waiver.
- Architect → **revision 4** (`implementation-plan.md`, "Revision 4 changes" at top, decision D-S).
  Class P rule: `loggedIn:true`, `authMethod:'claude.ai'`, `apiProvider:'firstParty'`,
  `subscriptionType` `'pro'|'max'`, no `forcedLoginMethod`, no `allowedProviders`, `apiKeySource`
  absent or `'none'`, no unknown key (`orgId`/`orgName` not used). Awaited coverage/class check before
  every main-chat and lane bootstrap and final child (contract B1, certifier B6, adapter B9, lane call
  sites B12, executor call sites B13). Open labelled assumptions: A-C2, A-T1, DA-1, R-1 (checked in E4).

## In progress at handoff

- Nothing is running. Codex lane `97c02976` finished: **Gate 2 APPROVED** for revision 4 (D14).
  Three non-blocking notes (in `implementation-plan-review.md` and D14) go into batches.md.

## Backups in the task folder

Plans: `implementation-plan-rev1.md`, `-rev2.md`, `-rev3.md` (current = rev4).
Reviews: `implementation-plan-review-round0.md`, `-round1.md`, `-round2.md`, `-round3.md`, `-round3b.md`.

## Open problems and decisions

- decisions.md D1-D14 are current. Gate 2 is passed (D14).
- D-P costs (accepted trade-off): only win32 + CLI 2.1.310 is covered. darwin/linux and every other
  CLI version refuse. A CLI auto-update stops named runs until a data-only row is added.
- D-M: B7 (22 files), B8 (10), B12 (7) are one commit each, done in work packages of at most 6 files
  (B7: WP-a 3 substantive files, WP-b/c/d 6 pins each, WP-e 1 pin).
- Follow-up task (not this release): `claude doctor` experiment for org accounts (Option 2), and maybe
  a dedicated `unsupported-account` code.
- Known pre-existing lint error on main (not ours): `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15,28`.
- User-reserved: merges, live sign-in, paid calls beyond the Haiku live-test messages.

## Next steps

1. Gate 2 is done (D14). No action.
2. Team-leader (decomposition mode) writes `batches.md` from the B1-B22 manifest, with D-M work packages
   and the three D14 notes (stat in the fs contract; class-O error order; E4 wording).
3. Per batch: a Claude backend-developer or frontend-developer subagent (at most 6 files per run,
   tool-call ceiling 45, worktree path given). Rules for them: no `process.cwd()`, no `jest.spyOn` on
   module namespaces, register every new `@inject` token, list existing specs that mock changed members,
   `ptah_get_diagnostics` on changed files only, never commit. The orchestrator then runs, from the worktree:
   `npm run verify -- -p <batch projects>` (confirm "Running target ... for N projects"), and commits in
   the foreground with explicit paths (scopes in `.commitlintrc.json`).
4. Per phase: one codex code-logic review (no role, `workingDirectory` = worktree, reads
   `git diff main...HEAD`), one fix round, one short re-review. Then senior-tester, then visual-reviewer
   (Electron, dark and light, before/after for the account drawer, lane card and chat session row; "before"
   from the base commit).
5. B22/host check: `npm run verify -- -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`.
6. Push `feat/claude-named-accounts` in the background, open a PR against `main` (title < 70 chars,
   `## Summary`, `## Test plan`). Watch CI and CodeRabbit with `gh`; fix confirmed defects. Never merge.
7. Live test with the user: E1, E2, then E4 (class P on both accounts), add two accounts (user signs in
   in the console window), main chat on Account 1 and a Claude lane on Account 2, both on Haiku, verify
   identity references and sanitized ambient status before and after, sign out of Account 2.
   senior-tester writes `test-report.md`.
