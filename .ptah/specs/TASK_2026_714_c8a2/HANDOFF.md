# Session handoff — TASK_2026_714_c8a2 (session 21)

Written 2026-10-28. Replaces the session 20 handoff (commit e10bb860a; see
`git log -- .ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`). The session 20 handoff has the full
Electron live-test procedure and the long history; read it with
`git show e10bb860a:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md` when needed.

UPDATE 2026-10-28 18:55 UTC: Round 8m wave 3 is committed locally (not pushed); see below.

At handoff: NO subagent, team-leader, CLI lane, verify or CI watcher of THIS task is running.
The user STOPPED the Round 8m team-leader. Two codex lanes of TASK_2026_850 (another session)
may run; they are not ours — do not touch them.

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, PR #823). Main checkout = `D:\projects\ptah-extension`
(stays on `main`; its pre-existing dirty files are NOT ours).
W2 = `D:\projects\ptah-extension\.claude-worktrees\codex-cli-bump` (branch `fix/codex-cli-bump`, PR #839).

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. Then DELETE
legacy path B (`@openai/codex-sdk`, CLI lanes) and path A (Claude Agent SDK + Codex translation
proxy for Codex main chat). Claude behavior unchanged. Electron first. No runtime-selector UI.
Native chat must produce EXACTLY the same UI contracts as Claude (`FlatStreamEventUnion`,
`turn_state`, `PermissionRequest`, the AskUserQuestion flow, tool input/output shapes, session
RPCs); never special-case the frontend for Codex. Fix gaps in the BACKEND translation layer
(codex-runtime -> agent-sdk codex-app-server -> rpc-handlers codex-host). No second proxy.

## User decisions (all in decisions.md; unchanged from session 20 unless marked NEW)

- PR #823 is NOT merged by us. Pre-existing defects go out as SEPARATE small PRs from `main`;
  `main` is MERGED into the branch (merge commit, no rebase, no force push).
- Native App Server features first; build only where they do not exist.
- PR #823 scope: P8, P9 gateways, P10 lanes + Removal B, P14 live parity, P15 Removal A.
  P11-P13 and the harness-sync Codex removal go to the FOLLOW-UP PR.
- D8: full parity incl. Ptah MCP + user MCP servers. NEVER strip, revert or comment out MCP.
- D9 (history after reload) is REQUIRED before Removal A (P15).
- Live Electron test approved: build-dev, `PTAH_CODEX_RUNTIME_DEV=1`, <=10 paid turns per run,
  settings.json backup + `cmp` restore, approval mode "Manual" first.
- Round 8m approved, parallelized with CLI lanes in waves.
- NEW: the user set `agentOrchestration.codexModel` to a working "sol 6" model. Do NOT pass
  `gpt-6.1-*` to lanes until `npm install` ran in the main checkout (PR #839 is merged).
- NEW: the Codex 0.165.0 bump goes in its OWN PR (#839), not in #823 (user: "do it in a new pr").
- NEW (coordinator, reversible, recorded): D14a old ask/auto-edit threads refuse resume with
  "Start a new chat"; D19 deny-with-message reason reaches Codex via `turn/steer` after decline;
  MCP elicitation form/URL UI + secret input = P14 parity gaps (no Claude contract exists);
  gateway approval policy is decided in P9 by parity with Claude gateway chats.

## PRs and branches

| PR | Branch / worktree | State |
| --- | --- | --- |
| #823 | `feat/codex-runtime-integration` / W | DRAFT, do not merge. Remote head `c7367c036`. LOCAL HEAD is 5 commits ahead (Round 8m wave 3 + docs, NOT PUSHED; the coordinator pushes). CI on c7367c036 failed 2 tests in `cli-agent-runtime` `codex-lane-profile.spec.ts` (8m-1 regression); fixed by 8m-10 `65def9e96`, green locally. |
| #839 https://github.com/Hive-Academy/ptah-extension/pull/839 | `fix/codex-cli-bump` / W2 | MERGED 2026-10-28T17:58:52Z as `35203f1d8` (head `6f901eb77`). At handoff the main checkout's `node_modules/@openai/codex-sdk` is STILL 0.155.1: the user must run `npm install` in the main checkout. Worktree W2 + branch kept until the user authorizes cleanup. One CodeRabbit Minor (harness binaryPath compare) answered: revisited in #823. |
| #824, #826 | earlier fix PRs | MERGED. Worktrees + branches kept until the user authorizes cleanup. |

## Done this session (session 21)

1. CI did not run on #823 since 74c290c28 because the PR had MERGE CONFLICTS with main (GitHub
   cannot build the `pull_request` merge ref). Fixed by merge commit `91b848f86` (106 main commits,
   #827 named Claude accounts; 5 conflicts resolved; named-account selection only for claude-sdk
   sessions, starts/resumes inside `withinNamedAdmissionDeadline`). CI on 91b848f86: all green.
2. Round 8m waves 1 + 2 committed and pushed (head `c7367c036`):

| Commit | Batch |
| --- | --- |
| 3fe884270 | 8m-1 G6: chat ask/auto-edit -> `untrusted` + workspace-write (cwd only, no network); coded `resume-profile-changed` refusal; contract spec (codex + 3 Glm fix rounds in the dev evidence harness) |
| 41c73d47c | 8m-2 G1/G3 core: real bounded tool results (10 000 chars per string), reasoning deltas |
| d2f2fb2c5 | 8m-3 G5/L3: no AUTO_RESOLVED after a user answer, `allowedDecisions` not sent, MCP attach logs |
| 8dd0648f1 | docs: wave 1 |
| 38803702e | 8m-4 G2/G1/G3/L2: Bash input = Claude `{command, description?}`, Claude-shaped tool_result, thinking replace-on-final |
| d82b252ba | 8m-5 L1: Stop interrupts the turn and keeps the session; native `/clear` awaits close; "Start a new chat" message |
| f7a6a31dd | 8m-6 G5: `allowedDecisions` removed from shared/chat-streaming/chat |
| c7367c036 | docs: wave 2, D19, 8m-9, follow-up list |

3. Codex 0.165.0 bump PR #839 (W2): `@openai/codex-sdk ^0.165.0` (root + 4 manifests),
   `@openai/codex 0.165.0` (auth-providers), lock file via `--package-lock-only`, windows-hide
   patch 0.165.0, codex-runtime protocol manifest + schema regenerated from the official 0.165.0
   binary (binarySha256 `d4b2e6a0…300a`), 3 new notifications pinned. Reason: lanes AND the App
   Server runtime run the BUNDLED binary (0.155.1, pinned by SHA-256), not the user's global
   codex 0.165.0, so `gpt-6.1-*` failed with model_not_found.

## Round 8m wave 3: COMMITTED in W (not pushed), verified, phase gate passed

Fresh team-leader, 2026-10-28 18:15-18:55 UTC. Commits (in order):

| SHA | Batch |
| --- | --- |
| 1096bf516 | 8m-7 G4: Codex questions use Claude's AskUserQuestion flow (Electron `requestUserInput`) |
| df8cfb638 | 8m-9 D19 + extras: deny reason via `turn/steer`; typed outcome (edit marker XOR denialReason); 330 s question backstop; elicitation decline rules |
| 10581f566 | 8m-8 L2b: native title end-to-end + stored message count (+2 per completed turn); Electron uses the shared metadata port |
| 65def9e96 | 8m-10: D14 for consumer 'chat' only; lanes/gateway/usage back to the pre-8m-1 mapping |
| (docs) | batches.md, HANDOFF.md, batch-8m-7..10 reports |

Verify (scoped, under the lock, all EXIT 0 on the final tree):
- `npm run verify -- -p @ptah-extension/codex-runtime,@ptah-extension/cli-agent-runtime,@ptah-extension/gateway-chat-bridge` (9 tasks; 948 / 2705 / 133 tests)
- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron` (3 projects + 6 deps)
- Phase gate: degradation-audit lint, di-lint, host typecheck (4 hosts), vscode-core host-attention-ingress test: all EXIT 0.

Team-leader fixes found by review/verify (before commit): 8m-7 SDK `CanUseTool` needs `requestId` and
returns `PermissionResult | null`; specs imported agent-sdk by relative path (module boundaries) ->
agent-sdk exports AskUserQuestionService, PendingResponseRegistry, ASK_USER_QUESTION_IDLE_TIMEOUT_MS.
8m-9 spec mock typing; older MCP-grant spec moved to the decline-without-card contract;
`CodexApprovalOutcome` narrowed to a union. 8m-8: Electron production had its own inline metadata
port that dropped the title and had no count (fixed: shared `createCodexChatMetadataPort`); a
rejected count write blocked the turn result (now logged `message-count-write-failed`);
register.codex-runtime.spec.ts asserts the title. New Minor follow-ups are in batches.md.

Lane ids: 8m-8 codex agent d71a34ef, CLI session `01a183bc-d92d-7b91-8f8e-21d83930d999` (fresh lane,
the 01a18380 resume fell back to a handoff brief); 8m-10 grok agent 2b38c10e, CLI session
`01a183bd-0cc2-7711-8425-c230e3efcfc0`. No lane of this task runs.

## Open problems and deferred items

- Round 8m follow-ups (Minor, list in batches.md "Round 8m follow-ups"): evidence harness compares
  `realpathSync(manifest.binaryPath)` (CodeRabbit #839; drop it, keep platform/arch/digests);
  `CodexResumeProfileChangedError` not exported (name/code check); no distinct wire code;
  8m-2 schema placement / unbounded webSearch+fileChange / per-string cap; hard-deny text for
  every cancelled item (Claude shows "Permission denied by user…" for deny_with_message);
  no pre-start plain-deny->cancel spec.
- P14 parity gaps: MCP elicitation form/URL UI and masked secret input (no Claude contract).
- P9 open item: gateway approval policy (D14 or settled) by parity with Claude gateway chats.
- `CODEX_VERIFIED_VERSIONS` (`codex-lane-config.builder.ts:45`) lacks `0.165` -> non-fatal warning
  per lane after the bump; add it after a live check of the lane config keys on 0.165.
- After #839 merges: user runs `npm install` in the main checkout; then merge main into #823 and
  REGENERATE the #823 pin (`codex-runtime/src/lib/codex-executable-pin-data.ts` is 0.155.1 on
  #823, plus the manifest/schema conflicts) and run a live lane smoke test on `gpt-6.1-terra`.
- Glm (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`) is AT its Ollama Cloud session usage
  limit (reset unknown). Use codex or grok. opencode AT LIMIT until 2026-11-04.
- Known local-only failures (Windows), green on Linux CI: auth-providers lint
  `@nx/dependency-checks` (persistence-sqlite) and 4 EPERM teardown failures in
  `translation-proxy.sdk.integration.spec.ts`; `chat:lint` 2 pre-existing errors
  (no-control-regex, no-useless-escape); agent-sdk lint `session-query-executor.accounts.spec.ts:174,183`.
- Merge commit 91b848f86 subject starts with a UTF-8 BOM (harmless; do not rewrite history).
  On PowerShell 5.1 write commit messages with `[IO.File]::WriteAllText($p, $msg)` (no BOM).
- Older items from session 20 still open: header Tokens/Cost "—"; `fileChange` raw names;
  outputDelta streaming gap; recorded-stream fixtures; probe/broadcaster log wording; unknown
  server request with an extra key kills the process; separate small PRs S-N0 and LIVE D4.

## p8g live-test checklist (after 8m is committed and pushed)

G6 with PLAIN prompts: a write command and a file edit show the card BEFORE the action; Allow
completes with no second prompt; Deny blocks (plain Deny = cancel/interrupt, like Claude).
Count Manual-mode prompts for plain reads vs Claude Manual. File approval before item start works.
L1: Stop during approval, then a plain follow-up AND `/compact` work on the same thread; `/clear`
starts a new thread. G1/L2: a failed command shows real output + "Command failed with exit code N".
G2: Bash card has no "Arguments"/cwd. G3: no empty thinking blocks. G4: a Codex question shows
Claude's question card. D19: "Deny with message": the model's next reply reflects the reason.
Old ask/auto-edit thread shows "Start a new chat". Sessions rail shows the real title (8m-8).
One `ptah_*` call; one user MCP call if a reachable server exists (ASK THE USER which);
rollout secret scan. Procedure: session 20 handoff (`git show e10bb860a:...HANDOFF.md`).

## Key files

- W/.ptah/specs/TASK_2026_714_c8a2/: batches.md ("Round 8m" with wave 3 + follow-ups),
  decisions.md (P8 D1-D19, D14a), batch-8m-1..9 reports, batch-8m-1-fix-report.md.
- codex-runtime: `codex-execution-profile.ts` (D14, 8m-10), `codex-approval-bridge.ts` (G4/D19/
  elicitation/timeout), `codex-event-translator.ts`, `codex-runtime.ts`, `tools/evidence-harness.ts`,
  `tools/evidence-cases-round.ts`, `codex-executable-pin-data.ts` (0.155.1 pin on #823).
- agent-sdk codex-app-server: `codex-tool-presentation.ts`, `codex-chat-events.ts`,
  `codex-chat-adapter.ts` (closeSession), `codex-chat-approval-sink.ts`; `session-metadata-store.ts`,
  `wiring/codex-chat-metadata-port.ts`, `wiring/session-runtime-identity-cache.ts` (8m-8 gap).
- rpc-handlers chat: `codex-host/codex-chat-user-questions.ts` (G4), `codex-host/codex-chat-host-ports.ts`,
  `session/chat-session.service.ts`, `session/chat-slash-command-router.service.ts` (/clear).
- cli-agent-runtime: `cli-adapters/codex/codex-lane-profile.ts` (+spec) (8m-10),
  `codex-lane-config.builder.ts` (`CODEX_VERIFIED_VERSIONS`).

## Next steps (in order)

1. `git -C W status -sb` (expect a clean task tree, HEAD 5 commits ahead of origin c7367c036 until pushed),
   `node scripts/verify.mjs --status`, `gh pr view 839 --json state` (merged?).
2. Ask the user only if unclear; the user stopped the team-leader, so CONFIRM they want Round 8m
   to continue before spawning work.
3. DONE (fresh team-leader): Round 8m wave 3 reviewed, verified and committed (see the wave 3
   section above). No phase code review by a second family yet: covered by step 8.
4. DONE: phase gate passed on 65def9e96 (degradation-audit, di-lint, host typecheck, vscode-core
   host-attention-ingress).
5. Push W in the background (no lane may edit W during the push; pre-push builds from W). Check
   `gh api repos/Hive-Academy/ptah-extension/actions/runs?head_sha=<sha>` > 0, then watch
   `gh pr checks 823` (use `gh ... --jq`, there is no standalone jq). Known flakes:
   `state.spec.ts:41`, `config-change-permission-survival.spec.ts:204` (rerun once).
6. #839 IS MERGED (35203f1d8). Once the user confirms `npm install` ran in the main checkout
   (check `node_modules/@openai/codex-sdk/package.json` = 0.165.0): merge `origin/main` into W
   (merge commit; expect conflicts in the codex-runtime protocol manifest/schema and the evidence
   harness/specs), regenerate the #823 pin data (`codex-executable-pin-data.ts`) for 0.165.0,
   verify codex-runtime + cli-agent-runtime + agent-sdk, push. Then a live lane smoke test on
   `gpt-6.1-terra`; then consider adding `0.165` to `CODEX_VERIFIED_VERSIONS`. Do this merge
   AFTER Round 8m is committed (never merge while a lane edits W).
7. Live test p8g (checklist above; delegated to a test agent; Electron only).
8. P8 re-review (Claude code-logic + code-style reviewers) of `9b5f4c86c..HEAD` incl. D13 rows 5-8,
   D14, D14a, D15-D19; then P9, P10 + Removal B, P14, D9 before P15 Removal A.

## Rules (repeat to every agent and lane)

Follow CLAUDE.md. Scoped `npm run verify -- -p ...` only, under the FIFO lock; never
workspace-wide, never `nx run-many`, never positional `nx test A B`, never build/serve/e2e except
the approved Electron live run. Never npm ci / npm install in a worktree. No `any`,
`as unknown as`, `@ts-ignore`, `eslint-disable`. Commit in the foreground (`.commitlintrc.json`,
subject <= 72, body lines <= 100, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`),
push in the background. No PR merge, force push, history rewrite, branch deletion or worktree
removal. Never two committing team-leaders at once; never commit while a lane edits W. Change a
running lane only by a resume. Do not edit ~/.ptah/settings.json (except the approved live-test
backup/restore) or ~/.codex/config.toml. If another worktree's Ptah Dev app holds the Electron
single-instance lock, ask the user; do not kill it.
