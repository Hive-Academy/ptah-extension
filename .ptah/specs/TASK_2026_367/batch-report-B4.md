# Batch report B4 — C4 chunked map and reduce curation

Branch: `fix/log-defects-367`. Worked in place, no worktree. Only
`libs/backend/memory-curator/**` was touched.

---

## Files

**Created**

| File                                                                         | Lines | Purpose                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.ts`      | 341   | The pure module: `compressToolNoise`, `splitTranscriptRecords`, `buildCuratorWindows`, `planCuratorWindows`, `CURATOR_WINDOW_MAX_CHARS`, `CURATOR_MAX_WINDOWS` |
| `libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.spec.ts` | 224   | 20 specs over the pure module                                                                                                                                  |
| `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts`   | 136   | The facade-rule collaborator (deviation 2 below)                                                                                                               |

**Modified**

| File                                                                 | Lines | Change                                                                                                                   |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `libs/backend/memory-curator/src/lib/memory-curator.service.ts`      | 697   | `clampForModel` → `windowForModel`; the `doCurate` extract step is now a windowed, abort-checked loop with one `resolve` |
| `libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts` | 1249  | Replaced the prompt-cap block with the chunked-budget block; repaired one pre-existing spec (deviation 5)                |
| `libs/backend/memory-curator/CLAUDE.md`                              | —     | New paragraph on the windowing and the 9-call budget                                                                     |

`clamp-transcript.ts` is unchanged. It is now the last-resort guard, invoked at
`CURATOR_WINDOW_MAX_CHARS * CURATOR_MAX_WINDOWS`.

`ICuratorLLM` is unchanged. Neither `extract` nor `resolve` changed signature.

---

## Data flow, as built

```
raw transcript
  -> compressToolNoise                                   (pure, no LLM)
  -> if length <= CAP:  ONE window, byte for byte        (today's cost exactly)
  -> else: clampTranscript(compressed, CAP * MAX_WINDOWS) (last-resort guard)
           -> splitTranscriptRecords
           -> buildCuratorWindows({ maxChars: CAP, maxWindows: 8 })
  -> for each window (sequential, abort-checked): llm.extract(window.text, signal)
  -> union the drafts, drop exact-duplicate (subject, content) pairs
  -> ONE llm.resolve(unionedDrafts, related, signal)
```

Budget: **at most 9 LLM calls per pass — 8 `extract` plus 1 `resolve`.** The
common case stays at exactly 2.

---

## Spec assertions added

### `transcript-windows.spec.ts` (20)

`compressToolNoise`

1. Never lengthens its input, on a tool-heavy corpus and on plain text.
2. Is idempotent — `compress(compress(x)) === compress(x)`.
3. Truncates a `tool_result` body to 600 characters, on one line, with the `…` marker.
4. Truncates a `Bash` command to 80 characters and drops the JSON wrapper.
5. Keeps the `error` label on a failed tool result.
6. Leaves a non-Bash `tool_use` line alone.
7. Stops a `tool_result` body at the next record header, and keeps the blank line that separates the two records.

`splitTranscriptRecords`

8. Splits on the record separator and never inside a record.
9. Skips blank records and keeps the surviving indices honest (`[0, 2]`).

`buildCuratorWindows` — corpus includes one record larger than `maxChars`

10. No window is longer than `maxChars`.
11. An over-large record is character-truncated with a marker, not dropped.
12. Every record is served exactly once, in a strictly ascending, duplicate-free index sequence.
13. `maxWindows` is respected exactly (3 of 40 records' worth), the last window reports the omission, and it still fits inside `maxChars`.
14. No omission text when nothing was omitted.
15. Deterministic — two calls are deep-equal.
16. No records means no windows (no LLM call burned on an empty prompt).

`planCuratorWindows`

17. A fitting transcript produces exactly one window, byte for byte, and does not clamp.
18. A 240 KB transcript splits into more than one and at most `CURATOR_MAX_WINDOWS` windows, every one inside `CURATOR_WINDOW_MAX_CHARS`, and does not clamp.
19. A 1.2 MB transcript falls back to the last-resort clamp, still yields exactly 8 in-budget windows, and reports `droppedChars > 0`.
20. Deterministic.

### `memory-curator.service.spec.ts` (7 new, in `— the chunked curation budget (TASK_2026_367)`)

1. **The no-regression assertion.** A transcript under the cap costs exactly one `extract` and one `resolve`, and the extract receives the transcript byte for byte.
2. A 172 KB transcript produces more than one `extract`, and **every** call is inside `CURATOR_TRANSCRIPT_MAX_CHARS`.
3. A 400 KB transcript costs at most 8 `extract` calls and exactly one `resolve`; the resolve receives the union of every window's drafts, with the draft repeated by all eight windows present exactly once.
4. An `extract` rejection on window 3 stops after 3 calls, issues no `resolve`, zeroes the stats, and pushes a `curator-error` naming the extract stage and the underlying message.
5. An abort signalled during window 2 stops the loop after 2 calls, issues no `resolve`, and records `aborted after 2 …`.
6. A `stalled` window stops the loop after 2 calls, issues no `resolve`, and returns `outcome: 'stalled'`.
7. The warn fires only above the chunked budget, carrying `cap: CURATOR_TRANSCRIPT_MAX_CHARS * CURATOR_MAX_WINDOWS` and `droppedChars > 130 000`; it says nothing when the whole transcript fit.

---

## Verification

```
npx nx run-many -t test -p @ptah-extension/memory-curator --skip-nx-cache
  Running target test for project @ptah-extension/memory-curator
  Test Suites: 2 skipped, 27 passed, 27 of 29 total
  Tests:       60 skipped, 437 passed, 497 total
  Successfully ran target test

npx nx run-many -t lint -p @ptah-extension/memory-curator --skip-nx-cache
  6 problems (0 errors, 6 warnings)
  Successfully ran target lint

npx nx run-many -t typecheck -p @ptah-extension/memory-curator --skip-nx-cache
  Successfully ran target typecheck
```

All 6 lint warnings pre-date this batch and sit in files this batch did not
touch (`memory-decay.job.spec.ts`, `memory-search.service{,.spec}.ts`,
`memory-trigger{.coalesce.spec,.service}.ts`). The two skipped suites are the
pre-existing native-sqlite specs. `memory-curator.service.ts` is 697 lines,
under the 700 ceiling, and no new `max-lines` warning was introduced.

The five touched TypeScript files were formatted with
`npx prettier --write <the five paths>`. `nx format:write` was never run, and no
file outside `libs/backend/memory-curator` was formatted or edited.

---

## Deviations from the plan, and why

1. **The module exports `planCuratorWindows` and `CuratorWindowPlan` in addition
   to the three functions the plan names.** The plan's data flow — compress,
   check the fit, clamp, split, build — is a decision worth pinning purely, and
   the one-window short-circuit is the no-regression guarantee. Leaving that
   composition inside the service would have put the service over the 700-line
   ceiling and left the guarantee testable only through an LLM mock. The three
   functions the plan names are all exported and all directly spec'd.

2. **A third source file, `curator-window-runner.ts`.** With the window loop and
   the logging inline, `memory-curator.service.ts` reached roughly 740 lines. The
   brief authorises the facade rule in exactly this case. `MemoryCuratorService`
   keeps its name, its DI token, its constructor signature and every public
   method; the collaborator takes the window-and-extract concern. It is
   **constructed by the service, not injected**: section 0.1 forbids a new DI
   token (both `phase-2-libraries.ts`, both `expected-resolvable.ts` and both
   `container.smoke.spec.ts` are Group B files), and the collaborator has no
   lifecycle, no second implementation and no other consumer. The existing specs
   that build the service positionally needed no change.

3. **`compressToolNoise` leaves non-Bash `tool_use` lines untouched.** The plan
   names two figures — `tool_result` 600, `Bash` command 80 — and both are
   implemented at those values, imported in spirit from
   `TranscriptWindowReader`. It names no figure for a non-Bash tool input, and
   `HistoryEventFactory.extractContentForCuration` already bounds those at 1 000
   characters at the producer, so inventing a third number here would have been
   a number to drift.

4. **The clamp warn message and payload changed.** It now reads
   `transcript exceeded the chunked curation budget; head and tail kept` and
   reports `cap: CURATOR_WINDOW_MAX_CHARS * CURATOR_MAX_WINDOWS`. The old text
   and the old `cap` value would both have been false: the warn now means the
   session exceeded 8 windows, not 32 KB. Two existing specs asserted the old
   string and the old value and were updated.

5. **One pre-existing spec was repaired, not just re-asserted.** `resolve
rejection … preserves the extracted count` fed `[draft, { ...draft }]` — two
   byte-identical drafts — and asserted `2 extracted`. The union now drops the
   duplicate, which is the specified behaviour, so the second draft was given a
   distinct `content`. The assertion it was written to make is unchanged.

6. **An abort between windows takes the `recordCuratorError(…, 'extract')`
   path**, with the message `aborted after N of M windows`. The plan states the
   loop stops but does not name the stats path. The error path was chosen
   because it is the only one that does not let a partial extraction look like a
   complete run: the caller must not advance its state on it.

7. **A tool result body absorbs blank lines but not its TRAILING blank line.**
   Absorbing the trailing blank line welded the following record onto the tool
   result and hid a record boundary from `splitTranscriptRecords`. Caught by
   spec 7 above during the first run and fixed in `compressToolNoise`.

---

## Left undone

Nothing in the C4 scope. Three notes for whoever verifies:

- Coverage of the 366 540-character field sample is not measured against the
  real transcript, only against a synthetic one of the same size; the specs
  assert the call budget and the window bounds, not a compression ratio on real
  data.
- `compressToolNoise` is idempotent on realistic input. A Bash command whose
  literal text is itself a JSON object carrying a `command` key would re-extract
  once on a second pass and stabilise on the third. Pathological, and it can
  only ever shorten.
- No other lib was inspected for the same pattern; C4 is scoped to
  `memory-curator` by decision D-4.

DONE: B4 — curator transcripts now map-and-reduce over at most 8 windows plus one resolve, with the fitting case still costing exactly one extract and one resolve.
