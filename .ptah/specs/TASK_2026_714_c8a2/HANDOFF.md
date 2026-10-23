# Session handoff — TASK_2026_714_c8a2 (session 3)

Written 2026-10-23 at the user's request (session at 25.9M tokens). Replaces the session 2 handoff.
No lane, subagent or background command is running. The CI watcher command ended with the session.

## Goal

One Codex runtime for Ptah: the Codex App Server, shared by main chat, the messaging gateways and
CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. The two current
paths (main chat = Claude Agent SDK + Codex translation proxy; lanes = `@openai/codex-sdk`) are
migration sources, retired only after proven parity and separate user confirmation (Removal A:
proxy, Removal B: codex-sdk lanes). Claude behavior stays unchanged. Electron first. No
runtime-selector UI. A visible refusal is not parity. Production stays disabled until the evidence
spike proves the required observations (`implementation-plan.md:262-270`).

## Done (all pushed unless stated)

- Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`, branch
  `feat/codex-sdk-main-chat`, draft PR https://github.com/Hive-Academy/ptah-extension/pull/809.
  Remote head `3ec2bb479`.
- `5fc9e7d01` batch 1b: envelopes accept `emittedAtMs` (still `.strict()`), sanitized failure
  reasons in case notes, `errorCode()` accepts string codes only. Grok review APPROVED 8/10
  (`code-logic-review-batch-1b.md`).
- `f9e3f6def` approval policy `untrusted` -> `on-request` (0.155.1 refuses `untrusted` at startup).
- `9756958be` OUTPUT_BOUNDS (user-approved substitute spend bounds): `model_reasoning_effort="low"`,
  `model_verbosity="low"`, `tool_output_token_limit=2000`; config/read must echo all three.
- `c7e3036ce` `native-route-evidence.md` (runs 1-5, observation table, gap table, reductions).
- `847533975` merge of origin/main (Nx 24.0.0 + Angular 22.2). `3ec2bb479` codex-runtime moved to
  inferred `@nx/jest` / `@nx/eslint` targets (`nx.json` include lists), reasoned
  `eslint-disable no-unsafe-finally` for the secret-cleanup throw. test 38/38, typecheck, lint pass
  (2 warnings).
- GLM review of the orchestrator edits (`f9e3f6def`, `9756958be`, `3ec2bb479`): APPROVED 8/10, two
  Minor (`code-logic-review-orchestrator-edits.md`). Not committed yet (see below).
- Spike: runs 1-5 used **1 of 8 turns**. Run 5 got a real `item/commandExecution/requestApproval`
  and the harness declined it as "Unexpected command" (shape not recorded). No
  `%TEMP%\ptah-codex-evidence-*` leftover after any run. Model `gpt-6-luna`.
- Research (`codex-version-contract-report.md`): codex 0.163.0 has the same approval contracts as
  0.155.1; neither has `modifiedInput` or a per-turn output cap; both refuse `untrusted`. Stay on
  the 0.155.1 pin. Closest edited-input stand-in: decline + `turn/steer` with the edited command.
- Local only, NOT pushed: the docs commit with this HANDOFF.md, `decisions.md`, `batch-1c-report.md`,
  `codex-version-contract-report.md` and `code-logic-review-orchestrator-edits.md` (push with the
  next Batch 1c commit).
- CI on `3ec2bb479`: finished, all jobs pass or skipped (0 failed). No code review (CodeRabbit
  skips drafts).

## User decisions this session (in `decisions.md`)

1. Substitute spend bounds (above) instead of the missing output cap.
2. Edited-input approval: keep Codex rollout blocked on this row; investigate and prove a native
   alternative first.
3. Ptah "ask" level: test the granular approval policy first; adopt only if it proves
   ask-before-effect, else back to the user.
4. User allowed Claude subagents, Codex and GLM lanes (session 3 message "utilize your subagents
   along with codex u can also use glm").

## In progress — Batch 1c (UNCOMMITTED code in the worktree)

Codex lane `b7783ef6` (finished, exit 0, after it also processed two queued orchestrator messages;
a separate resume `b316822f` failed at start and changed nothing) changed
`libs/backend/codex-runtime/tools/`: `evidence-harness.ts` (921 lines; HEAD had 867),
`evidence-harness.spec.ts` (428), `evidence-cases.json`, NEW `evidence-failure-notes.ts` (114),
NEW `evidence-frames.ts` (45). Report: `batch-1c-report.md` (read it in full).
Content: sanitized "Unexpected command shape" notes with
`<ROOT>/<HOME>/<SCRATCH>/<WORKSPACE>/<NODE>/<MARKER_SCRIPT>` placeholders, wrapper/quoting
classification, granular all-true policy for `ask` with `approvalsReviewer: "user"` on
thread/start + turn/start (lane says the schema allows it), note
`granular ask: no approval request observed` (`evidence-harness.ts:791`), structural config
compare, frames/envelopes moved to `evidence-frames.ts`, failure notes to
`evidence-failure-notes.ts`. **NOT checked, NOT reviewed, NOT committed.**

Open items in that diff:
1. Harness is 921 lines, over the 700 `max-lines` limit (a lint WARNING, not an error). The lane
   stopped as told. 25 lines are > 160 chars (15 at HEAD): check that no unchanged code was packed
   (`git diff` the harness); restore original formatting where it was. Decide: accept the warning
   (it existed before: 827) or extract one more cohesive module (for example the run-case logic).
2. CLOSED (orchestrator checked the pinned schema): `ThreadStartParams` and `TurnStartParams` have
   `approvalsReviewer` -> `ApprovalsReviewer`; its description says the default is `user`, and
   `auto_review` / `guardian_subagent` route to a subagent. Sending `"user"` is explicit, not new.
3. "True = ask" for the granular fields is an inference; the schema has no descriptions. Run 6
   proves it.

## Open problems

- Granular semantics unproved; `approvalsReviewer` effect unproved (config/read does not echo it).
- Ask-level parity: `on-request` lets sandbox-allowed commands run without a prompt.
- Edited input: decline + `turn/steer` needs a real-model proof (not in the current 8 cases).
- Turn budget: 7 of 8 turns remain; the cases need 8, so the last case (`compaction`) will not run
  in run 6. More turns need a new user approval.
- Observed usage is not enforced mid-turn (accepted residual, GLM Minor F1).
- GLM Minor F2 (pre-existing): cleanup status can claim success when `createExperiment` throws
  before register.
- Version drift: global codex 0.163.0, bundled 0.155.1; core must check the manifest pin against
  the binary resolved at runtime.

## Peer coordination

- TASK_2026_712 (PR #808, not merged; head `c6e39a3ce`) owns until merged: agent-sdk
  `sdk-agent-adapter.ts`, `session-query-executor.service.ts`, `sdk-query-options-builder.ts`,
  `sdk-query-runner.service.ts`, `session-registry.service.ts`, `session-metadata-store.ts`,
  `session-quota-probe.service.ts`, `sdk-model-service.ts`, agent-sdk `di/register.ts`;
  rpc-handlers `chat-session.service.ts`, `chat-slash-command-router.service.ts`,
  `session-rpc.handlers.ts`. Our later batches modify several of these: rebase on #808 first.
  Migration 0059 is theirs; any 714 migration is 0060 or later.
- tsyringe note from 712 (for our DI registrations): `register(token, { useValue: null })` makes
  `resolve()` throw "TypeInfo not known", even for optional injections. Use
  `{ useFactory: () => null }` for a held/null default.
- Heavy-check slot: claim by message, wait for "released", release after. Use ListAgents for
  current addresses. This session does not hold the slot.
- Shared `node_modules`: the worktree has none of its own; Node resolves
  `D:/projects/ptah-extension/node_modules` (Nx 24). Never run `npm ci`/`npm install` here.

## Key files

Task folder `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/`:
`decisions.md`, `implementation-plan.md` (spike `:255-284`, gap table `:307-333`, team-leader
handoff `:336+`, removals `:411+`), `native-route-evidence.md`, `codex-version-contract-report.md`,
`batch-1b-report.md`, `batch-1c-report.md`, `code-logic-review-batch-1b.md`,
`code-logic-review-orchestrator-edits.md`, `spike-run.md` … `spike-run-5.md` (+ `.json`).
Code: `libs/backend/codex-runtime/tools/` (harness, spec, cases, failure notes),
`libs/backend/codex-runtime/src/lib/protocol/` (pinned schema + manifest).
Bundled binary: `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` (0.155.1).

## Next steps

1. Read this file, `decisions.md` (last 25 rows), `batch-1c-report.md` and
   `codex-version-contract-report.md` section 5.
2. Examine the uncommitted Batch 1c diff (`git diff -- libs/backend/codex-runtime/tools/` plus
   the two new files). Settle open item 1 above; give any fix to a fresh Codex lane
   (`backend-developer`, workingDirectory = worktree, the five tools files only, at most 20 tool
   calls, no checks, no git). Run `ptah_agent_list` first.
3. Different-family review of the full Batch 1c diff (Codex wrote it): a Claude
   `code-logic-reviewer` subagent, deliverable `code-logic-review-batch-1c.md`. One fix round.
4. Claim the heavy-check slot, then:
   `npx nx run-many -t test typecheck lint -p codex-runtime --parallel=1 --output-style=static`
   (expect harness <= 700 lines, no lint errors).
5. Commit in the foreground (scope `codex-runtime`), push in the background, release the slot.
6. Dry run, then real run 6 (7 turns remain; record the per-run usage):
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --dry-run`
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --run --binary 'D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe' --auth-source "$USERPROFILE/.codex/auth.json" --model gpt-6-luna --out 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/spike-run-6.md'`
   After the run: `ls -d "$TEMP"/ptah-codex-evidence-*` must list nothing.
7. Update `native-route-evidence.md`; bring granular / ask-level and edited-input results to the
   user. If a gate needs more than the remaining turns, ask the user for a new budget.
8. Watch PR #809 CI (`gh pr checks 809`) after each push; read failed job logs.
9. Then team-leader decomposition of the core batch, respecting the 712 claims.

Rules: CLAUDE.md (memory-safe scoped checks, one heavy check at a time, commit in the foreground,
push in the background, never commit to main, never `npm ci` in this worktree). The temporary
"CLI lanes first" rule expires 2026-10-24; the user also allowed Claude subagents and GLM.
