# Session handoff — TASK_2026_714_c8a2 (session 2)

Written 2026-10-22 at the user's request (session at 24.4M tokens). This file replaces the earlier
HANDOFF.md from session 1. No lane, subagent or background command is running.

## Goal

One Codex runtime for Ptah: the Codex App Server. It is shared by main chat, the messaging gateways
and CLI lanes through ONE core lib (`@ptah-extension/codex-runtime`) and thin adapters. The user
said: "I don't want to end up having 3 ways for Codex." The two current paths are migration
sources that are retired after proven parity:

1. Main chat = Claude Agent SDK + Codex translation proxy (`auth-providers/.../codex/codex-translation-proxy.ts`).
2. Lanes = `@openai/codex-sdk` in `cli-agent-runtime/.../codex-cli.adapter.ts`.

Claude behavior stays unchanged. Electron first; VS Code and CLI keep compiling. No runtime-selector
UI. A visible refusal is not parity. Each removal (A: proxy, B: codex-sdk lanes) needs separate user
confirmation with a caller audit. Follow-up task (not this one): measure the Claude harness tools that
Codex lacks and offer them as Ptah-native, provider-neutral tools.

## Done

- Worktree `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat`, branch
  `feat/codex-sdk-main-chat`, based on main `0d5be6dae`.
- Draft PR https://github.com/Hive-Academy/ptah-extension/pull/809.
- Commit `0c910f80c` docs(task-specs): planning set — pushed.
- Commit `f9e7fbfc6` feat(codex-runtime): evidence tooling + `codex-runtime` commitlint scope —
  **local only, NOT pushed**.
- Task documents after `0c910f80c` (this file, reports, reviews, spike results) — committed in the
  docs commit that follows this file; also **not pushed**.
- Gate 2: plan approved. Codex audit (`plan-alignment-audit.md`) → Codex final revision → Grok
  re-review → user-approved bounded fix → Grok scoped re-check APPROVED → user APPROVED.
- User decisions (see `decisions.md`): gateways move to App Server in this task (third thin consumer);
  the spike may make a bounded real model call (8 turns total, temp CODEX_HOME with a COPY of
  auth.json only, marker files only, no network MCP).
- Batch 1a (evidence tooling): implemented by Codex, safety review by Grok (REVISE → one fix round →
  APPROVED 7/10). Orchestrator made one bounded correction: realm-safe `errorCode()` instead of
  `instanceof Error` (fs errors fail `instanceof` in the Jest VM). Jest 28/28 pass (file-symlink case
  skipped on Windows), `nx typecheck codex-runtime` passes.
- Protocol export from bundled `codex.exe` 0.155.1 written:
  `libs/backend/codex-runtime/src/lib/protocol/codex-app-server-protocol.{schema,manifest}.json`
  (102 requests, 10 server requests, 82 notifications; decision literals include `accept`,
  `acceptForSession`, `decline`, `deny`).
- Real spike run 1: **fail-closed after `initialize`, 0/8 turns used, no model call, auth copy and
  experiment deleted** (`spike-run.md`, `spike-run.json`).

## In progress / open problems

1. **Spike blocker (fix first).** Most likely cause: the Zod envelopes in
   `libs/backend/codex-runtime/tools/evidence-harness.ts:20-25` are `.strict()`. Right after
   `initialize`, codex 0.155.1 sends `remoteControl/status/changed` with a top-level `emittedAtMs`
   key, so the strict notification schema rejects it. `jsonrpc` is absent in responses (already
   optional). Evidence: a manual initialize probe with an empty temp CODEX_HOME (no auth):
   `{"id":1,"result":{...}}` then
   `{"method":"remoteControl/status/changed","params":{...},"emittedAtMs":...}`.
   Fix: allow known extra top-level keys (`emittedAtMs`) or use `.passthrough()` on the envelope
   while still validating `id`/`method`/`params`; and make the harness record the sanitized failure
   reason in `notes` (run 1 had empty notes). Add a spec case with this exact frame.
2. **Code review still owed** for the orchestrator's `errorCode()` correction and the fix above
   (different family from the implementer: Grok for Codex code; Grok was at 93% weekly).
3. **Schema facts to use**: `modifiedInput` is NOT in the 0.155.1 schema (edited-input parity is
   unverified → user-reserved reduction decision later). Candidates for the harness-gap table:
   `item/tool/requestUserInput` (AskUserQuestion), `acceptForSession` (Always Allow),
   `item/plan/delta` / `turn/plan/updated` (plan), `item/permissions/requestApproval`,
   `mcpServer/elicitation/request`, `thread/compact/start`, `thread/rollback`.
4. **Version drift**: user's global `codex` is 0.163.0; Ptah bundles 0.155.1 (resolved first by
   `codex-native-binary-path.ts`). The core must check the manifest pin against the binary resolved
   at runtime.
5. **Spike residuals accepted by review**: if a tree kill fails, a temp auth copy can stay in
   `%TEMP%\ptah-codex-evidence-*` (check after every run); usage ceiling is observed, not enforced.

## Peer coordination (other sessions)

- TASK_2026_712 (provider accounts, `feat/provider-accounts`, PR #808) owns until merged:
  `libs/shared/src/lib/types/agent-adapter.types.ts`, `sdk-query-options-builder.ts`,
  `sdk-query-runner.service.ts`, agent-sdk `helpers/index.ts` and `src/index.ts`,
  `cli-agent-runtime` `di/register.ts`, `cli-adapter.interface.ts`. Claim-first for
  `session-metadata-store.ts`, `sdk-agent-adapter.ts`, `chat-session.service.ts`. Migration 0058 is
  theirs. Codex multi-account moved to TASK_2026_715_6cba, which builds on our per-home
  `CodexHomeAuthReader` seam.
- Heavy-check slot protocol: claim by message, wait for "released", release after. At wrap-up the
  glass-theme session (TASK_2026_710, PR #805, new pipe `card-design-v5`) holds the slot. Use
  ListAgents for current addresses; old pipe addresses can be stale.

## Key files

Task folder `D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/`:
`context.md`, `decisions.md` (all decisions with evidence), `task-description.md`,
`parity-inventory.md`, `research-report.md`, `plan-alignment-audit.md`, `implementation-plan.md`
(486 lines; evidence spike `:255-270`, gap register `:307-333`, team-leader handoff `:336+`,
removals `:411+`), `implementation-plan-review.md`, `batch-1a-report.md`, `batch-1a-fix-report.md`,
`code-logic-review-batch-1a.md`, `spike-run.md`, `spike-run.json`.

Code: `libs/backend/codex-runtime/tools/evidence-harness.ts`, `evidence-harness.spec.ts`,
`evidence-cases.json`, `generate-protocol-manifest.mjs`, `src/lib/protocol/*`.

Bundled binary: `D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` (0.155.1).

## Next steps

1. Read this file, then `decisions.md` (last 15 rows) and `implementation-plan.md:255-284`.
2. Push the local commits (pre-push runs di-lint + Electron validate-deps: claim the heavy-check slot
   first), as one background command:
   `git -C D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat push`
3. Fix the spike blocker (open problem 1) on a Codex lane (`backend-developer`), budget ≤ 20 tool
   calls, lane runs no checks. Then have Grok (or another family with room) review the diff of
   `f9e7fbfc6..HEAD` for `libs/backend/codex-runtime/tools/`.
4. Under the heavy-check slot, verify:
   `npx jest -c libs/backend/codex-runtime/jest.config.ts --coverage=false --maxWorkers=2`
   `npx nx typecheck codex-runtime --parallel=1`
5. Dry run, then real run 2 (8-turn cap is per run; record run 1 used 0):
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --dry-run`
   `npx ts-node --project libs/backend/codex-runtime/tsconfig.spec.json libs/backend/codex-runtime/tools/evidence-harness.ts --run --binary 'D:/projects/ptah-extension/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe' --auth-source "$USERPROFILE/.codex/auth.json" --model gpt-5.1-codex-mini --out 'D:/projects/ptah-extension/.claude-worktrees/codex-sdk-main-chat/.ptah/specs/TASK_2026_714_c8a2/spike-run.md'`
   After the run: `ls -d "$TEMP"/ptah-codex-evidence-*` must list nothing.
6. Write `native-route-evidence.md` (pass / fail / unverified per required observation in
   `implementation-plan.md:262-270`, plus the filled harness-gap table). Failures keep production
   disabled; bring capability reductions (e.g. no `modifiedInput`) to the user.
7. Then team-leader decomposition of the core batch (contracts/core/auth), respecting the 712 claims.

Rules: CLI lanes first (temporary CLAUDE.md rule until 2026-10-24; no Claude subagents), memory-safe
scoped checks only, commit in foreground, push in background, never commit to main.
