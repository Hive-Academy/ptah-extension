# Code logic review, Phase 3.2, Batch 11 (commits 70aef0172, 156371190)

Jest (scoped, run by me): `Test Suites: 31 passed, 31 total` / `Tests: 361 passed, 361 total`.

Verdict: REVISE (2 blocking, 2 serious, 2 minor)

## Findings

1. BLOCKING. Degraded sessions are labels only. `skill-session-fixture.ts` `buildFixture` writes the same four plain-text turns for every session. Degraded sessions differ only in the closing sentence "intentionally degraded". `skill-session-21..30.jsonl` contain no unparseable line and no `tool_use` or `tool_result` block (`grep -c` returned 0). The spec 4.4 requires "unreadable lines, unsupported tool use" to be real in the JSONL. `script: ['unreadable-line']` and `['unsupported-tool-use']` never touch the writer. The pipeline cannot reject these sessions for the scripted reason, and the "degraded" accuracy metric cannot be measured on them. Fix: for `unreadable-line`, inject a malformed line (truncated JSON or binary junk) at a fixed position. For `unsupported-tool-use`, emit an assistant `tool_use` block with an unsupported tool name. Pin both in the golden spec.

2. BLOCKING. Routine and non-routine sessions are not distinguishable by content. Routine sessions have the same 4 turns, with only the topic word swapped. There are no tool_use or edit blocks, no ordered steps, and nothing repeated across the 3 sessions of a routine beyond the name string. The product prefilter (`skill-synthesis.service.ts` `passesPrefilter`, around lines 750-765) uses `editCount`, `toolUseCount` and `charLength`. These sessions will most likely be rejected with `prefilterRejected` or `prefilterTooThin`. Recall of "routine" sessions then measures nothing, and archaeology and cluster cannot find a routine (the routine id appears only in a user sentence). The "12 routine = 4 x 3" count is real, but the routines carry no signal. Fix: give routine sessions an ordered tool-use sequence (edit then test) shared across the 3 repetitions. Give non-routine sessions single-edit, Q&A and aborted shapes that are genuinely different.

3. SERIOUS. The event mapping does not match the product producers.
   - `session-end` maps to `analyze-run`. `analyze-run` is pushed only after a candidate is registered (`skill-synthesis.service.ts:942-946`). It is not emitted on session end. Q&A, aborted and single-edit sessions, and any prefiltered session, emit `ineligible` with `reason: prefilterTooThin` or `prefilterRejected` (lines 573-579, 758-765). A failed prefilter never produces `analyze-run`.
   - `idle-timeout` maps to `idle-trigger` then `analyze-run`. The producer (`triggers/skill-trigger.service.ts:741`) emits only `idle-trigger` and enqueues. `analyze-run` is emitted later by the drain, and only if the session passes.
   - `manual-analyze` maps to `manual-run` then `analyze-run`. `manual-run` is pushed by `memory-rpc.handlers.ts:695`. `analyze-run` follows only on success.
   - The `ineligible` events carry a free-text `note`, but the product event has a `reason` bucket. The fixture never states the expected `reason`, so feed-parity cannot compare it.
   - Routine sessions are scripted `['session-end','idle-timeout']`, which gives `analyze-run, idle-trigger, analyze-run`. For a routine session this probably double-counts `analyze-run` (the analyzed-sessions fast path returns null on the same turn count, lines 590-595).
   - Fix: derive per class. A non-routine session expects `ineligible(reason)` and no `analyze-run`. A routine session expects `analyze-run` only if it passes the prefilter. Add a `reason` field to the schema. If the product cannot meet an expectation today, say so in the report. The report currently does not.

4. SERIOUS. `batch-11-1-report.md` states the mapping as fact and cites `skill-synthesis.service.ts:738-765` for `ineligible`, but it says nothing about `analyze-run` being conditional on candidate registration. It presents unverifiable expectations as ground truth. Document the expected-today status (measure or fail) per mapping.

5. MINOR. The determinism test (`skill-session-fixture.spec.ts` in-memory test) compares two runs of the same pure function. It is not vacuous, but it is weak: nothing else in the generator could vary. The uuids come from the seeded PRNG in `SessionJsonlWriter`. There is no `Date.now` or `Math.random` in the fixture files, so determinism holds. The golden test compares `index.json` semantically (parsed) and the JSONL byte-for-byte, so committed JSONL equals generator output. The prettier-formatted `index.json` formatting is not locked, which is acceptable.

6. MINOR. `UPDATE_FIXTURES=1` writes unformatted `index.json`. It then needs a manual prettier run and a `REBUILD_MANIFEST` run, otherwise the manifest hash is stale. Risk only on regeneration.

## Verified, no defect

- `session-jsonl-writer.ts` has no `@ptah-extension/memory-curator` import. The diff of `seeded-session-generator.ts` replaces `TurnBuilder` with `SessionJsonlWriter` using identical arguments (`CURATOR_WINDOW_CHARS`, `CURATOR_WINDOW_LIMIT`, minutes per turn). The seeded-generator spec passes unchanged, so output is behaviour-equivalent. The `TurnBuilder` deletion was confirmed dead code (the class was unused).
- Counts are real: 12 routine (4 x 3), 10 non-routine, 8 degraded, validated by spec. Labels only for degraded (see finding 1).
- Expected events are derived by `expectedEventsFromScript`, a pure function of the script. No pipeline output is read.
- Planted negatives (156371190): 10 documents with sha256 in `index.json`, kinds covering the required list. Documents 07-10 are derived from repo skills (`.claude/skills/...` at a pinned SHA), so they are not user data. A grep of the fixtures found no user paths, emails or usernames. The session `cwd` is the synthetic `D:/bench/ptah-extension`.

## Round 2

Re-review of 9fb394f9e. Jest (scoped to `ground-truth`): `Test Suites: 5 passed, 5 total` / `Tests: 81 passed, 81 total`.

Verdict: REVISE (0 blocking, 3 serious, 0 minor remain). Findings 1, 2 and 6 are closed. Findings 3 and 4 are only partly closed.

### Closed

- Finding 1 (degraded sessions are labels only). Sessions 13-16 carry a truncated line `{"type":"assistant","message":`. Sessions 17-20 carry an `UnsupportedSyntheticTool` tool_use block. The spec pins both. (The spec asserts the truncated record for `id <= 'skill-session-26'`. The classes are 21-26 unreadable and 27-30 unsupported in the fixture ordering, so the pin follows the generator's `shape`, not the report's text. It passes.)
- Finding 2 (routines carry no signal). Routine sessions repeat Read, Edit, Bash with paired tool_results. With defaults (`file-settings-keys.ts:580-581`: `prefilterMinEdits` 1, `prefilterMinToolUses` 2) they pass `hasSessionWorkEvidence` (editCount 1, nonMcp tools 3). (a) is confirmed for routines.
- Finding 6 (stale manifest risk). The spec now runs `verifyManifest`. Regeneration steps are documented.
- (c) Byte identity. `uuidOf` moved into the writer. The seeded-generator specs pass unchanged. The writer has no `memory-curator` import.

### New and remaining defects

R2-1. SERIOUS. The `prefilterTooThin` expectations are wrong for every class that uses them. `prefilterTooThin` is emitted only when `extract()` returns null, which happens only with fewer than 2 role turns (`skill-synthesis.service.ts:569-581`; `trajectory-extractor.ts:203`). `passesPrefilter`'s `tooThin` branch (line 1152) is unreachable after `extract()`, because the same floor applies. Q&A has 2 turns, aborted has 3, and unreadable has 2 (the reader skips the bad line, `jsonl-reader.service.ts:746-750`, so the session is readable). None of them are thin, and none has work evidence, so each yields `ineligible { reason: prefilterRejected }`. The fixture expects `prefilterTooThin` for Q&A, aborted and unreadable (`skill-session-fixture.ts`, `prefilter-too-thin` scripts and the `unreadable` degraded scripts). Fix: use `prefilter-rejected` for these, and add a genuinely 1-turn case if `prefilterTooThin` coverage is wanted.

R2-2. SERIOUS. The single-edit expectation is wrong. A single-edit session has `editCount` 1, which meets the default `prefilterMinEdits` of 1 (`session-work-evidence.ts:19`). It passes the prefilter, so the fixture's `prefilter-rejected` for sessions 8-10 will not occur. The session proceeds toward candidate authoring (a single-session candidate). Fix: make the expected result for single-edit sessions "passes prefilter, no `ineligible`" (the design's "no single-session auto-candidate" invariant then applies at the cluster stage), or change the fixture to a case that really fails (an edit-free session with one tool use). The unsupported-tool sessions are correct: one non-MCP tool use is below `prefilterMinToolUses` 2, so they give `prefilterRejected`.

R2-3. SERIOUS. (b) The `manual-run` citation is incorrect. `memory-rpc.handlers.ts:694-699` calls `this.curator.pushEvent`, which is the memory curator feed (`MemoryCuratorEvent`, `memory-curator/src/lib/diagnostics.types.ts:11`). It is the `memory:runNow` path. No code under `libs/backend/skill-synthesis/` emits `manual-run`, and `analyzeSession('manual')` is rejected (`skill-synthesis.service.ts:704-710`). The skills feed therefore cannot produce the scripted `manual-run`. The report marks it "measure". It must say the expectation is unmeetable today (`fail`/not-producible), and the script should not use a memory-curator event as skills ground truth.

### Open note

The `session-end` and `drain-eligible-candidate` split is now consistent with the producers (`analyze-run` only after candidate registration, lines 935-948). The Revision 2 table should be corrected for R2-1 to R2-3.

## Round 3

Re-review of 3fbfeabeb. Jest (scoped to `ground-truth`): `Test Suites: 5 passed, 5 total` / `Tests: 82 passed, 82 total`.

Verdict: APPROVED (0 blocking, 0 serious, 1 minor).

### Round 2 findings

- R2-1 closed. `prefilter-too-thin` is removed from the script vocabulary (`skill-session-fixture.ts` `SCRIPT_OPERATIONS`). Q&A, aborted, unreadable and unsupported sessions all expect `ineligible { reason: prefilterRejected }`. This matches the product: each has 2 or more role turns and no work evidence (`skill-synthesis.service.ts:747-767`; the reader skips the malformed line). The new spec test pins the class slices (indexes 12-18 and 22 onward). I checked that those slices select non-routine 1-7 and the 8 degraded sessions.
- R2-2 closed. Single-edit sessions (indexes 19-21) script only `session-end` and expect `[]`. This is consistent with `editCount` 1 meeting the default `prefilterMinEdits` of 1. The spec pins it.
- R2-3 closed. `manual-run` stays expected and is marked "fail, no skills producer emits it". The memory-curator citation is explicitly disclaimed. I did not re-verify the `skills-synthesis-rpc.handlers.ts:830-869` claim line by line. Earlier greps found no `manual-run` push anywhere under `libs/backend/skill-synthesis/`.
- No regression: the golden spec and manifest verification pass, and the seeded-generator specs still pass.

### Remaining

R3-1. MINOR. `batch-11-1-report.md` still contains the superseded "Revision 2" mapping text below "Revision 3" (its `prefilter-too-thin` rows and the `manual-run` citation to `memory-rpc.handlers.ts:694-699`). Someone reading the file top to bottom can take the stale table as current. The file notes it is superseded, so this is documentation only.
