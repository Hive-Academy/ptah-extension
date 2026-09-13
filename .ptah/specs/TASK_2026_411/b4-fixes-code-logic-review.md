# Code Logic Review — `TASK_2026_411` B4 review fixes

Scope: commits `2c23fac87` (agent-sdk), `b2a92e1ee` (CLI paging),
`30de2ea29` (docs) against `af5b63968`. Input findings: `b4-code-logic-review.md`
(NEEDS_REVISION, 6/10, 1 serious + 3 moderate + 3 failure modes). Fix report:
`.ptah/specs/TASK_2026_411/b4-fixes-report.md`.

## Summary

| Metric              | Value   |
| -------------------- | ------- |
| Overall score         | 9/10    |
| Assessment            | APPROVED |
| Blocking issues        | 0       |
| Serious issues         | 0       |
| Moderate issues        | 1       |
| Failure modes found    | 0 new   |

All six original findings (CLI >20-id break, subagent compaction gap,
coalescing abort misattribution, unsanitized RPC error path, dropped legacy
unreadable count, sequential legacy scan) are fixed at the cited lines, each
with a regression spec that the fix report claims fails pre-fix. I re-derived
every claim from the diff rather than trusting the report's prose, and the
code matches what the report says it does. One moderate observation is new
(over-broad `partial` coverage flagging on unrelated legacy sessions,
documented but worth naming), plus the requested NUL-byte note below.

## Five logic questions

### 1. How does this fail silently?

Nothing new introduced by these three commits fails silently. The CLI paging
path (`apps/ptah-cli/src/cli/commands/session.ts:940-954`) accumulates
`entries` across all pages before writing any `session.stats` notification, so
a rejected page (`callRpc` throws) propagates through `withEngine`'s error
handling to `task.error` + exit 1 with zero partial output — verified by the
new spec at `session.spec.ts:1135-1163` and by reading `runStats` directly.
The one thing that could look silent but isn't: when a legacy flat subagent
file fails to read, `subagentMembers` (`session-stats-reader.service.ts:223-256`)
now marks it `unreadable` and the caller's `coverage` degrades to `'partial'`
(`session-stats-reader.service.ts:171`) instead of silently reporting
`'complete'` — this is the fix, not a regression.

### 2. What user action produces unexpected behaviour?

A user who has never seen more than 20 ids in one CLI call now sees N/20
rounded-up sequential RPC round-trips instead of one — a latency change, not a
correctness one, and it's the intended fix. A user on a legacy-layout install
(flat `agent-*.jsonl`, no `subagents/` folder) whose page happens to contain
*any* unreadable legacy file will see `coverage: 'partial'` on **every**
legacy-layout session in that page, including sessions that own none of the
unreadable files — this is deliberate (documented at
`session-stats-reader.service.ts:213-217` and in the fix report) but is a
real, page-wide side effect a user could reasonably read as "my session's data
is now suspect" when it isn't. See Moderate issues.

### 3. What input data produces a wrong answer (not an error)?

None found in the reviewed diff. The subagent-compaction fix
(`session-usage-aggregator.ts:158-167`) applies `contextStart(subagent)`
symmetrically with the parent, and the golden spec at
`session-usage-aggregator.spec.ts:294-359` exercises: a subagent with its own
boundary (counts only post-boundary), a subagent with no boundary (counts all,
unchanged from before), two subagents each with independent starts (no cross-
contamination), and `range` (boundary ignored, matches documented contract).
The math (`1 + 9`, `1 + 1`, cost breakdown) checks out by hand: `COMPACTED_SUBAGENT`
has records `[user@0(no usage), assistant c1@1(400/40), system boundary@2,
assistant c2@3(9/1)]` → `ledger()` presumably drops the non-usage `user`
record from `.records` for token counting, leaving `currentContextStart: 1`
pointing at the boundary's position among *usage* records — the test's own
assertion `COMPACTED_SUBAGENT.records` `toHaveLength(2)` and
`currentContextStart` `toBe(1)` pins this, and `current-context` totals
(`9+1`) match "only c2 counted." Correct.

### 4. What happens when a dependency fails?

- Ledger cache (`session-usage-ledger-cache.ts:94-135`): a waiter's own abort
  is now checked via `signal?.throwIfAborted()` immediately after catching a
  shared-projection rejection (line 117), **before** the `isAbortError` check,
  so an aborted waiter's own reason wins even if the shared projection also
  rejected with a foreign `AbortError` at the same tick — matches the report's
  "own reason, never the owner's" claim and the cache spec at `:265`. A real
  (non-abort) failure at line 119 is rethrown immediately without spending a
  join attempt — correct, since a real I/O failure is everyone's failure and
  retrying it 3x would waste time for no benefit. After 3 foreign-abort joins,
  the waiter either joins one more in-flight projection it lost a race to
  register (still registered, still shared) or runs a fully private,
  unregistered `project()` (line 132) — bounded at "3 joins + 1 own attempt,"
  matching the report. I did not find an unbounded loop or an unhandled
  rejection: the private `project()` call is awaited in the same async
  function, so its rejection propagates normally to the RPC handler's new
  `catch`.
- RPC handler (`session-rpc.handlers.ts:904-919`): `RpcUserError` is
  rethrown unchanged (code preserved); anything else is logged, sent to
  Sentry, and replaced with a plain `Error('Failed to read session stats')`
  before reaching the transport. Verified against both new specs
  (`session-rpc.handlers.spec.ts:1494`, `:1520`).

### 5. What is missing that the requirements never mentioned?

- The fix report explicitly skips the `type: 'user'` + `usage` /
  `messageCount` mismatch the original review flagged as "reachable but
  correct-per-spec" — that's a legitimate skip (original review called it
  deliberate, not a defect), not a gap in this fix batch.
- No test exercises three-or-more-page CLI paging with a signal/abort mid-way
  (e.g., `ptah session stats` interrupted between page 1 and page 2) — minor,
  since the existing "later page rejected" test already proves no-partial-
  output holds for the ordinary rejection path, and an external abort would
  hit the same `callRpc` throw path.

## Failure modes

No new failure modes found in the reviewed commits. The three failure modes
from the original review are each closed:

### 1. Subagent compaction ignored under `current-context` — CLOSED

- Evidence: `session-usage-aggregator.ts:158-167`, golden test
  `session-usage-aggregator.spec.ts:305-352`.

### 2. Coalescing exhaustion misattributing a foreign abort — CLOSED

- Evidence: `session-usage-ledger-cache.ts:112-121` (own-signal check before
  foreign-abort swallow), spec `session-usage-ledger-cache.spec.ts` (per fix
  report, `:216`, `:244`, `:265`, `:279` — not independently re-run, but the
  source change is a faithful match to the described behaviour and to the
  original finding's recommendation "start a fresh `project()` instead of
  rethrowing a foreign abort").

### 3. Unsanitized error path in `session:stats-batch` — CLOSED

- Evidence: `session-rpc.handlers.ts:904-919`, specs at `:1494`, `:1520`.

## Blocking issues

None.

## Serious issues

None. The CLI `>20 ids` regression is fixed
(`apps/ptah-cli/src/cli/commands/session.ts:940-954`), verified by hand-tracing
`runStats`: `pages` is built by slicing `sessionIds` at
`SESSION_STATS_BATCH_MAX_IDS`, `pages.length === 0` is special-cased back to a
single `[]` page (preserving "no ids still sends one call with `[]`"), every
page is awaited sequentially and its `sessionStats` entries concatenated
in-order before any `writeNotification` call, and the loop exits on the first
`callRpc` throw (no `try/catch` around the loop), which surfaces through
`withEngine`'s existing error handling exactly as a single rejected call did
before. Output order preservation follows from three facts holding together:
pages are sliced from `sessionIds` in order, each page's RPC response is
"already in request order" (per the report; not independently re-verified
against the handler, but plausible since the handler's `Promise.all` map
preserves input order per the B4 review's own data-flow trace), and
`entries.push(...)` appends per-page results in page order.

## Moderate and minor issues

### Page-wide `coverage: 'partial'` blast radius for legacy-layout sessions

- File: `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:213-256`.
- Scenario: a page of 20 legacy-layout session ids is requested. One flat
  `agent-*.jsonl` file (belonging to session A) is transiently unreadable
  (e.g., a permission hiccup, an AV lock, a half-written file). `subagentMembers`
  is called once per session in the page, and each call re-scans and re-reads
  every flat file in `page.legacyAgentFiles` to determine ownership. Every one
  of those calls — not just session A's — sees the same read failure for the
  same file and increments its own `unreadable` count, so all 20 sessions in
  the page report `coverage: 'partial'` even though only session A's data is
  actually affected.
- Impact: a dashboard or CLI consumer reading `coverage` as a per-session
  reliability signal sees 20 "partial" rows for one transient file glitch.
  This is explicitly documented as the deliberate trade-off ("an honest
  `partial` beats a confident `complete` that may be wrong" —
  `session-stats-reader.service.ts:213-217`, echoed in the fix report's
  "Semantics updates" section), so it is not a defect against this batch's own
  stated contract. Flagging it because the blast radius (page-wide, not
  file-owner-only) is a meaningful UX cost that the fix report states but
  does not evaluate, and B5's dashboard consumes `coverage` directly.
- Suggested follow-up (not blocking): cache the per-file ownership read result
  within `page.legacyAgentFiles` resolution (it's already memoized as a
  promise) so a session only counts a file `unreadable` if it could plausibly
  be that session's owner — e.g., skip counting files whose first-record
  parse succeeded for a *different* session's read attempt. Out of scope for
  this fix batch; worth a note for B9 or a future pass.

### NUL bytes note (per task instructions — not scored)

- The **committed blob** at `2c23fac87`/`b2a92e1ee` (`git cat-file -p
  HEAD:libs/backend/agent-sdk/src/lib/session-stats/session-usage-ledger-cache.ts`)
  contains two literal `0x00` (NUL) bytes, at the cache-key construction line
  (`getOrProject`, originally line 104 equivalent): the key is built as
  `` `${filePath}\0${token.size}\0${token.mtimeMs}` `` with raw NUL bytes
  between the three interpolated fields, not an escaped ` ` sequence.
  This is why `git diff --stat` reports the file as binary
  (`Bin 5389 -> 7340 bytes`) and why `git diff` without `--text` shows no
  textual diff for it. Purpose: a field separator chosen because a NUL byte
  cannot occur inside a filesystem path (comment: "NUL cannot occur in a path,
  so the key cannot collide across fields") — i.e., it prevents key collisions
  like `filePath="a"` + `size=123` colliding with `filePath="a1"` + `size=23`
  under a naive concatenation. This is a correct and intentional separator
  choice; the defect is purely that writing it as a raw control byte instead
  of the ` `/`\x00` escape breaks git's diff/blame tooling for this file.
  **Separately**, the current *working-tree* copy of this file (uncommitted,
  outside the three commits in scope) has already been altered to use the
  literal four-character string `"0000"` as the separator instead of NUL —
  confirmed by byte-level inspection (`od`/`dd`), which is a **different and
  weaker** fix: `"0000"` is not guaranteed absent from `token.size` /
  `token.mtimeMs`, which are decimal number strings, so a boundary could shift
  in principle (e.g., a path ending options aside, sizes/mtimes containing the
  substring `"0000"` adjacent to genuine zero-padding are a real ambiguity a
  NUL byte does not have). Since this working-tree state is explicitly outside
  the three reviewed commits and is described as being fixed separately by
  the orchestrator, I did not score it, but flag it as something the
  orchestrator's follow-up should not literalize as `"0000"` text — it should
  use an actual control character or a genuinely reserved separator (or better,
  key by a tuple/hash rather than a delimited string).

## Data flow

1. CLI `ptah session stats --ids <n>` → `runStats` slices into pages of
   `SESSION_STATS_BATCH_MAX_IDS` → sequential `callRpc('session:stats-batch')`
   per page, entries concatenated in order → `session.stats` notifications
   written in request order. OK, matches pre-existing single-page semantics
   for ≤20 ids.
2. `session:stats-batch` handler → Zod parse (unchanged, still enforces the
   20-id cap on each page) → `readStats` call wrapped in `try { } catch
   (error: unknown) { … } finally { clearTimeout }` → `RpcUserError` passes
   through with its code; anything else is logged + captured + replaced with a
   sanitized `Error`. OK, closes the original gap.
3. `readStats` → `readOne` per session → `subagentMembers` (nested-first,
   legacy fallback with page-wide-bounded concurrent ownership scan and
   `unreadable` counting) → per-subagent ledger projection through
   `SessionUsageLedgerCache.getOrProject` (own-signal-only outcome, bounded
   coalescing) → `aggregateSessionUsage` (now applies each ledger's own
   `currentContextStart` symmetrically). OK end to end.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| CLI pages `--ids` at `SESSION_STATS_BATCH_MAX_IDS`, preserves order, format, error behavior | COMPLETE | None found. |
| Subagent compaction counted per-subagent under `current-context`; parent/`range` unaffected | COMPLETE | Golden specs verified by hand. |
| Cache coalescing: waiter outcome depends only on its own signal; bounded retries; no infinite loop; nothing bad cached; no unhandled rejection | COMPLETE | Traced the loop bound and the private-project fallback; both hold. |
| `session:stats-batch` sanitizes unexpected `readStats` rejections; preserves `RpcUserError` | COMPLETE | Matches sibling handlers' pattern. |
| Unreadable legacy flat file → counted → `coverage: 'partial'` | COMPLETE | Works, but page-wide over-attribution noted as Moderate. |
| Legacy ownership checks run concurrently through the bounded pool, limit 3 page-wide | COMPLETE | `Promise.all` + `page.subagentSlots.run`, per diff. |
| Shared contract additive-only; no frontend⇄backend imports; `catch (error: unknown)`; bounded memory; abort propagation | COMPLETE | No `libs/shared`/`libs/frontend` files touched; every new catch is typed `unknown`; ledger cache remains LRU/byte-bounded; abort still throws through every layer. |

Implicit requirements not addressed: none identified beyond the page-wide
coverage blast radius already noted.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| CLI: 0 ids | YES | `pages.push([])` fallback preserved | — |
| CLI: exactly 20 ids | YES | Single page, spec `:1119` | — |
| CLI: 45 ids | YES | 3 pages `[20,20,5]`, order preserved, spec `:1094` | — |
| CLI: page 2 of 3 rejected | YES | Exit 1, 2 calls made, page 3 never sent, 0 notifications | — |
| Subagent with own `compact_boundary` under `current-context` | YES | `contextStart(subagent)`, golden spec | — |
| Two subagents, independent boundaries | YES | Spec `:345`-equivalent | — |
| `range` scope with subagent boundary present | YES | Boundary ignored, spec confirms | — |
| 3+ waiters coalescing on a repeatedly-aborted key | YES | Own-signal check before foreign-abort swallow, bounded to 3 joins + 1 private attempt | — |
| Real (non-abort) shared-projection failure while joining | YES | Rethrown immediately, no wasted retry | — |
| `readStats` throws a non-`RpcUserError` | YES | Logged, Sentry-captured, sanitized `Error` returned | — |
| `readStats` throws an `RpcUserError` | YES | Code and message preserved unchanged | — |
| Legacy flat file unreadable during ownership scan | YES | Counted `unreadable`, `coverage: 'partial'` | Page-wide blast radius (Moderate, documented trade-off) |
| Legacy ownership scan concurrency | YES | `Promise.all` through page-wide semaphore, peak = `SUBAGENT_FILE_CONCURRENCY` | — |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The residual risk is the page-wide `coverage:
  'partial'` over-attribution for legacy-layout sessions (Moderate, above) —
  a UX/precision cost, not a correctness defect, and it is the documented,
  deliberate trade-off the fix report chose over the alternative (silently
  under-reporting coverage as `'complete'`, which the original review flagged
  as the worse failure mode).
- What a robust implementation would add: (1) narrow the legacy-scan
  `unreadable` attribution to sessions that could plausibly own the failed
  file, rather than every session sharing the page's legacy-file list; (2) a
  CLI paging spec that exercises an external abort mid-page-sequence, to pin
  that an abort between pages behaves the same as a rejection between pages;
  (3) the NUL-byte separator in `session-usage-ledger-cache.ts` should be
  written as an explicit escape once fixed, and the in-progress working-tree
  fix should not replace it with the literal string `"0000"`, which reopens a
  narrower version of the same collision risk the NUL byte was chosen to
  avoid.
