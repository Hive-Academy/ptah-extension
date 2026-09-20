# VERDICT: FAIL

Scoped fail. Findings 2 (time window), 3 (trim) and most of 4 (per-session buffers,
listener hygiene, identity guard) are genuinely fixed and I can show the code that fixes
them. Finding 1 (key unification) is fixed **in the wrong direction**: unifying both
sources onto the *session-lifetime* routing id, while the equality branch deduplicates
**without any time bound**, turns the attempt key into a permanent mute for a server that
keeps failing in the same tab. Escalation past failure #1 no longer happens there, and it
did before this repair. That is a new defect, in the machinery the brief predicted it
would be in, and it defeats the service's only reason to exist.

State note: the work was committed **mid-review** as `6678637e1`
("fix(agent-sdk): make the mcp failure dedupe actually deduplicate"), same as last round.
All line numbers below are from the committed tree.

---

## 1. THE KEY UNIFICATION — mechanism resolves; the resulting key is the wrong grain

### 1a. Both named cases DO resolve. PASS on the narrow question.

**Fresh session, UUID arrives asynchronously — and the queue is the NORMAL path, not the
exception.** `stream-transformer.ts:397-399` calls `onSessionIdResolved(...)`
**un-awaited**, then publishes `mcpStatus.notifyAll({kind:'servers'})` **synchronously**
at `:424-433`. The resolve handler on the other end
(`sdk-agent-adapter.ts:937-979`) is `async` and `await`s `metadataStore.create(...)`
at `:958` **before** `sessionIdResolvedRegistry.notifyAll(...)` at `:974`. So for every
new session the `servers` event arrives first, `resolveInitAttemptKey`
(`mcp-server-backoff.service.ts:331-336`) returns `undefined`, and the failure is queued
at `:111` / `:338-355`, then flushed at `:357-367` under the routing key. Verified by
construction, and test 1 (`mcp-server-backoff.service.spec.ts:45-67`) exercises exactly
this order.

**Resumed session whose routing id is already the SDK UUID.** Two independent paths cover
it. `resolveInitAttemptKey` `:334` returns `sdkSessionId` directly when
`stderrSessions.has(sdkSessionId)` — true for a resume with no tabId, because
`session-query-executor.service.ts:118` computes `registerKey = sessionConfig?.tabId ??
sessionId` and `sdk-query-options-builder.ts:830` computes the identical
`routingId`, which is then tracked at `:923-928`. With a tabId present, the resume
callback at `sdk-agent-adapter.ts:862-882` passes that same `tabId`, and
`mcp-server-backoff.service.ts:122` computes `routingKey = tabId ?? realSessionId` — it
matches the tracked key either way. The builder's `routingId` and the executor's
`registerKey` are the same expression, so the two sides cannot drift.

### 1b. The queue is BOUNDED and mostly drained. PASS, with one lossy edge.

- Bounded: `:343-351` evicts the oldest key once `pendingInitFailures.size >=
  maxTrackedServers` (100). Not a leak.
- Drained on the ordinary paths: flushed at `:363`, deleted at `:124` when the resolve
  names an untracked routing key, deleted at `:218` when the query's abort fires.
- **Lossy edge (Serious).** If the resolve notification never arrives, the queued
  failures are never recorded at all — the backoff simply does not engage for that
  session. Two concrete ways that happens, both in shipped code:
  1. `sdk-agent-adapter.ts:947-952` returns early on a blank `realSessionId` and never
     calls `notifyAll`. Blank ids are real here — `0fa00297d` exists precisely because one
     reached the metadata store.
  2. `metadataStore.create` at `:958` is `await`ed **before** `notifyAll` at `:974`, and
     the callback is invoked un-awaited (`:945-946` says so). A rejection there silently
     disables MCP failure recording for that session. Backoff correctness should not
     depend on a metadata file write.
  Per-key arrays at `:352-354` are also unbounded (`push` with no cap); bounded in
  practice by the server count in `.mcp.json`, so Minor.
- The queue is **not** the failure case the service exists for. A session that dies before
  `init` emits no `servers` event at all, so nothing is queued, and the stderr path still
  records synchronously at `:262`. The abort at
  `session-query-executor.service.ts:370` (init-failure rollback) fires `release`
  (`:212-221`) and frees everything. No leak on that path. **PASS.**

### 1c. BLOCKING — the unified key never expires, so escalation freezes per tab.

`:146-155`: when both sides have keys, equality alone decides, with **no upper time
bound**. The key now supplied by both sources is `sessionConfig.tabId ?? sessionId`
(`sdk-query-options-builder.ts:830`, `:1006`, and the flushed init path
`mcp-server-backoff.service.ts:365`) — a **tab-lifetime** id, not a per-attempt id. A tabId
survives every query restart in that tab (resume, `chat:continue`, rewind, slash-command
re-query; CLAUDE.md's own D1 note: auto-resume runs "under the same id").

Trace, single tab, one genuinely broken server:

1. Query 1, `firecrawl` fails → `records.firecrawl = {failureCount: 1, lastAttemptKey:
   'tab-1', backoffUntil: T+60s}` (`:157-176`).
2. `T+10min`, query 2 in the same tab. Suppression is recomputed per launch
   (`sdk-query-options-builder.ts:909-910` → `:954` → `buildFlagSettings` `:387-392`), the
   60 s window is long gone, so `firecrawl` is re-enabled and fails again.
3. The report arrives with `attemptKey === 'tab-1'` again → `:148-149` equality → `:153`
   **returns `existing.backoffUntil`, a timestamp in the past**. `failureCount` stays 1,
   `lastFailedAt` is never updated, `backoffUntil` is never extended.
4. Repeat forever. The server is re-spawned on every launch, with **zero** suppression
   after the first minute, and the 1 → 2 → 4 → … → 30 min curve is never entered.

Nothing clears this: `recordSuccess` (`:189-198`) only fires on a `connected` status,
`release` (`:212-221`) touches buffers and aliases but never `records`, and `clear()`
(`:313-322`) still has **no caller anywhere** (grep over `libs` + `apps`: only
`index.ts:151`, `di/register.ts:59,421`, `helpers/index.ts:81`, and the builder's three
call sites — all wiring). The service is a process-wide singleton
(`di/register.ts:419-423`, `Lifecycle.Singleton`).

**This is a regression, not an inherited flaw.** Pre-repair (`3901e9077`), the init path
keyed on the SDK UUID (`stream-transformer.ts:427`), which is fresh for every query
launch, so step 3 above took the `>10 s` branch and escalated to `failureCount: 2`,
`120 s`. The repair removed the one source whose key changed per attempt and replaced it
with one that does not. The correct grain is per-*attempt* (routing id + a launch counter
or the launch timestamp), not per-session.

Impact: exactly the outcome the brief names — "a broken server retried forever". See §6.

---

## 2. THE TIME WINDOW — PASS

`:146-151`:

```ts
const bothReportsHaveKeys =
  attemptKey !== undefined && existing?.lastAttemptKey !== undefined;
const isSameAttempt = bothReportsHaveKeys
  ? existing.lastAttemptKey === attemptKey
  : existing !== undefined && now - existing.lastFailedAt < KEYLESS_DEDUP_WINDOW_MS;
```

Read as structure, not comment:

- Two **different** keys inside 10 s → `bothReportsHaveKeys` true → equality false → two
  failures. The unconditional `||` the last judge failed is gone. Pinned by test 2
  (`spec.ts:69-82`).
- Two **equal** keys more than 10 s apart → equality true → one failure. Pinned by test 1
  (`spec.ts:45-67`, 15 s gap).
- 10 s window reached **only** when one side lacks a key (`:150-151`,
  `KEYLESS_DEDUP_WINDOW_MS` `:49`).

The early return at `:153-155` still precedes the `lastFailedAt` write, so a keyless storm
cannot roll the window forward. `:174` still drops a stored key when a keyless report
lands, but only on the path that already counts as a new failure (>10 s), so it is inert.
Minor residual: `bothReportsHaveKeys` is what makes §1c permanent — the structure is
right, the key handed to it is not.

---

## 3. THE TRIM — PASS (but untested; see §5)

`:266-272`: `consumedThrough = Math.max(lastNewlineIdx + 1, lastMatchEnd)`, applied before
the 2048/512 fallback. My adversarial case (newline **earlier** than a complete match with
no trailing newline), which is the one the previous implementation got wrong:

- chunk 1 `"starting\nfirecrawl (CONNECT_TIMEOUT)"` → match, `recordFailure` once
  (`:262`). `lastNewlineIdx + 1 = 9`, `lastMatchEnd = 36` → consume 36 → buffer empty.
- chunk 2 `": connection timed out after 30000ms\n"` → buffer holds no server token → **no
  second match**.

Detected exactly once. Under `3901e9077`'s `if (lastNewlineIdx !== -1) … else if
(lastMatchEnd > 0) …` the newline branch won, the matched region was retained and chunk 2
re-matched — the previous judge's finding 1d. Fixed.

Split-across-boundary still works: `"earlier line\nfirecrawl (CONNECT_"` has no match, so
`lastMatchEnd = 0` and the newline term keeps the partial tail; the next chunk completes it
(`spec.ts:84-107`). No path drops a line the scan has not seen: `lastMatchEnd >
lastNewlineIdx + 1` implies no newline follows the match, so only the matched region is
discarded.

---

## 4. PER-SESSION BUFFERS AND DISPOSAL — mostly PASS, one unbounded map

- **Listener accumulation: no.** `:226` registers with `{ once: true }`, and the signal is
  **per query**, not long-lived: `session-query-executor.service.ts:116` mints a fresh
  `AbortController` per `executeQuery` and passes it into `build()` (`:271-274`), where
  `:923-928` tracks it. Controller and listener are garbage together. **PASS.**
- **State-identity check is real, traced not taken.** `release` (`:212-221`) closes over
  the `state` object created at `:210` and returns at `:213` unless
  `stderrSessions.get(trimmed) === state`. A second `trackStderrSession('tab-1', …)`
  overwrites the map entry with a *new* object, so the older query's abort compares
  unequal and returns before deleting. Test 5 (`spec.ts:127-154`) covers the
  release-then-retrack direction. Residual (Minor): when a key is re-tracked without the
  old query aborting, the old query's UUID aliases and pendings are never swept, because
  the sweep lives behind that same guard.
- **16 KB bound is per buffer.** `:246-250` clamps `state.buffer + data` on every call
  before the scan, per session key. **PASS.**
- **Total memory is NOT bounded in the number of sessions (Moderate).**
  `stderrSessions` (`:74`) has no size cap and no eviction other than the abort listener —
  unlike `records` (`pruneIfOversized`, `:369-383`) and `pendingInitFailures`
  (`:343-351`), both of which the author did bound. Teardown does abort in practice
  (`session-control.service.ts:139`, `:231`, `:351`), so the common path releases; but a
  query whose stream ends without `endSession` leaves up to 16 KB parked under its routing
  key for the life of the process. Re-tracking the same tab replaces the entry, so the
  growth is per distinct routing id, not per query. Give it the same cap the two sibling
  maps already have.

---

## 5. THE SPEC — four tests discriminate, one does not

| # | Test | Fails against `3901e9077`? | Why |
| --- | --- | --- | --- |
| 1 | `spec.ts:45-67` same attempt, both sources, 15 s apart | **YES** | Old init path keyed on `event.sessionId` (`stream-transformer.ts:427`), the test asserts key `'tab-1'`; keys differed and 15 s > 10 s → `failureCount: 2`. Genuinely discriminating, as required. |
| 2 | `spec.ts:69-82` distinct keys 3 s apart | **YES** | Old `:110-112` had an unconditional `\|\| now - lastFailedAt < 10_000` → collapsed to 1. |
| 3 | `spec.ts:84-107` split notice + "trim case" | **NO** | Chunk 1 is `"earlier line\nfirecrawl (CONNECT_"` — the match is **incomplete**, so at match time the buffer holds no newline and the old `else if (lastMatchEnd > 0)` branch consumed it identically. Old code returns `null`, `'firecrawl'`, `null` and `failureCount: 1` — **passes**. The report's claim (`backoff-repair-report.md:66-68`) that it covers "the earlier-newline/no-trailing-newline trim case" is **false**: reproducing that defect needs the newline and a *complete* match in the **same** buffer. §3's fix ships untested. |
| 4 | `spec.ts:109-125` interleaved sessions | **YES** | Old single `stderrBuffer` spliced the two; the `tab-a` call would have returned `'CONNECT_beta'`, not `'alpha'`. |
| 5 | `spec.ts:127-154` abort releases the buffer | **YES (trivially)** | `trackStderrSession` did not exist. Note it also **codifies silent loss**: `expect(getRecord('late-server')).toBeUndefined()` makes "a genuine init failure arriving after abort is discarded" the asserted contract (§1b). |

Also uncovered: the escalation curve, the 30-minute ceiling, `recordSuccess` reset, and
the §1c repeat-in-one-tab case — the case a single extra `it()` would have caught.

---

## 6. REGRESSION — the curve and the ceiling are intact; the dedup CAN suppress escalation entirely

- Curve and ceiling: `:158-164`, `min(maxBackoffMs, initial * factor^(count-1))` →
  60 s / 120 s / 240 s … capped at `DEFAULT_MAX_BACKOFF_MS` 1,800,000 ms (`:46`).
  Arithmetic unchanged by this diff. PASS.
- Success reset: `:113-114` (`status === 'connected'`) → `recordSuccess` `:189-198`
  deletes the record. PASS.
- **Suppression CAN be defeated entirely.** Per §1c, a server failing repeatedly under one
  routing key is permanently frozen at `failureCount: 1` with a `backoffUntil` in the past,
  and `getBackingOffServers` (`:293-301`, `now < record.backoffUntil`) therefore excludes
  it forever. `sdk-query-options-builder.ts:909-910` → `:954` →
  `buildFlagSettings` `:387-392` consequently stops writing it into
  `disabledMcpjsonServers` / `deniedMcpServers`, so the CLI re-spawns it on every launch —
  the orphaned-process accumulation named in this file's own header (`:5-9`). **FAIL.**

---

## 7. CONSTRAINTS — CLEAN

`git show --stat 6678637e1` — five files, in full:

```
.ptah/specs/TASK_2026_479_4e71/backoff-repair-report.md
.ptah/specs/TASK_2026_483_6f21/judge-coderabbit-fixes.md
libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.spec.ts
libs/backend/agent-sdk/src/lib/helpers/mcp-server-backoff.service.ts
libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts
```

Nothing under `scripts/`, `jest.preset.js`, `nx.json`, `.github/workflows/ci.yml`,
`libs/backend/memory-curator`, `libs/frontend/**`, `apps/**` or `libs/backend/platform-*`.
The two `.ptah/specs` entries are the repair report and the previous judge's document —
both prose, no carrier touched. Working tree is clean. **PASS.**

The `sdk-query-options-builder.ts` edit is now **justified**, unlike last round: it is what
supplies the abort signal (`:923-928`) that makes disposal possible, and it correctly
stops threading `sessionIdResolver` into backoff while keeping it for the CLI notice
(`:1021`).

---

## Required before this merges

1. **Make the attempt key per-attempt.** Routing id plus a per-launch discriminator (a
   monotonic counter or the launch timestamp), handed to `trackStderrSession` and used by
   both the stderr path and the flushed init path. Equality dedup with no time bound is
   only sound on a key that dies with the attempt. Add the test: same server, same tab,
   two query launches 10 minutes apart → `failureCount: 2`, `backoffUntil` extended.
2. **Do not lose a queued init failure when the resolve never arrives.** Either record it
   keyless (the 10 s window is the correct fallback for exactly this) after a short
   deadline, or move `sessionIdResolvedRegistry.notifyAll` **above** the
   `await metadataStore.create` at `sdk-agent-adapter.ts:958` and emit it for a blank id
   too. Today a metadata write failure silently disables the backoff.
3. **Add the trim test that actually discriminates:** one chunk containing
   `"starting\nfirecrawl (CONNECT_TIMEOUT)"`, then a second chunk completing the line —
   assert `failureCount: 1`. Test 3 as written passes against the broken implementation.
4. **Bound `stderrSessions`,** the way `records` and `pendingInitFailures` already are.
5. Optional: sweep the UUID alias on re-track, not only on abort (`:213`).

Items 2, 3 and 4 of the previous judge's list are discharged. Items 1 and 5 are not.
