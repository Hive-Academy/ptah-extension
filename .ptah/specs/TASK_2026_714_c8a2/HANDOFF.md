# Session handoff — TASK_2026_714_c8a2 (session 29)

Written 2026-10-30. Replaces the session 28 handoff (commit a2445ce9a; read it with
`git show a2445ce9a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The full Goal, PR table, older
open items, key-file list and Rules are in the session 24 handoff:
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (still valid). The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(section "Electron live-test procedure (run from W)") and T\live-test-p8k.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823 https://github.com/Hive-Academy/ptah-extension/pull/823,
do not merge). T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W (use absolute paths or
`git -C W`); the main checkout `D:\projects\ptah-extension` must stay clean on `main` (it was
clean at handoff).

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and
CLI lanes; then Removal B (P10, `@openai/codex-sdk` lanes) and Removal A (P15, Claude SDK + Codex
translation proxy for Codex main chat). Electron first. Native UI contracts identical to Claude's;
fix gaps only in the backend translation layer; no frontend Codex special case; no second proxy;
NEVER strip/revert/comment out MCP.

User routing instruction (standing): use Codex (model `gpt-6-sol`, never `gpt-6.1-terra`), grok and
Kimi Code CLI lanes heavily and REPLACE Claude subagents for implementation, reviews and planning.
grok implements -> Kimi Code reviews (ptahCliId `pc-10e5a6b5-b237-4c72-a213-3202bd30d1fe`,
modelTier opus; fallback codex); codex implements -> grok reviews. Check `ptah_agent_list` first.
The coordinator runs verify, commit and push itself. Usage at handoff: grok weekly ~78%, codex
~29% -> send most new work to codex.

User decision this session: **D26** lane policy = "Sandbox, auto-decline" (recorded in
T\decisions.md, commit 9a3a53ac5).

## Done in session 29

- Commit **9a3a53ac5** `docs(task-specs): record live test p8k, P10 plan and D26` — pushed;
  origin == HEAD == 9a3a53ac5. Contains T\live-test-p8k.md, T\plan-p10.md (codex),
  T\plan-p10-review.md (coordinator: APPROVED WITH AMENDMENTS R1–R4), D26 in T\decisions.md.
- Live run p8k results (T\live-test-p8k.md): S1, S2, S4 PASS; S3 FAIL (failed turn -> no error
  card, tab stuck); S5 approve/decline PASS, read auto-accept FAIL; S6 partial; S7 closed Codex
  chat cannot reopen; S8 not run. settings.json restored (cmp OK). Gaps 1–10.
- Research T\research-p8k-gaps.md (codex): G2, G3, G4, G6, G7 confirmed; G5 refuted (D14
  mapping); G1 shared race; G4 blocked (no proof environmentId is local -> stays fail-closed).

## In progress — Round 8r (UNCOMMITTED in W, reviewed, partly verified)

All lanes are finished; nothing edits W. Batch reports and reviews are in T (untracked).

| Batch | Gap | Impl | Final review | Files |
| --- | --- | --- | --- | --- |
| 8r-1 | G2 clientMessageId echo + consumedClientMessageId on terminals; G3 one assistant notice "Codex reported a runtime error." before failed turn_state (not for gateway/interrupt; settlement does not await the callback); G6 typed `CodexContextStateError` (closed -> unavailable/permission -> level saved) | codex | grok T\review-8r-1-r1.md APPROVE 8/10 (minor: file split -> 8r-4) | agent-sdk `codex-app-server/codex-chat-adapter.ts`, `codex-chat-turn-stream.ts`, `codex-chat-events.ts`, `codex-chat-adapter.spec.ts`, `codex-chat-turn-lifecycle.spec.ts`; codex-runtime `src/index.ts`, `codex-context.ts`, `codex-runtime.spec.ts`, NEW `codex-context-state-error.ts`; rpc-handlers `chat/streaming/chat-stream-broadcaster.service(.spec).ts`, `chat/codex-host/codex-chat-event-callbacks(.spec).ts`, `native-session-controls(.spec).ts` |
| 8r-2 | G7 resume profile refusal: `{ success:false, error: CODEX_RESUME_PROFILE_CHANGED_MESSAGE }`; generic frontend shows one bubble after history replay | grok | Kimi T\review-8r-2-r1.md APPROVE 9/10 | rpc-handlers `chat/session/chat-session.service.ts`, `chat-session.native.spec.ts`; chat `services/chat-store/session-loader.service(.spec).ts`, `services/message-sender.service.ts` (exports `mapChatSendFailureText`) |
| 8r-3 | `config:models-list` workspace scope (params.workspacePath, echo in result; ModelStateService drops stale replies) | grok x3 + bounded codex correction (T\batch-8r-3-correction.md: no WorkspaceProviderProfileResolver; sync `snapshotSharedAuthEnv()` for both scopes; explicit scope pins providerId/savedModel via `readWorkspaceModelScope`) | Kimi T\review-8r-3-r2.md REVISE 6/10 (before correction). **Independent review of the correction NOT done yet.** | shared `types/rpc.types.ts`, `types/rpc/rpc-config.types.ts`; rpc-handlers `handlers/config-rpc.schema.ts`, `config-rpc.handlers(.spec).ts`; core `services/model-state.service(.spec).ts` |

Coordinator fixes already in W: `codex-chat-turn-stream.ts` `terminalError` typed
`CodexChatAdapterError | undefined` (TS2339); `session-loader.service.spec.ts` activationSurface
defines `tabs.setSessionProvider` via Object.defineProperty.

Verify history: verify C (36 tasks, all 8r projects incl. shared/core/chat/agent-sdk/codex-runtime/
rpc-handlers + dependents) **PASS 36/36** on the 8r-3 revise-2 state. The bounded correction
changed only rpc-handlers `config-rpc.handlers(.spec).ts` after that -> verify D still needed.

T\batches.md has a "Round 8r" section (IN_PROGRESS) with 8r-1..3, deferred items and batch 8r-4.

## Open problems and decisions

- 8r-3 correction rationale (accepted by coordinator, needs the independent review): the shared
  SDK auth env belongs to the active workspace; a cross-workspace models-list request only occurs
  during a workspace switch, when ModelStateService drops the reply as stale.
- I rejected Kimi's 8r-2 proposal to throw on refusal: it breaks the `ChatResumeResult` contract
  in `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:396-409` (success stays true for activation
  errors; refusal returns success:false).
- Deferred: G4 fail-closed spike (environmentId locality); G5 resume pinning spec (codex-runtime);
  G8 = D9; G9/G10 (see T\live-test-p8k.md); G1 shared race.
- Grok lanes hit Ptah MCP handshake timeouts (no ptah_agent_report) — file deliverables were fine;
  read the deliverable files instead of waiting for a report.

## Key files

- `T\batches.md` — Round 8r section, then "# Phase P10".
- `T\plan-p10.md` + `T\plan-p10-review.md` — P10 / Removal B plan with amendments R1–R4 (R2: 10b.0a/b verify also covers agent-sdk, rpc-handlers, gateway-chat-bridge, ptah-electron + host typechecks + a chat/gateway fingerprint-stability spec).
- `T\live-test-p8k.md`, `T\research-p8k-gaps.md` — gap list and causes.
- `T\batch-8r-3-correction.md` — what the bounded correction changed.
- `W\libs\backend\rpc-handlers\src\lib\handlers\config-rpc.handlers.ts` — models-list scope capture.
- `W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-adapter.ts` — 817 lines, split due (8r-4).
- `W\libs\backend\codex-runtime\src\lib\codex-context-state-error.ts` — new typed state error.

## Background work

None. All 23 lanes of this session are `completed` (last: Kimi b9d23fea… review, codex 490b2524…
correction). No child session, no verify slot held.

## Next steps (in order)

1. State check: `git -C W status -sb` (expect the 8r files above modified/untracked, HEAD ==
   origin == 9a3a53ac5), `node scripts/verify.mjs --status`.
2. Independent Kimi review of the 8r-3 correction (fresh lane, full instructions, read-only,
   workingDirectory W): read T\batch-8r-3-correction.md, T\review-8r-3-r2.md and the diff of
   `config-rpc.handlers(.spec).ts`; deliverable `T\review-8r-3-correction.md` (verdict + score).
   Fallback reviewer: codex. If it finds a real defect, the coordinator fixes it (cap reached).
3. In parallel, verify D (background, timeout >= 90 min) from W:
   `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron`, then
   `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli,ptah-tui`.
   Nx cache logs: `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\`.
4. Commit separately (foreground, explicit paths, message file + `git commit -F`, no BOM, trailer;
   check `.commitlintrc.json` scopes): 8r-1 `fix(agent-sdk,rpc-handlers,codex-runtime): ...`,
   8r-2 `fix(rpc-handlers,chat): ...`, 8r-3 `fix(shared,rpc-handlers,core): ...`, then
   `docs(task-specs): ...` for batches.md (mark Round 8r COMPLETE), reports, reviews, research,
   this HANDOFF. Push in the background; then
   `gh pr checks 823 --json name,bucket --jq '[.[]|.bucket]|group_by(.)|map({(.[0]):length})|add'`.
5. Batch 8r-4 (codex implements, grok reviews): split `codex-chat-adapter.ts` — move the
   session-controls group (~:594-751) into `codex-chat-session-controls.ts` with delegates,
   behavior-preserving. Verify agent-sdk, rpc-handlers, gateway-chat-bridge, ptah-electron.
6. Live run p8l (same procedure as p8k, settings.json backup into a NEW %TEMP% folder + cmp
   restore, PTAH_CODEX_RUNTIME_DEV=1, model gpt-6-sol, <=10 paid turns) to re-check G1/G2/G3/G6/G7.
   If another worktree's Ptah Dev app holds the Electron lock, ask the user.
7. G4 spike and G5 pinning spec; then P10 from batch 10b.0a per T\plan-p10.md + review amendments;
   then P14 (incl. GAP-3: Codex chat gets the user's MCP servers from `~/.claude.json` via
   cli-agent-runtime mcp-directory/claude-user-mcp.reader.ts), D9, P15 Removal A.

## Rules (unchanged; repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, in the background, timeout >= 90 min.
Never build/serve/e2e except the approved Electron live run. Never npm ci/install in a worktree.
No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`. Lanes never verify, commit, push or call
ptah_get_diagnostics; say so in the first lines of each lane task; deliverable paths absolute.
Never commit while any lane edits W (read-only review lanes are fine). Commit in the foreground
(commitlint scopes, subject <= 72, body lines <= 100, no BOM, message via file + `git commit -F`,
trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background, and
not while a lane edits W (the pre-push build gate reads the working tree). No merge of the PR,
force push, history rewrite, branch deletion or worktree removal (merging main INTO the branch is
allowed). Do not edit ~/.ptah/settings.json (except the live-test backup/restore) or
~/.codex/config.toml. NEVER strip MCP. Use `gh --jq`. Strip UTF-8 BOMs from lane-written files.
`ptah_agent_spawn` resumes become fresh lanes after 10 min idle: always give full instructions.
Lane spec traps to repeat: no assignment to readonly mock properties (Object.defineProperty); no
bracket access to private members on Object.create/Object.assign objects; Promise resolves via
`new Promise<void>((resolve) => ...)`; no pending real timers; no excess properties in typed
object literals; `import 'reflect-metadata';` first in specs that load tsyringe; DevRouteOverride
fixture shape is `{ consumers: ['chat', 'gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' }`.
Kimi limits are not tracked; spot-check its citations. Revise cap: 2 lane rounds, then one bounded
coordinator correction plus an independent review.
