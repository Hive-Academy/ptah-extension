# Session handoff — TASK_2026_714_c8a2 (session 24)

Written 2026-10-29. Replaces the session 23 handoff (commit 2b2299ac1). Older handoffs:
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. The full Electron live-test procedure is in
the session 20 handoff: `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` (section
"Electron live-test procedure"). Session 23 handoff = `git show 2b2299ac1:<same path>`.

At handoff: NO subagent, team-leader, CLI lane, verify or CI watcher of THIS task is running.
Lanes of other tasks (other worktrees) are not ours — do not touch them.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, draft PR #823). Main checkout = `D:\projects\ptah-extension`
(stays on `main`; its pre-existing dirty files are NOT ours). T = `W\.ptah\specs\TASK_2026_714_c8a2\`.

**W IS NOT CLEAN on purpose:** batch 8p-4 is implemented and reviewed but NOT committed (2 stale
specs fail). See "In progress". Do not discard these files.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Native chat must produce EXACTLY the same UI contracts as Claude (`FlatStreamEventUnion`,
`turn_state`, `PermissionRequest`, the AskUserQuestion flow, tool input/output shapes, session
RPCs); never special-case the frontend for Codex. Fix gaps in the BACKEND translation layer
(codex-runtime -> agent-sdk codex-app-server -> rpc-handlers codex-host). No second proxy.

## User decisions (all in decisions.md)

- PR #823 is NOT merged by us. Pre-existing defects go out as SEPARATE small PRs from `main`;
  `main` is MERGED into the branch (merge commit, no rebase, no force push).
- Native App Server features first; build only where they do not exist.
- PR #823 scope: P8, P9 gateways, P10 lanes + Removal B, P14 live parity, P15 Removal A.
  P11-P13 and the harness-sync Codex removal go to the FOLLOW-UP PR.
- D8: full parity incl. Ptah MCP + user MCP servers. NEVER strip, revert or comment out MCP.
- D9 (history after reload) is REQUIRED before Removal A (P15).
- Live Electron test approved (p8 series): build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, <=10 paid turns
  per run, settings.json backup + `cmp` restore, approval mode "Manual" first. Runs p8g, p8h, p8i
  were done under that go. A new run (p8j) for the Round 8p fixes is a continuation of the same p8
  live test.
- Model: `gpt-6-sol` for lanes and live tests until `gpt-6.1-*` ships in a new dev build. Never
  `gpt-6.1-terra`.
- User MCP server for the MCP check: **sonarqube** (GAP-3: it does not reach Codex chat today).
- D20 (user): read-only allowlist for Codex Manual chat (deny-by-default, one request at a time,
  never acceptForSession / rule amendment, logged by name only).
- D21 (user): Codex chat gets the Ptah UI hint without the "load the skill" sentence.
- D22: GAP-F ("Command succeeded" header on a failed command) is a shared frontend defect ->
  separate small frontend PR from `main`.
- Coordinator decisions (reversible): D14, D14a, D19; **D23 (new, session 24)**: `thread/resume`
  accepts new developer/base instructions and Ptah sends them on resume, so the resume
  fingerprint covers ONLY permission level, sandbox and approval policy. Prompt, output style and
  UI-hint changes no longer block a resume. D14a still holds (a policy change refuses with the
  typed `CodexResumeProfileChangedError`). Every fingerprint stored before D23 refuses resume once.
- Open Q&A, no decision: an opt-in "use my installed codex" setting. Do not build unless asked.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Round 8p commits pushed at session end (up to `8866ae2d5`) plus this handoff commit; CHECK their CI first. Last green CI: `8ba382b2f` (19 pass, 4 skipped). |
| #839 | `fix/codex-cli-bump` | MERGED. Worktree kept until the user authorizes cleanup. |
| #824, #826 | earlier fix PRs | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done in session 24

| Commit | What |
| --- | --- |
| `552010a4e` | CI fix: degradation-audit markers on 2 intentional fail-closed catches (8o-3, 8o-4). CI green. |
| `a072e8f35` | `0.165` added to `CODEX_VERIFIED_VERSIONS` after a live codex lane check (`gpt-6-sol`, no config-key rejection, Ptah MCP call OK; `lane-config-0165-report.md`). Trio verify 9/9. |
| `ea14437bc` | P8 re-review of the task's own commits in `9b5f4c86c..HEAD`: logic NEEDS_REVISION 6/10 (`code-logic-review-p8.md`), style NEEDS_REVISION 7/10 (`code-style-review-p8.md`). These files replaced older reviews of the same name (old ones in git history). |
| `8ba382b2f` | Live test p8i report (`live-test-p8i.md`). CI green on this head. |
| `42cbcfa64` | 8p-1 GAP-A: reads auto-accept in the real Codex wrapper (full-path SystemRoot `powershell.exe -Command <body>`, `-NoProfile` optional); the proposed exec-policy amendment on every approval is ignored and a plain one-time `accept` is sent. Security APPROVED WITH NOTES 8/10, logic 8/10. |
| `f3bdd974d` | 8p-3 D23 policy-only fingerprint; typed `CodexResumeProfileChangedError` + guard + one user text exported from codex-runtime; refused live user answer -> follow-up error event. APPROVED 8/10. |
| `e8d449ab8` | 8p-2 GAP-I: first Codex follow-up after a restart is delivered once (no false CODEX_BUSY). APPROVED 8/10. |
| `0759012e3` | 8p-7 flatten the Codex message count read. APPROVED 9/10. |
| `1035d575f` | 8p-5 codex-runtime owns the Ptah MCP URL + `CODEX_PTAH_TOOL_TIMEOUT_SEC` (moved from cli-agent-runtime). APPROVED 9/10. |
| `7734ff47d` | 8p-6 `RuntimeContext` moved into `codex-context.ts` (codex-runtime.ts 147 lines; codex-context.ts ~913, class alone 847 > 700 warning). BOM removed. APPROVED 9/10. |
| `8866ae2d5` | docs: Round 8p batches + D23. |

Verify: Round 8o phase gate PASS (audit, di-lint, 4-host typecheck 4/4). Round 8p wave 1 (6
projects x lint/test/typecheck) 18/18; wave 2 lint+typecheck pass, tests pass except 8p-4 specs.

Live test p8i (`live-test-p8i.md`, evidence `%TEMP%\ptah-live-p8i-20261029-033517\`, 10 paid turns,
`cmp` OK, CDP port 9336 because another worktree's app held 9335): PASS E question card, B/C
sessions + titles after restart, H account usage, D21 no skill lookups, 8m-8 tool-only turn, write
card before action. GAP: A (fixed in 8p-1, not yet live-checked), I (fixed in 8p-2, not yet
live-checked), D9 transcript, F header, G6 fileChange (model uses PowerShell), D14a NOT REACHABLE
(old rows hidden), GAP-3 unchanged (Codex chat gets only `smithery` + Ptah MCP).

## In progress

**Batch 8p-4 — uncommitted in W** (typed resume error consumers; exported
`StreamlessFollowUpAdmission`; the 8p-2 review's 2 moderate fixes: attachment-only double send and
attachments dropped on the open-thread branch). Reviewed APPROVED 8/10
(`code-logic-review-8p-4.md`, untracked). Files:
`libs/backend/agent-sdk/src/index.ts`, `agent-sdk/.../codex-app-server/codex-chat-adapter.ts` +
`.spec.ts`, `session-runtime-router.ts`, `rpc-handlers/.../chat/session/chat-session.service.ts`,
`chat-continue-codex-resume-once.spec.ts`, `chat-session.native.spec.ts`, plus untracked
`T/batch-8p-4-report.md`, `T/code-logic-review-8p-4.md`. Left to do:
1. `codex-chat-adapter.spec.ts` ~1540-1550: throw `new CodexResumeProfileChangedError()` instead
   of a fake error object (the `instanceof` guard correctly rejects the fake).
2. `chat-session.native.spec.ts` (4 tests near 350, 432, 475): pass the new `deliversFollowUp`
   option to `autoResumeIfInactive` or expect `promptDelivered: false`.
3. Review points: make `deliversFollowUp` a named option; comment the double check in
   `codexFailure`.
4. Chat-path verify, then commit (with the two untracked docs).

**Batch 8p-8 — not started** (listed in batches.md "Round 8p"): tighten SystemRoot trust;
log `hasReason` (yes/no only) per auto-accept; skip the edit follow-up when the sink is disposed
+ spec for abort during the path check; export `CodexRuntimeOptions` from `codex-context.ts` and
drop the temporary type re-export in `codex-runtime.ts` (no-shim rule).

**Round 8p phase gate — NOT RUN** (degradation-audit, di-lint, 4-host typecheck).

## Open problems and deferred items

- **Decisions for the user** (ask once, bundle them):
  - D23 alternative: resume also accepts approval policy + sandbox, so the refusal could be dropped
    and old threads resumed under the current policy (this reverses D14a). Kept the refusal.
  - `-NoProfile` is now optional for auto-accepted reads: the user's own PowerShell profile loads
    first (same as a command the user approves). The security review asks for an explicit OK.
  - Bare `powershell`/`pwsh` (PATH-resolved) are still accepted, as since 8o.
  - GAP-3 (P14): should Codex chat receive user MCP servers from `~/.claude.json` (user + project
    scope, stdio too)? Reader exists: cli-agent-runtime `mcp-directory/claude-user-mcp.reader.ts`;
    today only Ptah-installed HTTP servers (`buildMcpServersOverride` in rpc-handlers
    `chat/session/chat-session.service.ts`, mapped in `codex-host/codex-chat-host-ports.ts`).
    sonarqube is project-scoped to `D:/projects/ptah-extension`.
- **Live check p8j needed** for 8p-1 (reads auto-accept: count read cards vs 5 in 4 turns in
  p8h/p8i; capture the exact command string; check whether read approvals carry a `reason`) and
  8p-2 (no false "Codex is busy" on the first follow-up after a restart), plus D14a with a thread
  made on the current head and then a policy change.
- **8o-4 recorded, not fixed:** time gap between realpath check and execution; thread folder =
  home or drive root makes "inside" very wide (product decision).
- **D (= D9):** transcript gone after `/compact` and after reload. Required before P15.
- **Known, out of scope:** `chat:resume` activate still starts an empty Codex turn.
- **F (D22):** separate small frontend PR from `main`.
- **G6 fileChange path:** GPT-6-Sol on Windows writes files via PowerShell; `fileChange` approval
  not reachable with plain prompts.
- **Style re-review leftovers:** `codex-chat-adapter.ts` 811 lines, `codex-runtime-composition.ts`
  647, `codex-chat-host-ports.ts` 581, `session-metadata-store.ts` 2165 and
  `chat-session.service.ts` 2066 keep growing; `codex-context.ts` class 847 lines.
- **Logic re-review leftovers:** runtime refuses live permission changes and `resumeSession` on an
  open thread only logs differing options (Autopilot chip vs real policy can diverge); pre-ready
  notification buffer overflow (>64) kills the process (theoretical).
- Comments/fixtures still say 0.155.1 on purpose: `codex-config-rejection.ts`,
  `codex-lane-config.builder.spec.ts:34`, `codex-exec-args.ts`, `evidence-harness.ts:57,1975`,
  `codex-runtime.spec.ts:469`.
- Round 8m/8n follow-ups (Minor/Moderate, batches.md): evidence harness `realpathSync`; 8m-2 caps;
  8n-1 stderr tail at warn level relies on pattern redaction; a throwing logger in the start log
  fails a healthy start; `Date.now()` instead of the Clock port; missing specs.
- P9 open item: gateway approval policy by parity with Claude gateway chats.
- Lanes: codex (`gpt-6-sol`, weekly ~23% used, resets 2026-11-04) or grok (~12%, resets
  2026-11-03). Glm (ptah-cli) AT LIMIT; opencode at its monthly limit until 2026-11-04.
- Known local-only failures (Windows), green on Linux CI: auth-providers lint
  `@nx/dependency-checks`; 4-5 EPERM teardown failures in
  `translation-proxy.sdk.integration.spec.ts`; `chat:lint` 2 pre-existing errors; agent-sdk lint
  `session-query-executor.accounts.spec.ts:174,183`; flaky `memory-curator
  memory-trigger.coalesce.spec`.
- Lane and Windows PowerShell files are often written with a UTF-8 BOM; strip it before commit.
  Write commit messages through a bash heredoc file + `git commit -F` (no BOM).
- Live-test port: 9335 may be held by another worktree's app with its own `--user-data-dir`
  (not a single-instance conflict); use a free port (9336) and confirm the CDP target is ours.
- Machine note: an AV exclusion for `node_modules\@openai\codex-win32-x64` would make Codex start
  faster (~15-17 s now). Not changed; the user decides.

## Key files

- T: batches.md ("Round 8m" .. "Round 8p"), decisions.md (D1-D23, D14a), live-test-p8g/h/i.md,
  batch-8o-*/8p-*-report.md, code-logic-review-p8.md, code-style-review-p8.md,
  code-logic-review-8p-1..7.md, security-review-8p-1.md, security-review-8o-4.md,
  research-8o-a-report.md, lane-config-0165-report.md.
- codex-runtime: `codex-runtime.ts`, `codex-context.ts` (8p-6), `codex-execution-profile.ts` (D23),
  `codex-resume-profile-error.ts`, `codex-app-server-process.ts`, `codex-event-translator.ts`,
  `codex-approval-bridge.ts`, `codex-executable-pin-data.ts`, Ptah MCP URL (8p-5).
- agent-sdk codex-app-server: `codex-chat-adapter.ts`, `codex-chat-approval-sink.ts`,
  `codex-read-only-command.ts` (D20, 8p-1), `session-runtime-router.ts`, `codex-chat-events.ts`;
  `session-metadata-store.ts`; `prompt-harness/ptah-ui-hint.ts`.
- rpc-handlers chat: `codex-host/codex-chat-host-ports.ts`, `codex-host/codex-chat-user-questions.ts`,
  `session/chat-session.service.ts`, `ask-user-question.service.ts`.
- cli-agent-runtime: `cli-adapters/codex/codex-lane-config.builder.ts` (`CODEX_VERIFIED_VERSIONS`
  now incl. 0.165), `mcp-directory/claude-user-mcp.reader.ts`.
- gateway-chat-bridge: `codex-gateway-adapter.ts`. auth-providers: `codex-account-usage.service.ts`.

## Next steps (in order)

1. State check: `git -C W status -sb` (expect the 8p-4 files only; HEAD = origin), `gh pr checks 823`
   on the pushed head (Round 8p + this handoff), `node scripts/verify.mjs --status`. Fix any CI
   failure first.
2. Finish 8p-4 (items 1-4 under "In progress"), verify the chat path, review the spec changes,
   commit. Then 8p-8 (lane or small subagent), verify the codex-runtime trio + chat path, review,
   commit. One committing team-leader at a time.
3. Round 8p phase gate: `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`,
   `npx nx run di-lint:lint`,
   `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
   Push in the background; watch CI.
4. Ask the user ONCE (one AskUserQuestion, bundled): D23 alternative, `-NoProfile` optional,
   bare powershell/pwsh, GAP-3.
5. Live run p8j (Electron, `gpt-6-sol`, Manual, <=10 paid turns per run, <=2 runs, settings.json
   backup + `cmp` restore; delegate to a test agent; procedure in e10bb860a handoff; report into
   the evidence folder, the coordinator copies it to `T/live-test-p8j.md`): 8p-1 reads, 8p-2
   restart follow-up, 8p-3/D14a with a current-head thread + policy change, question card dismissal
   on Stop (logic S1 from the P8 review — check whether 8p-3/8p-4 covered it; if not, it is the
   next backend fix: send Claude's webview cancel when the question signal aborts).
6. Then P9 gateways, P10 lanes + Removal B (delete `@openai/codex-sdk`; keep `@openai/codex`),
   P14 live parity (incl. the GAP-3 decision), D9 history after reload, then P15 Removal A.
7. Separately (from `main`, own small PR): D22 / GAP-F frontend header.

Verify commands (background, timeout >= 90 min, under the FIFO lock):
- codex-runtime change: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`
- chat path change: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`
- shared touched: add `@ptah-extension/shared`. auth-providers: `npm run verify -- -p @ptah-extension/auth-providers`
- Phase gate: degradation-audit, di-lint, host typecheck (4 hosts, command above).

## Rules (repeat to every agent and lane)

Follow CLAUDE.md. Scoped `npm run verify -- -p ...` only, under the FIFO lock; never
workspace-wide, never `nx run-many`, never positional `nx test A B`, never build/serve/e2e except
the approved Electron live run. Never npm ci / npm install in a worktree. No `any`,
`as unknown as`, `@ts-ignore`, `eslint-disable`. Commit in the foreground (`.commitlintrc.json`,
subject <= 72, body lines <= 100, no BOM, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`),
push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
removal. Never two committing team-leaders at once; never commit while ANY lane edits W (even
file-disjoint: lint-staged stashes unstaged files). Lanes never verify, commit, push or call
ptah_get_diagnostics (say so in the first lines of the lane task); lane deliverable paths are
absolute and declared at spawn. Change a running lane only by a resume. Relay each lane signal to
its team-leader with SendMessage. Lanes: codex (`gpt-6-sol`) or grok; check `ptah_agent_list`.
Do not edit ~/.ptah/settings.json (except the approved live-test backup/restore) or
~/.codex/config.toml. NEVER strip, revert or comment out MCP. If another worktree's Ptah Dev app
holds the Electron single-instance lock, ask the user; do not kill it. Use `gh ... --jq`
(no standalone jq).
