# VERDICT: FAIL

Scoped fail. Items 1–6, 9, 10, 11 (the four spec documents, the drain script and its
spec) are **clean** and would pass on their own. Items 7 and 8 — the `agent-sdk`
backoff change and the `sdk-query-options-builder.ts` threading that goes with it —
ship a mechanism that **does not do what `coderabbit-response.md` says it does**, add
a new duplicate-report path of their own, and land with **zero** test coverage on a
service that has **zero** existing coverage.

Note on state: the work was committed mid-review as `3901e9077`
("fix(agent-sdk): dedupe mcp failure reports and read stderr as a stream"). All
evidence below is read from the committed tree; line numbers are post-commit.

---

## 1. HIGHEST RISK — stderr buffering, clearing, and the regex

### 1a. Unbounded growth: NO. The buffer is bounded.

`mcp-server-backoff.service.ts:63-64` declares `stderrBuffer = ''` with
`MAX_STDERR_BUFFER_LEN = 16_384`. Three independent ceilings apply:

- `:174-178` — hard clamp to the last 16,384 chars on every call, before the scan.
- `:194-196` — on any newline anywhere in the buffer, everything up to and including
  the last `\n` is dropped.
- `:199-201` — belt-and-braces: no newline and no match, and length > 2048 → keep the
  last 512 chars.

A stream that never emits a newline cannot exceed 16 KB. **Not a leak.** PASS.

### 1b. Cleared on server removal / session end: NO. This is a real gap.

`clear()` at `:238-246` resets `stderrBuffer = ''`, but only on the
no-argument branch — `clear('serverName')` at `:240-241` deletes the record and
leaves the buffer intact. More importantly, **`clear()` has no caller anywhere in
the repository**: a workspace-wide grep for `McpServerBackoffService` /
`clearBackoff` / `clear(` against this service returns only
`libs/backend/agent-sdk/src/index.ts:151`, `di/register.ts:59,421`,
`helpers/index.ts:81` and `sdk-query-options-builder.ts:59,728,996` — all wiring, no
invocation. There is no session-end hook and no `recordSuccess` path that touches the
buffer (`:150-159` clears the record only).

The service is a **process-wide singleton** (`di/register.ts:418-422`,
`Lifecycle.Singleton`), and every session's `stderr` callback
(`sdk-query-options-builder.ts:994-1000`) appends into that one buffer. Consequences:

- **Cross-session interleaving.** With two concurrent sessions, session A's incomplete
  tail is prepended to session B's next chunk. The newline trim at `:194-196` then
  discards A's tail on B's behalf — which reintroduces the exact chunk-boundary miss
  this fix exists to remove, under the one condition (concurrency) the product is
  built for.
- **Spliced false positives.** A tail ending `"tavily ("` plus a following chunk
  beginning `"CONNECT_TIMEOUT)"` from a different session forms a match for a failure
  that never happened for that server, and a 60 s→30 min suppression follows.
- **Stale carry-over.** A dead session's tail sits in the buffer indefinitely and is
  prepended to the first chunk of the next session.

Severity: **Serious.** Not memory, but correctness across sessions.

### 1c. Global regex `lastIndex`: NO bug. PASS.

`:180` constructs a **fresh** object each call —
`new RegExp(STDERR_MCP_FAILURE_PATTERN.source, 'gi')` — rather than mutating the
module-level `STDERR_MCP_FAILURE_PATTERN` (`:51-52`, which is `/i` and *not* global).
`lastIndex` therefore starts at 0 on every invocation and cannot skip matches. The
classic stateful-global-regex trap was avoided. This is the one part of the change
that is unambiguously right.

### 1d. NEW defect introduced: the retained tail is re-matched.

`:185-192` scans, then `:194-196` trims to after the **last newline in the whole
buffer** — which may be *before* the match. Trace:

- chunk 1 = `"starting\nfirecrawl (CONNECT_TIMEOUT)"` → match → `recordFailure('firecrawl')`.
  `lastNewlineIdx` = 8 (the `\n` after `starting`) → buffer keeps
  `"firecrawl (CONNECT_TIMEOUT)"`.
- chunk 2 = `": connection timed out after 30000ms\n"` → buffer is now
  `"firecrawl (CONNECT_TIMEOUT): connection timed out after 30000ms\n"` →
  **matches again** → `recordFailure('firecrawl')` a second time for one event.

The `else if (lastMatchEnd > 0)` branch at `:197-198` was clearly meant to cover this,
but it is unreachable whenever a newline exists anywhere earlier in the buffer. So the
buffering fix **creates** a duplicate report, which is then hidden by the 10 s cooldown
from the other fix. The two fixes are load-bearing for each other in a way neither
comment asked for and neither is tested.

### 1e. Behaviour change in the return value.

`:203` returns the first server matched in the **buffer**, not in `data`. A caller could
receive a server name recovered from a previous chunk's tail. Impact today is nil —
`sdk-query-options-builder.ts:996-1000` discards the return value — but the documented
contract at `:162-164` and the reality diverge.

---

## 2. The 10-second cooldown

**The `attemptKey` branch is inert for the duplicate it was written to suppress.**

`:110-112`:

```ts
const isSameAttempt =
  (attemptKey !== undefined && existing?.lastAttemptKey === attemptKey) ||
  (existing !== undefined && now - existing.lastFailedAt < 10_000);
```

The two report sources supply keys from **different namespaces**:

- init/`servers` path: `:86` passes `event.sessionId`, which
  `stream-transformer.ts:424-432` sets to `realSessionId` — the SDK UUID.
- stderr path: `sdk-query-options-builder.ts:995` passes
  `sessionIdResolver?.() ?? routingId`, and `:830` defines
  `routingId = sessionConfig?.tabId ?? sessionId`. A `CONNECT_TIMEOUT` line is written
  by the CLI *during startup*, before the init message carries the SDK UUID, so the
  resolver is still empty and the key is the **tabId**.

Same connection attempt, two different keys → `existing.lastAttemptKey === attemptKey`
is false → **the first clause never fires for the cross-source duplicate**. 100 % of the
dedup work in the scenario CodeRabbit raised is done by the wall-clock clause.

`coderabbit-response.md:15` claims fix #7 works by "`lastAttemptKey` tracking and a
10-second deduplication cooldown"; the commit message claims the same. The
`lastAttemptKey` half is decorative. **The deliverable's own description of the fix is
inaccurate.**

**Can two genuinely distinct failures inside 10 s be collapsed? Yes.** The second clause
at `:112` is an unconditional `||` — it fires *even when `attemptKey` is present and
different*. Two separate attempts on the same server 3 s apart produce `failureCount`
1, not 2, so `duration` at `:119-125` stays at `initialBackoffMs` (60 s) instead of
escalating to 120 s. The exponential escalation the service exists for is weakened by
exactly the amount the heuristic over-suppresses. In practice, cross-session retries
are minutes apart and escalation still works, so this is **Serious, not Blocking** —
but it is a real, unintended behaviour change.

One mitigating detail, correctly done: `:114-116` returns **before** updating
`lastFailedAt`, so the window is fixed from the last *counted* failure, not rolling. A
storm of reports cannot extend the suppression indefinitely.

**Would a non-time key have been correct? Yes** — but it needs both halves fixed:

```ts
const isSameAttempt =
  attemptKey !== undefined && existing?.lastAttemptKey !== undefined
    ? existing.lastAttemptKey === attemptKey
    : existing !== undefined && now - existing.lastFailedAt < 10_000;
```

i.e. key equality when both sides have a key, time window only as the fallback — plus
a shared key namespace, so the stderr path and the init path both report the routing
id (or both the SDK UUID). As shipped, `:135`
(`...(attemptKey ? { lastAttemptKey: attemptKey } : {})`) also *drops* a previously
stored key when a keyless failure arrives, so a later keyed report cannot match it.

**Can it be defeated by a slow failure? Yes.** If the stderr notice and the init
`servers` report for one attempt land more than 10 s apart — plausible for a
30,000 ms `CONNECT_TIMEOUT`, where the CLI may emit the stderr line at timeout and the
init summary later — the keys differ (see above) and the window has expired, so the
single attempt is counted **twice** and the backoff doubles. The original defect is
unfixed on exactly the slow path that motivated it.

---

## 3. The liveness stub in `drain-observation-queue.spec.ts` — PASS

Scrutinised as instructed. It holds.

**Confined to the test:** `drain-observation-queue.ts:1022-1025` makes the checker an
**optional parameter with the real function as its default**
(`livenessChecker: LivenessChecker = collectLivenessFindings`). The production entry
point at `:1251-1252` is `main(process.argv.slice(2))` — one argument. There is no CLI
flag, no env var and no export that lets an operator supply a stub. The only two call
sites passing a second argument are `drain-observation-queue.spec.ts:486-489` and
`:508-511`. **Unreachable in production.** PASS.

**Cannot point at a live database:** both stubbed tests call `assertIsFixture(dbPath)`
immediately before `main` (`spec.ts:484` and `:506`). `assertIsFixture`
(`spec.ts:67-76`) throws unless the path resolves under `os.tmpdir()` and throws again
if it contains a `.ptah` path segment.

**Interlocks are NOT all disabled by the stub.** `recheckBeforeDelete` is called
directly at `drain-observation-queue.ts:1183`, is **not** injectable, and runs
unstubbed between the backup and the first DELETE. It performs `targetsLiveDatabase`
+ `probeWriteLock` + `findLockfiles` + `inspectProcesses` (`:607-612`). So even in the
stubbed tests, a live or write-locked target would still be refused at `:1184-1195`
before a single row is deleted. The stub removes the *pre-flight* gate, not the
*pre-delete* gate.

**No blocking coverage was removed.** The diff deletes no `it()` block. Every test that
proves the interlocks BLOCK is intact and untouched:

- `spec.ts:168` — "reports a blocking finding while a second connection holds
  BEGIN IMMEDIATE"
- `spec.ts:182` — "is a probe and not a constant — it clears again once the lock is
  released"
- `spec.ts:214` — "sees through a junction/symlink"
- `spec.ts:236` — "is not constant: a different real file is not the live database"
- `spec.ts:242` — "fails closed: an unresolvable path on either side counts as live"

These exercise `probeWriteLock` / `targetsLiveDatabase` as units, so the blocking path
was never reached *through* `main` in the first place. The two stubbed tests asserted
`exit 0` both before and after — they proved the interlocks **pass** on a fixture, not
that they block.

**Standing gap (pre-existing, not a regression):** `main`'s `blocking.length > 0`
branch (`:1080-1104`) has no test through `main`, in either direction. Worth a test;
not a fail.

---

## 4. `process.exit(130)` on the second interrupt — PASS, with two caveats

**It cannot fire mid-transaction.** `drainBatches` (`:849-909`) is **fully synchronous**:
the `for (;;)` loop at `:859` contains no `await`, no promise and no I/O callback. The
transaction is `db.transaction(...)` executed via `run.immediate()` at `:891` — a
synchronous better-sqlite3 call in which `BEGIN IMMEDIATE`, the `DELETE` and `COMMIT`
all complete inside one uninterruptible JS turn. Node dispatches signal handlers from
the libuv event loop, which cannot preempt running synchronous JavaScript. **There is
no point at which `onSignal` — and therefore `process.exit(130)` — can execute between
`BEGIN IMMEDIATE` and `COMMIT`.** The handler runs only when the loop yields.

The single `await` in the whole destructive path is `await createBackup(db, ...)` at
`:1179`. Everything from there through `recheckBeforeDelete` (`:1183`), `drainBatches`
(`:1198`), `reclaimPages` (`:1204`) and `db.pragma('wal_checkpoint(TRUNCATE)')`
(`:1216`) runs in one synchronous continuation. So the handler can only fire **during
the backup**, where the source database is untouched (`db.backup()` copies out).
Exiting there cannot corrupt the source. PASS on the stated question.

**First interrupt still drains gracefully.** `:1111-1121`: `signalCount += 1`; the
`> 1` escalation is guarded; the first call falls through to `interrupted = true` and
the original "finishing the current batch, then stopping" warning. `drainBatches`
honours it via `isInterrupted()` at `:860-862` and `main` returns `2` at `:1232`. PASS.

**Caveat A (moderate, largely pre-existing).** Because `drainBatches` never yields, the
new escape path is unavailable during the drain itself — the phase an operator is most
likely to want out of. Two Ctrl+C presses during a long synchronous drain may also be
coalesced by libuv into one handler invocation, leaving `signalCount === 1`. The escape
works during the backup and nowhere else. The commit message's claim that this "gives
operators an escape path" is broader than what shipped.

**Caveat B (moderate).** `process.exit(130)` bypasses the `finally` at `:1233-1237`, so
`db.close()` is skipped and a **partial, unverified backup file is left on disk** with
no cleanup. `verifyBackup` (`:773-814`) never ran on it. The next run picks a fresh
timestamp (`:739-744`) so there is no collision, but an operator can later restore from
a truncated file that looks like a valid backup. Writing to a `.partial` name and
renaming on success would close this.

---

## 5. Regression check on `drain-observation-queue.ts` — ALL SIX HOLD

| Property | Status | Evidence |
| --- | --- | --- |
| `processed_at IS NOT NULL AND processed_at < @cutoff` on the SELECT | PASS | `:827-830` `SELECT_BATCH_SQL` |
| Same predicate on the DELETE | PASS | `:837-840` `DELETE_BATCH_SQL`, re-checked independently of the id list |
| No bare `VACUUM` | PASS | Only `PRAGMA incremental_vacuum` via `reclaimPages` (`:919-940`); `:938` explicitly refuses to fall back to `VACUUM`. No `db.exec('VACUUM')` anywhere |
| `--force` gates only `createBackup`, no interlock | PASS | `:1174-1180` — the sole `options.force` branch wraps `await createBackup`. `livenessChecker` (`:1059`) and `recheckBeforeDelete` (`:1183`) run regardless |
| `targetsLiveDatabase` uses `fs.realpathSync.native` on both sides, TRUE when either is unresolvable | PASS | `:508-518` `normaliseRealPath` uses `fs.realpathSync.native` and returns `undefined` on throw; `:520-527` `if (target === undefined \|\| live === undefined) return true` |
| Backup byte-size AND `PRAGMA quick_check` before the first DELETE | PASS | `verifyBackup` `:773-796` (size at `:775-786`, `quick_check` at `:791-796`) is called inside `createBackup` at `:750`, which is awaited at `:1179` — upstream of `drainBatches` at `:1198` |

No regression. The only edits to this file are the `LivenessChecker` export
(`:567-570`), `collectLivenessFindings` becoming exported (`:572`), the `main`
parameter (`:1022-1025`), the call-site swap (`:1059`) and the signal counter
(`:1114-1118`). Nothing touches the delete path.

---

## 6. The four `.ptah/specs` documents — ACCURATE

### `TASK_2026_482_d4a8/context.md:64-71` — the `runOutsideAngular` claim: **TRUE**

The claim is that running the interval and signal writes outside `NgZone` was rejected
because `ChangeDetectionSchedulerImpl` still schedules `ApplicationRef._tick()` for
dirty signal consumers. Verified against this codebase, not merely plausible:

- `apps/ptah-extension-webview/src/app/app.config.ts:117` —
  `provideZoneChangeDetection({ eventCoalescing: true })` with **no
  `ignoreChangesOutsideZone`**. Angular's hybrid scheduler is therefore active, and a
  signal write notifies `ChangeDetectionSchedulerImpl` regardless of which zone
  performed it. `runOutsideAngular` suppresses the *zone* tick, not the *signal*
  notification. The stated reason is the correct mechanism.
- The shipped component matches the description exactly.
  `libs/frontend/chat-ui/src/lib/atoms/streaming-quotes.component.ts`: the template
  span carries **no binding** (`#textElement ... ></span>`); the interval runs inside
  `this.ngZone.runOutsideAngular(...)`; `renderText` writes
  `this.textElement().nativeElement.textContent = text` directly. Both halves — "runs
  the interval outside NgZone" **and** "writes directly via textContent" — are true of
  the shipped file. No signal remains.

The one thing I cannot verify from the repository is the word "**tested**" — there is
no recorded experiment. The *conclusion* is correct for this configuration, so this is
a provenance nit, not a rationalisation. ACCEPT.

### `TASK_2026_480_c2d8/renderer-analysis.md:307-315` — **TRUE**

Asserts both tickers are root singletons. Verified:
`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:258` and
`libs/frontend/chat-streaming/src/lib/background-agent.store.ts:71` are both
`@Injectable({ providedIn: 'root' })`. The edit correctly demotes the old
"1 Hz × 7 sessions = 7 CD passes" figure to "unverified hypothetical scaling" and
keeps the verdict ("confirmed as a bug, refuted as the cause") unchanged. Honest
correction — it makes the document's own earlier arithmetic look worse, which is the
right direction for a self-correction.

### `TASK_2026_483_6f21/round-2-report.md` — **FIXED, and complete**

All six `â€”` mojibake sequences replaced with `—`. Verified by grep: zero `â€`
occurrences remain in the file. Only the corrupted bytes changed; no prose altered.

### `TASK_2026_481_7b0f/implementation-plan.md` — ACCEPT

Prescriptive future-design prose (worker protocol, `writeCounter`, read-only
connection exception). Nothing to check against shipped code because none of it ships
in this branch. Internally consistent and responsive.

**One residual:** `coderabbit-response.md` is itself the **only** file under these four
task folders still containing `â€` mojibake — the document that announces the mojibake
fix has mojibake in it. Cosmetic.

---

## 7. Forbidden-list compliance — CLEAN, but `sdk-query-options-builder.ts` was not necessary

`git show --stat 3901e9077` — nine files, in full:

```
.ptah/specs/TASK_2026_480_c2d8/renderer-analysis.md
.ptah/specs/TASK_2026_481_7b0f/implementation-plan.md
.ptah/specs/TASK_2026_482_d4a8/context.md
.ptah/specs/TASK_2026_483_6f21/coderabbit-response.md
.ptah/specs/TASK_2026_483_6f21/round-2-report.md
libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts
libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
scripts/drain-observation-queue.spec.ts
scripts/drain-observation-queue.ts
```

Not one entry under `apps/ptah-electron`, `libs/backend/platform-cli`,
`libs/backend/platform-electron`, `libs/backend/platform-core`, `libs/frontend/**`,
`jest.preset.js`, `nx.json`, `.github/workflows/ci.yml` or
`libs/backend/memory-curator`. The SKIPPED item 9 correctly left
`retention-run-budget.ts` untouched. **PASS.**

### Was editing `sdk-query-options-builder.ts` necessary? **No.**

Two changes there, at `:994-1022`:

1. **Threading `noticeSessionId` as `attemptKey`** — this is the change that item 2
   shows to be inert for its stated purpose. The key it supplies (`tabId`/routing id)
   cannot equal the key the init path supplies (SDK UUID), so it never matches the
   cross-source duplicate. The stderr fix in `mcp-server-backoff.service.ts` compiles,
   runs and behaves **identically** without this argument, because `attemptKey` is
   optional (`:169`) and the 10 s clause is doing all the work. Unnecessary edit to a
   file outside the assignment, and it bought nothing.
2. **Hoisting `noticeSessionId` and folding the guard into `if (notice && noticeSessionId)`**
   — behaviour-preserving refactor of the *notice* path, which has nothing to do with
   MCP backoff. It also now calls `sessionIdResolver?.()` on **every** stderr chunk
   instead of only when a notice classifies. Harmless, but unrelated scope creep in a
   1,000+ line file the agent was not asked to touch.

Verdict on 7: the hard forbidden list is respected. The soft boundary was crossed for
no benefit.

---

## Additional finding: zero test coverage, and the claim about it

`McpServerBackoffService` has **no spec file**. `ls libs/backend/agent-sdk/src/lib/helpers/`
returns `mcp-server-backoff.service.ts` alone, and a workspace grep for
`checkStderrForFailure`, `stderrBuffer` or `lastAttemptKey` in any `*.spec.ts` returns
only unrelated `cli-agent-runtime` hits. So:

- The pre-existing service was untested.
- Both new behaviours — chunk-boundary buffering and attempt dedup — are untested.
- The commit message's "Verified: agent-sdk 1,984 tests pass" is true and **vacuous
  for this change**: not one of those 1,984 executes a line the commit added to this
  file. `coderabbit-response.md:25` is at least honest that nothing was run.

Every defect in sections 1d, 2 and 1e is the kind a five-line spec would have caught.
For a change whose whole subject is "we were double-counting" and "we were missing
matches", shipping with no assertion about either is the core failure.

---

## Summary table

| # | Item | Verdict |
| --- | --- | --- |
| 1 | stderr buffer bounded | PASS |
| 1 | buffer cleared per session / on removal | **FAIL** — never cleared, singleton, shared across sessions |
| 1 | global regex `lastIndex` | PASS — fresh regex per call |
| 1 | new duplicate from retained tail | **FAIL** — `:194-196` re-matches |
| 2 | 10 s cooldown correctness | **FAIL** — `attemptKey` branch inert; distinct failures <10 s collapsed; slow failure >10 s still double-counts |
| 3 | liveness stub confinement | PASS — test-only, `assertIsFixture` guarded, `recheckBeforeDelete` still live, no coverage deleted |
| 4 | `process.exit(130)` transaction safety | PASS — cannot run mid-transaction; first interrupt still graceful |
| 4 | escape path usefulness / partial backup | MODERATE — works only during backup; orphan unverified backup |
| 5 | six regression properties | PASS — all six |
| 6 | four spec documents | PASS — 482 claim verified true against `app.config.ts:117` and the shipped component |
| 7 | forbidden list | PASS |
| 7 | `sdk-query-options-builder.ts` necessity | **FAIL** — unnecessary; delivers a key that cannot match |
| — | test coverage for items 7 & 8 | **FAIL** — zero |

## Required before this merges

1. Give the stderr path and the init path a **shared key namespace** (both the routing
   id, or both the SDK UUID), or drop `attemptKey` and say plainly that the dedup is a
   time window. Either is defensible; the current state documents one and implements
   the other.
2. Make the time clause a **fallback**, not an unconditional `||`
   (`mcp-server-backoff.service.ts:110-112`), so a distinct keyed attempt inside 10 s
   still escalates.
3. Fix the tail trim at `:194-201` so a matched region is never retained for re-scan —
   trim to `max(lastNewlineIdx + 1, lastMatchEnd)`.
4. Key the buffer **per session**, or clear it on session end. A shared buffer across
   concurrent sessions is the defect this change was meant to remove, reintroduced one
   level up.
5. Add a spec for `McpServerBackoffService`: split-notice-across-two-chunks, two
   reports for one attempt, two attempts 3 s apart, two concurrent sessions.
6. Optional but cheap: write the backup to `.partial` and rename on verify, so
   `process.exit(130)` cannot leave a plausible-looking truncated backup.

Items 1–6, 9, 10 and 11 need no further work.
