# HANDOFF — TASK_2026_692_f748: Idle compaction for Agent SDK sessions

Written 2026-10-18 by the orchestrator session (token budget reached).

## Goal

Save Claude usage. Compact a large, idle Claude Agent SDK session shortly before its 1-hour
prompt cache expires, so the next user message does not re-read the full context uncached.
The Claude Code CLI does this itself (2.1.299+), but its gate excludes the `sdk-ts` entrypoint,
so Ptah builds it manually. The user asked for a performant, multi-session aware handler built
with RxJS. Full research: `context.md`. Binding decisions: `decisions.md` (#1-#12).

## Where everything is

- Worktree: `D:\projects\ptah-extension\.claude-worktrees\idle-compaction`
- Branch: `feat/idle-compaction` (from `main` at `7bdc6eed4`). NOT pushed. No PR yet.
- Task folder: `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748`
- `node_modules` in the worktree is a junction to the main checkout's `node_modules`.
- Key docs in the task folder: `task-description.md` (rev 3, approved Gate 1),
  `implementation-plan.md` (rev 3 + Gate 2 amendment, approved by the user), `batches.md`
  (source of truth for batch state), `decisions.md`, `research-report.md` (live probe P1:
  A2/A3/A4 PASS), `code-logic-review*.md`, `code-style-review*.md`, `batch-*-report.md`.

## Done (committed on feat/idle-compaction)

| Batch | Commit | Content |
|---|---|---|
| 1 | 70478faf7 | Coordinator idle claim, manual admission, `postCompactSeen` (Gate 2 fix) |
| 2 | a3ecaff29 | Idle types, unref'd RxJS scheduler, `rxjs` dep in agent-sdk + ptah-cli |
| 3 | b9cab2be6 | Request tracker (1h cache classification), pure fire gate |
| 4 | 53018036f | Pure idle session reducer |
| 5 | cdb70c581 | Settings `compaction.idleCompactionEnabled` (default true), `compaction.idleCompactionMinTokens` (default 200000) |
| 6 | 7901e5155 | Export keys + `getIdleCompactionConfig()` |
| 7 | c7e24c58b | `IdleCompactionService` (groupBy / switchMap timer / exhaustMap fire) |
| 8 | daeefb6ec | Coalescing + 1,000-session leak spec, 2 service fixes |
| 8F | 4af674c31 | Prettier on idle folder, `ManualCompactAdmission` type file |
| 8G | d27b9e13f | Sending/boundary deadlines, alias normalisation, per-signal containment |
| 8H | e931d243c | Idle defaults validated in config provider constructor |
| 8I | 2e8b4820b | Hung send abandoned (takeUntil), safeWarn, rekey-collision log |
| 9 | bb9cb377b | Session tap idle signal producers |
| 10 | 0adfca37b | Pump `beforeEnqueue` veto, `SDK_IDLE_COMPACTION` token, facade `sendIdleCompact`, DI registration |
| 11 | eda363706 | Hook handler rekey target, PostCompact fallback id, CLI smoke assertion |
| 12 | 90dc77bf4 | Router manual `/compact` admission (no await, release in finally, fail-open) |
| 13 | 97338b3fa | Electron + VS Code smoke assertions |

Phase 1 (Batches 1-8I): reviewed by Claude reviewers (implementer codex), APPROVED after the fix
round and the bounded correction 8I. Phase 2 (Batches 9-13): implemented and committed; phase 2
review returned NEEDS_REVISION (see below).

## In progress — Batch 13F (Phase 2 fix round), UNCOMMITTED

Codex lane `95be8cde-e6ad-4dd4-ba59-05c433ed26f6` (see "Lane result" at the end of this file for
its final state). Scope (decision #12):

1. Logic Serious: make the `SDK_IDLE_COMPACTION` factory in
   `libs/backend/agent-sdk/src/lib/di/register.ts` fail open (try/catch, one logged Error,
   return null) so a throw cannot break `SessionLifecycleManager` / `CompactionHookHandler`
   resolution and every chat start. Remove the `SessionId` cast if possible.
2. Style Serious: type the idle dependency of `session-lifecycle-manager.ts` and
   `compaction-hook-handler.ts` by interfaces (facade: `IdleCompactionSignals` + `dispose` +
   `boundaryNoticeFor`; hook handler: the rekey-target shape), not the concrete class.
3. M2 — confirmed real defect: a manual `/compact` that the router coalesces/dedupes returns
   success with no stream, and the frontend marks the tab streaming after every successful
   `chat:continue` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:758-781`);
   `CHAT_COMPLETE` only handles `command:'clear'` (`chat-message-handler.service.ts:385-411`),
   so the spinner never stops. Authorized fix: additive optional `settled?: boolean` on the shared
   `chat:continue` result type; the router returns it on coalesced/deduped; `MessageSender` does
   not enter streaming for a settled result. Specs on both sides.

Report: `batch-13F-report.md` in the task folder.

## Remaining work

1. Finish/verify Batch 13F (see "Lane result" below), then commit it (feature branch only).
2. Phase 2 scoped re-review of 13F: one Claude code-logic reviewer + one code-style reviewer
   (different family from codex). Fix cap per agent-lanes §6: if the re-review still finds
   Blocking/Serious defects, allow ONE bounded correction, then review once more; if defects
   remain, report to the user and stop.
3. Phase 3 — Batches 14-17 (the idle compaction chat notice): Batch 14 = shared notice field +
   backend stamp; Batches 15-17 = frontend. Read their sections in `batches.md`. Phase 3 review =
   code-logic + style + visual review with before/after screenshots in dark and light themes
   (before = base commit `7bdc6eed4`). Note: Batch 13F touches `libs/shared` and
   `libs/frontend/chat`; check overlaps with Batches 14-17 before starting them.
4. QA: senior-tester run, then completion (team-leader Mode 3).
5. Push the branch and open a PR (user's global rule: no orphaned local branches). Push in the
   background; the pre-push hook runs di-lint and the Electron validate-deps gate.

## Open problems and later items

- Later items in `batches.md` (L1-L8): F5, F6, F7/L3 (PreCompact before `fire-sent` — confirmed
  impossible in practice; do not add I/O awaits to the send path), F8, unlogged rekey collision
  (fixed in 8I), constructor options object, duplicated 100k/200k constants, no spec for a
  reducer that throws on `session-released`.
- Phase 2 later items: M1 (an idle `/compact` can be queued ahead of a just-typed user message),
  M3 (router has no own expiry for a held claim), `session-query-executor.service.ts` exceeds the
  700 max-lines warning (756) — extract `CompactionSessionTap` later.
- The Jest "worker failed to exit gracefully" warning on the full agent-sdk run is NOT from idle
  code (`--detectOpenHandles` clean on the idle specs).
- Idle compaction only helps sessions on the 1-hour cache TTL (Claude subscription). API-key and
  third-party provider sessions use 5-minute TTL and never arm (by design).

## Process rules for the next session

- Orchestration skill flow; lanes-first (codex is the only lane with confirmed quota; grok and
  opencode near limit). Reviews by a different family than the implementer (Claude reviewers).
- Repo CLAUDE.md verification rules: scoped checks only, `NX_NO_CLOUD=true`, Jest
  `--coverage=false --maxWorkers=2`, Nx `--parallel=1`, one heavy check at a time, never
  workspace-wide/build/serve/e2e. Commit in the foreground; push in the background.
- Commit scopes used: `agent-sdk`, `rpc-handlers`, `shared`, `platform-core`, `cli`, `electron`,
  `vscode`, `task-specs` (check `.commitlintrc.json`). End commits with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Verification commands (run from the worktree)

```bash
export NX_NO_CLOUD=true
npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2 2>&1 | grep -E "Tests:|Test Suites:|FAIL"
npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.idle.spec.ts libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL"
npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.idle-coalesce.spec.ts libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.activation.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL"
npx jest -c apps/ptah-cli/jest.config.cjs apps/ptah-cli/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2 2>&1 | grep -E "Tests:|FAIL"
npx nx typecheck @ptah-extension/agent-sdk --parallel=1 2>&1 | tail -5
npx nx typecheck @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -5
# Batch 13F frontend part (check the chat lib jest config path first):
# npx jest -c libs/frontend/chat/jest.config.ts <message-sender spec> --coverage=false --maxWorkers=2
```

## Lane result (Batch 13F)

The lane ended normally (exit 0, verdict delivered, 3 reports; codex CLI Session ID
`01a14bfc-ee4b-73a3-bbaf-89e4a8736fb1` if a resume is needed). Report: `batch-13F-report.md`. The
orchestrator has NOT yet verified it independently, and nothing from 13F is committed.

The lane reports these results:
- **Logic S1:** fixed. The factory construction moved to a named helper in `register.ts`
  (:139-179, :544-559). It catches and logs one real Error, caches the failure (because
  `instanceCachingFactory` does not cache `undefined`) and returns `undefined`. The service
  disposes earlier subscriptions if a later one throws. New spec case in
  `register.compaction-boundary-registry.smoke.spec.ts`.
- **Style S1:** fixed. The facade uses the new `IdleCompactionFacadePort`
  (`idle-compaction.types.ts:254-257`). The hook handler uses
  `Pick<IdleCompactionSignals, 'rekey'>`.
- **Style M2:** fixed. The factory is smaller and has no `SessionId` cast.
- **Logic M2:** fixed. `ChatContinueResult.settled?` is in `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:172-173`.
  The router sets it on both no-stream returns (:140, :183). `MessageSender` returns the tab to
  idle and does not start streaming. Specs are at `message-sender.service.spec.ts:361,389` and in
  the router coalesce spec (:137, :157, :169).
- **Checks reported by the lane:** all changed specs pass, and the CLI (18), Electron (28) and
  VS Code (43) smoke specs pass. The typechecks pass for agent-sdk, shared, chat and
  rpc-handlers. ESLint has 0 errors, with a new max-lines warning on `register.ts`. Prettier passes.

Uncommitted files (git status): decisions.md, register.ts, register.compaction-boundary-registry
.smoke.spec.ts, compaction-hook-handler.ts, idle-compaction.service.ts, idle-compaction.types.ts,
session-lifecycle-manager.ts, chat-slash-command-router.service.ts and its idle-coalesce spec,
message-sender.service.ts and its spec, rpc-chat.types.ts. Untracked: HANDOFF.md,
batch-13F-report.md, code-logic-review-phase2.md, code-style-review-phase2.md.

## Exact next steps

1. Read `batch-13F-report.md` and the 13F diff (`git diff`). Run the scoped checks yourself, one
   at a time:
   - Jest on `register.compaction-boundary-registry.smoke.spec.ts`,
     `session-lifecycle-manager.idle.spec.ts`, `compaction-hook-handler.spec.ts` and the idle folder
     (agent-sdk config).
   - The router idle-coalesce spec (rpc-handlers config).
   - `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts` (chat config).
   - The typechecks for agent-sdk, rpc-handlers, shared and chat.
2. If the checks pass, commit 13F on `feat/idle-compaction`. Suggested subject:
   `fix(agent-sdk,rpc-handlers,shared,chat,task-specs): batch 13F - phase 2 fixes`. Check the scope
   enum in `.commitlintrc.json`, and stage the phase 2 review files and HANDOFF.md with it. Mark
   Batch 13F in `batches.md` (add the entry if it is missing).
3. Run the Phase 2 scoped re-review of the 13F diff with Claude logic and style reviewers.
4. Then do Phase 3 (Batches 14-17), QA, and push with a PR (see "Remaining work").
