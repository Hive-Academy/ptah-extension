# Session handoff — TASK_2026_714_c8a2 (session 30)

Written 2026-10-30. Replaces the session 29 handoff (read it with
`git show 380bb6741:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The full Goal, PR table, older
open items, key-file list and Rules are in the session 24 handoff:
`git show 44e3b1102:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (still valid). The Electron
live-test procedure is in `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(section "Electron live-test procedure (run from W)") and T\live-test-p8k.md / T\live-test-p8l.md.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823
https://github.com/Hive-Academy/ptah-extension/pull/823, do not merge).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W (absolute paths or `git -C W`); the main
checkout `D:\projects\ptah-extension` must stay clean on `main`.

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
The coordinator runs verify, commit and push itself.
Usage at handoff: grok weekly 95% (near limit, resets 2026-11-03 17:40 UTC) -> use Kimi as the
reviewer for codex work until then; codex weekly ~36%.

## Done in session 30 (all pushed; PR #823 head 88089a6a3)

| Commit | Subject |
| --- | --- |
| 380bb6741 | docs(task-specs): record live run p8l and plan batch 8r-5 |
| 99bf200a6 | test(rpc-handlers,codex-runtime): prove Codex resume keeps the level (G5) |
| 88089a6a3 | fix(rpc-handlers,shared): settle chat:continue after an ended Codex turn (8r-5, G3) |

- G5: new `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.resume-permission.spec.ts`
  (stateful identity store, real host profile path, no supplied level); reviews REVISE 5 ->
  REVISE 7 -> coordinator correction -> review-g5-correction.md APPROVE 9/10.
- 8r-5: chat:continue returns the existing `settled: true` when the native Codex turn ended before
  the reply (live + resume path); Claude stays `enqueued: true`. Reviews REVISE 4 -> REVISE 6 ->
  coordinator correction (resume path fire-and-forget again) -> REVISE 8 (spec typing / hang) ->
  fixed -> review-8r-5-correction-2.md APPROVE 10/10.
- Verify: codex-runtime 3/3; rpc-handlers 3/3 (final state); ptah-electron + gateway-chat-bridge
  12/12. CI on 88089a6a3: 19 pass / 4 skipped after one re-run (the first run failed one flaky
  `platform-core` test, `agent-pack-download.service.spec.ts` "no-clobber ... concurrent writer";
  this branch does not touch platform-core). 0 unresolved review threads.
- Push quirk: `git push` of several commits at once failed 3x with GitHub "remote rejected
  (Internal Server Error)"; pushing ONE commit at a time worked
  (`git push origin <sha>:refs/heads/feat/codex-runtime-integration`, oldest first).

## In progress — batch 8r-6 (G9), UNCOMMITTED in W

G9 (pre-existing): a live Codex follow-up held chat:continue for the whole turn; > 120 s
(CHAT_ADMISSION_RPC_TIMEOUT_MS) showed "Message delivery failed. RPC timeout: chat:continue".
Fix: the Codex send resolves at turn/start admission; the broadcaster loop continues; later
publisher rejections are logged. Running live follow-up -> `enqueued: true`; running resume ->
`{ success, sessionId }`; ended before reply -> `settled: true`; turn/start refusal -> one notice,
`settled`.

Uncommitted files in W:
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-admission.ts` (NEW),
  `codex-chat-adapter.ts`, `codex-chat-turn-stream.ts`, `codex-chat-adapter.spec.ts`,
  `codex-chat-turn-lifecycle.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`,
  `chat-continue-codex-resume-once.spec.ts`
- T: `batch-8r-6-report.md`, `batch-8r-6-revise-1.md`, `review-8r-6.md` (grok REVISE 7/10),
  `review-8r-6-revise-1.md` (Kimi APPROVE 9/10), `batches.md` (8r-5, G5, G9, 8r-6 entries appended)
- Commit message ready: `/tmp/c8r/m9` (subject "fix(agent-sdk,rpc-handlers): answer Codex
  chat:continue at admission"). /tmp may not survive; recreate from the batch reports if missing.

Verify of the revised code FAILED (24 tasks: 21 ok, 3 failed; log /tmp/verify-8r6.log):
1. agent-sdk lint: `codex-chat-adapter.spec.ts:363:48` require-yield (generator without yield).
2. agent-sdk test: `codex-chat-adapter.spec.ts` "blocks overlapping turns and follow-ups after a
   failed interrupt" — `interruptSession` at ~1170 throws runtime-failed (cause 'secret', ~1156);
   Jest also reported a worker that did not exit gracefully (leak).
3. rpc-handlers test: `codex-host/codex-chat-native-contract.spec.ts` — "settles a stop during
   approval ..." (`/compact` at ~1075 -> busy, previous turn still running); "keeps the live
   thread through follow-ups ..." (~1116 lifecycle empty); "keeps a resumed thread live ..."
   (~1167 lifecycle empty). Cause: specs assumed the send awaits the whole turn.

## Open problems and decisions

- 8r-6 revise cap: 2 lane rounds used (impl + revise 1). The verify failures went to a spec-only
  codex lane (below). After it: one independent Kimi review of the spec changes, then verify. If
  a failure proves a production defect, the coordinator fixes it (bounded) + independent review.
- Deferred: G4 fail-closed spike (environmentId locality, on hold: no proof a non-null
  environmentId is local); G8 = D9 (incl. p8l gap 3: branch fork reads a Codex message via a
  Claude session file); G10 (T\live-test-p8k.md); a later live run re-checks G3, and G7 with a
  Plan-mode change.
- Grok lanes hit Ptah MCP handshake timeouts (no ptah_agent_report): read their deliverable files.
- Other-session handoff record `D:\projects\ptah-extension\.ptah\subagent-handoffs\20261030T113951635Z-...handoff.md`
  (TASK_2026_854) is NOT this task; leave it.

## Key files

- `T\batches.md` — Round 8r section (8r-5, G5, G9, 8r-6 entries at the end), then "# Phase P10".
- `T\plan-p10.md` + `T\plan-p10-review.md` — P10 / Removal B plan with amendments R1–R4 (R2: 10b.0a/b verify also covers agent-sdk, rpc-handlers, gateway-chat-bridge, ptah-electron + host typechecks + a chat/gateway fingerprint-stability spec).
- `T\review-8r-6.md`, `T\review-8r-6-revise-1.md` — 8r-6 behavior by failure timing.
- `W\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-admission.ts` — admission promise + detached publisher (new).
- `W\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts` — continueSession reply selection (~1250-1315), resume (~1960).
- `W\libs\frontend\chat\src\lib\services\message-sender.service.ts` (~830-882) — how the renderer treats settled / enqueued / errors (read only; no Codex branch allowed).

## Background work

- CLI lane `fed0e31f-6e60-4d28-99ee-47d7242947a2` (codex, CLI session
  01a18d67-5c3d-7530-a99d-fe8558b5eee2): RUNNING at handoff. Spec-only fix of the 3 verify
  failures above. Deliverable `T\batch-8r-6-spec-fix.md`. It edits files in W: do not commit or
  push until it ends.
- No verify running, no child session.

## Next steps (in order)

1. When lane fed0e31f ends: read `T\batch-8r-6-spec-fix.md` and `git -C W diff --stat`. If it
   reports a production defect, fix it as the bounded coordinator correction.
2. Independent Kimi review (read-only, fresh lane, full instructions) of the spec changes;
   deliverable `T\review-8r-6-spec-fix.md`.
3. Verify from W in the background (timeout >= 90 min; never echo the exit code as the last
   command — check `rc` and the "N tasks:" line):
   `npm run verify -- -p agent-sdk,rpc-handlers,gateway-chat-bridge,cli-agent-runtime,cli-engine,ptah-electron`
   then `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli,ptah-tui`.
   Failure logs: `C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>` (id in the log).
4. Commit 8r-6 (foreground, explicit paths, BOM strip, `git commit -F`), plus this HANDOFF and the
   T reports. Push in the background ONE commit at a time if the batch push fails again. Then
   `gh pr checks 823 --json bucket --jq 'group_by(.bucket)|map({(.[0].bucket):length})|add'`
   (wait until >= 20 checks exist and none is pending).
5. Then G4 spike; P10 from batch 10b.0a per T\plan-p10.md + review amendments; P14 (incl. GAP-3:
   Codex chat gets the user's MCP servers from `~/.claude.json` via cli-agent-runtime
   mcp-directory/claude-user-mcp.reader.ts); D9; P15 Removal A. A later live run re-checks G3 and
   G7 (Plan-mode change), and G9 with a turn longer than 120 s.

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
`ptah_agent_spawn` resumes become fresh lanes when the old context is large: always give full
instructions. Lane spec traps to repeat: no assignment to readonly mock properties
(Object.defineProperty); no bracket access to private members; Promise resolves via
`new Promise<void>((resolve) => ...)`; explicit `let f: () => void = () => undefined` typing; no
pending real timers or promises at test end; no excess properties in typed object literals;
`import 'reflect-metadata';` first in specs that load tsyringe; DevRouteOverride fixture shape is
`{ consumers: ['chat', 'gateway'], source: 'PTAH_CODEX_RUNTIME_DEV' }`. Kimi limits are not
tracked; spot-check its citations. Revise cap: 2 lane rounds, then one bounded coordinator
correction plus an independent review.
