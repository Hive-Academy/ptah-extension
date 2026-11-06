# Batches - TASK_2026_879_9809

Total tasks: 38 | Batches: 11 | Complete: 0/11

Worktree (every path, edit, check and commit): `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps`
(abbreviated `WT` below; every path is absolute under it). Branch `fix/decision-model-data-gaps`.

Plan groups -> batches (plan "Team-leader handoff", `implementation-plan.md:660-730`):
F -> 1, 4, 6 | O -> 2, 5, 7 | W -> 3 | L -> 8 | R -> 9 | D -> 10 | V (added, decisions 12 and 15) -> 11.
F (13 files) and O (15 files) exceed the 6-file batch cap, so each is split along its own
dependency seam (pure module -> store/snapshot contract -> wiring). The plan's ordering holds:
L after F (8 after 6), R after O (9 after 7), V after F and O (11 after 6 and 7).

## Plan validation

Status: PASSED WITH RISKS

Checked on disk (2026-11-04): every MODIFY file exists; every CREATE file is absent
(`outcome-figures.ts`/spec, `model-refine.spec.ts`, `decision-summary.ts`/spec,
`preflight-answer.spec.ts`, `wrote-lines.parser.ts`/spec, `deliverable-check.ts`/spec,
`lane-outcomes/src/lib/di/register.spec.ts`, `scripts/dev/` and `scripts/dev/seed-lane-outcomes.mjs`).
No create overwrites working code.

Assumptions:

- A1 `SystemOneTarget` exposes `timeoutMs` — verified: `SystemOneTarget = DecisionEndpoint`
  (`WT/libs/backend/lane-routing/src/lib/decision-model/decision-model.config.ts:51`), read as
  `target.timeoutMs` at `WT/libs/backend/lane-routing/src/lib/pipeline/model-refine.ts:99`.
- A2 installed Electron carries the same watcher code — unverified; Task 3.3 regression test
  reproduces the dead watcher on `main` and passes with the fix.
- A3 `SdkAdapterSubagentEndedEvent.cwd` is the session workspace root — unverified; Task 7.2
  fixture uses a worktree-shaped `cwd`; Batch 11 manual step re-checks with a DB read-only query.
- A4 verified subagent rows bucket under `SUBAGENT_FAMILY` in `deriveLocalMatrix` — unverified;
  Task 7.2 executor reads `bucketFor` (`WT/libs/backend/lane-routing/src/lib/matrix/local-derivation.ts:131-160`) first and reports it.
- `CapabilityMatrixSnapshot` is constructed only in `capability-matrix.store.ts`, `gather.ts`
  `neutralSnapshot` (286) and specs — verified by grep; Batch 4 covers all three.
- `ModelRequestOutcome` literals are built only in `model-call.ts` and `model-refine.ts`;
  `model-call.spec.ts` uses `toMatchObject`, so a new required field does not break it — verified.
- `LaneQuestion` literals are built only in `phase-plan.ts:209` and consumed in `model-call.ts:47`;
  `PhasePlan.taskKind` is non-null `OutcomeTaskKind` (`phase-plan.ts:84`) — verified.
- `LaneOutcomeRecorder` production construction is only `lane-outcomes/src/lib/di/register.ts:79`;
  three spec sites pass 3-5 args and stay valid with an optional sixth — verified by grep.
- better-sqlite3 loads under the system Node v24.15.0 (checked: `require('better-sqlite3')` opens
  `:memory:`), and `SqliteMigrationRunner` + `MIGRATIONS` are exported from
  `@ptah-extension/persistence-sqlite` (`src/index.ts:80-84`) with
  `applyAll(migrations, { vecExtensionLoaded: false })` — verified; Batch 11 relies on it.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| R1 Plan inconsistency: recorder ctor typed `Pick<IFileSystemProvider, 'stat'>` (plan Component 2 "Constructor and wiring") but `checkDeliverable` needs `'stat' \| 'realpath'` | HIGH | Task 7.1 types the sixth arg `Pick<IFileSystemProvider, 'stat' \| 'realpath'>`; Task 7.3 test asserts realpath is called |
| R2 Symlink escape: in-root link to outside target stat'ed | HIGH | Task 2.3/2.4 realpath both root and path, re-check containment, stat only `realPath`; temp-dir matrix incl. symlinked root and dangling link |
| R3 Host-origin claim reachable from MCP input | HIGH | Task 5.1 `origin: z.literal('host').optional()` only on `DeliverablesPayloadSchema`; Task 9.1 confirms the tool builds its payload from strict `OutcomeReportArgsSchema`; spec asserts unknown origin rejected |
| R4 Host report overrides explicit `ptah_outcome_report` | HIGH | Task 5.2 no-op inside `applyOutcomeEffect` when `deliverablesDeclaredAt !== null`; Tasks 5.3/5.4/7.3 precedence cases (explicit before, explicit after, host on undeclared row) |
| R5 Path text leaks into logs, held payloads or System One | HIGH | Tasks 7.1, 8.1 allow-list meta; specs assert serialised meta has no path, request text or `reasons` entry |
| R6 Several lanes share one worktree; a host verify (`ptah-electron`, `cli-engine`) can see another batch's half-finished edits | MEDIUM | Schedule below: at most one lane per Nx project at a time; a host failure in a file outside the batch is re-run after the other batch settles, not fixed by the wrong lane; team-leader stages only batch files |
| R7 Figures push the lane body past `REQUEST_SIZE_LIMIT_BYTES` | MEDIUM | Task 6.1 builds figures per width inside `fitLane`; Task 6.2 spec asserts figures shrink with width and the byte check counts them |
| R8 Watcher fix changes reload for every file-based setting (shared platform-core) | MEDIUM | Task 3.1 keeps `handleFileRename` debounce/backoff; Batch 3 verifies platform-core, platform-electron, platform-cli and both hosts; coordinator sends the courtesy notice to the peer |
| R9 Seeder writes into the real `~/.ptah/state/ptah.sqlite` | HIGH | Task 11.1 refuses any `--db` whose resolved real path (or real parent dir for a new file) is under real `~/.ptah/state/`; refusal tested in Task 11.3 |
| R10 Seeder schema drifts from production | MEDIUM | Task 11.1 applies the repo's `MIGRATIONS` through `SqliteMigrationRunner`, no hand DDL; inserts through a column list matched against the migrated table |
| R11 Script imports TS libs that use `@ptah-extension/*` aliases | MEDIUM | Task 11.1 uses a loader that maps `tsconfig.base.json` paths (jiti, present at `/home/amun/ptah-extension/node_modules/jiti`, with `alias`, or ts-node + paths); executor proves it by running the script |
| R12 Lane quota: slot B had less weekly room at Gate 0.1 | MEDIUM | Fallback order per batch; reviewer re-assignment rule in the family plan |
| R13 Peer-owned `@ptah-extension/skill-synthesis` imports lane-outcomes | LOW | Typecheck only after Batch 7; never edited |

Edge cases:

- Reader absent, not persistent, throwing or non-array -> empty figures, existing warn — Task 4.1, 4.2
- Matrix load throws -> `neutralSnapshot` with `EMPTY_OUTCOME_FIGURES` — Task 4.3
- Subagent rows, blank laneId, null taskKind, `unverified`, 0/0 pairs excluded — Task 1.1, 1.2
- Subagent option gets no figures; pre-flight/task-kind/scope send `pastOutcomes: {}` — Task 6.1, 6.2
- Payload too large at width 2 -> `payload-too-large` fallback as today — Task 6.2
- Throwing host logger never fails routing; schema failure logs no summary — Task 8.2
- Reused pre-flight logs with `reused: true`, `caller: 'unset'` — Task 8.2, 8.3
- `WROTE:` before the 16 KiB window, em-dash suffix, backticks, quotes, duplicates, 21 paths, 1025 chars, NUL — Task 2.1, 2.2
- Windows drive / UNC entry on POSIX, `..`, `../x`, absolute outside root — Task 2.3, 2.4, 9.1, 9.2
- Dangling symlink -> not found; ENOENT/ENOTDIR/FileNotFound/FileNotADirectory -> `exists:false` — Task 2.3, 2.4
- Blank `cwd`, no filesystem bound, stat error, pipeline closed after shutdown, repeated `subagentEnded` — Task 7.1, 7.3
- Host report arrives before the row exists -> held and joined at insert — Task 5.4, 7.4
- `'change'` event with eventType `'change'` does not re-establish the watcher; two successive atomic replacements reload — Task 3.2, 3.3
- Seeder: `--db` missing, under `~/.ptah/state/`, symlinked into it, or an existing non-throwaway file; same `--seed` gives identical rows — Task 11.1, 11.3
- Live check: endpoint down or cold (≈17 s) -> clear message and non-zero exit, never a silent pass — Task 11.2

## Family plan and schedule

Lane availability is re-resolved by the orchestrator with `ptah_agent_list` at spawn time. The
Gate 0.1 snapshot (`context.md` "Gate 0.1") had two spawnable CLI families with confirmed room;
they are called slot A (the family with more weekly room at Gate 0.1, codex at that time) and
slot B (the other, grok at that time) so the review rule stays correct if availability changes.

| Phase | Batches | Implementer | Phase reviewer (different family) |
| --- | --- | --- | --- |
| P1 Routing + verification harness | 1, 4, 6, 8, 10, 11 | slot A CLI lane | in-process code-logic-reviewer (Anthropic family) |
| P2 Outcomes + settings watcher | 2, 3, 5, 7, 9 | slot B CLI lane | slot A CLI lane: code-logic, plus code-style (new public exports `containedDeliverablePath`, `checkDeliverable`) |

- Reviewer re-assignment: if a P2 batch falls back to slot A, the P2 reviewer becomes the
  in-process code-logic-reviewer. If both CLI families are exhausted and a batch falls back to
  backend-developer (Anthropic family), that phase's reviewer must be a CLI family with room;
  otherwise record a same-family exception and the weaker-evidence label in the phase summary.
- One lane per Nx project at a time (shared worktree, R6); at most 3 lanes at once.

| Wave | Runs together | Waits for |
| --- | --- | --- |
| 1 | Batch 1 (slot A), Batch 2 (slot B), Batch 3 (slot B) | — |
| 2 | Batch 4 (slot A), Batch 5 (slot B) | 1; 2 |
| 3 | Batch 6 (slot A), Batch 7 (slot B) | 4; 5 |
| 4 | Batch 8 (slot A), Batch 9 (slot B) | 6; 7 -> then P2 review |
| 5 | Batch 10 (slot A) | 8 |
| 6 | Batch 11 (slot A) | 6, 7, 10 -> then P1 review |

Verification rule (CLAUDE.md, mandatory for every lane; repeat it in each lane prompt): only
`npm run verify -- ...` scoped with `-p`, run from `WT`, one foreground run with a long timeout,
output filtered with `| tail -40`; confirm the Nx header names the requested project count;
never workspace-wide, never `nx run-many` over unchanged projects, never build/serve/dev/e2e/package;
lanes never run git. The plan's host run (`ptah-electron`, `@ptah-extension/cli-engine`) is
required on the last batch of each plan group (6 for F, 7 for O) and on 3, 8, 9, 10, 11;
the intermediate sub-batches 1, 2, 4, 5 change no exported API and run the library check only
(see Decisions).

## Batch 1: F1 outcome-figures module — IN_PROGRESS

- Recommended executor: CLI lane, TypeScript backend + Jest, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P1 reviewer: in-process code-logic-reviewer)
- Rationale: pure module plus one export and one pinning spec; no contract change yet, so it
  lands and verifies alone.
- Tasks: 3 | Depends on: none
- Phase: P1 | Phase review: code-logic (at Batch 11)

### Task 1.1: create `outcomeFiguresFrom` and export `dedupeByRun` — IN_PROGRESS

- Files: CREATE `WT/libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts`; MODIFY `WT/libs/backend/lane-routing/src/lib/matrix/local-derivation.ts` (export `dedupeByRun`, line 95)
- Plan reference: implementation-plan.md:155-176
- Pattern to follow: `local-derivation.ts:173-215` `countSummary` (same verdict semantics)
- Quality requirements: pure; `delivered` = `delivered`; `failed` = `failed` + `no-deliverable`; `unverified` skipped; skip `SUBAGENT_LANE_ID`, blank laneId, null taskKind; 0/0 -> null
- Validation notes: R5 (only laneId, taskKind, two integers); no new import edge (only `@ptah-extension/shared` and same-lib type import of `DecisionOutcomeFigures`)
- Implementation details: export `OutcomeFigureLookup`, `EMPTY_OUTCOME_FIGURES`, `outcomeFiguresFrom(summaries)` keyed by `laneId/taskKind` after `dedupeByRun`.

### Task 1.2: `outcome-figures.spec.ts` — IN_PROGRESS

- Depends on: Task 1.1
- File: CREATE `WT/libs/backend/lane-routing/src/lib/matrix/outcome-figures.spec.ts`
- Plan reference: implementation-plan.md:237-238
- Pattern to follow: `WT/libs/backend/lane-routing/src/lib/matrix/local-derivation.spec.ts`
- Quality requirements: dedupe; subagent skipped; null taskKind skipped; `no-deliverable` counted as failed; `unverified` ignored; 0/0 -> null; `EMPTY_OUTCOME_FIGURES` returns null
- Validation notes: regression test "figures" of the plan's testability list starts here
- Implementation details: build `LaneOutcomeSummary` fixtures from `@ptah-extension/shared` types.

### Task 1.3: pin figure mapping in `decision-payload.spec.ts` — IN_PROGRESS

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/decision-model/decision-payload.spec.ts`
- Plan reference: implementation-plan.md:245-246
- Pattern to follow: existing cases in the same spec; builder `decision-payload.ts:75-119`
- Quality requirements: a figure contributes exactly `{delivered, failed}` under `laneId/taskKind`, no other keys
- Validation notes: R5
- Implementation details: test-only; no change to `decision-payload.ts`.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -p @ptah-extension/lane-routing` passes (Nx header: 1 project)
- No per-batch review: P1's code-logic review covers this batch in the combined diff
- Edge cases for Tasks 1.1-1.2 are covered by tests

## Batch 2: O1 WROTE parser and containment helper — IN_PROGRESS

- Recommended executor: CLI lane, TypeScript backend + Jest (Node fs, symlinks), slot B
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P2 reviewer: slot A)
- Rationale: two pure, self-tested modules and their export; the security-critical containment
  rule is isolated so it can be verified before any producer uses it.
- Tasks: 5 | Depends on: none
- Phase: P2 | Phase review: code-logic + code-style (new public API) (at Batch 9)

### Task 2.1: `parseWroteLines` — IN_PROGRESS

- File: CREATE `WT/libs/backend/lane-outcomes/src/lib/wrote-lines.parser.ts`
- Plan reference: implementation-plan.md:282-294
- Pattern to follow: pure helpers in `WT/libs/backend/lane-outcomes/src/lib/write/report-effect.ts`
- Quality requirements: scan only the last `WROTE_SCAN_MAX_CHARS = 16384`; case-sensitive `WROTE:` after trim and one leading backtick; cut at first ` — ` and closing backtick; strip one wrapping backtick/quote pair; empty, NUL, >1024 -> `malformed`; distinct in order; >20 -> `too-many`; none -> `none`
- Validation notes: model text is untrusted input; bounded work
- Implementation details: returns `{ paths } | { refusal: WroteRefusal }`.

### Task 2.2: `wrote-lines.parser.spec.ts` — IN_PROGRESS

- Depends on: Task 2.1
- File: CREATE `WT/libs/backend/lane-outcomes/src/lib/wrote-lines.parser.spec.ts`
- Plan reference: implementation-plan.md:390-392
- Quality requirements: absolute and relative; em-dash suffix; backticks; duplicates; `none`; 21 paths; 1025 chars; NUL; line before the scan window ignored

### Task 2.3: `containedDeliverablePath` and `checkDeliverable` — IN_PROGRESS

- File: CREATE `WT/libs/backend/lane-outcomes/src/lib/deliverable-check.ts`
- Plan reference: implementation-plan.md:295-325
- Pattern to follow: not-found set and stat mapping at `WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts:65-79, 164-195` (moves here; the tool switches in Batch 9)
- Quality requirements: lexical gate first (`..`, `..${sep}`, absolute relative, Windows drive/UNC on POSIX); absolute in-root accepted; then `realpath` root and path, repeat containment, `outside-root` without stat; stat only `realPath`; not-found codes -> `{exists:false, bytes:0, mtimeMs:null}`; other errors -> `{ errorCode }`
- Validation notes: R2; `fs` typed `Pick<IFileSystemProvider, 'stat' | 'realpath'>` (`WT/libs/backend/platform-core/src/interfaces/file-system-provider.interface.ts:68-72`)
- Implementation details: no file content reads; no path text in any returned error string from this helper.

### Task 2.4: `deliverable-check.spec.ts` (real temp dirs) — IN_PROGRESS

- Depends on: Task 2.3
- File: CREATE `WT/libs/backend/lane-outcomes/src/lib/deliverable-check.spec.ts`
- Plan reference: implementation-plan.md:317-319, 393-395
- Quality requirements: in-root file; in-root symlink -> in-root target accepted; in-root symlink -> outside target `outside-root` with stat never called (spy); dangling symlink not found; symlinked root uses realRoot; `..` traversal; drive entry on POSIX; absolute outside rejected; other errors -> `errorCode`
- Implementation details: `mkdtempSync` under `os.tmpdir()`, cleaned in `afterEach`; a small adapter over `node:fs/promises` implements the `Pick`.

### Task 2.5: export the helper — IN_PROGRESS

- Depends on: Task 2.3
- File: MODIFY `WT/libs/backend/lane-outcomes/src/index.ts`
- Plan reference: implementation-plan.md:295-297
- Quality requirements: additive export of `containedDeliverablePath`, `checkDeliverable` and their result types only

### Batch 2 verification

- Every listed artifact exists and contains the required work
- `npm run verify -- -p @ptah-extension/lane-outcomes` passes (Nx header: 1 project)
- No per-batch review (P2 review at Batch 9)
- R2 edge cases are tested with real symlinks

## Batch 3: W settings watcher follows atomic replacement — IN_PROGRESS

- Recommended executor: CLI lane, TypeScript backend + Jest (fs.watch semantics), slot B
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P2 reviewer: slot A)
- Rationale: one shared-lib defect, three files, independent of every other batch.
- Tasks: 3 | Depends on: none
- Phase: P2 | Phase review: code-logic (at Batch 9)

### Task 3.1: dispatch on `eventType` — IN_PROGRESS

- File: MODIFY `WT/libs/backend/platform-core/src/file-settings-manager.ts` (`tryStartFileWatch` 318-324)
- Plan reference: implementation-plan.md:536-541
- Pattern to follow: existing `handleFileRename` (409) and `scheduleDebouncedFlush`
- Quality requirements: one `'change'` listener: `'rename'` -> `handleFileRename()`, else `scheduleDebouncedFlush()`; remove the `'rename'` listener; keep debounce, backoff, directory fallback
- Validation notes: R8; A2
- Implementation details: no public API change.

### Task 3.2: mocked emitter spec — IN_PROGRESS

- Depends on: Task 3.1
- File: MODIFY `WT/libs/backend/platform-core/src/file-settings-manager.error-paths.spec.ts` (480-517)
- Plan reference: implementation-plan.md:544-546
- Quality requirements: emit `('change', 'rename', 'settings.json')`; new case: `('change', 'change', …)` does not re-establish the watcher

### Task 3.3: real-fs regression — IN_PROGRESS

- Depends on: Task 3.1
- File: MODIFY `WT/libs/backend/platform-core/src/file-settings-manager.cross-process.spec.ts`
- Plan reference: implementation-plan.md:547-550
- Quality requirements: existing `settings.json`, two successive atomic replacements (tmp + rename); watched key gets the second value within the existing 2000 ms window
- Validation notes: A2 — executor states that this case fails without Task 3.1 (e.g. by running it against the unmodified line first) and reports how it checked

### Batch 3 verification

- `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-electron,@ptah-extension/platform-cli` passes (header: 3 projects)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- No per-batch review (P2 review at Batch 9)

## Batch 4: F2 snapshot carries figures — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P1 reviewer)
- Rationale: the snapshot gains a required member; every construction site and the gate-spec fixture must change in the same batch so the library stays green.
- Tasks: 4 | Depends on: 1
- Phase: P1 | Phase review: code-logic (at Batch 11)

### Task 4.1: `readLocalMatrix` returns figures; snapshot member — PENDING

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts` (snapshot 108-116, `load` 177, `readLocalMatrix` 262-297)
- Plan reference: implementation-plan.md:177-183
- Pattern to follow: existing degrade path with warn at 290, 311
- Quality requirements: `readonly outcomeFigures: OutcomeFigureLookup`; `EMPTY_OUTCOME_FIGURES` on every early or failure return; same 90-day `OUTCOME_WINDOW_MS`; no extra reader call
- Validation notes: performance — one read per gate call

### Task 4.2: store spec — PENDING

- Depends on: Task 4.1
- File: MODIFY `WT/libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.spec.ts`
- Plan reference: implementation-plan.md:239-240
- Quality requirements: figures present with a reader; empty when the reader throws, is absent, or not persistent

### Task 4.3: `neutralSnapshot` — PENDING

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/pipeline/gather.ts` (`neutralSnapshot` 286)
- Plan reference: implementation-plan.md:181-182
- Quality requirements: returns `EMPTY_OUTCOME_FIGURES`

### Task 4.4: gate-spec fixture — PENDING

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts` (`neutralMatrix()` only)
- Plan reference: implementation-plan.md:247-248
- Quality requirements: fixture gains `outcomeFigures: EMPTY_OUTCOME_FIGURES`; the figures-reach-payload case is Task 6.4

### Batch 4 verification

- `npm run verify -- -p @ptah-extension/lane-routing` passes (header: 1 project)
- No per-batch review

## Batch 5: O2 host-origin effect and store precedence — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest (sqlite), slot B
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P2 reviewer)
- Rationale: schema, effect and store precedence are one contract; both store specs exercise the same `applyOutcomeEffect`.
- Tasks: 4 | Depends on: 2 (same project, serialised; no code dependency)
- Phase: P2 | Phase review: code-logic + code-style (at Batch 9)

### Task 5.1: `origin: 'host'`, `hostObserved`, `hostDeliverablesReportId` — PENDING

- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/write/report-effect.ts` (schema 8-25, `deterministicReviewReportId` 64-69, `reportEffectOf` 92-112)
- Plan reference: implementation-plan.md:331-334, 345-349
- Quality requirements: `origin: z.literal('host').optional()` in the strict schema; maps to `hostObserved: true`; `hostDeliverablesReportId(runId)` = `deliverables:host:${runId}`
- Validation notes: R3

### Task 5.2: precedence in `applyOutcomeEffect` — PENDING

- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts` (effect type 43-55, `applyOutcomeEffect` 61-87)
- Plan reference: implementation-plan.md:350-362
- Quality requirements: `hostObserved` on a row with `deliverablesDeclaredAt !== null` returns the row unchanged; explicit after host overwrites via the existing subagent rule; evaluated inside the store transaction
- Validation notes: R4; held payload holds stat facts only (line 18)

### Task 5.3: in-memory store spec — PENDING

- Depends on: Tasks 5.1, 5.2
- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/store/in-memory-lane-outcome.store.spec.ts`
- Plan reference: implementation-plan.md:398-400
- Quality requirements: host no-op after explicit; explicit after host overwrites; host on undeclared row applies

### Task 5.4: sqlite store spec — PENDING

- Depends on: Tasks 5.1, 5.2
- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts`
- Plan reference: implementation-plan.md:398-400; held-report join 192-235 of the store
- Quality requirements: same three cases plus host report held before insert joins at insert; repeated host id is a receipt `duplicate`
- Also MODIFY `WT/libs/backend/lane-outcomes/src/lib/write/report-effect.spec.ts`: `origin:'host'` -> `hostObserved`; unknown origin rejected; report id format (plan 396-397)

### Batch 5 verification

- `npm run verify -- -p @ptah-extension/lane-outcomes` passes (header: 1 project)
- No per-batch review

## Batch 6: F3 figures reach the lane request (closes group F) — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P1 reviewer)
- Rationale: `LaneQuestion.taskKind`, `ModelRequestOutcome.outcomeFigures`, `runLaneRequest(outcomes)` and its single caller change together.
- Tasks: 4 | Depends on: 4
- Phase: P1 | Phase review: code-logic (at Batch 11)

### Task 6.1: `fitLane` sends offered-pair figures — PENDING

- Files: MODIFY `WT/libs/backend/lane-routing/src/lib/pipeline/model-refine.ts` (`LaneQuestion` 46-51, `ModelRequestOutcome` 60-72, `runLaneRequest` 112, `runFixedRequest` 143-180, `fitLane` 210-245); MODIFY `WT/libs/backend/lane-routing/src/lib/pipeline/model-call.ts` (`emptyOutcome` 33 and other builders set `outcomeFigures: 0`)
- Plan reference: implementation-plan.md:184-206
- Quality requirements: per width, de-duplicated figures for phase x offered option in phase then option order; structured prompt appends `past outcomes <laneId>/<taskKind>: delivered N, failed M`; byte check covers figures; outcome returns the count sent; `runFixedRequest` keeps `[]` with a comment why
- Validation notes: R5, R7

### Task 6.2: `model-refine.spec.ts` — PENDING

- Depends on: Task 6.1
- File: CREATE `WT/libs/backend/lane-routing/src/lib/pipeline/model-refine.spec.ts`
- Plan reference: implementation-plan.md:241-244
- Pattern to follow: stub caller in `WT/libs/backend/lane-routing/src/lib/pipeline/model-call.spec.ts`
- Quality requirements: only offered lane x taskKind pairs; subagent option gets none; figures drop when width shrinks; structured prompt contains the lines; `runFixedRequest` sends `pastOutcomes: {}`

### Task 6.3: `taskKind` and lane note in `phase-plan.ts` — PENDING

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts` (`LANE_INSTRUCTIONS` 34, `laneQuestion` 209)
- Plan reference: implementation-plan.md:183-184, 199-203
- Quality requirements: `taskKind: plan.taskKind`; `LANE_INSTRUCTIONS` verbatim from plan line 200

### Task 6.4: `runPass` passes the lookup; gate case — PENDING

- Depends on: Tasks 6.1, 6.3
- Files: MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.service.ts` (`runPass` 268-300, `decideGate`); MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts` (new case: matrix lookup returns figures, captured payload carries them under offered keys only)
- Plan reference: implementation-plan.md:196-198, 247-248

### Batch 6 verification

- `npm run verify -- -p @ptah-extension/lane-routing` passes (header: 1 project)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- No per-batch review

## Batch 7: O3 host producer and wiring (closes group O) — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest (tsyringe DI), slot B
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P2 reviewer)
- Rationale: producer, its constructor arg and its DI resolution change together.
- Tasks: 4 | Depends on: 2, 5
- Phase: P2 | Phase review: code-logic + code-style (at Batch 9)

### Task 7.1: `declareWrittenDeliverables` in `recordSubagentEnded` — PENDING

- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts` (ctor; `recordSubagentEnded`; `declareSubagentDeliverables` 253-282; `captureReview` pattern 236-243; `attachReview` shape 287-306)
- Plan reference: implementation-plan.md:320-344, 363-373
- Quality requirements: optional sixth ctor arg typed `Pick<IFileSystemProvider, 'stat' | 'realpath'>` (R1); fire-and-forget `void … .catch(warn)`; parse -> `none` silent; refusal, blank cwd (`no-root`), any escape (`escapes-workspace`), any `errorCode` (`stat-failed`) -> warn, no report; else `declareSubagentDeliverables({runId}, checks, {origin:'host'}, {reportId: hostDeliverablesReportId(runId)})`; `ok:false` -> warn with the pipeline's fixed string; warn `'Subagent deliverables not verified'` meta `{runId, reason, code?, paths: <count>}` only
- Validation notes: R1, R4, R5; never throws into the SDK callback; ≤ 20 stats

### Task 7.2: recorder spec — PENDING

- Depends on: Task 7.1
- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.spec.ts`
- Plan reference: implementation-plan.md:401-404
- Quality requirements: worktree-shaped `cwd` (A3); file non-empty -> one host report, `delivered`; missing -> `no-deliverable`; no line -> no submit, no warn; escape, stat error, blank cwd -> no submit and warn meta with no path text; repeated `subagentEnded` -> one receipt; no filesystem -> inert; realpath used (R1)
- Validation notes: A4 — executor reads `bucketFor` (`local-derivation.ts:131-160`) and reports whether a `delivered` subagent row lands in the `SUBAGENT_FAMILY` bucket

### Task 7.3: integration precedence — PENDING

- Depends on: Task 7.1
- File: MODIFY `WT/libs/backend/lane-outcomes/src/lib/subagent-stop.integration.spec.ts`
- Plan reference: implementation-plan.md:405-406
- Quality requirements: explicit report held before the stop wins over the host report

### Task 7.4: optional filesystem resolution — PENDING

- Files: MODIFY `WT/libs/backend/lane-outcomes/src/lib/di/register.ts` (76-95); CREATE `WT/libs/backend/lane-outcomes/src/lib/di/register.spec.ts`
- Plan reference: implementation-plan.md:336-344, 407-409
- Quality requirements: `c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) ? c.resolve(...) : undefined`; spec: recorder resolves with and without the token and receives the provider when bound; no new token, no host composition-root edit

### Batch 7 verification

- `npm run verify -- -p @ptah-extension/lane-outcomes` passes (header: 1 project)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- then `npm run verify -- -t typecheck -p @ptah-extension/vscode-lm-tools,@ptah-extension/rpc-handlers,@ptah-extension/cli-agent-runtime,@ptah-extension/skill-synthesis` passes (header: 4 projects; skill-synthesis is peer-owned: typecheck only, never edit)
- No per-batch review

## Batch 8: L route decision summary log — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P1 reviewer)
- Rationale: shares `route-decide.service.ts` and the gate spec with Batch 6 and reads `ModelRequestOutcome.outcomeFigures`, so it runs after it.
- Tasks: 3 | Depends on: 6
- Phase: P1 | Phase review: code-logic (at Batch 11)

### Task 8.1: `decision-summary.ts` — PENDING

- File: CREATE `WT/libs/backend/lane-routing/src/lib/reasons/decision-summary.ts`
- Plan reference: implementation-plan.md:424-447 (Component 3)
- Pattern to follow: allow-list construction of `buildDecisionPayload` (`decision-payload.ts:75-119`)
- Quality requirements: `preflightSummary`, `gateSummary` -> `LaneRoutingLogMeta`; fields exactly as the plan's Component 3 "Fields" list; never `request`, `reasons`, `baseUrl`, `apiKey`, `selection`, criteria text, `excludedBy` details, error messages
- Validation notes: R5; A1 verified (`timeoutMs` system-one only)

### Task 8.2: one `info` per `decide` — PENDING

- Depends on: Task 8.1
- File: MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.service.ts` (`decide` 114, `decidePreflight` 152, `decideGate` 196 after `persistRotation`)
- Plan reference: implementation-plan.md:424-461 (Component 3, `RouteDecideService` and failure-behaviour bullets)
- Quality requirements: `started = this.nowMs` at top; `'[lane-routing] route decided'`; reused pre-flight `reused: true`, `caller: 'unset'`; logger call wrapped, catch and ignore with a `// degradation-audit:` comment (pattern `capability-matrix.store.ts:290`); no summary on schema failure

### Task 8.3: specs — PENDING

- Depends on: Task 8.2
- Files: CREATE `WT/libs/backend/lane-routing/src/lib/reasons/decision-summary.spec.ts`; MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.preflight.spec.ts`; MODIFY `WT/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts`
- Plan reference: implementation-plan.md:424-461 (Component 3, quality-requirements and verification-seam bullets)
- Quality requirements: serialised meta contains no request text and no `reasons` entry; exactly one `info` per `decide` with stage and per-question fields; throwing logger does not fail routing

### Batch 8 verification

- `npm run verify -- -p @ptah-extension/lane-routing` passes (header: 1 project)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- No per-batch review

## Batch 9: R outcome-report tool accepts absolute in-workspace paths — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest (MCP tool schema), slot B
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P2 reviewer)
- Rationale: imports the Batch 2 helper; plan orders it after group O. Last batch of P2.
- Tasks: 2 | Depends on: 7
- Phase: P2 | Phase review: code-logic + code-style — due after this batch commits

### Task 9.1: tool uses the shared helper — PENDING

- Files: MODIFY `WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts` (replace 65-79 and 164-195); MODIFY `WT/libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts` (line 19 `.describe(...)` verbatim from plan)
- Plan reference: implementation-plan.md:562-590
- Quality requirements: same reason strings to the agent; stat warn logs the code only; tool description (81-92) unchanged; validation unchanged; the payload is still built from strict `OutcomeReportArgsSchema` (no `origin`) (R3); symlink rule now applies to the tool (R2)

### Task 9.2: tool spec — PENDING

- Depends on: Task 9.1
- File: MODIFY `WT/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.spec.ts`
- Plan reference: implementation-plan.md:593-597
- Quality requirements: absolute inside -> applied; absolute outside, `..`, drive path on POSIX -> escapes; `inputSchema.properties.paths.description` starts with the new text and ends with the "Required for kind deliverables" note; `mcp-contract.sweep.spec.ts` stays green

### Batch 9 verification

- `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/lane-outcomes` passes (header: 2 projects)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- then `npm run verify -- -t typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/gateway-chat-bridge` passes (header: 2 projects)
- After commit: NEEDS REVIEW for P2 (Batches 2, 3, 5, 7, 9)

## Batch 10: D pre-flight depth criteria — PENDING

- Recommended executor: CLI lane, TypeScript backend + Jest, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A
- Review family: different from implementer (P1 reviewer)
- Rationale: plan-independent of F and L, but same Nx project and shared worktree, so serialised after Batch 8 (R6).
- Tasks: 3 | Depends on: 8 (scheduling only)
- Phase: P1 | Phase review: code-logic (at Batch 11)

### Task 10.1: descriptive depth criteria — PENDING

- File: MODIFY `WT/libs/backend/lane-routing/src/lib/pipeline/preflight-answer.ts` (25-38, 53-59)
- Plan reference: implementation-plan.md:487-495
- Quality requirements: `values: DEPTHS` and `labeledValue` mapping unchanged; `Readonly<Record<Depth, string>>` mapped in `DEPTHS` order; instructions and three texts verbatim (variant D); task_type `criterionLabels` unchanged; `CONFIDENCE_THRESHOLD` unchanged

### Task 10.2: `preflight-answer.spec.ts` — PENDING

- Depends on: Task 10.1
- File: CREATE `WT/libs/backend/lane-routing/src/lib/pipeline/preflight-answer.spec.ts`
- Plan reference: implementation-plan.md:509-512
- Quality requirements: depth criteria carry descriptions in `DEPTHS` order; `o1/o2/o3` -> `Full/Partial/Minimal`; task_type unchanged

### Task 10.3: live fixtures from shipped text — PENDING

- Depends on: Task 10.1
- File: MODIFY `WT/libs/backend/lane-routing/src/lib/decision-model/system-one.live.fixtures.ts`
- Plan reference: implementation-plan.md:501-508
- Quality requirements: `depth-preflight-*` fixtures (r1 Minimal, r5 Full, r6 Full) built from `preflightQuestions()` depth entry; load-time validation passes; live suite stays opt-in

### Batch 10 verification

- `npm run verify -- -p @ptah-extension/lane-routing` passes (header: 1 project)
- then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects)
- No per-batch review

## Batch 11: V verification harness (seeder + live end-to-end check) — PENDING

- Recommended executor: CLI lane, Node scripting + sqlite + TypeScript loaders, slot A
- Execution mode: sequential
- Fallback order: other family same capability -> same family other provider/model -> subagent (backend-developer)
- Subagent reason: N/A (the live call reaches a local 127.0.0.1 endpoint; a lane can run it; if the lane sandbox blocks loopback, the coordinator runs Task 11.2's command itself and attaches the output)
- Review family: different from implementer (P1 reviewer: in-process code-logic-reviewer)
- Rationale: dev tooling outside every Nx project; it imports the finished F and O code, so it runs last. Last batch of P1.
- Tasks: 3 | Depends on: 6, 7 (code); scheduled after 10
- Phase: P1 | Phase review: code-logic — due after this batch commits (covers Batches 1, 4, 6, 8, 10, 11)

### Task 11.1: `scripts/dev/seed-lane-outcomes.mjs` — PENDING

- File: CREATE `WT/scripts/dev/seed-lane-outcomes.mjs`
- Plan reference: decisions.md rows 12 and 15; context.md "Peer contract" last bullet (shared with TASK_2026_878_5513)
- Pattern to follow: script header/usage style of `WT/scripts/drain-observation-queue.ts`; migration use as in `WT/libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts:17-30` but with the full runner
- Quality requirements:
  - Flags: `--db <path>` (required), `--seed <int>` (deterministic PRNG, default fixed), `--lanes <csv>` (default several lane ids incl. a `ptahCliId`-shaped one), `--rows <n>`, `--help`. Unknown flag -> usage + exit 2.
  - Safety (R9): resolve `--db`; real path of the file if it exists, else real path of its parent dir + basename; refuse (exit 1, no file created) when it equals or is under `realpath(~/.ptah/state)`, also when `~/.ptah/state` is reached through a symlink. Refuse any existing file that this script did not create (marker table `seed_meta`), so a copied real DB is never mutated by accident; a new path is created fresh.
  - Schema (R10): apply the repo's `MIGRATIONS` with `SqliteMigrationRunner.applyAll(MIGRATIONS, { vecExtensionLoaded: false })` (`@ptah-extension/persistence-sqlite` `src/index.ts:80-84`) on a better-sqlite3 connection. No hand-written DDL.
  - Loader (R11): import the TS sources through a loader that maps `tsconfig.base.json` paths (jiti with `alias`, or ts-node + paths); runs with the system `node` (better-sqlite3 loads under Node v24.15.0, checked).
  - Rows: `lane_outcome_records` across lanes x every `OUTCOME_TASK_KINDS` value x verdicts `delivered`/`failed`/`no-deliverable`/`unverified`, `ended_at` inside the 90-day window, distinct `run_id`s; plus `executor_kind='subagent'`, `lane_id='subagent'` rows with roles, host-verified (`delivered`/`no-deliverable` with `deliverables_declared_at` set) and `unverified`. Insert through the column list read from `PRAGMA table_info(lane_outcome_records)` (or the real `SqliteLaneOutcomeStore` insert), never invented columns.
  - Output: summary to stdout (db path, rows per lane x verdict, subagent rows by verdict, seed). Same args -> identical rows.
- Validation notes: R9, R10, R11; never touches `~/.ptah/state/ptah.sqlite`

### Task 11.2: live end-to-end check (manual, opt-in) — PENDING

- Depends on: Task 11.1
- File: CREATE `WT/scripts/dev/check-past-outcomes-live.mjs`
- Plan reference: decisions.md row 15; implementation-plan.md:525-531 (gate data flow), 728-730 (manual checks)
- Quality requirements:
  - Opt-in only: refuses to call the network unless `--live` is passed; not a Jest spec, not wired into any Nx target or CI.
  - Opens the seeded `--db` (same safety rule as 11.1), builds `LaneOutcomeReader` over `SqliteLaneOutcomeStore`, loads `CapabilityMatrixStore` for the seeded lanes, builds lane questions for at least two phases, and calls `runLaneRequest` with the snapshot's `outcomeFigures` through a capturing `SystemOneCaller` that forwards to the real client.
  - Asserts the captured request body has a non-empty `pastOutcomes` whose keys are only offered `laneId/taskKind` pairs and contain no `subagent` key; prints those keys and counts.
  - With `--live`, posts to `http://127.0.0.1:11435/v1/systemone` (model `d3:4b`, overridable by `--base-url`/`--model`) and prints the answer, confidence and latency; endpoint down or timeout -> clear message, exit 1 (never a silent pass). Without `--live`, stops after the payload assertion (exit 0).
  - Documents in its header: prerequisites (Chappie tunnel unit `ptah-chappie-ollama.service`, warm ≈3.4 s, cold ≈17 s), the two commands, and the optional manual Electron steps: restart Ptah, confirm one `[lane-routing] route decided` INFO line with `timeoutMs` in `~/.config/Ptah/logs/Ptah Electron-YYYY-MM-DD.log`, run one subagent and check its row with a read-only query.

### Task 11.3: harness self-check — PENDING

- Depends on: Tasks 11.1, 11.2
- File: none (evidence only, in the executor report)
- Quality requirements: run and report output tails of: `node WT/scripts/dev/seed-lane-outcomes.mjs --db ~/.ptah/state/ptah.sqlite` (refused, exit 1, file mtime unchanged); a symlink in `/tmp` pointing into `~/.ptah/state/` (refused); `--db /tmp/ptah-seed-<rand>.sqlite --seed 7` twice into fresh files (identical summaries); `check-past-outcomes-live.mjs --db <seeded>` without `--live` (non-empty `pastOutcomes`); with `--live` when the endpoint answers (or the exact failure)

### Batch 11 verification

- Every listed artifact exists and contains the required work
- `npx eslint WT/scripts/dev/seed-lane-outcomes.mjs WT/scripts/dev/check-past-outcomes-live.mjs` clean (scripts sit outside every Nx project, so no `npm run verify -p` target covers them)
- `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` passes (header: 2 projects; cache hit unless libs changed since Batch 10)
- Task 11.3 evidence present; `~/.ptah/state/ptah.sqlite` mtime unchanged across the run
- After commit: NEEDS REVIEW for P1 (Batches 1, 4, 6, 8, 10, 11)

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Split F into 1/4/6 and O into 2/5/7 along pure module -> contract -> wiring | keep plan groups whole (13 and 15 files) | 6-file batch cap; each split keeps the library green after each batch (all construction sites of the changed types found by grep) | yes |
| `decision-payload.spec.ts` pin moves to Batch 1 | keep in F3 | it pins existing builder behaviour, needs no new code; keeps Batch 6 at 6 files | yes |
| Library-only check on intermediate sub-batches 1, 2, 4, 5; plan host run on 3, 6, 7, 8, 9, 10, 11 | host run on every batch | plan line 724-726 ("after the last of them satisfies every group"); 1, 2, 4, 5 change no exported or host-visible API | yes |
| Two implementer slots by phase; P1 reviewed in-process (Anthropic), P2 reviewed by slot A | per-batch mixed families | different-family review rule; one implementer family per phase keeps each phase review single-family | yes |
| Slot A carries the larger load | even split | Gate 0.1 weekly usage: slot A had more room | yes |
| Recorder fs arg typed `'stat' \| 'realpath'` | follow plan text `'stat'` | plan contradiction (R1); `checkDeliverable` signature in the same plan section | yes |
| Seeder refuses existing files without its own marker | allow any non-state path | decision 12 data safety: a copied real DB must not be mutated by accident | yes |
| V merged into P1 review | separate phase | V exercises P1 code paths; one review of routing + harness | yes |
