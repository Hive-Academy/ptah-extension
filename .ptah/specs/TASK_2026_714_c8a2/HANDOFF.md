# Session handoff — TASK_2026_714_c8a2 (session 39)

Written 2026-11-01. Replaces the session 38 handoff (in git history of PR #823, commit bd3991fb0).

W = `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a` (branch `feat/codex-removal-a`,
from `main` after PR #823 merged; DRAFT PR #881 https://github.com/Hive-Academy/ptah-extension/pull/881).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. `W\node_modules` is a JUNCTION to
`D:\projects\ptah-extension\node_modules`: never `npm install` in W; remove the junction with
`cmd /c rmdir W\node_modules` before any future `git worktree remove` (only when the user authorizes).
Old worktree `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration` (branch
`feat/codex-runtime-integration`, PR #823 MERGED as 944837c0c) stays until the user authorizes cleanup.
The main checkout `D:\projects\ptah-extension` stays clean on `main`.

## Goal

User goal: drop custom Codex implementations; Electron only; Codex main chat and Codex CLI lanes run on
the native Codex App Server runtime (`@ptah-extension/codex-runtime`); purge the Codex parallel paths
(the Codex translation proxy and the Codex path through the Claude Agent SDK) and stop Ptah source from
importing/resolving `@openai/codex-sdk`.

User decisions (T\decisions.md):
- D29: lane proof signed (Electron scope); packaged Electron win32/x64 runs native lanes.
- D30: GAP-3 DROPPED (Ptah already writes its MCP servers into the Codex config; the user is moving
  MCP/marketplace installs to per-project scope separately). Removal A trims ONLY the Codex paths that
  App Server replaces. Do NOT touch other providers (Claude, Copilot, OpenRouter, Kimi, local/Ollama,
  custom OpenAI, Sakana, OpenCode) or the shared `translation/` files incl. `translation-proxy-base.ts`.
- D31: after A2, VS Code/CLI/TUI have NO Codex chat (they compile; explicit error). D9 (history after
  reload) is done BEFORE A2. `@openai/codex-sdk` STAYS in package.json and package-lock.json (the user
  removes it later); A6 only changes `codex-native-binary-path.ts` so Ptah source does not resolve the
  SDK root; project.json externals and scripts/windows-hide-patch stay. No lockfile edits.
- Native UI contracts identical to Claude's; gaps fixed in the backend translation layer; no frontend
  Codex special case; no second proxy; NEVER strip/revert/comment out MCP.

## Done in session 39

| Commit | Where | Subject | Verify / CI |
| --- | --- | --- | --- |
| 546a2bfa1 | #823 | docs: scope Removal A to Codex paths (D30) and inventory | docs |
| b18c42563 | #823 | feat(electron,agent-sdk): admit packaged win32/x64 Codex chat (A1) | tc/lint 10/10; test 49/51 (known Windows-only); CI green |
| cd851ea6e | #823 | docs: record D31 and the D9 history plan | docs |
| b49af48dc | #823 | chore(repo): merge main into feat/codex-runtime-integration | tc/lint 19/20 (known auth-providers false positive); CI green |
| 944837c0c | main | PR #823 merged by the user | — |
| 48b8df79a | #881 | feat(codex-runtime): read native Codex thread history (D9 12a, 12b) | tc/lint 16/16; test 52/54 (known Windows-only); pushed, CI not watched |

- A1: `apps/ptah-electron/src/di/codex-electron-admission.ts` `isElectronCodexConsumerAdmitted`
  (chat = chat gate OR PTAH_CODEX_RUNTIME_DEV chat route OR packaged win32/x64; lane rule unchanged);
  `CodexChatAdapterPorts.resolveRuntime` optional port. Reviews code-logic-review-A1*.md (5 -> 8.5, 10).
- D9 12a/12b: `CodexHistoryReader` (codex-session-history.ts), read-only own App Server process,
  thread/read + thread/turns/list + thread/items/list + thread/list, typed errors. Reviews
  code-logic-review-D9-12ab.md (REVISE 5) -> -r1.md (APPROVED 8). Open moderate follow-ups from r1
  (fold into 12d-1 or a small fix batch): M1 child thread not-found reported as root threadNotFound;
  M2 JSON-string compare for embedded-vs-paged conflict (use deep-equal); M3 runtime close() does not
  track/abort in-flight history reads (add early closed check); M4 child closure O(n x depth) (use a
  parent->children map).
- Live 14b (packaged native chat run) never ran; PR #823 body lists it as an open test item.

## In progress

- Batch D9 12c-1 (history projector) — codex lane `25f8d552-620f-4b61-b4b0-95833a319671`, running at
  handoff. Deliverable T\batch-D9-12c1-report.md. Expected new files
  `libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts` + `.spec.ts`; at handoff
  it had already modified `libs/backend/codex-runtime/src/index.ts` (uncommitted; check it is a needed
  export only).

## Open problems and decisions

- Codex weekly lane quota ~91% (resets 2026-11-04 07:03 UTC). Glm and opencode at limit; Kimi: do not
  use; the `claude` CLI lane is disabled. If codex hits its limit, stop at a committed point.
- The D9 release gate needs a LIVE check (paid; needs explicit user authorization with a turn cap and a
  guard that stops before the cap): a real `thread/read` response (incl. paged/child cases) and a
  packaged Electron reload of a native session. Ask the user after 12c-12d are done, before A2.
- Known local-only failures (ignore): rpc-handlers session-folder/symlink specs (Windows), agent-sdk 2
  plugin-loader specs, auth-providers lint `@nx/dependency-checks` persistence-sqlite false positive,
  auth-providers translation-proxy.sdk.integration EPERM.
- Nx terminalOutputs cache is shared across worktrees: read the `full log:` path printed by verify,
  not the newest file in the cache folder.

## Key files

- T\plan-d9-history.md — D9 plan; batch table 12a, 12b, 12c-1, 12c-2, 12d-1, 12d-2 and release gate.
- T\removal-a-codex-inventory.md — Removal A inventory and batches A1-A8 (A6-A8 now limited by D31).
- T\decisions.md — D29, D30, D31.
- W\libs\backend\codex-runtime\src\lib\codex-session-history.ts — CodexHistoryReader (12b).
- W\apps\ptah-electron\src\di\codex-runtime-composition.ts — Electron chat binding, scope factory,
  resolveRuntime port; 12d-1 binds the history port here.
- W\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.ts — 12d-2 routing target.

## Background work

- Codex lane `25f8d552-620f-4b61-b4b0-95833a319671` (D9 12c-1 projector), running. Its report and
  `<agent-lane-completed>` go to the new session; read with `ptah_agent_read`.
- No verify, subagent or other lane running.

## Next steps

1. When lane 25f8d552 completes: check `git -C W status`/diff, CR bytes
   (`tr -cd '\r' < file | wc -c`), then review with the in-process `code-logic-reviewer` subagent
   (writes T\code-logic-review-D9-12c1.md), and in parallel verify (background, timeout >= 90 min):
   `npm run verify -- -t typecheck,lint -p agent-sdk,codex-runtime,rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,cli-engine`
   then the same with `-t test`. Fix findings via a codex lane; commit in the foreground; push in
   the background; watch PR #881 CI with `gh pr checks 881 --json name,state --jq ...`.
2. 12c-2 router, 12d-1 Electron host (+ r1 moderate follow-ups M1-M4), 12d-2 RPC — one codex lane
   each, same review/verify/commit loop; gates per plan-d9-history.md.
3. Ask the user to authorize the D9 live check (turn cap); run it per the Electron live-test
   procedure (session 24 handoff, commit e10bb860a) with settings.json backup/restore + `cmp`.
4. Removal A A2-A5 (retire Codex fallback selection, remove proxy consumers, delete
   `providers/codex/codex-translation-proxy.ts` and Codex-only proxy symbols), then A6 per D31
   (binary path off the SDK root only). Re-run the reference search for proxy symbols before A3-A5.
5. Update PR #881 body with results; mark it ready only when D9 + Removal A are done and verified.

## Rules (repeat to every lane; first lines of every lane task)

CLAUDE.md applies. Lanes never verify, commit, push or call ptah_get_diagnostics; never npm install;
deliverable paths absolute; LF, no BOM, CR check. Codex lanes use model `gpt-6-sol` (never
`gpt-6.1-terra`); codex code is reviewed by the in-process `code-logic-reviewer` subagent; coordinator
code is reviewed by a codex lane. Coordinator runs scoped `npm run verify -- -p ...` only, background,
timeout >= 90 min, typecheck,lint first then tests, reads rc and the "N tasks:" line; never edit W
while a verify runs; never commit/push while a lane edits W. Commit in the foreground (message file +
`git commit -F`, commitlint scopes from .commitlintrc.json, subject <= 72, body lines <= 100, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), push in the background. No merge, force
push, history rewrite, branch deletion or worktree removal without the user. No `any`,
`as unknown as`, `@ts-ignore`, `eslint-disable`; bracket `process.env['X']`; swallowing catches need
`// degradation-audit: ...`. Do not edit ~/.codex/config.toml; ~/.ptah/settings.json only via an
approved live-test backup/restore with `cmp`. Paid/live runs need explicit user authorization with a
turn cap. Ignore lanes of other worktrees (agent-dock, Motion, surface-session-motion,
streaming-composer, glass-theme-scenes). jq is not installed: use `gh --jq`.
