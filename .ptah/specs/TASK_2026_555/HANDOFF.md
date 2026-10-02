# TASK_2026_555 — Handoff (2026-10-03, end of session 6)

Settings redesign (Providers, Agent Orchestration, Advanced, Search & Voice) to match `prototypes/final/`, plus a fix
for every degradation found. **PR #631 is open:** https://github.com/Hive-Academy/ptah-extension/pull/631

## Where the work is

- Worktree (only one now): `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign`,
  branch `feat/task-555-settings-redesign`, pushed head **`6ab37231b`** (origin is up to date with the last commit).
- Track B (`task-555-advanced-search-voice`) is merged in; nothing to do there.
- `origin/main` was merged in at `af8a35684` (311 commits; 2 conflicts resolved, see that commit body).
- Do not touch the main checkout `D:\projects\ptah-extension`. D: had 46 GB free.

## Uncommitted in the worktree (Batch 55, the final-review fix round) — verify, then commit

Sources: `final-code-logic-review.md` (7/10), `final-code-style-review.md` (7.5/10), `visual-review.md` section
"Final review on PR 631" (7/10). All three are untracked/modified and must be committed with the batch.

**55a backend — DONE, checks green** (report `batch-55a-report.md`; typecheck/lint/test rpc-handlers, cli-agent-runtime,
shared, vscode-core, platform-core, the 3 apps; only the known env failure, see below):
- S-1 `ptahCli:*` + `agent:setConfig` + `auth:deleteStoredKey` log/Sentry only `{ errorType }` (no key text).
- M-1 a Check after a key change no longer joins the old in-flight check (`ConnectionCheckRecorder.isCurrent`).
- M-2 Cursor stream text redacted on every emitted path.
- M-3 Cursor key: stored = success even if the legacy copy clear fails; remove fails safely.
- M-4 `parseAgyModels`: tab format only when any tab line exists; old format kept, status/error lines skipped.
- M-5 `provider:removeCustomEntry` refuses the main agent's driver with `errorCode: 'CONNECTION_IN_USE'`.
- M-6 `auth:getApiKeyStatus` per provider; unreadable key → `keyUnreadable: true` on that row.
- CS-8 bare catches in both bootstrap files → `: unknown`.

**55b frontend — DONE, unit checks green, browser checks NOT run** (report `batch-55b-report.md`):
F1 checkbox/radio/toggle focus ring, F2 card focus ring (shared NativeCard; also affects skill-synthesis cards), F3
matrix popover focus during a save, F4 icon opacity, F5 parity summary ring, M-7 order-strip ResizeObserver, m-1..m-4,
CS-1 inline toast (harness RUX-2 test ids changed to `-inline`), CS-2 output-style editor/list split (682 / 622 lines),
"Copy to this project" busy focus, CS-8 harness catches.

**55c (UI for the 55a contracts) — PARTLY DONE:**
- M-3 Cursor "not removed" copy: DONE (spec added).
- **M-5 NOT STARTED:** map `CONNECTION_IN_USE` to the existing "switch the main agent first" message, keep the row.
- **M-6 NOT STARTED:** a `keyUnreadable: true` row shows "Could not read the stored key." + Retry, never "Not set" /
  "Add API key" (core state + card/drawer, specs; harness fixture + scene if cheap).

## Next steps, in order

1. Finish 55c M-5 and M-6 (frontend-developer subagent; `batch-55a-report.md` "What the frontend owner needs").
2. Verify the whole uncommitted set: `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/core
   @ptah-extension/ui @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-agent-runtime
   @ptah-extension/webview-e2e-harness ptah-extension-webview ptah-extension-vscode ptah-electron`, then `-t test` for the
   same with `-- --maxWorkers=2` (never the passthrough together with typecheck: TS5023); `npx nx build
   ptah-extension-webview`; Gate G and the full settings folder (cwd `libs/frontend/webview-e2e-harness`:
   `npx playwright test --config=playwright.config.ts src/lib/scenarios/settings --reporter=list --workers=2`);
   `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` (CI `main` job; must exit 0).
   Look at the captures F1/F2/CS-1 change; keep real changes, `git restore -- <exact path>` the noise.
3. Commit by scope (commitlint scopes used so far: `fix(chat)`, `fix(core)`, `fix(ui)`, `fix(webview)`,
   `fix(rpc-handlers)`/`fix(cli-agent-runtime)`, `fix(shared)` if accepted, `test(webview-e2e-harness)`, `test(e2e)`,
   `docs(task-specs)` for the reports and reviews). Message via the Write tool, `git commit -F`. Push.
4. Watch CI on PR #631 (`gh pr checks 631`). State at `6ab37231b`: two fixes pushed and not yet confirmed by CI —
   `main` (degradation-audit ratchet, fixed in `2b4120164`) and `electron-e2e` (`thoth/skills.spec.ts`, fixed in
   `6ab37231b`, passes locally). webview-e2e, git-real-git x3, SonarCloud passed on the earlier commit.
5. CodeRabbit was rate limited on the first push; after the next push, read its comments
   (`gh pr view 631 --comments`, `gh api repos/Hive-Academy/ptah-extension/pulls/631/comments`) and address them. Also
   check greptile-apps comments.
6. Short final re-check of the 55 fixes (visual-reviewer subagent on F1/F2/F3 + code-logic-reviewer on 55a/55c), then
   the final report to the user.

## Known, not caused by this branch

- `rpc-handlers` `harness-skill-selection-rpc.service.spec.ts` "never writes state.json" fails locally because
  `C:\Users\abdal\AppData\Local\Temp\.ptah\harness` exists (workspace-root walk finds that marker). Do not delete
  without the user's OK (follow-up 8).
- `ptah-electron` `shell-csp.spec.ts` times out under parallel load; 7/7 alone.
- Playwright worker crashes (0xC0000409) and 30 s timeouts under machine load: diagnose, then `--repeat-each=3`.
- 62 untracked PNGs in `.ptah/specs/TASK_2026_533_marketplace_redesign/screenshots/` come from another task's spec;
  do not commit or delete (follow-up 9).

## User actions pending

- **GitGuardian** check fails on 4 fake test keys in commit `7788993b3` (two rpc-handlers specs). Values were replaced in
  `a75417e2b`, but the scan covers all PR commits: the user must mark incidents 37826073 / 37826074 as false positive
  (test credential) in the GitGuardian dashboard. No history rewrite.

## Open items for the final report (batches.md "Follow-ups outside this task" 1-11)

Needs a user decision: (1) dispatcher sanitize, `rpc-handler.ts:241-252` (option 1 per handler, recommended; includes
`ptahCli:list` raw error) vs option 2 generic; (7) `ptah.auth.*` secret writes end running chat sessions via
`ConfigWatcher` without a confirm (pre-existing). Others: agent RPC raw errors outside Settings, `setApiKey`
clear-failure copy, Batch 1 M1 queued writes, spec type-check gap (`typecheck-spec`, devops), rpc-handlers spec
isolation, stray TASK_2026_533 PNGs, tasks UI raw version line, Electron shell sidebar contrast (B38-6). From the
final reviews: CS-3..CS-6 file sizes (`providers-settings-state.service.ts` 727, `file-settings-manager.ts` 761,
`settings-reachability.table.ts` 1010, `styles.css` 2260), CS-7 spec codes in comments, the M-2 limit (a key split
across two Cursor text chunks is not redacted), the M-4 limit (old agy format: a status line like "Please sign in"
would list as a model), the Batch 51 app-wide table-header rule, main's TASK_2026_576 style changes now visible in
Settings (gold light focus ring, faint disabled icons).
Untracked and stale: `CONTINUE-PROMPT.md`, `lane-probe-glm.md`, `lane-probe-antigravity.md` — delete only with OK.

## Rules that must hold

Never `git stash`; never blanket `restore/checkout/reset/clean` (`git restore -- <exact path>` only for side-effect
captures); never force push; no PowerShell find-and-replace on non-ASCII files; check free space before builds; ask
before deleting. D15 ("Saved" only after the write's own result; failure reverts + alert); no host error text in the
UI; text `text-base-content`, colour on icons/dots/badges; Angular standalone/OnPush/signals; `catch (error: unknown)`.
Reviews: subagents (user, 2026-10-03), disclosed as same-side.
