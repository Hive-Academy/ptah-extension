# TASK_2026_466 — Batch 2: session identity across a tab restart

Defect 2 of `context.md`, both halves. Scope: `libs/backend/agent-sdk/**` only.

## Root cause

One tab restart, two failures, one shared cause: **nothing in `agent-sdk`
treated a re-registration of the same tab as the end of the previous process.**
Half A — the registry name is `ptah-<workspace>-<role>-<suffix>` and the suffix
was `routingId.slice(0, 6)` (`sdk-query-options-builder.ts:1051`, before this
change), where `routingId = sessionConfig.tabId ?? sessionId`
(`sdk-query-options-builder.ts:804`). The tab id survives a restart unchanged,
so tab `03497c14-…` produced the suffix `03497c` for every process it ever
started, and pids 2368 and 17564 both registered
`ptah-ptah-extension-clear-merged-worktrees-and-tasks-03497c`. Half B —
`SessionQueryExecutor.executeQuery` registers under `registerKey =
sessionConfig.tabId` (`session-query-executor.service.ts:118-127`) and
`SessionRegistry.register` did `this.byTabId.set(tabId, rec)` over whatever was
there (`session-registry.service.ts:162`, before this change). The displaced
record was dropped from `byTabId` with its SDK query still running, its
`AbortController` never fired, and its `bySessionId` entry left behind — so pid
2368 stayed alive, kept its name, and kept streaming. When its own init reached
`SdkAgentAdapter.createSessionIdCallback`, `bindRealSessionId` correctly refused
the rebind (`session-registry.service.ts:202-207`, before this change) and then
the adapter announced the refused id anyway: the `emitSessionIdResolved` and
`notifyAll` calls sat AFTER the bind with no dependency on its result
(`sdk-agent-adapter.ts:955-975`, before this change). That is the pair of log
lines in the incident, and it is why every CLI agent linked to `16434295-…`
disappeared from the strip.

**Is the "ignoring" branch still the right rule?** Yes, and it is now reachable
only in the case it was written for. The set-once invariant protects a live
record from having its identity moved under it. What was wrong was not the
refusal but its silence: a refusal that only logs lets every consumer downstream
act on the value the registry just rejected. Two changes make the branch precise
instead of merely conservative. A restart now displaces the old record, so the
new process meets a record whose `realSessionId` is `null` and binds normally —
the branch is no longer the restart path at all. And a caller that can PROVE it
is the registered record's own query, by passing that record's `token`, is
allowed to move the binding (`rebound`); that is the `forkSession` resume, where
the record is registered under the id being resumed and the SDK answers with the
forked id. Refusing that one was a real defect hiding behind the same branch.
Everything that still reaches `stale-mismatch` is, by construction, a process
the registry has already displaced.

## Decision

**Name allocation: add per-process entropy, keep the routing-id head.** The
suffix is now `<first 6 of the routing id><4 hex>`
(`session-name.builder.ts:89`). The head stays because it is what a person
correlates a name with in a log; it carries no uniqueness. The nonce is minted
per `buildExtraArgs` call, which is once per spawn and once per resume — that
is, once per live CLI process, which is exactly the granularity the acceptance
criterion asks for. The suffix stays dash-free on purpose: a consumer recovers
the role by splitting on the name's LAST dash
(`peer-session-picker.component.ts:137`), so a dash inside the suffix would move
that boundary and make every role read wrong.

**Process lifetime: the registry displaces, and displacing aborts.** `register`
now evicts any record already under the key from BOTH indexes and aborts its
`AbortController` (`session-registry.service.ts:543`). The controller is the
only handle left on that query once the map entry is gone, and aborting it is
what `SessionControl.endRecord` itself relies on to stop a session
(`session-control.service.ts:231`). It deliberately does NOT run the full
`endRecord` teardown: that is async, and registration must not await a five
second interrupt race. The orderly path still owns the orderly teardown; this is
the backstop for when nobody ran one.

**Why that pair is the right cut.** A per-process name alone leaves the orphan
alive under a new name, still answering for the tab. Killing the orphan alone
leaves the window between its death and the new registration, where two live
names still collide. Together they close the loop: the displaced process is
stopped, and if it outlives the abort long enough to report, the registry can no
longer be talked into pointing the tab at it, and the adapter no longer tells
anyone it did.

## Change

1. `libs/backend/agent-sdk/src/lib/helpers/session-name.builder.ts:89` — new
   exported `buildUniqueSuffix(routingId)`. Returns the slugified first six
   characters of the routing id plus four hex characters of entropy, or `''`
   when the routing id is blank. The blank case is unchanged on purpose:
   `buildSessionName` rejects a blank suffix and the caller omits `--name`, and
   a caller with no routing id has no session to name. The module doc block now
   records why the routing id alone is not a uniqueness source, with the pids
   from the incident.
2. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1057` —
   `buildExtraArgs` composes the suffix through `buildUniqueSuffix(routingId)`
   instead of `(routingId ?? '').slice(0, 6)`. This is the single site that
   builds `--name` for a chat session.
3. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:543`
   — new private `displaceExisting(tabId)`, called first in `register` (`:195`).
   It deletes the previous record from `byTabId` and `bySessionId`, logs at
   `warn` with that record's real session id and token, and aborts its
   controller inside a `try` that narrows with `instanceof Error`. `abort()` is
   idempotent, so a record whose owner already tore it down costs nothing.
4. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:109`
   — new exported `BindRealSessionIdOutcome` union: `bound`, `already-bound`,
   `rebound`, `stale-mismatch`, `no-record`, `invalid`. A refusal that only logs
   cannot stop a caller from acting on the refused value.
5. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:229`
   — `bindRealSessionId` returns that outcome and takes an optional
   `ownerToken`. When the token equals the registered record's `token`, the
   binding MOVES (`:254`): the old `bySessionId` entry is deleted, the new one
   is written, and the call reports `rebound`. This is an identity proof, not an
   override flag — a token from a displaced registration can never match.
6. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:365` —
   the facade forwards `ownerToken` and RETURNS the outcome instead of
   discarding it. `BindRealSessionIdOutcome` is re-exported at `:66`.
7. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:265` —
   `ExecuteQueryResult` gains `sessionToken`, filled from `rec.token` in
   `session-query-executor.service.ts:360`. This is how a query's own callback
   proves, later, that it is still the registered owner.
8. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1004` — new private
   `bindRefusedAsStale(tabId, realSessionId, ownerToken)`. It performs the bind
   and returns `true` only for `stale-mismatch`, logging at `warn`. Every other
   outcome announces exactly as before.
9. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:871` (resume) and `:966`
   (new session) — both session-id callbacks return early when
   `bindRefusedAsStale` is true. Nothing downstream fires: no activity flush, no
   single-slot callback, no `SessionIdResolvedCallbackRegistry` fan-out, so the
   `[electron RPC] Session ID resolved: … -> real=<stale>` line cannot be
   produced. Both paths thread `sessionToken` from `executeQuery` (`:705`,
   `:847`); `createSessionIdCallback` takes it as a parameter (`:939`).
10. `libs/backend/agent-sdk/src/lib/helpers/index.ts` and
    `libs/backend/agent-sdk/src/index.ts` — `buildUniqueSuffix` added to the
    barrels beside `buildSessionName`.

No new dependency, no new DI registration, no new lib. Nothing outside
`libs/backend/agent-sdk/**` changed.

## Tests

### New

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry-restart-identity.spec.ts`
  — six cases on the registry, using the incident's own ids. Pinned
  interleavings: (a) a second `register` under the same tab aborts the first
  record's controller and leaves the new one untouched; (b) the displaced record
  is gone from BOTH indexes, so `find(<old real id>)` no longer resolves it; (c)
  the new process binds, because the fresh record starts unbound; (d) **the
  incident's interleaving — the old process is still alive and reports LATE,
  after the new process has bound** — refused as `stale-mismatch` both with its
  own (stale) token and with no token, with the tab still resolving to the new
  session; (e) the record's own query proves identity with its token and is
  `rebound` (the `forkSession` resume); (f) `invalid`, `no-record`, `bound` and
  `already-bound` each report distinctly.
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
  (`gives two spawns of the SAME tab different registry names`) — two builds
  with identical inputs produce different `--name` values that share every
  character but the last four. This is half A stated as the incident stated it.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`
  (`announces nothing when a displaced process reports its own id against the
tab`) — after the tab binds its live session, a second init carrying
  `7d2539d1-…` fires neither the single-slot callback nor the fan-out registry,
  and the last announced id is still the live one.

### Updated

Five assertions in `sdk-query-options-builder.spec.ts` that pinned the literal
name `…-tab-fi` now pin `…-tab-fi[0-9a-f]{4}`, and the fake `bindRealSessionId`
in `sdk-agent-adapter.spec.ts` returns the outcome union.

### Red before the change

Both fixes reverted in place (the `displaceExisting` call removed, the
`stale-mismatch` check short-circuited), specs kept:

```
$ npx jest --config libs/backend/agent-sdk/jest.config.ts --testPathPatterns "restart-identity|sdk-agent-adapter"
  ● SessionRegistry — a tab restarted into a second process › aborts the displaced record so the restart leaves no orphan process
    Expected: true
    Received: false
  ● SessionRegistry — a tab restarted into a second process › drops the displaced record from BOTH indexes
    Received: {"realSessionId": "7d2539d1-2222-4222-8222-222222222222", "tabId": "03497c14-1111-4111-8111-111111111111", …}
  ● SessionRegistry — a tab restarted into a second process › refuses the displaced process that is STILL ALIVE and reports late
    Received: {"realSessionId": "7d2539d1-2222-4222-8222-222222222222", "tabId": "03497c14-1111-4111-8111-111111111111", …}
  ● SdkAgentAdapter › first-turn activity identity (TASK_2026_296) › announces nothing when a displaced process reports its own id against the tab
    Expected number of calls: 1
    Received number of calls: 2
Test Suites: 2 failed, 2 total
Tests:       4 failed, 63 passed, 67 total
```

The half-A specs were red earlier in the same way: before the suffix change,
five name assertions failed with
`Received: "ptah-ws-fix-the-billing-bug-tab-fi"` — the same value on every
build.

### Green, full target

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk
Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 1992 passed, 1995 total
 NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

### Typecheck and lint

```
$ npx nx typecheck @ptah-extension/agent-sdk
 NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk

$ npx nx lint @ptah-extension/agent-sdk
✖ 42 problems (0 errors, 42 warnings)
 NX   Successfully ran target lint for project @ptah-extension/agent-sdk
```

Every warning is the pre-existing `max-lines` soft ceiling. The two touched
files it names — `sdk-query-options-builder.ts` (953) and `sdk-agent-adapter.ts`
(940) — were both over 700 before this change.

## Open risks

- **That the abort actually ends the CLI child process is inferred, not
  measured here.** The `AbortController` is the signal `executeQuery` hands the
  SDK query, and `SessionControl.endRecord` relies on the same abort to stop a
  session, so the mechanism is the repository's own. A unit spec can only
  observe `signal.aborted`. Proving that pid 2368 exits needs a live Electron
  host: restart a tab, then check that the old pid is gone from
  `~/.claude/sessions/`.
- **Name collision is now improbable, not impossible.** Four hex characters is
  65 536 values per tab. Two processes of the SAME tab colliding needs the same
  draw twice; across different tabs the routing-id head already differs. The CLI
  performs no duplicate check, so nothing downstream would catch the rare case.
  A longer nonce is a one-constant change (`NONCE_LENGTH`) if live data ever
  shows one.
- **The `rebound` path is reasoned from the code, not from a live fork.** A
  `forkSession` resume registers under the resumed id and the SDK answers with
  the forked one; that is why the owner-token exception exists. It is pinned by
  a spec, but no live fork ran in this batch.
- **A displaced process that reports BEFORE the new one registers is
  unaffected.** It is still the registered owner at that instant, so its bind is
  legitimate. The restart then displaces it a moment later. This is correct, but
  it means a very short window exists in which the tab points at a session that
  is about to be aborted.
- **Only the chat path's name changed.** A ptah-cli lane composes its own suffix
  from `agentId.slice(0, 6)`
  (`cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:739`), which is
  minted per spawn and so does not repeat across a restart. It was not touched —
  that file is another agent's scope in this worktree.

## Cross-boundary change needed

None is required for this defect. One optional follow-up, for a later batch that
owns `cli-agent-runtime`: `buildUniqueSuffix` is now exported from the
`agent-sdk` barrel, and `ptah-cli-registry.ts:739` could compose its suffix
through it so both name sites carry one rule. That is consistency, not a fix —
the lane's `agentId` is already per-spawn.

## Revision 1

Four findings from `batch-2-review.md`. All four are fixed. The diagnosis and
the shape above are unchanged; what follows names only what moved.

### Finding 1 (HIGH) — a late cleanup deleted the replacement record

`session-registry.service.ts:306` deleted from `byTabId` by `rec.tabId` alone. A
key is not proof of ownership after asynchronous work: by the time a displaced
record reaches `remove`, a restart may have put a different record under that
tab. `remove` is now identity-conditional PER INDEX — `byTabId` is cleared only
when `this.byTabId.get(rec.tabId) === rec`, `bySessionId` only when
`this.bySessionId.get(rec.realSessionId) === rec` — and
`recomputeLastActiveOnRemoval` runs only when this call actually took the tab
entry away. The two callers the reviewer named reach it through exactly this
state: the `executeQuery` catch (`session-query-executor.service.ts:362`) and
`SessionControl.endRecord` after its interrupt await
(`session-control.service.ts:227`).

Pinned by three cases in
`session-lifecycle/session-registry-restart-identity.spec.ts`:

- `keeps the replacement discoverable when the DISPLACED record cleans up late`
  — the reviewer's interleaving exactly. A registers T and binds, B registers T
  and displaces A, B binds, A's late `remove(A)` runs. `find(TAB)`,
  `find(NEW_SESSION)` and `getActiveSessionIds()` all still answer with B, and a
  later bind against the tab still finds an owner.
- `leaves the replacement bySessionId entry alone when the displaced record
shared the id` — the second index, for the case where B rebound the SAME real
  session id A held.
- `still removes a record that DOES own both keys` — the ordinary path did not
  regress.

### Finding 2 (HIGH) — the name suffix was probabilistic

**The suffix is now DERIVED, not drawn.** `randomBytes` is gone from
`session-name.builder.ts`. The allocation id is
`<process.pid base 36, padded to 6><monotonic counter base 36>`, appended to the
unchanged six-character routing-id head.

Why this meets the criterion rather than lowering a probability: two live
sessions started by one host process hold different counter values, because the
counter only ever increases. Two live sessions started by different host
processes hold different pids, because an operating system never gives one pid
to two live processes at once. A pid is recycled only after its owner exits, and
an exited host process holds no live session, so recycling cannot put two LIVE
sessions on one name. The pid field is FIXED width for injectivity: the counter
that follows is variable length, so a variable-length pid would let (pid 1,
counter 23) and (pid 12, counter 3) both spell `123`. Six base-36 characters
hold 2_176_782_335, above the largest pid any supported platform issues.

Chosen over detect-and-retry because the registry's collision domain is the
machine's live CLI processes, not this process's map — an in-process retry loop
could not see a name held by the other host, while the pid already distinguishes
them. The suffix stays dash-free, so the last-dash role split is unaffected. It
grows from 10 to 14 characters, which the head budget in `buildSessionName`
absorbs.

Pinned by `sdk-query-options-builder.spec.ts`:
`gives EVERY allocation a different name, because the suffix is derived and not
drawn` — 500 builds, 500 distinct names. This spec cannot pass by luck, which
the old two-build test could. Five existing assertions moved from
`[0-9a-f]{4}` to `[0-9a-z]{8,}`.

### Finding 3 (MEDIUM) — a refused bind was still announced

`bindRefusedAsStale` is renamed `bindRefused` (`sdk-agent-adapter.ts:1004`) and
inverted: it returns `false` only for `bound`, `already-bound` and `rebound`.
`no-record`, `invalid` and `stale-mismatch` all stop, and each logs its own
outcome at `warn`. The two call sites are unchanged in shape.

Pinned by three cases in `sdk-agent-adapter.spec.ts`:
`announces nothing when the tab owns NO record` (the session is ended, then its
SDK process emits `init` late), `announces nothing when the registry calls the
reported id invalid`, and `announces a legitimate FIRST bind exactly once`. The
existing `stale-mismatch` case stays.

One test-double change follows: the harness mock at
`sdk-agent-adapter.spec.ts:203` returned `undefined`, which the old rule read as
permission to announce. It now returns `'bound'`, which is what the registry
returns on that path. Tests needing a refusal override it.

### Finding 4 (MEDIUM) — the rebind token was written to the log

`displaceExisting` logged `previous.token` verbatim. It now logs
`tokenFingerprint(previous.token)` — the first eight hex characters of a SHA-256
digest. Two log lines about one record stay comparable, and the value cannot be
replayed, because `bindRealSessionId` compares the token itself. The token
appears nowhere else in log output.

Pinned by `never writes the rebind token into a log line` in
`session-registry-restart-identity.spec.ts`.

### Red before the change

All four fixes reverted in place, specs kept:

```
$ npx jest --config libs/backend/agent-sdk/jest.config.ts --testPathPatterns "restart-identity|sdk-agent-adapter"
  ● SessionRegistry — a tab restarted into a second process › keeps the replacement discoverable when the DISPLACED record cleans up late
  ● SessionRegistry — a tab restarted into a second process › leaves the replacement bySessionId entry alone when the displaced record shared the id
  ● SessionRegistry — a tab restarted into a second process › never writes the rebind token into a log line
  ● SdkAgentAdapter › first-turn activity identity (TASK_2026_296) › announces nothing when the tab owns NO record
  ● SdkAgentAdapter › first-turn activity identity (TASK_2026_296) › announces nothing when the registry calls the reported id invalid
Test Suites: 2 failed, 2 total
Tests:       5 failed, 69 passed, 74 total
```

### Green

```
$ npx nx run-many -t test -p @ptah-extension/agent-sdk --skip-nx-cache
Test Suites: 2 skipped, 112 passed, 112 of 114 total
Tests:       3 skipped, 2000 passed, 2003 total
 NX   Successfully ran target test for project @ptah-extension/agent-sdk

$ npx nx typecheck @ptah-extension/agent-sdk
 NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk

$ npx nx lint @ptah-extension/agent-sdk
 NX   Successfully ran target lint for project @ptah-extension/agent-sdk
```

1992 → 2000 passing, eight added, none lost.

### Open risks that this revision closes

The "Name collision is now improbable, not impossible" risk above is withdrawn:
the suffix no longer draws entropy. The remaining risks in that section — that
the abort ends the CLI child process, and that the `rebound` path is reasoned
rather than measured against a live fork — are unchanged and still open.

## Revision 2 — applied by the orchestrator

`batch-2-review-round-2.md` confirmed findings 1, 3 and 4 as fixed and kept
finding 2 open with three sub-points. All three are answered here. The author
lane was gone from the host registry, so I made the change.

### 2a — `padStart` is a MINIMUM width, so the encoding was not self-delimiting

The reviewer is right, and this one is a certainty rather than a risk. Six
base-36 characters hold 2_176_782_335, which is UNDER the unsigned 32-bit
maximum 4_294_967_295 that Windows can issue. Past six digits the pid and the
sequence stop being self-delimiting: pid `1000001` with sequence `00` and pid
`100000` with sequence `100` both spell `100000100`. The author's own comment
claimed six digits covered a 32-bit pid; it does not, and only the Linux bound
(2^31 - 1) fits.

`PID_WIDTH` is now 7. Seven base-36 characters hold 78_364_164_095, above the
32-bit maximum, so the field is exact-width for every pid either platform can
issue. Pinned by `encodes the pid at an EXACT width, so the fields stay
self-delimiting` in `session-name.builder.spec.ts`, which asserts the bound as
well as the field.

### 2b — the counter was module state, so two copies of the module repeat it

`allocationSequence` was a module-scoped `let`. That is one counter PER LOADED
COPY, and a bundle can hold the CJS and ESM builds of one lib inside a single
process. Those copies share a pid and a host-start stamp, run independent
counters, and mint the same allocation id.

The counter now lives on `globalThis` under `Symbol.for(...)`, which every copy
in the process resolves to the same slot. Pinned by `keeps its counter on
globalThis, so two copies of this module cannot repeat an id`.

### 2c — an orphaned CLI child plus a recycled pid

The reviewer could not verify that host exit implies no named CLI child is still
live, and would not accept the claim without it. That is the correct call: this
task's own incident is a child outliving the process that spawned it.

The allocation id now carries a third field, the HOST START instant, as six
base-36 characters of seconds since 2020-01-01. It separates two host processes
that held the same pid at different times, which is exactly the orphan case. It
is derived, not drawn — no entropy returns to the suffix.

Full shape: `<pid base 36, 7 wide><host start base 36, 6 wide><sequence base 36>`.

**Residue, stated rather than argued away.** Two hosts that start inside the
same second AND are handed the same pid still collide. An operating system does
not recycle a pid to a process starting in the same second its predecessor
exited, so this needs the system clock to be moved backwards between the two
starts. Closing even that would need a machine-wide allocator, which is the
reviewer's own suggested alternative and is out of proportion to the case.

### Cost

The suffix grows from 14 to 21 characters. `buildSessionName` caps the whole
name at 64 and truncates the HEAD only, so the head budget falls from 49 to 42.
`ptah-ptah-extension-backend-developer` is 37 and still fits; a name carrying
both a long workspace label and a task id will truncate its head sooner. The
suffix is the part that must survive, and that ordering is unchanged.

### Green

```
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime --skip-nx-cache

Test Suites: 2 skipped, 112 passed, 112 of 114 total   (agent-sdk)
Tests:       3 skipped, 2004 passed, 2007 total
Test Suites: 62 passed, 62 total                        (cli-agent-runtime)
Tests:       1 skipped, 940 passed, 941 total
```

2000 -> 2004 in agent-sdk, four added, none lost.
