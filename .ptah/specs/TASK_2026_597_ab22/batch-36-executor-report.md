## Backend implementation — `TASK_2026_597_ab22`, batch 36

**Tasks completed**: 36.1 (`--subagents` view in M), 36.2 (decision-9 "before" baselines)

**Files** (worktree `D:/projects/ptah-extension/.claude-worktrees/task-597-followups`):

- MODIFIED `scripts/agent-usage/claude-transcript.reader.ts`: per-request records (`ClaudeRequest`: send time, input,
  cache read, cache write, output) after the existing `message.id` dedupe (last line wins), `agentType` from the
  sibling `agent-<id>.meta.json` (null when absent or torn), `missingUsage` count, and a skipped-source entry for
  responses without usage. Existing fields and behaviour unchanged.
- CREATED `scripts/agent-usage/subagent-metrics.ts`: `claudeSubagentMetrics`, `selectSubagents`
  (since/until/session filter), `spread` (min/median/max), `summariseSubagents`, row and summary formatters,
  `RESUME_GAP_MS = 300_000`.
- MODIFIED `scripts/agent-usage-report.ts`: `--subagents` mode plus `--since=<iso>`, `--until=<iso>`,
  `--session=<id,..>`. The header usage text is updated. No new `package.json` script; run as
  `npm run usage:report -- --subagents`.
- CREATED `scripts/agent-usage/subagent-metrics.spec.ts`; MODIFIED `scripts/agent-usage/claude-transcript.reader.spec.ts`,
  `scripts/agent-usage-report.spec.ts`.
- CREATED `scripts/agent-usage/__fixtures__/claude-session/subagents/agent-code-logic-reviewer.jsonl` + `.meta.json`.
  This is a sanitized extraction of one real task-597 code-logic-reviewer subagent. It keeps types, timestamps,
  `message.id`, model and the 4 usage numbers. User content is replaced by `placeholder`, and the meta file keeps
  `agentType` only. The spec reproduces the real row: 28 requests, prefix 39,607, 2 late resumes (549 s / 77,735 and
  379 s / 118,051).
- CREATED `.ptah/specs/TASK_2026_597_ab22/measurements/s9-subagent-baselines.md`

**Stack observed**: TS scripts outside Nx (`scripts/tsconfig.json`, `scripts/jest.config.ts`, `npm run test:scripts`).
The structure follows `lane-metrics.ts` and the `--lanes` view (Task 10.2). Flag parsing follows the existing
`--date=` form.

**Baselines (36.2)**: sessions `8af2d859` and `cd7a4ebb` (the two task-597 orchestration sessions; `8af2d859` is the
§ Handoff measured session, 145 + 942 = 1,087 requests).

- N3/N4 before: start prefix n=47, min 34,437, **median 39,683** (+0.2% vs 39.6k; session 1 alone 39,600 exact),
  max 45,834, with a per-type table in the file. Cut-off is 2026-10-03T20:17:27Z, when the main checkout
  fast-forwarded to `f314a4f8a` (`git reflog`). That is earlier than the first session on that build (20:34:57Z).
- N1 before: **19 late resumes, cache_creation sum 3,544,590, median 179,935**, all in session 1, all with the TTL
  variable not set.
- TTL split: the last write of `HKCU\Environment` is 2026-10-03T19:12:17Z, an upper bound for setting the variable.
  Both sessions started before it. The 6 subagents of `20b6ff75` started after it and have no late resume.
- Empty "after (QA)" tables are in place for N1, N3 and N4. The variable was read only; it was not cleared or changed.

**Verification**:

- `npx tsc -p scripts/tsconfig.json --noEmit 2>&1 | tail -20`: 4 errors, all pre-existing in files Batch 36 does not
  touch: `codex-rollout.reader.ts:31` and `lane-metrics.spec.ts:1` (TS6059 rootDir), `build-eval-harness.ts:25`
  (TS7016 better-sqlite3), `sanitize-claude-sessions.ts:44` (TS6059). A filter for the changed files finds 0 errors.
- `npx eslint scripts/agent-usage scripts/agent-usage-report.ts scripts/agent-usage-report.spec.ts`: PASS (exit 0, no
  output).
- `npx prettier --check` on the changed scripts and the baselines file: PASS.
- `npm run test:scripts 2>&1 | tail -30`: PASS, `Test Suites: 7 passed, 7 total`, `Tests: 93 passed, 93 total`.

**Plan deviations**:

1. The re-validation note says `--since` lives in `agent-usage-report.ts` (:97). It did not; line 97 was `--date`.
   `--since` was added as `--since=<iso>`, the `=` form of the existing `--date=` flag, not the space form
   `--since <iso>`.
2. Added `--until=<iso>` and `--session=<id,..>`, which the task does not name. 36.2 needs them: the N3 cut-off is an
   upper bound, and the main project directory mixes sessions of other tasks (609, 555, 596). All three filters are
   rejected without `--subagents`; `--since` and `--date` are exclusive.
3. Late-resume gaps use request send time, i.e. the timestamp of the last non-assistant line before the response,
   not the response's first-line timestamp. The first-line timestamp includes generation time and puts borderline
   gaps on the wrong side of 300 s.
4. Every report view now lists a "response(s) without usage skipped" entry when one occurs (R7.2 "skipped and
   counted"). The task-597 sessions have none.

**Out-of-scope observations**:

- Pre-existing `tsc -p scripts/tsconfig.json` failures (above), so that Batch 36 check cannot be fully green until
  someone fixes them.
- "After" data already exists: the 6 subagents of 2026-10-04 have a start-prefix median of 32,944. It also includes
  `871b0022b` (agent file update). It was not recorded, by instruction; QA fills it.
