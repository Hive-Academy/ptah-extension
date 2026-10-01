# Batches - TASK_2026_586_2b3e

Total tasks: 22 | Batches: 6 | Complete: 6/6

Worktree root (all paths below): `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed`
Branch: `fix/task-586-thoth-activity-feed`, base `c4ab013f3`.
Inputs: task.md, context.md (`## User Decisions`), parity-inventory.md (56 capabilities), verdict section C
(`.ptah/specs/TASK_2026_439_1310/tribunal/verdict.md:115-151`), visual-review-before.md. BUGFIX, plan-free.

## Recorded defaults (chosen by team-leader; judgment delegated by the orchestrator prompt)

- Order: backend contract first (id + newest-first), then the feed data path, then the new Activity/Settings
  components (unmounted), then the wiring + accordion removal, then the shell tiles, then the e2e harness for
  the AFTER visual run. Batch 5 has no dependency on Batches 1-4 and may run while they are reviewed, but it
  commits in order.
- Executors: in-process sub-agents only (backend-developer, frontend-developer). All batches sequential.
- Cross-side review (backend contract + webview consumer) goes to ONE CLI lane (antigravity or Glm, whichever
  `ptah_agent_list` reports available; max 2 lanes in flight). In-process code-logic-reviewer for single-side
  batches. visual-reviewer gates Batch 6 with the AFTER run.
- Event id: a ULID string from `monotonicFactory()` of the `ulid` package (already a root dependency,
  `package.json:194`, and already used in `libs/backend/skill-synthesis`, e.g. `skill-candidate.store.ts`).
  Same-millisecond events get strictly increasing ids. No persistence is added (TASK_2026_587 owns the ledger).
- Grouping key (frontend): consecutive events in newest-first order with the same `kind` AND the same
  `sessionId` AND (for `kind === 'error'` only) the same `error` text collapse into one row with a count. The
  row tracks by the NEWEST member's id. `limit` (default 10) counts rows, not raw events.
- Skills tile scope: mirror the Skills tab list exactly - explicit `scope: 'workspace'`, `limit: 1000` (the
  handler's `clampLimit` ceiling, `skills-synthesis-rpc.handlers.ts:2218-2223`). Rows with `workspace_root IS
NULL` stay counted: that is the store's deliberate rule (`skill-candidate.store.ts:381-389`, "dropping those
  would make them invisible in every workspace forever") and the Skills tab list shows them too.
- Expected `libs/shared` change: `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` only (one
  field). No change to `rpc.types.ts`, `messages/index.ts`, `MESSAGE_TYPES` or the payload map.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- A1. `skill-synthesis-ui` specs are transpile-only (`tsconfig.spec.json:9` `isolatedModules: true`) and its
  `typecheck` target compiles `tsconfig.lib.json` only (`project.json:20-24`), so making `id` required on the
  wire does not turn existing frontend spec fixtures red between Batch 1 and Batches 2-4. Verified on disk.
  Frontend LIB sources only read the wire type (DSS, PSC, FEED; `back-office-activity.service.ts` in core reads
  only). Verified by grep of `SkillSynthesisEventWire` (12 files).
- A2. `rpc-handlers` jest runs with ts-jest diagnostics ON (`libs/backend/rpc-handlers/jest.config.ts:10`), so
  the handler mapping must change in the same batch as the shared type. Verified; drives the Batch 1 lib
  exception below.
- A3. In Electron the backend `workspaceProvider.getWorkspaceRoot()` (used by `listScope`,
  `skills-synthesis-rpc.handlers.ts:2170-2175`) already points at the workspace the webview shows when
  `AppStateManager.workspaceInfo()` changes. VERIFIED for workspace SWITCH by Task 5.1 (webview calls
  `setWorkspaceInfo` only after `workspace:switch` succeeds, `electron-layout.service.ts:467-485, :719-729,
:794-799`; the handler sets the active folder before returning, `workspace-rpc.handlers.ts:329`; provider and
  lifecycle are one object, `platform-electron/src/registration.ts:150-159`). FALSE for folder CLOSE, and the
  gap predates this task: `ElectronLayoutService.removeFolder` (`electron-layout.service.ts:392-406`) picks a
  new active folder in the webview without `workspace:switch`, while the backend falls back to `folders[0]`
  (`electron-workspace-provider.ts:159-161`). It usually corrects itself through WORKSPACE_CHANGED
  (`workspace-restore.ts:166-182`), but a race can leave the two roots different for good.
- A4. No backend caller of `SkillSynthesisService.recentEvents()` depends on oldest-first order. UNVERIFIED -
  Task 1.2 greps every caller (`diagnostics.service.ts:31-32` is the known one) before reversing.
- A5. The webview-e2e harness can rebuild `ptah-extension-webview` in development configuration with ~3 GB
  free (it did at base, with sourcemaps deleted afterwards). UNVERIFIED for the AFTER run - Batch 6 review step.

| Risk                                                                                                                                                                                                         | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1. The accordion is the only caller of `DSS.startPolling()` (parity Key finding 1); removing it freezes PSC and drops drift correction                                                                      | HIGH     | Task 3.3 moves poll start/stop + refresh-on-mount (user decision item 4) into the new Activity feed component; Task 4.3 asserts polling starts when Activity is shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R2. Second `events[0]`-as-latest consumer: `ineligibleHint` (`skill-synthesis-tab.component.ts:769-780`)                                                                                                     | MEDIUM   | Task 4.1 re-derives it from the newest event; Task 4.3 spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R3. Live events can arrive out of order or duplicate a snapshot row (snapshot fetched after the push, then the push message lands)                                                                           | MEDIUM   | Task 2.1: ordered insert by (timestamp desc, id desc) and dedupe by id; snapshot normalised to the same order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R4. Snapshot carries only 10 events today (`diagnostics.service.ts:28`, frontend never passes `eventLimit`), so grouping would collapse the window to 2-3 rows                                               | MEDIUM   | Task 2.1 passes `eventLimit: 50` (same constant as the live cap); schema max is 200 (`skills-synthesis-rpc.schema.ts:258`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R5. Overlapping tile refreshes (tab switch then workspace switch) can let a stale response overwrite a newer one                                                                                             | MEDIUM   | Task 5.1 adds a refresh generation token; results from a superseded refresh are dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R6. Backend root differs from the webview root (A3)                                                                                                                                                          | MEDIUM   | Task 5.1 verification. If they can diverge, the executor STOPS and reports: fixing it needs `workspaceRoot` on `SkillSynthesisListCandidatesParams` in `libs/shared/src/lib/types/rpc.types.ts:2451`, a second shared change that the orchestrator constraints forbid without a blocker. RESOLUTION (Batch 5): no stop. On switch the roots cannot diverge (A3). On folder close they can, but this is not a BLOCKER. The gap predates this task, Batch 5 does not introduce it, and it affects every consumer of the backend root, including the Skills tab list that Batches 1-4 left unchanged. Adding `workspaceRoot` to `rpc.types.ts` would not fix it either, because the webview root itself is the stale one after `removeFolder`. The fix belongs in `libs/frontend/core` `electron-layout.service.ts` (`removeFolder` should go through `workspace:switch`). Recorded as an OUT-OF-SCOPE FOLLOW-UP; the orchestrator raises it at the PR gate |
| R7. Trigger persistence differs from the Settings form: triggers save immediately per control via `skillSynthesis:setTriggers`, Settings saves one batched form (`skill-synthesis-tab.component.ts:972-985`) | MEDIUM   | Task 3.5 keeps triggers as a separate card with immediate save and its own error text; it is NOT merged into `settingsForm`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R8. Grouping could hide distinct failures                                                                                                                                                                    | LOW      | Grouping key includes `error` text for `error` events (recorded default)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R9. Required `id` breaks a backend spec that `toEqual`s event lists                                                                                                                                          | LOW      | Task 1.4 updates `skill-synthesis.service.spec.ts` / handler spec to assert ids explicitly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R10. Batch 1 spans 3 libs (cap is 2)                                                                                                                                                                         | LOW      | Explicit exception: the shared edit is one field; splitting leaves an intermediate commit where `rpc-handlers` fails its jest diagnostics (A2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R11. Skills tile capped at 100 (`skills-synthesis-rpc.handlers.ts:409`)                                                                                                                                      | LOW      | Task 5.1 passes `limit: 1000`; a residual ceiling of 1000 is documented in the code comment. Batch 5 note: the Skills tab list still uses the default limit of 100, so with more than 100 pending candidates the tile and the list show different numbers. This is LOW and recorded as a follow-up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R12. Opening Activity now makes two diagnostics calls (TAB init `:929` + feed component mount)                                                                                                               | LOW      | Accepted by the user (decision item 4: the poll owner refreshes on mount). TAB:929 stays because the Sessions hint and the Settings triggers read the same snapshot on other sub-views                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R13. AFTER visual run: webview rebuild on low disk; Settings shots showed only "Loading..." at base because Providers RPCs were not fixtured                                                                 | MEDIUM   | Task 6.1 adds the Providers/settings RPC fixtures (from `skills-lane-pickers.e2e.spec.ts`); Batch 6 review step deletes sourcemaps after build                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Edge cases:

- Two events of the same kind in the same millisecond, different sessions - two rows, two distinct ids
  (Tasks 1.4, 2.4, 4.3).
- Two events of the same kind, same session, same millisecond - one grouped row "x2", tracked by the newer
  ULID (Task 2.4).
- Live event arrives before the first snapshot, or after a snapshot that already contains it - no duplicate
  row (Task 2.2).
- Live event older than the current head (out-of-order delivery) - inserted at its sorted position, not at
  the top (Task 2.2).
- Empty event list - "No recent events." stays (Task 2.4).
- Ring eviction at 200 (C1) - newest-first window still correct after `shift()` (Task 1.4).
- `limit` smaller than the number of groups - shows the newest `limit` groups (Task 2.4).
- Workspace switch to `null` root; tab switch while a refresh is in flight (Task 5.3).
- Settings opened before the diagnostics snapshot resolves - triggers render `DEFAULT_TRIGGERS`
  (`skill-diagnostics-state.service.ts:15-20`, parity B9) (Task 3.6).
- Analyze-now with no active session - disabled with hint (parity B10) (Task 3.4).

## Acceptance coverage (context.md `## Acceptance`)

| Acceptance spec                                                                                          | Batch / Task                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability: production feed path renders the newest event first                                        | Backend: Task 1.4 (`recentEvents` + snapshot handler order). Webview production path TAB -> real DSS -> real feed with a stubbed RPC: Task 4.3. Real bundle: Task 6.1 assertion |
| Reachability: repeated same-kind events are grouped                                                      | Unit: Task 2.4. Production path: Task 4.3. Real bundle: Task 6.1                                                                                                                |
| Stable row identity: same kind, same millisecond -> two rows, each tracked by its real id                | Backend distinct monotonic ids: Task 1.4. Feed rows expose `data-event-id` = real id and no NG0955 warning: Task 2.4. Tab path: Task 4.3                                        |
| Tile refresh: switch tabs then workspaces -> tiles reload; Skills tile counts only the current workspace | Task 5.4 (shell spec with the real `ThothStatusService`) + Task 5.3 (service spec)                                                                                              |
| UI change: visual-reviewer before/after, dark + light                                                    | Before: done (`visual-review-before.md`). After: Batch 6 review gate                                                                                                            |

## Parity mapping (parity-inventory.md -> task)

- A1-A8 keep: untouched except A3 (newest-first, Task 4.3 asserts the chip follows the newest event) and A7
  (histogram reused, Task 3.1).
- B1 accordion removed (APPROVED): Task 4.2. B2 absolute last-run time, B3 last curator pass, B4 sessions
  analyzed today, B5 histogram bars: Task 3.1 (PSC). B6 Candidates by status (NOT approved for removal; moves
  to PSC): Task 3.1. B7 feed: Task 3.3. B8 triggers -> Settings: Task 3.5 + 4.1. B9 trigger defaults: Task 3.6.
  B10 Analyze current session: Task 3.3. B11 "View logs" -> "Refresh" on PSC: Task 3.1 + 4.1. B12 error text:
  Task 3.3 (Activity) + Task 3.5 (Settings). B13 30 s poll: Task 3.3. B14 refresh on mount (NOT approved for
  removal): Task 3.3.
- C1-C17: C2 Task 1.2; C5 Tasks 1.1-1.3; C7/C8 Task 2.1; C9-C14 Task 2.3; C15 Task 4.1; C3 Task 2.1
  (`eventLimit`); C4, C6, C16, C17 untouched.
- D1-D4, E1-E2 keep untouched (E1 receives the triggers card beside it, Task 4.1).
- F1-F11 keep; F5 Task 5.1/5.2; F6 Task 5.3; F9 Task 5.1.

## Batch 1: Event id and newest-first, backend contract — COMPLETE (commit e8dedb800)

- Recommended executor: backend-developer (in-process sub-agent)
- Fallback executor: a second backend-developer invocation scoped to the failing task only
- Execution mode: sequential
- Rationale: one contract change threaded through shared -> skill-synthesis -> rpc-handlers; every task depends
  on the type from Task 1.1. Lib-count exception (3 libs, 6 files) recorded as R10.
- Tasks: 4 | Depends on: none

### Task 1.1: Add the real event id to the wire type — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts
- Plan reference: context.md "Scope" + "Out of scope"; parity C5; verdict.md:142 ("a real event id as the track key")
- Pattern to follow: the existing readonly fields at `rpc-curator-diagnostics.types.ts:50-56`
- Quality requirements: `readonly id: string` (required) on `SkillSynthesisEventWire`, with a doc comment:
  ULID, unique per event, lexicographically sortable, stable between the live push and the snapshot, shape
  reserved for the phase-6 ledger. No other change in libs/shared.
- Validation notes: R10; A1 (frontend libs only read this type).
- Implementation details: one field plus doc comment.

### Task 1.2: Assign a monotonic ULID on push; return the window newest-first — COMPLETE

- Files:
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/skill-synthesis/src/lib/diagnostics.types.ts
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts
- Depends on: Task 1.1
- Plan reference: context.md root cause 1 and 2; parity C1, C2, C5, root-cause table rows 1a and 2
- Pattern to follow: ULID use in `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (import from
  `ulid`); ring buffer at `skill-synthesis.service.ts:992-997`; mapper at `:1019-1035`; `recentEvents` at
  `:1037-1040`
- Quality requirements:
  - `SkillSynthesisEvent` gains `readonly id: string`. `pushEvent` accepts the event WITHOUT an id (an exported
    input type such as `Omit<SkillSynthesisEvent, 'id'>`) so the existing callers
    (`triggers/skill-trigger.service.ts`, the service itself) do not change, and assigns the id from a
    `monotonicFactory()` instance owned by the service, seeded with the event's `timestamp`.
  - `toEventWire` carries `id`.
  - `recentEvents(limit)` returns the newest `limit` events NEWEST-FIRST (copy, never mutate the ring).
  - Update the JSDoc on `recentEvents` and `diagnostics.service.ts:31-32`'s consumer expectations if a comment
    states the order (do not otherwise edit `diagnostics.service.ts`).
- Validation notes: A4 - grep every caller of `recentEvents(` in `libs/backend` and `apps` first and report
  each one with its order dependency; R9.
- Implementation details: `import { monotonicFactory } from 'ulid'`; `private readonly nextEventId =
monotonicFactory();` `const stored = { ...ev, id: this.nextEventId(ev.timestamp) }` pushed and broadcast.

### Task 1.3: Carry the id through the diagnostics snapshot handler — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts
- Depends on: Task 1.2
- Plan reference: parity C5 (HND:714-720); constraint check "rpc-handlers ... skill-synthesis handler is allowed"
- Pattern to follow: the existing `recentEvents.map` at `skills-synthesis-rpc.handlers.ts:714-720`
- Quality requirements: map `id: e.id`; preserve the order `getSnapshot` returns (newest-first); touch nothing
  else in the file (no list-scope change - the tile fix is frontend-only, see recorded defaults).
- Validation notes: A2.
- Implementation details: one added property.

### Task 1.4: Backend specs for order, identity and wire id — COMPLETE

- Files:
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts
- Depends on: Tasks 1.2, 1.3
- Plan reference: context.md "Acceptance" bullets 1 and 2
- Pattern to follow: `skill-synthesis.service.spec.ts:391` (wire mapping) and `:776` (ring); handler spec `:331`
- Quality requirements:
  - `recentEvents` returns newest-first; with `limit` < size it returns the newest `limit`; still correct after
    ring eviction past 200. The test must FAIL against `slice(-safe)` (oldest-first).
  - Two `pushEvent` calls with the same kind and identical `timestamp` produce two distinct 26-char ULIDs, the
    second lexicographically greater; the broadcast payload carries the same id as the ring entry.
  - Handler snapshot: `recentEvents[i].id` present and order preserved from `getSnapshot`.
  - Update any existing `toEqual` on event lists to account for `id` (assert real ids, no `expect.any` that
    would hide a missing id on the wire).
- Validation notes: R9.
- Implementation details: use fixed timestamps; no real timers needed.

### Batch 1 execution record (team-leader, Mode 2)

- Verified on disk: 6 planned files plus 1 out-of-plan file,
  `libs/backend/skill-synthesis/src/lib/diagnostics.service.spec.ts` (the fixture gets an `id` because ts-jest
  diagnostics require it). This is a fixture-only change, accepted.
- Out-of-plan helper `ulidSeedTime` (`skill-synthesis.service.ts`): a timestamp that a ULID cannot encode seeds
  from the clock instead of throwing inside `pushEvent`. Accepted, pending review.
- A4 resolved: the only production caller is `diagnostics.service.ts:31-32` (pass-through, does not depend on
  order). The specs use `.some()`. Only the old ring test depended on oldest-first, and it was rewritten.
- Executor verification: typecheck and lint pass for 3 projects; shared and skill-synthesis tests pass;
  rpc-handlers has 3391 passed and 1 failed (`harness-skill-selection-rpc.service.spec.ts:113`). The
  orchestrator reports that the same failure occurs on the main checkout without this diff, so it is
  pre-existing and unrelated.
- R14 (new, MEDIUM): two mappers turn the same event into different wire shapes. The live `toEventWire` folds
  `candidateId`/`reason` into `stats`; the snapshot map (`skills-synthesis-rpc.handlers.ts:714-722`) copies
  `stats` only. So one id carries different `stats` live and in the snapshot, which contradicts the Task 1.1
  doc comment ("identical in the live push and in the diagnostics snapshot") and changes which copy the
  Batch 2 id dedupe keeps. The difference existed before this task; the review decides whether Batch 1 must
  close it (single mapper) before commit.
- Review 1: antigravity CLI lane (code-logic-reviewer role), NEEDS_REVISION, 6/10, report `code-logic-review.md`.
  Ruling: R14 must be closed in Batch 1 with a single mapper. `ulidSeedTime` ordering is sound; the curator
  cast drop is type-safe; no stub or TODO markers. Tasks 1.2-1.4 are back to IN_PROGRESS for the revision below.
- Revision scope (same executor; one file added, the lib's public index):
  - SERIOUS-1 / R14: export one pure `toSkillSynthesisEventWire(ev: SkillSynthesisEvent): SkillSynthesisEventWire`
    from `libs/backend/skill-synthesis` (through `libs/backend/skill-synthesis/src/index.ts`), use it in
    `pushEvent` (replacing the private `toEventWire`) and in `skills-synthesis-rpc.handlers.ts:716`
    (`snapshot.recentEvents.map(toSkillSynthesisEventWire)`).
  - MODERATE-1: `ulidSeedTime` floors a finite timestamp before the range check
    (`skill-synthesis.service.ts:200-206`); non-finite, zero or negative timestamps still fall back to the clock.
  - MINOR-1: the handler spec fixture includes an `ineligible` event with `reason` and `candidateId` and asserts
    that the snapshot wire `stats` equals the live broadcast `stats` for the same id. Also add a spec
    for a fractional timestamp.
- Revision 1, checked on disk:
  - New file `libs/backend/skill-synthesis/src/lib/event-wire.ts` holds the pure `toSkillSynthesisEventWire`.
  - It is exported from `libs/backend/skill-synthesis/src/index.ts`.
  - `pushEvent` broadcasts through it, and the private `toEventWire` is deleted.
  - The handler maps the snapshot with `snapshot.recentEvents.map(toSkillSynthesisEventWire)`.
  - `ulidSeedTime` rejects non-finite timestamps, then rounds down and checks the range.
  - Specs: the handler snapshot `stats` now include `candidateId` and `reason`; the broadcast and the snapshot
    produce the same mapping for the same id; a fractional timestamp encodes its rounded-down millisecond.
  - Executor verification: all targets pass for 3 projects, except the known
    `harness-skill-selection-rpc.service.spec.ts:113` failure, which fails on main too.
  - Batch 1 now changes 9 files: 6 planned, plus `diagnostics.service.spec.ts`, `event-wire.ts` and
    `src/index.ts`. Tasks 1.2-1.4 are IMPLEMENTED again. Awaiting re-review.

### Batch 1 verification

- Every listed file exists and contains the work above; `git diff --name-only` shows only these 6 files
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers` passes (output tailed)
- Reviewer: code-logic-reviewer (in-process) - single-side backend contract; id uniqueness, ordering and
  broadcast/snapshot id equality are behavioural
- A4 caller list reported

## Batch 2: Feed data path - ordering, dedupe, grouping, identity — COMPLETE (commit 9e9ff7b4c)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: second frontend-developer invocation for the failing task
- Execution mode: sequential
- Rationale: state service and the feed component are coupled by the newest-first contract; small (4 files, 1 lib)
- Tasks: 4 | Depends on: Batch 1

### Task 2.1: Newest-first state with id dedupe and a larger snapshot window — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts
- Plan reference: context.md root cause 1; parity C3, C7, C8, root-cause row 1b
- Pattern to follow: `skill-diagnostics-state.service.ts:163-196`
- Quality requirements:
  - One exported constant for the window (50) used both for the live cap and `eventLimit` in `refresh()`.
  - `pushLiveEvent`: drop if an event with the same id is already present; otherwise insert at its sorted
    position by (timestamp desc, id desc); cap at the window. Side effects on last-run timestamps and the
    histogram unchanged, but only when the event is new (a duplicate must not bump the histogram twice).
  - `applySnapshot`: normalise `recentEvents` to the same order (defensive; makes the webview independent of
    backend order and lets the e2e fixture stay realistic).
  - Update the JSDoc ("chronological" is wrong after this change).
- Validation notes: R3, R4. Do NOT touch `TabManagerService` usage (chat-state is read-only consumption).
  R14 was closed in Batch 1 (`e8dedb800`): the live push and the snapshot both go through
  `toSkillSynthesisEventWire`, so the same id carries the same payload on both paths and the dedupe may keep
  the copy already in the list.
- Implementation details: a small private `insertSorted` / `sortNewestFirst` helper; ULIDs compare as strings.

### Task 2.2: State service spec — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.spec.ts
- Depends on: Task 2.1
- Pattern to follow: existing cases at `:85` (snapshot), `:168` (poll)
- Quality requirements: newest live event becomes `recentEvents()[0]`; duplicate id ignored and histogram not
  double-bumped; out-of-order live event lands at its sorted position; oldest-first snapshot is normalised;
  `refresh()` sends `eventLimit` = the window constant; cap holds at 50.

### Task 2.3: Grouped, id-tracked, newest-first feed rows — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts
- Plan reference: context.md root causes 1-3; parity C9-C14; visual-review-before defects 1-3 and 8
- Pattern to follow: `event-feed.component.ts:15-145` (keep badge colours C11, outcome text C12, empty state C13)
- Quality requirements:
  - Exported pure function (same file) that groups consecutive events by the recorded grouping key and returns
    rows `{ id (newest member), kind, sessionId, newestTimestamp, oldestTimestamp, count, event (newest) }`.
  - `limit` applies to rows; `@for ... track row.id`; each row renders `data-event-id="{{ row.id }}"` and, for
    count > 1, a visible count badge (e.g. "x5") plus an accessible label ("5 events").
  - Outcome cell keeps `truncate` but gains a `title` with the full text (defect 8).
  - Component doc states the input contract: newest-first.
- Validation notes: R8.
- Implementation details: computed signal over `events()` and `limit()`.

### Task 2.4: Feed spec (grouping + identity acceptance) — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.spec.ts
- Depends on: Task 2.3
- Pattern to follow: `event-feed.component.spec.ts:15-85` (host component with an `events` signal)
- Quality requirements (each must fail against the base implementation):
  - Five consecutive `analyze-run` for one session render ONE row with count 5; a different session breaks the
    group.
  - Two `ineligible` events with identical `timestamp`, sessions A and B, render two rows whose
    `data-event-id` values equal the two real ids; a `console.warn`/`console.error` spy records no NG0955.
  - Same session + same ms -> one row "x2" tracked by the newer id.
  - Newest event is the first row; `limit` keeps the newest N rows; empty state unchanged; two `error`
    events with different text stay separate.

### Batch 2 execution record (team-leader, Mode 2)

- Verified on disk: only the 4 planned files changed.
- State service (`skill-diagnostics-state.service.ts`):
  - `SKILL_EVENT_WINDOW = 50` is both the live cap and the `eventLimit` sent with every snapshot request.
  - Events are ordered by `compareNewestFirst` (later timestamp first, then larger id).
  - The snapshot is deduplicated, sorted and capped, then still replaces the whole list (C8).
  - `pushLiveEvent` ignores a duplicate id before any side effect, then inserts the event at its sorted position.
- Feed (`event-feed.component.ts`):
  - exported pure function `groupConsecutiveEvents`;
  - rows tracked by `row.id`, with `data-event-id` on each row;
  - count badge, with "N events" for screen readers;
  - full outcome text in the `title` of the truncated cell.
- Beyond the plan, accepted pending review: "last analysis" and "last curator pass" now only move forward
  when an older event arrives late.
- Executor verification: typecheck, lint and test pass for skill-synthesis-ui (27 suites, 441 tests).
- Gaps the executor reported as accepted, which the review must rule on:
  - (a) a duplicate push older than the 50-event window is not recognised; the next poll corrects it;
  - (b) a live event that lands while a snapshot request is in flight can be overwritten by the snapshot; the
    next poll restores it (merging the two would change C8);
  - (c) `SKILL_EVENT_WINDOW` is not exported from the lib index (only used inside the lib).
- Review: Glm CLI lane (cross-side code-logic), APPROVED 8/10, `code-logic-review.md` `## Batch 2`.
  - Gaps (a) and (b) accepted as MODERATE-1 and MODERATE-2: they are transient and corrected by the next poll,
    and (b) is the base behaviour (C8).
  - Forward-only last-run times accepted.
  - MINOR-1: a jest worker force-exit warning during teardown; the tests pass.
  - The webview path from the Skills tab to the feed was not checked; it is covered by Task 4.3.

### Batch 2 verification

- Files exist with real logic; only these 4 files changed
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/skill-synthesis-ui` passes
- Reviewer: CLI lane cross-side review (antigravity or Glm per `ptah_agent_list`) - this is the first batch
  that consumes the Batch 1 wire contract; the lane must read both `skill-synthesis.service.ts` (producer) and
  DSS/FEED (consumer) and confirm field names, nullability, ordering and id equality across live and snapshot

## Batch 3: Surviving status card, Activity feed owner, Settings triggers (unmounted) — COMPLETE (commit f62ade78e)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: two frontend-developer invocations, one per component pair
- Execution mode: sequential
- Rationale: moves every accordion capability into new homes without wiring them yet, so the commit is green
  and the accordion still works; needs judgment on layout inside PSC (6 files, 1 lib)
- Tasks: 6 | Depends on: Batch 2

### Task 3.1: Status card absorbs the accordion summary rows and the Refresh button — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts
- Plan reference: parity B2, B3, B4, B5, B6, B11; context.md User Decisions items 2 and 3
- Pattern to follow: PSC inputs at `skill-pipeline-status.component.ts:277-299`; source markup ACC:30-94,
  ACC:198-204; `diagnostics/eligibility-histogram.component.ts`
- Quality requirements:
  - New optional inputs (defaults keep the public export in `src/index.ts:3` compatible): `lastCuratorPassAt:
number | null`, `byStatus: SkillByStatusCounts | null`, `refreshing: boolean`.
  - Band 1 shows: relative "Last analysis" plus the absolute time (`toLocaleString()` or "Never") as secondary
    text and `title`; "Last curator pass" absolute or "Never"; "Sessions analyzed today (N)" = sum of three
    buckets; `ptah-eligibility-histogram` bars from the existing `histogram` input.
  - "Candidates by status" (Candidates / Promoted / Rejected) from `byStatus`.
  - A "Refresh" button (label exactly "Refresh", disabled while `refreshing`) emitting a `refresh` output.
  - `reasonChip` keeps reading `events[0]`, now documented as the newest (input contract newest-first).
  - No injected services: PSC stays input-driven (keeps the `now` seam, A8).
- Validation notes: do not duplicate a fact already on the card (the verdict's overlap problem): the today
  counts line (A4) and the new total + histogram must read as one block, not two summaries.

### Task 3.2: Status card spec — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts
- Depends on: Task 3.1
- Pattern to follow: `skill-pipeline-status.component.spec.ts:123`, `:224`, `:262`
- Quality requirements: absolute last-run + "Never"; last curator pass; sessions-today total; three histogram
  bars; candidates by status; Refresh emits and disables while `refreshing`; reason chip follows the FIRST
  (newest) event when an older `ineligible` sits behind a newer `error` (fails on base semantics with
  oldest-first input).

### Task 3.3: Activity feed owner component (feed, poll, analyze-now, errors) — COMPLETE

- File (new): D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.ts
- Plan reference: parity B7, B10, B12 (Activity), B13, B14 + User Decision item 4
- Pattern to follow: ACC:96-105 (feed section, keep `data-test="panel-events"`), ACC:178-207 (analyze-now +
  error), ACC:235-242 (init/destroy)
- Quality requirements:
  - Selector `ptah-skill-activity-feed`; injects `SkillDiagnosticsStateService`.
  - `ngOnInit`: `refresh()` then `startPolling()`; `ngOnDestroy`: `stopPolling()` (ref-counted, unchanged
    DSS API).
  - Renders "Recent events" with `ptah-skill-event-feed` bound to `state.recentEvents()`.
  - "Analyze current session" button: disabled without an active session, hint text, calls
    `state.analyzeNow()` (force semantics unchanged in DSS).
  - Error text from `state.error()` with `role="alert"`.
- Validation notes: R1 (this is now the ONLY `startPolling` caller - confirm by grep), R12.

### Task 3.4: Activity feed owner spec — COMPLETE

- File (new): D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.spec.ts
- Depends on: Task 3.3
- Pattern to follow: `skill-diagnostics-accordion.component.spec.ts:83`, `:113`, `:139`, `:147`, `:155-185`
  (port the moved cases)
- Quality requirements: refresh + startPolling on init, stopPolling on destroy; feed renders newest first;
  analyze-now disabled/enabled/hint/called; error text shown.

### Task 3.5: Settings triggers card (immediate save) — COMPLETE

- File (new): D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.component.ts
- Plan reference: parity B8, B9, B12 (Settings); context.md Scope "Move the trigger toggles to Settings"
- Pattern to follow: ACC:107-170 and ACC:244-305 (all 8 controls and their handlers), `skill-trigger-toggle.component.ts`
- Quality requirements:
  - Selector `ptah-skill-triggers-settings`; keep `data-test="panel-triggers"`; card heading "Triggers" with a
    one-line note that changes save immediately.
  - All 8 controls with identical semantics and bounds: sessionEnd, idleMs (on -> 600000), bootScan,
    subagentStop, turnComplete, postToolUse, postToolUseMinEditCount (1-20), maxAnalyzesPerHour (0-1000,
    on -> 60); each calls `state.setTriggers(partial)`.
  - Error text from `state.error()`.
  - Does NOT start polling and does NOT bind to `settingsForm`.
- Validation notes: R7; B9 defaults render before the snapshot resolves.

### Task 3.6: Settings triggers spec — COMPLETE

- File (new): D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.component.spec.ts
- Depends on: Task 3.5
- Pattern to follow: `skill-diagnostics-accordion.component.spec.ts:125`, `:201`, `:223`, `:245`, `:267`
- Quality requirements: every moved trigger case ported (8 controls, bounds, on-defaults); default triggers
  render before refresh; setTriggers error text shown; no `startPolling` call.

### Batch 3 execution record (team-leader, Mode 2)

- Verified on disk: `skill-pipeline-status.component.ts` and its spec modified; `skill-activity-feed.component.ts`,
  `skill-triggers-settings.component.ts` and both their specs created. The accordion and the tab component are
  untouched, nothing new is mounted, and there are no TODO, PLACEHOLDER or STUB markers.
- Activity feed component: `ngOnInit` calls `refresh()` and then `startPolling()`; `ngOnDestroy` calls
  `stopPolling()`.
- Triggers card: all 8 controls map through a single `switch` to `setTriggers`; it never polls and is not
  bound to `settingsForm`.
- `startPolling()` callers outside specs: `skill-activity-feed.component.ts:83` and the accordion
  (`:237`, which goes away in Batch 4).
- Executor verification: typecheck and test pass (29 suites, 470 tests); lint has 0 errors and 3 pre-existing
  warnings, none in Batch 3 files.
- Noted, not a defect: `state.error()` is shared, so a diagnostics refresh error also appears on the Settings
  triggers card. Parity B12 accepts this.
- Reviewer changed from the plan: the orchestrator sends the review to a CLI lane (antigravity; Glm is at its
  quota) because the author ran in-process. The scope is unchanged (code-logic).
- Review: antigravity CLI lane (code-logic), APPROVED 9/10, no defects, `code-logic-review.md` `## Batch 3`.

### Batch 3 verification

- 2 modified + 4 new files; real logic, no stubs
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/skill-synthesis-ui` passes
- Reviewer: code-logic-reviewer (in-process) - poll ownership, ref counting, immediate-save semantics and
  parity of the 8 trigger controls are behavioural

## Batch 4: Wire Activity and Settings, remove the accordion, tab-level acceptance — COMPLETE (commit 4dcf03df5)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: second frontend-developer invocation
- Execution mode: sequential
- Rationale: one tab file, its spec and the deletions are one rollback unit (4 files, 1 lib)
- Tasks: 3 | Depends on: Batch 3

### Task 4.1: Rewire the Skills tab — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts
- Plan reference: context.md root cause 4, Scope bullets 3-4; parity A1, B1, B8, B11, C15, E1
- Pattern to follow: Activity case `:472-574`, Settings case `:582-602`, `ineligibleHint` `:769-780`
- Quality requirements:
  - Activity: remove `<ptah-skill-diagnostics-accordion />` and its import; keep PSC and pass
    `[lastCuratorPassAt]`, `[byStatus]`, `[refreshing]="diagnostics.loading()"`, `(refresh)="diagnostics.refresh()"`;
    mount `<ptah-skill-activity-feed />` directly after PSC; digest and specs cards unchanged (D1, D2).
  - Settings: mount `<ptah-skill-triggers-settings />` as its own card next to `ptah-skill-settings-panel`
    (panel untouched).
  - `ineligibleHint`: document and assert that `recentEvents()[0]` is the newest.
  - `ngOnInit` diagnostics refresh (`:929`) stays (R12).
- Validation notes: R2.

### Task 4.2: Delete the accordion — COMPLETE

- Files (delete):
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.ts
  - D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-diagnostics-accordion.component.spec.ts
- Plan reference: User Decision item 1 (APPROVED)
- Quality requirements: grep shows zero remaining references to `SkillDiagnosticsAccordionComponent` /
  `ptah-skill-diagnostics-accordion` outside `.ptah/specs`, except the e2e spec locator owned by Batch 6.
  `skill-trigger-toggle.component.ts` and `eligibility-histogram.component.ts` stay (now used by the new homes).

### Task 4.3: Tab-level reachability and parity specs — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.spec.ts
- Depends on: Tasks 4.1, 4.2
- Pattern to follow: existing Activity cases `:335`, `:495`, `:539`; Settings `:685`, `:874`
- Quality requirements:
  - A new `describe` that provides the REAL `SkillDiagnosticsStateService` and REAL child components with a
    stubbed `SkillDiagnosticsRpcService` (plus `AppStateManager`, `TabManagerService` stubs) - the production
    path TAB -> DSS -> activity feed -> event feed.
  - Newest-first: snapshot seeded OLDEST-first (as the base backend sent it) plus one live push via
    `pushLiveEvent`; the first feed row is the newest event (fails if DSS appends at the tail or the feed
    shows the oldest window).
  - Grouping: five repeated `analyze-run` for one session render as one row with count 5.
  - Identity: two same-ms `ineligible` events (different sessions) render two rows with their real ids.
  - Parity: accordion absent; triggers card present on Settings and absent on Activity; PSC shows Candidates by
    status and a "Refresh" button that calls `diagnostics.refresh`; polling started while Activity is shown and
    stopped when switching sub-view; `ineligibleHint` follows the newest event; PSC reason chip follows the
    newest event (A3).

### Batch 4 execution record (team-leader, Mode 2)

- Verified on disk: `git diff --stat` shows exactly 2 modified files (the tab and its spec) and 2 deleted files (the
  accordion and its spec). The untracked e2e harness spec and `screenshots/` belong to Batch 6 and are not part of
  this batch.
- Tab: PSC binds `[lastCuratorPassAt]`, `[byStatus]`, `[refreshing]="diagnosticsLoading()"` and
  `(refresh)="onRefreshDiagnostics()"` (`:476-486`). `<ptah-skill-activity-feed />` comes right after it (`:488`).
  `<ptah-skill-triggers-settings />` comes after the settings panel (`:597`). `ineligibleHint` is documented as
  newest-first (`:781-782`), and the `ngOnInit` refresh stays (`:944`).
- Accepted deviation: `diagnostics` is private, so the template uses the protected `diagnosticsLoading` (`:764`) and
  `onRefreshDiagnostics()` (`:956`), which delegate to it. Behaviour is the same.
- Leftover references: `git grep` finds the accordion only in the spec assertion that it is absent (`spec:1178`).
  The e2e harness does not reference it. The only `startPolling()` caller outside specs is
  `skill-activity-feed.component.ts:83`.
- Spec: the new describe block (`spec:1010`) has 8 cases that cover every Task 4.3 requirement, plus A3. No
  TODO, PLACEHOLDER or STUB markers.
- Team-leader re-run: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/skill-synthesis-ui
--skip-nx-cache` passes.
- Review: antigravity CLI lane (cross-side code-logic), APPROVED 9/10, `code-logic-review.md` `## Batch 4`.
  Parity rows B1-B14, A1, A3, C15, D1, D2 and E1 are reachable; 28 suites and 466 tests pass.
- MODERATE-1 (overlapping `refresh()` clears `_loading` early, `skill-diagnostics-state.service.ts:133-148`):
  recorded as a follow-up and not fixed in this task. At base (`c4ab013f3`, `:83-95`) `refresh()` sets and
  clears `_loading` the same way, unguarded. Batch 2 did not change that body, and none of this batch's risks
  covered it. The effect is cosmetic: the spinner can clear while a duplicate snapshot RPC is still in flight.
  No data is lost. Suggested fix: share the in-flight promise.
- MINOR-1 (two snapshot RPCs on first mount, tab `ngOnInit` + feed `ngOnInit`): kept by design (R12 and user
  decision 4). This matches base, where the tab and accordion `ngOnInit` both refreshed.

### Batch 4 verification

- 2 modified, 2 deleted; nothing else changed
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/skill-synthesis-ui` passes
- Reviewer: CLI lane cross-side review (antigravity or Glm) - the batch completes the producer-to-screen path;
  the lane checks every parity row B1-B14 against the RPC that backs it (diagnostics, analyzeNow, setTriggers)
  and confirms no capability was dropped

## Batch 5: Shell tiles refresh on tab switch; Skills tile workspace scope — COMPLETE (commit f71e01714)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: second frontend-developer invocation
- Execution mode: sequential
- Rationale: service and shell are coupled through `refreshIfNeeded`/`refresh`; 4 files across 2 libs;
  independent of Batches 1-4
- Tasks: 4 | Depends on: none (commits after Batch 4)

### Task 5.1: Tile service - refresh on demand, stale-result guard, explicit scope — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/dashboard/src/lib/services/thoth-status.service.ts
- Plan reference: context.md root cause 6 and Scope bullet 5; parity F5, F6, F9, Key finding 4
- Pattern to follow: `thoth-status.service.ts:162-170` (workspace effect), `:236-266`, `:300-314`
- Quality requirements:
  - Refresh generation token: each `refresh()` captures a generation; pillar loaders write results only if
    their generation is still current (R5).
  - `loadSkills` passes `{ status: 'candidate', scope: 'workspace', limit: 1000 }` with a comment citing the
    NULL-origin rule and the 1000 ceiling (R11).
  - `refreshIfNeeded` remains for first load; tab switches call `refresh()`.
- Validation notes: A3/R6 - before coding, read the Electron workspace-switch path (apps/ptah-electron
  `workspace-restore.ts`, `wire-runtime.ts`, and the workspace RPC that the webview calls) and report whether the
  backend `workspaceProvider` root is updated before `AppStateManager.workspaceInfo()` changes. If it can lag
  or differ, STOP and report it as a blocker (needs a `libs/shared/src/lib/types/rpc.types.ts` change).

### Task 5.2: Shell refreshes tiles on tab switch — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts
- Depends on: Task 5.1
- Pattern to follow: `selectTab` at `thoth-shell.component.ts:266-269` (F7 path), `ngOnInit` `:214-216`
- Quality requirements: `selectTab` sets the tab and triggers `thothStatus.refresh()` when the tab actually
  changes (no refresh on re-click of the active tab); first load stays `refreshIfNeeded()`.

### Task 5.3: Tile service spec — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/dashboard/src/lib/services/thoth-status.service.spec.ts
- Depends on: Task 5.1
- Pattern to follow: `:208` (once-only, revise), `:445`, `:465` (workspace effect)
- Quality requirements: `refresh()` reloads all pillars; a superseded refresh's late response does not
  overwrite the newer result; Skills call carries `scope: 'workspace'` and `limit: 1000`; switch to a `null`
  root still refreshes.

### Task 5.4: Shell acceptance spec - tab switch then workspace switch — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.spec.ts
- Depends on: Tasks 5.2, 5.3
- Pattern to follow: `thoth-shell.component.spec.ts:195`, `:217`
- Quality requirements: with the REAL `ThothStatusService` and stubbed RPC services whose `listCandidates`
  answers by `scope` (workspace rows vs all rows) and by the current root: open shell (3) -> backend count
  changes -> switch tab -> Skills tile shows the new count -> switch workspace -> tile reloads with the other
  workspace's count; the tile never shows the all-workspaces count. Fails on base (`refreshIfNeeded` no-op).

### Batch 5 execution record (team-leader, Mode 2)

- Verified on disk: `git diff --name-only` showed exactly the 4 batch files. The untracked e2e harness spec and
  `screenshots/` belong to Batch 6 and were not staged.
- R5: `refresh()` takes a generation (`thoth-status.service.ts:245-246`). Every loader checks `isCurrent()` before
  it writes, on both success and error paths (`:305, :314, :335, :342, :356, :368, :380, :390`). The final
  `_isLoading` write is guarded at `:270`. R11: `loadSkills` passes `scope: 'workspace'` and `limit: 1000`, and
  the comment explains why (`:323-333`). Shell: `selectTab` calls `refresh()` (`thoth-shell.component.ts:274`),
  and first load still uses `refreshIfNeeded()` (`:215`). No TODO, PLACEHOLDER or STUB markers.
- A3/R6 finding reported (see A3 and the R6 resolution above).
- Review: antigravity CLI lane (code-logic), APPROVED 8/10, `code-logic-review.md` `## Batch 5`. The dashboard
  has 13 suites and 115 tests, and thoth-shell has 1 suite and 7 tests. All pass.
- MODERATE-1 (each rapid tab switch starts 4 RPCs, with no debounce or abort): recorded as a follow-up and not
  fixed. Refreshing on every tab change is what Task 5.2 and the acceptance require. The generation token (R5),
  which this batch was meant to carry, already stops stale state, so the only cost is extra read-only RPC load,
  limited by how fast a person can click. A debounce would delay the refresh the acceptance spec asserts.
  Suggested fix: share the in-flight refresh, or debounce it by about 150 ms.
- MODERATE-2 (the tile does not show when the 1000 cap is hit): recorded as a follow-up under R11. The 1000
  ceiling was the decided default and is documented in the code. Showing `1000+` is a display change outside
  this batch's scope.
- MINOR-1 (with more than 100 candidates the tile and the list disagree): this is R11's recorded follow-up.
  MINOR-2 (folder-close root divergence): this is R6's OUT-OF-SCOPE FOLLOW-UP, which existed before this task.

### Batch 5 verification

- Only these 4 files changed
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard @ptah-extension/thoth-shell` passes
- A3 finding reported
- Reviewer: code-logic-reviewer (in-process) - refresh race and scope are behavioural, single side (webview)

## Batch 6: E2E harness for the AFTER visual run — COMPLETE (commit 8a5f58c93)

- Recommended executor: frontend-developer (in-process sub-agent)
- Fallback executor: visual-reviewer may patch the fixtures itself during its run if locators drift
- Execution mode: sequential
- Rationale: one untracked harness spec (created by the before-run) must be fixed and committed so the AFTER run
  is reproducible
- Tasks: 1 | Depends on: Batches 4 and 5

### Task 6.1: Update and commit the Thoth feed visual spec — COMPLETE

- File: D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/thoth-feed-visual.e2e.spec.ts (currently untracked)
- Plan reference: visual-review-before.md "Reproduce", "Limitations"; R13
- Pattern to follow: `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/skills-lane-pickers.e2e.spec.ts`
  (Providers/settings fixtures: `auth:getEffectiveRoute`, `config:getScopes`, `agent:getConfig`, and whatever
  else the Settings sub-view requests)
- Quality requirements:
  - Fixture events carry ULID-shaped `id`s (two same-ms `ineligible` with distinct ids) and stay oldest-first
    as at base (the webview normalises order).
  - Add the Providers/settings RPC fixtures so shot 06 renders the Settings sub-view with the Triggers card,
    not "Loading...". Shot 05 targets `[data-test="panel-triggers"]` on Settings.
  - `skillSynthesis:listCandidates` answers by `scope` ('workspace' -> current-workspace rows only).
  - Assertions (not only screenshots): first feed row is the newest `error`; `analyze-run` for `sess-1001`
    is one row with count 5; two same-ms rows have distinct `data-event-id`; accordion absent; the Skills tile
    shows the workspace count after the tab switch.
  - `SHOT_DIR` behaviour unchanged.
- Validation notes: do not run the Playwright suite in this task (needs a webview rebuild; the visual-reviewer
  does it).

### Batch 6 execution record (team-leader, Mode 2)

- Verified on disk: the only code change is the e2e spec (641 lines). It has ULID-shaped ids from
  `ulidLike` (`:70-78`) and an oldest-first seed (`:81-152`). `listCandidates` answers by scope (`:340-352`).
  The Providers/settings fixtures are plain data (`:224-275`, R13). Assertions: tile 2 then 3 (`:534`, `:554`);
  no accordion and no triggers panel on Activity (`:564-569`); "Candidates by status" and an enabled Refresh
  (`:573-578`); the first row is the newest id (`:584`); sess-1001 is one row with x5 (`:590-598`); the two
  same-ms rows each have their own id (`:600-607`); the triggers card shows on Settings and the feed is absent
  there (`:624-628`). `SHOT_DIR` is unchanged. No TODO, PLACEHOLDER or STUB markers.
- Accepted deviation: shot 06 is now Skills > Settings, not the app Settings view from the BEFORE run, because
  the triggers card moved there.
- Executor verification: `nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness` passes. The
  harness typecheck target does not compile `*.e2e.spec.ts`. `tsc -p tsconfig.spec.json` reports no errors in
  this file; its 4 errors are in other files and were there before this task.
- Review: visual-reviewer, APPROVED, `visual-review.md`. Webview rebuilt and sourcemaps deleted; disk had
  ~52 GB free, which settles A5. The spec passes 6/6 and produced 36 PNGs. BEFORE defects 1-7 are fixed at every
  viewport and in both themes. 0 blocking, 2 moderate, 6 minor.
- M1 (375 px shell clipping): the same as BEFORE, so it predates this task. Recorded as an OUT-OF-SCOPE
  FOLLOW-UP.
- M2 (narrow feed rows): recorded as a follow-up, not fixed in this task.
  - The reviewer's "no title" claim is wrong. The outcome cell has `[attr.title]="row.outcome"`
    (`event-feed.component.ts:122-125`, Batch 2), and a static screenshot cannot show a hover title. So the
    full error text is reachable, and defect 8 is mitigated, not left unchanged.
  - What remains is polish: the relative time wraps because its column has no `whitespace-nowrap`
    (`:112`), and the session id truncates (`:117`).
  - No acceptance criterion and no Batch 6 risk covers this. At 375 px the pre-existing shell overflow (M1)
    makes it worse.
  - Suggested fix: `whitespace-nowrap shrink-0` on the time span, a `title` on the session span, and a
    click-to-expand or wrap for `error` rows.
- Minor m1-m6 are recorded in `visual-review.md`; none needs action in this task. m1 is a capture artifact:
  shot 06 shows the Triggers card at 375 px.
- Screenshots: before/ has 36 files (1.74 MB), after/ has 36 files (1.92 MB), 3.7 MB in total, largest file
  122 KB. That size is fine for git. Other tasks already commit spec screenshots under `.ptah/specs` (for
  example TASK_2026_494). They go into the docs(task-specs) commit with `visual-review.md`, not the code commit.

### Batch 6 verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/webview-e2e-harness` passes
- Reviewer: visual-reviewer - AFTER run: rebuild `ptah-extension-webview` (development configuration), delete
  sourcemaps after build (R13/A5), run the spec with `SHOT_DIR=.ptah/specs/TASK_2026_586_2b3e/screenshots/after`
  at 375/1024/1366, dark (`anubis`) and light (`anubis-light`); compare against `screenshots/before` defects 1-8;
  the 375 px shell clipping is a pre-existing base defect, not a regression

## QA (Gate 3: senior-tester) — COMPLETE (commit a570c7d9a)

- Verdict PASS, `test-report.md`. 46 tests added in 3 spec files; no production file modified (verified with
  `git status` before the commit). Prettier check passes on all three specs.
- skill-synthesis-ui: 30 suites, 491 passed. rpc-handlers: 3412 passed, 4 skipped, 1 failed. The failure is
  `harness-skill-selection-rpc.service.spec.ts:113`, which also fails on main and predates this task. Lint and
  typecheck pass for both projects. Mutation checks showed the specs fail when the code they cover is broken.

## Follow-ups (raise at the PR gate; none block this task)

1. R6, out of scope and present before this task: after a folder is closed, the webview workspace root can
   differ from the backend root. Fix in `libs/frontend/core` `electron-layout.service.ts`: `removeFolder`
   should go through `workspace:switch`.
2. R11 and Batch 5 MINOR-1: the Skills tab list still uses the default limit of 100 while the tile uses 1000,
   so above 100 pending candidates they show different counts.
3. Batch 5 MODERATE-2: at the 1000 ceiling the tile shows 1000 instead of `1000+`.
4. Batch 5 MODERATE-1: each tab switch starts 4 read-only RPCs with no debounce or abort. The generation guard
   prevents stale state. Suggested fix: share the in-flight refresh or debounce it by about 150 ms.
5. Batch 4 MODERATE-1, behaviour unchanged from base: overlapping `refresh()` calls in
   `skill-diagnostics-state.service.ts` clear `_loading` early, so the spinner can stop while an RPC is still
   in flight. Suggested fix: share the in-flight promise.
6. Batch 6 M1, out of scope and present before this task: the shell clips at 375 px.
7. Batch 6 M2: narrow feed rows. The relative time wraps and the session id truncates. Suggested fix:
   `whitespace-nowrap shrink-0` on the time span and a `title` on the session span.
8. QA risk 1: the cross-tier contract is shared only because both fixtures are built the same way. The webview
   `FakeBackendRing` mirrors the backend ring by hand, so a backend contract change needs a manual fixture
   update. The backend integration spec fails first.
9. QA risk 2: grouping only merges consecutive events (a recorded decision). Alternating sessions A, B, A, B do
   not collapse. A product owner should confirm this fits the real drain pattern of 96 ticks per day.
10. QA risk 3: before the first diagnostics snapshot arrives, the Settings card shows state-service defaults,
    with `subagentStop` and `postToolUse` unchecked. Toggling `postToolUse` in that window would send
    `minEditCount: 1` instead of the backend's 3. Low severity, because the tab refreshes on mount. Found by
    reading the code; not reproduced.
11. QA risk 4, same as base: an `idleMs` below 5000 is sent as-is and the backend rejects it. The card shows
    the backend error. A client-side minimum would be friendlier.
12. Pre-existing, unrelated: `harness-skill-selection-rpc.service.spec.ts:113` fails on main.
