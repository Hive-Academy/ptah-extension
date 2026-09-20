# SQLite off the main thread — implementation plan

TASK_2026_481. Design only. No production code was written and no source file was
modified while producing this.

Every `file:line` below is from a file I opened in this worktree
(`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97`).

---

## Recommendation

**Conditional go, and the condition is TASK_2026_478. Do not start Step 1 of the
migration below until 478 has landed and the same log signals have been
re-measured on the shrunk file.**

Reasoning, stated as the split of the measured evidence rather than as a
preference:

The measured offenders in `context.md` fall into two classes with different
sensitivity to file size.

| Class | Hits | Cache-sensitive? | Survives 478? |
| --- | --- | --- | --- |
| `SELECT … FROM memories m WHERE workspace_root IS ?` | 11 | Yes — a row scan over a 39.8 MB table whose pages are being evicted by a 1.2 GB file | Probably not, or much reduced |
| `memory_chunks_vec` / `code_symbols_vec` `WHERE embedding MATCH ?` | 14 | **No** — brute-force KNN is CPU, not IO | **Yes, in full** |

`memory_chunks_vec` is declared `USING vec0(… embedding FLOAT[384])`
(`libs/backend/persistence-sqlite/src/lib/migrations/0002_memory.ts:70-72`) with
no partition key and no metadata columns. A `vec0` table in that shape has no
ANN index: a `MATCH` is a linear pass computing a distance for every stored
vector. That 58.6 MB partition (`.ptah/specs/TASK_2026_478_9a3c/context.md:10`)
is float arithmetic on the main thread. Shrinking the database from 1,203.9 MB
to ~325.9 MB removes zero of it.

So the honest answer to "how much of the case survives at ~325 MB" is: **roughly
the vector half, and only the vector half.** 14 of the 25 named slow-statement
hits are brute-force KNN whose cost is independent of total file size. The 11
`memories` hits and an unknown share of the 71 total `[SQLite] slow statement`
warnings are plausibly page-cache victims of the 878 MB of dead
`observation_queue` rows and of the retention passes, backups and `dbstat`
attribution that repeatedly stream that file. Those may disappear entirely.

That is enough to justify **a narrow, read-only, vector-search worker** —
eventually. It is not enough to justify moving SQLite access generally, and it
is not enough to justify starting before 478, because 478 changes the size of
the remaining problem by an unknown but large factor and is a far smaller
change.

Concretely:

- **Now**: land TASK_2026_478. Re-run the same log extraction on the shrunk file
  (count of `[event-loop] lag`, count and total duration of `[SQLite] slow
  statement`, and the per-SQL breakdown).
- **Then**: if vector `MATCH` still accounts for a material share of blocked main
  thread time, execute Step 1–Step 4 below. If it does not, close this task as
  "resolved by 478" and keep `slow-statement-timing.ts` as the standing monitor
  it was built to be
  (`libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts:4-11`).
- **Cheaper lever to evaluate first, if 478 leaves vector search hot**: reduce
  the number of vectors scanned (a `vec0` partition key on `workspace_root`, or
  a pre-filter) before adding a process. That is a migration, not a new
  lifecycle. It is out of scope for this plan but it must be priced before Step 1
  is approved, because a worker that still brute-forces 58.6 MB has only moved
  the CPU, not removed it — and on an 8-core machine moving it is usually
  enough, but on a 2-core machine it is not.

**Assumption A-1**: that the `vec0` tables carry no ANN structure, and therefore
that a `MATCH` is O(rows). Check that resolves it: `EXPLAIN QUERY PLAN SELECT
rowid, distance FROM memory_chunks_vec WHERE embedding MATCH ? ORDER BY distance
LIMIT ?` against the real database, plus timing the same query on a copy with
half the rows deleted. If timing is sublinear in row count, A-1 is wrong and the
CPU claim above weakens.

---

## Scope: what moves and what does not

**Moves (only after the gate above):**

1. `MemorySearchService`'s vector arm — the `memory_chunks_vec … MATCH` query and
   its immediate row hydration.
2. `code_symbols_vec … MATCH`, the same shape, in `workspace-intelligence` /
   `code-symbol.store.ts`.
3. Optionally in the same step, the BM25 arm and the `memories … WHERE
   workspace_root IS ?` read, because they are fused by RRF in the same call and
   splitting the fusion across a process boundary costs a second round trip for
   no benefit.

**Does not move:**

- Every write. See "Write path and transaction integrity".
- `MemoryStore.list` (`libs/backend/memory-curator/src/lib/memory.store.ts:340`),
  `listAll` (`:384`) and `stats` (`:671`). These are synchronous methods with
  synchronous callers. Making them async is a signature change that ripples
  through `rpc-handlers` and is not justified by any measured hit.
- Retention, lifecycle, backup, integrity and page reclaim. Retention is already
  batched and governor-gated, and integrity/backup already run out of process
  (`libs/backend/persistence-sqlite/CLAUDE.md`, the `integrity/` section).
- Migrations and `openAndMigrate`. Forward-only migrations on a single writer are
  exactly where a second connection is dangerous.

**Why the scope is this narrow**: a blanket move makes every SQLite call site
async and breaks the `IStateStorage`-style synchronous read contracts the repo
still relies on. The measured evidence names three SQL statements, not a layer.

**Key enabling fact (Verified)**: the read path at the service boundary is
**already async**. `MemorySearchService.search` is `async`
(`libs/backend/memory-curator/src/lib/memory-search.service.ts:239`), as are
`searchRich` (`:264`) and `searchIndex` (`:536`) — they already await the
embedder. So moving the query underneath them changes **no caller signature**.
That is what makes this scope cheap and any wider scope expensive.

---

## Transport and protocol

### Template: `DbWorkerRunner`, not the embedder client

`libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` is the
closer precedent and should be the primary template. It is an already-shipping
out-of-process database worker in this repository with:

- a caller-supplied budget rather than a shared constant (`db-worker-runner.ts:71`
  and its rationale at `:25-28`);
- settle-exactly-once on the first of reply / early exit / budget expiry / abort,
  with a kill on **every one of those four paths** (`:113-132`, `:153-168`);
- a caller-supplied `narrow` so the runner never interprets a reply it did not
  send (`:73-77`);
- zero per-run state, so one singleton serves several callers concurrently
  (`:18-23`);
- `budgetTimer.unref?.()` so a pending run cannot hold the process open at quit
  (`:170`);
- never rejects — a factory throw, a `postMessage` throw and a silent worker all
  resolve to `{ response: null }` (`:143-179`).

The host-side spawn stays behind
`libs/backend/persistence-sqlite/src/lib/integrity/worker-process.port.ts:27-34`
(`IIntegrityWorkerProcessFactory`), which is the documented reason
`persistence-sqlite` contains no `electron` import (`:1-18`). That port and the
embedder's twin
(`libs/backend/memory-curator/src/lib/embedder/worker-process.port.ts:9-20`) are
byte-comparable in shape.

### The one deviation from `DbWorkerRunner`, and its justification

`DbWorkerRunner` is **one request per process**: spawn, ask, settle, kill. That
is correct for a 7-day integrity check and a 20-minute backup. It is wrong for a
search query that fires several times a minute — process spawn plus opening a
read-only handle plus loading `sqlite-vec` per query would cost more than the
1.67 s worst statement it is trying to remove.

So the search worker needs a **long-lived process with id-correlated,
multiplexed requests**. That is the part `DbWorkerRunner` does not cover, and it
is exactly what `EmbedderWorkerClient`
(`libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts`, with
`embedder-worker-protocol.ts`) already does: lazy spawn, id correlation,
idle teardown, respawn-on-exit and a crash-loop guard
(`libs/backend/memory-curator/CLAUDE.md`, the `src/lib/embedder/` bullet).

**Therefore**: reuse `DbWorkerRunner`'s settle-and-kill discipline and its
host-port boundary verbatim; take the multiplexing, idle teardown and crash-loop
guard from `EmbedderWorkerClient`. Do not write a third variant of either. The
concrete rule: per-request the client must still settle exactly once on the first
of reply / worker exit / per-request budget / abort, and a worker that misses its
budget is killed rather than left running, because a search worker that keeps a
dead handle is a leak in a process family this repository already has a known
fault in (TASK_2026_479, cited in `context.md:61-62`).

**Concurrent-request failure settlement**: When a shared worker process is killed
due to one request exceeding its budget or exiting unexpectedly:
- **Exactly-once settlement**: Every active in-flight request pending in the
  client's correlation map is immediately settled with a worker-terminated error /
  inconclusive status, rejecting the caller's worker promise.
- **Fallback ownership & duplicate prevention**: The originating request that
  timed out falls back to an in-process query execution. For other in-flight
  requests terminated by the child death, fallback ownership belongs to the
  calling service; to prevent a thundering-herd storm of simultaneous main-thread
  queries, in-process fallbacks must be serialized or coalesced by query key,
  and aborted requests (`signal.aborted`) fail fast without executing fallback.
- **Testing**: A dedicated concurrent-timeout spec must be implemented before
  the worker path to verify that if request A times out and terminates the worker,
  concurrent request B is cleanly settled and does not trigger duplicate fallback
  work.

### Protocol shape

Copy the **validation posture** of
`electron-state-storage-worker-protocol.ts`, which is the strictest example in
the tree:

- one Zod `z.discriminatedUnion('type', …)` for requests and a separate one for
  responses, every member `.strict()`
  (`electron-state-storage-worker-protocol.ts:292-384` and `:437-555`);
- validate in **both** directions: the worker parses the request, and the host
  parses the response
  (`parseElectronStateWorkerRequest` `:838-850`,
  `parseElectronStateWorkerResponse` `:852-864`), and the worker loop
  additionally size-checks its own outbound response before posting
  (`electron-state-storage-worker-loop.ts:117-133`);
- a hard message-byte budget enforced by bounded traversal rather than
  `JSON.stringify` (`:625-723`);
- a monotonic `operationId` guard (`:866-881`);
- a closed `failure` response union with a fixed code enum (`:386-401`), so a
  worker cannot mint a novel error string that the host then forwards onward. The
  same file's recovery-reason subsetting (`:26-45`) is the model: the worker may
  only report verdicts a worker can legitimately reach.

Requests carry: `type`, `operationId`, `dbPath`, `writeCounter: number`
(validated as `z.number().int().nonnegative()`), and scalar query parameters —
`workspaceRoot: string | null`, `topK: number`, `queryEmbedding: Float32Array`
carried as a `Uint8Array` slice, `filters` as arrays of strings. The
`writeCounter` represents the host's write version observed when the request
is dispatched; upon response reception, the host caches results only if the
current write version matches `writeCounter`, preventing stale snapshot results
from overwriting newer data. Responses carry flat row arrays of
`null | number | string` only.

---

## The non-cloneable fault and how this avoids it

### What actually throws

The exact message in `context.md:63-65` is produced at **two** sites in
`electron-state-storage-worker-protocol.ts`, both as the *final* `throw` after
every accepted type has been handled:

- `:680-685` — the `default:` arm of `switch (typeof value)` inside
  `assertElectronStateWorkerPayloadWithinBudget`;
- `:829-832` — the tail of `visit()` inside `assertJsonCompatibleValue`.

Both are reached only when `typeof value` is **`'undefined'`, `'function'`,
`'symbol'` or `'bigint'`**. Every other case exits earlier: `null` at `:658` /
`:785`, `string` / `number` / `boolean` / `object` at `:662-679` / `:785-800`.
Cyclic values, non-plain objects (`Date`, `Map`, class instances) and non-finite
numbers each throw their **own distinct message** (`:688-692`, `:704-709`,
`:667-672`), so the reported text rules them out.

Since the top-level value is guarded — `ElectronStateStorage.update` only calls
`assertJsonCompatibleValue` when `value !== undefined`
(`libs/backend/platform-electron/src/implementations/electron-state-storage.ts:143-145`;
same guard in `electron-state-storage-worker-host.ts:231-234`) — the offending
value is **a nested own property explicitly set to `undefined`** (or, less
likely, a function).

### Where it comes from on that specific log line

`[electron RPC] Failed to persist CLI session reference after retries` is
`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:457-460`. The work
inside that retry is `persistBulkThenReference`
(`agent-events.ts:422-435`), whose first call is:

```ts
await metadataStore.saveAgentOutput(info.agentId, {
  stdout: persistedOutput.stdout,
  segments: persistedOutput.segments,
  streamEvents: persistedOutput.streamEvents,
});
```

— `agent-events.ts:428-432`. All three fields are optional on `persistedOutput`
(`agent-events.ts:343-349`, matching the store signature at
`libs/backend/agent-sdk/src/lib/session-metadata-store.ts:669-676`). Written as
an object literal, an absent field becomes an **own property whose value is
`undefined`**, which is precisely the `typeof value === 'undefined'` case above.

Note the contrast in the very same function: the `ref` literal
(`agent-events.ts:394-409`) uses conditional spreads (`...(x ? { k: x } : {})`)
specifically to avoid minting undefined-valued keys. The bulk-output literal
twelve lines earlier does not. `saveAgentOutput` defaults the fields *after*
receiving the object (`session-metadata-store.ts:678-681`), which does not help —
the throw happens on the way into the worker, not inside the store's defaulting.

Two secondary observations worth carrying forward, because they turn one bad
write into a repeated one:

1. `shouldRetry` only excludes `Parent session not found`
   (`agent-events.ts:440-443`), so a **deterministic** serialisation failure is
   retried three times with backoff before being logged.
2. The message is misleading. `undefined` **is** structured-cloneable; the
   `postMessage` would have carried it. The guard is a *JSON-compatibility*
   guard — the value must survive a JSON round-trip on disk — wearing the word
   "cloneable". Anyone debugging from the message alone looks for a `Map` or a
   class instance and finds none.

### How the proposed protocol avoids the same fault

Four structural properties, not a review rule:

1. **No caller-supplied object ever crosses the boundary.** A request is built by
   the client from named scalars (`dbPath: string`, `workspaceRoot: string |
   null`, `topK: number`, `queryEmbedding: Uint8Array`, `types: string[]`). There
   is no `value: JsonValue` parameter and no pass-through of a domain record, so
   there is no path by which a caller's optional field reaches the wire. This is
   the whole difference from the state worker, whose entire job is to persist
   arbitrary caller values (`electron-state-storage-worker-protocol.ts:313-319`).
2. **Responses are built inside the worker from SQLite output, which cannot
   contain `undefined`.** A better-sqlite3 row column is `null | number | string
   | Buffer` and nothing else. Rows are mapped to flat records with explicit
   `?? null`, never to optional fields.
3. **Optionality is expressed as `| null`, never as an absent-or-undefined
   property.** Every schema member is `.strict()` with required keys; a Zod
   `.optional()` is forbidden in this protocol, because `.optional()` is exactly
   the shape that invites an `undefined`-valued own property at the construction
   site. Where a value may be missing, the type is `z.union([T, z.null()])` and
   the builder writes `null`.
4. **Both directions are validated before posting, and the failure is loud and
   non-retryable.** Following `electron-state-storage-worker-loop.ts:117-133`,
   the client validates its request before `postMessage` and the worker validates
   its response before posting. A validation failure is classified as a
   *permanent* protocol error and must **not** be retried — the opposite of
   `agent-events.ts:440-443` — because retrying a deterministic serialisation
   fault only triples the log noise.

A guard alone would not be sufficient, which is why properties 1–3 are
structural: `assertJsonCompatibleValue` was present and running on the state path
and the fault still shipped, because the guard was applied to a value that had
already been constructed wrongly.

**Out of scope but worth filing separately**: `agent-events.ts:428-432` is a live
bug on the existing state worker. It is not fixed by this task and should not be
bundled into it — it is a three-line conditional-spread change plus a
`shouldRetry` exclusion, in a lib this plan does not otherwise touch.

---

## Host degrade matrix (Electron / VS Code / CLI)

The rule to preserve: `libs/backend/**` runs unchanged in all three hosts; the
spawn is host-implemented behind a local port
(`worker-process.port.ts:1-18`). A host that registers no factory degrades; it
never crashes and never silently returns wrong results.

| Host | Factory registered | Behaviour | Precedent |
| --- | --- | --- | --- |
| Electron | Yes (`utilityProcess.fork`, same shape as the embedder and integrity factories) | Vector search runs in the worker | `IEmbedderWorkerProcessFactory`, `IIntegrityWorkerProcessFactory` |
| CLI | Optional — `child_process.fork`, and only if the CLI's own profiling shows a need | If registered, identical path; if not, in-process | `persistence-sqlite/CLAUDE.md`: "Electron and the CLI both ship one" |
| VS Code | No | In-process, unchanged | VS Code never registers `PERSISTENCE_TOKENS.SQLITE_CONNECTION` at all (`worker-process.port.ts:13-17`) — it has no database, so there is nothing to move |

Degrade semantics, in order of preference:

1. **No factory → run the same query in process.** This differs from the
   embedder's degrade, which drops to BM25-only
   (`memory-curator/CLAUDE.md`, embedder bullet), and the difference is
   deliberate: an absent embedder means the vectors cannot be *computed*, so
   BM25-only is the only correct answer. An absent worker factory means only that
   the query must run here — the result is identical, just on the main thread,
   which is today's behaviour. Degrading to BM25-only would silently change
   search results based on which host you launched.
2. **Worker spawn fails, or a request exceeds its budget, or the worker exits** →
   settle all active in-flight requests as inconclusive/interrupted, terminate
   the child, execute in-process fallback for the timed-out request, settle
   other pending requests with explicit worker-terminated errors (allowing callers
   to fall back sequentially without duplicate main-thread spikes), and report
   one degradation event. Do not permanently disable: the embedder client
   already proves respawn-on-next-request is the right posture
   (`memory-curator/CLAUDE.md`).
3. **Crash loop** → stop spawning, stay in process, one `warn`. Reuse the
   embedder client's existing guard rather than writing a second one.

This does mean an in-process fallback exists, which is the opposite of the
backup service's deliberate no-fallback stance
(`persistence-sqlite/CLAUDE.md`, backup bullet). The two cases are not alike: a
backup fallback hid a 27 s boot-path cost that nobody could attribute, whereas a
search fallback is *exactly the current shipping behaviour*, and it is already
instrumented — every in-process fallback over 50 ms emits a
`[SQLite] slow statement` line (`slow-statement-timing.ts:36-41`). The fallback
cannot hide, and that is the condition under which one is acceptable.

---

## Write path and transaction integrity

**No write moves. There is exactly one writer, and it stays where it is.**

The worker opens its **own read-only connection**, which is an explicit,
documented exception to `context.md:71-72` ("All DB access goes through the
shared connection from `persistence-sqlite`. Never open a second handle.").
The host-level constraint forbids multiple competing connections or writers
within the main process, but sharing a process-memory `better-sqlite3` pointer
across separate OS process boundaries (`utilityProcess` / child process) is
technically impossible. Like the integrity worker (`persistence-sqlite/CLAUDE.md`:
`integrity-worker.ts` "opens the database on its own **read-only** connection")
and backup worker, the search worker follows an approved read-only exception:

- **Strict read-only handle**: The connection is opened with `readonly: true`.
  A second *writer* would invite `SQLITE_BUSY` against the main connection and
  break write integrity; read-only sidesteps this entirely as a structural
  exclusion.
- **No checkpoints**: A read-only connection cannot checkpoint on close, which
  is why the backup path needs a separate `openForValidation`
  (`persistence-sqlite/CLAUDE.md`, staging bullet). For a search worker this
  does not matter — it never writes and never needs to checkpoint. Do not add a
  write-mode open "for symmetry".
- **Clean lifecycle & shutdown**: The read-only connection is opened lazily upon
  worker start, held for multiplexed read queries, and explicitly closed
  synchronously on worker shutdown (`SIGTERM`, idle timeout, or abort),
  leaving no lingering handles or lock leaks.
- **Read-your-writes is weakened, and this must be stated rather than assumed.**
  In WAL mode a reader on a separate connection sees a committed snapshot; a
  write committed on the main connection microseconds before the worker's query
  begins may or may not be visible depending on when the worker's read
  transaction started. Today, with one connection, a search always sees every
  prior write.

  Where that matters and what to do:
  - `MemorySearchService` already caches results in an LRU keyed by
    query + workspaceRoot + **write-counter**, so any write evicts
    (`memory-search.service.ts:1-7`). That counter is the seam: the request must
    carry it, and a worker result is only cached under the counter value observed
    *before* the query was dispatched. A result computed against an older
    snapshot then cannot be served as if it were current.
  - Curator upsert-then-search-immediately paths must be checked individually.
    If one exists, that call keeps the in-process path. It is legitimate for the
    same service to have one synchronous read and one worker read; it is not
    legitimate for it to be a coin toss.
- **Delete triggers and the vec shadow tables are untouched.** Chunk FTS and
  vector rows follow memory deletes through triggers on the writer's connection
  (`memory-curator/CLAUDE.md`, lifecycle bullet). A read-only worker sees the
  post-trigger state or the pre-trigger state, never a half-applied one, because
  it reads committed snapshots.
- **Abort and shutdown.** Every request takes an `AbortSignal`, and dispose kills
  the child — `DbWorkerRunner`'s abort is synchronous, idempotent and never
  throws precisely so it can be called from a teardown chain
  (`db-worker-runner.ts:55-60`). The host must kill the worker on app quit. An
  unreaped family is the named constraint (`context.md:61-62`).

---

## Migration steps (ordered, each independently shippable)

**Step 0 — gate (not this task).** Land TASK_2026_478. Re-measure. If vector
`MATCH` is no longer a material share of blocked main-thread time, stop here and
close this task.

**Step 1 — measurement seam, no new process.** Attribute the 71 slow-statement
warnings to call sites, not just SQL text. Confirm or refute Assumption A-1 with
`EXPLAIN QUERY PLAN` and a halved-row timing run. Ships alone; changes only
logging. This is the step that decides whether Step 3 is a worker or a `vec0`
partition key.

**Step 2 — the port and the client, still in process.** Introduce the local
`ISearchWorkerProcessFactory` port beside the code it spawns (same placement
rationale as `worker-process.port.ts:10-11`) and a client that today *always*
takes the in-process path because no host registers a factory. Ships alone;
behaviour byte-identical. Proves the async seam holds — which it should, because
`search` / `searchRich` / `searchIndex` are already `async`
(`memory-search.service.ts:239`, `:264`, `:536`).

**Step 3 — the worker entry and the protocol.** The read-only opener, the
dispatch, the two Zod unions. Put every testable thing in the protocol module,
not the entry: the entry subscribes to a parent port at module scope and throws
without one, so Jest cannot import it — the rule already learned and written down
for `integrity-worker.ts` (`persistence-sqlite/CLAUDE.md`). Still no host
factory, so still no behaviour change in production; the worker is exercised by
an integration spec against real `better-sqlite3`, the way
`integrity-worker-backup.integration.spec.ts` does.

**Step 4 — register the Electron factory.** One host file. This is the first step
that changes runtime behaviour, and it is a one-line revert. Re-measure the same
log signals before and after.

**Step 5 — `code_symbols_vec`, if Step 4's numbers justify it.** Same worker, one
more request type. Not bundled with Step 4, so the attribution of Step 4's effect
stays clean.

---

## What this could make worse

- **A fifth child-process family.** Ptah already forks the embedder, the
  integrity/backup worker, the workspace-watch host and rival CLIs. TASK_2026_479
  is an existing unreaped-child fault (`context.md:61-62`). One more family with
  its own lifetime is real added risk, and it is the strongest single argument
  for waiting until 478 proves the need.
- **Latency for fast queries.** The IPC round trip plus structured clone of the
  result rows adds a floor to every search. A query that takes 3 ms in process
  will not take 3 ms through a worker. Only slow queries win; the client should
  therefore route only the query types Step 1 proved slow, not everything it can.
- **Memory.** A second read-only connection, a second `sqlite-vec` load, and a
  second page cache. On a machine already under the memory pressure `context.md`
  describes, this is not free — and it is worst on exactly the machine whose page
  cache is already thrashing.
- **Split-brain results.** Two connections, two snapshots. Mitigated by the
  write-counter rule above, not eliminated. Any code that assumes
  read-your-writes and is not audited in Step 2 is a latent wrong-result bug,
  which is strictly worse than the stall it replaces.
- **A second protocol to keep in step.** The state worker protocol is 1,085
  lines. A search protocol is far smaller, but it is still a schema that must be
  changed in two places at once forever.
- **The CPU does not disappear.** If A-1 holds, moving brute-force KNN to a
  worker unblocks the event loop but still burns a core. On a low-core machine
  the renderer — already at 94% of a core per TASK_2026_480 — now competes with
  it.

---

## Dependency on TASK_2026_478

Hard, and in one direction: **478 must land first.**

- 478 removes 878 MB of a 1,203.9 MB file, 780.7 MB of which is payload text in
  171,524 already-processed `observation_queue` rows
  (`.ptah/specs/TASK_2026_478_9a3c/context.md:5-14`). The remainder is ~325.9 MB.
- Any measurement taken on the 1.2 GB file over-states the case for this task by
  an unknown amount, because the page cache for that file cannot stay resident
  under pressure — stated in this task's own `context.md:40-43`.
- The reverse dependency does not exist: nothing in 478 needs a worker.
  478's own constraints push the other way — bounded, yielding batches on the
  existing connection, and `incremental_vacuum` rather than `VACUUM`
  (`TASK_2026_478_9a3c/context.md:69-71,78`).
- There is also a direct interaction worth naming: while the 878 MB backlog
  exists, every retention attempt and every backup streams it, evicting the
  `memories` and `memory_chunks_vec` pages that the measured slow statements
  need. Part of the observed slowness may be **contention with the broken
  retention loop**, not a steady-state property of the search queries at all.
  That cannot be separated without fixing 478 first.

---

## Open questions

1. **Does 478 alone close this?** Answerable only by re-measuring. This is the
   gate on the whole task.
2. **Is Assumption A-1 right — is `vec0 MATCH` linear here?** If it is, is a
   partition key or a pre-filter on `workspace_root` a cheaper fix than a
   process? A schema change has no lifecycle, no child and no second connection.
3. **Which of the 71 slow-statement warnings are the 25 named SQL texts, and
   which are the other 46?** `context.md:23-29` names the top offenders but the
   remaining warnings are unattributed. If the tail is writes, a read-only search
   worker addresses none of it.
4. **Is there a curator or RPC path that writes and then immediately searches?**
   Decides whether the write-counter mitigation is sufficient or whether specific
   call sites must stay in process.
5. **Does the CLI host want the factory at all?** The CLI has no UI event loop to
   protect. Registering one there adds a process for no user-visible benefit.
6. **Should `agent-events.ts:428-432` be fixed under this task or its own?**
   Recommendation: its own. It is a live bug on a different worker in a lib this
   plan does not otherwise touch.

---

## Files I could not read

None. No read was denied during this investigation.

Files I located but deliberately did not open in full, with the reason:

- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-host.ts`
  — read lines 200–360 only (the `update` / `writeLargeScalar` path), which is
  where the guard is applied. The remaining ~400 lines are paging and restart
  logic not load-bearing for the non-cloneable question.
- `libs/backend/platform-electron/src/implementations/electron-state-storage-worker-loop.ts`
  — read lines 95–145 (`processMessage`), enough to establish the
  validate-before-post rule cited above.
- `libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts` and
  `embedder-worker-protocol.ts` — their behaviour is stated in
  `memory-curator/CLAUDE.md` and this plan takes only that documented shape
  (lazy spawn, id correlation, idle teardown, respawn, crash-loop guard). Any
  step that actually writes the client must open both first.
- The `*-worker-*.spec.ts` siblings — not opened. If Step 3 proceeds,
  `electron-state-storage-worker-protocol.spec.ts` is the model for the new
  protocol's tests.
