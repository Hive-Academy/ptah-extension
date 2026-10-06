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
