## Backend implementation — `TASK_2026_597_ab22`, batch 10

**Tasks completed**: 10.1, 10.2, 10.3

**Files** (all under `D:\projects\ptah-extension\.claude-worktrees\task-597-lane-token-burn\`):

- CREATED `scripts\agent-usage\lane-metrics.ts`: shared M vocabulary. It holds `LANE_CONTRACT_MARKER` (`## Before you exit`), `isPtahCodexLane` (R1.2), the `requestStats` first/peak/total arithmetic, `LaneMetrics`, `SkippedSource`, `localDate`, and the lane table formatting.
- CREATED `scripts\agent-usage\jsonl-files.ts`: JSONL walker and line parser. A torn line is counted, not thrown. Also narrowing helpers and `outputChars`, which counts only the text parts of content-item outputs.
- CREATED `scripts\agent-usage\codex-rollout.reader.ts`: reads `session_meta`, `turn_context`, `task_started`, `token_count` (a re-emitted unchanged total is counted once), the contract marker in the first request's user messages, AS6 role parts and their hashes, the largest tool output, and `compacted` / `context_compacted`. Uses `codexHomeDir()` from harness-sync `codex-home.ts` (D9).
- CREATED `scripts\agent-usage\opencode-db.reader.ts`: reads `session_v2` and `session_message` through `node:sqlite` from a temp COPY of `opencode.db` + `-wal` + `-shm`, opened `readOnly`. Also the JSONC config reader (server name, type and enabled only; never command, url, headers or env) and `serverToolCalls`.
- CREATED `scripts\agent-usage\claude-transcript.reader.ts`: the Claude reader ported from the `.mjs`. It now counts a request once per `message.id`, and adds the marker check, the largest tool_result and `compact_boundary`.
- CREATED specs `scripts\agent-usage\{lane-metrics,codex-rollout.reader,opencode-db.reader,claude-transcript.reader}.spec.ts` and `scripts\agent-usage-report.spec.ts`.
- CREATED `scripts\agent-usage\__fixtures__\rollout-2026-10-03T13-26-45-74-turn-lane.jsonl`: a sanitized, read-only extraction (81 records). Its only strings are record types, `redacted`, `codex_sdk_ts`, `exec`, `gpt-6-astra`, `medium` and three placeholder texts (an audit of its distinct strings confirmed this).
- CREATED `scripts\agent-usage-report.ts`: replaces the `.mjs`. It keeps the aggregate views (codex, plus a new OpenCode headline, plus claude) and adds `--lanes`, `--all`, `--resumed`, `--opencode-config` and `--date=YYYY-MM-DD`. The header documents the sessions locations (R1.2).
- DELETED `scripts\agent-usage-report.mjs`.
- MODIFIED `package.json`: adds the `usage:report` script only.
- CREATED `.ptah\specs\TASK_2026_597_ab22\measurements\s2-offline-baselines.md`.

**Stack observed**: Node 24.15 (`node:sqlite` available; `@types/node` 24.13.6 ships `sqlite.d.ts`). Scripts run through ts-node with `scripts/tsconfig.json` (CommonJS), as `package.json:72` `db:drain-observations` does. Tests run under Jest with `scripts/jest.config.ts`, ts-jest and `maxWorkers: 1`. Scripts may import lib files by relative path; the precedent is `scripts/sanitize-claude-sessions.ts:44`. No validation library is used in scripts; argv is checked by hand in `parseArgs`, which rejects an unknown flag, a bad date and a non-positive number.

**Verification**:

- `npm run test:scripts` → `Test Suites: 6 passed, 6 total` / `Tests: 59 passed, 59 total`. This includes the existing `drain-observation-queue.spec.ts`.
- R1.1 fixture spec: first 27,464, peak 183,759, total 9,586,716 (within 9.59M ±0.01M), 74 requests, all asserted.
- `npx eslint scripts/agent-usage-report.ts scripts/agent-usage-report.spec.ts scripts/agent-usage/` → 0 problems, after removing 3 non-null-assertion warnings.
- `npm run usage:report -- 1 3` runs through ts-node and prints the aggregate views.
- `npx tsc -p scripts/tsconfig.json --noEmit` is not a declared gate, and it already fails on HEAD: TS6059 in `sanitize-claude-sessions.ts` and TS7016 in `build-eval-harness.ts`. My two relative lib imports (`codex-home.ts`; `lane-reporting-contract.ts` in a spec) add the same TS6059 rootDir diagnostic as the sanitize precedent. ts-node and ts-jest are unaffected.
- An Nx `test,lint,typecheck` target does not apply: `scripts/` has no `project.json` (`scripts/jest.config.ts` header).

**Baselines produced (Task 10.3, details in the measurements file)**:

- Codex 2026-10-03: 9 of 9 rollouts are Ptah lanes. The 74-turn lane 13-26-45 reads first 27,464, peak 183,759, total 9.59M, 98% cached, 0 compactions. First-request input across all lanes ranges 24,546 to 27,954. The largest single text tool output is about 40.1k chars (exec) in every lane. The day totals 249 requests, 25.60M input and 3 requests over 200k.
- AS6 (`--resumed`): 6 lanes were resumed. 2 carried a role, and their verdict is `once` (role not re-recorded in the resumed turn). 4 have verdict `absent` (no role part in any turn). This supports AS6 but does not prove it; C2 decides.
- R1.3 OpenCode: `opencode.jsonc` declares 0 MCP servers and 0 plugins, so lanes have no user server or plugin to load. The config dir has `skills/` with 13 entries, and lanes used the `skill` tool 3 times in 30 days. On 2026-10-03 there were 2 lanes (opencode/fledge-alpha-free): first 19,713 / 23,562, peak 22,812 / 58,679, totals 0.07M / 1.15M. Over 30 days there were 49 lanes, with 11,791 `glob` calls.
- R3.4 "before" chars are cited from context.md and research-report.md, with each source stated.

**Plan deviations**:

- I added `scripts\agent-usage\jsonl-files.ts`, a sixth source file under `agent-usage/`. It holds the JSONL walk and parse that both the Codex and Claude readers need. Without it, one reader would import the other, or the walker would have to sit in `lane-metrics.ts`.
- The OpenCode DB is opened read-only on a temp copy, not in place. Opening the live WAL database, even read-only, touches its `-shm`. The copy guarantees that nothing writes to the user's store, and the temp copy is removed in `finally`.
- Largest tool output counts text characters and excludes inline base64 images. Counting the JSON length made screenshots read as 1.6M-char outputs.
- The Claude request count is now deduplicated by `message.id`. The `.mjs` counted each per-content-block line as a separate request.

**Risks handled**:

- R1.3 baseline lost if component 11 lands first: the baselines file is written, and Batch 13 can read it.
- Lane identification drift: `lane-metrics.spec.ts` renders `renderLaneCompletionContract` for `{}`, `{taskFolder}` and `{deliverables}`, and asserts the marker is present in each. A marker that first appears after the first request does not count (spec).
- Privacy: the fixture holds numbers, keys and placeholders only. Readers keep booleans and hashes, never text. The config reader never reads server commands, URLs, headers or env (a spec asserts that a secret header and a URL are absent from the result). The baselines file holds numbers, model names and tool names only. The temp probe directory, which held a copy of `opencode.db`, was deleted. No auth file was read.
- Missing store or bad line becomes a skipped source and the report still prints (specs for each reader: absent dir or db, torn line, unparseable row, empty-schema db).
- Readers never write: specs check the source bytes are identical after a read (Codex fixture, OpenCode fixture db).

**Out-of-scope observations**:

- `batches.md` changed on disk during my run. That was another agent; I did not edit it.
- Resumed Codex turns re-record a 21-22k-char `<skills_instructions>` developer part: 6 times across 4 lanes on 2026-10-03. This is a possible resume cost for component 1 or S5 to consider.
- Over 30 days, OpenCode lanes made 11,791 `glob` calls. This may be one runaway lane and has not been attributed.

## Fix round 1 (code-logic review CHANGES REQUIRED 7/10)

Files changed: `scripts\agent-usage\{lane-metrics,codex-rollout.reader,claude-transcript.reader,opencode-db.reader}.ts`,
their specs, `scripts\agent-usage\__fixtures__\rollout-2026-10-03T13-26-45-74-turn-lane.jsonl` (the role placeholder
now reads `## Role: backend-developer` + `(redacted)`, a name only), `scripts\agent-usage-report.ts` and its spec, and
`measurements\s2-offline-baselines.md`. `package.json` was not touched again; it still has only the one `usage:report`
line. No Batch 1 or Batch 5 file was edited.

- **G1 (Serious), Claude output undercount.** `claude-transcript.reader.ts` keeps one usage per `message.id` in a Map
  ordered by each response's first line. A later line overwrites each field it carries, so the last line wins. A field
  a later line omits keeps its earlier value, which is the ledger rule plus the "later line drops a field" case.
  Requests, cached and output are summed after the scan. Specs: a 3-line response with `output_tokens` 2 → 9 → 57
  counts 1 request, input 100, cached 80 and output 57; a later line without input fields keeps input 100 and cached 80
  and takes output 30. Review minor #6 is also fixed: a zero-usage `<synthetic>` line no longer closes the
  first-request window (spec).
- **G2, temp copy deletion.** In `readOpencodeDb`'s `finally`, `close()` runs in its own try. A failure is recorded as
  the skipped-source note `temp copy close failed (...)`. Cleanup then runs in a nested `finally`, using `rmSync` with
  `maxRetries: 3`. If cleanup itself fails, a note names the temp directory. Neither failure aborts the report. Specs
  list `os.tmpdir()` for `ptah-usage-opencode-*` before and after: a normal read leaves none, and a read whose `close()`
  throws also leaves none while still returning both sessions and the note. Review minor #7 is also fixed: an
  out-of-range `time_created` gives `startedAt: null` (via `isoInstant`) instead of a RangeError.
- **G3, AS6 verdicts.** `resumedRoleVerdict(summary)` returns `{verdict, reason}`:
  - `twice`: a role part was recorded in a resumed turn while an earlier copy was still in history (`reinjectedWhileInHistory`).
  - `absent`: a resumed turn started with no role in history, which M tracks through `compacted` records (`replacement_history` checked for the role; a summary compaction drops it).
  - `once`: neither of the above.
  - `inconclusive`: not resumed, or no role block found.

  The four verdicts are defined in the report header and in the baselines file. Specs cover: once; twice; two
  different non-role developer parts are not `twice`; absent after a summary compaction; once when
  `replacement_history` keeps the role; inconclusive for "spawned without a role", "unrecognised developer part" and
  "not resumed"; and a role found in a user message after `<`-prefixed text.

- **G4, marker-only limit.** Both the report header and `lane-metrics.ts` state the 2026-09-21 cutoff. `--lanes` now
  prints the cutoff line, plus one line per vendor with the lane count and the first UTC date the marker is seen
  (`laneMarkerSummary`, with a spec). The baselines file has a G4 section. Following the review's recommendation, the
  marker now counts only at a line start (`hasHeadingAtLineStart`), so an inline quote is not a lane (spec).
- **G5, time zones.** Every `LaneMetrics.startedAt` is now a UTC ISO instant: Codex goes through
  `rolloutStartInstant(id)`, which converts the local file-name time; Claude goes through `isoInstant(Date.parse(ts))`;
  OpenCode through `isoInstant(ms)`. `sortLanesByStart` sorts by epoch ms, with unknown starts last. `--lanes` has a
  `started (UTC)` column. The spec builds a Codex lane at 23:30 UTC on 2 Oct from local file-name parts, in any machine
  time zone, and an OpenCode lane 40 minutes later on 3 Oct UTC, and asserts the order codex, opencode, then the
  unknown-start lane.
- **G6, the four lanes that read `absent`.**
  - The role is matched by `ROLE_BLOCK_HEADER = '## Role: '` at a line start, in any developer or user part. This is
    the header `renderRoleBlock` emits: `git show 4e246388a:.../cli-adapter.utils.ts` shows
    `` `## Role: ${role.name}\n\n` ``, and the current worktree file has the same at :480.
  - The spec pins it by reading the renderer's source, asserting that the `renderRoleBlock` body holds that template.
    A direct import is not possible because the file loads `@ptah-extension/*` aliases that the scripts Jest config
    cannot resolve.
  - Result on the real rollouts: the 4 lanes (13-08-30, 13-22-35, 13-27-42, 13-56-10) have no role header in any
    message, no unrecognised developer part and no compaction, so the old heuristic did not hide a role. They now read
    `inconclusive` with the reason "spawned without a role".

**Verification:**

- `npm run test:scripts` → `Test Suites: 6 passed, 6 total` / `Tests: 78 passed, 78 total` (was 59).
- `npx eslint scripts/agent-usage-report.ts scripts/agent-usage-report.spec.ts scripts/agent-usage/` → exit 0, no output.
- Temp directories after the regeneration runs: `ptah-usage-opencode-*` count 0.

**New baseline figures (regenerated with the same commands):**

- Codex 2026-10-03: unchanged. 9 of 9 lanes; 13-26-45 reads 27,464 / 183,759 / 9.59M; first-request input ranges 24,546 to 27,954; 249 requests; 25.60M input.
- AS6: `once` = 2 (13-25-58, 13-26-45); `inconclusive` = 4 (spawned without a role); `twice` = 0; `absent` = 0.
- Lane marker first seen (UTC):
  - 2026-10-03: Codex 9 lanes, OpenCode 2 lanes, Claude 0.
  - 30 days: Codex 187, OpenCode 33 (49 marker sessions in total), Claude 97, all first seen 2026-09-22.
- OpenCode: unchanged.
  - Config: 0 servers, 0 plugins, `skills/` with 13 entries.
  - 2026-10-03: 2 lanes, 29 requests, 1.22M input, 88% cached.
  - 30 days: first-request input of the 33 lanes is 14,943 to 23,562.
- Claude 2026-10-03, corrected: 53 transcripts, 2,555 requests, average context 165k, 762 over 200k, 421.25M input,
  97% cached, **2.27M output**. The first version reported 0.51M output (51 transcripts, 2,383 requests) because it
  took the first streamed line. The extra transcripts and requests are sessions that kept running between the runs.

**Not changed (optional in the review):**

- No WAL-moved-during-copy note for the OpenCode snapshot.
- Codex `total` vs `reqs` drift for partial `token_count` data (review minor #8; not seen in the real logs).
