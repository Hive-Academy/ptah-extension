# Code Logic Review: TASK_2026_597_ab22, Batch 10 (measurement tool M)

## Summary

| Metric              | Value                              |
| ------------------- | ---------------------------------- |
| Overall score       | 7/10                               |
| Assessment          | CHANGES REQUIRED (small, targeted) |
| Blocking issues     | 0                                  |
| Serious issues      | 1                                  |
| Moderate issues     | 5                                  |
| Failure modes found | 8                                  |

Scope: read in full `scripts/agent-usage-report.ts`, `scripts/agent-usage/{lane-metrics,jsonl-files,codex-rollout.reader,opencode-db.reader,claude-transcript.reader}.ts`, the fixture's first records and its distinct line shapes, the `package.json` diff, and `measurements/s2-offline-baselines.md`. I read the spec names and the OpenCode/Claude/lane-metrics specs only partly. Run: `npm run test:scripts` gave 6 suites and 59 tests, all passing. I ran M read-only against the real local logs (`--date=2026-10-03 --lanes`) and checked one Claude transcript property with a throwaway script that printed counts only. No temp directories were left behind (`ptah-usage-opencode-*` count 0).

## Five logic questions

### 1. How does this fail silently?

- Claude output tokens are undercounted. `claude-transcript.reader.ts:137-141` keeps only the first line of each `message.id` and drops the rest. `:147` then adds `output_tokens` from that first line. I measured 332 recent transcripts: of 3,001 messages with more than one line, 2,482 have a different `output_tokens` on the last line, and in every one of them the last line is larger. Input and cache fields never differ (0 of 3,001). So the first line carries a partial streaming `output_tokens`. This reads as a valid number and feeds `output` in `--lanes` and the Claude `total = input + output` at `agent-usage-report.ts:219`. Input, peak and first are correct. Output is not.
- A snapshot of the OpenCode DB can silently miss rows. `opencode-db.reader.ts:109-113` copies the db, then `-wal`, then `-shm` as three separate copies. If OpenCode checkpoints or appends between copies, the snapshot is older than the live store, or the WAL is skipped if its salts no longer match. Nothing detects this or reports it. The header (`:17-19`) says so, and for a completed-lane baseline that is acceptable. It is not flagged in the output.
- Lanes started before the contract existed are invisible. `lane-reporting-contract.ts` landed on 2026-09-21 (git log). `opencodeLaneMetrics` (`opencode-db.reader.ts:308`) and `claudeLaneMetrics` (`claude-transcript.reader.ts:223`) decide `isPtahLane` from the marker alone. The baselines file reports "49 Ptah lanes in 30 days" and "glob 11,791". That count is really lanes since 2026-09-21 that carried the marker. Lanes without it are dropped. The file does not say so.
- AS6 verdict `absent` (4 of 6 resumed lanes). `isRolePart` (`codex-rollout.reader.ts:123-126`) treats any developer part starting with `<` as a Codex-injected block, not a role. If a role body ever starts with `<`, it is classified as no role. Four of six lanes reading `absent` is unexplained. The baselines file admits that these four cannot answer AS6, but the cause (a lane with no role versus a role the heuristic cannot see) is not determined.

### 2. What user action produces unexpected behaviour?

- `--date=2026-10-03` combined with the positional `days`: the date silently overrides `days` (documented at `agent-usage-report.ts:36`). OK.
- Running on Node below 22.5 or with the `node:sqlite` module absent: `opencode-db.reader.ts:38` is a static import. The whole script, Codex and Claude included, fails at load. `package.json` pins node 24.x, so this holds today. It is a fragility only if the engine pin is loosened.
- `usage:report -- 7 15 --lanes`: positional arguments after flags work. `--lanes --all` marks non-lane rows `[not a lane]`. OK.
- The `--lanes` sort mixes time bases: OpenCode and Claude `startedAt` are UTC ISO strings ending in `Z`. Codex `startedAt` is local time with no zone (`codex-rollout.reader.ts:361-363`). `agent-usage-report.ts:403` sorts them as strings. On a non-UTC machine the cross-vendor order is wrong. The real output above lists OpenCode (UTC) rows before Codex rows by lexical luck.

### 3. What input data produces a wrong answer?

- Claude output tokens (above).
- A Claude `<synthetic>` or zero-usage assistant record: `claude-transcript.reader.ts:145` pushes a 0-size request. `requestStats` skips it correctly, but `requestInputs.length === 0` (`:107`) is then false. The "first request" window for the lane marker closes before the real first request. The marker can then be missed. This needs an unusual transcript, so it is low risk.
- Codex: `totals` is the last `total_token_usage`, while `requestInputs` come from `last_token_usage`. A `token_count` that has a total but no `last_token_usage` raises the total without adding a request (`:203-206`). `codexLaneMetrics` then reports `total` larger than the sum of its requests and `reqs` lower than real. Not observed in the real logs.
- Dedup of Codex `token_count` by equal `total_tokens` (`:194`) is sound, because a real request always moves the running total. Verified on the real logs: the 74-turn lane gives 74 requests.
- `resumedRoleVerdict` (`:347-352`): `parts >= 2` is labelled `twice`, which means "the role was re-injected". Two distinct non-tag developer parts would also give `twice`, even though `duplicateParts` is 0. `duplicateParts` is the sound signal. The current logic would give false `twice` verdicts. The real baseline shows only `once` and `absent`, so the defect has not appeared yet.

### 4. What happens when a dependency fails?

- Missing or empty store (Codex, Claude, OpenCode db, config dir): every path returns a `SkippedSource` and the report still prints (`jsonl-files.ts:22`, `codex-rollout.reader.ts:307`, `opencode-db.reader.ts:236`). OK.
- Truncated or torn JSONL line: `readJsonLines` counts it (`jsonl-files.ts:65-77`) and the stores list the count as skipped. A file that is mid-write only loses its last line. OK.
- Locked or unreadable OpenCode db: copy failure becomes a skipped source (`:243-251`). A failure at the SQL stage becomes a skipped source with the error message (`:284-291`), and sessions read so far are kept. Good. The message is a SQLite error and holds no row content.
- A file that cannot be read mid-walk: `collectJsonlFiles` ignores vanished or unreadable entries. `readFileSync` failure in a reader is caught per file by the store loop. OK.
- Cleanup: `snapshot.cleanup()` sits in the `finally` block after `db?.close()` (`opencode-db.reader.ts:292-295`). If `db.close()` throws, `cleanup()` is skipped and the temp copy of the user's DB (conversation content) stays in `%TEMP%`. The exception also propagates out of `readOpencodeDb` and aborts the whole report. `close()` rarely throws, but the plan says "deleted in `finally`, always". Nested try/finally would make that true.
- Hostile `time_created`: `new Date(createdMs).toISOString()` (`:214`) throws RangeError for an out-of-range number. It is raised inside the session loop, so it aborts the remaining sessions and is reported as "unreadable (message)" for the whole DB. Low likelihood.

### 5. What is missing that the requirements never mentioned?

- No spec proves the temp copy is deleted, neither on success nor on error. `opencode-db.reader.spec.ts` has no `ptah-usage-opencode` assertion (grep). The deletion guarantee, which is the main safety claim, is untested.
- No check that a lane marker found is the lane's own (not quoted text). Claude and OpenCode lanes are identified by the marker alone, with no origin check like Codex's originator and source. A first message that quotes the contract (a pasted handoff, a task document) would be classified as a lane.
- The 30-day windowing selects whole files by mtime or sessions by creation time. A long session that began before the window but is still active has all of its tokens attributed to the window. Not documented.

## Failure modes

### Claude output token undercount

- Trigger: any Claude transcript where one response is written as several per-block lines.
- Symptom: `output` and Claude `total` too low (output is typically a fraction of the real value).
- Evidence: `claude-transcript.reader.ts:137-147`. Measured: 2,482 of 3,001 multi-line messages have a larger final `output_tokens`; input and cache are identical across lines.
- Current handling: first line wins for everything.
- Recommendation: keep the first line for `requestInputs` and `cached` (stable), but track per `message.id` the maximum `output_tokens` seen, and add the sum at the end. A spec should use two lines with different `output_tokens` for one id (the current spec uses identical values, `claude-transcript.reader.spec.ts:37`).

### OpenCode snapshot not atomic

- Trigger: OpenCode writing while M runs.
- Symptom: newest rows missing, silently.
- Evidence: `opencode-db.reader.ts:106-118`.
- Current handling: documented in the header only.
- Recommendation: after the copy, re-stat the source `-wal` size and mtime and add a skipped-source note ("snapshot taken while the database was changing") if they moved. Or use `VACUUM INTO` through a read-only open. Optional.

### Temp copy survives a throwing `close()`

- Trigger: `db.close()` throws.
- Symptom: user conversation data stays in the OS temp directory; the report aborts.
- Evidence: `opencode-db.reader.ts:292-295`.
- Recommendation: `try { db?.close(); } finally { snapshot.cleanup(); }`. Add a spec that lists `os.tmpdir()` for `ptah-usage-opencode-*` before and after both a good and a failing read.

### Marker-only lane identification for Claude and OpenCode

- Trigger: a human session whose first message quotes `## Before you exit`.
- Symptom: counted as a Ptah lane. The reverse also happens: lanes created before 2026-09-21 (or by any spawn path that does not append the contract) are missed.
- Evidence: `lane-metrics.ts:28,37-39`, `opencode-db.reader.ts:308`, `claude-transcript.reader.ts:223`.
- Current handling: for Codex, originator and source are required too (`lane-metrics.ts:42-52`), which makes Codex solid. Marker pinned to `renderLaneCompletionContract` by a spec (executor report says it renders `{}`, `{taskFolder}`, `{deliverables}`); I confirmed the heading text at `lane-reporting-contract.ts:34`.
- Recommendation: also require the marker at a line start (`\n## Before you exit` or start of text) so inline quotes do not count, and state the 2026-09-21 cutoff in the baselines file.

### `twice` verdict from two distinct parts

- Trigger: a resumed rollout with two different non-tag developer parts.
- Symptom: verdict `twice`, read as "role re-injected on resume".
- Evidence: `codex-rollout.reader.ts:347-352`.
- Recommendation: base the verdict on `duplicateParts > 0` or on `partsInResumedTurns > 0`, not on `parts >= 2`.

### Role heuristic reads `<`-prefixed role as absent

- Evidence: `codex-rollout.reader.ts:123-126`; 4 of 6 baseline lanes are `absent`.
- Recommendation: establish what those four lanes' developer parts looked like (lengths and first-character class only) before reading AS6 as "supported". The baselines text already hedges this; it should name the unknown.

### Mixed time bases in the `--lanes` sort

- Evidence: `codex-rollout.reader.ts:361-363` (local, no zone) versus `opencode-db.reader.ts:214` and the Claude transcript timestamps (UTC). Sort at `agent-usage-report.ts:403`.
- Recommendation: convert Codex's local start time to an ISO instant (`new Date('YYYY-MM-DDTHH:MM:SS')` in local time) before sorting.

### Codex request count versus total drift

- Evidence: `codex-rollout.reader.ts:196-206`. Low likelihood, no real-log occurrence.

## Blocking issues

None.

## Serious issues

### Claude output tokens undercounted

- File: `scripts/agent-usage/claude-transcript.reader.ts:137-147`
- Scenario: any current Claude Code transcript (measured on 332 recent files).
- Impact: Claude `output` in `--lanes`, Claude `total` and the `output=` figures in the aggregate headline are wrong while looking valid. Input, first, peak and cached are unaffected, so R1.1 is not touched. The measurement tool exists to be trusted, and the executor report presents the dedup as an improvement without checking this side effect.
- Fix: as in "Claude output token undercount". Add a two-line same-id spec with rising `output_tokens`.

## Moderate and minor issues

1. `opencode-db.reader.ts:292-295`: `cleanup()` is skipped when `close()` throws (see above). Moderate.
2. `opencode-db.reader.spec.ts`: no assertion that the temp copy is removed. The executor report claims "readers never write" is checked by byte identity (true for the Codex fixture and DB), but deletion is untested. Moderate.
3. `codex-rollout.reader.ts:347-352`: `twice` rule. Moderate.
4. `lane-metrics.ts` / OpenCode / Claude: marker-only identification, no pre-2026-09-21 note in `s2-offline-baselines.md` ("49 lanes", "glob 11,791"). Moderate.
5. `agent-usage-report.ts:403`: mixed time bases. Moderate.
6. `claude-transcript.reader.ts:107,145`: zero-usage assistant record closes the first-request window. Minor.
7. `opencode-db.reader.ts:214`: out-of-range `time_created` throws RangeError. Minor.
8. `codexLaneMetrics` (`:372`) takes `total` from the running total but `reqs` and `peak` from per-request samples. They can disagree for a rollout with partial `token_count` data. Minor.
9. `claudeStats` (`agent-usage-report.ts:204`) uses the `kind` label as `originator`; fine, but the table title says "lane kind" for what is `session` or `subagent`, not lane or not lane. Minor.

## Data flow

1. CLI args → `parseArgs` (`agent-usage-report.ts:86-125`): rejects unknown flags, a bad date, a non-positive number. OK.
2. Store discovery (`codexSessionsDir` via `codexHomeDir`, OpenCode XDG dirs, `CLAUDE_CONFIG_DIR`): OK, matches the documented defaults.
3. File walk (`jsonl-files.ts:18-56`): OK; the Codex `--date` filter uses the start date in the file name, ignoring mtime, as intended.
4. Parse (`readJsonLines`): OK; torn lines counted.
5. Per-request accounting: Codex OK (verified); OpenCode OK (input + cache.read + cache.write; verified by the baselines); Claude input OK, output WRONG.
6. Lane identification: Codex OK; OpenCode and Claude marker-only (gap above).
7. Aggregation and printing: OK, aside from the sort and the `twice` rule.
8. Cleanup: temp dir removed in all but the `close()` failure path.

## Requirements fulfilment

| Requirement                                           | Status                                          | Gap                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R1.1 first 27,464 / peak 183,759 / total 9.59M        | COMPLETE                                        | Reproduced on the real log (`--lanes`: 27464 / 183759 / 9.59M, 74 reqs, 98% cached) and by the fixture spec.          |
| R1.2 identify Ptah lanes (originator, source, marker) | COMPLETE for Codex; PARTIAL for OpenCode/Claude | Marker only; no origin check; lanes before 2026-09-21 invisible.                                                      |
| R1.3 OpenCode baseline                                | COMPLETE                                        | 30-day counts cover marker-carrying lanes only; AS7 left open, as planned.                                            |
| Method M: read-only, offline                          | COMPLETE                                        | Temp copy removed except on `close()` failure; no reader writes to a user store (Codex/OpenCode specs compare bytes). |
| `--lanes`, `--resumed`, `--opencode-config`, `--date` | COMPLETE                                        | `twice` rule, sort order as above.                                                                                    |
| Skipped sources instead of aborting                   | COMPLETE                                        | Except the uncaught `close()` and RangeError paths.                                                                   |

Implicit requirements not addressed: deletion test for the temp copy; the Claude output accuracy; documenting the contract date cutoff.

## Edge cases

| Case                         | Handled | How                                                                        | Concern                                      |
| ---------------------------- | ------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| Truncated JSONL line         | YES     | counted, listed as skipped                                                 | none                                         |
| Missing fields               | YES     | `asNumber`/`asString`/`asObject` default to 0/null/{}                      | zero-size request skipping in `requestStats` |
| Empty or absent folder       | YES     | `SkippedSource`, report still prints                                       | none                                         |
| Locked or unreadable db      | YES     | copy or open failure → skipped                                             | `close()` throw leaks temp copy and aborts   |
| Rollout resumed (multi-turn) | YES     | one file = one lane, `task_started` counts turns                           | role heuristic                               |
| Duplicate `token_count`      | YES     | same `total_tokens` skipped                                                | none                                         |
| Claude per-block lines       | PARTIAL | input deduped by `message.id`                                              | output undercounted                          |
| Image tool outputs           | YES     | only text parts counted                                                    | none                                         |
| Secrets in OpenCode config   | YES     | only name, type and enabled read; spec asserts a header and URL are absent | none                                         |

## Privacy

- The fixture holds the 81 records of the 74-turn lane. Its distinct values are record types, `redacted`, `codex_sdk_ts`, `exec`, `gpt-6-astra`, `medium`, token numbers and three placeholder texts. I read the first records and a prefix histogram and found no content or paths. OK.
- `s2-offline-baselines.md` holds numbers, model names, tool names, config keys, truncated session ids (`ses_efec9514…`) and character counts. No prompt or tool content. The note that the OpenCode config dir has a `skills/` directory with 13 entries reveals a count only. OK.
- Readers keep booleans and SHA-256 hashes, never text (`codex-rollout.reader.ts:217-228`). The SQLite error message printed in a skipped reason names tables or columns only.

## Verdict

- Recommendation: REVISE (CHANGES REQUIRED), a small fix list.
- Confidence: HIGH on the Codex arithmetic and the R1.1 numbers (reproduced on the real log and by the fixture spec); MEDIUM on OpenCode (verified through baselines, not recomputed by me).
- Top risk: Claude output tokens are undercounted by taking the first streamed line of each response, and the report presents them as exact.
- What a robust implementation would add: (1) per-`message.id` maximum `output_tokens` for Claude plus a rising-output spec; (2) nested `try/finally` for DB close and temp cleanup plus a spec that checks `os.tmpdir()` for leftovers on success and error; (3) a `duplicateParts`/`partsInResumedTurns` basis for `twice`; (4) a line-start anchor for the lane marker and the 2026-09-21 cutoff stated in the baselines file; (5) a zone-consistent `startedAt` for sorting; (6) a note when the OpenCode snapshot is taken while the WAL is changing.

---

## Round 2 (after fix round 1)

Scope: G1-G6, the three extra fixes, the regenerated baselines file. Evidence: `git diff`/file reads of `claude-transcript.reader.ts`, `opencode-db.reader.ts`, `lane-metrics.ts`, `codex-rollout.reader.ts`; `npm run test:scripts` (6 suites, 78 tests, all passing); M run on the local logs (`--lanes`, `--resumed`, aggregate); a throwaway script over 328 recent Claude transcripts (counts only, no content); `ptah-usage-opencode-*` temp count 0 after every run.

| Item                              | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 Claude output (last-line wins) | FIXED  | `claude-transcript.reader.ts` merges per `message.id`, a later line overwrites each field it carries, a missing field keeps its earlier value; sums taken after the scan. On the 328 transcripts the last line equals the per-message maximum in every message (0 exceptions), so last-line and max agree; last-line sum 17.88M against first-line sum 4.67M over two days. The 2026-10-03 aggregate now prints output=2.33M (developer reported 2.27M; the gap is sessions that kept running). Input, cached and request counts are unchanged by the rule. |
| G2 temp copy on close failure     | FIXED  | `opencode-db.reader.ts:312-334`: `close()` in its own try with a skipped-source note, `cleanup()` in a nested `finally`, cleanup failure reported with the directory name. Specs list `os.tmpdir()` before/after for a normal read and a throwing `close()`.                                                                                                                                                                                                                                                                                                |
| G3 AS6 verdicts                   | FIXED  | `resumedRoleVerdict` (`codex-rollout.reader.ts:406-439`) returns `{verdict, reason}`. `twice` needs a role part recorded in a resumed turn while a copy is still in history (`reinjectedWhileInHistory`), not `parts >= 2`. `absent` needs a resumed turn that began with no role in history (tracked through `compacted`). `inconclusive` for not resumed or no role found. Real run: once=2, inconclusive=4, twice=0, absent=0, each with a reason.                                                                                                       |
| G6 role matcher                   | FIXED  | `ROLE_BLOCK_HEADER = '## Role: '` at a line start, in developer or user parts (`lane-metrics.ts:75`), pinned by a spec that reads the `renderRoleBlock` source. The four lanes read `inconclusive` with the reason "spawned without a role", and the report now says they cannot answer AS6.                                                                                                                                                                                                                                                                |
| G4 marker-only limit              | FIXED  | Limit and the 2026-09-21 cutoff in the report header, `lane-metrics.ts` and the baselines file (section G4). `--lanes` prints the cutoff line and, per vendor, lane count and the first UTC date the marker is seen (2026-09-22 in the 30-day window, which is consistent with the cutoff).                                                                                                                                                                                                                                                                 |
| G5 time bases                     | FIXED  | All `startedAt` are UTC ISO instants (`rolloutStartInstant`, `isoInstant`); `sortLanesByStart` sorts by epoch ms with unknown last; `--lanes` has a `started (UTC)` column. Real output shows Codex `13-07-41` local as 10:07 UTC (this machine is UTC+3) interleaved correctly with OpenCode. Spec crosses a date boundary.                                                                                                                                                                                                                                |
| Extra: marker at line start only  | OK     | `hasHeadingAtLineStart` (`lane-metrics.ts:48-56`) scans every occurrence, so a quoted inline heading followed by a real one still matches. All 9 + 2 real lanes remain identified.                                                                                                                                                                                                                                                                                                                                                                          |
| Extra: zero-usage line            | OK     | The first-request window now closes only when merged context > 0 (`firstRequestSeen`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Extra: bad OpenCode timestamp     | OK     | `isoInstant` returns null for an out-of-range value; the lane sorts last. No crash path left.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Privacy                           | OK     | Regenerated baselines file: grep for drive paths, user paths, keys and bearer strings found none. It holds numbers, model/tool names, truncated session ids, dates and counts.                                                                                                                                                                                                                                                                                                                                                                              |

R1.1 re-verified: `--lanes` still prints 27464 / 183759 / 9.59M for the 74-turn lane (fixture spec unchanged in these three numbers).

### New defects

None blocking or serious. Residual, minor and acknowledged by the developer:

1. Optional item not done: no note when the OpenCode WAL moves during the copy (snapshot may miss the newest rows silently). Moderate-to-minor for an offline baseline; the header already says so.
2. Codex `total` can exceed the sum of per-request inputs if a `token_count` has a total but no `last_token_usage` (not seen in real logs). Minor.
3. Marker-only identification for Claude/OpenCode remains by design; only stated, not origin-checked. Accepted limit (G4).
4. The `absent` verdict has no real-log case; it is covered by specs only. Minor.

### Verdict

- Assessment: APPROVED
- Score: 9/10 (was 7/10). Every item is fixed with a spec and verified on real data; one point withheld for the unreported WAL-race and the identification limit, which are stated but not mitigated.
- Confidence: HIGH.
