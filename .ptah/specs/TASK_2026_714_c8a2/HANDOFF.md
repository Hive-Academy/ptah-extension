# Session handoff — TASK_2026_714_c8a2 (session 38)

Written 2026-11-01. Replaces the session 37 handoff (`git show 5c91fa977:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`);
session 36 `16218ed0a` (its Goal, Routing facts and Rules stay valid). Older: session 35 `85a7c64bd`, 34 `805991a08`, 24 `44e3b1102` (full
goal, PR table), Electron live-test procedure `e10bb860a`.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823 https://github.com/Hive-Academy/ptah-extension/pull/823,
do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W; the main checkout stays clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and CLI lanes; then
Removal B (P10: 10e/10f, `@openai/codex-sdk` lanes) and Removal A (P15). Electron first. Native UI contracts
identical to Claude's; gaps fixed only in the backend translation layer; no frontend Codex special case; no second
proxy; NEVER strip/revert/comment out MCP. 10e/10f only after the user signs the 10d.P parity proof
(T\p10-lane-parity-proof.md); then P14 (incl. GAP-3), D9, P15.

Routing: codex (model `gpt-6-sol`, never `gpt-6.1-terra`) implements. The `claude` CLI lane is DISABLED; codex code
is reviewed by the in-process `code-logic-reviewer` subagent. Code the coordinator writes is reviewed by a codex
lane. The coordinator runs verify, commit, push. Lane limits at end of session 37: codex weekly ~73% (resets
2026-11-04 07:03 UTC); Glm and opencode at limit; grok unknown; Kimi unknown, do not use.

## Done in session 38 (pushed; PR head 6c0bd87d7, CI all green)

| Commit | Subject | Verify / CI |
| --- | --- | --- |
| 910906b31 | docs: sign the 10d.P proof (user, Electron scope) | docs |
| 6c0bd87d7 | feat(cli-agent-runtime,electron): remove legacy Codex SDK lane (10e + 10e.G + 10f) | see commit body; CI green |

- User signed p10-lane-parity-proof.md (Electron scope). D29: packaged Electron admits native lanes on win32/x64
  via `isElectronCodexLaneAdmitted` (apps/ptah-electron/src/di/codex-lane-composition.ts); shared CodexParityGate
  stays closed, so packaged CLI/TUI and production VS Code have NO Codex lane until their proof (user decision).
- Reviews: code-logic-review-10e.md (8), -10e-G.md (8.5), -10e-G-r1.md (9), -10f.md (codex, 9).
- Open minor follow-ups: 10e-G-r1 #1 (log not-called assertions), #2 (win32/x64 literal duplicates gate table);
  10e #2 agent-sdk codex-native-binary-path.ts:145 SDK probe empty catch (P15); 10e #3 no reason field in detect.
- Local lint: auth-providers @nx/dependency-checks reports persistence-sqlite unused (false positive, same on main;
  CI checks green). auth-providers real-SDK integration spec EPERM temp cleanup on Windows (environment).

## Next steps (session 38 -> 39, in order)

1. P14 14a (codex lane): parity-gate ledger update (batches.md:3795-3804); gate stays `enabled: false`.
2. GAP-3 (D24(4)): Codex chat gets user MCP servers from ~/.claude.json via claude-user-mcp.reader.ts.
3. D9 history after reload (batches.md:2651) before P15.
4. 14b live Electron parity run: needs explicit user authorization with a turn cap.
5. P15 Removal A after the P14 proof.

## Done in session 37 (all pushed; PR head 065b4fb5e, clean, in sync with origin)

| Commit | Subject | Verify / CI |
| --- | --- | --- |
| ad3805f09 | docs: third Electron live run (r3) | docs |
| 2d1c69dd2 | fix(cli-agent-runtime,lane-outcomes,electron): record native lane usage (10d.L5 + rev 1) | tc/lint 20/20; test 53/55 (known Windows-only only); CI green |
| c056a0f5f | docs: fourth Electron live run (r4) | docs |
| 792491e49 | fix(lane-outcomes): resolve the outcome recorder on first use (10d.L5 rev 2) | tc/lint 12/12; test 51/51; CI green (all required jobs) |
| 374a06db3 | docs: fifth Electron live run (r5) | docs |
| 065b4fb5e | docs: classify G6 per-turn lane completion as parity | docs |

Reviews: T\code-logic-review-10d-L5.md (REVISE 6), -r1.md (APPROVED 8), -r2.md (APPROVED 8). Lane reports:
T\batch-10d-L5-report.md, T\batch-10d-L5-r2-report.md.

Live results (all Electron, settings.json restored, `cmp` 0 every run):
- r3 (8/8 turns): G2-B PASS (completion for a resumed lane queued while the chat is busy, delivered after the report
  turn; 0 busy / 0 delivery-failed). G1, G3 PASS.
- r4 (7/8 turns): G5 token columns PASS. Gate S FAIL, cause found (recorder chain needs WorkspaceScopeResolver,
  registered only once ACTIVE_WORKSPACE_SOURCE exists) -> fixed in 792491e49. Scenario C was a test design error
  (lane told to wait inside its turn; queued message never started).
- r5 (**5 turns against an authorized cap of 4** — guard polled every 250 ms and two turns started 65 ms apart; the
  user was told): gate S PASS, G5 PASS, G3 PASS, a queued `ptah_agent_message` to a running lane started lane turn 2.
  Resume not tested (gate chose `fresh`: idle 5240 s > 600 s). G6 (completion signalled per lane turn) is shared
  manager behavior for all continuation-capable lanes (agent-process-manager.service.ts:3078-3117) = parity.

## Open problems and decisions

- SIGNED in session 38 (see above).
- Minor, non-blocking: spawn result gave the main agent no usable agentId (first message call isError, r5 app.log
  1670); resume gate said "host holds no record" for a row with `workspace_root NULL` (r5, copied DB); stale comment
  `apps/ptah-electron/src/di/container.ts:46` (start-after-phase-4 move no longer needed; smoke spec guards an order
  that no longer matters); events before workspace settings exist are lost (no retry); no spec for a recorder throw
  inside a callback; cost_usd NULL; reasoning segments not stored; a resume replaces the earlier lane output; old
  app-server exit logged as "Codex process failure"; stale "needs you" banner; G4 never observed live.
- CLI, TUI and VS Code proof rows stay PENDING-LIVE unless the user authorizes runs there.

## Key files

- T\p10-lane-parity-proof.md — the proof to sign; corrective batches and live results r2-r5.
- T\live-test-p10dP-r3.md, -r4.md, -r5.md — live run reports (procedure, evidence, app.log line numbers).
- T\plan-p10.md — 10e/10f definition (after 10d.P). T\decisions.md — D26-D28.
- libs/backend/lane-outcomes/src/lib/di/start.ts — lazy recorder (792491e49).

## Background work

- None for this task. All lanes (c61b4698, 760145d3, 360c3795) and subagents finished. Lanes from other worktrees
  (agent dock, Motion, surface-session-motion, streaming-composer) are not ours; ignore them.
- Live run folders in %TEMP%: ptah-live-p10dL3-20261031-234219, ptah-live-p10dL4-20261101-012450,
  ptah-live-p10dL5-20261101-030143 (app.log, ptah.db, shots, settings backups).

## Next steps of session 37 (history; steps 1-2 done in session 38)

1. Ask the user (if not already answered) to sign T\p10-lane-parity-proof.md for Electron, or to name a gap to fix.
   On "sign": update the Signature line (`Signed: <user> <date>, Electron scope`), commit, push.
2. Only after signing: 10e, then 10f (Removal B) per T\plan-p10.md — codex lane implements, code-logic-reviewer
   reviews, coordinator verifies/commits/pushes, watches CI. Then P14 (incl. GAP-3), D9, P15.
3. Optional cheap fix (codex lane): stale container.ts:46 comment / remove the now-unneeded order assertion; spec for a
   recorder throw inside a callback.

Verify (background, timeout >= 90 min, read rc and "N tasks:"; typecheck,lint first, tests second):
`npm run verify -- -t typecheck,lint -p cli-agent-runtime,codex-runtime,agent-sdk,lane-outcomes,cli-engine,rpc-handlers,ptah-electron,ptah-cli,ptah-extension-vscode,degradation-audit,di-lint`
then the same with `-t test`. Expected: 20/20, then 53/55 with only the known Windows-only failures
(rpc-handlers 17 session-folder/symlink tests, agent-sdk 2 plugin-loader tests). The verify queue is often full
(waits of 10+ min are normal; `node scripts/verify.mjs --status`).

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, under the FIFO lock, in the background, timeout
>= 90 min; read rc and the "N tasks:" line; failed task logs are in
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>`. Never build/serve/e2e except an approved Electron
live run. Never npm ci/install in a worktree. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; bracket
`process.env['X']`; swallowing catches need `// degradation-audit: optional-capability|reported - <reason>`. Specs
must pass on Windows and Linux. Lanes never verify, commit, push or call ptah_get_diagnostics (first lines of each
lane task); deliverable paths absolute; lanes write LF and never convert line endings (check
`tr -cd '\r' < file | wc -c` on every lane-written file). Never commit, push or merge while a lane edits W or a
verify runs; never edit W while a verify runs. Commit in the foreground (commitlint scopes from .commitlintrc.json,
subject <= 72, body lines <= 100, no BOM, message file + `git commit -F`, trailer
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. No PR merge, force push, history
rewrite, branch deletion or worktree removal. Do not edit ~/.codex/config.toml; ~/.ptah/settings.json only via the
approved live-test backup/restore with `cmp`. NEVER strip MCP. jq is not installed: use `gh --jq`. A live or paid
run needs explicit user authorization with a turn cap; a turn guard must stop the app BEFORE the cap can be passed
(stop when count reaches cap-1 and a turn is active, not after), and the resume gate refuses lanes idle > 600 s.
