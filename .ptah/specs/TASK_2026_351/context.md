# TASK_2026_351 — Skill-synthesis lane faults

Four independent defects, all inside `libs/backend/skill-synthesis`. Nothing in
`agent-sdk` needs to change: `InternalQueryService` already forwards
`mcpPort` / `outputFormat` field-by-field to `SdkQueryRunner.runOneShot`.

## Evidence

Baseline log: `D:\projects\ptah-extension\tmp\logs\log.log`.

- `943-945`, `1060-1062`, `1353-1355`, `1398-1400`, `1430-1432` — lane one-shots
  with `cwd = C:\Users\abdal`, the dated model id `claude-haiku-4-5-20251001`,
  `mcpServerRunning:false`, `maxTurns:1`.
- `1008`, `1080`, `1370`, `1414` (+ `954`, `1069`, `1364`, `1407`) — the memory
  curator's one-shots on the same boot: `mcpServerRunning:true`, port `51821`.
  The MCP server is demonstrably up; only the lanes report it down.
- `1010` — "lane ignored outputFormat; retrying once without it" on the
  synthesis lane.
- `1088-1091` — "synthesizer: lane failed: timeout" → template fallback →
  candidate slug `…-already-know-about-5` (the 5th numeric suffix).
- `1092` — archaeology enqueued with outcome `reopened`, `turnCount 268`.
- `1379` / `1423` — "[skill-synthesis] lane resolved" for the archaeologist,
  model `claude-haiku-4-5-20251001`.
- `1445` — "lane exhausted its turns on pass 1; collapsing to a single pass".

## Root cause

**(4) `mcpServerRunning:false` on every lane.** `lane-runner.service.ts:328`
read `req.mcpServerRunning ?? false` and no lane caller (synthesizer,
archaeologist, judge, namer, curator, gates) ever set it. The local
`IInternalQuery.execute` config had no `mcpPort` field either, so even a `true`
flag would have fallen back to `PTAH_MCP_PORT` instead of the live `51821`.
`skill-enhancer.service.ts:744` hardcoded `false` as well. The curator adapter
(`sdk-internal-query.curator-llm.ts:285`) already calls
`resolveMcpSessionWiring`, which is why its queries were correct.

**(3) `maxTurns: 1` on the archaeologist.** `lane-runner.service.ts:308-310`
defaulted `maxTurns` to `1` for `toolUse:'required'` lanes when the caller
passed none, and `session-archaeologist.service.ts:362-369` passed none. The
one-shot still exposes the full `claude_code` tool preset, so a model that
issues one tool call ends its only turn as SDK subtype `error_max_turns`; the R6
guard then collapses the pass budget to 1 (log `1445`).

**(1) `outputFormat` retry on an SDK error subtype.** The structured-output
ladder at `lane-runner.service.ts:374-393` re-ran without `outputFormat`
whenever the first call resolved no JSON, without inspecting `first.subtype`. An
`SDKResultError` (`error_max_turns`, `error_during_execution`,
`error_max_structured_output_retries`) carries no `structured_output` and no
JSON, so it was misdiagnosed as "the endpoint ignored outputFormat" (log `1010`)
and bought a second full-timeout execution — the call that timed out at
`1088`.

**(2) duplicate junk fallback candidates.** `skill-synthesis.service.ts:728-731`
deduped ONLY by `trajectory_hash`, and that hash covers every turn
(`trajectory-extractor.ts:213-226`), so it changes every time the prefilter row
is re-opened on session growth (log `1092`: `reopened`, `turnCount 268`;
`stage-handlers.service.ts:266-292` runs `analyzeSession` with `force:true` per
re-open). Each re-open registered a NEW row named after the first user message
with the template body; `skill-md-generator.ts:165-174` resolved the folder
collision by appending `-2..-5` and threw on the 6th, after which
`analyzeSession` returned `null` and the row finished `skipped`. The suffix loop
is the symptom; the missing per-session supersession is the cause.

## Files

- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts`
- `libs/backend/skill-synthesis/src/lib/internal-query.interface.ts`
- `libs/backend/skill-synthesis/src/lib/archaeology/session-archaeologist.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`
- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts`
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`
- `libs/backend/skill-synthesis/src/index.ts`
- specs: `lanes/lane-runner.service.spec.ts`, `lanes/lane-runner.test-support.ts`,
  `skill-synthesis.service.spec.ts`, `skill-candidate.store.spec.ts`,
  `skill-md-generator.spec.ts`, `skill-enhancer.service.spec.ts`,
  `archaeology/session-archaeologist.service.spec.ts`
- `libs/backend/skill-synthesis/CLAUDE.md`

## Plan

1. **Real MCP state on every lane.** Add `mcpPort?: number` to the local
   `IInternalQuery.execute` config (safe: the concrete service already forwards
   it). Inject `PLATFORM_TOKENS.MCP_SERVER_STATUS` optionally, LAST, into
   `LaneRunnerService` and derive `{mcpServerRunning, mcpPort}` through
   `resolveMcpSessionWiring` when the caller supplied no explicit flag; an
   explicit request override still wins. Same optional injection on
   `SkillEnhancerService`. No file under `agent-sdk` is touched.
2. **Tool-use lanes get a real turn budget.** Export
   `LANE_TOOL_USE_DEFAULT_MAX_TURNS = 8`; a `toolUse:'required'` lane with no
   caller value uses it. `toolUse:'none'` stays forced to 1.
   `SessionArchaeologistService` passes `ARCHAEOLOGY_MAX_TURNS` explicitly.
3. **Subtype-aware ladder.** The second execution runs only when the first
   result subtype is absent or `success`. An SDK error subtype returns `failed`
   with kind `tool-use-unsupported` (`error_max_turns`) or
   `structured-output-unsupported` (other error subtypes), and the warn payload
   names the subtype. `LANE_MAX_EXECUTIONS_PER_RUN` stays 2.
4. **Per-session candidate supersession.** `SkillCandidateStore.findLatestBySourceSession`
   - `superseded()`; `SkillMdGenerator.overwriteCandidate` writes at the exact
     slug directory with no suffix loop. `analyzeSession` reuses a prior candidate
     for the same session when the content is unchanged and overwrites it in place
     when the session grew — no new row, no `-N` slug. The `-2..-5` loop stays for
     genuinely different sessions that collide on a first sentence.
5. Unit tests pinning each acceptance criterion; CLAUDE.md updated.

## Acceptance criteria

1. Every lane one-shot carries `mcpServerRunning:true` + the live `mcpPort` when
   `PLATFORM_TOKENS.MCP_SERVER_STATUS` reports a port; no status port ⇒ `false`;
   an explicit request override wins.
2. A `toolUse:'required'` lane with no caller `maxTurns` sends
   `LANE_TOOL_USE_DEFAULT_MAX_TURNS` (8); the archaeologist passes
   `ARCHAEOLOGY_MAX_TURNS` explicitly; `toolUse:'none'` still sends 1.
3. An SDK error subtype on the first execution does NOT earn a re-run: exactly
   one `execute` call, `status:'failed'`, kind `tool-use-unsupported` for
   `error_max_turns` and `structured-output-unsupported` otherwise, subtype in
   the warn payload. A success/absent subtype with no parseable JSON still earns
   exactly one re-run.
4. Re-analyzing a grown session overwrites the existing candidate's SKILL.md via
   `overwriteCandidate` and updates the row via `superseded`; no new row, no
   `-N` slug. Identical content returns `{reused:true}` and writes nothing. A
   different session with a colliding first sentence still gets its own row.
5. `findLatestBySourceSession` returns the newest `status='candidate'` row whose
   `source_session_ids` contains the id and ignores promoted/rejected rows;
   `superseded()` throws for a non-candidate row.
6. `SkillEnhancerService` derives `mcpServerRunning` from the injected status
   port.
7. `IInternalQuery.execute` accepts `mcpPort?: number` and the runner forwards
   it; nothing under `libs/backend/agent-sdk` is modified.
8. `npx nx run-many -t test -p @ptah-extension/skill-synthesis` passes; strict
   TypeScript and lint pass; every catch is `catch (error: unknown)` narrowed
   with `instanceof Error`.
9. CLAUDE.md documents the MCP wiring derivation, the tool-use turn default, the
   subtype-aware ladder and per-session supersession.

## Test projects

`@ptah-extension/skill-synthesis`

## Overlap

All source edits are confined to `libs/backend/skill-synthesis`. Adjacent
areas owned by siblings and deliberately NOT touched: TASK_2026_341
(`SdkQueryRunner` / SDK `query()` launch) and TASK_2026_352 (internal LLM query
cost) both work inside `libs/backend/agent-sdk` — the `mcpPort` widening here is
on skill-synthesis's LOCAL `IInternalQuery` mirror only. TASK_2026_354 touches
`vscode-lm-tools` MCP start logging, not the status-port contract;
`resolveMcpSessionWiring` in `platform-core` is read-only here. TASK_2026_349
edits auth env in `agent-sdk` / `auth-providers` — no overlap.

## Follow-up (out of scope)

Disabling the `claude_code` tool preset for `toolUse:'none'` one-shots needs an
`OneShotRunInput` change in `agent-sdk` and overlaps TASK_2026_341 / 352. Filed
here rather than done.

## Implementation notes

### What changed

**Fault 4 — MCP wiring.** `internal-query.interface.ts` gained `mcpPort?: number`
on the `execute` config (the concrete `InternalQueryService.execute` already
forwards `config.mcpPort` to `SdkQueryRunner.runOneShot`, so widening the local
mirror is safe; nothing under `agent-sdk` was touched). `LaneRunnerService`
takes a 5th, optional, LAST constructor parameter
`PLATFORM_TOKENS.MCP_SERVER_STATUS` and, when the request names no
`mcpServerRunning`, derives `{mcpServerRunning, mcpPort}` through
`resolveMcpSessionWiring`; an explicit request flag still wins and carries its
own `mcpPort`. `SkillEnhancerService` got the same optional last parameter and
now spreads `resolveMcpSessionWiring(...)` where it hardcoded
`mcpServerRunning: false`.

**Fault 3 — turn budget.** New exported constant
`LANE_TOOL_USE_DEFAULT_MAX_TURNS = 8`. `toolUse:'required'` lanes with no
caller-supplied `maxTurns` now send it; `toolUse:'none'` is still forced to 1.
`SessionArchaeologistService` exports `ARCHAEOLOGY_MAX_TURNS` (= the lane
default) and passes it explicitly on every pass. The R6 collapse warn now
carries `maxTurns` so the log says what budget was exhausted.

**Fault 1 — subtype-aware ladder.** `LADDER_ELIGIBLE_SUBTYPES` is `{null,
'success'}`. A first execution that ended in any other subtype returns `failed`
without a second call — `tool-use-unsupported` for `error_max_turns`,
`structured-output-unsupported` for the rest — and both warn payloads now name
the subtype. `LANE_MAX_EXECUTIONS_PER_RUN` is unchanged at 2 and the
success-subtype re-run is untouched.

**Fault 2 — per-session supersession.** `SkillCandidateStore` gained
`findLatestBySourceSession(sessionId, status='candidate')` (`json_each` over
`source_session_ids`, newest first) and `superseded(id, {...})` (one fixed
UPDATE of description / body_path / trajectory_hash / embedding_rowid; `name`
untouched; throws for a non-`candidate` or missing row). `SkillMdGenerator`
gained `overwriteCandidate`, which writes at the exact sanitized slug directory
with no collision walk. `analyzeSession` now looks the session up after
synthesis and before any write: identical content (`sha256(description + '\n' +
trimmed body)`) returns `{reused:true}` writing nothing, a changed draft
overwrites the row's own SKILL.md and calls `superseded`, and only a session
with no prior candidate falls through to `writeCandidate` +
`registerCandidate`. Both supersession paths return `reused: true`, so the
prefilter handler reports "reused existing candidate" and no invocation is
double-counted.

`LANE_TOOL_USE_DEFAULT_MAX_TURNS` and `ARCHAEOLOGY_MAX_TURNS` are exported from
the library barrel.

### Tests

New/extended, all in `@ptah-extension/skill-synthesis`:

- `lanes/lane-runner.service.spec.ts` — three new describes: the MCP wiring is
  derived (live port forwarded, no port ⇒ false, no status port ⇒ false,
  explicit request flag wins); the tool-use turn budget (default 8, caller
  number still honoured); the subtype-aware ladder (`error_max_turns` ⇒ one
  call + `tool-use-unsupported` + subtype in the warn; the other three error
  subtypes ⇒ `structured-output-unsupported`; a success subtype with no JSON
  still re-runs exactly once).
- `archaeology/session-archaeologist.service.spec.ts` — every lane request
  carries `maxTurns === ARCHAEOLOGY_MAX_TURNS`, which is > 1.
- `skill-candidate.store.spec.ts` — `findLatestBySourceSession` returns the
  newest candidate, ignores promoted/rejected, matches the id exactly rather
  than as a substring, and answers null for a sessionless row; `superseded`
  rewrites the content columns, keeps the slug, mints no second row, and throws
  for a non-candidate and a missing row.
- `skill-md-generator.spec.ts` — `overwriteCandidate` rewrites in place with no
  suffix (directory listing asserted) and creates the directory when absent.
- `skill-synthesis.service.spec.ts` — the three supersession cases (grown
  session overwrites in place with no new row and no `-N` slug; identical
  content writes nothing; a different session still gets its own row), driven
  through a prior candidate whose SKILL.md really exists in a temp dir.
- `skill-enhancer.service.spec.ts` — the MCP fields handed to `InternalQuery`
  follow the injected status port.
- `skill-synthesis.stage-handlers.spec.ts`,
  `skill-synthesis.service.enqueue.spec.ts`,
  `archaeology/regex-demotion.spec.ts` — their `SkillCandidateStore` doubles
  gained `findLatestBySourceSession: () => null` (each analyzes a session once,
  so "nothing yet" is the honest answer).

### Verification

- `npx nx run-many -t test -p @ptah-extension/skill-synthesis` — "Running target
  test for project @ptah-extension/skill-synthesis" (1 project): **67 suites
  passed, 6 skipped; 1372 tests passed, 37 skipped, 1409 total.** The 6 skipped
  suites / 37 skipped tests are the pre-existing native-SQLite gates, unchanged
  by this task.
- `npx nx run-many -t typecheck -p @ptah-extension/skill-synthesis` — passed.
- `npx nx run-many -t lint -p @ptah-extension/skill-synthesis` — passed,
  0 errors / 35 warnings, all pre-existing categories. One of them is
  `max-lines` on `skill-synthesis.service.ts`: it was already over the 700
  soft ceiling before this change and the supersession block moved the counted
  figure to 1011. Splitting that file is a separate, deliberate refactor (the
  facade rule) and was not attempted here.

### Note for the next agent

Several edits to this library were silently rolled back on disk mid-task
(the tool reported success, and a later `git diff` showed the file back at its
previous content). Every change was re-applied and verified with `git diff`
afterwards. If a change to `libs/backend/skill-synthesis` appears to vanish,
re-check `git diff` rather than assuming the edit failed to apply.
