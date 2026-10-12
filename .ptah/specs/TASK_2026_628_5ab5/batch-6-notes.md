# Batch 6 notes - linear `summarizeLive` (hot spot 6)

## Files changed

- MODIFIED `D:\projects\ptah-wt-628\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.ts`
- MODIFIED `D:\projects\ptah-wt-628\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.spec.ts`
- CREATED `D:\projects\ptah-wt-628\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary-cache.ts`
  (the coordinator approved it under D5). It holds the two LRU memos and their helpers. It exports
  `redactBlock`, `toolInputOf` (the only consumer of the parse cache) and `redactAbsolutePaths`.
  `redactAbsolutePaths` moved with `workspaceLabel` because `redactBlock` depends on it; leaving it
  in the summary file would make the two files import each other. It is not in the lib barrel:
  only `compact-session-summary.ts` imports it.

No other file was touched. The card, the canvas and other libs are unchanged. No sampler was added.
The `summarizeLive` and `summarizeFinalized` signatures are unchanged.

## Design summary

1. **Select first, build later.** `liveItems` makes one pass over `state.events`. For each event it
   works out the item id (`liveItemId`, the same ids as before) and keeps only the last event per id
   in a `Map`. This is the same "last write wins" rule the old per-event rebuild had, so a prose
   block keeps its last delta's timestamp. `liveEventItem` now runs only for the selected items, at
   most 48. This is where the text work happens: redaction, tool-input parse and target text.
2. **No full sort.** `selectNewest` keeps an ascending array of at most 48 candidates. It inserts
   with a binary search (upper bound, so equal keys keep insertion order) and drops the oldest
   entry when the array is full. The result is identical to the old stable
   `sort((timestamp, id)).slice(-48)`. `buildSummary` is unchanged; it already sorts a bounded list.
3. **Redact each block once per change.** `redactBlock` uses a module-level LRU memo
   (`redactedBlocks`, 256 entries) keyed by block id `${messageId}:prose:${blockIndex}`. It reuses
   an entry only when the raw text is identical and `workspacePath` matches. Otherwise it redacts
   the whole block again, never just the new suffix, so a path split across two deltas is still
   redacted.
4. **Local tool-input parse cache** (cross-part resolution 5: Batch 5's shared cache has not
   landed). `parseToolInput` uses a 256-entry LRU keyed by tool call id. It reuses an entry only
   when the raw accumulator text is identical, and it caches a failed or non-object parse as
   `null`. `toolInputOf` keeps the same fallback to `input`.
5. Both memos share two small helpers, `recall` (read and mark as most recently used) and
   `remember` (write and evict the oldest while size > 256). There are no timers or observers.

## Complexity per publish (one `summarizeLive` call)

Symbols: E = events in the stream, D = text deltas in a block, L = block length, K = 48,
T = tool calls.

| Work | Before | After |
| --- | --- | --- |
| Item builds | E (every event built an item) | E id computations + at most K builds |
| Prose redaction | Sum over blocks of D x L (each delta redacted its whole block) | Changed blocks among the newest K: normally one (the open tail), O(L). Unchanged blocks cost one string compare |
| Tool-input `JSON.parse` | Up to 2 per tool on every publish, O(total input size) | Only inputs among the newest K that changed since the last publish |
| Ordering | O(I log I) sort plus a full copy (I = distinct items) | O(I log K) binary search plus O(K) splice, with K = 48. Linear in I |

## Checks (run from `D:\projects\ptah-wt-628`, each under `.ptah\tmp\heavy-check.lock`)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts --coverage=false --maxWorkers=2`
  -> Test Suites: 1 passed. Tests: 59 passed, 59 total (8 of them new).
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` -> Successfully ran target typecheck.
- `npx nx lint @ptah-extension/chat-ui --parallel=1` -> Successfully ran target lint. 0 errors,
  9 warnings across the project. One of the warnings is new and comes from this batch:
  `compact-session-summary.ts` `max-lines` (778 > 700). The pre-change file had no lint warnings
  (checked with eslint on the `HEAD` version). See Decisions D5.

Re-run after the D5 extraction (each check under the lock):

- Jest on `compact-session-summary.spec.ts` (same command as above) -> 1 suite passed. Tests: 59
  passed, 59 total.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` -> the first run printed "failed" with
  no TS error in the filtered output. A re-run with `--skip-nx-cache` passed: "Successfully ran
  target typecheck". The first failure looks transient. Other developers edit this worktree at the
  same time, so it may have been one of their files mid-edit. Nothing was changed between the two
  runs.
- `npx nx lint @ptah-extension/chat-ui --parallel=1` -> Successfully ran target lint. 0 errors,
  8 warnings, none of them in the three compact-session-summary files. That is one fewer than
  before the extraction, so this batch adds no lint warning.
- `npx eslint` on the three files -> no output. `npx prettier --check` on the three files -> all
  formatted.

New tests in `describe('summarizeLive cost per publish')`:

- **Parity:** 2 blocks (100 and 50 deltas) plus a tool start and result give exactly three marks,
  with the expected ids, labels, redacted text and last-delta timestamps (100 and 150).
- **Linear redaction:** with 200 deltas in one block, the first call makes one redaction
  (2 `replaceAll` calls). A second call with the same accumulator makes 0. Growing the block gives
  one new redaction.
- **Chunk boundary:** `see C:\Users\a` grows to `see C:\Users\abd\x.ts` and the result is
  `see x.ts`, with no `C:\` and no `Users`.
- **Workspace change:** the same block with a different `workspacePath` is redacted again and gives
  the new output.
- **Top-K:** 60 agent items, inserted out of order with tied timestamps. `agentCount` is 48 and the
  marks match a reference stable sort plus slice.
- **Only the newest items are redacted:** a stream with 100 blocks makes exactly 48 redactions.
- **LRU bound:** after 300 distinct blocks, the first block is redacted again (it was evicted) and
  the output is still correct. This checks behaviour only; the memo is not exported.
- **Parse cache:** an unchanged streamed tool input is parsed once across two calls and is parsed
  again when it changes.

## Decisions

- **D1. Build only the selected items (an addition to the plan).** The plan builds every prose item
  from its accumulator and then selects the top K. This batch selects first by (timestamp, id),
  which only needs the event, and then builds at most 48 items. Without this, a stream with more
  than 256 blocks or tools would cycle through the 256-entry LRU in the same order on every publish
  and miss every entry, which brings back the cost that grows with the length of the stream.
  Output is the same for every item shown.
- **D2. Exact raw comparison instead of length plus a 64-character tail.** The plan reuses an entry
  when the length and the last 64 characters match. That relies on the accumulators only ever
  appending. Comparing the full raw string is correct without that assumption. It is O(1) when the
  length differs (the open block) or when it is the same string object, and a memcmp otherwise,
  which is still far cheaper than four regex passes. The cost is up to 256 retained raw strings,
  next to the redacted strings that are retained anyway.
- **D3. Local parse cache added.** The plan section says not to add one in this batch. Cross-part
  resolution 5 and the orchestrator brief override that: Batch 5's shared cache has not landed, so
  a local per-tool-call-id cache is kept. When Batch 5's cache lands, replace `parseToolInput` and
  `parsedToolInputs` with it (call site: `toolInputOf`).
- **D4. The memos are module-level and shared across tabs.** Keys are message ids and tool call ids,
  which are assumed to be globally unique (the plan's assumption). Even with a collision, a reused
  entry must have identical raw text and the same workspace, so the output is still correct.
- **D5. Resolved: `max-lines` warning.** The coordinator approved one new sibling file. These now
  live in `compact-session-summary-cache.ts`:
  - the memos and their `recall`/`remember` helpers;
  - `redactBlock`;
  - `parseToolInput` (no longer exported) and `toolInputOf`;
  - `redactAbsolutePaths` and `workspaceLabel`.

  Moving only the two cache helpers left the summary file at 705 counted lines, so `toolInputOf`
  moved as well. The summary file is now under the 700-line limit and lint reports no warning for
  either file. Behaviour and the public exports of `compact-session-summary.ts` are unchanged.
  When Batch 5's shared parse cache is adopted (D3), `parseToolInput` and `parsedToolInputs` in the
  new file are replaced by it.
- **D6. Parsed inputs are shared between publishes.** The cached parsed object is returned by
  reference (typed `Readonly`). It is used only to read the target text, never changed.

## Review round 1 (`code-logic-review-batch-6.md`, CHANGES REQUESTED)

### Defect 1: the caches were bounded by entry count only. Fixed.

`compact-session-summary-cache.ts` now keeps each memo as `{ entries, retained }`. `retained` is
the number of characters the memo keeps alive. Three bounds apply to both memos:

- **Per-entry cap:** an input longer than `MEMO_MAX_ENTRY_CHARS` (32,768) is never cached. Its
  result is computed and returned, and any older entry for that key is dropped.
- **Retained-size budget:** after each write, the least recently used entries are evicted while
  `retained > MEMO_MAX_RETAINED_CHARS` (1,048,576 per memo).
- **Entry cap:** the 256-entry limit still applies.

How an entry is sized:

- **Redaction entry:** `raw.length + redacted.length`.
- **Parse entry:** `raw.length * 2`, since the parsed object holds about the raw text again.

Hits still need full-text equality: the raw text, plus the workspace path for redaction.

**Worst case:** about 1M characters per memo, or about 2M across both. In UTF-16 that is about 4 MB
of string data, and it stays that size however many sessions are opened and closed. Removing
entries when a session closes is therefore not needed for the memory ceiling. The cache module
also has no hook into tab lifecycle, and adding one would mean editing files outside this batch.

**Cost of the cap:** an open block over 32K characters is redacted again on every publish. That is
O(L) for that one block per publish, which is still linear. The old cost was deltas x L.

### Tests added (5 new cases, 64 total)

- Malformed tool input recovers: a partial input falls back to the tool name on two calls, and the
  target appears once the input becomes valid JSON.
- Exactly 48 items: `it.each` with 48 and 49 agents. Both give `agentCount` 48 and the newest 24
  marks.
- Over-cap block not kept: a block of more than 40K characters is redacted on both calls (4
  `replaceAll` calls), the path is still redacted, and a small block cached earlier is still a hit
  (it was not pushed out).
- Retained-size budget: 20 blocks of about 30K characters, about 60K retained each. The newest
  block is still a hit (0 redactions) and the oldest was evicted and is redacted again (2 calls).

### Checks (each under the lock)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts --coverage=false --maxWorkers=2`
  -> 1 suite passed. Tests: 64 passed, 64 total.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` -> Successfully ran target typecheck.
- `npx nx lint @ptah-extension/chat-ui --parallel=1` -> Successfully ran target lint. 0 errors,
  7 warnings across the project, none in the compact-session-summary files.
- `npx eslint` on the three files -> exit 0, no findings. `npx prettier --write` was applied to the
  two edited files.
