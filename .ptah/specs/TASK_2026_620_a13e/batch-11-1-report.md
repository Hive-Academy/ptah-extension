# Batch 11.1 report

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\session-jsonl-writer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\session-jsonl-writer.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\skill-session-fixture.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\skill-session-fixture.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\skill-sessions.v1\` (30 JSONL files and `index.json`)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`

## Fixture design

`gt-skill-sessions@v1` has 30 deterministic synthetic sessions: 12 routine sessions (four routines, three sessions each), 10 non-routine sessions, and 8 degraded sessions (four unreadable-line and four unsupported-tool-use cases). Each script is zod-validated and the expected activity feed list is derived only by `expectedEventsFromScript`, not by a pipeline result.

Scripts map `session-end` to `analyze-run`, `idle-timeout` to `idle-trigger` then `analyze-run`, `manual-analyze` to `manual-run` then `analyze-run`, and the two degraded operations to `ineligible` with a ground-truth rejection note. The product event union defines these names at `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts:35-48`; the feed wire payload is at `libs/shared/src/lib/types/messages/payload-map.ts:172-175`. The current `ineligible` producer is `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:738-765`.

## Checks

- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand`: `Test Suites: 31 passed, 31 total`; `Tests: 360 passed, 360 total`.
- `npx nx run-many -t typecheck,lint -p mcp-bench`: `NX Successfully ran targets typecheck, lint for project mcp-bench`.
- `npx prettier --check --ignore-unknown <changed files>`: failed only because `tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/index.json` needs prettier reformatting. All source files passed before that warning.

## Deviation

The new writer is used by `seeded-session-generator.ts` and preserves its full scoped spec output, but the former local `TurnBuilder` remains as unused duplicate code. It should be removed in a follow-up mechanical cleanup. `ptah_agent_report` was not available in this agent's tool surface, so no report call could be made.

## Revision 1

The fixture golden test now compares `index.json` semantically with `JSON.parse`, retains byte equality for every JSONL session, and adds an in-memory byte-determinism assertion. The fixture-update path rebuilds the manifest separately after the index has been formatted.

The requested `TurnBuilder` deletion remains incomplete: `apply_patch` could not match the legacy block because of its pre-existing malformed dash encoding. The final all-check rerun did not complete because PowerShell treats Jest's successful stderr summary as a terminating native-command error under `ErrorActionPreference=Stop`. No successful final verification result is claimed for Revision 1.

## Orchestrator verification and revise round 2 (in-process)

Revision 1 claims were not all true: `class TurnBuilder` was still in
`seeded-session-generator.ts` (unused), and `index.json` still failed prettier. The orchestrator
deleted the dead class (lines 783-903), ran `prettier --write` on `index.json`, and rebuilt
`MANIFEST.json` with `REBUILD_MANIFEST=1` on the fixture spec. Re-run by the orchestrator:
scoped jest `Test Suites: 31 passed, 31 total`, `Tests: 361 passed, 361 total`; typecheck + lint
for mcp-bench succeeded; prettier clean on the fixture dir and `ground-truth/`; no user-data
match in the fixtures. These in-process edits go to the Phase 3.2 review by a CLI lane.
Regeneration note: after `UPDATE_FIXTURES=1`, run `prettier --write` on `index.json`, then
`REBUILD_MANIFEST=1`.

## Revision 3

Applied the final contract decisions and regenerated `skill-sessions.v1` with
`UPDATE_FIXTURES=1`, formatted `index.json`, then rebuilt `MANIFEST.json` with
`REBUILD_MANIFEST=1`. The fixture spec continues to verify the committed
manifest.

`prefilterTooThin` has been removed from the fixture script vocabulary. Q&A,
aborted, and unreadable sessions all retain at least two role turns, so their
scripts now derive `ineligible { reason: prefilterRejected }`. This follows the
extract-null branch at
`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:569-581` and
the reader floor at `trajectory-extractor.ts:203-205`: they are readable but
lack work evidence, so the prefilter-rejection producer applies at
`skill-synthesis.service.ts:747-767`.

Single-edit sessions remain `routine: null`, but their scripts now contain only
`session-end` and expect no `ineligible` event. One Edit satisfies the default
minimum edit threshold (`libs/backend/skill-synthesis/src/lib/eligibility/session-work-evidence.ts:15-23`; defaults at
`libs/backend/platform-core/src/file-settings-keys.ts:580-581`). Their later
archaeology/cluster decision is intentionally outside this feed fixture.

| Script operation                                                          | Fixture class                         | Expected skills activity events            | Producer / contract                                                                                                                                                                                                                    | Expected today                                               |
| ------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `session-end`                                                             | all classes                           | none directly                              | enqueue and same-turn guard: `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:560-608`                                                                                                                                 | measure — queue drain is asynchronous                        |
| `drain-eligible-candidate`                                                | routine                               | `analyze-run`                              | pushed after candidate registration: `skill-synthesis.service.ts:935-948`                                                                                                                                                              | measure — only after registration succeeds                   |
| `idle-timeout`                                                            | Q&A                                   | `idle-trigger`                             | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:741`                                                                                                                                                           | measure — does not imply `analyze-run`                       |
| `manual-analyze`                                                          | Q&A, aborted                          | `manual-run`                               | declared by `libs/backend/skill-synthesis/src/lib/diagnostics.types.ts:3-18`; skills `analyzeNow` calls `analyzeSession` but does not push it at `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:830-869` | **fail — no skills producer emits `manual-run`**             |
| `prefilter-rejected`                                                      | Q&A, aborted, unreadable, unsupported | `ineligible { reason: prefilterRejected }` | `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:747-767`                                                                                                                                                              | measure — each is readable but lacks required work evidence  |
| ~~no rejection operation after `session-end`~~ (superseded by Revision 4) | single edit                           | none                                       | Edit work evidence: `eligibility/session-work-evidence.ts:15-23`; defaults: `file-settings-keys.ts:580-581`                                                                                                                            | measure — passes prefilter; later clustering is out of scope |

The memory curator's `manual-run` at
`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:694-699` is
explicitly not cited as a skills producer: it calls `this.curator.pushEvent`.
The expected `manual-run` remains in this ground truth because the skills event
union declares it, while the table records the current product gap rather than
hiding it.

Exact Revision 3 check results:

```text
Test Suites: 5 passed, 5 total
Tests:       82 passed, 82 total
Snapshots:   0 total
Time:        10.018 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/ground-truth.
EXIT=0

Checking formatting...
All matched files use Prettier code style!
EXIT=0

EXIT=0
```

## Revision 4 (Phase 3.6 review finding 1; SUPERSEDED by Revision 5: its expectation encoded today's behaviour)

Revision 3 gave single-edit sessions (20-22) the script `["session-end"]` and the expectation `[]`, on the grounds that "their later archaeology/cluster decision is intentionally outside this feed fixture". That was wrong. The feed event does not come from archaeology or clustering. It comes from authoring, and authoring happens inside the drain that the bench causes for every queued session:

- One Edit meets `prefilterMinEdits` (default 1), so the session passes the prefilter (`eligibility/session-work-evidence.ts:15-23`).
- The frequent drain's prefilter stage then runs `analyzeSession`.
- `analyzeSession` registers a candidate and pushes `analyze-run` (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1149-1154` at the time of this revision).
- Archaeology runs later (nightly) and pushes no feed event. Nothing under `archaeology/`, `queue/stage-handlers.service.ts`, `queue/skill-drain.service.ts` or `gates/judge-panel.service.ts` calls `pushEvent`.

So the expectation `[]` could not be met under the fixture's own prefilter model. The scripts are now `["session-end", "drain-eligible-candidate"]` and the expectation is `[analyze-run]`. Drafting a single edit is itself a product defect, but feed parity is the wrong place to score it: the cluster stage scores it (`no-single-session-auto-candidate`) and so does the archaeology stage (`no-candidate-without-routine`). The fixture records what the pipeline correctly reports, not what it should have decided.

Regenerated with `UPDATE_FIXTURES=1`, then `npx prettier --write index.json`, then `REBUILD_MANIFEST=1`. The fixture spec pins the new scripts.

| Script operation                          | Fixture class                | Expected skills activity events | Producer / contract                                                                                                        | Expected today                |
| ----------------------------------------- | ---------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `session-end`, `drain-eligible-candidate` | single edit (sessions 20-22) | `analyze-run`                   | prefilter pass: `eligibility/session-work-evidence.ts:15-23`; push on registration: `skill-synthesis.service.ts:1149-1154` | measure (the drain drafts it) |

## Revision 5 (Phase 3.6 review round 2: ground truth for a correct pipeline)

Correction to Revision 4. Its product trace was accurate: the drain drafts a single edit and pushes `analyze-run` (`skill-synthesis.service.ts:1149-1154`), and archaeology pushes no event. Its conclusion was wrong. It turned today's behaviour into ground truth. This fixture states what a CORRECT pipeline reports, and 620 absorbed TASK_2026_588 (`context.md` "Absorbed scope"): archaeology runs before authoring, and a no-routine verdict is rejected with a visible reason, so no single-session draft is made.

Sessions 20-22 (single edit, `routine: null`) now use the script `["session-end", "archaeology-no-routine"]`. The expectation is `[ineligible { reason: noRoutine }]`, with no `analyze-run`. `noRoutine` is added to the fixture's own expected-reason schema as a design-required reason, citing 588. The product's event union is unchanged. Regenerated with `UPDATE_FIXTURES=1`, then prettier, then `REBUILD_MANIFEST=1`.

| Script operation                        | Fixture class                | Expected skills activity events    | Producer / contract                                                                                                                 | Expected today                                                                                                                                                                |
| --------------------------------------- | ---------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-end`, `archaeology-no-routine` | single edit (sessions 20-22) | `ineligible { reason: noRoutine }` | design-required by 588 (archaeology before authoring, reject a no-routine verdict with a visible reason); no product producer today | **fail**: the product drafts the session and emits `analyze-run` (`skill-synthesis.service.ts:1149-1154`), and it has no `noRoutine` reason. Closes with the Phase 4 588 fix. |

## Revision 2 (SUPERSEDED by Revision 3 above — its table has the old `prefilter-too-thin` rows and a wrong `manual-run` citation; kept as history only)

The fixture writer now emits the SDK-shaped `message.content` array that the
trajectory reader parses: `tool_use` blocks expose `name` and `input`, and
`tool_result` blocks expose `content`
(`libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts:263-288`,
`336-368`). Routine sessions therefore have the same ordered Read → Edit →
Bash-test sequence (and paired results) in each of the three repetitions;
their Edit counts as an edit and their non-MCP tool uses pass the default
prefilter (`trajectory-extractor.ts:357-365`,
`eligibility/session-work-evidence.ts:15-23`,
`file-settings-keys.ts:580-581`). Q&A has no tools, aborted sessions stop
before a tool, and single-edit sessions have exactly one Edit.

The four unreadable fixtures inject the fixed truncated line
`{"type":"assistant","message":` after their first valid record. The four
unsupported fixtures contain an assistant `tool_use` block named
`UnsupportedSyntheticTool`; both properties are pinned by the golden spec.
The spec also verifies the committed manifest as `{ ok: true, mismatches: [] }`.

Expected events remain design ground truth rather than observed pipeline
output. `analyze-run` is expected only after the explicit
`drain-eligible-candidate` operation (candidate registration is the producer
at `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:935-948`).
`session-end` causes no direct feed event; `idle-timeout` only produces
`idle-trigger` (`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:741`),
and `manual-analyze` only produces `manual-run`
(`libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:694-699`).
Prefilter failures use the product reasons emitted at
`skill-synthesis.service.ts:569-581` and `747-767`; repeated analysis for an
unchanged turn count is suppressed at `584-600`.

| Script operation           | Fixture class                                | Expected activity events                   | Producer / contract                                            | Expected today                                                      |
| -------------------------- | -------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `session-end`              | routine, Q&A, aborted, single edit, degraded | none directly                              | enqueue/turn-count guard: `skill-synthesis.service.ts:584-608` | measure — queue work is asynchronous                                |
| `drain-eligible-candidate` | routine                                      | `analyze-run`                              | candidate registered: `skill-synthesis.service.ts:935-948`     | measure — requires successful candidate registration                |
| `idle-timeout`             | Q&A                                          | `idle-trigger`                             | `triggers/skill-trigger.service.ts:741`                        | measure — it must not imply `analyze-run`                           |
| `manual-analyze`           | Q&A, aborted                                 | `manual-run`                               | `memory-rpc.handlers.ts:694-699`                               | measure — RPC outcome is host-dependent                             |
| `prefilter-too-thin`       | Q&A, aborted, unreadable                     | `ineligible { reason: prefilterTooThin }`  | `skill-synthesis.service.ts:569-581`                           | measure — malformed-line reader behavior is intentionally exercised |
| `prefilter-rejected`       | single edit, unsupported tool use            | `ineligible { reason: prefilterRejected }` | `skill-synthesis.service.ts:747-767`                           | measure — unsupported name must not be treated as a routine         |

The update path still deliberately writes a plain deterministic JSON index;
the documented regeneration sequence is `UPDATE_FIXTURES=1`, `prettier --write
tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/index.json`, then
`REBUILD_MANIFEST=1`. Importing Prettier's API in the Jest VM is not used,
because its dynamic import is not supported by this Jest configuration.

Revision 2 files additionally changed:

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\seeded-session-generator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\session-jsonl-writer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\skill-session-fixture.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\ground-truth\skill-session-fixture.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\skill-sessions.v1\`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\fixtures\memory-skills\MANIFEST.json`

Exact Revision 2 check results:

```text
Test Suites: 5 passed, 5 total
Tests:       81 passed, 81 total
Snapshots:   0 total
Time:        33.954 s
Ran all test suites matching tools/mcp-bench/src/memory-skills/ground-truth.
EXIT=0

Checking formatting...
All matched files use Prettier code style!
EXIT=0

EXIT=0
```

`grep -c tool_use tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/*.jsonl`
returned 6 for sessions 01–12, 2 for 20–22 and 27–30, and 0 for 13–19 and
23–26 (each routine use appears in both its SDK block and readable marker).
