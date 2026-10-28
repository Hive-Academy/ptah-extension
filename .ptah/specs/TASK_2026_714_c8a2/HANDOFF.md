# Session handoff — TASK_2026_714_c8a2 (session 22)

Written 2026-10-29. Replaces the session 21 handoff (commit b44a01244). Older handoffs:
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`. The session 20 handoff (e10bb860a) has
the full Electron live-test procedure: `git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`.

At handoff: NO subagent, team-leader, CLI lane, verify or CI watcher of THIS task is running.
Lanes of other tasks (for example TASK_2026_850) are not ours — do not touch them.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, PR #823). Main checkout = `D:\projects\ptah-extension`
(stays on `main`; its pre-existing dirty files are NOT ours).
W2 = `D:\projects\ptah-extension\.claude-worktrees\codex-cli-bump` (branch `fix/codex-cli-bump`,
PR #839, MERGED; kept until the user authorizes cleanup).

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
- Live Electron test approved in principle: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, <=10 paid
  turns per run, settings.json backup + `cmp` restore, approval mode "Manual" first. In session
  22 I asked the user for a go for p8g; NO ANSWER YET — ask again before you start it.
- Round 8m approved (done). The Codex 0.165.0 bump went in its own PR #839 (merged).
- The user ran `npm install` in the main checkout (session 22). `gpt-6.1-*` may go to lanes now,
  BUT `gpt-6.1-terra` is NOT available on the user's ChatGPT account (see below).
- Coordinator decisions (reversible, recorded): D14 (chat ask/auto-edit -> `untrusted` +
  workspace-write) for consumer 'chat' only; D14a old ask/auto-edit threads refuse resume with
  "Start a new chat"; D19 deny-with-message reason reaches Codex via `turn/steer` after decline;
  MCP elicitation form/URL UI + secret input = P14 parity gaps; gateway approval policy is
  decided in P9 by parity with Claude gateway chats.
- Session 22 Q&A (not a decision yet): the user asked why Ptah ships its own Codex binary.
  Answer given: the bundled `@openai/codex` binary is kept because the App Server protocol schema
  and binary are pinned by SHA-256; `@openai/codex-sdk` is deleted in Removal B. A possible
  follow-up is an opt-in "use my installed codex" setting with a verified version range. The
  user did not decide; do not build it unless asked.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Head `f8a632050` (pushed), CI GREEN (19 pass, 4 skipped). After this handoff one docs commit follows (this file + lane-smoke report); check its CI. |
| #839 | `fix/codex-cli-bump` / W2 | MERGED as `35203f1d8`. |
| #824, #826 | earlier fix PRs | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done in sessions 21-22

- 91b848f86: merge of main (106 commits, #827 named Claude accounts). CI green.
- Round 8m waves 1+2 (pushed earlier): 3fe884270 8m-1 G6 D14, 41c73d47c 8m-2 bounded tool
  results, d2f2fb2c5 8m-3, 38803702e 8m-4 Claude-shaped Bash, d82b252ba 8m-5 Stop/`/clear`,
  f7a6a31dd 8m-6, docs 8dd0648f1 + c7367c036.
- Round 8m wave 3 (fresh team-leader; verified; phase gate passed):
  1096bf516 8m-7 G4 Codex questions use Claude's AskUserQuestion flow; df8cfb638 8m-9 D19 deny
  reason via `turn/steer`, 330 s question backstop, narrowed `CodexApprovalOutcome`; 10581f566
  8m-8 native title + stored message count, Electron uses shared `createCodexChatMetadataPort`;
  65def9e96 8m-10 D14 for consumer 'chat' only (fixed the CI regression in
  `codex-lane-profile.spec.ts`); b44a01244 docs.
- f8a632050: merge of `origin/main` (Codex 0.165.0 bump). Pin regenerated in
  `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts`: `0.165.0`, binarySha256
  `d4b2e6a054ea1dfe53217f9d8942c5f8a9f4b76171a1e0bb76ced5759915300a`, schemaSha256
  `127cc06ba9656187dbb3e3acceda86acfa22ebf056b2abdaedbb1d1fa6ab9618` (= manifest; the
  `node_modules` codex.exe SHA-256 matches). The CI failure on b44a01244 (shard 2,
  `codex-executable-pin.spec`) was the old 0.155.1 pin vs main's 0.165.0 manifest; fixed by
  this merge. Verify of codex-runtime, cli-agent-runtime, gateway-chat-bridge, agent-sdk:
  EXIT 0 (12 tasks). One flaky `memory-curator memory-trigger.coalesce.spec` failure seen once
  (not our project; passed on rerun).
- Lane smoke test on 0.165.0: `gpt-6.1-terra` FAILED with `model_not_found` ("not supported
  when using Codex with a ChatGPT account") = ACCOUNT limit, not a binary problem. Rerun on the
  default model PASSED (codex session `01a18424-186b-73d1-9496-cbdd1d0b5b36`); report:
  `lane-smoke-0165-report.md`. Limit: the lane ran `--version` on the `node_modules` binary by
  path; that does not prove which binary the host spawned.

## Open problems and deferred items

- ASK THE USER: which `gpt-6.1-*` model (if any) the account offers in Codex. If none, record
  terra as an account limit and keep the default model for lanes.
- `CODEX_VERIFIED_VERSIONS` (`libs/backend/cli-agent-runtime/.../codex-lane-config.builder.ts:45`)
  lacks `0.165` -> non-fatal warning per lane. Add it only after a live check of the lane config
  keys on 0.165.0 (look for config rejection warnings in a lane start log).
- Comments/fixtures still say 0.155.1 (captured fixtures; left as is on purpose):
  `codex-config-rejection.ts`, `codex-lane-config.builder.spec.ts:34`, `codex-exec-args.ts`,
  `evidence-harness.ts:57,1975`, `codex-runtime.spec.ts:469`.
- Round 8m follow-ups (Minor, batches.md "Round 8m follow-ups"): evidence harness compares
  `realpathSync(manifest.binaryPath)` (CodeRabbit #839; drop it, keep platform/arch/digests);
  `CodexResumeProfileChangedError` not exported; no distinct wire code; 8m-2 schema placement /
  unbounded webSearch+fileChange / per-string cap; hard-deny text for every cancelled item; no
  pre-start plain-deny->cancel spec; make `completedTurn` required; recheck the message count in
  the live test for a turn whose reply is only a tool call; a spec for the bridge constructor
  guard; style review of the new agent-sdk barrel exports.
- P14 parity gaps: MCP elicitation form/URL UI and masked secret input (no Claude contract).
- P9 open item: gateway approval policy by parity with Claude gateway chats.
- Lanes: use codex or grok. Glm (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`) is at its
  Ollama Cloud limit; opencode at limit until 2026-11-04. Check `ptah_agent_list` first.
- Known local-only failures (Windows), green on Linux CI: auth-providers lint
  `@nx/dependency-checks`; 4 EPERM teardown failures in `translation-proxy.sdk.integration.spec.ts`;
  `chat:lint` 2 pre-existing errors; agent-sdk lint `session-query-executor.accounts.spec.ts:174,183`.
- Merge commit 91b848f86 subject starts with a UTF-8 BOM (harmless; do not rewrite history).
  Write commit messages through a bash heredoc file or `[IO.File]::WriteAllText` (no BOM).
- Older open items: header Tokens/Cost "—"; `fileChange` raw names; outputDelta streaming gap;
  recorded-stream fixtures; probe/broadcaster log wording; unknown server request with an extra
  key kills the process; separate small PRs S-N0 and LIVE D4.

## p8g live-test checklist (needs the user's go)

G6 with PLAIN prompts: a write command and a file edit show the card BEFORE the action; Allow
completes with no second prompt; Deny blocks (plain Deny = cancel/interrupt, like Claude).
Count Manual-mode prompts for plain reads vs Claude Manual. File approval before item start works.
L1: Stop during approval, then a plain follow-up AND `/compact` work on the same thread; `/clear`
starts a new thread. G1/L2: a failed command shows real output + "Command failed with exit code N".
G2: Bash card has no "Arguments"/cwd. G3: no empty thinking blocks. G4: a Codex question shows
Claude's question card. D19: "Deny with message": the model's next reply reflects the reason.
Old ask/auto-edit thread shows "Start a new chat". Sessions rail shows the real title and count
(8m-8; include a tool-call-only turn). One `ptah_*` call; one user MCP call if a reachable server
exists (ASK THE USER which); rollout secret scan. Also confirm the host spawns the 0.165.0 binary
(pin check passes at start). Procedure: session 20 handoff (`git show e10bb860a:...HANDOFF.md`).

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/: batches.md ("Round 8m" + follow-ups), decisions.md
  (P8 D1-D19, D14a), batch-8m-* reports, lane-smoke-0165-report.md.
- codex-runtime: `codex-execution-profile.ts` (D14), `codex-approval-bridge.ts` (G4/D19/
  elicitation/timeout), `codex-event-translator.ts`, `codex-runtime.ts`,
  `codex-app-server-process.ts` (pin check ~146-150), `codex-executable-pin-data.ts` (0.165.0),
  `protocol/codex-app-server-protocol.manifest.json`, `tools/evidence-harness.ts`.
- agent-sdk codex-app-server: `codex-tool-presentation.ts`, `codex-chat-events.ts`,
  `codex-chat-adapter.ts`, `codex-chat-approval-sink.ts`; `session-metadata-store.ts`,
  `wiring/codex-chat-metadata-port.ts`, `wiring/session-runtime-identity-cache.ts`.
- rpc-handlers chat: `codex-host/codex-chat-user-questions.ts`, `codex-host/codex-chat-host-ports.ts`,
  `session/chat-session.service.ts`, `session/chat-slash-command-router.service.ts`.
- cli-agent-runtime: `cli-adapters/codex/codex-lane-profile.ts` (+spec),
  `codex-lane-config.builder.ts` (`CODEX_VERIFIED_VERSIONS`).

## Next steps (in order)

1. State check: `git -C W status -sb` (clean task tree; HEAD = origin), `gh pr checks 823`
   (green on the docs commit after this handoff), `node scripts/verify.mjs --status`.
2. Ask the user (one AskUserQuestion, bundled): (a) which `gpt-6.1-*` model the account offers,
   if any; (b) go for the p8g live test; (c) which reachable user MCP server to use for the MCP
   check.
3. p8g live test (Electron only; delegate to a test agent; checklist above). Record results in
   the task folder, then fix gaps in the BACKEND translation layer via a team-leader + lanes.
4. Add `0.165` to `CODEX_VERIFIED_VERSIONS` after a live lane config-key check; verify
   `npm run verify -- -p @ptah-extension/cli-agent-runtime,@ptah-extension/codex-runtime,@ptah-extension/gateway-chat-bridge`.
5. P8 re-review of `9b5f4c86c..HEAD` (code-logic + code-style reviewers; use a different model
   family from the implementers where possible), incl. D13 rows 5-8, D14, D14a, D15-D19 and
   the team-leader's own fixes. Address findings.
6. Then P9 gateways, P10 lanes + Removal B (delete `@openai/codex-sdk`; keep `@openai/codex`),
   P14 live parity, D9 history after reload, then P15 Removal A.

Verify commands (background, timeout >= 90 min, under the FIFO lock):
- codex-runtime change: `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge`
- chat path change: `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron`
- Phase gate: degradation-audit lint, di-lint, host typecheck (4 hosts).

## Rules (repeat to every agent and lane)

Follow CLAUDE.md. Scoped `npm run verify -- -p ...` only, under the FIFO lock; never
workspace-wide, never `nx run-many`, never positional `nx test A B`, never build/serve/e2e except
the approved Electron live run. Never npm ci / npm install in a worktree. No `any`,
`as unknown as`, `@ts-ignore`, `eslint-disable`. Commit in the foreground (`.commitlintrc.json`,
subject <= 72, body lines <= 100, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`),
push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
removal. Never two committing team-leaders at once; never commit while a lane edits W. Lanes
never verify, commit, push or call ptah_get_diagnostics (say so in the first lines of the lane
task); lane deliverable paths are absolute and declared at spawn. Change a running lane only by
a resume. Relay each lane signal to its team-leader with SendMessage. Do not edit
~/.ptah/settings.json (except the approved live-test backup/restore) or ~/.codex/config.toml.
If another worktree's Ptah Dev app holds the Electron single-instance lock, ask the user; do not
kill it. Use `gh ... --jq` (no standalone jq).
