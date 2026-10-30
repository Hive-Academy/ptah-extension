# Session handoff — TASK_2026_714_c8a2 (session 32)

Written 2026-10-30. Replaces the session 31 handoff (read it with
`git show 82e5b4455:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; its Goal, Rules and lane spec traps
stay valid). Older context: session 24 handoff `git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(full goal, PR table, key files); Electron live-test procedure in
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
be another family. **User decision in session 32: when Glm is unavailable, a `claude` CLI lane
(`cli: claude`) reviews codex's code** (reviews only; implementation stays on codex). The
coordinator runs verify, commit and push itself.

Lane limits at end of session 32:
- grok: 402 "Grok Build usage balance exhausted" (weekly 100%, resets 2026-11-03 17:40 UTC; may need
  a balance top-up). Do not use.
- Kimi Code (pc-10e5a6b5-...): third 429 at 18:13 UTC, reset unknown. Do not use this run.
- Glm (pc-355b645d-35af-4974-84cf-9cf961ea0164, ollama-cloud): weekly 98% (resets 2026-11-02 00:00 UTC).
- claude CLI: works, limit not tracked. Fast reviews (1-4 min).
- codex: weekly ~46% (resets 2026-11-04 07:03 UTC). Codex resumes above ~60k tokens become fresh
  lanes with a handoff brief: always give self-contained tasks.
All recorded in T\context.md.

## Done in session 32

| Commit | Subject | Pushed |
| --- | --- | --- |
| 82e5b4455 | feat(cli-agent-runtime): add the App Server Codex lane adapter core (10b-1) | yes |
| 0da074226 | feat(cli-agent-runtime,codex-runtime): add Codex lane effort and retries (10b-2a) | yes |
| 0b74c405b | Merge origin/main (a7036819e) into feat/codex-runtime-integration | **NO — push was stopped** |

- 10b-1: `codex-app-server-lane.adapter.ts` (+ `-startup.ts`, spec). Glm REVISE -> codex revise 1;
  coordinator correction (`starting` flag, cleared in the same sync step as `active`), codex review
  APPROVE 10/10. Verify: 18/18 + 3 host typechecks.
- 10b-2a: effort, one essential config retry (open-level only, legacy essential set), notice,
  model-rejection advice; `CodexPreTurnConfigRejectedError.rejectedKey` (safe key only) in
  codex-runtime. Helpers `codex-app-server-lane-profile.ts`, `codex-app-server-lane-rejection.ts`.
  Glm REVISE 7/10 -> revise 1; claude REVISE (resume-retry fingerprint claim, disputed: fingerprint
  digests only permissionLevel/sandboxPolicy/approvalPolicy) -> revise 2 spec pins it; claude
  APPROVE 8/10. Verify: R2 list 27/27 + 3 host typechecks; cli-agent-runtime 3/3 after revise 2.
- CI: fe775e379 all green. 82e5b4455 and 0da074226 got NO CI because PR #823 conflicted with main.
- Merge 0b74c405b (local only): codex lane resolved 6 conflicted files
  (T\merge-main-a7036819e-report.md); claude review REVISE 6/10 (3 native-Codex lineage gaps) ->
  codex fix (T\merge-main-fix-report.md) -> claude APPROVE 8/10 (T\review-merge-main-fix.md).
  Coordinator spec fixes in `chat-continue-codex-resume-once.spec.ts` (real temp folder,
  createMockWorkspaceProvider, platformInfo, race bound 2 s).
  Verify (Windows): 10 projects lint+typecheck pass; 4 host typechecks pass (vscode, cli, tui,
  webview). Tests: codex-runtime pass (earlier 5 s timeouts were load flakes); agent-sdk 1 fail and
  rpc-handlers 12 fail, ALL from main's own tests that are Windows-only (path separator `/` vs `\`
  expectations in TASK_2026_584 / TS-04 / MP-3 suites, symlink EPERM in resolveSessionFolder and
  PluginLoaderService alias test). Linux CI should pass them.

## Open problems

1. **Push 0b74c405b** (it was stopped). Until it lands, PR #823 stays CONFLICTING and runs no CI.
2. After the push: confirm `gh pr view 823 --json mergeable` is MERGEABLE and CI runs. If Linux CI
   fails any of the 13 tests listed above, they are real and must be fixed.
3. The `jq` binary is not installed: use only `gh ... --jq` in watchers.
4. My BOM-strip loop must only touch task files: in session 32 it stripped 3 BOMs from main's
   files and I restored them. Strip only files the lane wrote.

## Background work

None. No lane, child session, verify or watcher is running.

## Next steps (in order)

1. Push: `git -C W push origin feat/codex-runtime-integration` (background; pre-push hook runs
   di-lint + Electron validate-deps under the verify lock). Then check
   `gh pr view 823 --json headRefOid,mergeable,mergeStateStatus --jq '"\(.headRefOid[0:9]) \(.mergeable) \(.mergeStateStatus)"'`.
2. Watch CI for 0b74c405b with `gh run list --branch feat/codex-runtime-integration --limit 10 --json headSha,status,conclusion,name --jq ...`
   (background loop, no jq). Fix real failures with a new commit.
3. 10b-2b (codex): detect() (pinned native binary, explicit CODEX_HOME, version of the binary
   used), credential check (read-only ensureTokensFresh semantics in the selected home, no
   fallback), listModels via CodexContext.listModels with curated fallback on visible failure,
   explicit binary path validation. Preserve rows: T\plan-p10.md "Detection and actual native
   binary", "Credential check and account home", "Model selection and catalog". Files: the codex
   lane adapter + new `codex-app-server-lane-*.ts` helpers in
   `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\`.
   Verify: `npm run verify -- -p cli-agent-runtime,codex-runtime,cli-engine,ptah-electron` then
   `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli,ptah-tui` (background,
   timeout >= 90 min; read rc and the "N tasks:" line; logs in
   `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`).
4. Then 10c, 10d.E/C/V, 10d.P (parity proof; live/paid run needs coordinator authorization),
   10e, 10f per T\plan-p10.md + T\plan-p10-review.md (R1-R4). Then P14 (incl. GAP-3), D9, P15.

## Key files

- `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane.adapter.ts` — native lane adapter (10b).
- `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-app-server-lane-rejection.ts` — essential retry + notices + model advice.
- `W\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex-cli.adapter.ts` — legacy SDK lane adapter (parity baseline, removed in 10e).
- `W\libs\backend\codex-runtime\src\lib\codex-runtime.ts` — runtime open, CodexPreTurnConfigRejectedError.
- `W\libs\backend\codex-runtime\src\lib\codex-execution-profile.ts` — profile + fingerprint (policy only).
- `W\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts` — chat routing; merged with main's lineage.
- `W\libs\backend\agent-sdk\src\lib\session-metadata-store.ts` — codexExecution/codexThread + lineage.
- T\plan-p10.md, T\plan-p10-review.md — P10 plan and binding amendments R1-R4.

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit or push while any lane edits W. Commit in the foreground (commitlint scopes, subject
<= 72, body lines <= 100, no BOM, message via file + `git commit -F`, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. No PR merge,
force push, history rewrite, branch deletion or worktree removal (merging main INTO the branch is
allowed). Do not edit ~/.ptah/settings.json (except the live-test backup/restore) or
~/.codex/config.toml. NEVER strip MCP. Lane spec traps: see the session 31 handoff Rules section.
