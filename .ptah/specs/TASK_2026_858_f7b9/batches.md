# Batches - TASK_2026_858_f7b9

Total tasks: 44 (Round 6: Batch 19 has 4 tasks, was 2) | Batches: 26 | Complete: 7/26

Scope: Phase 0 tool and Phase 1 (C0-C10) of implementation-plan.md, Round 5 as amended by
Round 6 (headless Electron worker host, decisions.md row 19). C11 is not built
(Q1 = (a), decisions.md row 10). The U5 licensing batch is not built (U5 = 1). Phases 2-4 get
their own decomposition after Phase 1 ships.

Worktree (every path below is under it), Round 6:
`/home/amun/ptah-extension/.claude-worktrees/remote-workers-v2` (branch `feat/remote-workers-v2`,
base main `c5e5c704b`, Batches 1-7 cherry-picked; decisions.md row 18). The old worktree
`remote-workers` (branch `feat/remote-workers`) is a backup and is never edited. Abbreviated below
as `W/`; every executor prompt must expand it to the absolute path.

## Rules for every executor (repeat them in every lane or subagent prompt)

- Work only inside `/home/amun/ptah-extension/.claude-worktrees/remote-workers-v2`. Never edit the
  main checkout `/home/amun/ptah-extension` or the backup worktree `remote-workers`.
- Verify only with the batch's `npm run verify -- -p <projects>` command, run from the worktree,
  one foreground run, output filtered with `| tail -60`. Never run workspace-wide checks, never
  `nx run-many` over unchanged projects, never `build`, `serve`, `dev`, `e2e` or `package`
  targets. Other heavy commands run under
  `node scripts/verify.mjs --exec --task <name> -- <command>`.
- Electron first. The TUI, CLI and VS Code hosts no longer exist (main 1cee6fafe); never name
  `ptah-cli`, `ptah-tui`, `ptah-extension-vscode`, `ptah-video-studio` or `ptah-license-server`
  in a verify command. Keep `cli-engine`, `platform-cli` and mcp-bench working.
- Executors do not run git (no commit, push, stash, branch). The team-leader owns git.
- Executors never edit `batches.md`, `task.md` or any other file in the task folder unless the
  task names that file as the deliverable.
- No stubs, placeholders, TODO markers or mock data standing in for logic.
- Fleet machines (gatsby, horus, anubis, chappie) are out of bounds for every batch executor.

## Execution order and parallelism

Batches run one at a time in the single worktree, in the numbered order. Several batches are
parallel-eligible by file ownership (noted per batch), but two executors in one worktree would
each see the other's uncommitted edits in their verify run, so they do not run concurrently.
Exception: gated step G-D (design revision) writes only task-folder files and runs alongside
code batches from now on.

## Plan validation

Status: PASSED WITH RISKS

Round 4/5 citations re-checked at `8ca24c134` (main has not moved):

- C4b: `chat-session.service.ts` `startSession` :986, `continueSession` :1531 (`gateAccount`
  :1546), `resumeSession` :1778 (activate branch `hasLiveSessionStream` :1890),
  `ensureSessionActiveForRewind` :2139 (`gateAccount` :2156, `hasLiveSessionStream` :2166),
  `autoResumeIfInactive` :2228, `sdkAdapter.resumeSession` :2437. `CHAT_TOKENS` at
  `chat/tokens.ts:10`; `registerChatServices` in `chat/di.ts`. All match.
- C4c: `codex-chat-adapter.ts` `sessions?` port :123, `CodexChatSessionLifecycle` :131-137,
  `open` :257, `prepareProfile` :283, `openContext` :286, threadId :287, `opened` :294,
  `failure()` in catch :306, `publishSession` :384. `codex-chat-session-controls.ts`
  `TrackedSession` :14, `close` removal :87-91. Electron `codex-runtime-composition.ts:602`
  (`sessions,`), lazy `lifecycle()` `codex-session-binding.ts:40-43`, CLI null ports
  `agent-sdk/src/lib/di/register.ts:1003-1004`. All match.
- C6: `SessionMetadataStore.get` `session-metadata-store.ts:1424`, `codexExecution` :263. Match.
- C10: `electron-shell.component.ts` guard :233, welcome branch :385-388 (with
  `openConfigurationSurface() === null` :387), second branch :431; Tasks route
  `app.routes.ts:144` (`surfaceActiveFor('tasks')`, plan says :142-147). Match.
- C0 assumption "no CI runs the CLI on Node 20": verified. Every workflow uses `NODE_VERSION: 24`;
  `cli-e2e.yml:60` matrix is `['24']`.

Assumptions:

- A1 `ws` over an `ssh -W` Duplex works — unverified; Duplex-pair spec in Task 21.2, real-SSH
  acceptance in gated step G-R (runbook).
- A2 `chat:start`/`chat:continue` accept a `workspacePath` other than the boot cwd — unverified;
  Task 18.2 (`worker-service` registers workspaces at start) carries a spec.
- A3 SDK session JSONL holds every completed message once — unverified; Task 17.1 baseline spec
  with fixture JSONL (AR6 fallback in the plan).
- A5 history and live events of one message are idempotent — Task 23.1 spec.
- A6 lock name depends only on uid and session ID — Task 8.1 contract spec.
- A7 chat-ui transcript components render without the chat TabManager — Task 25.2 checks inputs
  first; fallback is `@ptah-extension/chat-execution-tree` builders.
- A8 Linux abstract-namespace socket bind via `node:net` — Task 8.1 cross-process spec; per-host
  smoke in Task 19.1 (`ptah worker locks --self-test`) and Task 21.1 (Electron readiness).
- `ws` 8.21.0 and `@types/ws` 8.18.1 are already in `package-lock.json` as transitive packages —
  verified; Task 1.2 only records the root declaration.

| Risk | Severity | Mitigation |
| ---- | -------- | ---------- |
| R-A. Plan defect (C4c file list): making `CodexChatAdapterPorts.driver` required breaks `createCodexChatHostPorts`, because `CodexChatHostPorts extends CodexChatAdapterPorts` (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts:85`) and the factory returns that type (:222-224, object at :242) without `driver`. Also used by `chat-session.native.spec.ts:235` and the two `codex-chat-host-ports*.spec.ts`. None is in C4c's list | HIGH | Task 13.2: `CodexChatHostPorts extends Omit<CodexChatAdapterPorts, 'driver'>`; Electron composition adds `driver` next to `sessions` (the plan already puts the wiring there). Decision D-3 |
| R-B. Plan defect (C2): adding `'machines'` to `ViewType`/`SURFACE_ROUTE_IDS` before a route exists fails `libs/shared/src/lib/types/webview-surface.types.spec.ts:27` (exact list) and the per-ID route loops in `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:83-86`. Neither spec is in C2's files | HIGH | The `webview-surface.types.ts` edit and its spec move from C2 to Batch 26 (with the route and shell). Decision D-4 |
| R-C. Plan defect (C3): the new manifest entry `host.remoteMachines` requires `remoteMachines`, which Electron sets only in C9. `apps/ptah-electron/src/di/rpc-surface.spec.ts:41-43` ("excludes nothing") and :78 fail from C3 until C9, yet C3's verify includes `ptah-electron` | HIGH | Task 7.3 adds an interim expectation (the `host.remoteMachines` methods are the only exclusion, comment names Batch 22); Task 22.1 removes it. Decision D-5 |
| R-D. Declaring `ws`/`@types/ws` in the root `package.json` changes `package-lock.json` `packages[""]`; the lockfile is not in C0's list, so `npm ci` would fail in CI | MEDIUM | Task 1.2 updates the lockfile with `node scripts/verify.mjs --exec --task lockfile -- npm install --package-lock-only --ignore-scripts`; the lockfile diff must touch only the root entry |
| R-E. The plan's verify table omits dependent apps: `mcp-bench` and `ptah-video-studio` depend on platform-core, vscode-core, agent-sdk, rpc-handlers (and cli-engine for mcp-bench); `ptah-landing-page` and `ptah-license-server` depend on `libs/shared` (Nx graph at 8ca24c134) | MEDIUM | Added to each affected batch's verify command. Decision D-2 |
| R-F. The new commit scopes must exist before the first batch commit that uses them, including `process-sampler` for P0-1 | LOW | Task 1.2 adds `worker-protocol`, `worker-runtime`, `remote-machines`, `machines-ui`, `process-sampler`; Batch 1 runs before Batch 2 |
| R-G. `ws` in `apps/ptah-electron/package.json` depends on `apps/ptah-electron/scripts/validate-deps.js` (it checks external imports against declared dependencies, :122-175). C8 is the first Electron-main `ws` importer, so a wrong C0 call only shows at the pre-push gate | MEDIUM | Task 1.2 decides with evidence and reports it; Task 22.2 re-confirms; the pre-push gate after Batch 22 is the final check |
| R-H. Fail-closed lock blocks local chat on a host that refuses the lock endpoint (AR4) | MEDIUM | Batches 8, 9, 11 (readiness self-test, refusal names cause and fix); Phase C review checks it |
| R-I. A native Codex open or close path that bypasses the gate (AR11) | HIGH | Task 13.1 call-order and exactly-once-release specs; Phase C review |
| R-J. Worker drives a native Codex session | MEDIUM | Task 17.2 capability-limit refusal from `codexExecution.runtime` |
| R-K. A3 false (history incomplete after release) (AR6) | MEDIUM | Task 17.1 fixture spec; AR6 fallback in the plan |
| R-L. Single worktree: concurrent batches would verify each other's half-done edits | MEDIUM | Batches run sequentially (see Execution order) |
| R-M. C10 design 4.9 and screen 9 still show an answerable permission block, which conflicts with Q1 (a) watch-only (`design-spec.md:109`, revision log :194) | HIGH | Gated step G-D: designer revision plus a review before Batch 23 starts |
| R-N. Security exposure of the worker (R9) | HIGH | Phase D and Phase E reviews include `review-security` before Phase 1 ships |

Edge cases:

- Lock holder alive but hung, SIGSTOP holder, stranded release — Tasks 8.1, 9.1.
- Rebind of a `claude-sdk` session mid-drive (acquire new, release old, fail closed) — Tasks
  10.1, 12.1.
- Native Codex admit refused or failing: open ends before `persistMetadata`/`publishSession`,
  nothing held — Task 13.1.
- Rewind on a session driven elsewhere — Task 12.1.
- Log append failure mid-turn, torn tail, interrupted recovery, no `evt` with `seq > head` —
  Task 15.1.
- Pre-auth calls to every method, identical pairing rejections, outside-grant resources —
  Tasks 14.1, 16.1, 18.1.
- Duplicates and gaps across reconnect render the same as no disconnect — Tasks 4.2, 23.1.
- Offline machine removal still deletes token and entry — Task 21.1.
- Worker on Node < 22 or `better-sqlite3` load failure — Tasks 18.1, 19.1.
- No-folder Electron state still reaches the Machines view — Task 26.2.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| D-1 | File cap counts production files; co-located specs and one-line barrel exports ride with their source. Batches that must change several projects atomically (C0, C3, the C4a host bindings, C4c, the shell/route batch) carry a stated exception to the 2-project cap | strict count / production-file count | Splitting those batches would commit a red tree (surface baselines, DI smoke specs, required-port compile) | yes |
| D-2 | Verify commands extend the plan's table with every dependent app from the Nx graph | plan table / graph | R-E; CLAUDE.md "each host project that depends on it" | yes |
| D-3 | `CodexChatHostPorts` omits `driver`; Electron composition supplies it | add `driver` to `CodexChatHostPortsDeps` / omit in host ports | Plan C4c: "Electron composition passes `driver` next to `sessions`"; `sessions` is also added only at composition (`codex-runtime-composition.ts:602`) | yes |
| D-4 | `'machines'` route ID lands with its route in Batch 26, not in C2 | C2 with a placeholder route / with the route | R-B; a placeholder route would be a stub | yes |
| D-5 | Interim Electron surface expectation from Batch 7 to Batch 22 | merge C3 into C9 / set Electron `remoteMachines` early without handlers / interim spec | C6 needs C3's host profile long before C9; an early capability flag would advertise methods with no handler | yes |
| D-6 | All batches sequential in one worktree | parallel lanes in one worktree / separate worktrees / sequential | R-L; separate worktrees would need extra merges the team-leader cannot verify per batch | yes |
| D-7 | Phase 0 measurement is an orchestrator step (G-M), not a batch | batch / step | The plan says it is not a verification and the Horus run needs a fleet machine | yes |
| D-8 (R6) | Verify lists name only existing projects; dependents taken from the Nx graph at this branch (plan R6.5) | keep removed names / graph | `npx nx graph`; removed hosts are not Nx projects | yes |
| D-9 (R6) | Batch 11 drops the vscode-core null default and the VS Code smoke file | keep / drop | Only Electron and cli-engine call `registerVsCodeCorePlatformAgnostic` (plan R6.1, AD-30) | yes |
| D-10 (R6) | Batch 19 becomes the worker host lib + desktop packaging (4 tasks, D-1 exception) | split into 19a/19b / one batch | Numbering stays stable; the lib, its bundle target and the launcher must land together | yes |
| D-11 (R6) | `WORKER_REMOTE_COMMAND` lands in Batch 20 (worker-protocol), not Batch 19 | 19 / 20 | Batch 20 is its first code consumer; Batch 19 uses the literal name in usage text | yes |

## Round 6 revision (2026-11-04)

Plan: implementation-plan.md "Round 6 — headless Electron worker host".

- Inventory: 30 lines of this file named a removed host or `ptah worker` (13 inside Batches
  8-26), and 12 verify commands listed removed projects (8 inside Batches 8-26: Batches 8, 9, 10,
  11, 12, 13, 19, 26). The plan had 84 such lines and 14 such verify commands.
- Batches 1-7 are not edited. Their re-verification on `feat/remote-workers-v2` uses one command:
  `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui,process-sampler,@ptah-extension/shared,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,@ptah-extension/vscode-core,ptah-electron,ptah-extension-webview,mcp-bench,ptah-landing-page`.
  Their per-batch "Verify:" lines below name removed projects and are historical.
- Revised batches: 8, 9, 10, 11, 12, 13 (verify lists; 11 and 13 also file/notes), 16, 17, 18
  (wording, evidence, drift spec move), 19 (replaced), 20 (remote command), 24, 25 (copy), 26
  (verify list). Unchanged: 14, 15, 21, 22, 23.
- Plan validation rows above that cite `apps/ptah-cli`, `ptah-video-studio` or Task 19.1's
  `ptah worker locks --self-test` read as Round 6 (`ptah-worker locks --self-test`).
- Phase B fix round (HANDOFF) is independent of Round 6 and still runs before Batch 8.

## Gated steps (not batches; the orchestrator runs them)

- **G-D — design revision for watch-only (before Batch 23).** ui-ux-designer subagent (visual
  work and prototype screenshots: a subagent reason) revises `design-spec.md` 4.9 (:109) and
  prototype screen 9 (`prototype/index.html`, `prototype/screenshots/09-local-driver-{dark,light}.png`)
  for Q1 (a) watch-only: the remote view shows the permission request read-only with "answer on
  the desktop" copy, no Allow/Deny controls, composer disabled, owner chip kept. Then one review
  on a CLI lane (opposite execution side, document-gate protocol); output appended to
  `design-spec-review.md`. Batch 23 starts only on an APPROVED verdict. Can start now.
- **G-M — Phase 0 measurement run (after Batch 2).** amun-PC: `node
  tools/process-sampler/src/sampler.js --duration 1800 --out <file>` under normal work. Horus
  run (Q4 consent, decisions.md row 10): Round 6 — no Node or CLI install; the sampler can run
  under the desktop's bundled runtime (`ELECTRON_RUN_AS_NODE=1 /opt/Ptah/ptah-desktop
  sampler.js …`), and the worker measurement needs a desktop build with worker mode. Before
  installing, back up what is replaced and check that Ptah is not running (`pgrep -f /opt/Ptah/ptah-desktop`).
  Writes `.ptah/specs/TASK_2026_858_f7b9/phase-0-measurement.md`. Not blocking for Phase 1 code;
  B1-B3 resource budget numbers come from it.
- **G-R — Phase 1 exit runbook (after Batch 26 and its phase review).** Follows
  `libs/backend/worker-host/docs/worker.md` (Round 6) on a worker with a desktop deb build that
  has worker mode: Horus or Chappie after O3. Covers the exit scenario, A10 node mode
  (`ptah-worker status --json` over SSH), the systemd user unit start/stop, A1 real `ssh -W`
  acceptance, the 8.1 port scan, `pkill -f "worker-host.mjs serve"` mid-turn, a desktop GUI
  session on the worker during a remote session, the A8 self-tests. Result recorded in the task
  folder.
- **O1-O5 (fleet operations) stay gated on the user's answers.** No batch depends on them. O3
  (upgrade Chappie) is only needed if G-R runs on Chappie. O6 is done (decisions.md row 15).

## Phases and reviews

| Phase | Batches | Phase review (cross-family) |
| ----- | ------- | --------------------------- |
| A Scaffold and measurement tool | 1-2 | none (workspace config and measurement tooling only) |
| B Contracts and engine hooks | 3-7 | code-logic + style (new public API: `worker-protocol`, `rpc-machines.types.ts`) |
| C Driver lock (both runtimes) | 8-13 | code-logic + style (new platform-core port, new required agent-sdk port) |
| D Worker runtime and headless worker host (Round 6) | 14-19 | code-logic + style + `review-security` (R9) |
| E Electron client and wiring | 20-22 | code-logic + `review-security` (R9) |
| F Machines view | 23-26 (after G-D) | code-logic + style + visual (Electron, dark and light, against the revised prototype) |

Reviewer family must differ from the implementer family; the team-leader records both in the
phase summary.

---

## Batch 1: C0 workspace scaffold — COMPLETE

- Recommended executor: CLI lane devops/config capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (devops-engineer)
- Subagent reason: N/A
- Review family: N/A (phase review none)
- Rationale: mechanical skeletons from one template plus five shared config files; one owner for
  every workspace-wide file (plan S6). D-1 exception: four new projects must exist together
  with their `tsconfig.base.json` aliases.
- Tasks: 2 | Depends on: none
- Phase: A | Phase review: none — workspace config only
- Verify: `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui,ptah-cli`
  (add `,ptah-electron` if Task 1.2 changes `apps/ptah-electron/package.json`)

### Task 1.1: Create the four project skeletons — COMPLETE

- Files: W/`libs/worker-protocol/**`, W/`libs/backend/worker-runtime/**`,
  W/`libs/backend/remote-machines/**`, W/`libs/frontend/machines-ui/**` (each `project.json`,
  tsconfigs, `jest.config.ts`, `eslint.config.mjs`, `package.json` where the template has one,
  `src/index.ts` exporting nothing)
- Plan reference: implementation-plan.md:925-947; library placement :180-199; AD-17
- Pattern to follow: W/`libs/frontend/tasks-ui/project.json` (`passWithNoTests`, ngc typecheck)
  for machines-ui; an existing `libs/backend/*` lib for the two backend libs
- Quality requirements: tags per the plan's boundary table (worker libs `scope:extension`, no
  `cli-engine` import); empty projects pass lint, typecheck and test
- Validation notes: none
- Implementation details: Nx project names `@ptah-extension/worker-protocol`,
  `@ptah-extension/worker-runtime`, `@ptah-extension/remote-machines`,
  `@ptah-extension/machines-ui` (the verify commands depend on these names)

### Task 1.2: Shared workspace files — COMPLETE

- Depends on: Task 1.1
- Files: W/`tsconfig.base.json`, W/`package.json`, W/`package-lock.json`,
  W/`apps/ptah-cli/package.json`, W/`apps/ptah-electron/package.json` (conditional),
  W/`.commitlintrc.json`
- Plan reference: implementation-plan.md:929-947, :1222-1223 (C7 `files` list in C0's set)
- Pattern to follow: existing alias entries in `tsconfig.base.json`
- Quality requirements: four aliases; `ws` ^8.21.0 in root `dependencies` and `@types/ws` in root
  `devDependencies`; `ws` and `docs/worker.md` in `apps/ptah-cli/package.json` (`dependencies` /
  `files`); `engines.node` `>=20.12` → `>=22` (`apps/ptah-cli/package.json:44-45`, Q6), no other
  `engines` change; scopes `worker-protocol`, `worker-runtime`, `remote-machines`, `machines-ui`,
  `process-sampler` in `.commitlintrc.json`
- Validation notes: R-D (lockfile via `node scripts/verify.mjs --exec --task lockfile -- npm
  install --package-lock-only --ignore-scripts`; diff only in the root entry); R-F; R-G (read
  `apps/ptah-electron/scripts/validate-deps.js` and report whether Electron needs `ws` declared,
  with the evidence line)
- Implementation details: no CI Node < 22 exists (verified, see Plan validation); report that
  check result anyway

### Batch 1 verification

- Every listed artifact exists; aliases resolve; the lockfile diff is limited to the root entry
- The verify command passes; output tailed
- No per-batch review

## Batch 2: P0-1 process sampler tool — COMPLETE

- Recommended executor: CLI lane backend/tooling capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (devops-engineer)
- Subagent reason: N/A
- Review family: N/A
- Rationale: six self-contained files, Node built-ins only; parallel-eligible with any batch.
- Tasks: 1 | Depends on: Batch 1 (commit scope only)
- Phase: A | Phase review: none — measurement tooling
- Verify: `npm run verify -- -p process-sampler`

### Task 2.1: `tools/process-sampler` — COMPLETE

- Files: W/`tools/process-sampler/{project.json,jest.config.ts,tsconfig.json,README.md}`,
  W/`tools/process-sampler/src/sampler.js`, W/`tools/process-sampler/src/sampler.spec.ts`
- Plan reference: implementation-plan.md:899-921
- Pattern to follow: W/`tools/mcp-bench/project.json`; CommonJS like `tools/perf/*.js`
- Quality requirements: `/proc` sampling every 2 s; groups by tree root and command-line class;
  mean, p95, max CPU and RSS; JSON plus Markdown; non-Linux exits 2; overhead < 1% self-reported
- Validation notes: runs unbuilt on Node 20 (Horus before Q4 install)
- Implementation details: Jest specs for `parseStat`, `buildTrees`, `aggregate` with fixture text;
  no shared file touched. The measurement run is G-M, not this task

### Batch 2 verification

- Six files exist; verify passes; no per-batch review

---

## Batch 3: C1a worker-protocol wire contract — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: pure schemas and constants in one new lib; parallel-eligible with Batches 5, 6, 8, 10.
- Tasks: 1 | Depends on: Batch 1
- Phase: B | Phase review: at Batch 7
- Verify: `npm run verify -- -p @ptah-extension/worker-protocol`

### Task 3.1: Frames, methods, errors, version, pairing code — COMPLETE

- Files: W/`libs/worker-protocol/src/lib/{frames,methods,errors,version,pairing-code}.ts`
  (+ specs), W/`libs/worker-protocol/src/index.ts`
- Plan reference: W1 :202-227, W2 :228-238, W3 :239-268, W6 :288-317, W7 record schemas
  :318-373, W12 :873-894; C1 :949-966
- Pattern to follow: zod schemas in `libs/shared/src/lib/types/rpc/`
- Quality requirements: `SESSION_EVENT_TYPES` includes `worker:history-mark`; `HistoryMark`,
  `WORKER_RECORD_SCHEMAS`; fixed error copy; close codes; `PROTOCOL_VERSION`,
  `negotiateProtocol`; Crockford 8-char code normalization (AD-15)
- Validation notes: no Node or DOM imports (isomorphic); type-only imports of
  `FlatStreamEventUnion` (`rpc-chat.types.ts:356`) and `PermissionRequest` (`permission.types.ts:30`)
- Implementation details: malformed inbound maps to close 4400 `protocol-error`

### Batch 3 verification

- Files exist with real schemas; verify passes; no per-batch review
- Result: executor backend-developer subagent (Claude). 5 modules + 5 specs (84 tests).
  Batch 1 gap fixed here: the four new libs were missing from the `lint` and `test` plugin
  include lists in `nx.json`. `npm run verify -- -p` the 4 new libs → 12/12 tasks succeeded.
  Executor-designed shapes for Phase B review: `admin.grants.list/add`, `admin.status`,
  `goodbye` payload, `VERSION_MISMATCH` detail `client`.

## Batch 4: C1b worker client and session event reducer — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: two stateful units on top of Batch 3, same lib.
- Tasks: 2 | Depends on: Batch 3
- Phase: B | Phase review: at Batch 7
- Verify: `npm run verify -- -p @ptah-extension/worker-protocol`

### Task 4.1: `WorkerClient` — COMPLETE

- File: W/`libs/worker-protocol/src/lib/client/worker-client.ts` (+ spec)
- Plan reference: C1 :955-956; W1/W2
- Pattern to follow: Batch 3 types
- Quality requirements: req/res correlation, in-flight cap, ping, callbacks, `WebSocketLike`
  factory, 30 s per-call timeout
- Validation notes: spec over an in-memory `WebSocketLike`
- Implementation details: export from `src/index.ts`

### Task 4.2: `SessionEventReducer` — COMPLETE

- Depends on: Task 4.1
- File: W/`libs/worker-protocol/src/lib/client/session-event-reducer.ts` (+ spec),
  W/`libs/worker-protocol/src/index.ts`
- Plan reference: W7 :318-373, W8 :374-436; C1 :956-962
- Quality requirements: duplicates across reconnect dropped; gap → replay request; epoch reset;
  baseline replace; history-mark advances with no view change
- Validation notes: edge case "duplicates and gaps render the same as no disconnect"
- Implementation details: pure reducer, no I/O

### Batch 4 verification

- Specs cover each listed reducer case; verify passes; no per-batch review
- Result: executor backend-developer subagent (Claude). verify worker-protocol → 3/3 tasks,
  134 tests. Open for Phase B review: optional transport ping (PWA has none), extra client error
  codes, baseline applies across a gap, 1,000 held-frame cap, records copied per event.

## Batch 5: C2 shared renderer contracts — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: additive types in one shared lib; wide verify because every host consumes it.
- Tasks: 1 | Depends on: Batch 1
- Phase: B | Phase review: at Batch 7
- Verify: `npm run verify -- -p @ptah-extension/shared,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-extension-webview,ptah-video-studio,mcp-bench,ptah-landing-page,ptah-license-server`

### Task 5.1: `machines:*` types, registry entries, message types, error codes — COMPLETE

- Files: W/`libs/shared/src/lib/types/rpc/rpc-machines.types.ts` (create),
  W/`libs/shared/src/lib/types/rpc.types.ts`, W/`libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`,
  W/`libs/shared/src/lib/types/messages/message-constants.ts`, barrel if needed
- Plan reference: W11 :856-872; C2 :968-984
- Pattern to follow: an existing `rpc-*.types.ts` and its registry entries (`rpc.types.ts:3687`)
- Quality requirements: no import of `worker-protocol`; new `RpcUserErrorCode` values
  (`rpc-error-codes.types.ts:7-27`)
- Validation notes: **R-B / D-4: do not edit `webview-surface.types.ts`** (`'machines'` route ID
  moves to Batch 26). Check for exhaustive switches over `MESSAGE_TYPES` or
  `RpcUserErrorCode` in dependents; the verify run covers them
- Implementation details: purely additive

### Batch 5 verification

- `webview-surface.types.ts` untouched; verify passes across all listed apps
- Result: executor backend-developer subagent (Claude). Verify 78 tasks: 76 succeeded, 2 failed
  (`ptah-license-server` test/typecheck: Prisma client not generated in the worktree). After
  `nx run ptah-license-server:prisma:generate`, `verify -p ptah-license-server` → 2/2 succeeded.
  D-B5-1: the 17 `machines:*` methods are NOT yet in `RpcMethodRegistry`/`RPC_METHOD_ENTRIES`;
  they join in Batch 7 (see Task 7.1). Also touched `messages/payload-map.ts` (push payloads).

## Batch 6: C5 CLI engine hooks — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: three small edits in one lib.
- Tasks: 1 | Depends on: Batch 1
- Phase: B | Phase review: at Batch 7
- Verify: `npm run verify -- -p @ptah-extension/cli-engine,ptah-cli,ptah-tui,mcp-bench`

### Task 6.1: Host profile injection and push tap — COMPLETE

- Files: W/`libs/backend/cli-engine/src/lib/container.ts`,
  W/`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`,
  W/`libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts` (+ spec),
  W/`libs/backend/cli-engine/src/lib/surface-composition.spec.ts`
- Plan reference: C5 :1120-1134
- Pattern to follow: existing `CliBootstrapOptions` fields
- Quality requirements: `hostProfile?` replaces `createCliRpcHostProfile(host)` only when given
  (`container.ts:984`); forwarded from `WithEngineOptions` (`with-engine.ts:258-266`); `tap` runs
  synchronously before emit per de-batched event; a throwing tap is caught and logged by error
  name
- Validation notes: re-read line anchors (moved since plan base)
- Implementation details: tap does no I/O by contract

### Batch 6 verification

- Tap order and isolation specs exist; verify passes
- Result: executor backend-developer subagent (Claude). cli-engine, ptah-cli (1178 tests), ptah-tui
  pass lint/test/typecheck. Also changed `apps/ptah-cli/src/di/container.smoke.spec.ts` (its
  source anchor matched the old call text). mcp-bench `snapshot-audits.suite.spec.ts`
  "mem.liveness.audit" hits the 5 s Jest timeout under load; passes alone (unrelated SQLite
  audit; watch it in CI).

## Batch 7: C3 RPC surface — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: D-1 exception: the manifest entry and every host's surface baseline must move in
  one commit (rpc-handlers, vscode-core, cli-engine, VS Code app, Electron spec).
- Tasks: 3 | Depends on: Batch 5
- Phase: B (last) | Phase review: **code-logic + style for Phase B (Batches 3-7)**
- Verify: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/vscode-core,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui,ptah-video-studio,mcp-bench`

### Task 7.1: Capability, manifest, host label, prefix — COMPLETE

- Files: W/`libs/backend/rpc-handlers/src/lib/host-profile/{capabilities.ts,manifest.ts,host-profile.ts}`,
  W/`libs/backend/vscode-core/src/messaging/rpc-handler.ts`,
  W/`libs/shared/src/lib/types/rpc.types.ts` (D-B5-1: `RpcMethodRegistry extends
  MachinesRpcMethodRegistry` and `MACHINES_RPC_METHOD_NAMES` in `RPC_METHOD_ENTRIES`; add
  `@ptah-extension/shared` and its Batch 5 dependents to the verify list)
- Plan reference: C3 :985-1000
- Pattern to follow: an existing `host.*` manifest entry with `requires`
- Quality requirements: `remoteMachines` capability; `host.remoteMachines` entry with the W11
  methods; `'worker'` in `HostProfile.host` (:46); `'machines:'` in `ALLOWED_METHOD_PREFIXES` (:44)
- Validation notes: none
- Implementation details: none beyond the list

### Task 7.2: CLI and VS Code absent lists and baselines — COMPLETE

- Depends on: Task 7.1
- Files: W/`libs/backend/cli-engine/src/lib/rpc/{expected-absent.ts,rpc-surface.spec.ts}`,
  W/`apps/ptah-extension-vscode/src/di/{expected-absent.ts,rpc-surface.spec.ts}`
- Plan reference: C3 :993-996
- Quality requirements: `remoteMachines` absent on CLI and VS Code
- Validation notes: smallest change to keep VS Code compiling (no VS Code feature work)
- Implementation details: none

### Task 7.3: Interim Electron surface expectation — COMPLETE

- Depends on: Task 7.1
- File: W/`apps/ptah-electron/src/di/rpc-surface.spec.ts`
- Plan reference: none (team-leader mitigation R-C, D-5)
- Quality requirements: "excludes nothing" becomes "excludes only the `host.remoteMachines`
  methods until Batch 22 (C9) sets the capability"; the full-manifest test accounts for them;
  the comment names Batch 22 and TASK_2026_858_f7b9
- Validation notes: R-C. Do not touch `rpc-host-profile.ts` (C9's)
- Implementation details: derive the excluded set from the manifest entry, not a literal list

### Batch 7 verification

- Every host's surface spec passes; verify passes; then NEEDS REVIEW for Phase B
- Result: executor backend-developer subagent (Claude). Verify (shared, rpc-handlers, vscode-core,
  cli-engine, electron, vscode, cli, tui, webview, video-studio, mcp-bench) → 79/79 succeeded.
  `host.remoteMachines` is host-owned (no lib handler; C9 supplies it via `hostHandlers`).

---

## Batch 7.9: Phase B carry-over — fence late frames after a snapshot attach — COMPLETE

- Source: `fix-bounded-correction-review.md` new defect 1 (Major, Codex). Decision row 23.
- Defect: `libs/worker-protocol/src/lib/client/session-event-reducer.ts:290-341`. After an
  overflow, an older replay can still stream when a newer fresh attach returns `mode: 'snapshot'`.
  `showSnapshot` resets `epoch`/`last` and clears recovery, and event frames carry no attach token,
  so a late baseline replaces the saved snapshot and a late non-baseline frame is held as a gap
  and can request another attach.
- Fix: fence frames after a snapshot until the next `connected` action (or tag frames with the
  attach that started them). Tests: late baseline after snapshot ignored; late non-baseline frame
  after snapshot requests no attach; `connected` after snapshot resumes the log.
- Files: `session-event-reducer.ts` and its spec only.
- Executor: backend-developer subagent (Claude). Review: Codex lane (different family).
- Verify: `npm run verify -- -p @ptah-extension/worker-protocol`
- Result: commit ddc4b67a8 (`fenced` flag, cleared only by `connected`); verify 3/3. Codex review
  `batch-7.9-review.md` APPROVED 8/10, no new defect. Host contract (W8, C8 machine connection):
  leave a snapshot only by replacing the socket and dispatching `connected`; documented on
  `SessionViewSource`.

---

## Batch 8: C4a-1 driver lock port and kernel lock (revised Round 6) — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the core of W10 in one lib; cross-process specs fork children.
- Tasks: 1 | Depends on: Batch 1
- Phase: C | Phase review: at Batch 13
- Verify (Round 6): `npm run verify -- -p @ptah-extension/platform-core,ptah-electron,mcp-bench`

### Task 8.1: Interface, token, kernel and null locks, contract suite — COMPLETE

- Files: W/`libs/backend/platform-core/src/interfaces/session-driver-lock.interface.ts`,
  W/`libs/backend/platform-core/src/session-driver-lock/{endpoint-names.ts,kernel-session-driver-lock.ts,null-session-driver-lock.ts}`
  (+ specs, + `kernel-session-driver-lock.cross-process.spec.ts`),
  W/`libs/backend/platform-core/src/testing/contracts/run-session-driver-lock-contract.ts`,
  W/`libs/backend/platform-core/src/{di/tokens.ts,index.ts}`
- Plan reference: W10 :446-855 (fail closed, release retry and stranded state, A6, A8); C4a
  :1002-1043; AD-10
- Pattern to follow: `platform-core/src/di/tokens.ts:120`; cross-process precedent
  `file-settings-manager.cross-process.spec.ts`
- Quality requirements: Linux abstract namespace, Windows named pipe, darwin null; never
  displaces a live holder; release retried 3 times, then `stranded`, visible in `held()`
- Validation notes: R-H; A6 and A8 specs; edge cases hung/SIGSTOP holder and stranded release
- Implementation details: `node:net`, `os`, `fs` only; no native module

### Batch 8 verification

- Contract suite runs against both locks; cross-process spec passes; verify passes
- Result: executor Codex lane (implementer family codex; Phase C review must be non-codex).
  Orchestrator verify (lane sandbox blocks Nx): platform-core, ptah-electron, mcp-bench 14/15; the
  one failure is mcp-bench `snapshot-audits` mem.liveness.audit (5 s timeout, pre-existing: it
  passes with direct Jest on main and branch, 13/13). For Phase C review: Windows endpoint uses a
  hash of domain + username (Node has no SID API), see `batch-8-report.md` Decisions.

## Batch 9: C4a-2 control endpoint and local lock client (revised Round 6) — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: holder discovery and operator release (AD-23), same lib as Batch 8.
- Tasks: 1 | Depends on: Batch 8
- Phase: C | Phase review: at Batch 13
- Verify (Round 6): `npm run verify -- -p @ptah-extension/platform-core,ptah-electron,mcp-bench`

### Task 9.1: Control keys, control endpoint, `listLocalDriverLocks`/`requestRelease` — COMPLETE

- Files: W/`libs/backend/platform-core/src/session-driver-lock/{control-keys.ts,control-endpoint.ts,local-lock-client.ts}`
  (+ specs, cross-process listing/release spec), W/`libs/backend/platform-core/src/session-driver-lock/kernel-session-driver-lock.ts`
  (registration with the control endpoint), W/`libs/backend/platform-core/src/index.ts`
- Plan reference: W10 :486-534 (control endpoint `ptah-ctl-<uid>-<pid>`, 0600 `<pid>.key`,
  constant-time key check), cross-process test :626-636; AD-23
- Pattern to follow: Batch 8
- Quality requirements: release honoured only when the holder has no live session record;
  `in-use` refusal; wrong key refused; stale discovery files checked against the live endpoint;
  `requestRelease` resolves the holder pid from the session endpoint
- Validation notes: Windows pipe DACL assumption (key is the access control), decisions row 11
- Implementation details: keys in `~/.ptah/session-drivers/<pid>.key`

### Batch 9 verification

- Operator release, `in-use`, wrong-key specs pass; verify passes
- Result: executor Codex lane. Orchestrator verify: 14/15; the one failure is platform-core
  `agent-pack-download.service.spec.ts` A2 no-clobber (not touched; passes alone 29/29). The live-record
  predicate defaults to "live" (operator release refused) until Batch 10 wires the registry.

## Batch 10: C4a-3 registry lifecycle notifications (agent-sdk) (revised Round 6) — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: two agent-sdk files, independent of Batches 8-9 by file (parallel-eligible).
- Tasks: 1 | Depends on: Batch 1
- Phase: C | Phase review: at Batch 13
- Verify (Round 6): `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench`

### Task 10.1: `onRecordRemoved`, `onRealSessionIdBound`, `onRealSessionIdRebound` — COMPLETE

- Files: W/`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts`
  (+ spec), W/`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
- Plan reference: W10 :550-597 (rebind), C4a :1013-1019; AD-24
- Pattern to follow: existing registry event surface
- Quality requirements: `onRecordRemoved` from every removal point; `onRealSessionIdBound` from
  `bindRealSessionId`; `onRealSessionIdRebound({ tabId, oldSessionId, newSessionId,
  ownerToken })` from the `'rebound'` branch (`session-registry.service.ts:380-394`, re-read);
  re-exposed on `SessionLifecycleManager`; listener exceptions caught per listener
- Validation notes: fires for `claude-sdk` records only (native is Batch 13); spec per removal
  path
- Implementation details: no lock import in agent-sdk

### Batch 10 verification

- Spec per removal path and the rebound branch; verify passes
- Result: executor Codex lane. Orchestrator verify 18/18. Removal points: `remove` (only when the
  record still owns the tab index), `evictStale`, registration displacement. See `batch-10-report.md`.

## Batch 11: C4a-4 host bindings and DI smoke specs (revised Round 6) — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: D-1 exception: one-line bindings across platform-electron and platform-cli and the
  two host smoke specs must land together so every DI smoke spec stays green. Round 6 (D-9): the
  vscode-core default and the VS Code smoke file are dropped; the hosts left are Electron and
  cli-engine (worker host, mcp-bench).
- Tasks: 1 | Depends on: Batches 8, 9
- Phase: C | Phase review: at Batch 13
- Verify (Round 6): `npm run verify -- -p @ptah-extension/platform-electron,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,mcp-bench`

### Task 11.1: Bind the lock per host — COMPLETE

- Files: W/`libs/backend/platform-electron/src/registration.ts`,
  W/`libs/backend/platform-cli/src/registration.ts`,
  W/`apps/ptah-electron/src/di/surface-composition.spec.ts`,
  W/`libs/backend/cli-engine/src/lib/container-driver-lock.spec.ts` (create)
- Plan reference: C4a :1020-1043; Round 6 R6.3 component 4 (AD-30)
- Pattern to follow: existing platform bindings in each registration file
- Quality requirements: Electron and CLI bind `KernelSessionDriverLock` (darwin → null); no
  vscode-core default (a container without a binding fails at resolve); smoke specs assert the
  bound class
- Validation notes: R-H
- Implementation details: none

### Batch 11 verification

- Smoke specs assert the class on Electron and CLI; verify passes
- Result: executor Codex lane. Orchestrator verify 21/21. For Phase C review: the lock is bound
  with `useValue` (instance created at registration); check that the constructor does not open the
  control endpoint or any socket before first use.

## Batch 12: C4b driver lock enforcement (rpc-handlers) (revised Round 6) — COMPLETE

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: one lib, five production files, the hardest logic of the task; one executor keeps
  the coordinator and its call sites consistent.
- Tasks: 2 | Depends on: Batches 5, 10, 11
- Phase: C | Phase review: at Batch 13
- Verify (Round 6): `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,mcp-bench`

### Task 12.1: `SessionDriverLockCoordinator` — COMPLETE

- Files: W/`libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts`
  (+ spec, + `session-driver-lock-coordinator.cross-process.spec.ts`),
  W/`libs/backend/rpc-handlers/src/lib/chat/tokens.ts`, W/`libs/backend/rpc-handlers/src/lib/chat/di.ts`,
  W/`libs/backend/rpc-handlers/src/index.ts`
- Plan reference: W10 "Acquisition ownership" :684-693, "Native Codex runtime" :547-666,
  "Rewind path" :694-704, "Structural guard" :705-710, rebind :550-597; C4b :1044-1082; AD-24, AD-25
- Pattern to follow: other chat services in `chat/di.ts`
- Quality requirements: owner set per session ID (records, native leases, provisional entry);
  `beginDrive`, `abandonDrive`, `admitNative`, `assertDriveHeld`; rebind handoff acquire-new
  then release-old, fail closed (abort, end record); `pendingHandoff` gate; kernel release only
  when the owner set is empty; per-session serialization; no runtime filter
- Validation notes: R-H; a lock-port throw inside `admitNative` is `unavailable`; cross-process
  rebind spec uses a real `SessionRegistry` and `KernelSessionDriverLock`
- Implementation details: token `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR`; export the class
  type from the barrel for Batch 13

### Task 12.2: Call sites in `ChatSessionService` — COMPLETE

- Depends on: Task 12.1
- Files: W/`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (+ spec),
  W/`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.spec.ts`
- Plan reference: C4b :1056-1063 (anchors verified, see Plan validation)
- Quality requirements: `startSession` bound handler; `continueSession` after the `ptahCli`
  passthrough, before `gateAccount` (:1546); `resumeSession` before the activate branch;
  `ensureSessionActiveForRewind` after `gateAccount` (:2156), before `hasLiveSessionStream`
  (:2166); `assertDriveHeld` before `sdkAdapter.resumeSession` (:2437) in `autoResumeIfInactive`
- Validation notes: refusal names the holder; unavailable → no SDK call; release on each
  removal notification and failure path; rewind refusal surfaces via the handler's
  `RpcUserError` rethrow (`session-rpc.handlers.ts:1584`, no source change)
- Implementation details: none

### Batch 12 verification

- Coordinator, rewind and cross-process specs pass; verify passes
- Result: executor Codex lanes (initial + 2 fix rounds). Orchestrator verify (platform-core, agent-sdk,
  rpc-handlers, ptah-electron, mcp-bench, degradation-audit) 21/22; the one failure was load timeouts
  in platform-core `control-endpoint.cross-process` and `file-settings-manager.bench`, which pass
  alone (3/3). Decision (orchestrator): the live-record check is set on the lock port with
  `setLiveRecordCheck` by the coordinator from its owner set; platform libs do not import agent-sdk.
  `SessionRegistry` is now exported from the agent-sdk barrel (cross-process spec).
  For Phase C review: the cross-process child start timeout is 5 s with ts-node; fragile under load.

## Batch 13: C4c native Codex driver gate (revised Round 6) — COMPLETE (Phase C reviewed: style APPROVED 8/10; logic REVISE 7/10 with N1 carried to Batch 13.9)

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: D-1 exception: a required port in agent-sdk, its host-port type in rpc-handlers and
  its Electron wiring must compile together.
- Tasks: 3 | Depends on: Batch 12
- Phase: C (last) | Phase review: **code-logic + style for Phase C (Batches 8-13)**
- Verify (Round 6): `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench`

### Task 13.1: Gate port and adapter calls (agent-sdk) — COMPLETE

- Files: W/`libs/backend/agent-sdk/src/lib/codex-app-server/{codex-chat-adapter.ts,codex-chat-session-controls.ts}`,
  W/`libs/backend/agent-sdk/src/index.ts`,
  W/`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-driver-gate.spec.ts` (create),
  fakes in W/`libs/backend/agent-sdk/src/lib/codex-app-server/{codex-chat-adapter.spec.ts,codex-chat-turn-lifecycle.spec.ts}`
- Plan reference: C4c :1083-1119; W10 "Native Codex runtime" :547-666
- Pattern to follow: `CodexChatSessionLifecycle` (:131-137)
- Quality requirements: required `driver: CodexChatDriverGate`; `admit(resumeId, resume)` after
  `prepareProfile` (:283) before `openContext` (:286), or `admit(threadId, start)` after :287-290
  before staging (:291-294), then `checkOpening`; lease on `TrackedSession`; `lease.release()` in
  `close` (:87-91) and in `open`'s catch for an admitted unpublished lease; admit rejection
  rethrown unchanged, not via `failure()` (:306)
- Validation notes: R-I; call-order and exactly-once release specs per removal path
- Implementation details: agent-sdk knows nothing of the lock

### Task 13.2: Host port type and rpc-handlers specs — COMPLETE

- Depends on: Task 13.1
- Files: W/`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.ts`,
  W/`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts`,
  W/`libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts`,
  W/`libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-native.cross-process.spec.ts` (create)
- Plan reference: C4c files; team-leader mitigation R-A / D-3
- Quality requirements: `CodexChatHostPorts extends Omit<CodexChatAdapterPorts, 'driver'>`
  (:85); `createCodexChatHostPorts` unchanged otherwise; `chat-session.native.spec.ts:235` and
  `codex-chat-host-ports*.spec.ts` compile unchanged or with a fake gate
- Validation notes: R-A (plan defect)
- Implementation details: native cross-process spec per W10

### Task 13.3: Electron wiring — COMPLETE

- Depends on: Task 13.2
- Files: W/`apps/ptah-electron/src/di/codex-runtime-composition.ts` (+ `codex-runtime-composition.spec.ts`)
- Plan reference: C4c :1101-1104
- Quality requirements: `driver` next to `sessions` (:602), resolving the coordinator lazily via
  `CHAT_TOKENS.SESSION_DRIVER_LOCK_COORDINATOR` (precedent `codex-session-binding.ts:40-43`);
  composition spec asserts it
- Validation notes: cli-engine untouched (native ports bound to `null`, `nativeCodex: false`:
  `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:57-77`; Round 6)
- Implementation details: none

### Batch 13 verification

- Gate specs, native cross-process spec, Electron assertion pass; verify passes; then NEEDS
  REVIEW for Phase C
- Result: executor Codex lane. Orchestrator verify (agent-sdk, rpc-handlers, ptah-electron, mcp-bench,
  degradation-audit) 17/19: rpc-handlers failed only on the two cross-process specs ("Driver lock
  holder timed out"), which pass alone 2/2; mcp-bench failed only on `snapshot-audits`.
  REQUIRED for the Phase C fix round: the cross-process child start (ts-node) timeout is too short
  under load in three specs (platform-core control-endpoint, rpc-handlers coordinator and native).

---

## Batch 13.9: Phase C carry-over — keep the drive lock until the SDK record binds — COMPLETE

- Source: `code-logic-review-phase-c-final.md` N1 (Serious, Claude review). Decision row 24.
- Defect: `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` (~1928, ~2159, ~2359)
  calls `abandonDrive` unconditionally in `finally`. A Claude record binds its session ID only on the
  SDK `init` message, after `resumeSession` returns. If the RPC returns first, the provisional owner
  is dropped and the kernel lock is freed while the SDK is live; another process can take it.
- Fix: abandon only on failure, or only when no record or native lease owns the session. Test: the RPC
  completes before `init` and the lock stays held until the record binds or the attempt fails.
- Also fix the minors from decision row 24 when they are in the same files: the `driverLock = undefined!`
  default (pass the fake explicitly in specs) and the double `hasLiveRecord` call in `control-endpoint.ts`.
- Executor: backend-developer subagent (Claude). Review: Codex lane (different family).
- Verify: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/rpc-handlers,ptah-electron,mcp-bench,degradation-audit`
- Result: executor Claude subagent; commits 03dfe507b (settleDrive) and 518cb5d17 (per-attempt tokens,
  token-scoped removal, release gate). Verify 19/19 each time. Codex review: `batch-13.9-review.md` REVISE
  5/10 (three races) → `batch-13.9-review-round-1.md` APPROVED 8/10, no new defects.

---

## Batch 14: C6a worker state stores — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: file-backed stores with no network, first slice of C6.
- Tasks: 1 | Depends on: Batches 1, 3
- Phase: D | Phase review: at Batch 19
- Verify: `npm run verify -- -p @ptah-extension/worker-runtime`

### Task 14.1: Paths, workspace registry, tokens, pairing window, admin key, redaction — PENDING

- Files: W/`libs/backend/worker-runtime/src/lib/{paths,workspace-registry,token-store,pairing-window,admin-key,redact}.ts`
  (+ specs), W/`libs/backend/worker-runtime/src/index.ts`
- Plan reference: W3 :239-268, W4 :269-280, W5 :281-287; C6 :1140-1141, :1178
- Quality requirements: `workspaceId = 'ws_' + sha256(realpath)[0..12]`; world-readable
  `tokens.json` refuses start; 300 s window, 5 failures; identical rejections with the same
  minimum delay; code never logged; default grant snapshots workspaces at window open (Minor 2)
- Validation notes: edge case identical pairing rejections
- Implementation details: files under `~/.ptah/worker/`

### Batch 14 verification

- Pairing and grant specs pass; verify passes

## Batch 15: C6b event log and fan-out — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: W7 log-before-send is one ordering contract; one executor owns it.
- Tasks: 1 | Depends on: Batches 3, 6
- Phase: D | Phase review: at Batch 19
- Verify: `npm run verify -- -p @ptah-extension/worker-runtime`

### Task 15.1: Event capture, writer, log, fan-out — PENDING

- Files: W/`libs/backend/worker-runtime/src/lib/{event-capture,session-log-writer,session-event-log,fan-out}.ts`
  (+ specs), W/`libs/backend/worker-runtime/src/index.ts`
- Plan reference: W7 :318-373; C6 :1159
- Quality requirements: seq order; torn tail; interrupted recovery; no `evt` with `seq > head`
  under a slow write; append failure mid-turn → no later frame, abort, `ctl degraded`,
  `SESSION_LOG_FAILED`; `latestMark` rebuilt on open; malformed record → `TRANSCRIPT_UNAVAILABLE`
- Validation notes: tap (Batch 6) only observes; I/O happens in the writer
- Implementation details: per-session JSONL

### Batch 15 verification

- The two bold W7 specs exist and pass; verify passes

## Batch 16: C6c in-process RPC, method table, authorizer, capabilities (revised Round 6) — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the authorization surface and the drift specs share the method table.
- Tasks: 2 | Depends on: Batches 7, 14
- Phase: D | Phase review: at Batch 19
- Verify: `npm run verify -- -p @ptah-extension/worker-runtime`

### Task 16.1: Methods, authorizer, session index, in-process RPC — PENDING

- Files: W/`libs/backend/worker-runtime/src/lib/{worker-methods,worker-authorizer,worker-session-index,in-process-rpc}.ts` (+ specs)
- Plan reference: W6 :288-317, W12 :873-894; C6 :1145-1153; AD-19
- Quality requirements: authorization before handlers; outside-grant refusal per method for an
  outside, inside and nonexistent resource (2.9.4); per-method specs for `session:list`,
  `chat:start`, `chat:continue`, `chat:abort`; nested result validation; allow-list error copy
- Validation notes: R-N
- Implementation details: none

### Task 16.2: Worker host profile and capability document — PENDING

- Depends on: Task 16.1
- Files: W/`libs/backend/worker-runtime/src/lib/worker-host-profile.ts`,
  W/`libs/backend/worker-runtime/src/lib/capabilities/worker-capabilities.ts` (+ specs),
  W/`libs/backend/worker-runtime/src/index.ts`
- Plan reference: C6 :1171-1177; drift specs :1204-1209
- Quality requirements: `host: 'worker'`, `platform: 'cli'`, `filePicker: false`,
  `assertOnDrift: false`; drift spec (a) capability mapping incl. Electron profile (rows only);
  drift spec (b) remote surface equals `Object.keys(WORKER_METHODS)`. Round 6: the in-process
  parity half of (a) (`deriveRpcSurface(createWorkerRpcHostProfile())` vs the CLI profile)
  moves to Task 19.2: `createCliRpcHostProfile` is in cli-engine
  (`libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:18`, `scope:cli`), which this
  `scope:extension` lib may not import (`eslint.config.mjs:281-284`)
- Validation notes: rows follow "Phase 1 minimum capability set" (a)/(b)
- Implementation details: the module later generates the `worker.md` table (Batch 19)

### Batch 16 verification

- Drift and outside-grant specs pass; verify passes

## Batch 17: C6d session driver, approvals, transcript (revised Round 6) — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: turn tracking, approvals and transcript refresh share session state and the lock path.
- Tasks: 2 | Depends on: Batches 12, 15, 16
- Phase: D | Phase review: at Batch 19
- Verify: `npm run verify -- -p @ptah-extension/worker-runtime`

### Task 17.1: Session driver and transcript — PENDING

- Files: W/`libs/backend/worker-runtime/src/lib/{session-driver,transcript}.ts` (+ specs)
- Plan reference: W8 :374-436; C6 :1154-1158, :1160-1161; AD-18, AD-22
- Quality requirements: tab map and pre-resolution queue; `TURN_IN_FLIGHT`; `maxActiveTurns` →
  `WORKER_BUSY`; `NO_PROVIDER_READY`; lock via `chat:continue` (same coordinator); baseline and
  history marks; attach refresh under the lock; snapshot mode with `drivenBy` when held
  elsewhere; fail closed when unavailable
- Validation notes: A3 / R-K fixture JSONL spec; W8 attach cases
- Implementation details: snapshot via `CHAT_TOKENS.HISTORY_READ` → `readForResume`

### Task 17.2: Pending permissions and native capability limit — PENDING

- Depends on: Task 17.1
- Files: W/`libs/backend/worker-runtime/src/lib/pending-permissions.ts` (+ spec),
  W/`libs/backend/worker-runtime/src/lib/session-driver.ts`, W/`libs/backend/worker-runtime/src/index.ts`
- Plan reference: W9 :437-445; C6 :1147-1152, spec :1199-1203; AD-16
- Quality requirements: first answer wins; `codexExecution?.runtime === 'codex-app-server'`
  (`session-metadata-store.ts:263`, read via `get` :1424) → `CODEX_UNAVAILABLE`, no
  `chat:continue`, no lock call; metadata read error → refused; attach → snapshot; `claude-sdk`
  and metadata-less sessions take the normal path; auto-approve refused
- Validation notes: R-J. Round 6: the reason is the worker's cli-engine composition (native
  tokens `null`, `nativeCodex: false`, `libs/backend/cli-engine/src/lib/codex-runtime-composition.spec.ts:57-77`),
  not the removed CLI app; behaviour unchanged
- Implementation details: none

### Batch 17 verification

- Approval, turn, transcript and native-limit specs pass; verify passes

## Batch 18: C6e server, connection, readiness, service (revised Round 6) — PENDING

- Recommended executor: CLI lane backend capability (security specs pinned by a test-capability lane, Task 18.3)
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer; senior-tester for 18.3)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the network edge and the composition of all C6 units.
- Tasks: 3 | Depends on: Batch 17
- Phase: D | Phase review: at Batch 19
- Verify: `npm run verify -- -p @ptah-extension/worker-runtime`

### Task 18.1: Server, connection state machine, readiness — PENDING

- Files: W/`libs/backend/worker-runtime/src/lib/{worker-server,connection,readiness}.ts` (+ specs)
- Plan reference: W2 :228-238; C6 :1142-1144, :1162-1170; AD-4, AD-14
- Quality requirements: loopback literal only; `noServer` upgrade on `/rpc`; Host check; any
  `Origin` refused; other paths 404; timers released on close; readiness checks 1-7 with Node ≥ 22
  and `better-sqlite3` load, check 7 detail text per AD-25. Round 6 (plan R6.3 component 3):
  check 2 fix text "update the Ptah desktop package" (the runtime is the desktop's bundled Node);
  check 3 = Ptah package version (injected by the host, no packaging knowledge here) and protocol
  version; check 6 sources `ClaudeCliDetector`
  (`libs/backend/agent-sdk/src/lib/detector/claude-cli-detector.ts:130`) and
  `resolveEffectiveAuthRoute` (`libs/backend/auth-providers/src/lib/auth/effective-route.ts:55`);
  wording follows R6-Q1
- Validation notes: `EADDRINUSE` names the port
- Implementation details: none

### Task 18.2: Worker service — PENDING

- Depends on: Task 18.1
- Files: W/`libs/backend/worker-runtime/src/lib/worker-service.ts` (+ spec),
  W/`libs/backend/worker-runtime/src/index.ts` (public `createWorkerServer`)
- Plan reference: C6 :1178-1179
- Quality requirements: start opens logs, recovers turns, registers workspaces (A2), binds,
  writes `endpoint.json`; SIGTERM `ctl goodbye`, flush, release locks, remove `endpoint.json`
- Validation notes: A2 spec
- Implementation details: `createWorkerServer` is consumed by Batch 21's A1 spec

### Task 18.3: Security spec suite — PENDING

- Depends on: Task 18.2
- File: W/`libs/backend/worker-runtime/src/lib/worker-security.spec.ts` (create)
- Plan reference: C6 security bullets :1186-1190
- Quality requirements: every `RPC_METHOD_NAMES` entry pre-auth runs no handler spy and sends no
  session data; LAN bind refused; Host/Origin refusal; redaction
- Validation notes: R-N
- Implementation details: separate executor from 18.1-18.2 (test capability)

### Batch 18 verification

- Security suite passes; verify passes

## Batch 19: C7 headless worker host — `worker-host` lib and desktop packaging (revised Round 6) — PENDING

Replaces the Round 5 batch (`apps/ptah-cli` command group, removed on main). Plan: Round 6 R6.2,
R6.3 components 1-2, AD-26 … AD-29.

- Recommended executor: CLI lane backend capability for Tasks 19.2 and 19.4; Tasks 19.1 and 19.3
  (project scaffold, build target, builder config, scripts) on a devops capability lane
- Execution mode: sequential (19.1 → 19.2 → 19.3 → 19.4)
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer; devops-engineer for 19.1 and 19.3)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: D-1/D-10 exception: the new lib, the ptah-electron target that bundles its entry and
  the launcher must land together, or the desktop build references a missing entry.
- Tasks: 4 | Depends on: Batches 6, 9, 18
- Phase: D (last) | Phase review: **code-logic + style + review-security for Phase D (Batches 14-19)**
- Verify: `npm run verify -- -p @ptah-extension/worker-host,ptah-electron`
- Never run `build`, `build-worker-host`, `serve` or `package` targets; the packaged behaviour is
  checked in G-R (A10).

### Task 19.1: `@ptah-extension/worker-host` project scaffold — PENDING

- Files: W/`libs/backend/worker-host/{project.json,tsconfig.json,tsconfig.lib.json,tsconfig.spec.json,jest.config.ts,eslint.config.mjs,src/index.ts}`,
  W/`tsconfig.base.json` (alias `@ptah-extension/worker-host`), W/`nx.json` (lint/test include
  lists, as Batch 3 did for the four libs), W/`.commitlintrc.json` (scope `worker-host`)
- Plan reference: R6.3 component 1; AD-28
- Pattern to follow: W/`libs/backend/worker-runtime/project.json` (Batch 1 skeleton, typecheck
  target) and its jest/eslint files
- Quality requirements: tags `["scope:cli", "type:feature"]` (`eslint.config.mjs:319-326`);
  `typecheck` target; no `build` target (ptah-electron bundles the entry)
- Validation notes: A11 (implicit dependency added in 19.3)
- Implementation details: none

### Task 19.2: Commands, engine composition and entry — PENDING

- Depends on: Task 19.1
- Files: W/`libs/backend/worker-host/src/lib/**` (argv dispatch, one file per command group:
  serve, status, pair, workspace, grants, locks; the `withEngine` composition) (+ specs),
  W/`libs/backend/worker-host/src/worker-host.entry.ts`, W/`libs/backend/worker-host/src/index.ts`
- Plan reference: C7 :1211-1245 (command set and options, still valid) as amended by R6.3
  component 1; AD-12, AD-16
- Pattern to follow: headless boot `tools/mcp-bench/src/transport/bench-host-boot.ts:417`;
  `withEngine` `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:204` (test `bootstrap`
  hook), `:273-278`; `fixPath()` as `apps/ptah-electron/src/activation/bootstrap.ts:319`
- Quality requirements: `ptah-worker serve [--port 41873] [--max-active-turns N]`,
  `status [--json]`, `pair [--workspace …] [--ttl 300] [--json]`, `workspace add|remove|list`,
  `grants [list] [--json]`, `grants add <tokenId> <workspace…>`, `locks [--json]`,
  `locks release <sessionId> [--yes]`, `locks --self-test`; argv via `node:util` `parseArgs`
  (no new dependency); `serve`: `fixPath()`, refuse `--auto-approve` / `PTAH_AUTO_APPROVE=true`
  (`with-engine.ts:366`), refuse on Node < 22 or `better-sqlite3` failure, then
  `withEngine({}, { mode: 'full', thoth: 'off', hostProfile: createWorkerRpcHostProfile(),
  pushAdapter: new CliWebviewManagerAdapter({ tap, logger }) }, …)` running `createWorkerServer`
  until SIGTERM/SIGINT; Ptah version from the `package.json` beside the bundle, passed to
  worker-runtime; `locks` via platform-core `listLocalDriverLocks`/`requestRelease` (Batch 9);
  `locks release` confirms, refuses without `--yes` in non-TTY; no service → "worker service is
  not running"; one JSON line on stdout for `--json`, errors on stderr, non-zero exit on failure
- Validation notes: A8 self-test command; in-process parity drift spec moved from Task 16.2
  (`deriveRpcSurface(createWorkerRpcHostProfile())` vs `createCliRpcHostProfile('cli')`,
  `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts:18`)
- Implementation details: `serve` integration spec with a stub bootstrap and a real `ws`
  client; auto-approve and Node/`better-sqlite3` refusal specs (injected)

### Task 19.3: Desktop packaging — bundle target, launcher, systemd unit — PENDING

- Depends on: Task 19.2
- Files: W/`apps/ptah-electron/project.json` (target `build-worker-host`; `build.dependsOn` and
  `build-dev` commands; `implicitDependencies` += `@ptah-extension/worker-host`),
  W/`apps/ptah-electron/tsconfig.worker-host.json` (create),
  W/`apps/ptah-electron/worker-host/{ptah-worker,ptah-worker.service}` (create),
  W/`apps/ptah-electron/electron-builder.yml` (`linux.extraResources` → `bin/`, kept out of
  `app.asar`), W/`apps/ptah-electron/scripts/validate-deps.js` (scan `worker-host.mjs` too),
  W/`apps/ptah-electron/src/config/worker-host-packaging.spec.ts` (create)
- Plan reference: R6.3 component 2; A10, A11; AD-27, AD-29
- Pattern to follow: `build-workspace-watch-host` / `build-voice-worker` targets in
  `apps/ptah-electron/project.json`; esbuild `vscode` alias and banner from
  `tools/mcp-bench/project.json:99-125`; spec precedent `apps/ptah-electron/src/config/packaged-deps.spec.ts`
- Quality requirements: output `dist/apps/ptah-electron/worker-host.mjs` beside
  `workspace-watch-host.mjs` (`cli-workspace-watcher.ts:49-52`); externals are a subset of
  `apps/ptah-electron/package.json` dependencies; launcher is POSIX `sh`, resolves its own real
  path, then `ELECTRON_RUN_AS_NODE=1 exec "$appdir/ptah-desktop" "$appdir/resources/app.asar/worker-host.mjs" "$@"`;
  unit `ExecStart=/opt/Ptah/resources/bin/ptah-worker serve --port 41873`, `Restart=on-failure`,
  `RestartSec=5`, `KillSignal=SIGTERM`, `TimeoutStopSec=20`, `WantedBy=default.target`; the spec
  pins the target, output name, `extraResources` entry, launcher text and that no builder config
  disables the RunAsNode fuse
- Validation notes: A11 — if `ptah-electron` lint rejects the implicit dependency, use target
  `inputs` instead and report it
- Implementation details: Linux deb only (AppImage, Windows, macOS: no launcher)

### Task 19.4: `docs/worker.md` — PENDING

- Depends on: Task 19.3
- File: W/`libs/backend/worker-host/docs/worker.md` (create) (+ spec in worker-host comparing its
  capability table with worker-runtime's capability module)
- Plan reference: C7 docs bullet :1218-1232 as amended by R6.3 components 1-2, R6.4, R6.8
- Quality requirements: install = desktop deb build with worker mode (no Node or npm install);
  one provider CLI signed in (per R6-Q1); `ptah-worker workspace add`; start/stop via the user
  unit (`systemctl --user enable --now ptah-worker`; linger per R6-Q2); uninstall
  (`systemctl --user disable --now ptah-worker`, `rm -rf ~/.ptah/worker`); lifetimes and attempt
  limits; durability; permission timeout; lock behaviour and limitations (native Codex capability
  limit, older desktop builds); coexistence with the desktop GUI (plan R6.4); generated
  capability table; Phase 1 exit runbook incl. A1 real `ssh -W` and A10 node mode
- Validation notes: none
- Implementation details: none

### Batch 19 verification

- Command, parity and packaging specs pass; doc table matches the module; verify passes; then
  NEEDS REVIEW for Phase D

---

## Batch 20: C8a SSH transport, registry, token store (revised Round 6) — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: process and file boundaries of the Electron client, no connection logic yet.
- Tasks: 1 | Depends on: Batches 3, 5, 19
- Phase: E | Phase review: at Batch 22
- Verify (Round 6): `npm run verify -- -p @ptah-extension/worker-protocol,@ptah-extension/worker-runtime,@ptah-extension/remote-machines,@ptah-extension/machines-ui,@ptah-extension/worker-host`

### Task 20.1: Alias, ssh commands, stdio transport, registry, token store — PENDING

- Files: W/`libs/backend/remote-machines/src/lib/{ssh-alias,ssh-worker-commands,ssh-stdio-transport,machine-registry,machine-token-store}.ts`
  (+ specs), W/`libs/backend/remote-machines/src/index.ts`,
  W/`libs/worker-protocol/src/lib/worker-command.ts` (+ spec, create; Round 6),
  W/`libs/worker-protocol/src/index.ts`
- Plan reference: C8 :1246-1275; AD-5, AD-11; Round 6 R6.3 component 5, AD-29
- Quality requirements: alias regex rejects `-oProxyCommand=…`; `spawn` argument arrays,
  `shell: false`, `--`; 15 s timeout; zod-parsed output; atomic registry write; tokens via
  `ISecretStorage`
- Validation notes: AR5 plain-text keyring warning. Round 6: `WORKER_REMOTE_COMMAND =
  '/opt/Ptah/resources/bin/ptah-worker'` exported from worker-protocol; remote argv
  `['-o','BatchMode=yes','-o','ConnectTimeout=10','--', alias, WORKER_REMOTE_COMMAND, 'status'|'pair', '--json']`;
  remote exit 127 or "not found" → `version-mismatch` "This Ptah build on <Machine> has no
  worker mode. Update the Ptah desktop app there." (never `ptah worker …`)
- Implementation details: exact ssh option lists from the plan (C8; the `-W 127.0.0.1:<port>`
  transport is unchanged)

### Batch 20 verification

- Alias and argument-array specs pass; verify passes

## Batch 21: C8b connection, service, RPC handlers — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: stateful client and the renderer-facing handlers; the A1 spec needs Batch 18.
- Tasks: 2 | Depends on: Batches 4, 18, 20
- Phase: E | Phase review: at Batch 22
- Verify: `npm run verify -- -p @ptah-extension/remote-machines`

### Task 21.1: Machine connection, service, handlers — PENDING

- Files: W/`libs/backend/remote-machines/src/lib/{machine-connection,machines-service,machines-rpc.handlers}.ts`
  (+ specs), W/`libs/backend/remote-machines/src/index.ts`
- Plan reference: C8 :1253-1262; W11 :856-872
- Quality requirements: backoff 1, 2, 5, 10, 30 s ±20%, one timer per machine; re-attach with
  `afterSeq`; broadcast via `TOKENS.WEBVIEW_MANAGER`; no main-side buffer; zod params; worker
  codes → W11 codes; never returns tokens; `machines:readiness` includes the Electron local lock
  self-test (A8); online and offline removal (`revokeSelf` 5 s, delete token and entry, kill
  child)
- Validation notes: edge case offline removal
- Implementation details: `register()` pattern `register-rpc-surface.ts:183-190`

### Task 21.2: A1 Duplex integration spec — PENDING

- Depends on: Task 21.1
- File: W/`libs/backend/remote-machines/src/lib/machine-connection.integration.spec.ts` (create)
- Plan reference: C8 :1271-1273; A1
- Quality requirements: real `ws` server from `createWorkerServer` over a Duplex pair
- Validation notes: A1 (real SSH stays in G-R)
- Implementation details: imports `@ptah-extension/worker-runtime` public entry only

### Batch 21 verification

- A1 Duplex spec and removal specs pass; verify passes

## Batch 22: C9 Electron host wiring — PENDING

- Recommended executor: CLI lane backend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: four Electron files; removes the Batch 7 interim expectation.
- Tasks: 2 | Depends on: Batches 7, 21
- Phase: E (last) | Phase review: **code-logic + review-security for Phase E (Batches 20-22)**
- Verify: `npm run verify -- -p ptah-electron`

### Task 22.1: Register singletons, capability, dispose; restore surface spec — PENDING

- Files: W/`apps/ptah-electron/src/rpc-host-profile.ts`, W/`apps/ptah-electron/src/di/phase-4-handlers.ts`,
  W/`apps/ptah-electron/src/di/rpc-surface.spec.ts`, W/`apps/ptah-electron/src/activation/wire-runtime.ts`
  (or the quit/dispose site it uses)
- Plan reference: C9 :1276-1287
- Quality requirements: `remoteMachines: true`; `hostHandlers['host.remoteMachines']:
  MachinesRpcHandlers`; `MachinesService` disposed on quit; "excludes nothing" restored (R-C)
- Validation notes: registration failure only warns (`register-rpc-surface.ts:183-196`)
- Implementation details: none

### Task 22.2: Confirm Electron `ws` declaration — PENDING

- Depends on: Task 22.1
- File: none to change unless Batch 1 got it wrong; report only
- Plan reference: R-G
- Quality requirements: state whether Electron main imports `ws` at runtime and whether
  `apps/ptah-electron/package.json` declares it; if it is missing, report it to the
  team-leader (fix goes in a follow-up batch owning that file)
- Validation notes: pre-push `validate-deps` gate runs on the next push
- Implementation details: none

### Batch 22 verification

- Electron surface spec back to "excludes nothing"; verify passes; then NEEDS REVIEW for Phase E

---

## Batch 23: C10a Machines state layer — PENDING

- Recommended executor: CLI lane frontend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: signal store, feed and API wrapper; no visual output.
- Tasks: 1 | Depends on: Batches 4, 5, **gated step G-D APPROVED**
- Phase: F | Phase review: at Batch 26
- Verify: `npm run verify -- -p @ptah-extension/machines-ui`

### Task 23.1: `MachinesApi`, `MachinesFeed`, `MachinesStore` — PENDING

- Files: W/`libs/frontend/machines-ui/src/lib/services/{machines-api,machines-feed,machines-store}.ts`
  (+ specs), W/`libs/frontend/machines-ui/src/index.ts`
- Plan reference: C10 :1288-1325
- Pattern to follow: `libs/frontend/tasks-ui/src/lib/services/`
- Quality requirements: per-session `SessionEventReducer`; 4.2 spec (duplicates and a gap across a
  simulated reconnect render equal to no disconnect); A5 spec; offline never marks sessions failed
- Validation notes: watch-only per revised 4.9
- Implementation details: `MachinesApi` wraps `ClaudeRpcService`; feed via `MESSAGE_HANDLERS`

### Batch 23 verification

- 4.2 and A5 specs pass; verify passes

## Batch 24: C10b machine list, pairing, readiness (revised Round 6) — PENDING

- Recommended executor: CLI lane frontend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: the machine-level screens (design 4.1-4.5).
- Tasks: 1 | Depends on: Batch 23
- Phase: F | Phase review: at Batch 26
- Verify: `npm run verify -- -p @ptah-extension/machines-ui`

### Task 24.1: View, list, status atom, add pane, readiness panel — PENDING

- Files: W/`libs/frontend/machines-ui/src/lib/components/{machines-view,machine-list,machine-status,add-machine-pane,readiness-panel}/*` (+ specs),
  W/`libs/frontend/machines-ui/src/index.ts`
- Plan reference: C10 :1294-1297; design-spec.md sections 3, 4.1-4.5, 5, 6
- Pattern to follow: `libs/frontend/tasks-ui/src/lib/components/`; prototype screens 01-05b
- Quality requirements: alias datalist; 8-cell code with paste; "Pair automatically via SSH";
  4.3 banners (attempt count per Q2: shown over SSH only); seven readiness checks; version
  mismatch shows both versions; `ptah-glass` tokens. Round 6 copy (plan R6.3 component 6;
  design layout unchanged): copyable pairing command = `WORKER_REMOTE_COMMAND` + ` pair`
  (design-spec.md:56 says `ptah worker pair`); readiness footer names `WORKER_REMOTE_COMMAND` +
  ` status` (design-spec.md:71 `ptah worker doctor`, marked TBC); "no worker mode" mismatch copy
  from Batch 20
- Validation notes: none
- Implementation details: component specs per state

### Batch 24 verification

- Component specs per state; verify passes

## Batch 25: C10c remote sessions (revised Round 6) — PENDING

- Recommended executor: CLI lane frontend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A
- Review family: different from implementer
- Rationale: session screens (design 4.6-4.10) including the revised watch-only 4.9.
- Tasks: 2 | Depends on: Batch 24
- Phase: F | Phase review: at Batch 26
- Verify: `npm run verify -- -p @ptah-extension/machines-ui`

### Task 25.1: Session list, approval block, banners — PENDING

- Files: W/`libs/frontend/machines-ui/src/lib/components/{remote-session-list,remote-approval-block,reconnect-banner}/*` (+ specs)
- Plan reference: C10 :1297-1301; design 4.6-4.8, revised 4.9
- Quality requirements: Allow once / Deny with untruncated args; 7c neutral denial; "Fetching
  missing events" with replay; `SESSION_DRIVER_LOCK_UNAVAILABLE` fix text; 4.9 watch-only per G-D.
  Round 6 copy: the 9d stranded fix line names `WORKER_REMOTE_COMMAND` + ` locks release <session id>`
  (design-spec.md:123 says `ptah worker locks release`)
- Validation notes: R-M
- Implementation details: none

### Task 25.2: Remote session view — PENDING

- Depends on: Task 25.1
- Files: W/`libs/frontend/machines-ui/src/lib/components/remote-session-view/*` (+ spec),
  W/`libs/frontend/machines-ui/src/index.ts`
- Plan reference: C10 :1298-1300; A7 :1312-1314
- Quality requirements: reuses local transcript presentational components; "Claude on
  <Machine>"; composer rules 4.6; snapshot labelled "last saved state"
- Validation notes: A7 checked first; fallback `@ptah-extension/chat-execution-tree` builders
- Implementation details: none

### Batch 25 verification

- Specs pass; verify passes

## Batch 26: C10d shell, route and surface ID (revised Round 6) — PENDING

- Recommended executor: CLI lane frontend capability
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (frontend-developer)
- Subagent reason: N/A (the visual review that follows is a subagent: visual-reviewer, Electron)
- Review family: different from implementer
- Rationale: D-1 exception: route ID, route, shell tab and welcome button must land together
  (R-B).
- Tasks: 2 | Depends on: Batches 22, 25
- Phase: F (last) | Phase review: **code-logic + style + visual for Phase F (Batches 23-26)**;
  visual in Electron, dark and light, against the revised prototype
- Verify (Round 6): `npm run verify -- -p @ptah-extension/shared,@ptah-extension/machines-ui,@ptah-extension/chat,@ptah-extension/core,ptah-extension-webview,ptah-electron,mcp-bench,ptah-landing-page`

### Task 26.1: `'machines'` surface ID and route — PENDING

- Files: W/`libs/shared/src/lib/types/webview-surface.types.ts` (+ `webview-surface.types.spec.ts`),
  W/`apps/ptah-extension-webview/src/app/{app.routes.ts,app.config.ts}`,
  W/`libs/frontend/core/src/lib/routing/surface-routes.ts` (only if it enumerates IDs)
- Plan reference: C2 surface part :973-978 (moved, D-4); C10 :1308-1311
- Pattern to follow: Tasks route `app.routes.ts:144` with `surfaceActiveFor('tasks')`
- Quality requirements: `'machines'` in `ViewType` and `SURFACE_ROUTE_IDS`; exact-list spec
  updated; route-loop specs in `webview-routing.spec.ts` pass (Electron-only reachability as for
  the other Electron surfaces)
- Validation notes: R-B; re-read both files (reworked after plan base)
- Implementation details: none

### Task 26.2: Shell tab, welcome branch, welcome button, badge — PENDING

- Depends on: Task 26.1
- Files: W/`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts` (+ spec),
  W/`libs/frontend/chat/src/lib/components/templates/electron-welcome.component.ts`
- Plan reference: C10 :1301-1306; D11, D12
- Quality requirements: Machines tab between Tasks and Analytics outside the
  `hasWorkspaceFolders()` guard (:233); welcome branches (:385-388, :431) yield to `'machines'`;
  "Machines (N connected)" button; approval badge; Electron-only; shell no-folder spec
- Validation notes: edge case no-folder state reaches the Machines view
- Implementation details: none

### Batch 26 verification

- All listed apps pass verify; then NEEDS REVIEW for Phase F (code-logic, style, visual); after
  acceptance, gated step G-R and Mode 3
