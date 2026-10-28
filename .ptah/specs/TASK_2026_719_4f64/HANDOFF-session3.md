# Session handoff — TASK_2026_719_4f64 (2026-10-25, session 3)

Earlier handoffs: `HANDOFF-session1.md` (background, key code locations, D5 details) and
`HANDOFF-session2.md` (Gate 2 history, D-P/D-S, class P rule).

## Goal

Named Claude accounts usable end to end in the Electron app (Electron first). The user's words:
"add a Claude main agent with an account and also another account that I can use with the Ptah
CLI lane". Two or more accounts. The user's accounts are personal claude.ai Max plans (D13):
class P (personal pro/max) certifies; class O (Team/Enterprise or unknown) refuses with
`unsupported-source`.
**Acceptance (Requirement 8):** live Electron test with the user's two accounts on Haiku: main chat
on Account 1, a Claude CLI lane on Account 2, each run proved to use its own account. The user signs
in personally. The agent never sees, types or stores credentials.

## Workspace, branch, PR

| Item | Value |
|---|---|
| Worktree | `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts` |
| Branch | `feat/claude-named-accounts`, base main `396f0135b`. 10 commits. **Not pushed, no PR.** |
| node_modules | Junction to the main checkout. Never run `npm ci` / `npm install` in the worktree. |
| Plan | `implementation-plan.md` revision 4 (Gate 2 APPROVED, D14) |
| Batches | `batches.md` (team-leader MODE 1). Complete: 7/22 (B1-B7) |

## Done in session 3 (commits on the branch, oldest first)

| Commit | Content |
|---|---|
| `590bafbf1` | B1 named launch contracts + task folder |
| `67e20a21e` | fix(agent-sdk): pre-existing main lint error in `session-query-executor.accounts.spec.ts` (D15) |
| `2e4dfb615` | B2 chat `accountSelection` schema |
| `0cdc66248` | B3 certified launch helpers |
| `9d1ccad35` | B4 user console spawn mode |
| `30318803b` | B7 migration 0060 + 19 head-version pins 59 -> 60 |
| `ada51ea3b` | P1 review fixes (env digest ambiguity; settings bypass via bootstrap `flagSettings` and `extraArgs.settings`; fallback doc comment) |
| `e55625e3e` | B5 account status parser and policy scan |
| `4297c7a45` | B6 login console and route certifier (unregistered) |
| (last) | docs: this handoff and batch states |

- **Phase P1 (B1-B4) is closed.** Codex review REVISE 7/10 (`code-logic-review-p1.md`) → one fix
  round → codex re-review APPROVED (`code-logic-review-p1-rereview.md`). D16.
- Phase P2 is in progress: B5, B6, B7 committed; B8 and B9 remain, then the P2 review.

## In progress at handoff

Nothing is running. No subagent, no lane, no verify. The worktree is clean after the last commit.

## Open problems and decisions

- decisions.md D1-D18 are current. New in session 3: D15 (agent-sdk lint fix), D16 (P1 review),
  D17 (persistence-sqlite lint debt), D18 (auth-providers verify).
- **Pre-existing main-branch failures** (files unchanged from main; report in the PR; decide if CI blocks):
  - `persistence-sqlite:lint`: 10 `no-restricted-syntax` errors in `0057_drop_skill_pipeline.ts`,
    `0057_drop_skill_pipeline.spec.ts`, `0058_provider_accounts.spec.ts` (D17). Do not edit shipped
    migration SQL without review.
  - `auth-providers:lint`: `package.json` `@nx/dependency-checks` (persistence-sqlite unused);
    `provider-account.store.ts:16` `no-control-regex`; `provider-account.store.spec.ts:132`
    `no-unexpected-multiline`. **B8 owns the two store files: the B8 executor must fix those two
    errors while it edits them** (D18).
  - `auth-providers:test`: 6 tests in `translation/translation-proxy.sdk.integration.spec.ts` fail
    with `EPERM` in `removeTree` temp cleanup on Windows (untouched file, environment).
  - `libs/frontend/core/src/lib/components/attention-permission-actions.component.ts:15,28` lint
    error (batches.md Task 20.0 checks it before B20).
- Deviations the next executors must follow (from batch reports):
  - B5 parser takes a 4th required `platform` argument, can return `null`, adds `configDirectoryMatches`.
  - B5 scan uses a narrower fs contract; B8 adapts `node:fs/promises` to it and passes
    `{ readFile, lstat, readdir, stat }` (D14 note 1).
  - B6: B8 calls `fallbackScript(context)` with one argument (platform comes from the constructor).
  - B3 exports extra types `ClaudeActualLaunch`, `ClaudeRunPolicyKey`, `ClaudeCertifiedLaunchRefusalCode`.
  - The plan's path for `deleted-exports.contract.spec.ts` is `agent-sdk/src/lib/__contracts__/`.
  - Specs that import `@ptah-extension/agent-sdk` need `import 'reflect-metadata';` first.
- D-P cost (accepted): only win32 + CLI 2.1.310 is covered; other platforms/versions refuse.
- User-reserved: merges, live sign-in, paid calls beyond the Haiku live-test messages.

## Working practice that worked in session 3

- Orchestrator runs verify and commits (no team-leader MODE 2 per batch); it updates batch states in
  `batches.md` with `sed` on the `— PENDING/COMPLETE` heading suffixes.
- File-disjoint batches with no edge between them ran in parallel (B2/B3/B4; B7 WPs; B7 next to B6).
  Never start a batch that edits a project while that project's verify is running.
- The verify queue is shared machine-wide and can wait 15-25 minutes. Run verify with Bash
  `run_in_background: true`, `timeout: 7200000`, log to `D:/projects/ptah-extension/.ptah/tmp/verify-<name>.log`,
  then read the failing task's "full log" path under `C:/Users/abdal/.nx/8b7110c7390b9603/cache/terminalOutputs/`.
  To tell pre-existing failures from ours: `git diff --quiet main -- <file>` and `npx eslint <our files>`.
- Developer prompt template: worktree path, task folder, deliverable `batch-<n>-report.md`, "read
  batches.md Rules for every executor (obey all 13), Plan validation, Batch <n>", the plan sections,
  prior batch reports with deviations, "ptah_get_diagnostics on changed files only", no verify/commit/git,
  at most 6 files, tool-call ceiling 45.
- Codex review lane: `cli: codex`, no role, `workingDirectory` = worktree, `taskFolder`
  `.ptah/specs/TASK_2026_719_4f64`, `deliverables`, `timeout: 1200000`. Resume is often refused for
  context size (>60k), so always give a complete brief. Codex weekly use was 20% at session start.

## Next steps (exact)

1. **B8 WP-a** (backend-developer, 6 files: `provider-account.store.ts`, `.store.spec.ts`,
   `provider-account.service.ts`, `di/register.ts`, `di/register.spec.ts`,
   `rpc-handlers/.../register-shared-rpc-handlers.activation.spec.ts`), then **B8 WP-b** (4 files:
   R `claude-account-command.ts`, R `provider-account-auth-env.spec.ts`, M `provider-account-actions.service.ts`
   and its spec). Give WP-b the WP-a report. Include D14 note 1, D18 (fix the two store lint errors),
   and the B5/B6 deviations above. Then one verify and one commit:
   `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli`
   (N = 6). Subject e.g. `feat(auth-providers,rpc-handlers): batch 8 - account core`.
2. **B9** (3 files): `npm run verify -- -t lint,test,typecheck -p @ptah-extension/auth-providers`; commit.
3. **P2 review**: codex lane on `git diff 9d1ccad35..HEAD -- libs/` (excluding the P1 fix commit
   `ada51ea3b`, which P1 already reviewed), deliverable `code-logic-review-p2.md` with a style section
   (B9 adds a public export). Back up any earlier file first. One fix round, one short re-review.
4. **P3** B11-B15, **P4** B16, B10, B17-B21 (Task 20.0 before B20), per batches.md; codex review per
   phase; senior-tester; visual-reviewer in Electron (dark + light, before/after for the account drawer,
   lane card and chat session row; "before" from `396f0135b`).
5. **B22 / host check**: `npm run verify -- -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview`.
6. Push `feat/claude-named-accounts` in the background, open a PR against `main` (title < 70 chars,
   `## Summary`, `## Test plan` with real results and the pre-existing failures above). Watch CI and
   CodeRabbit with `gh`; fix confirmed defects. Never merge.
7. Live test with the user: E1, E2, E4 (class P on both accounts), two accounts signed in by the user,
   main chat on Account 1 and a Claude lane on Account 2, both on Haiku; verify identity references and
   sanitized ambient status before and after; sign out of Account 2. senior-tester writes `test-report.md`.
