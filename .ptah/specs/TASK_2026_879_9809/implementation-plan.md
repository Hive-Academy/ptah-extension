# Implementation Plan - TASK_2026_879_9809

## Inputs and constraints

- Requirements used: `context.md`, `decisions.md`, `task.md` (all in this folder); the spawner's
  goal list (gaps 1-5). No `task-description.md` or `research-report.md` exists. Their absence
  changes no decision here: the findings in `context.md` carry file:line evidence, and each one
  was checked again against source and the live data below.
- Corrections applied (revision 1): `implementation-plan-review.md` findings 1-4;
  `decisions.md` row 10 (user: the host-side subagent verdict producer is in scope; this
  supersedes row 7). The former orchestrator addendum is now Component 6.
- Design handoff used: none (no UI work).
- Missing decision-critical input: none. Both former open questions are settled
  (`decisions.md` rows 8 and 10).
- Ownership: every file below is in `libs/backend/lane-routing`, `libs/backend/lane-outcomes`
  (owned by this task, `context.md` "Coordination"), `libs/backend/platform-core` (settings
  watcher, gap 5) or `libs/backend/vscode-lm-tools` (outcome-report tool, Component 6). None is
  in the peer task's list. No agent-sdk file changes (types are only consumed).
- Repository rules: `CLAUDE.md` (memory-safe verify, Electron first, keep `platform-cli` /
  `cli-engine` compiling). `libs/backend/lane-routing/README.md`: lane-routing may import only
  `@ptah-extension/shared` and `@ptah-extension/platform-core`. lane-outcomes has no README; it
  already imports `shared`, `platform-core`, `persistence-sqlite` and `agent-sdk` (grep of
  `libs/backend/lane-outcomes/src`), and `vscode-lm-tools` already imports lane-outcomes
  (`outcome-report.tool.ts:4-14`). Both are tagged `scope:extension`. This plan adds **no new
  import edge**.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Lane requests send `outcomeFigures: []` inside the width-shrink loop | `lane-routing/src/lib/pipeline/model-refine.ts:231` (in `fitLane`, 210-245) | Figures must be built per width inside the loop, so the byte check counts them |
| Fixed (pre-flight, task-kind, scope) requests send `outcomeFigures: []` | `model-refine.ts:158` (`runFixedRequest`, 143-180); callers `route-decide.service.ts:157`, `task-kind/decision-model-task-kind-classifier.ts:38`, `scope/scope-check.service.ts:98` | Those questions do not choose a lane, so lane figures do not inform them |
| Payload builder already maps figures to `pastOutcomes["laneId/taskKind"] = {delivered, failed}` and nothing else | `decision-model/decision-payload.ts:36-42, 111-116`; wire schema `system-one.schema.ts` (`SystemOneOutcomeCountsSchema`, strict) | The NFR Security field set already allows this data; no contract change on the wire |
| The outcome reader is already wired into lane-routing on both hosts | Token `di/tokens.ts:24`; resolved optionally into `CapabilityMatrixStore` at `di/register.ts:74-84`; aliased by Electron `apps/ptah-electron/src/di/phase-2-libraries.ts:313` and CLI `libs/backend/cli-engine/src/lib/lane-outcomes-wiring.ts:15` | Figures can come from the read the matrix store already does. No host wiring change, so every host keeps compiling |
| The matrix store reads every offered lane plus `subagent` once per gate call, with a 90-day window, and degrades on failure (warn + `outcomes-unavailable`, empty matrix) | `matrix/capability-matrix.store.ts:262-297` (`sinceMs` 281, warn 290); queries built in `pipeline/gather.ts` `loadMatrix` (lanes + `SUBAGENT_LANE_ID`) | Aggregate figures from the same `summaries`. Every existing failure path then yields empty figures, already logged |
| The reader caps one lane at 2000 rows, newest first | `lane-outcomes/src/lib/lane-outcome-reader.service.ts:19, 40-48`; SQL `store/sqlite-lane-outcome.store.ts:364` | The input to the figures is bounded |
| The ranking score **already uses outcomes**: local cells blend the delivered rate (delivered / delivered+no-deliverable+failed) and the review pass rate toward a prior, k=10, over 90 days, keyed by family/model/taskKind | `matrix/local-derivation.ts` (`deriveLocalMatrix` 67, `countSummary` 173-215, `case 'unverified'` 187 skipped); `routing-constants.ts` `BLEND_PRIOR_WEIGHT`, `OUTCOME_WINDOW_MS` | Double counting risk is real. Raw counts add sample size, not a new signal. The question text must say so |
| `dedupeByRun` exists but is private | `matrix/local-derivation.ts:95` | Export it and reuse it rather than writing a second dedupe |
| Option ids: a lane is `cli` or `ptahCliId`; a subagent is `subagent:<role>` | `ranking/candidate.types.ts` `laneCandidateId`, `toSubagentCandidate`; `pipeline/phase-plan.ts:389-397` `toOption` | Outcome rows key lanes by the same id (`shared/.../lane-outcome.types.ts` `laneId` doc). Subagent rows use `laneId='subagent'` with no role in `LaneOutcomeSummary`, so they can never match a `subagent:<role>` option |
| `LaneQuestion` has no task kind; `PhasePlan` has one | `model-refine.ts:46-51`; `phase-plan.ts:81-88, 209-215` | Add `taskKind` to `LaneQuestion` so `fitLane` can choose the figures for each phase |
| Lane instructions are one bare line | `phase-plan.ts:34` `LANE_INSTRUCTIONS = 'Choose the executor for this phase.'` | Hook for the double-counting note |
| Subagent rows are always written `verdict: 'unverified'`, `routingSource: 'not-routed'` | `lane-outcomes/src/lib/lane-outcome-recorder.service.ts:82-117` (verdict 101), used by both stop producers 203-240 | Root cause of gap 2 (see below) |
| The only path that promotes a subagent row is a `deliverables` report; `declareSubagentDeliverables` has **no production caller** | `lane-outcome-recorder.service.ts:253`; repository grep: callers only in specs; the MCP path is `vscode-lm-tools/.../tools/outcome-report.tool.ts:96-250` | Promotion depends on agents calling `ptah_outcome_report` voluntarily (`plugins/ptah-core/skills/orchestration/SKILL.md:140-147`) |
| Successful System One calls log only at debug | `decision-model/system-one.client.ts:199-202` | Gap 3: no info line exists per decision |
| Logger contract and host loggers | `lane-routing-logger.ts` (`info(message, meta)`); Electron passes its main logger, `phase-2-libraries.ts:311`; CLI `cli-engine/src/lib/container.ts:780` | One `info` call reaches the Electron log file (that file already shows `[INFO ]` lines) |
| Pre-flight criteria are the bare values `Full` / `Partial` / `Minimal` under the instructions "Choose the depth." | `pipeline/preflight-answer.ts:25-38, 53-59`; `DEPTHS` `contracts/route-decide-args.schema.ts:17` | Gap 4 root cause (live evidence below) |
| Fallback when `confidence < 0.5` | `routing-constants.ts` `CONFIDENCE_THRESHOLD`; `pipeline/answer-validation.ts` `validateChoiceAnswer` | Keep the threshold (see gap 4) |
| Timeout read per call: `getConfiguration('ptah','agentOrchestration.decisionModelTimeoutMs')`, clamped 1000..60000 | `decision-model/decision-model.target.ts:184-214`; constants `shared/src/lib/types/rpc/rpc-agents.types.ts:230-233` | The lane-routing read path is correct |
| Electron `getConfiguration` returns the in-memory map of `PtahFileSettingsManager` for file-based keys | `platform-electron/src/implementations/electron-workspace-provider.ts:94-101`; key listed in `platform-core/src/file-settings-keys.ts:136` | The value is only as fresh as the manager's cross-process reload |
| The file watcher listens for an FSWatcher `'rename'` event, which Node never emits | `platform-core/src/file-settings-manager.ts:318-324` (`watcher.on('change')`, `watcher.on('rename')`); re-establish logic `handleFileRename` 409 | **Gap 5 root cause.** After the first atomic replacement the watcher stays on the dead inode, and no external edit is reloaded again |
| The manager's own `persist()` replaces the file atomically (tmp + rename) | `file-settings-manager.ts:630-642` | Any in-app settings write kills cross-process reload for the rest of the process lifetime |
| The mocked spec encodes the same wrong contract (`emitter.emit('rename')`) | `platform-core/src/file-settings-manager.error-paths.spec.ts:480-517` | The spec must change with the fix |
| The watcher is enabled on both hosts | `platform-electron/src/settings/electron-settings-registration.ts:80`, `platform-cli/src/settings/cli-settings-registration.ts:83` | The fix applies to both hosts with no wiring change |

### Live and operational evidence gathered for this plan

- **DB (read-only, `~/.ptah/state/ptah.sqlite`)**, `lane_outcome_records` grouped by
  executor_kind/verdict: cli delivered 292, failed 33, unverified 2; ptah-cli delivered 34,
  failed 3, no-deliverable 3, unverified 3; **subagent delivered 1 (with
  `deliverables_declared_at` set), unverified 133 (0 declared)**. All 134 subagent rows have
  `routing_source='not-routed'`. `lane_outcome_held_reports` is empty. Subagent roles:
  team-leader 40, code-logic-reviewer 24, backend-developer 16, software-architect 14, and others.
- **Node watcher experiment** (Node v24.15.0, Linux, the same `fs.watch(file)` call the manager
  makes): step 1 atomic replace → events `change`, `rename`, `rename` (all delivered as
  `'change'` events with `eventType` `'rename'`; a separate `'rename'` listener never fired);
  step 2 in-place write → **no event**; steps 3-4 atomic replace → **no event**; step 5 in-place
  → **no event**.
- **Electron log** `~/.config/Ptah/logs/Ptah Electron-2026-11-04.log`: 14 lines
  `system one call failed … request timed out after 30000 ms` from 03:55Z to 20:47Z, after the
  external edit to `decisionModelTimeoutMs=60000` (file mtime 2026-11-04 11:06:24Z). No
  settings write by the app was logged near 11:06Z.
- **Live System One** (`POST http://127.0.0.1:11435/v1/systemone`, model `d3:4b`): request
  bodies were built the way `buildDecisionPayload` builds them. The scripts were kept outside
  the repository (`/tmp/s1eval`). The tables are in gap 4 and gap 1.

## Architecture decision

- Chosen approach: the change stays inside the libraries that own the behaviour, with no host
  wiring change.
  1. `CapabilityMatrixStore` aggregates `{laneId, taskKind, delivered, failed}` from the
     summaries it already reads and exposes them as a lookup on `CapabilityMatrixSnapshot`.
     `fitLane` sends only the figures for the (offered lane, phase taskKind) pairs at the
     current width.
  2. A host-side producer in `LaneOutcomeRecorder.recordSubagentEnded` parses `WROTE: <path>`
     lines from the subagent's final message, stats contained paths through the existing
     `IFileSystemProvider` port, and submits a host-origin deliverables report that never
     overrides an explicit `ptah_outcome_report`. Subagent rows stay excluded from
     `pastOutcomes` (summaries carry no role).
  3. `RouteDecideService` emits one `info` summary per route call from the validated result.
  4. Pre-flight depth criteria get descriptive text, chosen by a live A/B.
  5. `PtahFileSettingsManager` reads `eventType` from the `'change'` event, so the watcher
     follows atomic replacements.
  6. `ptah_outcome_report` accepts absolute paths inside the workspace, using the same
     containment helper as item 2 (one helper in lane-outcomes).
- Rationale: gap 1 reuses the port, token, window and failure handling that already exist
  (`capability-matrix.store.ts:262-297`), so the outcome store is read once per call and both
  hosts compile unchanged. Gap 5 is a confirmed defect in shared code. A lane-routing-side
  workaround (reading the file directly) would duplicate the settings layer and leave every
  other file-based key stale.
- Rejected alternatives:
  - A second `LaneOutcomeReader` call from `RouteDecideService` (new `RouteDecideDependencies`
    field). This doubles store reads per gate call, needs new wiring in `register.ts`, and
    repeats the window and failure logic. It loses to reusing the read in
    `readLocalMatrix`.
  - Sending figures for every lane and task kind. This costs bytes and fit width for lanes the
    model cannot pick, and the figure set would not shrink with the width.
  - Removing outcome blending from `score` to avoid double counting. This would change
    ranking-only routing (mode `ranking`, `phase-plan.ts` `dispatchMode`) for every user with
    no model set. It loses to a one-line note in the question text (live A/B in gap 1).
  - Lowering `CONFIDENCE_THRESHOLD` for depth. The current labels gave a wrong argmax on a
    clear feature (dark-mode toggle → `Minimal`, table A r4), so a lower threshold would accept
    wrong answers.
  - Promoting subagent rows from review verdicts. `final_review` is already counted as the
    review rate in `local-derivation.ts`. Mapping it onto `delivered` would merge two Req 9.1
    rates.
  - A new lane-outcomes filesystem port and token. `IFileSystemProvider.stat`
    (`platform-core/src/interfaces/file-system-provider.interface.ts:68`) is already the port
    the outcome-report tool stats through (`outcome-report.tool.ts:15, 179`), its token
    `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` (`platform-core/src/di/tokens.ts:13`) is bound by
    both host adapters (`platform-electron/src/registration.ts:117`,
    `platform-cli/src/registration.ts:71`), and lane-outcomes already imports platform-core.
    A narrower port would duplicate it and need a binding in every host.
  - Reading the subagent transcript (`SubagentStopPayload.transcriptPath`,
    `agent-sdk/.../subagent-stop-callback-registry.ts:16`). It widens file access to a model
    transcript of unbounded size; the final message already carries the `WROTE:` line.
  - Letting a later host report overwrite whatever is stored (plain `deliverables` effect).
    An explicit report held before the stop joins at insert, and the host report would then
    replace that explicit verdict.
- Assumptions:
  - A1: `SystemOneTarget` exposes `timeoutMs` (used by `systemOneClientOptions`,
    `model-refine.ts:93-101`). Check: open `decision-model.config.ts` `SystemOneTarget` before
    adding the field to the summary log.
  - A2: the installed Electron build carries the same `file-settings-manager.ts` watcher code
    as `main`. Check: the dead-watcher behaviour reproduces with the unit regression test, and
    the log evidence matches it either way.
  - A3: `SdkAdapterSubagentEndedEvent.cwd` (`sdk-adapter-events.service.ts:64`) is the
    session's workspace root (main checkout or worktree) that holds the subagent's
    deliverables. Check: the recorder spec uses a fixture whose `cwd` is a worktree path; a
    manual Electron run of one subagent shows the row `delivered` (DB read-only query).
  - A4: verified subagent rows bucket under family `SUBAGENT_FAMILY` in `deriveLocalMatrix`
    (`local-derivation.ts:131-160` `bucketFor`), so the subagent score cell moves from the seed
    toward the observed delivery rate. Check: read `bucketFor` before writing the recorder
    spec; no lane-routing change is planned for it.
- Effect on existing code: `CapabilityMatrixSnapshot` gains one required member (internal,
  not exported from `src/index.ts`). `LaneQuestion` gains `taskKind`. `ModelRequestOutcome`
  gains `outcomeFigures: number`. The wire payload shape is unchanged. lane-outcomes:
  `DeliverablesPayloadSchema` gains optional `origin: 'host'`, the deliverables
  `OutcomeReportEffect` gains optional `hostObserved`, `LaneOutcomeRecorder` gains an optional
  sixth constructor argument, and `src/index.ts` exports the containment/stat helper. All are
  additive. Nothing is removed except the wrong `'rename'` listener and the tool's blanket
  absolute-path rejection.

## Component specifications

### 1. Outcome figures from the matrix read (gap 1, with gap 2's exclusion)

- Purpose: give System One the aggregated delivered/failed counts behind each offered lane,
  for the phase's task kind.
- Root cause: `model-refine.ts:158` and `:231` hard-code `outcomeFigures: []`. No code
  aggregates figures, and `LaneQuestion` has no task kind to key them by.
- Responsibilities:
  - New pure module `matrix/outcome-figures.ts`. It exports
    `type OutcomeFigureLookup = (laneId: string, taskKind: OutcomeTaskKind) => DecisionOutcomeFigures | null`,
    `EMPTY_OUTCOME_FIGURES: OutcomeFigureLookup`, and
    `outcomeFiguresFrom(summaries: readonly LaneOutcomeSummary[]): OutcomeFigureLookup`.
    Rules:
    - Dedupe with the exported `dedupeByRun` (`local-derivation.ts:95`).
    - Skip `laneId === SUBAGENT_LANE_ID` (see Component 2, "pastOutcomes"), a blank `laneId`, and
      `taskKind === null`.
    - `delivered` counts verdict `delivered`. `failed` counts `failed` **and**
      `no-deliverable`. This matches the denominator of the Req 9.1 delivery rate in
      `local-derivation.ts:173-186`. `unverified` is skipped.
    - The lookup returns `null` when a pair has 0 delivered and 0 failed.
  - `CapabilityMatrixStore.readLocalMatrix` (`capability-matrix.store.ts:262-297`) returns
    `figures` next to `matrix`. It uses `EMPTY_OUTCOME_FIGURES` on every early or failure
    return. `load` (177) sets `outcomeFigures` on the snapshot. The window is the existing
    90-day `OUTCOME_WINDOW_MS` (281), the same evidence the score uses.
  - `CapabilityMatrixSnapshot` (`capability-matrix.store.ts:108-116`) gains
    `readonly outcomeFigures: OutcomeFigureLookup`. `gather.ts` `neutralSnapshot` returns
    `EMPTY_OUTCOME_FIGURES`.
  - `LaneQuestion` (`model-refine.ts:46-51`) gains `readonly taskKind: OutcomeTaskKind`.
    `phase-plan.ts` `laneQuestion` (209) sets it from `plan.taskKind`.
  - `runLaneRequest` takes `readonly outcomes: OutcomeFigureLookup`. `fitLane` builds, for
    each width, the de-duplicated figures for every phase × offered option (phase order, then
    option order, so the output is deterministic) and passes them to `buildDecisionPayload`.
    Width shrinking therefore shrinks the figures as well. The structured-output path
    (`renderLanePrompt`) appends one line per figure,
    `past outcomes <laneId>/<taskKind>: delivered N, failed M`, so both providers see the same
    facts. The byte check (`bodyBytes` / `textBytes`) covers the figures.
  - `runLaneRequest` returns `outcomeFigures: <count sent>` on its outcome.
    `ModelRequestOutcome` (`model-refine.ts:60-72`) gains `readonly outcomeFigures: number`.
    `emptyOutcome` (`model-call.ts:33`) and the other outcome builders in `model-call.ts` set
    it to 0.
  - `route-decide.service.ts` `runPass` (268-300) receives `gathered.matrix.outcomeFigures`
    from `decideGate` and passes it as `outcomes`.
  - `LANE_INSTRUCTIONS` (`phase-plan.ts:34`) becomes:
    `'Choose the executor for this phase. Each score already includes past outcomes; pastOutcomes lists the delivered and failed run counts behind it. No entry means no verified runs were available for that executor in the outcome window.'`
    The last sentence covers both an empty window and an unavailable reader
    (`capability-matrix.store.ts:262-296`), so it never implies that the read succeeded. The
    live A/B (variant C) used the earlier wording; the optional manual recheck below covers it.
  - `runFixedRequest` keeps `outcomeFigures: []`. A comment states the reason: pre-flight,
    task-kind and scope questions choose no lane.
- Verified contracts and entry points: `buildDecisionPayload` (`decision-payload.ts:75-119`),
  `DecisionOutcomeFigures` (36-42), `LaneOutcomeSummary` / `SUBAGENT_LANE_ID`
  (`libs/shared/src/lib/types/lane-outcome.types.ts:62, 121-138`), `LaneOutcomeReader`
  (same file, 160-181), `fitLane` (`model-refine.ts:210-245`).
- Dependencies: matrix → `decision-model/decision-payload` (type only, same library) and
  `@ptah-extension/shared`. This adds no new library edge.
- Integration points: `gatherRouteCall` → `GatheredCall.matrix` → `RouteDecideService.runPass`
  → `runLaneRequest`.
- Failure behaviour: reader missing, not persistent, throwing, or returning a non-array → the
  existing warn (`capability-matrix.store.ts:290, 311`) plus the reason, and empty figures. A
  matrix load that throws → `gather.ts` warn plus `neutralSnapshot`, and empty figures.
  Routing never fails because of figures. If figures make the body exceed
  `REQUEST_SIZE_LIMIT_BYTES` at width 2, the request is `payload-too-large` and falls back, as
  today.
- Quality requirements: security — only lane id, task kind and two integers leave the
  machine. The lane id is already in `availableExecutors`. No `runId`, model text or
  timestamps. Size — at most 4 options × 32 phases distinct pairs (about 60 bytes each,
  ≤ ~8 KB), and the shrink loop bounds it anyway.
- Live evidence (lane question with three options, scores 66/64/62, request
  "Implement the outcome figures aggregation …"):

  | Variant | pastOutcomes | Answer (confidence; p) |
  | --- | --- | --- |
  | A: today, `{}` | none | o1 (0.423; o1 .80) → **falls back** |
  | B: figures, current instructions | codex 40/2, grok 3/6, antigravity 0/4 | o1 (0.721; .93) |
  | C: figures + note above | same | o1 (0.959; .99) |
  | B, figures swapped | codex 3/6, grok 40/2 | o2 (0.394; .73) |
  | C, figures swapped | same | o2 (0.619; .86) |

  The model reads `pastOutcomes`. The counts lift confidence over the threshold. Note C raises
  confidence again without changing the choice.
- Verification seam: pure unit tests on `outcomeFiguresFrom` and `fitLane` via
  `runLaneRequest` with a stub `SystemOneCaller` that captures the payload.
- Tests to add:
  - `matrix/outcome-figures.spec.ts` (CREATE): dedupe; subagent skipped; null task kind
    skipped; `no-deliverable` counted as failed; `unverified` ignored; 0/0 → null.
  - `matrix/capability-matrix.store.spec.ts` (MODIFY): figures present with a reader; empty
    figures when the reader throws, is absent, or is not persistent.
  - `pipeline/model-refine.spec.ts` (CREATE): only offered lane × phase taskKind pairs are
    sent; a subagent option gets none; figures drop when the width shrinks; a structured
    prompt contains the lines; `runFixedRequest` sends `pastOutcomes: {}`.
  - `decision-model/decision-payload.spec.ts` (MODIFY): pins that a figure contributes exactly
    `{delivered, failed}` under `laneId/taskKind`.
  - `route-decide.gate.spec.ts` (MODIFY): the `neutralMatrix()` fixture gains
    `outcomeFigures`. Add one gate case whose matrix lookup returns figures and assert they
    reach the captured payload.
- Files: CREATE `libs/backend/lane-routing/src/lib/matrix/outcome-figures.ts`,
  `…/matrix/outcome-figures.spec.ts`, `…/pipeline/model-refine.spec.ts`. MODIFY
  `…/matrix/local-derivation.ts` (export `dedupeByRun`), `…/matrix/capability-matrix.store.ts`,
  `…/matrix/capability-matrix.store.spec.ts`, `…/pipeline/gather.ts`,
  `…/pipeline/model-refine.ts`, `…/pipeline/model-call.ts`, `…/pipeline/phase-plan.ts`,
  `…/route-decide.service.ts`, `…/decision-model/decision-payload.spec.ts`,
  `…/route-decide.gate.spec.ts`. (`…` = `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib`.)
- Nx projects to verify: `@ptah-extension/lane-routing`, then the depending hosts
  `ptah-electron` and `@ptah-extension/cli-engine` (tests + typecheck, mandatory; commands in
  the handoff).

### 2. Host-side subagent deliverables verdict (gap 2; user decision 10)

- Purpose: give a stopped subagent run a `delivered` / `no-deliverable` verdict from the files
  its final message says it wrote, without depending on a `ptah_outcome_report` call.
- Root cause (verified):
  - Both stop producers build their row from `reportedSubagentStopRow`, which fixes
    `verdict: 'unverified'` (`lane-outcome-recorder.service.ts:82-117`, used 203-244, 395-421).
  - The only promotion path is a `deliverables` report (`report-effect.ts:75-112`) through
    `ptah_outcome_report`, which also rejected absolute paths (Component 6).
    `declareSubagentDeliverables` (`lane-outcome-recorder.service.ts:253-282`) has no
    production caller. DB: 1 of 134 subagent runs was ever reported.
- Event source: only `recordSubagentEnded(event: SdkAdapterSubagentEndedEvent)` carries the
  final text (`lastAssistantMessage`, `cwd`; `sdk-adapter-events.service.ts:62-82`).
  `SubagentStopPayload` has no message (`subagent-stop-callback-registry.ts:8-18`), so
  `recordSubagentStop` gets no producer. Electron subscribes to `subagentEnded`
  (`apps/ptah-electron/src/di/container.ts:48`, `observeSubagentEnded: true`,
  `lane-outcomes/src/lib/di/start.ts:123-133`). cli-engine does not
  (`cli-engine/src/lib/lane-outcomes-wiring.ts:27`), so the producer is inert there and the
  benchmark's behaviour is unchanged.
- Responsibilities:
  - **Parser** — new pure module `lane-outcomes/src/lib/wrote-lines.parser.ts`,
    `parseWroteLines(message: string): { paths: readonly string[] } | { refusal: WroteRefusal }`
    (`WroteRefusal = 'none' | 'too-many' | 'malformed'`). Rules:
    - Scan only the last `WROTE_SCAN_MAX_CHARS = 16384` characters (the line is at the end of
      every role's return, e.g. `.claude/agents/project-manager.md:234`).
    - A matching line, after trimming and removing one leading backtick, starts with the
      case-sensitive `WROTE:`. The path is the text after it, cut at the first ` — ` (U+2014
      with spaces) and at a closing backtick, then trimmed and stripped of one pair of
      wrapping backticks or quotes.
    - Empty path, a NUL character, or a path longer than 1024 characters (the
      `OutcomeReportArgsSchema` path bound, `lane-outcome.schema.ts:19`) → `malformed`.
    - Distinct paths in order. More than 20 (the `DeliverablesPayloadSchema` bound,
      `report-effect.ts:20`) → `too-many`. No line → `none`.
  - **Shared containment + stat helper** — new module
    `lane-outcomes/src/lib/deliverable-check.ts`, exported from `src/index.ts`, used by this
    component and by Component 6:
    - `containedDeliverablePath(root: string, entry: string): string | null`: `resolve(root,
      entry)`; null when `relative(root, path)` is `..`, starts with `..${sep}` or is absolute,
      or when `entry` is a Windows drive or UNC path that is not absolute for the current
      platform (`win32.isAbsolute(entry) && !isAbsolute(entry)`, or `/^[A-Za-z]:/` on POSIX).
      An absolute entry inside the root is accepted. This lexical test is the first gate only.
    - `checkDeliverable(fs: Pick<IFileSystemProvider, 'stat' | 'realpath'>, root, path)`
      (round-2 fix for the symlink finding): resolve `realRoot = fs.realpath(root)` and
      `realPath = fs.realpath(path)`, then repeat the containment test on
      `relative(realRoot, realPath)`. A real path outside the real root returns
      `{ errorCode: 'outside-root' }` and is **never stat'ed**. Only then `fs.stat(realPath)`.
      `realpath` not-found (`ENOENT`, `ENOTDIR`, `FileNotFound`, `FileNotADirectory`) →
      `{ check: {exists:false, bytes:0, mtimeMs:null} }` (a missing file cannot leak data; the
      lexical gate already holds). Any other `realpath` error → `{ errorCode }`. A symlink whose
      target is inside the root is accepted; one whose target is outside is rejected; a dangling
      symlink reads as not found. `IFileSystemProvider.realpath` already exists
      (`platform-core/src/interfaces/file-system-provider.interface.ts:72`) on both hosts.
      Result: `{ check: {exists, bytes, mtimeMs} } | { errorCode: string }`; the not-found
      set moves from `outcome-report.tool.ts:65-79`. The same rule now applies to
      `ptah_outcome_report` (Component 6), which today follows symlinks out of the root.
    - Tests (`deliverable-check.spec.ts`, real temp dirs): in-root file; in-root symlink → in-root
      target (accepted); in-root symlink → outside target (`outside-root`, stat never called);
      dangling symlink (not found); root itself a symlink (realRoot used); `..` traversal;
      Windows drive entry on POSIX.
    - Location rationale: lane-outcomes owns `DeliverablesPayloadSchema`; vscode-lm-tools
      already imports lane-outcomes and lane-outcomes already imports platform-core, so no
      edge is added. platform-core would be the wrong home: the not-found mapping and the
      check shape are outcome semantics that only lane-outcomes and its tool use.
  - **Producer** — in `LaneOutcomeRecorder.recordSubagentEnded`, after `recordSubagentRow`
    returns a row, when a filesystem is present and `lastAssistantMessage` is non-blank, call
    a private `declareWrittenDeliverables(row.runId, event.cwd, message)` fire-and-forget
    (`void … .catch(warn)`, the `captureReview` pattern at 236-243). It runs for every role,
    independent of review capture. Steps: parse → `none` returns silently; refusal → warn;
    blank `cwd` → warn `no-root`; any entry not contained → warn `escapes-workspace`, no
    report (the tool refuses a whole report on one escape, `outcome-report.tool.ts:196-199`);
    stat all paths (`Promise.all`, ≤ 20); any `errorCode` → warn `stat-failed` with that code,
    no report; else `declareSubagentDeliverables({runId}, checks, {origin:'host'},
    {reportId: hostDeliverablesReportId(runId)})`. A result with `ok:false` → warn with the
    pipeline's fixed error string.
  - `declareSubagentDeliverables` gains `meta.origin?: 'host'` and an `options.reportId`
    (the `attachReview` shape, 287-306). `hostDeliverablesReportId(runId)` =
    `deliverables:host:${runId}` lives in `report-effect.ts` next to
    `deterministicReviewReportId` (64-69).
  - **Constructor and wiring** — `LaneOutcomeRecorder` gains an optional sixth argument
    `fileSystem?: Pick<IFileSystemProvider, 'stat'>`. `registerLaneOutcomeServices`
    (`di/register.ts:76-95`) passes
    `c.isRegistered(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER) ? c.resolve(...) : undefined`, the
    same optional pattern it uses for the classifiers. The recorder is resolved lazily on the
    first callback (`start.ts:77-80`), after the platform adapters are registered. No host file
    changes: `registerLaneOutcomeServices` is the only production constructor site (grep: three
    other sites are specs with five arguments, still valid), and no new token means
    `apps/ptah-electron/src/di/expected-resolvable.ts` is unchanged.
- Precedence and idempotency (verified store mechanics):
  - `DeliverablesPayloadSchema` (`report-effect.ts:8-25`) gains
    `origin: z.literal('host').optional()`. The MCP tool builds its payload itself from the
    strict `OutcomeReportArgsSchema` (`outcome-report.tool.ts:203-210`), so an agent cannot
    claim host origin. `reportEffectOf` (92-112) maps it to `hostObserved: true` on the
    deliverables `OutcomeReportEffect` (`store/lane-outcome.store.ts:43-55`).
  - `applyOutcomeEffect` (`lane-outcome.store.ts:61-87`): a `hostObserved` effect on a row whose
    `deliverablesDeclaredAt !== null` returns the row unchanged. Every explicit deliverables
    application sets that field (75). It is evaluated inside the store transaction
    (`sqlite-lane-outcome.store.ts:146-179, 238-246`; the in-memory and key-value stores call
    the same function, `in-memory-lane-outcome.store.ts:69, 98`), so there is no
    check-then-write race. Outcomes:
    - explicit before the stop → held, joined at insert (`ORDER BY held_at`, 192-235) → host
      report is a no-op;
    - explicit after the host report → overwrites the verdict through the existing subagent
      rule (`lane-outcome.store.ts:70-74`);
    - host report before the row is inserted → `missing` → held (subagent reports are
      holdable, `outcome-write-pipeline.ts:700-712`) and joined at insert.
  - The deterministic report id makes a repeated `subagentEnded` a receipt `duplicate`
    (`sqlite-lane-outcome.store.ts:151`) or a refused second hold (`holdReport` false).
  - The held payload holds stat facts only, never paths (`lane-outcome.store.ts:18`).
  - Known limit: subagent rows have `startedAt: null` (`lane-outcome-recorder.service.ts:103`),
    so `deliverablesVerdictOf` (`report-effect.ts:75-90`) skips the mtime check; a pre-existing
    non-empty file counts as delivered. This is the same semantics an explicit report has.
- Failure behaviour: every failure leaves the row `unverified` and never throws into the SDK
  callback. Warn line `'Subagent deliverables not verified'` with meta
  `{runId, reason, code?, paths: <count>}` only. **No path text is logged**: paths carry user
  and project names, and the existing convention keeps them out of logs and held payloads
  (`outcome-report.tool.ts:186-191` logs the code only; `lane-outcome.store.ts:18`). A
  message without a `WROTE:` line is normal (for example a team-leader return) and is not
  logged. Submit after shutdown returns `outcome pipeline closed`
  (`outcome-write-pipeline.ts:239-240`) and is logged the same way.
- `pastOutcomes`: subagent rows **stay excluded** from Component 1's figures. `LaneOutcomeSummary`
  has no `role` (`libs/shared/src/lib/types/lane-outcome.types.ts:117-134`), so the rows could
  only be pooled across roles under `subagent/<taskKind>`, which misattributes one role's
  record to another `subagent:<role>` option. What changes: the newly verified rows feed the
  subagent family score in `deriveLocalMatrix` (A4), which the model already sees as the
  option's score. Component 1's exclusion rule and its test are unchanged.
- Quality requirements: bounded work per stop (≤ 16 KiB scanned, ≤ 20 stats, no read of file
  contents); no path text in logs or storage; no filesystem access outside the session root.
- Verification seam: pure parser and helper unit tests; recorder spec with an in-memory store
  and a stub `stat`; one integration case through the real pipeline.
- Tests to add:
  - `wrote-lines.parser.spec.ts` (CREATE): absolute and relative paths; em-dash suffix;
    backticks; duplicates; `none`; 21 paths → `too-many`; 1025-char path and NUL → `malformed`;
    a `WROTE:` line before the scan window is ignored.
  - `deliverable-check.spec.ts` (CREATE): absolute inside root accepted; absolute outside,
    `..`, `../x`, drive path on POSIX rejected; not-found codes → `exists:false`; other errors →
    `errorCode`.
  - `write/report-effect.spec.ts` (MODIFY): `origin:'host'` → `hostObserved`; unknown origin
    value rejected (strict schema); `hostDeliverablesReportId` format.
  - `store/in-memory-lane-outcome.store.spec.ts` and `store/sqlite-lane-outcome.store.spec.ts`
    (MODIFY): host effect is a no-op after an explicit report; explicit after host overwrites;
    host on an undeclared row applies.
  - `lane-outcome-recorder.service.spec.ts` (MODIFY): `WROTE:` inside `cwd`, file non-empty →
    one host report, `delivered`; missing file → `no-deliverable`; no line → no submit, no warn;
    escaping path, stat error, blank cwd → no submit and a warn whose meta contains no path;
    repeated `subagentEnded` → one receipt; no filesystem → inert.
  - `subagent-stop.integration.spec.ts` (MODIFY): explicit report held before the stop wins over
    the host report.
  - `di/register.spec.ts` (CREATE; `di/start.spec.ts` stubs the recorder, so it cannot carry
    this): the recorder resolves with and without `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`
    registered, and receives the provider when it is.
- Files (`…` = `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src`):
  CREATE `…/lib/wrote-lines.parser.ts`, `…/lib/wrote-lines.parser.spec.ts`,
  `…/lib/deliverable-check.ts`, `…/lib/deliverable-check.spec.ts`. MODIFY
  `…/lib/lane-outcome-recorder.service.ts`, `…/lib/lane-outcome-recorder.service.spec.ts`,
  `…/lib/write/report-effect.ts`, `…/lib/write/report-effect.spec.ts`,
  `…/lib/store/lane-outcome.store.ts`, `…/lib/store/in-memory-lane-outcome.store.spec.ts`,
  `…/lib/store/sqlite-lane-outcome.store.spec.ts`, `…/lib/subagent-stop.integration.spec.ts`,
  `…/lib/di/register.ts`, `…/index.ts`; CREATE `…/lib/di/register.spec.ts`.
- Nx projects: `@ptah-extension/lane-outcomes`; dependents `ptah-electron`,
  `@ptah-extension/cli-engine` (tests + typecheck), `@ptah-extension/vscode-lm-tools`,
  `@ptah-extension/rpc-handlers`, `@ptah-extension/cli-agent-runtime`,
  `@ptah-extension/skill-synthesis` (typecheck; skill-synthesis is peer-owned and is only
  type-checked, never edited).

### 3. Route decision summary log (gap 3)

- Purpose: one `info` line per route call, so a decision is visible after the fact.
- Root cause: success logs only at debug (`system-one.client.ts:199-202`). The service logs
  nothing on success.
- Responsibilities:
  - New pure module `reasons/decision-summary.ts` with
    `preflightSummary(result, facts)` and `gateSummary(result, facts)`, both returning
    `LaneRoutingLogMeta`. `facts` = `{ durationMs, caller: OpenedCaller['kind'], model: string | null, timeoutMs: number | null, reused: boolean, outcomeFigures: number }`.
  - Fields:
    - `stage`, `durationMs`, `caller`, `model`, `timeoutMs` (system-one only, A1),
      `requests`, `inputTokens`, `outputTokens`, `overallConfidence`, `reused`.
    - pre-flight `answers`: `[{question:'taskType'|'depth', value, source, confidence, fallbackCause, proposal: modelProposal?.option ?? null, proposalConfidence}]`.
    - gate: `overallSource`, `outcomeFigures` (sum over passes), `excluded` (count only), and
      `phases: [{phaseId, status, executor: executor.id | 'unavailable', model, taskKind, source, confidence, fallbackCause}]`.
  - It must NOT include: `request`, `reasons` (they can carry file names and free phrases),
    `baseUrl`, `apiKey`, `selection`, criteria text, `excludedBy` candidate details, or
    error messages. The field list is an allow-list built from scratch, the same pattern as
    `buildDecisionPayload`.
  - `RouteDecideService` takes `started = this.nowMs` at the top of `decide` (114). It calls
    `this.deps.logger.info('[lane-routing] route decided', meta)` after each validated result:
    reused pre-flight (with `reused: true`, `caller: 'unset'`), `decidePreflight` (152), and
    `decideGate` (196, after `persistRotation`). It uses `this.nowMs` (seam) for
    `durationMs`, so tests stay deterministic.
- Dependencies: the result schemas (`contracts/route-decide-result.schema.ts:104-118, 218-244`)
  and `OpenedCaller` (`phase-plan.ts:58-72`). The logger is the existing `deps.logger`.
- Failure behaviour: the summary is built from an already validated result and cannot throw on
  valid input. Wrap the `info` call so that a throwing host logger cannot fail routing (catch
  and ignore, with a `// degradation-audit:` comment as at `capability-matrix.store.ts:290`).
  Schema failures still throw as today, and no summary is logged for them.
- Quality requirements: security — a unit test asserts that the serialised meta does not
  contain the request text or any `reasons` entry. One line per call; no per-option logging.
- Verification seam: `decision-summary.spec.ts` (pure). `route-decide.preflight.spec.ts` and
  `route-decide.gate.spec.ts` capture logger `info` calls: exactly one per `decide`, with the
  expected stage and per-question fields, and no request text.
- Files: CREATE `…/reasons/decision-summary.ts`, `…/reasons/decision-summary.spec.ts`; MODIFY
  `…/route-decide.service.ts`, `…/route-decide.preflight.spec.ts`, `…/route-decide.gate.spec.ts`.
- Nx project: `@ptah-extension/lane-routing`.

### 4. Pre-flight depth criteria (gap 4)

- Root cause (live evidence): the depth question sends the anonymous labels `o1..o3` with the
  bare words `Full`, `Partial`, `Minimal` and "Choose the depth." The model has no meaning for
  them. Its distribution stays near uniform, so the reported `confidence` stays 0.017-0.30
  (all 7 requests below 0.5), and the argmax is sometimes wrong. The reported `confidence` is
  not the top probability (p=0.54 → 0.128), so a flat distribution always falls back. The
  threshold works as designed; the labels are the defect.
- Live A/B (`d3:4b`, same two-question body the product sends, task_type unchanged; depth
  answer shown as choice/confidence):

  | # | Request (abridged) | A: today | B | C | **D (chosen)** |
  | --- | --- | --- | --- | --- | --- |
  | r1 | rename variable x → count | Minimal 0.128 | Minimal 0.756 | Minimal 0.447 | **Minimal 0.890** |
  | r2 | fix README typo | Minimal 0.154 | Minimal 0.762 | Minimal 0.537 | **Minimal 0.887** |
  | r3 | login null-pointer crash | Minimal 0.041 | Minimal 0.212 | Partial 0.241 | Partial 0.051 |
  | r4 | dark-mode toggle that persists | Minimal 0.017 (wrong) | Partial 0.068 | Partial 0.089 | **Partial 0.400** |
  | r5 | redesign whole billing platform | Full 0.299 | Full 0.919 | Full 0.858 | **Full 0.953** |
  | r6 | vague "help team collaborate" | Full 0.118 | Full 0.935 | Full 0.960 | **Full 0.988** |
  | r7 | this task's own request | Full 0.034 | Partial 0.040 | Partial 0.103 | Partial 0.149 |

  Above threshold: A 0/7, B 4/7, C 3/7, D 4/7. D has the highest confidence on every clear
  case and the right argmax on r4. The ambiguous mid cases (r3, r7) still fall back to the
  skill table, which is the safe outcome.
- Change: `preflight-answer.ts` keeps `values: DEPTHS` (the label → value mapping in
  `labeledValue` is unchanged) and adds per-value criterion text, used by `preflightQuestions`
  for the depth question. Instructions and texts (variant D, verbatim):
  - instructions: `Choose how much workflow this request needs before code is written.`
  - Full: `Full: the goal or scope is vague or open-ended; requirements must be gathered and the solution designed before any code`
  - Partial: `Partial: a known bug or a clearly specified change touching several files or components; plan it, implement it, review it`
  - Minimal: `Minimal: a tiny, mechanical edit in one place (rename, typo, one-line fix) that one developer can finish directly`
  - Shape: a `Readonly<Record<Depth, string>>` keyed by `DEPTHS` values, mapped in `DEPTHS`
    order. `criterionLabels` stays for task_type. `CONFIDENCE_THRESHOLD` is unchanged.
- Task type: unchanged (finding 5: 0.89-0.92). A descriptive variant was tried. It lifted
  "fix README typo" from 0.75 to 0.95 but left the three ambiguous requests below 0.6, so it
  is not part of this fix (`decisions.md` row 8).
- Failure behaviour: unchanged. A low confidence still yields `skill-table` with
  `fallbackCause: 'low-confidence'` and a `modelProposal`.
- Evaluation harness:
  - Reuse `decision-model/system-one.live.fixtures.ts`. Add `depth-preflight-*` fixtures whose
    `instructions` and `criteria` are built from `preflightQuestions()` (depth entry), so the
    live eval checks the shipped text. Use the r1 (expect Minimal), r5 (Full) and r6 (Full)
    requests, which have one defensible answer.
  - The existing suite targets Ollama Cloud only (`system-one.live.spec.ts`). The local `d3:4b`
    check stays the manual curl A/B above. Its request bodies match
    `buildDecisionPayload` for `runFixedRequest`.
- Tests: `pipeline/preflight-answer.spec.ts` (CREATE): the depth criteria carry the
  descriptions in `DEPTHS` order; `o1/o2/o3` still map to `Full/Partial/Minimal`; task_type
  criteria are unchanged. The `system-one.live.fixtures.ts` load-time validation covers the
  new fixtures.
- Files: MODIFY `…/pipeline/preflight-answer.ts`, `…/decision-model/system-one.live.fixtures.ts`;
  CREATE `…/pipeline/preflight-answer.spec.ts`.
- Nx project: `@ptah-extension/lane-routing`.

### 5. Settings watcher follows atomic replacement (gap 5)

- Finding: **confirmed bug**, not in lane-routing.
  - `decision-model.target.ts:184-214` reads the setting per call, correctly.
  - Electron serves the value from `PtahFileSettingsManager`'s in-memory map
    (`electron-workspace-provider.ts:99-100`). That map is refreshed from disk only by the
    cross-process watcher.
  - `tryStartFileWatch` (`file-settings-manager.ts:318-324`) registers
    `watcher.on('rename', …)`. Node's `FSWatcher` emits only `'change'` (with
    `eventType` `'rename'|'change'`), `'close'` and `'error'`, so `handleFileRename` (409)
    never runs and the watcher is never re-established.
  - After the first atomic replacement of `settings.json` (any in-app `set()`, `persist()`
    630-642, or an external atomic write), the inotify watch stays on the dead inode, and no
    later external edit is reloaded until restart (Node experiment above).
  - The app started 2026-11-03. The 2026-11-04 11:06Z external edit to 60000 was never loaded,
    so every call kept the stale 30000.
  - Consequence: on quit, `flushSync` writes the stale in-memory map over the file
    (`file-settings-manager.ts` `flushSync`), which could revert external edits.
- Change: one `'change'` listener that dispatches on `eventType`: `'rename'` →
  `handleFileRename()`, otherwise `scheduleDebouncedFlush()`. Remove the `'rename'` listener.
  `handleFileRename` already debounces, re-reads, closes the stale watcher and re-establishes
  on the path, falling back to the directory watcher. Keep that.
- Contracts changed: none public.
- Failure behaviour: unchanged. Watcher errors keep the existing backoff
  (`handleWatcherError`). A read failure during reload keeps the previous map and warns.
- Tests:
  - `file-settings-manager.error-paths.spec.ts` (MODIFY): mocked emitters emit
    `('change', 'rename', 'settings.json')` instead of `'rename'`. Add a case: a `'change'`
    event with `eventType 'change'` does not re-establish the watcher.
  - `file-settings-manager.cross-process.spec.ts` (MODIFY, regression): with an existing
    `settings.json` (file-watch mode), perform **two successive atomic replacements**
    (writeFile tmp + rename, from the test process or the existing child helper). Assert that
    the watched key receives the second value within the existing 2000 ms window. This test
    fails on `main` and passes with the fix.
- Ops note (not code): restart Ptah Electron to load `decisionModelTimeoutMs=60000` now. After
  the fix, the Component 3 summary log shows `timeoutMs` per call, which makes this checkable.
- Files: MODIFY
  `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/platform-core/src/file-settings-manager.ts`,
  `…/platform-core/src/file-settings-manager.error-paths.spec.ts`,
  `…/platform-core/src/file-settings-manager.cross-process.spec.ts`.
- Nx projects: `@ptah-extension/platform-core`; the adapters `@ptah-extension/platform-electron`,
  `@ptah-extension/platform-cli`; the hosts `ptah-electron`, `@ptah-extension/cli-engine`
  (tests + typecheck, mandatory; commands in the handoff). The manager's public API does not
  change, so the other ~25 platform-core importers need no check.

### 6. Outcome reports accept absolute paths inside the workspace (gap 2, tool side)

- Evidence (live, 2026-11-04, `decisions.md` row 6): `ptah_outcome_report
  {kind:'deliverables', paths:['/home/amun/…/implementation-plan.md']}` returned
  `recorded:false, reason:"deliverable path escapes workspace"` for a path inside the root; the
  workspace-relative path returned `recorded:"applied"`.
- Root cause (verified): `outcome-report.tool.ts:164-177` rejects any `isAbsolute(entry)`,
  `win32.isAbsolute(entry)` or drive-letter entry before the containment test. The skill and
  agent catalogue hand agents absolute `**Deliverable**:` paths, so compliant reports fail.
- Responsibilities:
  - Replace the inline rule and the local not-found set (65-79, 164-195) with
    `containedDeliverablePath` and `checkDeliverable` from `@ptah-extension/lane-outcomes`
    (Component 2). The returned reasons stay the same strings
    (`deliverable path escapes workspace: <entry>`, `deliverable stat failed for <entry>`) —
    they go back to the calling agent, not to a log — and the stat warn keeps logging the code
    only (186-191).
  - Schema description: the MCP input schema is generated from the zod schema
    (`outcomeInputSchema`, `outcome-report.tool.ts:47-63`) and `flattenOperationUnion` keeps an
    existing `description` and appends its "Required for kind …" note
    (`mcp-core/surface-tools.ts:105-128`). So the text goes on the zod field itself:
    `lane-outcome.schema.ts:19` becomes
    `paths: z.array(z.string().min(1).max(1024)).max(20).describe('Deliverable files: absolute paths inside the workspace, or workspace-relative paths. At most 20.')`.
    Validation is unchanged.
  - The tool description (`buildOutcomeReportTool`, 81-92) is unchanged.
  - Sibling consumer checked: `cli-agent-runtime/.../lane-completion-notifier.service.ts:147-153`
    already resolves absolute entries; it has no such defect and is not changed.
- Failure behaviour: unchanged reasons for real escapes; no new filesystem access.
- Verification seam: `outcome-report.tool.spec.ts` (MODIFY): absolute inside root → applied;
  absolute outside root → escapes; `..` traversal → escapes; drive path on POSIX → escapes;
  generated `inputSchema.properties.paths.description` starts with the new text and still ends
  with the "Required for kind deliverables" note. `mcp-contract.sweep.spec.ts` runs in the same
  project and covers the published schema.
- Files: MODIFY
  `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts`,
  `…/mcp-core/tools/outcome-report.tool.spec.ts`,
  `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts`.
- Ownership: vscode-lm-tools and lane-outcomes are outside TASK_2026_878_5513's list.
- Nx projects: `@ptah-extension/vscode-lm-tools`, `@ptah-extension/lane-outcomes` (schema
  file); dependents `ptah-electron`, `@ptah-extension/cli-engine` (tests + typecheck),
  `@ptah-extension/rpc-handlers`, `@ptah-extension/gateway-chat-bridge` (typecheck).

## Integration architecture

- Data flow (gate): `RouteDecideService.decide` → `gatherRouteCall` → `CapabilityMatrixStore.load`
  → `LaneOutcomeReader.recentOutcomes` per lane (90 d) → `deriveLocalMatrix` (scores) and
  `outcomeFiguresFrom` (counts) → `planRoutePhases` → `runPass` → `runLaneRequest(outcomes)` →
  `fitLane` (width loop, figures per offered pair) → `buildDecisionPayload` → System One →
  `assembleGateResult` → schema check → `persistRotation` → `logger.info('[lane-routing] route decided')`.
- Data flow (pre-flight): `decidePreflight` → `runFixedRequest(preflightQuestions())` (new depth
  text, no figures) → `readPreflight` → schema check → info summary.
- Data flow (subagent verdict, Electron): SDK `SubagentStop` hook → `SdkAdapterEvents.subagentEnded`
  → `LaneOutcomeRecorder.recordSubagentEnded` → `recordSubagentRow` (enqueue `subagent-stop`) →
  `parseWroteLines(lastAssistantMessage)` → `containedDeliverablePath(cwd, entry)` →
  `checkDeliverable(fs.realpath+stat, cwd)` → `declareSubagentDeliverables(origin host, deterministic id)` →
  `OutcomeWritePipeline.submit` → store `applyReportWithReceipt` (or hold → join at insert) →
  `applyOutcomeEffect` precedence → row `delivered` / `no-deliverable` → read by
  `LaneOutcomeReader` into the subagent family score.
- State or persistence: no schema migration. Host reports use the existing receipt and
  held-report tables; payloads hold stat facts only. Figures live for one call.
- External boundaries: System One keeps the NFR Security allow-list
  (`decision-payload.ts:67-74`); the log meta is an allow-list. Model text (`WROTE:` lines) is
  untrusted input: bounded parse, lexical containment plus real-path (symlink-resolved)
  containment in the session root, stat only (no
  content read). Settings reload reads the user's own file with the existing guards.
- Failure and rollback: each component degrades to today's behaviour (empty figures, no log
  line, stale settings, `unverified` row) and never breaks routing or the SDK callback. Revert
  is code-only; rows already promoted stay valid verdicts.
- Observability: the route info line (stage, per-question choice, confidence, source,
  fallbackCause, durationMs, requests, timeoutMs, outcomeFigures); the
  `'Subagent deliverables not verified'` warn (runId, reason, code, path count); the DB verdict
  counts per executor kind.

## Architecture-level quality requirements

- Functional:
  - A gate request with outcome history sends a non-empty `pastOutcomes` containing only
    offered lane × phase-taskKind keys. Subagent rows never appear in it.
  - Each `decide` logs exactly one info summary.
  - With the shipped depth text, the clear Minimal/Full requests answer with confidence ≥ 0.5
    on `d3:4b` (r1, r2, r5, r6 above).
  - A second atomic replacement of `settings.json` is reloaded.
  - A subagent whose final message names an existing non-empty file inside its `cwd` gets
    `delivered`; a named missing file gets `no-deliverable`; no `WROTE:` line, an escaping path
    or a stat error leaves `unverified`. An explicit report, before or after, decides the
    verdict.
  - `ptah_outcome_report` with an absolute in-workspace path is applied.
- Performance: no extra outcome-store read for routing. Figure aggregation is
  O(rows ≤ 2000 × lanes); payload ≤ ~8 KB more under the 64 KiB cap. Per subagent stop:
  ≤ 16 KiB scanned, ≤ 20 `stat` calls, off the callback's synchronous path.
- Security: no request text, reasons, URLs, keys, error messages or file paths in log meta or
  held payloads. No host-origin claim reachable from MCP input. No file outside the session
  root is stat'ed by the host producer.
- Maintainability: lane-routing still imports only `shared` and `platform-core`; no new import
  edge anywhere; no new DI token; no host composition-root edit.
- Testability: listed per component. One regression test per bug (watcher: two atomic
  replacements; figures: offered-pair filter; depth: criteria mapping; tool: absolute in-root
  path; producer: explicit-report precedence).

## Team-leader handoff

- Recommended executors: backend-developer for all groups (TypeScript library code with unit
  tests, no UI). Senior-tester is optional for the platform-core real-fs regression test and
  the sqlite precedence cases.
- Complexity: MEDIUM-HIGH. Four libraries; an internal contract change across five lane-routing
  files; a new untrusted-input producer with store precedence in lane-outcomes; no host wiring.
- Dependencies and ordering (component-level; proposed groups, the team-leader owns the final
  decomposition):
  - Group W (Component 5, platform-core): `file-settings-manager.ts`, its two specs.
  - Group F (Component 1, lane-routing figures): `outcome-figures.ts` + spec,
    `local-derivation.ts`, `capability-matrix.store.ts` + spec, `gather.ts`, `model-refine.ts`,
    `model-refine.spec.ts`, `model-call.ts`, `phase-plan.ts`, `decision-payload.spec.ts`,
    `route-decide.service.ts`, `route-decide.gate.spec.ts`.
  - Group L (Component 3, summary log): `decision-summary.ts` + spec, `route-decide.service.ts`,
    `route-decide.preflight.spec.ts`, `route-decide.gate.spec.ts`. Shares two files with F and
    reads `ModelRequestOutcome.outcomeFigures`, so it **runs after F**.
  - Group D (Component 4, depth text): `preflight-answer.ts`, `preflight-answer.spec.ts`,
    `system-one.live.fixtures.ts`.
  - Group O (Component 2, lane-outcomes producer): every lane-outcomes file of Component 2,
    including `src/index.ts`.
  - Group R (Component 6, tool): `outcome-report.tool.ts`, `outcome-report.tool.spec.ts`,
    `lane-outcomes/src/lib/lane-outcome.schema.ts`. File-disjoint from O, but imports
    `containedDeliverablePath` / `checkDeliverable` that O exports, so it **runs after O**.
- Parallel-safe work: W, F, D and O in parallel. L after F. R after O.
- Files affected:
  - CREATE (lane-routing): `src/lib/matrix/outcome-figures.ts`, `…/matrix/outcome-figures.spec.ts`,
    `…/pipeline/model-refine.spec.ts`, `…/reasons/decision-summary.ts`,
    `…/reasons/decision-summary.spec.ts`, `…/pipeline/preflight-answer.spec.ts`.
  - CREATE (lane-outcomes): `src/lib/wrote-lines.parser.ts`, `…/wrote-lines.parser.spec.ts`,
    `…/deliverable-check.ts`, `…/deliverable-check.spec.ts`, `…/di/register.spec.ts`.
  - MODIFY (lane-routing): `matrix/local-derivation.ts`, `matrix/capability-matrix.store.ts`,
    `matrix/capability-matrix.store.spec.ts`, `pipeline/gather.ts`, `pipeline/model-refine.ts`,
    `pipeline/model-call.ts`, `pipeline/phase-plan.ts`, `pipeline/preflight-answer.ts`,
    `route-decide.service.ts`, `route-decide.gate.spec.ts`, `route-decide.preflight.spec.ts`,
    `decision-model/decision-payload.spec.ts`, `decision-model/system-one.live.fixtures.ts`.
  - MODIFY (lane-outcomes): `src/index.ts`, `src/lib/lane-outcome-recorder.service.ts` + spec,
    `src/lib/write/report-effect.ts` + spec, `src/lib/store/lane-outcome.store.ts`,
    `src/lib/store/in-memory-lane-outcome.store.spec.ts`,
    `src/lib/store/sqlite-lane-outcome.store.spec.ts`, `src/lib/subagent-stop.integration.spec.ts`,
    `src/lib/di/register.ts`, `src/lib/lane-outcome.schema.ts` (Group R).
  - MODIFY (vscode-lm-tools): `src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts` +
    `outcome-report.tool.spec.ts`.
  - MODIFY (platform-core): `src/file-settings-manager.ts`,
    `src/file-settings-manager.error-paths.spec.ts`,
    `src/file-settings-manager.cross-process.spec.ts`.
  - REWRITE: none. No host app, agent-sdk or peer-owned file changes.
- Verification points (mandatory, memory-safe: project-scoped `npm run verify -- -p …` only,
  each run waits for the machine-wide verify lock; never workspace-wide, never
  build/serve/e2e; confirm the Nx header names the requested project count):
  - After F, L, D: `npm run verify -- -p @ptah-extension/lane-routing`, then
    `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`
    (both import lane-routing: `apps/ptah-electron/src/di/phase-2-libraries.ts`,
    `libs/backend/cli-engine/src/lib/container.ts`).
  - After O: `npm run verify -- -p @ptah-extension/lane-outcomes`, then
    `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`
    (Electron `container.smoke.spec.ts` covers lane-outcomes registration), then
    `npm run verify -- -t typecheck -p @ptah-extension/vscode-lm-tools,@ptah-extension/rpc-handlers,@ptah-extension/cli-agent-runtime,@ptah-extension/skill-synthesis`
    (every other lane-outcomes importer, found by import grep).
  - After R: `npm run verify -- -p @ptah-extension/vscode-lm-tools,@ptah-extension/lane-outcomes`,
    then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine` and
    `npm run verify -- -t typecheck -p @ptah-extension/rpc-handlers,@ptah-extension/gateway-chat-bridge`.
  - After W: `npm run verify -- -p @ptah-extension/platform-core,@ptah-extension/platform-electron,@ptah-extension/platform-cli`,
    then `npm run verify -- -t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`.
  - When several groups land together, one host run
    (`-t test,typecheck -p ptah-electron,@ptah-extension/cli-engine`) after the last of them
    satisfies every group; the Nx cache makes repeats cheap.
  - Confirm assumptions A1 (before Component 3), A3 and A4 (before Component 2's specs).
  - Optional manual checks after merge: the `/tmp/s1eval`-style curl A/B against
    `http://127.0.0.1:11435/v1/systemone` with the shipped depth text and lane note; one
    Electron subagent run, then a read-only DB query that its row is `delivered`.

## Open questions

1. Task-type criteria text: resolved by the orchestrator (`decisions.md` row 8): unchanged.
   Live confidence 0.89–0.92; the single A/B was mixed.

No other question is open. The former question on a host-side subagent verdict producer is
settled by the user (`decisions.md` row 10) and is Component 2.

## Needs peer coordination

- None. No planned file is in TASK_2026_878_5513's list (memory-curator*, skill-synthesis*,
  workspace-indexing, memory/indexing/skills-synthesis rpc handlers and their shared types,
  agent-sdk curator-llm adapter, codex routing-agent-adapter and Codex capability wiring
  including agent-sdk `di/register.ts`). Component 2 consumes agent-sdk types only and needs no
  agent-sdk edit. `@ptah-extension/skill-synthesis` (peer-owned) is only type-checked after
  Group O, because it imports lane-outcomes; the changes there are additive.
- Courtesy notices the coordinating agent may send: `platform-core/src/file-settings-manager.ts`
  changes reload behaviour for every file-based setting; lane-outcomes exports grow (additive).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Figures come from the matrix store's existing read | second reader call; matrix read | `capability-matrix.store.ts:262-297`, `di/register.ts:74-84` | yes |
| Only offered lane × phase taskKind pairs, recomputed per width | all lanes; offered only | `model-refine.ts:210-245` | yes |
| `failed` = failed + no-deliverable | failed only | Req 9.1 denominator in `local-derivation.ts:173-186` | yes |
| Subagent rows excluded from figures, also after Component 2 | pool by `subagent/<taskKind>`; exclude | summaries lack role (`lane-outcome.types.ts:117-134`); score already carries them | yes |
| Keep score blending; add the instruction note (window wording) | strip blending; note | live A/B rows B/C; review finding 4 | yes |
| Pre-flight and classifiers send no figures | send all | they choose no lane | yes |
| Depth variant D; threshold unchanged | A/B/C/D; lower threshold | live table, gap 4 | yes |
| Watcher dispatches on `eventType` | lane-routing re-read workaround | Node experiment; `file-settings-manager.ts:318-324` | yes |
| Host producer in `recordSubagentEnded` only | also `recordSubagentStop`; transcript read | only the ended event has the message (`sdk-adapter-events.service.ts:79`) | yes |
| Reuse `IFileSystemProvider` via optional resolve in `registerLaneOutcomeServices` | new lane-outcomes port + host bindings | token bound in both adapters (`platform-electron/src/registration.ts:117`, `platform-cli/src/registration.ts:71`) | yes |
| Host report never overrides an explicit one: `origin:'host'` → `hostObserved`, no-op when `deliverablesDeclaredAt` is set; deterministic report id | newest wins; recorder-side pre-check | transactional `applyOutcomeEffect` (`sqlite-lane-outcome.store.ts:146-179`); receipts (151) | yes |
| One escaping path or stat error → no report (unverified) | drop bad paths and verify the rest | tool refuses a whole report on one escape (`outcome-report.tool.ts:196-199`); a dropped path could turn no-deliverable into delivered | yes |
| Warn meta without path text | log the path | `lane-outcome.store.ts:18`; tool logs code only (186-191) | yes |
| Containment + stat helper lives in lane-outcomes, used by the tool | platform-core; duplicate in each | no new edge (`outcome-report.tool.ts:4-15`); outcome semantics | yes |
| `paths` description via `.describe()` on the zod field | separate JSON-schema patch in the tool | `outcomeInputSchema` derives from zod; flatten keeps descriptions (`surface-tools.ts:105-128`) | yes |
| cli-engine keeps not observing `subagentEnded` | opt it in | benchmark behaviour unchanged; Electron first (`lane-outcomes-wiring.ts:27`) | yes |
