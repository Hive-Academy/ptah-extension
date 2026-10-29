# Session handoff — TASK_2026_714_c8a2 (session 23)

Written 2026-10-29. Replaces the session 22 handoff (commit adc8b9dd9). Older handoffs:
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. The session 20 handoff (e10bb860a) has
the full Electron live-test procedure: `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`
(section "Electron live-test procedure"). Session 22 handoff = `git show adc8b9dd9:<same path>`.

At handoff: NO subagent, team-leader, CLI lane, verify or CI watcher of THIS task is running.
Lanes of other tasks (for example TASK_2026_850) are not ours — do not touch them.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, draft PR #823). Main checkout = `D:\projects\ptah-extension`
(stays on `main`; its pre-existing dirty files are NOT ours).

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
- Live Electron test approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, <=10 paid turns per run,
  settings.json backup + `cmp` restore, approval mode "Manual" first. Session 23: the user gave
  the go for p8g ("Go now"); runs p8g and p8h were done under that go. A NEW live run for the
  Round 8o fixes is a continuation of the same p8 live test; ask the user once if unsure.
- Session 23 answers:
  - Model: `gpt-6.1-*` is available only in the new dev build; until that ships, use
    "sol 6" = `gpt-6-sol` for lanes and for the live test. Never `gpt-6.1-terra`.
  - User MCP server for the MCP check: **sonarqube** (see GAP-3 below: it does not reach Codex
    chat today).
  - D20 (user): GAP-A fixed by a Ptah read-only allowlist (deny-by-default classifier, Manual chat
    only, one request at a time, never acceptForSession / rule amendment, logged by name only).
  - D21 (user): Codex chat gets the Ptah UI hint without the "load the skill" sentence.
  - D22: GAP-F ("Command succeeded" header on a failed command) is NOT a backend gap; the shared
    header ignores the error flag for Claude too -> separate small frontend PR from `main`.
- Earlier coordinator decisions (reversible): D14 (chat ask/auto-edit -> `untrusted` +
  workspace-write) for consumer 'chat' only; D14a old ask/auto-edit threads refuse resume with
  "Start a new chat"; D19 deny-with-message reason via `turn/steer`; MCP elicitation form/URL UI +
  secret input = P14 parity gaps; gateway approval policy decided in P9 by parity with Claude.
- Open Q&A, no decision: an opt-in "use my installed codex" setting. Do not build unless asked.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. `d6602359e` pushed, CI GREEN (19 pass, 4 skipped). Round 8o (5 commits) + this handoff commit are pushed at session end; CHECK their CI first. |
| #839 | `fix/codex-cli-bump` | MERGED as `35203f1d8`. Worktree kept until the user authorizes cleanup. |
| #824, #826 | earlier fix PRs | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done in session 23

- CI on `adc8b9dd9` green.
- p8g live run (`live-test-p8g.md`): BLOCKED, 0 paid turns. Codex `initialize` timed out at 10 s
  because the bundled 357 MB codex.exe 0.165.0 needs ~13 s to start from D: (likely AV scan;
  1.5 s from C:).
- `d6602359e` batch 8n-1: `initialize` gets its own 60 s budget (`INITIALIZE_TIMEOUT_MS`); start
  log line (binary path, pinned version, pin result, start-up ms); timeout log with elapsed time +
  redacted stderr tail. Verify 9/9. Review APPROVED 8/10. Pushed; CI green.
- p8h live run (`live-test-p8h.md`, 16 paid turns in 2 runs, `cmp` OK): start PASS (14.5-17.7 s);
  PASS: G6 write card before action, Allow no second prompt, plain Deny, D19, L1 Stop + follow-up,
  `/compact` backend, `/clear`, G1/L2 body, G2, G3, `ptah_workspace_analyze`, legacy marker 0,
  secret scan 0. Gaps A-H (see table below). D14a NOT RUN (no old thread in the profile).
- Round 8o (team-leader; Codex + Grok lanes; Claude reviewers). Commits (NOT yet in CI):

| Commit | Batch | Fix |
| --- | --- | --- |
| `8c9ebb682` | 8o-1 | B: Codex rows store the caller's workspace path (not the lowercased key), so they show in the sessions list; C: title from `sessionTitle`/`sessionName`/`name` |
| `6a0b5e103` | 8o-2 | H: auth-providers `codex-account-usage.service.ts` uses exported `CODEX_INITIALIZE_TIMEOUT_MS` for `initialize` |
| `eea328229` | 8o-3 | E: Codex async questions -> Claude AskUserQuestion card (same service as 8m-7), answer back into the live turn; turn end/Stop cancels the card; text fallback; gateways/lanes show text; `sleep` item silent; no mid-turn CHAT_ERROR for retry/unsupported items; one CHAT_ERROR for a rejected follow-up or failed turn |
| `c4886a2f6` | 8o-4 | A / D20: read-only allowlist (`codex-read-only-command.ts`) in `codex-chat-approval-sink.ts`; Get-Content, Get-ChildItem, Select-String, Test-Path, rg, ls, cat; realpath checked against the THREAD folder |
| `5695d519d` | 8o-5 | D21: Codex UI hint without the skill-load sentence; Claude hint pinned by a spec |

  Verify (final runs): codex-runtime + cli-agent-runtime + gateway-chat-bridge 9/9;
  agent-sdk + rpc-handlers + ptah-electron 15/15; auth-providers spec file 46/46 (only the known
  Windows-only lint + EPERM failures). Reviews: 8o-1/2 APPROVED 8/10; 8o-3 NEEDS_REVISION 6.5 ->
  re-review APPROVED; 8o-4 security NEEDS_REVISION 5/10 (cwd was model-controlled) -> re-review
  APPROVED 8/10; 8o-5 APPROVED 9/10. The last 8o-3/8o-4 test-only fixes were not re-reviewed.

## Open problems and deferred items

- **Phase gate for Round 8o NOT RUN** (degradation-audit lint, di-lint, host typecheck x4). Run it
  first (commands below).
- **Live-test items for Round 8o** (next live run, `gpt-6-sol`, Manual):
  - A: plain reads auto-accept (count prompts vs p8h's 5 in 4 turns); a write still shows the card;
    which wrapper Codex actually sends (full-path `powershell.exe` / `bash -lc` still show a card).
  - B/C: Codex sessions appear in the rail + Previous sessions after restart, with the real title.
    Rows stored before 8c9ebb682 stay hidden (no migration).
  - E: a Codex question shows Claude's card; answer continues the turn. Risk: if Codex ends the
    turn right after the async question, the card is cancelled at once. Risk: a rejected follow-up
    raises the one CHAT_ERROR and blocks a later one in the same turn.
  - H: no `[CodexAccountUsage] ... stage initialize` failure at startup.
  - D21: no `rg --files ~/.codex/skills` lookups.
  - Threads created before 5695d519d say "Start a new chat" on resume (prompt fingerprint).
  - Still open from p8h: D14a, 8m-8 tool-call-only turn, G6 `fileChange` path (G: model edits via
    PowerShell), sonarqube check (GAP-3).
- **8o-4 recorded, not fixed:** time gap between realpath check and execution; thread folder =
  home or drive root makes "inside" very wide (product decision: refuse auto-accept there?).
- **GAP-3 (needs a user decision later):** Codex chat receives only Ptah-installed HTTP MCP
  servers (Smithery/OAuth via `buildMcpServersOverride` in rpc-handlers
  `chat/session/chat-session.service.ts`, mapped in `codex-host/codex-chat-host-ports.ts`
  ~290-408). User servers in `~/.claude.json` (user scope + project scope; stdio too) do not reach
  Codex chat. The reader exists: cli-agent-runtime `mcp-directory/claude-user-mcp.reader.ts`.
  Part of D8/P14. sonarqube is project-scoped to `D:/projects/ptah-extension`, so a live check must
  open that workspace or the server must be user-scoped. Check first whether Claude chat in the
  same workspace sees it.
- **D (= D9):** transcript gone after `/compact` and after reload (no history path for Codex
  threads). Required before P15.
- **F (D22):** separate small frontend PR from `main` (shared tool card header ignores error flag).
- **Cosmetic:** "Claude" wording in Codex deny/Autopilot popovers; stale "needs you" footer line;
  raw markdown links in the rail preview.
- `CODEX_VERIFIED_VERSIONS` (`libs/backend/cli-agent-runtime/.../codex-lane-config.builder.ts:45`)
  lacks `0.165` -> non-fatal warning per lane. Add it only after a live lane config-key check on
  0.165.0 (spawn a codex lane with `gpt-6-sol`; look for config rejection warnings in its start log).
- Comments/fixtures still say 0.155.1 on purpose: `codex-config-rejection.ts`,
  `codex-lane-config.builder.spec.ts:34`, `codex-exec-args.ts`, `evidence-harness.ts:57,1975`,
  `codex-runtime.spec.ts:469`.
- Round 8m/8n follow-ups (Minor/Moderate, batches.md): evidence harness `realpathSync`;
  `CodexResumeProfileChangedError` export; 8m-2 caps; 8n-1 stderr tail at warn level relies on
  pattern redaction; a throwing logger in the start log fails a healthy start; `Date.now()` instead
  of the Clock port; missing specs (no start log on failed start; non-initialize timeouts at debug).
- P9 open item: gateway approval policy by parity with Claude gateway chats.
- Lanes: codex (`gpt-6-sol`) or grok. Glm (ptah-cli) at its Ollama Cloud limit; opencode at limit
  until 2026-11-04. Check `ptah_agent_list` first.
- Known local-only failures (Windows), green on Linux CI: auth-providers lint
  `@nx/dependency-checks`; 4-5 EPERM teardown failures in
  `translation-proxy.sdk.integration.spec.ts`; `chat:lint` 2 pre-existing errors; agent-sdk lint
  `session-query-executor.accounts.spec.ts:174,183`; flaky `memory-curator
  memory-trigger.coalesce.spec`.
- Merge commit 91b848f86 subject starts with a UTF-8 BOM (harmless; do not rewrite history).
  Write commit messages through a bash heredoc file + `git commit -F` (no BOM).
- Machine note: an AV exclusion for W `node_modules\@openai\codex-win32-x64` would make Codex start
  faster here. Not changed; the user decides.

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/: batches.md ("Round 8m", "Round 8n", "Round 8o"),
  decisions.md (D1-D22, D14a), live-test-p8g.md, live-test-p8h.md, batch-8n-1-report.md,
  batch-8o-1..5-report.md, research-8o-a-report.md, code-logic-review-8o-1-2.md,
  code-logic-review-8o-3-5.md, security-review-8o-4.md, lane-smoke-0165-report.md.
- codex-runtime: `codex-app-server-process.ts` (INITIALIZE_TIMEOUT_MS, start log, pin check),
  `codex-event-translator.ts`, `codex-runtime.ts`, `codex-runtime.types.ts`,
  `codex-execution-profile.ts` (D14), `codex-approval-bridge.ts`, `codex-executable-pin-data.ts`.
- agent-sdk codex-app-server: `codex-chat-adapter.ts`, `codex-chat-events.ts`,
  `codex-chat-approval-sink.ts`, `codex-read-only-command.ts` (D20), `codex-tool-presentation.ts`;
  `session-metadata-store.ts`, `wiring/codex-chat-metadata-port.ts`; `prompt-harness/ptah-ui-hint.ts`.
- rpc-handlers chat: `codex-host/codex-chat-host-ports.ts`, `codex-host/codex-chat-user-questions.ts`,
  `session/chat-session.service.ts`.
- cli-agent-runtime: `cli-adapters/codex/codex-lane-config.builder.ts` (`CODEX_VERIFIED_VERSIONS`),
  `codex-lane-events.ts`, `mcp-directory/claude-user-mcp.reader.ts`.
- gateway-chat-bridge: `codex-gateway-adapter.ts`. auth-providers: `codex-account-usage.service.ts`.

## Next steps (in order)

1. State check: `git -C W status -sb` (clean; HEAD = origin), `gh pr checks 823` on the pushed head
   (Round 8o + this handoff), `node scripts/verify.mjs --status`. Fix any CI failure first.
2. Phase gate for Round 8o: degradation-audit lint, di-lint,
   `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`.
3. Live run p8i (Electron, `gpt-6-sol`, Manual, <=10 paid turns per run, settings.json backup +
   `cmp` restore; delegate to a test agent; procedure in e10bb860a handoff; record
   `live-test-p8i.md`): the Round 8o items above + the open p8h items. Fix new gaps in the BACKEND
   via a team-leader + lanes.
4. Add `0.165` to `CODEX_VERIFIED_VERSIONS` after a live lane config-key check (`gpt-6-sol` lane).
   Verify the codex-runtime trio.
5. P8 re-review of `9b5f4c86c..HEAD` (code-logic + code-style; a different model family from the
   implementers where possible), incl. D13 rows 5-8, D14, D14a, D15-D22, the team-leaders' fixes.
6. Then P9 gateways, P10 lanes + Removal B (delete `@openai/codex-sdk`; keep `@openai/codex`),
   P14 live parity (incl. GAP-3 decision), D9 history after reload, then P15 Removal A.
7. Separately (from `main`, own small PR): D22 / GAP-F frontend header.

Verify commands (background, timeout >= 90 min, under the FIFO lock):
- codex-runtime change: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`
- chat path change: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`
- auth-providers change: `npm run verify -- -p @ptah-extension/auth-providers`
- Phase gate: degradation-audit lint, di-lint, host typecheck (4 hosts, command above).

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
