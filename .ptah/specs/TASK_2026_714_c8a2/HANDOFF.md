# Session handoff — TASK_2026_714_c8a2 (session 33)

Written 2026-10-31. Replaces the session 32 handoff (read it with
`git show 180c7ef68:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; its Goal, Rules, lane limits
history and Key files stay valid). Session 31 handoff (lane spec traps):
`git show 82e5b4455:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. Session 24 handoff (full goal, PR
table): `git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. Electron live-test procedure:
`git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823
https://github.com/Hive-Academy/ptah-extension/pull/823, do not merge).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W; the main checkout
`D:\projects\ptah-extension` stays clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and CLI
lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15). Electron first. Native UI
contracts identical to Claude's; gaps fixed only in the backend translation layer; no frontend Codex
special case; no second proxy; NEVER strip/revert/comment out MCP.

Routing (standing, user): codex (model `gpt-6-sol`, never `gpt-6.1-terra`) implements. Reviewer must
be another family: a `claude` CLI lane (`cli: claude`, role `code-logic-reviewer`) reviews codex's
code (user decision, session 32). The coordinator runs verify, commit and push itself.

Lane limits at end of session 33:
- codex: weekly ~50% (resets 2026-11-04 07:03 UTC). Resumes above ~60k tokens or idle > 600 s become
  fresh lanes with a handoff brief: always give self-contained tasks.
- claude CLI: works, limit not tracked. Reviews take 3-6 min.
- Glm (pc-355b645d-...): AT LIMIT (weekly 100%, resets 2026-11-02 00:00 UTC). Do not use.
- grok: AT LIMIT (weekly 100%, resets 2026-11-03 17:40 UTC). Do not use.
- Kimi Code: 429 in session 32, reset unknown. Do not use.
- opencode: monthly 100% (resets 2026-11-04).

## Done in session 33

| Commit | Subject | Pushed |
| --- | --- | --- |
| 0b74c405b | Merge origin/main (a7036819e) | yes |
| 180c7ef68 | feat(cli-agent-runtime,electron): add Codex lane detection and catalog (10b-2b) | yes |
| ea6d7e5a7 | feat(cli-agent-runtime): add injectable Codex lane adapter selection (10c) | yes |
| 509815329 | Merge origin/main (bd8aac4d5) — resolves chat:continue conflict | **NO — tests fail, see below** |

- 10b-2b: claude review APPROVED 8/10 after one revision (T\code-logic-review-10b-2b.md). Open
  minors for later: catalog cache `binaryPath` field unused; close() rejection after a good list
  discards the catalog; late-context close error not logged.
- 10c: claude review APPROVED 8/10 after one revision (T\code-logic-review-10c.md).
- CI on 0b74c405b: `degradation-audit` ratchet failed (Electron 5 vs baseline 4) — fixed in
  180c7ef68 (suppression comment in codex-runtime-composition.ts). The chat
  `stdout-visibility.spec.ts` failure was a flake (passed on re-run of shard 1/4).
- CI for 180c7ef68 and ea6d7e5a7 did NOT run: main moved and PR #823 was CONFLICTING again.
  Merge 509815329 resolves it (conflicts in `rpc-handlers/src/lib/chat/di.ts` — kept both imports —
  and `chat-session.service.ts` chat:continue — kept the native Codex resume path plus main's
  inject/commit/release contract; a native resume that already delivered the prompt calls
  `injection.release()`).
- Decision D27 added to T\decisions.md (committed with this handoff): native lane
  factory bound only when the lane parity gate admits `lane` or the host is unpackaged (dev);
  packaged + gate closed keeps the legacy lane; one host helper is the lane routing boundary.

## Uncommitted work in W (batch 10d.E, review REVISE)

Codex lane (session `01a18f01-704b-7631-ab16-e577b45a6df7`) implemented 10d.E. Scoped verify PASSED
(69 tasks: ptah-electron, cli-agent-runtime, codex-runtime, cli-engine, ptah-cli, ptah-tui,
ptah-extension-vscode, degradation-audit). claude review: REVISE 6/10
(T\code-logic-review-10d-E.md, defects 1-7). Files:
- `apps/ptah-electron/src/di/codex-lane-composition.ts` (new), `codex-runtime-composition.ts` (+spec),
  `phase-2-libraries.ts`, `container.smoke.spec.ts`
- `libs/backend/cli-agent-runtime/.../codex/codex-app-server-lane-auth.ts` (+spec),
  `codex-app-server-lane.adapter.ts` (+spec), `cli-detection.service.ts` (displayName 'Codex CLI')
- T\batch-10d-E-report.md, T\code-logic-review-10d-E.md

Revision 1 to send to codex (one combined self-contained task):
1. (major) Add `apps/ptah-electron/src/di/codex-lane-composition.spec.ts`: create()/detect() spawn
   nothing; chat and lane contexts keep their own profile/fingerprint after the other opens (R3,
   both directions); profiles/credentials/openCatalog/user-MCP all get the same CODEX_HOME;
   runtime.open rejects a non-lane profile; close() disposes the scope once; failed open disposes.
2. (major) Lane identity store reuses the chat SDK session metadata store, so lane threads become
   `codex-app-server` chat rows. Give lanes their own key space or a `consumer: 'lane'` marker that
   chat listings and chat resume reject (+ spec), or a separate store.
3. (major) Apply D27: route lane opens through one host helper (`resolveGatedCodexRuntime(scope,
   'lane', platform)` when admitted; raw Runtime only for the unpackaged dev default); bind the
   factory only when admitted or unpackaged; replace the misleading "lane gate closed" spec
   assertion with D27 cases.
4. (minor) Use `||` for HOME/USERPROFILE; empty CODEX_HOME = explicit unusable home, one visible
   message (+ spec).
5. (minor) Lane `requestUserInput` port: emit the same kind-only line and decline (R1/D26).
6. (minor) Catalog profile: use the adapter's lane default model constant, and not CODEX_HOME as
   cwd/workspace (neutral temp/read-only cwd).
7. (minor) DI order guard: resolve CliDetectionService in composePhase2 and assert its codex adapter
   is CodexAppServerLaneAdapter (replace the source-text indexOf check).
Then verify, claude re-review (revise round 1 of 2), commit 10d.E + D27, push, watch CI.

## Merge 509815329 is LOCAL ONLY — verify failed, fix before push

`npm run verify -- -p rpc-handlers,agent-sdk,chat,shared` after the merge: rc=1, "12 tasks: 10
succeeded, 2 failed" (`rpc-handlers:test` 34 failed, log
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\10873914304718709553`;
`agent-sdk:test` 1 failed, log `...\18234671897015722126`). Failing suites:
chat-continue-codex-resume-once.spec.ts, chat-session.native.spec.ts, chat-session-agent-child.spec.ts,
chat-session-resume-activate.spec.ts, chat-session-session-folder.spec.ts, session-folder.spec.ts
(all in `libs/backend/rpc-handlers/src/lib/chat/session/`), and agent-sdk
plugin-loader.service.capabilities.spec.ts:324.
Three causes seen (not yet triaged per test):
1. 22 x "Cannot read properties of undefined (reading 'isResumeStateHydrated')": main's
   `ensureResumeStateHydrated` (chat-session.service.ts:605,644) needs
   `subagentRegistry.isResumeStateHydrated` (and probably main's other new registry methods) in the
   branch's spec harnesses, e.g. chat-session.native.spec.ts:708 and
   chat-continue-codex-resume-once.spec.ts. Add the mocks to match main's harness.
2. Windows path separators (expected `.../my-repo`, received `...\my-repo`) in lineage specs.
3. agent-sdk symlink EPERM on Windows (symlinkSync needs privilege).
Causes 2-3 are likely Windows-only and pre-existing on main: confirm by running the same spec on a
clean `main` worktree (or by Linux CI) before changing them. Fix cause 1 (and anything real),
re-verify, then push the merge and the docs commit together.

## Background work

None after this session ends. No lane, child session or watcher runs.

## Next steps (in order)

1. Check `git -C W status -sb` and `git -C W log --oneline -4`. Fix the merge test failures
   (section above), verify `rpc-handlers,agent-sdk,chat,shared`, commit the fix, then push in the
   background and confirm
   `gh pr view 823 --json headRefOid,mergeable,mergeStateStatus --jq '"\(.headRefOid[0:9]) \(.mergeable) \(.mergeStateStatus)"'`
   is MERGEABLE (BLOCKED only means draft/pending checks). If CONFLICTING, merge origin/main again.
2. Watch CI for the new head with `gh run list --branch feat/codex-runtime-integration --limit 15
   --json headSha,status,conclusion,name --jq ...` (no jq binary). Fix real failures; re-run a
   flaky shard once (`gh run rerun <run> --job <job>`).
3. 10d.E revision 1 (list above) -> verify -> claude re-review -> commit -> push.
4. 10d.C (CLI/TUI, `libs/backend/cli-engine/src/lib/container.ts` + new
   `codex-lane-runtime-composition.ts`) and 10d.V (VS Code, minimal) on codex, copying the 10d.E
   pattern ("Pattern notes" in T\batch-10d-E-report.md) and D27. File-disjoint; may run in parallel.
5. 10d.P parity proof (live/paid run needs explicit user authorization), 10e, 10f per
   T\plan-p10.md + T\plan-p10-review.md (R1-R4). Then P14 (incl. GAP-3), D9, P15.

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min;
read rc and the "N tasks:" line; failed task logs are in
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`. Include `degradation-audit` in
verify when a batch adds a catch. Never build/serve/e2e except an approved Electron live run. Never
npm ci/install in a worktree. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; bracket
`process.env['X']` (hosts use noPropertyAccessFromIndexSignature); swallowing catches need a
`// degradation-audit: optional-capability|reported - <reason>` comment. Lanes never verify,
commit, push or call ptah_get_diagnostics; say so in the first lines of each lane task;
deliverable paths absolute. Never commit, push or merge while a lane edits W or a verify runs.
Commit in the foreground (commitlint scopes, subject <= 72, body lines <= 100, no BOM, message via
file + `git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in
the background. Strip BOMs only from files lanes wrote. No PR merge, force push, history rewrite,
branch deletion or worktree removal (merging main INTO the branch is allowed). Do not edit
~/.ptah/settings.json or ~/.codex/config.toml. NEVER strip MCP.
