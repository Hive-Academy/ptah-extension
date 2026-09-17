# Code Logic Review — Batch 9 (Task 9.1)

Reviewer: code-logic-reviewer (Task 9.2), read-only, no code or spec changes made.

Scope read in full: `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts` (+ its spec),
`libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts` (+ its spec),
`libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts` (+ its unit and
integration specs), `skill-backlog-cleanup.types.ts`, `skill-synthesis/src/lib/di/register.ts`,
`thoth-runtime/src/lib/skill-backlog-cleanup-job.ts` (+ spec), `cli-engine/.../thoth-runtime.spec.ts`,
`trajectory-extractor.ts` (unchanged, read for the empty-`workspaceRoot` question), plus
`context.md`, `batches.md` Batch 9, `batch-9-report.md`.

## Verdict

CHANGES_REQUESTED

Score: 6/10

## Summary

The seam decision holds: `listSessionsDirectories` shares `projectsRoot()` with `findSessionsDirectory`
(`jsonl-reader.service.ts:194,239,282-283`), `findSessionsDirectory` is byte-for-byte unchanged, skill-synthesis
production carries no `.claude`/`projects` literal (`grep -rn "\.claude" libs/backend/skill-synthesis/src`
returns only an unrelated doc-comment in `skill-promotion.service.ts:166`), the locator port method is
optional and detected structurally, DI registration is present and ordered correctly
(`di/register.ts`: `SessionTranscriptLocator` registered before `SkillBacklogCleanupService`), and the
A9/A10/A12 precedence rules are implemented exactly as specified and are covered by real tests including
two full mutation kills (9.1-mutA, 9.1-mutC). The counter identity is honoured: `rejectedNoTranscript` is
folded into `rejectedTranscriptUnreadable` via `countDisposition` (`skill-backlog-cleanup.service.ts:483-488`)
and never added a second time.

One correctness gap survives every layer of testing and is a direct hit on the property the batch's own risk
register asked 9.1 to defend: **an existing-but-empty `~/.claude/projects` (a real `readdir` success that
returns zero child directories) is misclassified as "searched everywhere, found nothing" and rejects every
root-unknown candidate, instead of being treated as "the lookup could not usefully run."**

## Five logic questions

### 1. How does this fail silently?

`SessionTranscriptLocator.createRunLookup().locate` (`session-transcript-locator.ts:81-128`) treats a
**successful** `listSessionsDirectories()` call that resolves to `[]` identically to a normal search that
covered real folders and matched nothing: `sessionDirectories === null` is false for `[]`, so the `for`
loop over `sessionDirectories` executes zero times, `unavailable` stays `false`, and the function returns
`{ kind: 'absent' }` with `pathStats` unmoved — for every session id, on every call, for the rest of the run
(the `[]` listing is cached in `directories` at `:56-77` and never re-fetched). In `evaluateCandidate`
(`skill-backlog-cleanup.service.ts:350-379`) that becomes `found = false`, `unavailable = false` for every
source session, so the candidate is rejected with `REJECT_NO_TRANSCRIPT` — a caller reading the run report
sees a normal `reject-no-transcript` count and a completed run; nothing distinguishes "we checked 41 real
folders and the id was in none of them" from "the search had nothing to search." That is exactly the
`false-positive absent` shape review-focus item 1 asked to rule out ("Listing failure, empty listing (zero
folders: is that absent or unavailable? — a machine with no transcript root must NOT reject everything")
and it is not ruled out: it is silently wrong in the opposite direction of every other guard in this file.

### 2. What user action produces unexpected behaviour?

None triggered by a user action directly — this runs on the hourly cron job. The nearest analogue: an
operator who runs the cleanup on a machine (or CI-style throwaway home directory) where `~/.claude/projects`
exists but is empty — e.g. a fresh profile, a directory recreated by other tooling before any session ran, or
a `.claude/projects` whose children were pruned by an external retention job — will see every root-unknown
candidate permanently rejected with `backlog-cleanup: no transcript found for any session` on the first pass,
even though the correct, user-approved behaviour ("The lookup must never reject when it could not run") calls
for `kept-root-unknown` there. Because the cleanup is one-time and cursor-advancing
(`skill-backlog-cleanup.service.ts:257-269`), those rows are marked `rejected` in SQLite and the cursor moves
past them; there is no automatic re-evaluation once real session folders reappear.

### 3. What input data produces a wrong answer?

The empty-array listing above is the concrete case. A second, narrower variant: a `sessionId` that resolves to
a directory instead of a file only in the FIRST folder checked, while a real file exists in a later folder —
this is handled correctly (`isFile()` check at `:107`, loop continues to the next folder), so it is not a
finding, but it demonstrates the loop's precedence is otherwise sound; it makes the all-absent-on-empty-array
case stand out as the one branch that was not defended the same way.

### 4. What happens when a dependency fails?

Verified as sound for the failure classes this batch enumerated: agent-sdk's `listSessionsDirectories`
returns `null` on an absent root (`ENOENT` via `readdir` throwing) and on any other `readdir` failure
(`jsonl-reader.service.ts:193-209`), which the locator treats as `unavailable` (`:63-67, 95-99`) — correctly
mapped to `kept-root-unknown`, never a rejection. A non-`ENOENT`/`ENOTDIR` `stat` failure (e.g. `EBUSY`) is
remembered and yields `unavailable` unless a later folder hits (`:115-120`, proven by both the locator spec's
EBUSY case and mutation `9.1-mutC`). A reader missing the optional method entirely also degrades to
`unavailable` (`:63-64`, spec `session-transcript-locator.spec.ts:83-94`). The one dependency-response shape
that is NOT a failure — a clean, successful, zero-length listing — is exactly the one not defended (see Q1).

### 5. What is missing that the requirements never mentioned?

- No test anywhere in this batch drives `listSessionsDirectories` to resolve `[]` (grepped every
  `listSessionsDirectories:` fixture across the locator spec, the service spec and the integration spec —
  every fixture is either a real temp-dir array with ≥1 entry, `null`, or a reader with the method omitted).
  The plan's own edge-case list (batches.md "Edge cases" under Batch 9) does not name this case either, so it
  is a genuine gap in the plan the reviewer is asked to catch, not a deviation from an explicit acceptance
  criterion.
- Case-insensitive/normalized session-id matching on Windows (NTFS is case-insensitive by default) is
  unexercised, but is a low-risk gap: `path.join` + `fs.stat` naturally resolve case-insensitively on Windows
  and the extractor's own file access has the same property, so this is not a new risk introduced by 9.1.
- A symlinked session folder (a child of the projects root that is a symlink to a directory) is filtered by
  `entry.isDirectory()` on the `Dirent` (`jsonl-reader.service.ts:198`), which is `false` for a symlink unless
  `withFileTypes` resolves it — Node's `fs.Dirent.isDirectory()` does NOT follow symlinks, so a symlinked
  project folder is silently excluded from every listing. This is a pre-existing characteristic of `readdir`
  with file types generally (not introduced by this batch) and is unlikely to matter for `~/.claude/projects`,
  whose children are created by the Claude CLI itself, not symlinked — noted for completeness, not scored as a
  finding.

## Failure modes

### Empty-but-real transcript root is treated as "searched, nothing found" instead of "could not run"

- Trigger: `~/.claude/projects` exists and `fs.readdir` succeeds with zero directory entries (fresh profile,
  externally pruned history, or a throwaway home directory used for a measurement run).
- Symptom: every root-unknown candidate whose source sessions are all unresolvable is rejected with
  `backlog-cleanup: no transcript found for any session` and the row is permanently marked `rejected` in
  SQLite, contradicting the binding rule "The lookup must never reject when it could not run."
- Evidence: `libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts:94-127` (the `for`
  loop over an empty array falls through to `unavailable ? … : 'absent'` with `unavailable` still `false`);
  consumed at `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:350-379`.
- Current handling: none — the branch is reachable and untested; no code path in the locator distinguishes
  "listing had zero entries" from "listing had entries and none matched."
- Fix: in `createRunLookup`, treat a successfully-loaded-but-empty directory list the same as "cannot usefully
  search" — either special-case `sessionDirectories.length === 0` to short-circuit to `unavailable` before the
  loop, or (equivalently and more informative) have `listSessionsDirectories` return `null` when it lists zero
  child directories, since agent-sdk already uses `null` as "no session history here" for the sibling
  `findSessionsDirectory` API for the analogous case (`jsonl-reader.service.ts:242-253`, "Projects directory
  does not exist"). Add a locator spec case: `listSessionsDirectories: async () => []` → `locate()` resolves
  `{ kind: 'unavailable' }` with `pathStats: 0`, and a service-level case asserting `keptRootUnknown: 1,
  rejectedNoTranscript: 0` for an empty listing.

## Blocking issues

None. The defect above rejects data rather than corrupting or losing already-kept data, and it requires a
specific (if plausible) environment condition rather than firing on the documented corpus shape (41 non-empty
folders per `context.md`/A13). It is scored as Serious, not Blocking, because the currently-measured corpus is
not empty and the next task (9.3, re-measurement) runs against the live, non-empty `~/.claude/projects` — but
the very purpose of this path is other machines' data, and "must never reject when it could not run" is a
user-stated hard constraint this branch violates outright when it is hit.

## Serious issues

### Empty listing rejects instead of keeping (see Failure modes above)

- File: `libs/backend/skill-synthesis/src/lib/cleanup/session-transcript-locator.ts:94-127`
- Scenario: `~/.claude/projects` exists with zero subdirectories at the time the run's one listing is taken.
- Impact: candidates that should stay `keptRootUnknown` for later re-evaluation are permanently rejected with
  a rejection reason that is documented to mean "we looked in every folder and it wasn't there," which is
  false in this branch — nothing was looked in.
- Fix: as above.

## Moderate and minor issues

- **Debug-only lookup stats leave R-TL15 unobservable outside a debug logger.** The `finally` block
  (`skill-backlog-cleanup.service.ts:289-294`) logs `transcriptLookup.stats()` once per `execute()` call at
  `debug` level only; 9.3's byte-copy re-measurement plan (batches.md) reads these via "a proxy around
  `createRunLookup`" rather than the log line, so this is not blocking 9.3, but a `debug`-level log is easy to
  lose in production if a future on-call investigation needs it without re-instrumenting. Minor.
- **`evaluateCandidate`'s shared `readable` flag between the root loop and the lookup loop is correct but
  fragile.** It relies on the invariant "the lookup loop only runs when `attempted` is `false`, which implies
  `readable` was never set" (verified true by inspection at `:317-349`), but nothing enforces that invariant
  structurally — a future edit that adds another way to set `readable = true` before the lookup loop (e.g. a
  new source of transcripts) would silently corrupt the A12 precedence with no compiler or type-level warning.
  Minor; consider a locally-scoped `let lookupReadable = false` for the second loop to make the two phases
  independent in the code, not just in current call order.

## Data flow

1. `run()` reads config, checks skip gates (disabled/complete/boot-deferral/battery/foreground/aborted) — OK,
   unchanged from Batch 8.
2. `execute()` creates ONE `transcriptLocator.createRunLookup()` per run (`:173`) — OK, matches R-TL15's "one
   listing per run" via the locator's own internal `loadDirectories` memo, not a second cache here.
3. Each candidate: verdict check (unchanged) → root-resolution loop (`attempted`/`readable`, A9 unchanged) →
   `sourceSessionIds.length === 0` guard (A10, OK) → by-id lookup loop (A11/A12) — OK for every branch except
   the empty-listing case documented above.
4. Rejections are batched and written via `store.rejectBatch` (unchanged mechanism, new reason string) — OK,
   `REJECT_NO_TRANSCRIPT` is a distinct literal, not reused from Batch 8's `REJECT_UNREADABLE`.
5. Counters: `countDisposition` folds `reject-no-transcript` into the same persisted bucket as
   `reject-unreadable` (`:483-488`) — OK, matches the counter-identity decision documented in
   `skill-backlog-cleanup.types.ts:27-47` and the integration spec's exact-count assertions
   (`skill-backlog-cleanup.integration.spec.ts:198-209`).
6. Cursor advances once per page regardless of disposition (`:257-269`) — OK, `deferred-error` and
   `kept-root-unknown` candidates are not silently skipped from cursor progression.
7. Job summary (`thoth-runtime/.../skill-backlog-cleanup-job.ts:80-88`) appends `, no transcript N` from
   `report.rejectedNoTranscript` — OK, matches the spec fixture in `skill-backlog-cleanup-job.spec.ts`.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| A9 — lookup runs only after root loop makes no attempt | COMPLETE | none found |
| A10 — empty `sourceSessionIds` stays `kept-root-unknown`, lookup never called | COMPLETE | verified by test `skill-backlog-cleanup.service.spec.ts` and by reading the guard order |
| A11 — three "cannot run" causes → `unavailable`, never `absent`; unsafe id → `unavailable`, zero I/O | PARTIAL | the three enumerated causes (missing method, `null`, non-ENOENT/ENOTDIR stat error) are correctly `unavailable`; a fourth, unenumerated but real cause — a successful, empty listing — is NOT `unavailable`, it is `absent`/rejected |
| A12 — outcome precedence (evidence > no-evidence > unreadable > unavailable > absent) | COMPLETE | precedence itself is implemented exactly to spec; the input to it can be wrong per A11's gap |
| A13 — measurement caveat only, no code obligation | N/A | — |
| Hexagonal seam (no path literal, optional port, uncached reader method, extractor untouched) | COMPLETE | verified by grep and by reading `trajectory-extractor.ts` (unchanged) |
| DI registration + resolvability in both hosts | COMPLETE | `register.ts` registers `SessionTranscriptLocator` before `SkillBacklogCleanupService`; both are singletons resolved from the same container |
| Counters: `rejectedNoTranscript` subset, not double-counted, cron summary | COMPLETE | verified in `countDisposition`, `runCounters`, and `summarizeCleanup` |
| Mutations 9.1-mutA/B/C fail for the stated reason | COMPLETE for mutA/mutC (verified by re-deriving the code paths they target); mutB (cache-hit bypass) plausible from the report's described "never-true cache condition" but not independently re-run by this reviewer | mutB not independently reproduced; report evidence (cache hits 0 instead of 1) is internally consistent with the cache implementation at `:81-86` |
| Non-vacuous specs (real temp dirs, cleaned up) | COMPLETE | `session-transcript-locator.spec.ts` uses `fs.mkdtempSync`/`fs.rmSync` in `afterEach`, real files, real `fs.stat` |

Implicit requirement not addressed: an existing-but-empty transcript root must be treated the same as an
absent one for the purpose of "never reject when the lookup could not run" — see Failure modes.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Root unknown, found in a later folder, evidence | YES | `session-transcript-locator.spec.ts` "finds a file in the second folder" + service spec `'keeps evidence found through the by-id transcript lookup'` | none |
| Root unknown, found, no evidence / unreadable | YES | service spec `it.each` at `:333-360` | none |
| Root unknown, every session absent (non-empty listing) | YES | service spec `'rejects with the distinct reason when every source transcript is absent'` (`:362-380`) | none |
| Root unknown, listing `null` (reader absent/errors) | YES | integration spec "keeps a root-unknown candidate when directory listing is unavailable" (`:265-320`) | none |
| Root unknown, listing succeeds with **zero** folders | NO | not present in any spec | this is the finding above |
| `<sessionId>.jsonl` exists as a directory | YES | locator spec "does not treat a matching directory as a transcript file" | none |
| Two candidates sharing a session id, one run | YES | service spec "uses one run lookup and its cache for candidates sharing a session id" + locator spec "caches a session result within one run lookup" | none |
| Unsafe session id (`../x`, `a/b`, `a\b`, `''`) | YES | locator spec `it.each` at `:121-130`, zero I/O asserted | none |
| Any session with a resolved root | YES | service spec asserts `locate` not called when a root resolves | none |
| `extract(sessionId, '', floor, foundPath)` with empty workspaceRoot | YES | traced through `trajectory-extractor.ts:153-155` (path taken verbatim) and `:392-393` (`compileWorkspacePattern('')` returns `null`) | none — confirmed safe by reading, not merely asserted by the plan |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: an existing-but-empty `~/.claude/projects` silently converts "the lookup could not usefully run"
  into "searched everywhere, found nothing," rejecting data the user's binding decision explicitly protected
  ("The lookup must never reject when it could not run").
- What a robust implementation would add: (1) treat a zero-length successful listing as `unavailable` in
  `SessionTranscriptLocator` (or have `listSessionsDirectories` return `null` for that case, mirroring
  `findSessionsDirectory`'s existing "absent root → null" convention); (2) a locator spec and a service spec
  case for the empty-listing input; (3) since this is a one-round revise, no other structural changes are
  needed — the rest of the batch (seam, DI, counters, precedence for every OTHER input) is correct and well
  tested.
