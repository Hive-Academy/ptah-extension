# Batches - TASK_2026_580_9f77

Total tasks: 50 | Batches: 29 | Complete: 19/29

## Resume here (session handoff, 2026-10-01)

Draft PR: #623 (opened 2026-10-01 at the user's request; update its batch list on each push, mark ready at the PR gate).

The run paused at the user's request after A3.4 and A3.4b. A fresh team-leader session
resumes from this section; the batch sections below hold each batch's full task text
and review notes.

- **Where:** worktree `D:\projects\ptah-extension\.claude-worktrees\task-580`, branch
  `feat/task-580-session-organization`, base `a90c086d7`. One commit per batch, all on
  this branch.
- **Hooks are now installed in this worktree** (`npx husky`; `.husky/_` is
  git-ignored), so commits run pre-commit (lint-staged: prettier and affected lint),
  commit-msg (commitlint) and pre-push (di-lint).
  - Commits before `fae183675` ran no hooks: husky was never installed here, because
    `node_modules` is a junction to the main checkout.
  - A3.4b brought the whole branch back to green on all of those checks (see "Branch
    checks" below).
- **lint-staged hides unstaged changes during pre-commit.** Commit only when no
  executor is editing the tree, otherwise its in-progress files are disturbed.
  lint-staged also keeps a temporary backup on the git stash stack, which other
  sessions share.
- **Reviews:** one antigravity `code-logic-reviewer` lane per batch, writing
  `code-logic-review-<batch>.md` into this folder (narrow re-checks write `-r1.md`).
  - Glm (ptah-cli `pc-355b645d-…`) hit its Ollama Cloud quota (429); do not use it
    unless it is confirmed working again.
  - Codex is unavailable until 2026-10-03.
- **Verification:** `npx nx run-many -t typecheck,test,lint -p <project>`. Under
  parallel load the Nx plugin workers time out; prefix the command with
  `NX_DAEMON=false NX_ISOLATE_PLUGINS=false`. Nx Cloud prints a 401 (free plan
  disabled); that is a warning only.
- **Rule kept all run:** the team-leader never edits reviewed code. A fix goes back to
  the batch's executor, or is carried into a later batch that owns the file.

### Status and commits

| Batch                                                                     | Status                     | Commit    |
| ------------------------------------------------------------------------- | -------------------------- | --------- |
| A1.1 shared contracts (vocabulary, list params, row fields)               | COMPLETE                   | beb938cd2 |
| A1.2 shared contracts (push message, git notification, worktree callback) | COMPLETE                   | 56f37fb5b |
| A2.1 migration 0050 + 12 version bumps                                    | COMPLETE                   | bb6b35beb |
| A2.2 recorder port (platform-core)                                        | COMPLETE                   | 1671012e9 |
| A2.3 session id rotation signal (agent-sdk)                               | COMPLETE                   | ec1364697 |
| A3.1 new lib + SessionOrganizationStore                                   | COMPLETE                   | 2789094b7 |
| A3.2 SessionOrganizationService + PR URL parser + tokens                  | COMPLETE                   | 7f6372a40 |
| A3.3 capture service (delete cascade, rekey)                              | COMPLETE                   | b6ac36321 |
| A3.4 DI register + start                                                  | COMPLETE                   | fae183675 |
| A3.4b branch hook-clean (audit markers, commitlint scope, prettier)       | COMPLETE                   | efa997ca5 |
| A4.1 `session:list` query + AC1 perf spec                                 | COMPLETE                   | eb67d86f3 |
| A4.2 organization RPC handlers + manifest + registry entries              | READY (PENDING)            | —         |
| A5.1 Electron + CLI host wiring (+ R-TL11 check)                          | PENDING (after A4.2)       | —         |
| A5.2 VS Code unavailable proof                                            | PENDING (after A4.2)       | —         |
| B1 SDK worktree hook + fork lineage                                       | COMPLETE                   | 3961f4322 |
| B2 PR capture subscriber (+ B2.3 hardening)                               | COMPLETE                   | a98c1dd2c |
| B3.1 runtime capture (cli-agent-runtime)                                  | COMPLETE                   | 8f16da0ed |
| B3.2 MCP worktree capture (git namespace)                                 | COMPLETE                   | b45af4490 |
| B3.3 `PtahAPI.sessionOrganization` namespace                              | COMPLETE                   | 4bbeb40f9 |
| B3.4 namespace hardening + builder tests                                  | COMPLETE                   | f39b2d2ce |
| B3.5 `ptah_session_link_task` MCP tool                                    | COMPLETE                   | bd5c5d98f |
| C0.1 board start carries `taskId`                                         | COMPLETE                   | a83ca9b6e |
| C0.2 board-start link capture + push handling                             | PENDING (after A4.2)       | —         |
| C1.1 chips, filter bar, editor                                            | PENDING (after C0.2, A4.2) | —         |
| C1.2 loader + app-shell sidebar (visual)                                  | PENDING (after C1.1, A4.1) | —         |
| C2.1 open-session bridge                                                  | PENDING (after C0.1, C1.2) | —         |
| C2.2 task links service + card (visual)                                   | PENDING (after A4.2)       | —         |
| C2.3 task detail sessions list (visual)                                   | PENDING (after C2.1, C2.2) | —         |
| T1 AC evidence, smoke S1-S8, test-report.md                               | PENDING (after all)        | —         |

### Branch checks at handoff (all must stay green)

- `npx nx run degradation-audit:lint`: session-organization 0 (baseline 0);
  vscode-lm-tools 2 (baseline 2).
- `npx commitlint --from a90c086d7 --to HEAD`: every commit valid.
- `npx prettier --check` on every file changed since `a90c086d7`: clean.
- `npx nx run di-lint:lint`: passes.

### Next READY batches (they can run in parallel: different libs, no shared files)

**B2 — PR capture subscriber** (backend-developer, sequential, 3 tasks).
Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`.
Files:

- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\utils\pr-url.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\utils\pr-url.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization-capture.service.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization-capture.service.spec.ts`

Tasks:

- B2.1 `extractGhPrCreateUrl`, which reuses `parsePrUrl` (no second canonicalizer).
- B2.2 the PostToolUse subscription, with a reachability spec through
  `startSessionOrganization` and a tab-id-drop spec.
- B2.3 hardening carried from the A3.3 review and the A3.4 executor: whitespace
  `workspaceId`/`previousSessionId`, and the `start()` subscription leak on a
  partial failure.
- Optional B2.4, if B2 stays within the cap: the three A3.4 review nits in
  `di/register.ts` and `di/start.ts` (see the A3.4 section).

**A4.1 — `session:list` query extension + AC1 perf spec** (backend-developer,
sequential, 2 tasks). Verification:
`npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`.
Files:

- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-list-query.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-list-query.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-organization-rpc.schema.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.spec.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-list.perf.spec.ts`

Use the service's `queryWorkspace`, `countChildren`, `listTaskLinks` and
`toSessionOrganizationSummary`; do not reach into the store.

After those: A4.2, which also owns the `rpc.types.ts` registry entries (R-TL1). A4.2
unlocks A5.1, A5.2, C0.2 and C2.2.

### Open risks, rulings, merge points and follow-ups

- **R-TL1 (ruled):** the six RPC registry entries land in A4.2, together with their
  manifest owner, never earlier: `assertManifestInvariants` and three rpc-surface specs
  would break.
- **R-TL5: migration merge point with TASK_2026_578 (open).** 580 owns 0050. 578 adds
  `0051_skill_lifecycle` and bumps the same 12 `max version` asserts to 51; whoever
  merges second rebases and re-bumps them. 586 also uses 0051+.
- **R-TL6: merge point with TASK_2026_584 on `sdk-agent-adapter.ts` and its spec
  (open).** 580 changed a statement before the new-chat bind guard, the `notifyAll`
  payload (`previousSessionId`) and a new `readReboundSource`, plus a prettier pass
  (A3.4b). 584 changes the `createSessionIdCallback` parameter list and the
  `create(...)` call. These are different statements; the second to merge rebases.
- **R-TL7: merge points with TASK_2026_584 (open).**
  - `mcp-contract.sweep.spec.ts` pinned tool counts, now 57 (`:1707`) and 54 (`:1731`)
    after B3.5. 584 also adds a tool, so the second to merge adds both increments.
  - Also shared: `protocol-dispatcher.ts`, `types.ts`, `ptah-api-builder.service.ts`,
    `tool-result-budget.ts`; in shared `message-constants.ts`, `payload-map.ts`,
    `rpc.types.ts`; in chat `chat-message-handler.service.ts`.
- **R-TL8 (open, no code yet):** the `recordAgentStartedSession` call in 584's
  `session-spawner.service.ts` `SessionIdResolved` handler, plus its spawner spec, is
  added by whichever of 580/584 merges second. 584 code is not on main yet.
- **R-TL11 (ruled; check owed in A5.1):** `WorktreeHookHandler`, `SessionForkService`
  and `PtahAPIBuilder` are singletons that take the recorder through their
  constructors. The host order is safe today (B1 and B3.2 reviews).
  - A5.1 must assert, after the real Electron and CLI containers are built, that all
    three hold the bound recorder. That may add
    `apps/ptah-cli/src/di/container.smoke.spec.ts`.
  - Pinning the order was chosen over lazy lookup. B3.1's `recordChildLineage`
    resolves lazily and is exempt.
- **R-TL12 (ruled, accepted residual):** recorder writes are detached after an async
  metadata read. A capture that finishes after a delete or a rekey can leave an orphan
  row, which is harmless because `session:list` joins from metadata (plan failure
  table `:1233`, D4). T1's write-path trace confirms orphans never surface.
- **Namespace-count follow-up (open, out of scope):** the help overview header
  (`system-namespace.builders.ts:49`) says "22 Namespaces" but lists 21, and the
  `PtahAPIBuilder` log line says "21 namespaces". Both were already out of step before
  this task. Fix in one follow-up that derives the counts from the real `PtahAPI` keys.
- **A3.4 review nits (open):**
  - the `SessionOrganizationService` class is not aliased to `SERVICE`
    (`register.ts:42-45`);
  - the log text at `start.ts:41` assumes the cause;
  - the disposable at `start.ts:48` has no error boundary.

  Fold into B2 as B2.4, or file a follow-up.

- **Carried requirements already written into later batches:**
  - A4.2:
    - Zod-parse params before every service mutation; `null` params give
      `INVALID_PARAMS`, with a spec;
    - call `setOrganization`, `linkSessionTask`, `unlinkSessionTask`,
      `addSessionPrLink` and `removeSessionPrLink`;
    - map `SessionOrganizationInputError` to `INVALID_PARAMS`;
    - set the real `missing` flag on mutation results.
  - T1: the two `taskId` assertions in `task-start.service.spec.ts` (C0.1 nit).
- **Plan follow-ups (out of scope):**
  - related defect 1: the Electron gateway lister's `Array.isArray`;
  - related defect 2: `messageCount`/`isActive` on `session:list`;
  - the 584 `childrenOf` reader;
  - the orchestration-skill note to call `ptah_session_link_task`.
- **Visual evidence owed:** before screenshots (V0, dark and light) from base
  `a90c086d7`, and after screenshots for C1.2, C2.2 and C2.3.

Worktree root (all paths below are absolute under it):
`D:\projects\ptah-extension\.claude-worktrees\task-580` — branch
`feat/task-580-session-organization`, base `a90c086d7`. On 2026-10-01 `origin/main`
is `c4ab013f3`. Between the base and that commit nothing under `libs/`, `apps/` or
`tsconfig.base.json` changed, and migrations on `origin/main` still end at 0049.

Plan: `implementation-plan.md` Revision 2 (approved by the user 2026-10-01). User
decisions: `context.md` plus the Electron-only decision (plan :30-51). Final; do not reopen.

## Execution defaults (recorded by team-leader)

- Executors are in-process subagents (backend-developer / frontend-developer /
  senior-tester). Inside each batch, tasks run in order (one executor per batch).
  Batches run in parallel only when they write to different libs (see "Waves").
- The plan's 12 batches are split so that each batch has at most 6 files and at most 2
  projects (team-leader rule). Plan ids are kept as prefixes (A1 → A1.1/A1.2 and so on),
  so the plan's handoff table still maps 1:1.
- Two batches go over the cap, deliberately:
  - **A2.1 (15 files, 1 lib).** Registering migration 0050 turns all 12 specs that pin
    `max version === 49` red, so the registry edit and the 12 one-line bumps must land
    and be verified together.
  - **A3.1 (9 files, 1 lib).** Five of the files are generated new-lib boilerplate
    copied from `libs/backend/task-specs`.
- Review routing. Every batch gets an independent code-logic review through a CLI lane:
  - lane: antigravity; fallback: Glm; codex is unavailable until 2026-10-03;
  - output: `code-logic-review-<batch>.md` in this folder, e.g.
    `code-logic-review-A1.1.md`;
  - the batch is committed only on APPROVED.
    A3.1 also gets a code-style review (new lib: tags, barrel, lint boundaries). Batches
    with rendered UI also need visual-reviewer evidence (see "Visual evidence").
- Verification uses one scoped command per batch:
  `npx nx run-many -t typecheck,test,lint -p <projects>`. Tail or filter the output;
  never paste it in full. Lib project names are `@ptah-extension/<lib>`. App names have
  no prefix: `ptah-electron`, `ptah-extension-vscode`. The new lib is
  `@ptah-extension/session-organization`.
- The worktree has no `node_modules` yet. The orchestrator runs `npm ci` once before the
  first batch. Executors do not install.
- Parallel batches share one worktree. A downstream typecheck reads upstream sources
  through TS paths, so it can see a sibling batch's half-written file. If the only
  failures in a verification run are in files outside the batch, re-run once the
  sibling batch lands. Never "fix" a sibling batch's files.

## Waves (dependency order; batches in one wave touch different libs)

| Wave | Batches                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 1    | A1.1 (shared), A2.1 (persistence-sqlite), A2.3 (agent-sdk), C0.1 (core + tasks-ui, no deps) |
| 2    | A1.2 (shared), A2.2 (platform-core), A3.1 (session-organization)                            |
| 3    | A3.2, B1 (agent-sdk), B3.2 (vscode-lm-tools)                                                |
| 4    | A3.3 → A3.4, B3.1 (cli-agent-runtime), B3.3 → B3.4 → B3.5 (vscode-lm-tools)                 |
| 5    | A4.1 → A4.2 (rpc-handlers), B2 (session-organization, after A3.4)                           |
| 6    | A5.1 (electron + cli-engine), A5.2 (vscode), C0.2 (chat), C2.2 (tasks-ui)                   |
| 7    | C1.1 → C1.2 → C2.1 (chat lane), then C2.3 (tasks-ui)                                        |
| 8    | T1                                                                                          |

## Plan validation

Status: PASSED WITH RISKS

Verified against the code in this worktree:

- Migrations end at 0049 (`migrations/index.ts:77,363-367`).
- Exactly the 12 specs the plan names pin 49: `0028`, `0030`, `0038`-`0043`, `0045` and
  `0047` assert it directly; `0044:67-69` and `0046:32-34` assert
  `Math.max(...)` = 49. The `0049` and `0048` specs filter by their own version and need
  no change.
- `createSessionIdCallback` and `bindRefused` match plan component 13:
  `sdk-agent-adapter.ts:1102-1160,1187-1210`. `SessionLifecycleManager.find` is at
  `:407`. `SessionIdResolvedPayload` is at `session-id-resolved-callback-registry.ts:44-58`.
- Barrels:
  - `libs/shared/src/index.ts:39` exports `task-spec.types`;
  - rpc-handlers exports handler classes in two places:
    `src/lib/handlers/index.ts:78` and `src/index.ts:54`.
- `rpc-handlers` already imports `task-specs` and `persistence-sqlite`, so the new
  `session-organization` edge is the same kind of edge.
- `agent-sdk`, `task-specs` and `rpc-handlers` are all tagged
  `scope:extension,type:feature`.
- 584 code is not on `origin/main`. PR #613 contained only the plan docs, and there is
  no `session-children/` directory.

| Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-TL1. The plan puts the 6 new `RpcMethodRegistry` + `RPC_METHOD_ENTRIES` keys in A1 (`rpc.types.ts`) but the manifest entry in A4. `assertManifestInvariants` (`rpc-handlers/src/lib/host-profile/manifest.ts:437-466`) throws on unowned methods at boot, and the 3 rpc-surface specs (`apps/ptah-electron/src/di/rpc-surface.spec.ts:37-39`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts:197-203`, `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:59-64`) fail on the gap. So every commit between A1 and A4 would be broken                                                                                                                                         | HIGH     | Move the `rpc.types.ts` edits out of A1 into **A4.2**, beside the manifest entry and the handler (Task A4.2.3). A1.1 still defines the param/result types in `rpc-session.types.ts`. Effect: C0.2, C1.1 and C2.2 (webview calls to the new methods) now depend on A4.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R-TL2. The plan says `SessionListResult` gains `organizationAvailable: boolean` (required), and also says "every addition is optional, so existing callers compile unchanged" (:288-289). A required field breaks about 10 fixtures and producers (`core/src/testing/mock-rpc-service.ts`, `apps/ptah-cli/src/cli/commands/session.ts`, `apps/ptah-electron/src/activation/boot-heavy-services.ts`, chat/core specs)                                                                                                                                                                                                                                                                         | MEDIUM   | Declare it **optional** (`organizationAvailable?: boolean`, doc: "absent means false"). The handler always sets it (A4.1). The webview treats anything other than `true` as unavailable (C1.2). Task A1.1.2; reviewer checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R-TL3. The plan calls component 3 (port) independent of component 1. Its signature uses `SessionStartedBy`, `SessionTaskLinkRole`, `SessionTaskLinkSource`, `SessionPrState` and `SessionPrLinkSource`, which are component 1 types                                                                                                                                                                                                                                                                                                                                                                                                                                                          | LOW      | A2.2 depends on A1.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| R-TL4. The plan lists A5 as parallel with A4. A5's Electron smoke assertion and its VS Code spec resolve `SessionOrganizationRpcHandlers`, which A4.2 creates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | LOW      | A5.1 and A5.2 depend on A4.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| R-TL5. Migration number collision. Tasks 586 and 578 were told to use 0051+. Each will also bump the same 12 `max version` assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | MEDIUM   | 580 owns 0050. Whichever of 580/586/578 merges later rebases and re-bumps the 12 asserts to its own maximum. Note on A2.1. Confirmed 2026-10-01: TASK_2026_578 adds `0051_skill_lifecycle` and bumps the same 12 asserts to 51; whoever merges second rebases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R-TL6. 584 merge point on `sdk-agent-adapter.ts` **and** `sdk-agent-adapter.spec.ts`. 584 Batch 1 (`task-584/.ptah/specs/TASK_2026_584_5e7a/batches.md:147-170`, IN_PROGRESS) edits both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | MEDIUM   | A2.3 touches only: one new statement before the `:1130` guard, the `notifyAll` payload at `:1155-1159`, and a new private method `readReboundSource`. It never touches the parameter list, the `create(...)` call, `bindRefused` or `:1017`. Whichever task merges second rebases. Note on A2.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R-TL7. 584 merge point on `vscode-lm-tools` (`protocol-dispatcher.ts`, `types.ts`, `ptah-api-builder.service.ts`, `tool-result-budget.ts`, `mcp-contract.sweep.spec.ts` pinned counts `:1707` 56 / `:1731` 53), on shared (`message-constants.ts`, `payload-map.ts`, `rpc.types.ts`) and on chat (`chat-message-handler.service.ts`)                                                                                                                                                                                                                                                                                                                                                         | MEDIUM   | The second to merge adds the other's increment and entries (plan :1465-1471). Note on B3.4, A1.2, A4.2 and C0.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R-TL8. `recordAgentStartedSession` call in 584's `session-spawner.service.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | LOW      | **No code now.** 584 keeps its in-memory registry. Whichever task merges second adds the one call and its spawner spec (plan :1445-1452). Recorded on B3.4 and T1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R-TL9. Frontend layout differs from the plan's file list: `task-card` and `task-detail` use inline templates (no `.html`), and the app shell has split specs (`app-shell.*.spec.ts`), not one `app-shell.component.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | LOW      | C1.2 creates `app-shell.organization.spec.ts`. C2.2 and C2.3 edit inline templates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R-TL11 (raised by the B1 executor, 2026-10-01). Capture producers take the recorder by constructor injection `{ isOptional: true }` and are singletons: `SDK_WORKTREE_HOOK_HANDLER` (`agent-sdk/src/lib/di/register.ts:514-518`), `SDK_SESSION_FORK_SERVICE` (`:603-607`) and `PtahAPIBuilder` (B3.2). If any of them is resolved before `registerSessionOrganizationServices` runs, it holds `undefined` for the process lifetime and that capture path silently never fires. In Electron, nothing in phase 2 resolves them between `registerSdkServices` (`phase-2-libraries.ts:194`) and the planned registration after `:393`, so the plan's order looks safe today, but nothing pins it | HIGH     | A5.1 acceptance check (Task A5.1.1): after the real host container is built, `container.smoke.spec.ts` resolves `SDK_WORKTREE_HOOK_HANDLER`, `SDK_SESSION_FORK_SERVICE` and `PtahAPIBuilder` and asserts each holds the bound recorder (not `undefined`). The CLI gets the same check for its container (`cli-engine/src/lib/container.ts:640` SDK vs `:716` thoth); if the CLI's container spec is not in A5.1's files, A5.1 adds `apps/ptah-cli/src/di/container.smoke.spec.ts`. If an early resolve exists, A5.1 moves the register call ahead of it; it does not switch producers to lazy lookup without a team-leader decision. The B3.2 code-logic lane also rules on this. Ruling (`code-logic-review-B3.2.md`, Finding 1, Minor): no defect in production order. `PtahAPIBuilder` is first resolved at MCP startup (`wire-runtime.ts:406`), after phase 2. The lane preferred lazy lookup (Option A). Team-leader keeps Option C, which pins the order with the smoke-spec check above: it keeps every producer's constructor shape, and it fails loudly if a refactor resolves a producer early |
| R-TL10. VS Code has `apps/ptah-extension-vscode/src/di/expected-resolvable.ts` (the list of RPC handler classes that must resolve), which the plan does not mention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | LOW      | A5.2 also adds `SessionOrganizationRpcHandlers` to it if its smoke spec iterates that list (Task A5.2.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Assumptions:

- Plan A2 (`createChild` call sites have no real parent id: `agent-rpc.handlers.ts:971`,
  `chat-stream-broadcaster.service.ts:211`). Unverified; checked in Task B3.1.2. If a
  site has a real parent id, the executor reports it and does not edit rpc-handlers. The
  team-leader then adds a follow-up batch.
- Plan A3 (a folder-open RPC for "Open worktree"). Partly verified:
  `editor:openWorkspace {target, root}` exists (`rpc.types.ts:776-779`,
  `rpc/rpc-editor.types.ts:89-92`). Task C1.1.3 confirms that it accepts a worktree
  directory and is served by Electron. Otherwise the action copies the path and says so.
- Plan A4 (hidden ptah-cli children stay hidden). Scope statement; no check needed.
- `tool-result-budget.ts` has no `ptah_task_update` entry today, so a budget entry may
  not be required. Task B3.4.1 decides from the file's own rule and states its reasoning.
- `session-loader.service.ts` contains a NUL byte, so Grep skips it. Read it directly or
  use `grep -a` (plan :1648-1649).

Edge cases:

- A request with no new `session:list` param returns today's rows, order and total
  (query mode). Handled in Task A4.1.1 and A4.1.2.
- In query mode, archived rows are excluded unless `status` includes `archived`, and
  pinned rows sort first. Handled in Task A4.1.1.
- A PostToolUse `sessionId` that fell back to the tab id is dropped and logged, never
  written. Handled in Task A3.2.1 (resolveRoot) and B2.1.2 (spec).
- `'rebound'` rekey, and the resume path with an accepted bind still calls `touch` and
  both notifications. Handled in Task A2.3.2 and A3.1.2 (`rekeySession`).
- A second `primary` link demotes the existing one in one transaction. Handled in Task
  A3.1.2.
- A capture before the DB opens is dropped and logged (L8). Handled in Task A3.2.1.
- VS Code without the service: the handler constructs, makes no subscription, and every
  method returns `organization-unavailable`. Handled in Task A4.2.1 and A5.2.1.
- A child worktree from 584's `ptah_session_start` is never recorded on the parent (D9).
  Handled in Task B3.2.2.
- The board-start pending map is capped at 20 and lost on reload (L10). Handled in Task
  C0.2.2.
- A linked task folder that was deleted shows "missing". Handled in Task A4.1.2 and
  C1.1.1.

## Visual evidence (UI batches)

- **V0. Before screenshots.** visual-reviewer captures them from base `a90c086d7`, in
  dark and light themes, any time before C1.2 is committed:
  - Electron sidebar session list (with rows, search and date filter);
  - Electron task board card;
  - Electron task detail;
  - VS Code sidebar (AC7: it must stay unchanged).

  Capture from a separate checkout at `a90c086d7` (for example a temporary worktree).
  Never switch this worktree's branch.

- **After screenshots**, dark and light, on the C1.2, C2.2 and C2.3 builds; then
  `visual-review-<batch>.md`.
- No prototype or design-handoff exists for this task (plan :973), so fidelity is
  checked against plan components 11-12 and the before shots.
- C0.1, C0.2, C2.1: no rendered change. They get logic review only.
- C1.1: its components are not mounted until C1.2, so their visual check is part of the
  C1.2 pass.

---

## Batch A1.1: shared contracts — vocabulary, list params, row fields — COMPLETE (commit beb938cd2)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane with the same prompt
- Execution mode: sequential
- Rationale: one lib, tightly coupled type edits; every later batch imports these types.
- Tasks: 2 | Depends on: none
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- Review: code-logic lane → `code-logic-review-A1.1.md`

### Task A1.1.1: create `session-organization.types.ts` with tuples, unions and summary — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\session-organization.types.ts` (CREATE), `...\session-organization.types.spec.ts` (CREATE), `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\index.ts` (MODIFY, one export line beside `:39`)
- Plan reference: implementation-plan.md:225-256, :1-15 (rule tags)
- Pattern to follow: `libs/shared/src/lib/types/task-spec.types.ts:44-45` (`TASK_ESTIMATES` ordered tuple)
- Quality requirements:
  - Tuple order is the sort order.
  - `SESSION_ORGANIZATION_DEFAULTS` = `normal`, `active`, `false`, `user`.
  - `SessionOrganizationSummary` matches plan :241-255 exactly, including
    `updatedAt: number | null` and `missing` per task.
- Validation notes: the spec pins tuple order and membership for every tuple.
- Implementation details:
  - `as const` tuples:
    - `SESSION_PRIORITIES`
    - `SESSION_WORKFLOW_STATUSES`
    - `SESSION_TASK_LINK_ROLES`
    - `SESSION_TASK_LINK_SOURCES`
    - `SESSION_PR_LINK_SOURCES`
    - `SESSION_PR_STATES`
    - `SESSION_STARTED_BY`
    - `SESSION_LIST_SORTS`
    - `SESSION_LIST_GROUPS`
  - A derived union type for each tuple.
  - The summary type and the defaults constant.

### Task A1.1.2: extend `session:list` params/result, new RPC param/result types, row fields — COMPLETE

- Depends on: Task A1.1.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\rpc\rpc-session.types.ts` (MODIFY), `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\execution\node.ts` (MODIFY)
- Plan reference: implementation-plan.md:257-278
- Pattern to follow: `rpc-session.types.ts:65-84`
- Quality requirements:
  - Every addition is optional or new.
  - `SessionListResult.organizationAvailable` is **optional** (R-TL2), with a doc
    comment: "absent means false".
- Validation notes:
  - R-TL2.
  - Do NOT touch `rpc.types.ts`: registry entries move to A4.2 (R-TL1).
- Implementation details:
  - `SessionListParams` gains optional `status?`, `priority?`, `taskId?`, `pinned?`,
    `hasPr?`, `text?`, `sort?` and `groupBy?`.
  - New params/result types for `session:setOrganization`, `session:linkTask`,
    `session:unlinkTask`, `session:addPrLink`, `session:removePrLink` and
    `session:listForTasks`.
  - `SessionOrganizationMutationResult` (plan :266-269).
  - `TaskLinkedSession`.
  - `ChatSessionSummary` gains optional `organization?` and `livePhase?`.

## Batch A1.2: shared contracts — push message, git notification, worktree callback — COMPLETE (commit 56f37fb5b)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: small additive edits in shared. It runs after A1.1 so the two batches do
  not verify the same lib at once.
- Tasks: 1 | Depends on: A1.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared`
- Review: code-logic lane → `code-logic-review-A1.2.md`
- Merge note: `message-constants.ts` and `payload-map.ts` are 584 merge points (R-TL7).

### Task A1.2.1: `SESSION_ORGANIZATION_CHANGED`, payload map, `sessionId` on worktree notification, `worktreePath` on callback — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\messages\message-constants.ts`
  - `...\libs\shared\src\lib\types\messages\payload-map.ts`
  - `...\libs\shared\src\lib\types\rpc\rpc-git.types.ts`
  - `...\libs\shared\src\lib\types\agent-adapter.types.ts`

  (all MODIFY)

- Plan reference: implementation-plan.md:280-287
- Pattern to follow: `message-constants.ts:133-134`; `payload-map.ts:269,364-368`
- Quality requirements: additive and optional only.
- Validation notes: `WorktreeCreatedCallback` exists in shared
  (`agent-adapter.types.ts:96-101`) and as an agent-sdk twin
  (`worktree-hook-handler.ts:50-55`). This batch edits only the shared one; B1 edits the
  agent-sdk one.
- Implementation details:
  - `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED = 'session:organizationChanged'`.
  - Payload `{ workspaceRoot: string; sessionIds: string[]; reason: 'user' | 'capture' | 'delete' }`.
  - `GitWorktreeChangedNotification.sessionId?`.
  - `worktreePath?` on the created-callback data.

## Batch A2.1: migration 0050 + version bumps — COMPLETE (commit bb6b35beb)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale:
  - One lib.
  - The registry edit and the 12 spec bumps are one rollback and verification unit,
    which is why the file cap does not apply here (see Execution defaults).
- Tasks: 2 | Depends on: none
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/persistence-sqlite`
  (the 0050 spec must FAIL, not skip, when no SQLite opener loads)
- Review: code-logic lane → `code-logic-review-A2.1.md`
- Merge note: R-TL5. 580 owns 0050; 586 and 578 use 0051+. The later merge re-bumps
  the 12 asserts.

### Task A2.1.1: create `0050_session_organization.ts`, register it, write its spec — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\persistence-sqlite\src\lib\migrations\0050_session_organization.ts` (CREATE), `...\0050_session_organization.spec.ts` (CREATE), `...\migrations\index.ts` (MODIFY)
- Plan reference: implementation-plan.md:314-379
- Pattern to follow:
  - `0049_memory_sediment_quarantine.ts` and its spec `:30-49,316-321,352-378`;
  - the ledger re-run pattern in `0031`.
- Quality requirements:
  - Static SQL exactly as plan :318-361, with no `${`.
  - No CHECK constraints (L1) and no foreign keys.
  - Registry entry `{ version: 50, name: '0050_session_organization', sql }`.
- Validation notes: the spec covers:
  - the registry entry;
  - tables, indexes and defaults applied on top of 1..49;
  - the partial unique index rejects a second `primary`;
  - the ledger prevents a re-run.
- Implementation details: three tables, `idx_session_org_parent`,
  `idx_session_task_links_task`, `ux_session_task_links_primary`.

### Task A2.1.2: bump the 12 pinned max-version asserts from 49 to 50 — COMPLETE

- Depends on: Task A2.1.1
- File (all MODIFY, under `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\persistence-sqlite\src\lib\migrations\`):
  - `0028_gateway_conversation_workspace_root.spec.ts`
  - `0030_skill_event_metrics.spec.ts`
  - `0038_gateway_message_turn_state.spec.ts`
  - `0039_reap_orphaned_queue_rows.spec.ts`
  - `0040_skill_candidate_workspace_root.spec.ts`
  - `0041_skill_md_migration_state.spec.ts`
  - `0042_db_integrity_check_state.spec.ts`
  - `0043_memory_retention.spec.ts`
  - `0044_*.spec.ts` (`:67-69`)
  - `0045_skill_backlog_cleanup.spec.ts`
  - `0046_*.spec.ts` (`:32-34`)
  - `0047_memory_retention_health.spec.ts`
- Plan reference: implementation-plan.md:58, :379-385
- Pattern to follow: the existing history comment in `0044…spec.ts:65-67` ("48 and 49
  since TASK_2026_563…"). Add one "50 since TASK_2026_580" line where such comments
  exist.
- Quality requirements: the only change is the number (plus the comment line). Do not
  touch the `0048` or `0049` specs; they filter by their own version.
- Validation notes: R-TL5.
- Implementation details: one-line edits.

## Batch A2.2: recorder port (platform-core) — COMPLETE (commit 1671012e9)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: three small coupled files in one lib.
- Tasks: 1 | Depends on: A1.1 (R-TL3)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/platform-core`
- Review: code-logic lane → `code-logic-review-A2.2.md`

### Task A2.2.1: `ISessionOrganizationRecorder`, token, barrel — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\platform-core\src\interfaces\session-organization-recorder.interface.ts` (CREATE), `...\platform-core\src\di\tokens.ts` (MODIFY), `...\platform-core\src\index.ts` (MODIFY)
- Plan reference: implementation-plan.md:387-415
- Pattern to follow:
  - `platform-core/src/interfaces/memory-writer.interface.ts:1-9` (header contract);
  - `tokens.ts:62-63`.
- Quality requirements:
  - The five methods exactly as plan :392-399, including `recordAgentStartedSession`.
  - The header states the contract: SDK UUIDs only, never throws, consumers skip when
    unbound.
  - `SESSION_ORGANIZATION_RECORDER: Symbol.for('PlatformSessionOrganizationRecorder')`.
- Validation notes: imports types only from `@ptah-extension/shared` (a legal edge).
- Implementation details: interface plus token plus one barrel line.

## Batch A2.3: session id rotation signal (agent-sdk, component 13) — COMPLETE (commit ec1364697)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: none. It needs the Revision 2 reasoning in context, so re-run the
  same subagent type.
- Execution mode: sequential
- Rationale: one coupled edit in a hot file shared with 584.
- Tasks: 2 | Depends on: none
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`
- Review: code-logic lane → `code-logic-review-A2.3.md`
- Review outcome: APPROVED 9.5/10 (`code-logic-review-A2.3.md`). One deviation
  is recorded and accepted. The plan asks for the adapter spec to use the
  "real registry". The spec instead uses `wireFakeRegistry`
  (`sdk-agent-adapter.spec.ts:2070-2100`), because the adapter harness mocks
  `SessionLifecycleManager` as a whole. The fake keeps the real
  `bindRealSessionId` branch order (no-record, already-bound, rebound with a
  matching token, stale-mismatch, bound), and `SessionRegistryService` keeps
  its own spec. Senior-tester S5 (T1) is the end-to-end check.
- **Merge note (R-TL6):**
  - TASK_2026_584 Batch 1 edits the same file and its spec. 584 changes the
    `createSessionIdCallback` parameter list (`:1102-1108`) and the
    `metadataStore.create(...)` call (`:1140`).
  - This batch changes only: one statement before `:1130`, the `notifyAll` payload
    (`:1155-1159`), and a new private method.
  - Whichever task merges second rebases. No contract conflict (plan :1473-1488;
    review-r2 answer 2).

### Task A2.3.1: `previousSessionId` on the payload; `readReboundSource`; set it in `createSessionIdCallback` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\agent-sdk\src\lib\helpers\session-id-resolved-callback-registry.ts` (MODIFY), `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (MODIFY)
- Plan reference: implementation-plan.md:1075-1151, :149-201 (G1, decided; do not re-decide)
- Pattern to follow: `sdk-agent-adapter.ts:1102-1160`; `session-lifecycle-manager.ts:407-409`
- Quality requirements:
  - `bindRefused` keeps its signature and body.
  - The `:1017` and `:1130` call sites stay untouched.
  - `readReboundSource` is read-only. It returns the prior `realSessionId` only when that
    id is non-null and differs from the new one.
  - The read happens BEFORE the `:1130` guard, because `'rebound'` mutates the record.
  - `previousSessionId` is added to `notifyAll` only when defined.
  - `resumeCallback` and `emitSessionIdResolved` are unchanged.
- Validation notes: R-TL6. Existing subscribers ignore the optional field.
- Implementation details:
  - `readonly previousSessionId?: string` on `SessionIdResolvedPayload`, documented.
  - `const previousSessionId = tabId ? this.readReboundSource(tabId, realSessionId) : undefined;`

### Task A2.3.2: adapter spec — bound, rebound, stale-mismatch, resume, regression guard, `readReboundSource` table — COMPLETE

- Depends on: Task A2.3.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:1129-1145
- Pattern to follow: existing `createSessionIdCallback` cases in the same spec
- Quality requirements: use the real registry, covering these cases:
  - first `init`: `'bound'`, no `previousSessionId`;
  - second `init` with the owner token: `'rebound'`, `previousSessionId` = first id,
    and `create(newId)` is still called;
  - `'stale-mismatch'`: nothing is notified;
  - resume with a new id: no `previousSessionId`;
  - Revision 2 guard: a resume WITH a `tabId` and an accepted bind calls `touch` once
    and fires both notifications;
  - `readReboundSource`: 4 cases.
- Validation notes: the guard must fail if the `:1017` check becomes always-truthy.
- Implementation details: spec only.

## Batch A3.1: new lib scaffold + `SessionOrganizationStore` — COMPLETE (commit 2789094b7)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: new lib. The store is the base for everything in the lib. The cap exception
  is boilerplate (see Execution defaults).
- Tasks: 2 | Depends on: A1.1, A2.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`
- Review:
  - code-logic lane → `code-logic-review-A3.1.md`;
  - code-style-reviewer (new lib tags `scope:extension,type:feature`, barrel ≤ 150
    lines, lint boundaries) → `code-style-review-A3.1.md`.
- **Fix round 1 (2026-10-01; team-leader decision, commit held).** Code-logic verdict:
  APPROVED 9/10 (Glm, `code-logic-review-A3.1.md`). Before the commit, the same
  executor fixes these three findings, limited to `session-organization.store.ts` and
  its spec:
  - **F3: rekey conflict keeps a primary.** In `rekeyInWorkspace`, handle the case
    where `oldId` links task T as `primary`, `newId` already links T as `related`,
    and `newId` has no other primary. Promote `newId`'s T link to `primary`
    (keeping its `created_at`) before the remaining `oldId` links are deleted. If
    `newId` already has a different primary, T stays `related` (L2). Spec cases
    cover both branches.
  - **F2: deterministic read order.** Add `ORDER BY session_id` to
    `SQL.selectOrganizations`.
  - **F1: rollback proof.** Copy the forced-failure trigger pattern from the
    `deleteSession` test (`store.spec.ts:733-746`):
    - `rekeySession`: fail in the SECOND workspace, then assert that the first
      workspace's rows are back under `oldId`;
    - `linkTask`: fail inside the upsert, then assert that the old primary still
      has `role = 'primary'`.

  Not fixed in this round:
  - F4 (a PR field cannot be cleared back to null) moves to Task A3.2.1.
  - F5 (the conflict path drops the old row's worktree, branch and lineage) and F6
    (a no-change re-link bumps `updated_at`) are accepted as residuals; they are the
    plan's stated rules.

  After the fix: re-run the scoped check. Then a narrow re-check of F1-F3 by resuming
  the Glm A3.1 session `156e8a3a-223d-4260-986d-66c429159740`, appended to
  `code-logic-review-A3.1.md`. The code-style verdict (`c5a2a287-…`, reviewing the
  pre-fix code) must also approve. Only then commit.

### Task A3.1.1: scaffold `libs/backend/session-organization` and add the TS path — COMPLETE

- File (all CREATE unless noted, under `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\`):
  - `project.json`
  - `jest.config.ts`
  - `tsconfig.json`
  - `tsconfig.lib.json`
  - `tsconfig.spec.json`
  - `src\index.ts`
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\tsconfig.base.json` (MODIFY, one path entry beside `:147`)
- Plan reference: implementation-plan.md:542-553, D1 :132
- Pattern to follow: `libs/backend/task-specs/` (it has no `package.json` and no
  lib-level eslint config, so add neither)
- Quality requirements:
  - name `@ptah-extension/session-organization`;
  - tags `scope:extension`, `type:feature`;
  - targets `build`, `test`, `lint` and `typecheck`, copied from task-specs.
- Validation notes: only `rpc-handlers` and the two composition roots may import this
  lib (checked in later batches).
- Implementation details: the barrel exports only what exists after this batch.

### Task A3.1.2: `SessionOrganizationStore` + real-SQLite contract spec — COMPLETE

- Depends on: Task A3.1.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization.store.ts` (CREATE), `...\session-organization.store.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:421-450 (store, `rekeySession`, tolerant read), :525-541
- Pattern to follow:
  - `libs/backend/task-specs/src/lib/task-index.store.ts:244-301,341-382`;
  - spec native probe `task-index.store.spec.ts:121,532-556`.
- Quality requirements:
  - `isReady()` reads `connection.isOpen` live on every call.
  - Static `?` SQL only.
  - Every multi-table write runs in `db.transaction`.
  - Primary demotion runs in the same transaction (L2).
  - Tolerant read maps unknown enum values to defaults (L1).
  - Methods: `listWorkspace`, `listTaskLinks`, `upsertOrganization` (patched columns
    only, lazy insert L12), `linkTask`, `unlinkTask`, `addPrLink` (upsert),
    `removePrLink`, `recordAgentStartedSession`, `deleteSession`, `countChildren`,
    `rekeySession` (all workspaces; the conflict rule at plan :442-446; returns the
    affected roots).
- Validation notes (from `code-logic-review-A2.1.md`):
  - `linkTask` with `role: 'primary'` must demote the existing different
    primary to `related` BEFORE it inserts or updates the new primary, inside
    the same transaction. Otherwise the partial unique index
    `ux_session_task_links_primary` rejects the write. The spec must cover a
    primary replacing a primary.
  - `addPrLink` keys on the exact `url` string (binary collation in the PK), so
    the store must receive the canonical URL from the service (Task A3.2.2).
- Validation notes: the spec runs on real SQLite with 0050 applied and covers:
  - every method;
  - demotion;
  - tolerant read;
  - transactional delete;
  - `rekeySession`: move, reference rewrite, conflict, and the no-op cases.
- Implementation details: inject `PERSISTENCE_TOKENS.SQLITE_CONNECTION`.

## Batch A3.2: `SessionOrganizationService` + PR URL parsing + lib tokens — COMPLETE (commit 7f6372a40)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: service rules plus the parser the service uses (L14); one lib.
- Tasks: 2 | Depends on: A3.1, A2.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`
- Review: code-logic lane → `code-logic-review-A3.2.md`
- Implemented (2026-10-01). Executor deviations, and their downstream impact (the
  owning batch carries each):
  1. The RPC mutation methods are `setOrganization`, `linkSessionTask`,
     `unlinkSessionTask`, `addSessionPrLink` and `removeSessionPrLink`. The port's
     own `linkTask` and `addPrLink` are void and never throw, so the RPC methods
     need different names. → A4.2.
  2. Invalid mutation input throws `SessionOrganizationInputError`. A storage error
     while the store is open is logged and rethrown. → A4.2 maps the first to
     `INVALID_PARAMS` and sanitizes the second.
  3. `removeSession(root, id)` and `rekeySession(old, new)` exist on the service.
     → A3.3 calls these, not the store, so A3.3 does not edit the service.
  4. Exports `SESSION_ORGANIZATION_TOKENS.STORE`, `countChildren`, `listTaskLinks`
     and `toSessionOrganizationSummary`. → A3.4 registers the store under `STORE`;
     A4.1 uses the reads.
  5. A mutation result's tasks always carry `missing: false`. → A4.2 sets the real
     value from the task index.
  6. Validation is stricter than planned: no credentials in URLs, `www.github.com`
     is canonicalized, and session ids are at most 256 characters on one line.
     Accepted. → B2's extractor reuses `parsePrUrl`, so capture and manual adds
     canonicalize the same way.
- Executor's out-of-scope report (R-TL12, recorded): recorder writes run detached
  after an async metadata read, so their order depends on the reads resolving in
  order. The A3.2 code-logic lane rules on it. Until then it is a note, not a task.
- **Review round 1: REVISE 8/10** (antigravity `263e8e39-…`, `code-logic-review-A3.2.md`).
  The same executor fixes the following, limited to A3.2's 6 files:
  1. **Serious (FM-1).** `parsePrUrl` (`utils/pr-url.ts:44-46`) calls `raw.trim()`
     on non-string input, so `addPrLink` (`session-organization.service.ts:286-295`)
     throws a synchronous `TypeError` on `{ url: undefined }`. That breaks the
     port's never-throw contract, and B1's callers rely on it (B1 F1).
     - Fix: `parsePrUrl(raw: unknown)` returns `null` when `typeof raw !== 'string'`.
     - `addSessionPrLink` (`:435`) and `removeSessionPrLink` (`:466`) reject with
       `SessionOrganizationInputError`, never `TypeError`.
     - Specs: `undefined`, `null`, a number and an object each return `null` in
       `pr-url.spec.ts`; the two mutations reject with the input error.
  2. **Same hole, wider (team-leader).** Every recorder method reads `input.<field>`
     synchronously, so `recordWorktree(undefined)` or `addPrLink(null)` also throws.
     - Fix: the synchronous part of each of the five recorder methods
       (`recordWorktree`, `recordLineage`, `linkTask`, `addPrLink`,
       `recordAgentStartedSession`) is guarded so that ANY input (`undefined`,
       `null`, a non-object, missing fields) ends in one `[SessionOrganization] …
dropped` line and returns.
     - One spec table drives all five methods with `undefined`, `null` and `{}`,
       and asserts no throw, no store call and one log line each.
  3. **Minor 3, cheap.** `parentSessionId` and `forkOfSessionId` in `recordLineage`
     (`:221-222`) and `recordAgentStartedSession` (`:332`) use
     `invalidOptionalText`, which accepts multi-line or over-256-character ids. Add
     `invalidOptionalId`, which delegates to `invalidId` when defined, and add one
     spec case.

  Recorded, not fixed:
  - **R-TL12 (Moderate): accepted residual.** The reviewer showed that
    scenario (a), `recordWorktree` then `linkTask`, commutes (different columns
    and tables). Scenarios (b), a capture finishing after a delete, and (c), a
    capture racing a rekey, can leave an orphan row under a deleted or rekeyed
    id. The plan's failure table (`implementation-plan.md:1233`) and D4 (`:135`)
    already accept orphans, because `session:list` joins from metadata. No task.
    T1's write-path trace checks that orphans never surface.
  - **Nit 4: accepted.** A no-op `setOrganization` still emits a change. This
    follows the plan's "emit after every committed write" rule (`:462-463`).

  After the fix: run the scoped check (`NX_ISOLATE_PLUGINS=false` if Nx plugin
  workers time out). Then do a narrow antigravity re-check of items 1-3, writing
  `code-logic-review-A3.2-r1.md`. A3.3 and B2 stay blocked until A3.2 is committed.

- Round 1 fixes verified (2026-10-01):
  - `guarded()` wraps all five recorder methods (`session-organization.service.ts:604-614`);
  - `parsePrUrl(raw: unknown)` (`pr-url.ts:45-46`);
  - `invalidOptionalId` (`:788-790`);
  - 141 tests (115 before); scoped check green.

  Narrow re-check lane: antigravity `9ee81d34-…`, resuming review session `624d7e10-…`.

- **Decision (recorded):** the mutation methods (`setOrganization`, `linkSessionTask`,
  `unlinkSessionTask`, `addSessionPrLink`, `removeSessionPrLink`) still read
  `params.sessionId` directly, so a `null` params object throws `TypeError`. Accepted:
  - their only callers are the A4.2 RPC handlers, which Zod-parse params first and
    sanitize any thrown error;
  - unlike the recorder methods, no unshielded hook calls them.

  → A4.2 must Zod-parse before every service call, never pass raw params, and keep
  one spec that sends `null` params and gets `INVALID_PARAMS`.

### Task A3.2.1: `SessionOrganizationService` implementing the recorder port, plus `SESSION_ORGANIZATION_TOKENS` — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization.service.ts` (CREATE)
  - `...\session-organization.service.spec.ts` (CREATE)
  - `...\src\lib\di\tokens.ts` (CREATE)
  - `...\src\index.ts` (MODIFY)
- Plan reference: implementation-plan.md:451-467, :512-518, D3 :134, L8, L9
- Pattern to follow: `IOutputChannel` logging `agent-sdk/src/lib/harness/harness-policy-sync.ts:44,55-56` with the `[SessionOrganization]` prefix
- Quality requirements:
  - `isAvailable()` = store ready.
  - `resolveRoot` uses metadata `workspaceId` first, then the hint.
  - When no metadata exists, the write is dropped and logged. Never write under a tab
    id, and never "repair" the drop with the hint alone (plan :743-750).
  - Mutations validate with the shared tuples and return the discriminated result.
  - `onDidChange` fires after every committed write.
  - Recorder methods never throw.
  - Unavailable means a no-op plus a log line (L8).
  - A `db` getter throw is caught.
  - `queryWorkspace(root)`.
  - `Symbol.for` tokens with identifier == key.
- Validation notes (two Minor notes from `code-logic-review-A2.2.md`):
  - Tab-id guard. The port forbids tab ids, but nothing enforces that at
    runtime. The service is the enforcement point: every recorder method
    resolves the session through `SessionMetadataStore` first, and a
    `sessionId` with no metadata (a tab id, or a session not yet bound) is
    dropped with one `[SessionOrganization]` line before any store call. The
    spec passes a tab-id-shaped id to EACH of the five recorder methods and
    asserts that no store call is made.
  - Root normalization. Every workspace root that reaches the store goes
    through `normalizeWorkspaceRoot`. That covers the metadata `workspaceId`,
    every `workspaceRootHint`, and the required `workspaceRoot` of
    `recordAgentStartedSession`. The spec covers a trailing-separator /
    mixed-case-drive variant of the same root and asserts that the store
    receives one normalized key.
- Carried from `code-logic-review-A3.1.md` F4 (Nit): `addPrLink` refreshes `number`,
  `repo` and `state` only when the new value is known (the store's COALESCE), so a
  known PR field can never be set back to null. Document this on the service's
  `addPrLink` (JSDoc), and make sure no caller relies on clearing `state` through a
  re-add. Clearing means remove plus add.
- Validation notes: the spec uses a fake store and a fake metadata store and covers:
  - root resolution order;
  - validation;
  - the unavailable path;
  - change events;
  - the tab-id drop.
- Implementation details: inject `SDK_TOKENS.SDK_SESSION_METADATA_STORE` and
  `PLATFORM_TOKENS.OUTPUT_CHANNEL`.

### Task A3.2.2: `utils/pr-url.ts` URL parser — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\utils\pr-url.ts` (CREATE), `...\pr-url.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:458-461, L14
- Pattern to follow: pure util, table spec
- Quality requirements:
  - `https:` only, ≤ 2048 chars.
  - GitHub `owner/repo` and `number` are parsed when the URL matches; otherwise both are
    null.
- Validation notes:
  - B2 adds `extractGhPrCreateUrl` to this file later.
  - From `code-logic-review-A2.1.md` (the advisory note on the binary-collation
    `url` PK): a URL that is a GitHub PR is canonicalised to
    `https://github.com/<owner>/<repo>/pull/<n>`. That means a lowercase host,
    and no trailing slash, sub-path (`/files`), query or fragment. The
    canonical form is the value the service hands the store, so the same PR
    cannot be stored twice. Any other `https:` URL is stored trimmed and
    otherwise unchanged (L14 allows any host). The table spec covers the
    trailing-slash, `/files`, query and upper-case-host variants mapping to
    one canonical URL.
- Implementation details: pure function, no I/O.

## Batch A3.3: capture service — delete cascade and rekey — COMPLETE (commit b6ac36321)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: the subscriptions and their reachability specs; one lib.
- Tasks: 1 | Depends on: A3.2, A2.3
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`
- Review: code-logic lane → `code-logic-review-A3.3.md`
- Implemented (2026-10-01): capture service + spec (12 tests); 153 tests in the lib.
  Deviations accepted:
  1. a `deleted` event with an empty `workspaceId` is dropped with one log line
     (tested);
  2. three narrow `Pick<>` dependency types are exported;
  3. `index.ts` is not edited; the registration and barrel work moves to A3.4.
- Review outcome: APPROVED 9/10 (`62ac9d5c-…`, `code-logic-review-A3.3.md`). It
  confirms that every delete path emits `'deleted'`, including the importer prune
  (`session-importer.service.ts:330-360`). Its 1 Minor and 2 Nits go to Task B2.3,
  because B2 edits the same two files. None is harmful today:
  - no rows can exist under a blank root, since writes pass `nonBlank` in
    `resolveRoot`;
  - a blank old id makes `rekeySession` a no-op.
- From A3.2 (deviation 3): the cascade calls `SessionOrganizationService.removeSession`
  and the rekey calls `SessionOrganizationService.rekeySession`. These are already
  implemented (commit 7f6372a40); do not edit the service. Specs must flush detached
  work (`await new Promise((r) => setImmediate(r))`, the A3.2 spec's `flush`) before
  asserting. R-TL12 was accepted as a residual by the A3.2 review (orphan rows are
  harmless), so no ordering spec is required here.

### Task A3.3.1: `SessionOrganizationCaptureService` with a `metadataChanged: deleted` cascade and a `SessionIdResolved` rekey — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization-capture.service.ts` (CREATE), `...\session-organization-capture.service.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:468-485, D7 :138, :531-539
- Pattern to follow: `memory-curator/src/lib/triggers/memory-trigger.service.ts:152-153,172-230`
- Quality requirements:
  - `start()` and `dispose()` are sync and idempotent.
  - Host-wide subscriptions only.
  - The rekey runs only when `previousSessionId` is set and differs.
  - An unavailable store means the event is dropped and logged.
  - The PR subscription is NOT here (B2 adds it).
- Validation notes: AC6 and AC8. The spec uses:
  - a REAL `SessionMetadataStore` over fake storage: `delete()` removes the rows;
  - the REAL `SessionIdResolvedCallbackRegistry`: `notifyAll` with a
    `previousSessionId` calls `rekeySession(A, B)`, and a payload without it calls
    nothing.
- Implementation details: subscribe via `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` (`agent-sdk/src/lib/di/tokens.ts:145-147`).

## Batch A3.4: DI register + start — COMPLETE (commit fae183675)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: registration is side-effect free and the start helper never throws; one lib.
- Tasks: 1 | Depends on: A3.3
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`
- Review: code-logic lane → `code-logic-review-A3.4.md`
- From A3.2 (deviation 4): register `SessionOrganizationStore` under
  `SESSION_ORGANIZATION_TOKENS.STORE`; the service injects it by that token.
- From A3.3 (2026-10-01; `index.ts` was deliberately NOT edited there):
  - register `SessionOrganizationService` as a singleton under
    `SESSION_ORGANIZATION_TOKENS.SERVICE`;
  - bind `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` with `useToken` to that same
    SERVICE token (one instance, not two);
  - register `SessionOrganizationCaptureService` as a singleton;
    `startSessionOrganization` resolves it and calls `start()`;
  - export from `src/index.ts`: `registerSessionOrganizationServices`,
    `startSessionOrganization` and `SessionOrganizationCaptureService` (plus its three
    `Pick<>` dependency types if the register spec needs them);
  - the capture service injects `SDK_TOKENS.SDK_SESSION_METADATA_STORE`,
    `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` and
    `PLATFORM_TOKENS.OUTPUT_CHANNEL`. The register spec must provide them (they are
    registered by the SDK and platform before this lib in both hosts);
  - the register spec asserts that SERVICE and the recorder token resolve to the
    SAME instance.
- Review outcome: APPROVED 9/10 (`993cdff6-…`, `code-logic-review-A3.4.md`). Three nits
  are accepted with no revise round. They are open for the next session: fold them into
  the next batch that edits `src/lib/di/` (none is planned; B2 could take them as a
  Task B2.4 if it stays within the cap), or file a follow-up:
  1. `register.ts:42-45`: the `SessionOrganizationService` class itself is not aliased
     to `SERVICE`, so `container.resolve(SessionOrganizationService)` would build a
     second instance. Nothing resolves it by class today; an alias (`useToken: SERVICE`)
     would make that impossible.
  2. `start.ts:41`: the "not registered (no SQLite connection)" log text assumes the
     cause; registration may also have been skipped for another reason.
  3. `start.ts:48`: the returned disposable's `dispose()` has no error boundary, so a
     throwing `capture.dispose()` would escape into host shutdown.
- Committed through the real hooks as fae183675, after A3.4b's executor finished.
  Earlier note: the hooks were installed in this worktree by A3.4b's
  step 0. A3.4 is committed through the real hooks once A3.4b's executor has stopped
  editing the tree. lint-staged hides unstaged changes during pre-commit, so a commit
  while an executor edits the same tree would disturb it.

### Task A3.4.1: `registerSessionOrganizationServices` + `startSessionOrganization` — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\di\register.ts` (CREATE)
  - `...\di\register.spec.ts` (CREATE)
  - `...\di\start.ts` (CREATE)
  - `...\di\start.spec.ts` (CREATE)
  - `...\src\index.ts` (MODIFY)
- Plan reference: implementation-plan.md:486-496, :540-541
- Pattern to follow: `task-specs/src/lib/di/register.ts:73-86`; `task-specs/src/lib/di/start-index.ts:13-17,81-133`
- Quality requirements:
  - Bind only when `isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION)`.
  - Store, service and capture service are singletons; plus `SESSION_ORGANIZATION_TOKENS.SERVICE`.
  - `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` binds to the service via `useToken`.
  - Registration has no side effects.
  - `start` swallows every failure into one `IOutputChannel` line and returns
    `IDisposable`.
- Validation notes: the register spec checks that nothing is bound without the
  connection, and that the port and service are bound with it.
- Implementation details: see plan.

## Batch A3.4b: branch hook-clean (degradation-audit markers, commitlint scope, prettier) — COMPLETE (commit efa997ca5)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: devops-engineer (sub-agent)
- Execution mode: sequential
- Rationale: found on 2026-10-01, before the push. This worktree never had husky
  installed: `core.hooksPath` is `.husky/_` and that directory does not exist, because
  `node_modules` is a junction to the main checkout. So git ran no hooks on any commit
  of this branch: no lint-staged (prettier and affected lint), no commitlint, and no
  pre-push di-lint. Three hook-enforced checks now fail on the branch, and this batch
  makes them pass.
  - It goes over the 6-file cap deliberately: 10 of its files are a whitespace-only
    prettier pass.
  - One rollback unit: "make the branch pass its own hooks".
- Tasks: 3 | Depends on: none. It is file-disjoint from A3.4 (which owns `di/*` and
  `src/index.ts`), so it can run while A3.4 is in review.
- Verification, one command per check, all must exit 0:
  - `npx nx run degradation-audit:lint --skip-nx-cache`, which must report
    `libs/backend/session-organization: 0` and `libs/backend/vscode-lm-tools: 2 ok`;
  - `npx commitlint --from a90c086d7 --to HEAD`, run by the team-leader after the commit;
  - `npx prettier --check $(git diff --name-only a90c086d7 -- '*.ts' '*.json')`;
  - `NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime @ptah-extension/persistence-sqlite`.
- Review: antigravity code-logic lane → `code-logic-review-A3.4b.md`. The lane judges
  each marker: does a marker hide a real defect? It also confirms that the 10
  formatted files differ only in whitespace (`git diff -w` is empty).
- The baseline is NOT raised. `tools/degradation-audit/check-degradation.ts` says a
  directory's count may only go down or stay flat. The repository's way to accept a
  justified site is a marker:
  `// degradation-audit: <optional-capability|reported> - <reason>`.

### Task A3.4b.1: degradation-audit markers on the three new sites — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization.service.ts` (MODIFY, `:180-187`)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\utils\pr-url.ts` (MODIFY, `:50-56`)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY, `:1031-1040`)
- Pattern to follow: the marker in `libs/backend/session-organization/src/lib/di/start.ts`
  (A3.4), and the marker rules in the header of
  `tools/degradation-audit/check-degradation.ts`: the kind is `optional-capability` or
  `reported`, the separator is a hyphen or a dash, and a reason is required. The marker
  sits in the comment run directly above the `catch`, or as the first lines inside it.
- Quality requirements: no behaviour change. Team-leader rulings, none of which hides a
  defect:
  1. `isAvailable()` (`service.ts:184`), kind `optional-capability`. A readiness check
     that throws means the store is unusable. Every caller treats `false` as
     "organization unavailable" (lane L8), and the error is already logged through
     `IOutputChannel`.
  2. `parsePrUrl` (`pr-url.ts:53`), kind `reported`. A malformed URL is a validation
     result, not a lost failure: `null` is the function's documented answer, and every
     caller turns it into a logged drop (recorder) or a
     `SessionOrganizationInputError` (mutation). Alternative, only if the lib's TS
     target types it: replace the try/catch with `URL.canParse(trimmed)`, which removes
     the site instead of marking it. State which was chosen.
  3. `resolveCallerSdkSessionId()` (`ptah-api-builder.service.ts:1035`), kind
     `reported`. The error is debug-logged, and `undefined` becomes an explicit
     `unattributed-caller` result for the agent (B3.3/B3.4).
- Validation notes: after the change the audit shows `session-organization: 0` and
  `vscode-lm-tools: 2 ok`. The pre-existing `analysis-namespace.builders.ts:638,650`
  sites are the baseline 2 and stay untouched.

### Task A3.4b.2: commitlint scope for the new lib — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\.commitlintrc.json` (MODIFY)
- Pattern to follow: commit `466925a34`, which added a new lib's scope in the lib's
  own batch.
- Quality requirements: add `"session-organization"` to `rules.scope-enum[2]`, next to
  `"task-specs"`.
- Validation notes: commits `2789094b7` (A3.1), `7f6372a40` (A3.2) and `b6ac36321`
  (A3.3) use the `session-organization` scope and currently fail commitlint. With the
  scope added they pass, and no history is rewritten.

### Task A3.4b.3: prettier pass on the branch's unformatted files — COMPLETE

- File (all MODIFY, run `npx prettier --write` on exactly these and nothing else), under
  `D:\projects\ptah-extension\.claude-worktrees\task-580\`:
  - `libs\backend\agent-sdk\src\lib\helpers\worktree-hook-handler.spec.ts`
  - `libs\backend\agent-sdk\src\lib\sdk-agent-adapter.spec.ts`
  - `libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
  - `libs\backend\cli-agent-runtime\src\lib\wiring\agent-events.spec.ts` (also unformatted at base)
  - `libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.spec.ts`
  - `libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.ts` (also unformatted at base)
  - `libs\backend\persistence-sqlite\src\lib\migrations\0050_session_organization.spec.ts`
  - `libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts`
  - `libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\session-organization-namespace.builder.spec.ts`
  - `libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts` (also unformatted at base)
- Quality requirements: a whitespace-only diff (`git diff -w -- <these files>` is
  empty), and all ten pass `prettier --check`.
- Validation notes: `sdk-agent-adapter.ts` and its spec are 584 merge points (R-TL6).
  A formatting-only change there is safe to rebase.

## Batch A4.1: `session:list` query extension + AC1 perf spec — COMPLETE (commit eb67d86f3)

- Result: A4.1.1 and A4.1.2 landed; 9 files.
- File-list addition: `apps/ptah-electron/tsconfig.build.json`,
  `apps/ptah-cli/tsconfig.build.json` and `apps/ptah-tui/tsconfig.build.json` each gain
  the `@ptah-extension/session-organization` path. rpc-handlers now imports the lib, and
  without the path the Electron production build (the `ptah-electron:validate-deps`
  pre-commit gate) could not resolve it. The CLI and TUI builds needed the same path.
- Review: `code-logic-review-A4.1.md` APPROVED 9.5/10 with 3 minor nits; the review
  approves all 6 executor deviations.
- Verification at commit:
  - rpc-handlers typecheck and lint pass. Tests: 115 of 116 suites pass (3439 passed,
    4 skipped, 1 failed). The one failure is the known pre-existing
    `harness-skill-selection-rpc.service.spec.ts` "never writes state.json"; the
    harness folder is untouched since `a90c086d7`.
  - di-lint passes; degradation-audit rpc-handlers 1 (baseline 1); prettier clean.
- Follow-up (review finding 1): with `groupBy: 'parent'`, groups are ordered by parent
  `sessionId` (`session-list-query.ts:147-154`), not by the sort key. C1.2, the sidebar
  consumer, decides whether groups must be ordered by the parent's sort key; if so, C1.2
  owns that change.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: pure query helper, handler change and perf proof, all in one lib.
- Tasks: 2 | Depends on: A3.4, A1.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers`
- Review: code-logic lane → `code-logic-review-A4.1.md`
- From A3.2 (deviation 4): use the service's `queryWorkspace`, `countChildren`,
  `listTaskLinks` and `toSessionOrganizationSummary`; do not reach into the store.

### Task A4.1.1: `applySessionListQuery` (pure), with query mode — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-list-query.ts` (CREATE), `...\session-list-query.spec.ts` (CREATE), `...\session-organization-rpc.schema.ts` (CREATE: the `session:list` param schema now; A4.2 appends the mutation schemas)
- Plan reference: implementation-plan.md:559-585, L3, L4, L5
- Pattern to follow: `libs/shared/src/lib/types/task-filter.ts:542-548` (tuple-index sort); Zod schema file `tasks-rpc.handlers.ts:1-33`
- Quality requirements:
  - Query mode = any new param.
  - Without query mode, nothing is filtered or re-sorted.
  - In query mode: archived is excluded unless listed, pinned sorts first (only when the
    map exists), then the group key, then the sort key, with ties broken by
    `lastActiveAt` descending.
- Validation notes: spec cases at plan :648-654:
  - no params keeps archived and pinned rows in today's position, and `total` counts
    them;
  - a single `sort` param excludes archived and puts pinned first;
  - `status: ['archived']` returns only archived rows.
- Implementation details: pure function over rows plus the org map.

### Task A4.1.2: `SessionRpcHandlers.session:list` enrichment + AC1 perf spec — COMPLETE

- Depends on: Task A4.1.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts` (MODIFY), `...\session-rpc.handlers.spec.ts` (MODIFY), `...\session-list.perf.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:586-599, :645-676
- Pattern to follow: `session-rpc.handlers.ts:333-422`, `:142-143` (turn-state registry already injected)
- Quality requirements:
  - Optional injections `SESSION_ORGANIZATION_TOKENS.SERVICE` and
    `TASK_SPECS_TOKENS.TASK_INDEX_SERVICE`.
  - New params are Zod-validated; a failure is `INVALID_PARAMS`.
  - `organizationAvailable` is always set.
  - Enrich the page only:
    - `organization`;
    - `missing` per task (one `taskIndex.list(root)`, and only when a page row has
      links);
    - `childCount`;
    - `livePhase`.
  - A warn line when the call takes more than 200 ms (L13).
  - Do not fix `messageCount` or `isActive` (Follow-up).
- Validation notes:
  - Handler specs:
    - the VS Code shape (no service) keeps rows unchanged and the flag false;
    - the Electron shape is enriched;
    - the missing-task flag.
  - AC1 perf spec:
    - real store, temp SQLite with 0050 applied;
    - 500 sessions, 250 task links, 100 PR links; the seed includes archived rows;
    - 20 runs with
      `{status:['active','waiting'], priority:['urgent','high'], sort:'priority'}`;
    - asserts p95 < 200 ms and the correct `total`;
    - FAILS (not skips) when no opener loads.
- Implementation details: see plan data flow :1166-1174.

## Batch A4.2: `SessionOrganizationRpcHandlers` + manifest + RPC registry entries — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: registry entries and their manifest owner must land in one commit (R-TL1).
- Tasks: 3 | Depends on: A4.1, A1.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/cli-engine ptah-electron ptah-extension-vscode`
  (this covers the three rpc-surface specs and the boot invariant; if the app suites
  are too slow, run them with `--testPathPattern=rpc-surface|container.smoke` and say so
  in the report)
- Review: code-logic lane → `code-logic-review-A4.2.md`
- From A3.2:
  - Zod-parse params BEFORE every service mutation call; a `null`/non-object params
    object must yield `RpcUserError('INVALID_PARAMS')`, with a spec (A3.2 round 1
    decision);
  - call `setOrganization`, `linkSessionTask`, `unlinkSessionTask`,
    `addSessionPrLink` and `removeSessionPrLink` (deviation 1);
  - map `SessionOrganizationInputError` to `RpcUserError('INVALID_PARAMS')`, and
    sanitize any other thrown error (deviation 2);
  - replace each task's `missing: false` in a mutation result with the real value
    from one `taskIndex.list(root)` read (deviation 5).
- Merge note: `rpc.types.ts` is a 584 merge point (R-TL7).

### Task A4.2.1: `SessionOrganizationRpcHandlers` (six methods, optional service, conditional subscription) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\handlers\session-organization-rpc.handlers.ts` (CREATE), `...\session-organization-rpc.handlers.spec.ts` (CREATE), `...\session-organization-rpc.schema.ts` (MODIFY: append the mutation schemas)
- Plan reference: implementation-plan.md:600-633, :655-665, D5, D14
- Pattern to follow: `tasks-rpc.handlers.ts:284-308,1473-1515`; `authorizeSessionAccess` semantics `session-rpc.handlers.ts:281-294`
- Quality requirements:
  - The service, task index and webview manager are all `{ isOptional: true }`.
  - Subscribe to `onDidChange` only when the service is present.
  - Broadcast `SESSION_ORGANIZATION_CHANGED`; a broadcast failure is logged, never
    thrown.
  - `linkTask.source` is only `'user' | 'board-start'`.
  - A `taskId` must match the task-id regex.
  - `url` ≤ 2048 chars.
  - `setOrganization` requires at least one field.
  - An SQL error returns a sanitized error and logs the raw one.
- Validation notes:
  - Construct the handler in a child container with NO service: construction succeeds,
    no subscription is made, and every method returns `organization-unavailable`.
  - With the service: exactly one subscription.
  - Also cover not-found, validation and broadcast.
- Implementation details: `session:listForTasks` groups links by task with name,
  `livePhase` and PR links.

### Task A4.2.2: manifest entry + barrels — PENDING

- Depends on: Task A4.2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\rpc-handlers\src\lib\host-profile\manifest.ts` (MODIFY), `...\rpc-handlers\src\lib\handlers\index.ts` (MODIFY, beside `:78`), `...\rpc-handlers\src\index.ts` (MODIFY, beside `:54`)
- Plan reference: implementation-plan.md:631-633
- Pattern to follow: `manifest.ts:87-99,289-294`
- Quality requirements: `{ key: 'sessionOrganization', methods: SessionOrganizationRpcHandlers.METHODS, requires: [], handler: SessionOrganizationRpcHandlers }`.
- Validation notes: R-TL1. `assertManifestInvariants` must pass.
- Implementation details: none beyond the entry.

### Task A4.2.3: RPC registry + `RPC_METHOD_ENTRIES` for the six methods (moved from A1, R-TL1) — PENDING

- Depends on: Task A4.2.2 (same commit)
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\rpc.types.ts` (MODIFY)
- Plan reference: implementation-plan.md:279
- Pattern to follow: `rpc.types.ts:692,709-743,3564-3582`
- Quality requirements: six registry entries and six entry keys, with the A1.1 param and
  result types.
- Validation notes: the VS Code rpc-surface partition stays green because the family is
  `requires: []`, so the expected-absent list is unchanged.
- Implementation details: none beyond the entries.

## Batch A5.1: Electron + CLI host wiring — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: two composition roots with the same two call lines.
- Tasks: 1 | Depends on: A4.2 (R-TL4), A3.4
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-electron @ptah-extension/cli-engine`
- Review: code-logic lane → `code-logic-review-A5.1.md`

### Task A5.1.1: register + start after `startTaskSpecsIndex`; Electron smoke assertion — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\apps\ptah-electron\src\di\phase-2-libraries.ts` (MODIFY, after `:393`), `...\apps\ptah-electron\src\di\container.smoke.spec.ts` (MODIFY), `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\cli-engine\src\lib\thoth\register-thoth-libraries.ts` (MODIFY, after `:150`)
- Plan reference: implementation-plan.md:869-895
- Pattern to follow: the adjacent `registerTaskSpecsServices` / `startTaskSpecsIndex` calls
- Quality requirements: `start` never aborts activation. If SQLite registration was
  skipped (`register-thoth-libraries.ts:122-126`), nothing is bound.
- Validation notes: the smoke spec asserts that the recorder token and
  `SessionOrganizationRpcHandlers` resolve.
- Implementation details: two lines per host.

## Batch A5.2: VS Code unavailable proof — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: one app, spec only. File-disjoint from A5.1, so the two can run in parallel.
- Tasks: 1 | Depends on: A4.2
- Verification: `npx nx run-many -t typecheck,test,lint -p ptah-extension-vscode`
- Review: code-logic lane → `code-logic-review-A5.2.md`

### Task A5.2.1: `session-organization-unavailable.spec.ts` (+ `expected-resolvable.ts` if the smoke spec iterates it) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\apps\ptah-extension-vscode\src\di\session-organization-unavailable.spec.ts` (CREATE), `...\apps\ptah-extension-vscode\src\di\expected-resolvable.ts` (MODIFY, only if needed: R-TL10)
- Plan reference: implementation-plan.md:886-890, D5
- Pattern to follow: `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:190-240`
- Quality requirements: `SessionOrganizationRpcHandlers` resolves in VS Code, and
  `session:setOrganization` returns `organization-unavailable`. No change to
  `phase-2-libraries.ts` or `expected-absent.ts`.
- Validation notes: AC7 (narrowed).
- Implementation details: spec only.

## Batch B1: SDK worktree hook + fork lineage capture — COMPLETE (commit 3961f4322)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: two producers in one lib, each with a reachability spec.
- Tasks: 2 | Depends on: A2.2, A2.3 (same lib; sequential)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/agent-sdk`
- Review: code-logic lane → `code-logic-review-B1.md`
- Review attempt 1 FAILED on a provider quota, not on content. The Glm lane
  `7ae5213e-5bf0-4145-89b2-9d3d9d0569cb` (2026-10-01) ended `no-deliverable` with
  `API Error: Request rejected (429) · session usage limit reached` (Ollama Cloud),
  so no verdict exists yet. Re-queued as a fresh antigravity lane with the same
  task, after B3.3's lane and the A3.1 F1-F3 re-check. From this point on, lanes
  run on antigravity only, one at a time; Glm is unavailable until further notice.
- Review attempt 2: APPROVED 9.5/10 (antigravity `e27f0a88-…`, `code-logic-review-B1.md`).
  - R-TL11: the reviewer found no early resolve in Electron or the CLI. The A5.1
    smoke spec pins the order.
  - F1 (Minor), kept as decided: the recorder calls at
    `worktree-hook-handler.ts:240-245` and `session-fork.service.ts:149-153` are not
    wrapped in try/catch. The plan's port contract is "methods never throw", and the
    enforcement point is the adapter, `SessionOrganizationService` (A3.2), whose
    recorder methods catch every error and log it.
  - Contrast with B3.2/B3.3: `PtahAPIBuilder` wraps its recorder call because it sits
    behind an MCP tool result.
  - If an adapter ever broke the contract here, the hook would skip the created
    callback and the fork would reject after the fork and its metadata already
    exist. The A3.2 review must therefore confirm that no recorder method can throw.

### Task B1.1: `WorktreeHookHandler` records the worktree; callback data gains `worktreePath` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\agent-sdk\src\lib\helpers\worktree-hook-handler.ts` (MODIFY), `...\worktree-hook-handler.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:688-720, D8
- Pattern to follow: optional injection `vscode-lm-tools/.../ptah-api-builder.service.ts:423-424`
- Quality requirements:
  - `@inject(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, { isOptional: true })`.
  - Record after a successful `addWorktree`, inside the existing try, before the
    callback.
  - The hook's return value is unchanged.
  - Keep the existing Logger.
  - Add `worktreePath` to the agent-sdk twin type (`:50-55`).
- Validation notes: AC8. The spec drives `createHooks(cb).WorktreeCreate[0].hooks[0]`:
  success records the SDK id, path and branch; a failed `addWorktree` records nothing.
- Implementation details: see plan :694-697.

### Task B1.2: `SessionForkService` records fork lineage — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\agent-sdk\src\lib\helpers\session-fork.service.ts` (MODIFY), `...\session-fork.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:698-700
- Pattern to follow: same as B1.1
- Quality requirements: the fork result is unchanged.
- Validation notes: AC8. After `forkSession`, `recordLineage` is called with the new id
  and the source id.
- Implementation details: call after `metadataStore.create(...)` (`:131-136`).

## Batch B2: PR capture subscriber — COMPLETE (commit a98c1dd2c)

- Result: B2.1-B2.3 plus the optional B2.4 (the three A3.4 nits in `di/register.ts`
  and `di/start.ts`) landed; 8 files, all in session-organization.
- Review: `code-logic-review-B2.md` APPROVED 9.5/10 with 3 minors (`--draft=false`
  parsing, `releaseAll` disposer isolation, null payload guard). The executor fixed
  all three; the narrow re-check `code-logic-review-B2-r1.md` APPROVED 10/10.
  Accepted deviation: `gh pr create -d` (short flag) is captured as `open`.
- Verification at commit: session-organization typecheck/test (6 suites, 204
  tests)/lint pass; degradation-audit session-organization 0 (baseline 0); di-lint
  passes; prettier clean.
- The first commit attempt failed the pre-commit electron build, because the
  uncommitted A4.1 import of `@ptah-extension/session-organization` had no path in
  `apps/ptah-electron/tsconfig.build.json`. The A4.1 executor added that path to the
  electron, cli and tui `tsconfig.build.json` files (they belong to A4.1); the retry passed.
- Follow-ups:
  - `SessionOrganizationPostToolUseSource` is not exported from
    `libs/backend/session-organization/src/index.ts`. The next batch that owns
    `index.ts` should export it.
  - A5.1 must confirm that the PostToolUse registry
    (`libs/backend/agent-sdk/src/lib/di/register.ts:225`,
    `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY`) is registered on each host. If it
    is not, capture start fails and is reported as non-fatal, and no PR is captured.

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: it extends two A3 files; one lib.
- Tasks: 3 | Depends on: A3.4
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/session-organization`
- Review: code-logic lane → `code-logic-review-B2.md`
- From A3.2 (deviation 6): `extractGhPrCreateUrl` returns the URL and the service's
  `parsePrUrl` canonicalizes it. Do not write a second canonicalizer. The
  reachability spec flushes detached capture work before asserting.

### Task B2.1: `extractGhPrCreateUrl` (pure) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\utils\pr-url.ts` (MODIFY), `...\pr-url.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:726-732, D10, L7
- Pattern to follow: the A3.2.2 table spec
- Quality requirements:
  - Requires `Bash`, a command containing `gh pr create`, and `success`.
  - Takes the first GitHub PR URL in the string or stringified output.
  - `state` is `draft` when the command has `--draft`, else `open`.
- Validation notes: table cases:
  - string output;
  - object output;
  - `--draft`;
  - failed exit;
  - non-Bash tool;
  - `gh pr view` output;
  - multiple URLs.
- Implementation details: pure function.

### Task B2.2: capture service subscribes to PostToolUse; reachability + tab-id drop specs — COMPLETE

- Depends on: Task B2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization-capture.service.ts` (MODIFY), `...\session-organization-capture.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:733-770
- Pattern to follow: `post-tool-use-callback-registry.ts:8-26`; `callback-registry.base.ts:22-45`
- Quality requirements:
  - `source: 'agent'`.
  - The id is passed through unchanged.
  - Errors are caught locally.
  - The disposer is released in `dispose()`.
- Validation notes: AC3 and AC8. With the REAL `PostToolUseCallbackRegistry` and the
  REAL `PostToolUseHookHandler`, after `startSessionOrganization`:
  - a `gh pr create` input calls `addPrLink` with the session id and `source: 'agent'`;
  - an input without `session_id` (so the tab id is used) makes NO store call and logs
    one drop line.
- Implementation details: token `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` (`agent-sdk/src/lib/di/tokens.ts:102`).

### Task B2.3: capture-service hardening (carried from `code-logic-review-A3.3.md`) — COMPLETE

- Depends on: Task B2.2 (same two files)
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\session-organization\src\lib\session-organization-capture.service.ts` (MODIFY), `...\session-organization-capture.service.spec.ts` (MODIFY)
- Quality requirements:
  - **Minor:** a whitespace-only `workspaceId` on a `'deleted'` event is treated as
    empty: it is dropped with the same log line, not passed to `removeSession`.
  - **Nit:** a whitespace-only `previousSessionId` is treated as absent (no rekey).
  - **Nit, plus the leak the A3.4 executor reported:** `start()` sets
    `started = true` before it subscribes. If the SECOND `register` throws, the first
    subscription has already been made, is never kept in `disposers`, and leaks.
    `dispose()` cannot release it, and `started` stays true. Fix:
    - subscribe one by one, pushing each disposer as soon as it is obtained;
    - on a throw, release the disposers already obtained, leave `started = false`,
      and rethrow (or log; `startSessionOrganization` already catches and logs);
    - set `started = true` only after every subscription succeeded.

    Spec: a second subscription that throws leaves zero live subscriptions (the
    first disposer was called), and a later `start()` subscribes again.
- Validation notes: one spec case for each.
- Implementation details: no other behaviour change.

## Batch B3.1: runtime capture in cli-agent-runtime — COMPLETE (commit 8f16da0ed)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: two wiring files in one lib.
- Tasks: 2 | Depends on: A1.2, A2.2, B1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/cli-agent-runtime`
- Review: code-logic lane → `code-logic-review-B3.1.md`
- Implemented (2026-10-01). Review lane: antigravity `29aa5567-…`.
  - **Assumption A2 ruling (recorded).**
    - `agent-rpc.handlers.ts:971` (`resumePtahCliSession`) has a `parentSessionId`
      in scope, but it can be a tab id. The same path already reaches
      `persistCliSessionReference` through `spawnFromSdkHandle` (`:981-989`), where
      lineage is recorded only after `addCliSession` has accepted a real parent.
    - So no extra `recordLineage` is added at `:971`: a second call would duplicate
      the record and could record a tab id.
    - `chat-stream-broadcaster.service.ts:211` has no parent id, so A2 holds there.
    - No follow-up batch is needed.
  - **Repeat lineage writes.** `recordLineage` can run several times per child
    (spawn, exit, re-persist). The store write is an idempotent upsert:
    `applyPatch` = `ensureOrganization` (`INSERT … ON CONFLICT DO UPDATE`) plus
    per-column `UPDATE`s with the same values. A repeat changes only `updated_at`
    and emits one change; the frontend debounces those (250 ms). Not a defect.
  - **Deviations accepted.**
    - The wiring uses its injected `Logger`, not `IOutputChannel`, consistent with
      D15 (modified existing code keeps its logger).
    - `recordChildLineage` resolves the recorder lazily from the container, so
      R-TL11 does not apply to this path.
  - **Review: APPROVED 9.5/10** (`code-logic-review-B3.1.md`). It confirms the A2
    ruling and that repeat lineage writes are idempotent. Three nits are accepted
    as-is, with no revise round:
    1. a whitespace-only `worktreePath` is not trimmed before the fallback
       (`sdk-callbacks.ts:356`); the hook never reports one;
    2. no spec covers the `worktreePath: ""` fallback (the `||` fallback is
       visible in the code);
    3. the recorder is looked up from the container on every event. This is
       deliberate, because it is what keeps this path out of R-TL11.

### Task B3.1.1: `wireWorktreeCallbacks` sends `sessionId` and prefers `data.worktreePath` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\cli-agent-runtime\src\lib\wiring\sdk-callbacks.ts` (MODIFY), `...\sdk-callbacks.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:779-783
- Pattern to follow: `sdk-callbacks.ts:338-376`
- Quality requirements: use `data.worktreePath` when present, before
  `resolveWorktreePath`. The broadcast carries `sessionId`.
- Validation notes: the spec asserts `sessionId` in the broadcast.
- Implementation details: the local `WorktreeCreatedData` interface (`:31-36`) may need
  the optional field.

### Task B3.1.2: `persistCliSessionReference` records child lineage after `addCliSession` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\cli-agent-runtime\src\lib\wiring\agent-events.ts` (MODIFY), `...\agent-events.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:784-789, D13, Assumption A2 :202-205
- Pattern to follow: the `isRegistered` guard at `agent-events.ts:333-341`
- Quality requirements: record only after `addCliSession` succeeds, when `sdkSessionId`
  is set and differs from the parent.
- Validation notes:
  - Spec: a resolved add means `recordLineage` is called with the parent and
    `startedBy: 'agent'`; a "Parent session not found" rejection means no call.
  - Assumption A2: read `rpc-handlers/.../agent-rpc.handlers.ts:971` and
    `chat-stream-broadcaster.service.ts:211`, and report whether either has a real
    parent id. Do NOT edit them.
- Implementation details: see plan.

## Batch B3.2: MCP worktree capture via the git namespace — COMPLETE (commit b45af4490)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: one capture path across the builder and the namespace, plus the
  carried JSDoc nit in shared.
- Tasks: 2 | Depends on: A2.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools @ptah-extension/shared`
- Review: code-logic lane → `code-logic-review-B3.2.md`

### Task B3.2.1: `buildGitNamespace` optional deps `resolveCallerSessionId` + `recordWorktreeForCaller` — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\git-namespace.builder.ts` (MODIFY), `...\git-namespace.builder.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:790-795, D9, L15
- Pattern to follow: `git-namespace.builder.ts:28-43,97-143`
- Quality requirements:
  - Record only on a successful add, and only when both deps resolve.
  - Pass `sessionId` in the `onWorktreeChanged` event; the event type gains optional
    `sessionId`.
- Validation notes: spec cases:
  - success: `recordWorktreeForCaller` gets the resolved SDK id;
  - failure or an unresolved caller: no call.
- Implementation details: see plan.

### Task B3.2.2: `PtahAPIBuilder` supplies the deps; the shared change handler records nothing — COMPLETE

- Depends on: Task B3.2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY), `...\ptah-api-builder.service.spec.ts` (MODIFY), `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\shared\src\lib\types\rpc\rpc-git.types.ts` (MODIFY, JSDoc only)
- Carried from `code-logic-review-A1.2.md` (Nit; A1.2 was committed without
  it):
  - The JSDoc on `GitWorktreeChangedNotification.sessionId` (added in
    56f37fb5b) says the field is "Present only for SDK-hook-driven
    notifications ... absent for RPC-driven (user-initiated)" operations. Once
    this task forwards `event.sessionId`, an agent's MCP
    `ptah_git_worktree_add` also sends it.
  - Reword the comment to: present for SDK-hook-driven notifications and for
    agent MCP `ptah_git_worktree_add` calls whose caller resolves to an SDK
    session id (L15); absent for user-initiated RPC worktree operations.
  - Comment change only. Add `@ptah-extension/shared` to this batch's
    verification `-p` list.
- Plan reference: implementation-plan.md:797-801
- Pattern to follow: `ptah-api-builder.service.ts:236-241,383-385,423-424,999-1024`
- Quality requirements:
  - `resolveCallerSessionId` resolves tab → `lifecycle.find(c)?.realSessionId`.
  - The recorder is optional.
  - `buildWorktreeChangeHandler` only forwards `event.sessionId`.
- Validation notes:
  - AC4 and AC8. Run `ptahAPI.git.worktreeAdd` inside
    `runWithMcpRequestContext({ callerSessionId: tab })`, with `execGit` mocked, a fake
    lifecycle and a fake recorder: the recorder gets the SDK id.
  - Calling the shared handler directly records nothing (protects 584 child worktrees).
- Implementation details: see plan.

## Batch B3.3: `PtahAPI.sessionOrganization` namespace — COMPLETE (commit 4bbeb40f9)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: it shares `ptah-api-builder.service.ts` with B3.2, so it runs after it.
  It also carries the two B3.2 review nits, which live in the same lib. The help text
  in `system-namespace.builders.ts` moved to B3.4, so that the help text lands with
  the tool and this batch stays at 6 files.
- Tasks: 2 | Depends on: B3.2 (committed b45af4490), A1.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`
- Review: code-logic lane → `code-logic-review-B3.3.md`
- Merge note: `types.ts` and `ptah-api-builder.service.ts` are 584 merge points (R-TL7).

### Task B3.3.1: `session-organization-namespace.builder.ts`, wired into `PtahAPI` — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\session-organization-namespace.builder.ts` (CREATE)
  - `...\session-organization-namespace.builder.spec.ts` (CREATE)
  - `...\code-execution\types.ts` (MODIFY)
  - `...\code-execution\ptah-api-builder.service.ts` (MODIFY)
- Caller resolution: reuse B3.2's private `resolveCallerSdkSessionId()` in
  `ptah-api-builder.service.ts`; do not write a second resolver.
- Plan reference: implementation-plan.md:811-816, D12
- Pattern to follow: `namespace-builders/tasks-namespace.builder.ts:137-210,660`; builder wiring `ptah-api-builder.service.ts:810-816`
- Quality requirements:
  - Zod-validated `{taskId, role?}`, default role `primary`.
  - The caller comes from `getCallerSessionId()` resolved to the SDK id, never from args.
  - An unresolvable caller returns `{ok:false, error:'unattributed-caller'}`.
  - No recorder returns `{ok:false, error:'organization-unavailable'}`.
  - `source: 'agent'`.
- Validation notes: the namespace name is `sessionOrganization`, not 584's `session`.
- Implementation details: see plan.

### Task B3.3.2: worktree-add error isolation (nits carried from `code-logic-review-B3.2.md`) — COMPLETE

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\git-namespace.builder.ts` (MODIFY), `...\git-namespace.builder.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:790-801, L15
- Pattern to follow: the `worktreeRemove` guard at `git-namespace.builder.ts:221-230`
- Quality requirements:
  - **Finding 2.** In `worktreeAdd` (`:186-193`), wrap the `onWorktreeChanged`
    call the same way `worktreeRemove` does. A throwing change callback must not
    turn a worktree git already created into `{ success: false }`.
  - **Finding 3.** `captureForCaller` (`:104-107`) swallows resolver and
    recorder errors silently. Keep the swallow, so the add still succeeds. Make
    the failure observable through the dependency that already logs: catch and
    debug-log inside `PtahAPIBuilder.resolveCallerSdkSessionId` /
    `recordWorktreeForCaller` (Task B3.3.1's file). Do not add a logger
    dependency to the namespace builder. Remove the `void 0` placeholder.
- Validation notes: spec cases:
  - a throwing `onWorktreeChanged` on add still returns success;
  - a throwing recorder still returns success, and the builder logs one debug line.
- Implementation details: no behaviour change on the success path.

## Batch B3.4: sessionOrganization hardening + builder-level tests — COMPLETE (commit f39b2d2ce)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: split from the old B3.4 on 2026-10-01. The tests deferred from B3.3, plus
  `code-logic-review-B3.3.md` Finding 1, prove the namespace before the MCP tool
  exposes it. This keeps both batches within the 6-file cap.
- Tasks: 1 | Depends on: B3.3 (committed 4bbeb40f9)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`
- Review: code-logic lane (antigravity) → `code-logic-review-B3.4.md`
- Review outcome: APPROVED 9.8/10 (`b41bb526-…`).
  - Nit accepted as-is, with no revise round: `getRecorder()` and
    `resolveCallerSessionId()` (`session-organization-namespace.builder.ts:123,132`)
    run outside the `try`. Production implementations never throw there
    (`resolveCallerSdkSessionId` catches; `getRecorder` is a field read).
  - Verification: Nx plugin workers crashed under parallel load. The team-leader
    re-ran the same targets directly: `tsc --noEmit` for lib and spec, `jest` (78
    suites, 2512 tests) and `eslint` on the 3 files. All exited 0.

### Task B3.4.1: wrap the root-hint read; builder-level capture and link tests — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\session-organization-namespace.builder.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\session-organization-namespace.builder.spec.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:797-816, D12, L15
- Pattern to follow: the existing `buildTestBuilder(..., recorder)` helper in
  `ptah-api-builder.service.spec.ts`; `runWithMcpRequestContext` from
  `mcp-core/mcp-request-context.ts`
- Quality requirements:
  - **B3.3 Finding 1 (Minor).** `deps.getWorkspaceRootHint()`
    (`session-organization-namespace.builder.ts:144`) is called outside the `try`.
    Move it inside the existing `try`, or treat a throw as `undefined`, so that a
    throwing dependency returns `{ ok: false, error: 'link-failed' }` and never
    escapes. Add one spec case.
  - **B3.3 Finding 2 / deviation 1.** In `ptah-api-builder.service.spec.ts`:
    - (i) a throwing recorder in `recordWorktreeForCaller`: the worktree add still
      returns success and exactly one debug line is logged;
    - (ii) `ptahAPI.sessionOrganization.linkTask({ taskId })` inside
      `runWithMcpRequestContext({ callerSessionId: tab })`, with a fake lifecycle
      `find(tab) → sdk` and a fake recorder: the recorder gets the SDK id (never the
      tab id), `source: 'agent'` and role `primary`;
    - (iii) the same call with no recorder returns `organization-unavailable`.
- Validation notes: no production change beyond the one-line move. The tool counts in
  `mcp-contract.sweep.spec.ts` stay at 56/53.
- Implementation details: see above.

## Batch B3.5: `ptah_session_link_task` MCP tool — COMPLETE (commit bd5c5d98f)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: adding the tool, its sweep entry and its pinned counts must be one change,
  or the sweep fails. (This is the old B3.4, renumbered when B3.4 was split.)
- Tasks: 1 | Depends on: B3.4
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/vscode-lm-tools`
- Review: code-logic lane (antigravity) → `code-logic-review-B3.5.md`
- Review outcome: APPROVED 9.5/10 (`10eee5a2-…`); all 4 failure modes handled.
  - Deviations accepted:
    - a refusal is returned as tool output (`Not linked (<code>): …`), as the task
      tools do;
    - `link-failed` shows fixed text and the raw message goes to `logger.warn`;
    - `tool-result-budget.ts` is unchanged (one short line, under the 8000 default);
    - `additionalProperties: false` was dropped (the `MCPToolDefinition` type
      forbids it; Zod `.strict()` still rejects extra keys).
  - Nit, not fixed here, recorded as a follow-up: the help overview header
    (`system-namespace.builders.ts:49`) says "22 Namespaces". The list under it
    names 21 namespaces with `sessionOrganization`; at base 4bbeb40f9 it named 20
    under the same "22". The PtahAPIBuilder log line says "21 namespaces" (stale,
    flagged by B3.3).
    - The reviewer's suggested "23" does not match the list either, so the header
      was already out of step before this batch.
    - The team-leader did not edit it (no fixes to reviewed code). The fix belongs
      in one follow-up that derives every namespace count from the real
      `PtahAPI` keys.
- Merge notes:
  - The pinned counts at `mcp-contract.sweep.spec.ts:1707` (56 → 57) and `:1731`
    (53 → 54) are merge points with 584. The second to merge adds the other's
    increment (R-TL7).
  - R-TL8: the 584 `recordAgentStartedSession` call line is NOT added here. 584 code is
    not merged; whichever task merges second adds the call and its spawner spec.

### Task B3.5.1: tool definition, dispatcher case, budget/hints, sweep + dispatcher specs, help text — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\session-organization-tools.ts` (CREATE)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-result-budget.ts` (MODIFY, only if its rule requires an entry; state the reasoning)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-contract.sweep.spec.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\system-namespace.builders.ts` (MODIFY, help text `:142-147`)
- Tool output: the namespace returns `{ ok: true, sessionId, taskId, role }` or
  `{ ok: false, error, message }`, with `error` one of `invalid-args`,
  `organization-unavailable`, `unattributed-caller` or `link-failed` (B3.3
  deviation 2). The dispatcher case formats both shapes, and the tool description
  lists the four error codes. Per the B3.3 review: an `ok: true` result means "handed
  to the recorder", so the success text says the link was recorded for this session
  and does not claim the task exists (a missing task shows as "missing" in the UI).
- Plan reference: implementation-plan.md:802-827, L11
- Pattern to follow: `protocol-dispatcher.ts:326-336,401-414,2275-2330`; `protocol-dispatcher.spec.ts:597-603`
- Quality requirements:
  - Always-on beside the task tools.
  - The tool list stays byte-identical for each caller.
  - The description says: calling session, stored per user, does not edit `task.md`,
    returns `organization-unavailable` in VS Code.
- Validation notes:
  - Sweep: a `TOOL_DRIVERS` entry (`:216`), a `DESCRIPTION_BUDGETS` entry (`:2082+`)
    and the count bumps.
  - Dispatcher spec: the caller comes from the context, not from args; also the
    unavailable and unattributed cases.
- Implementation details: one `case`.

## Batch C0.1: board start carries `taskId` — COMPLETE (commit a83ca9b6e)

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: two webview libs, one data flow. It needs no shared change, so it can start
  in wave 1.
- Tasks: 1 | Depends on: none
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/tasks-ui`
- Review: code-logic lane → `code-logic-review-C0.1.md`. No rendered change, so no
  visual review.

### Task C0.1.1: `ChatPromptRequest.taskId?`; `TaskStartService.launchPrompt` sets it — COMPLETE

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\core\src\lib\services\app-state.service.ts` (MODIFY)
  - `...\app-state.service.spec.ts` (MODIFY if a case is needed)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\tasks-ui\src\lib\services\task-start.service.ts` (MODIFY)
  - `...\task-start.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:901-902, :930-931
- Pattern to follow: `app-state.service.ts:173-186`; `task-start.service.ts:111-124`
- Quality requirements: the field is optional. `tasks-ui` still does not import `chat`.
- Validation notes: AC8 chain step 1: the request carries `taskId`.
- Implementation details: see plan.

## Batch C0.2: board-start link capture + organization push handling — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: one chat data flow (bridge → capture → handler).
- Tasks: 2 | Depends on: C0.1, A4.2 (the `session:linkTask` registry entry, R-TL1), A1.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`
- Review: code-logic lane → `code-logic-review-C0.2.md`. No rendered change.
- Merge note: `chat-message-handler.service.ts` is a 584 merge point (R-TL7).

### Task C0.2.1: `BoardTaskLinkCaptureService` + bridge `expect(tabId, taskId)` — PENDING

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\services\chat-store\board-task-link-capture.service.ts` (CREATE)
  - `...\board-task-link-capture.service.spec.ts` (CREATE)
  - `...\chat-store\task-prompt-bridge.service.ts` (MODIFY)
  - `...\task-prompt-bridge.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:903-910, D11, L10
- Pattern to follow: `task-prompt-bridge.service.ts:30-93`
- Quality requirements:
  - A root service holding a `Map<tabId, taskId>`, capped at 20 with the oldest evicted.
  - On resolve, delete the entry and call `session:linkTask {role:'primary', source:'board-start'}`.
  - `ok:false` or a failure is logged to the console, with no retry.
  - No timer.
- Validation notes: AC8 chain steps 2 and 4: the bridge spec checks `expect` is called
  with the tab id from `createTab`; the capture spec checks one `session:linkTask` call
  with `board-start`.
- Implementation details: see plan.

### Task C0.2.2: `ChatMessageHandler` hands off `session:id-resolved` and handles `session:organizationChanged` — PENDING

- Depends on: Task C0.2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\services\chat-message-handler.service.ts` (MODIFY), `...\chat-message-handler.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:911-919
- Pattern to follow: `chat-message-handler.service.ts:111,148,163-164,409-422,605-614`
- Quality requirements:
  - Call the capture after `chatStore.handleSessionIdResolved`.
  - Route `SESSION_ORGANIZATION_CHANGED` through the existing debounced
    `handleSessionMetadataChanged()`. No new debounce.
- Validation notes: AC8 chain step 3; also, a push triggers `loadSessions`.
- Implementation details: see plan.

## Batch C1.1: organization chips, filter bar, editor components — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: three presentational components in one lib, not yet mounted.
- Tasks: 3 | Depends on: C0.2 (chat lane order), A4.2 (mutation RPCs)
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`
- Review: code-logic lane → `code-logic-review-C1.1.md`. Visual review is deferred to
  C1.2, where the components are mounted.

### Task C1.1.1: `SessionOrganizationChipsComponent` (atom) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\components\atoms\session-organization-chips\session-organization-chips.component.ts` (CREATE), `...\session-organization-chips.component.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:978-979, :986-994, :1000-1002
- Pattern to follow: dot styling `chat-ui/src/lib/molecules/session/tab-item.component.ts:44-49,59-69`; liveness `chat-state/src/lib/session-liveness.registry.ts:27,37,51-52`
- Quality requirements:
  - Shows the priority chip, status chip, pin, live-phase dot, agent badge, task chips
    with "missing", and PR count.
  - `aria-label`s on chips; status is never shown by color alone.
  - The registry status wins over the row's `livePhase`, through one computed (no
    subscription per row).
- Validation notes: AC6 (missing). The spec covers missing task, agent badge and aria
  labels.
- Implementation details: signals, OnPush.

### Task C1.1.2: `SessionFilterBarComponent` (molecule) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\components\molecules\session-filter-bar\session-filter-bar.component.ts` (CREATE), `...\session-filter-bar.component.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:974-975, :1008-1011, L17
- Pattern to follow: existing molecules in `chat/src/lib/components/molecules/`
- Quality requirements:
  - Status and priority multi-select, task id, has-PR, pinned toggle, sort menu and
    group menu.
  - Text input debounced 250 ms, released on destroy.
  - One pending change.
- Validation notes: none.
- Implementation details: emits a query object.

### Task C1.1.3: `SessionOrganizationEditorComponent` (molecule) — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\components\molecules\session-organization-editor\session-organization-editor.component.ts` (CREATE), `...\session-organization-editor.component.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:979-982, :1000-1002, :1006-1007, Assumption A3
- Pattern to follow: `confirmation-dialog.component.ts` (labelled dialog) in the same folder
- Quality requirements:
  - Edits priority, status and pin; links and unlinks a task; adds and opens a PR
    (external link, `https:` only).
  - Shows the worktree path and branch with "Open worktree".
  - `ok:false` is shown inline.
  - Keyboard reachable.
- Validation notes: Assumption A3: confirm that `editor:openWorkspace {target, root}`
  takes a directory and is served by Electron; otherwise copy the path and say so.
  Spec: each mutation RPC, and `ok:false` rendering.
- Implementation details: see plan.

## Batch C1.2: loader query + app-shell sidebar integration — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: this mounts the C1.1 components and changes what is loaded.
- Tasks: 2 | Depends on: C1.1, A4.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/chat`
- Review:
  - code-logic lane → `code-logic-review-C1.2.md`;
  - visual-reviewer: Electron sidebar after shots in dark and light, compared with the
    V0 before shots, covering filters, chips, editor, grouping and pinned. Also a
    VS Code sidebar after shot that must match before (AC7). Output:
    `visual-review-C1.2.md`.

### Task C1.2.1: `SessionLoaderService` `listQuery` + `organizationAvailable` — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts` (MODIFY; contains a NUL byte, read directly), `...\session-loader.service.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:951-972
- Pattern to follow: `session-loader.service.ts:125,298-389`
- Quality requirements:
  - Both `session:list` calls (`:312,364`) send the query.
  - Every call carries `sort` (default `lastActive`).
  - Organization params are sent only when available.
  - A change resets the offset and reloads.
  - `organizationAvailable` is a signal (`=== true`, R-TL2).
- Validation notes: the spec checks that params are sent only when available and that
  the offset resets. The existing `session-loader.cli-restore.spec.ts` must stay green.
- Implementation details: see plan.

### Task C1.2.2: app shell renders the filter bar, chips, editor entry and groups when available — PENDING

- Depends on: Task C1.2.1
- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts` (MODIFY)
  - `...\app-shell.component.html` (MODIFY)
  - `...\app-shell.organization.spec.ts` (CREATE, R-TL9)
- Plan reference: implementation-plan.md:983-985, :957-961
- Pattern to follow: `app-shell.component.ts:238-270,514-528`; `app-shell.component.html:76-340`
- Quality requirements:
  - When the flag is false, today's controls are unchanged, including the client-side
    name/date filter.
  - When true, text goes to the server and the date filter stays client-side.
  - Group headers; children nest under parents when `groupBy === 'parent'`.
- Validation notes: the spec checks that the VS Code shape renders today's controls
  only.
- Implementation details: see plan.

## Batch C2.1: open-session bridge — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: core signal plus chat consumer. It runs after C1.2 (chat lane) and C0.1
  (`app-state.service.ts`).
- Tasks: 1 | Depends on: C0.1, C1.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat`
- Review: code-logic lane → `code-logic-review-C2.1.md`. No rendered change.

### Task C2.1.1: `AppStateManager.requestOpenSession` + `SessionOpenBridgeService` — PENDING

- File:
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\core\src\lib\services\app-state.service.ts` (MODIFY)
  - `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\chat\src\lib\services\chat-store\session-open-bridge.service.ts` (CREATE)
  - `...\session-open-bridge.service.spec.ts` (CREATE)
  - `...\libs\frontend\chat\src\lib\services\chat.store.ts` (MODIFY, keep the bridge alive beside `:85`)
  - `...\libs\frontend\chat\src\lib\services\chat-store\index.ts` (MODIFY)
- Plan reference: implementation-plan.md:1047-1052
- Pattern to follow: `app-state.service.ts:1161,1294-1322`; `task-prompt-bridge.service.ts:38-46`; `chat.store.ts:85`
- Quality requirements: `setCurrentView('chat')`; grid → `requestCanvasSession`;
  single → `chatStore.switchSession`.
- Validation notes: the bridge spec covers grid vs single routing.
- Implementation details: see plan.

## Batch C2.2: task session links service + task card — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: tasks-ui only, so it can run in parallel with the chat lane (C1.x).
- Tasks: 2 | Depends on: A4.2 (`session:listForTasks` registry entry), C0.1
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/tasks-ui`
- Review:
  - code-logic lane → `code-logic-review-C2.2.md`;
  - visual-reviewer: task board card after shots in dark and light, compared with V0 →
    `visual-review-C2.2.md`.

### Task C2.2.1: `TaskSessionLinksService` — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\tasks-ui\src\lib\services\task-session-links.service.ts` (CREATE), `...\task-session-links.service.spec.ts` (CREATE)
- Plan reference: implementation-plan.md:1033-1042, L6, L16
- Pattern to follow: `handledMessageTypes` in `tasks-ui/src/lib/services/tasks-store.service.ts:53,428,1118`
- Quality requirements:
  - One fetch per board load or push, never one per card.
  - Reload on `session:organizationChanged`, `session:turnEnded` and
    `session:turnFailed`.
  - `linksFor(taskId)` is computed.
  - Unavailable gives an empty map.
- Validation notes: the spec covers fetch on load, reload on each push, and unavailable
  → empty.
- Implementation details: see plan.

### Task C2.2.2: `TaskCardComponent` sessions row — PENDING

- Depends on: Task C2.2.1
- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\tasks-ui\src\lib\components\board\task-card.component.ts` (MODIFY, inline template, R-TL9), `...\task-card.component.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:1043-1044
- Pattern to follow: the existing card template
- Quality requirements: count, live-phase dots and first PR link; no per-card timer.
- Validation notes: AC2 (the card shows the session and its phase). The spec renders the
  links and the no-PR state.
- Implementation details: see plan.

## Batch C2.3: task detail sessions list + "Open session" — PENDING

- Recommended executor: frontend-developer (sub-agent)
- Fallback executor: a CLI lane
- Execution mode: sequential
- Rationale: it needs `requestOpenSession` (C2.1) and the service (C2.2).
- Tasks: 1 | Depends on: C2.1, C2.2
- Verification: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/tasks-ui`
- Review:
  - code-logic lane → `code-logic-review-C2.3.md`;
  - visual-reviewer: task detail after shots in dark and light, compared with V0 →
    `visual-review-C2.3.md`.

### Task C2.3.1: `TaskDetailComponent` full linked-session list — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\libs\frontend\tasks-ui\src\lib\components\detail\task-detail.component.ts` (MODIFY, inline template), `...\task-detail.component.spec.ts` (MODIFY)
- Plan reference: implementation-plan.md:1045-1046, :1055-1057
- Pattern to follow: the existing detail template
- Quality requirements:
  - Shows role, source, live phase, PR links and "Open session".
  - Opening a deleted session uses the existing `switchSession` error path.
- Validation notes: the spec checks that "Open session" calls `requestOpenSession`.
- Implementation details: see plan.

## Batch T1: AC evidence, real-host smoke, test report — PENDING

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: none
- Execution mode: sequential
- Rationale: it needs every batch and real hosts.
- Tasks: 1 | Depends on: all batches above
- Verification: the plan Test strategy commands (:1288-1302), run as
  `npx nx run-many -t typecheck,test,lint -p <the 14 touched projects>`; then the smoke
  runs.
- Review: code-logic lane on `test-report.md` → `code-logic-review-T1.md`

### Task T1.1: AC1 perf run, smoke S1-S8, write-path trace, `test-report.md` — PENDING

- File: `D:\projects\ptah-extension\.claude-worktrees\task-580\.ptah\specs\TASK_2026_580_9f77\test-report.md` (CREATE)
- Plan reference: implementation-plan.md:1284-1363, write-path table :1196-1213
- Pattern to follow: earlier tasks' `test-report.md`
- Quality requirements:
  - S1-S8 in order: Electron, then VS Code, then the CLI.
  - Trace every written column to its runtime reader (the Mode 3 write-path check).
- Validation notes:
  - Carried from `code-logic-review-C0.1.md` (Nit 1): in
    `libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts:115-133,177-188`,
    the `isolate=true` case and the explicit-orchestrator-target case do not
    assert `lastPromptRequest?.taskId`. Add
    `expect(lastPromptRequest?.taskId).toBe('TASK_2026_201')` and
    `...toBe('TASK_2026_208')`, so every launch variant pins AC8 chain
    step 1. (Nit 2, `readonly` on `taskId`: not carried; the field matches
    the interface's other mutable fields.)
  - R-TL8: confirm whether 584 has merged. If it has, report that the 580-side call line
    is still owed (a follow-up batch adds it). If it has not, record that 584 owes it.
- Implementation details: none.
