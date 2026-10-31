# Session handoff — TASK_2026_714_c8a2 (session 35)

Written 2026-10-31. Replaces the session 34 handoff (read it with
`git show 805991a08:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`; its Goal, Rules and history stay valid).
Older handoffs: session 33 `ce6d949f4`, session 32 `180c7ef68`, session 24 `44e3b1102` (full goal, PR table),
Electron live-test procedure `e10bb860a` (all `git show <sha>:.ptah/specs/TASK_2026_714_c8a2/HANDOFF.md`).

W = `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`
(branch `feat/codex-runtime-integration`, DRAFT PR #823
https://github.com/Hive-Academy/ptah-extension/pull/823, do not merge).
T = `W\.ptah\specs\TASK_2026_714_c8a2\`. Work ONLY in W; the main checkout `D:\projects\ptah-extension`
stays clean on `main`.

## Goal (short)

One Codex App Server runtime (`@ptah-extension/codex-runtime`) for Ptah main chat, gateways and CLI lanes;
then Removal B (P10, `@openai/codex-sdk` lanes: 10e/10f) and Removal A (P15). Electron first. Native UI contracts
identical to Claude's; gaps fixed only in the backend translation layer; no frontend Codex special case; no
second proxy; NEVER strip/revert/comment out MCP.

Routing (standing, user): codex (model `gpt-6-sol`, never `gpt-6.1-terra`) implements. Codex code is reviewed by a
different family. The coordinator's own code is reviewed by a codex lane. The coordinator runs verify, commit, push.

**Routing facts from session 35:** the `claude` CLI lane is DISABLED in Ptah Settings > Providers > CLI Agents
(`ptah_agent_spawn` refuses it). The user approved a codex-family reviewer ONCE (10d.C/V re-review). After that,
codex code was reviewed by the in-process `code-logic-reviewer` subagent (Agent tool, claude family) — a different
family, no user question needed. Lane limits at end of session 35: codex weekly ~55% at session start (reader
reported "unknown (reader failed)" once later; resets 2026-11-04 07:03 UTC); Glm, grok AT LIMIT; opencode monthly
100% (resets 2026-11-04); Kimi unknown, do not use. Codex "resumes" above ~60k tokens become fresh lanes: always
give self-contained task files in T. Pass the CLI Session ID (not the agent id) as `resume_session_id`.

## Done in session 35 (all pushed)

| Commit | Subject | CI |
| --- | --- | --- |
| 805991a08 | feat(cli,vscode,cli-engine,codex-runtime): wire native Codex lanes (10d.C + 10d.V + shared `inspectCodexExecutable` + D28 row) | green |
| 3b3255224 | Merge origin/main (b07954bc9) + host-routing admission for a resumed native Codex follow-up | green, MERGEABLE |
| 168678765 | fix(cli-agent-runtime): start native Codex lanes on the default account (10d.P specs + unsigned proof + 10d.P-C1) | green (CI, CLI/Webview/Electron E2E success, MCP Bench skipped); MERGEABLE, BLOCKED = draft |

- 10d.C/V: shared `inspectCodexExecutable` (codex-runtime, cached by realpath/size/mtime, streamed SHA-256, coded
  errors, bounded cache of 8, separate default/readVersion caches). Both hosts measure in probe and `open()`.
  Reviews T\code-logic-review-10d-CV.md (7/10), -r1.md, -r2.md (8/10 APPROVED, codex reviewer, user-approved),
  -coordinator-fix.md (9/10). Verify: typecheck,lint 14/14; tests 47 tasks green after fixes.
- Merge b07954bc9: conflicts in electron phase-2-libraries.ts, container.smoke.spec.ts, rpc-handlers
  chat-session.service.ts (constructor order: ..., activeProvider, runtimeProfile, sessionRuntimeRouter, hostRouting,
  sessionIdResolvedEvents; main's chat-session.host-routing.spec.ts got two more positional `undefined`); duplicate
  SDK_TOKENS import removed in electron expected-resolvable.ts. Reviews -merge-b07954bc9.md (REVISE 6/10, found the
  missing admission), -r1.md (APPROVED 8/10).
- 10d.P: T\p10-lane-parity-proof.md (UNSIGNED), specs `libs/backend/cli-agent-runtime/src/lib/cli-agents/
  codex-lane-parity.spec.ts` and `codex-lane-activation.spec.ts`. The manager-level activation case found a real
  launch blocker (native adapter refused every default-account run, because the manager always passes
  `onAccountBinding`); fixed by 10d.P-C1 in `codex-app-server-lane.adapter.ts:318-325` (Claude rule: no binding
  fields = default account; full binding needs the callback; partial or callback-less binding refused, context closed
  once). Reviews T\code-logic-review-10d-P.md (6.5), -r2.md (8, REVISE), -r3.md (9, APPROVED; minor N5 fixed, N6 open).
  Whole cli-agent-runtime target passes on Windows.
- Windows-only local failures (ignore; Linux CI passes): rpc-handlers lineage path-separator / symlink EPERM specs
  (chat-session-agent-child, -policy-roots, -resume-activate, -session-folder, session-folder, plugin-rpc.handlers.
  session-notice — 17 tests) and agent-sdk plugin-loader capabilities + session-notice symlink EPERM (2 tests).

## In progress / uncommitted

- T\live-test-p10dP.md — the user-authorized Electron-only live run (9 of 10 paid turns; settings.json restored,
  `cmp` exit 0; evidence `C:\Users\abdal\AppData\Local\Temp\ptah-live-p10dP-20261031-203424\` with app.log,
  screenshots, per-turn JSON). Committed together with this HANDOFF (see Next steps 0).

## Open problems (live run 10d.P, Electron) — the proof must NOT be signed yet

Blockers (each needs a corrective codex batch, file-disjoint, then verify + different-family review):
1. **Resume after a completed lane fails.** After a lane ends, its `codex.exe app-server` stays alive and holds the
   thread writer; a `resume_session_id` spawn fails with "thread-store conflict ... already has an active writer" /
   "Codex context could not be opened". The lane resume gate admits it first. Resume after `ptah_agent_stop` works.
   Look at lane context/process disposal on terminal status in the native adapter / host runtime provider
   (`codex-app-server-lane.adapter.ts`, the three host lane compositions' `ownedContext`/dispose).
2. **`ptah_agent_report` rejected in every lane turn:** "MCP tool call requires approval, but approval policy is
   never". Lanes run `approval_policy never` (D26 auto-decline). The lane profile must pre-approve the Ptah MCP
   server tools in the backend translation (codex-lane-profile / codex-execution-profile; check how the App Server
   config expresses per-server tool approval). NEVER strip MCP. Also: the stored error text is the string "null".
3. **`<agent-lane-completed>` never reaches the chat:** every lane end logs "parent-session-not-active"; the parent
   is recorded as the TAB id `3cd27680-...` instead of the Codex session id (main chat on Codex). Check how the
   parent session id is captured at spawn for a native Codex main chat (lane-completion-notifier / agent spawn path).
Gaps (record in the proof; fix if cheap): no reasoning segments in lane output; outcome table token columns empty;
observation 5 (approval decline line) not observable with `approval_policy never` (curl was blocked by the sandbox);
a "needs you" banner stayed after both approvals were answered; a conhost child per codex process (console window
not proven); the hash value and CODEX_HOME are not logged. Minor: N6 (C1 refusals throw a generic Error), C-3
(adapter logs only errorClass on detection failure), the main agent first passed a role in a workspace without roles.

## Key files

- T\p10-lane-parity-proof.md — unsigned proof; 21 PENDING-LIVE rows; update with live results.
- T\live-test-p10dP.md — live run observations 1-9 with evidence.
- T\plan-p10.md (10d.P at :105-109, 10e/10f after), T\plan-p10-review.md (R1-R4), T\decisions.md (D26-D28).
- libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex/codex-app-server-lane.adapter.ts — native lane.
- libs/backend/codex-runtime/src/lib/codex-executable-inspection.ts — shared executable check.
- apps/ptah-electron/src/di/codex-lane-composition.ts, libs/backend/cli-engine/src/lib/codex-lane-runtime-composition.ts,
  apps/ptah-extension-vscode/src/di/codex-lane-runtime-composition.ts — host lane wiring.

## Background work

- None. No lane, subagent, child session or verify runs. A local CI watcher shell (bxcmjd7ye) belonged to this
  session and ends with it; re-check CI with gh.

## Next steps (in order)

0. Confirm CI on 168678765 (and on the handoff docs commit):
   `gh run list --branch feat/codex-runtime-integration --limit 8 --json headSha,status,conclusion,name --jq '.[] | "\(.headSha[0:9]) \(.name) \(.status) \(.conclusion)"'`
   and `gh pr view 823 --json headRefOid,mergeable,mergeStateStatus --jq '"\(.headRefOid[0:9]) \(.mergeable) \(.mergeStateStatus)"'`.
   Re-merge origin/main if CONFLICTING.
1. Write three self-contained codex task files in T (hard rules first; absolute deliverables; no line-ending
   conversion) for blockers 1-3 above; run them file-disjoint (max 3 lanes), revise cap 2 each.
2. Verify, two stages, background, timeout >= 90 min, read rc and "N tasks:":
   `npm run verify -- -t typecheck,lint -p cli-agent-runtime,codex-runtime,agent-sdk,rpc-handlers,ptah-electron,ptah-cli,ptah-extension-vscode,degradation-audit,di-lint`
   then `npm run verify -- -t test -p <same list>`. Do not pass Jest flags to the lint target.
3. Review each batch with the in-process `code-logic-reviewer` subagent (claude family) — or a `claude` CLI lane if the
   user re-enables it. Commit (foreground, explicit paths, message file, trailer), push (background), watch CI.
4. Ask the user before a second Electron live run (paid; procedure in `e10bb860a` HANDOFF + T\live-test-p10dP.md).
   Then update and present the proof for signing. CLI/TUI/VS Code rows stay PENDING-LIVE unless the user authorizes.
5. Only after a signed 10d.P proof: 10e, 10f (Removal B) per plan-p10.md. Then P14 (incl. GAP-3), D9, P15.

## Rules (repeat to every lane)

CLAUDE.md applies. Scoped `npm run verify -- -p ...` only, under the FIFO lock, in the background, timeout
>= 90 min; read rc and the "N tasks:" line; failed task logs are in
`C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\<id>` (the verify log prints "full log:" paths).
Spec files compile only in the test target: typecheck,lint first, tests second. Include `degradation-audit` (and
`di-lint` for DI changes). Never build/serve/e2e except an approved Electron live run. Never npm ci/install in a
worktree. No `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`; bracket `process.env['X']`; swallowing
catches need `// degradation-audit: optional-capability|reported - <reason>`. Specs must pass on Windows and Linux.
Lanes never verify, commit, push or call ptah_get_diagnostics; say so in the first lines of each lane task;
deliverable paths absolute; tell lanes not to convert line endings. Never commit, push or merge while a lane edits W
or a verify runs; never edit W while a verify runs (it invalidates the result). Commit in the foreground
(commitlint scopes from .commitlintrc.json, subject <= 72, body lines <= 100, no BOM, message via file +
`git commit -F`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); push in the background. Strip
BOMs only from files lanes wrote. No PR merge, force push, history rewrite, branch deletion or worktree removal
(merging main INTO the branch is allowed). Do not edit ~/.codex/config.toml; ~/.ptah/settings.json only via the
approved live-test backup/restore with `cmp`. NEVER strip MCP. jq is not installed: use `gh --jq`. A live or paid
run needs explicit user authorization.
