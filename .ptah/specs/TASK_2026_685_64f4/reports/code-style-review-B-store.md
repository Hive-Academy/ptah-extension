# Code Style Review - B-store (B3a, B3b, B4), TASK_2026_685_64f4

Worktree: lane-execution-stream (feat/lane-execution-stream). Read-only review.
Score: 5/10. Verdict: CHANGES REQUESTED. Blocking 0, Moderate 6, Minor 5.

Scope read: full subagent-execution.store.ts (437 lines), index.ts diff, B4 diffs of streaming-handler,
history-message-builder, stream-router, accumulator-core B3a/fix diffs. Spec read only by size/structure.
Checks run: prettier --check (scoped), grep for any/ts-ignore/non-null casts.

## Blocking
None. Imports use public aliases only (@ptah-extension/chat-types, core, shared); chat-routing -> chat-streaming
goes via the barrel (stream-router.service.ts import of SubagentExecutionStore from '@ptah-extension/chat-streaming').
No any / ts-ignore / as unknown as in the store.

## Moderate

1. God file, several responsibilities in one class. subagent-execution.store.ts holds entry lifecycle
   (open/publish/syncRecord, :68-101), ownership index with FIFO cap (own/dropOwners, :103-127), event claim
   routing (:130-178), continuation seeding (:184-210, :238-260), retention/eviction (evictFinalized, enforceLiveCap,
   :274-310), and RPC history paging plus snapshot/live merge (ensureHistory, loadHistory, merge, blockIdentity,
   :326-431). The repo already split retention out (execution-tree-retention.ts, imported at :11). Recommend
   extracting at least: ownership index (pure class, testable), history load/merge (`subagent-history-merge.ts`),
   and retention policy. The 70-line merge() and 40-line claim() are the hardest to read.
2. Exposed signal leaks mutable state. `entries` (:57) is a public writable `signal<ReadonlyMap<...>>`, and the
   entries are mutable objects mutated in place with a `revision` counter bumped by publish() (:68-71) which also
   copies the whole Map on every event (O(n) per stream event). Sibling stores use a private `_x = signal` plus
   public readonly/asReadonly or computed (agent-monitor.store.ts:667-731). Make it `private readonly _entries` +
   `readonly entries = this._entries.asReadonly()`, and make SubagentExecutionEntry fields `readonly`/expose a
   readonly view type; keep the mutable shape internal. Today any consumer can call `entries.set` or mutate
   `entry.finalized`.
3. Public API too wide / leaking internals. index.ts exports SubagentExecutionEntry whose public fields include
   internals (`idAlias: Map`, `generation`, `refs`, `revision`, `lastEventAt`). `historyEventsSeen(_event)` (:180) is a
   public no-op stub called from history-message-builder.service.ts on the hot replay path; it either carries
   behaviour or should not exist (dead seam, misleading name; a reader assumes it records something). `finalize`,
   `retain`, `release`, `syncRecord`, `treeFor` are all public with no doc comment on which are consumer API versus
   internal wiring. Split entry into a public view type and an internal record.
4. Prettier fails on the new files (store, store spec, index.ts). The store is written in a dense, multi-statement
   per-line style (e.g. :14-21, :76-80, :146-148, :396, :414) that the formatter would reflow; this inflates
   apparent line density and hides complexity. Run `npx prettier --write` on the three files.
5. Magic numbers and unexplained constants. ENTRY_CAP/LIVE_CAP/FINALIZED_CAP/OWNER_CAP (:14-17) have no comment on
   units or rationale; `256 * 1024` (:351) inline maxBytes; status list `['completed','failed','killed','stopped']`
   (:95) and the two event-type lists (:396, :414) are inline literals duplicated in intent (the 414 list is the
   396 list plus message_start). Name them (`TERMINAL_STATUSES`, `BLOCK_EVENT_TYPES`) and reuse an existing
   terminal-status helper if agent-monitor.store has one.
6. Growth inside already large files instead of a facade. streaming-handler.service.ts is 781 lines and
   stream-router.service.ts 998; B4 adds only 5 and 4 lines there (acceptable), but history-message-builder gains a
   14-line inline sub-agent scratch branch (subagentMessageIds / subagentScratch) in the hot replay loop, and
   stream-router now calls `subagentExecution.clearSession` next to every agentMonitorStore clear (two sites,
   :296 and :961). Cleanup of per-session agent state is now spread across three stores at two call sites; add one
   `clearSessionAgents` fan-out (the existing facade for agent-monitor/background cleanup) rather than a third
   parallel call, to avoid drift when a third site appears.

## Minor

1. subagent-execution.store.ts:242-243 `starts.keys().next().value!` non-null assertions; use a small
   `evictOldest(map, cap)` helper (also usable by own() at :110-118 which does the same FIFO by hand).
2. :350 `entry.sessionId!` after a guard in a different function; pass sessionId as a parameter.
3. :180 unused `_event` parameter signals a placeholder; remove or implement.
4. Logger use is consistent with LoggingService (error :175, warn :108/:381) but the error at :175 swallows to
   `false` and drops the event silently apart from the log; document that contract on claim().
5. Naming: file `subagent-execution.store.ts` follows kebab + role suffix (matches agent-monitor.store.ts).
   `SubagentHistoryState` value 'unresolved' vs 'not-found' needs a one-line doc.

## B3a/accumulator-core
`skipStoreEffects` (accumulator-core.service.ts, AccumulatorContext) is a reasonable flag, but it is now checked at
about nine switch sites (agent_start, tool_result, message_start usage, background_*, agent_*). Acceptable but a
future branch will forget it; consider a single `storeEffects` object that is a no-op implementation for the store
path. Minor, not required now. The baa2cb740 hunk re-indents registerAgent under the guard with no behaviour
change otherwise; fine.

## Five questions
1. Six months: a new event type that must be store-only means editing STORE_ONLY (:18) and the accumulator switch
   separately; retention caps are global constants.
2. Misread: `historyEventsSeen` looks like it records replay events; `entries` looks immutable but entries mutate.
3. Maintenance: whole-Map copy per event, five parallel maps keyed by entry key that must all be cleaned in remove()
   (:123-134); a missed one leaks.
4. Inconsistent with: sibling stores' private-signal + readonly pattern; single-line formatting vs prettier.
5. Different: extract ownership index and history merge, keep the store as thin orchestration, expose a readonly
   view type.

## Pattern compliance
| Rule | Status | Evidence |
| --- | --- | --- |
| providedIn root + inject() | PASS | store :44-54 |
| readonly public signal surface | FAIL | store :57 |
| public aliases / barrel only | PASS | stream-router import, store imports |
| dependency direction routing -> streaming | PASS | stream-router |
| no any / ts-ignore | PASS | grep clean (two `!` assertions) |
| kebab-case + role suffix | PASS | file names |
| formatter clean | FAIL | prettier --check warns on 3 files |
| file size / single responsibility | FAIL | store 437 lines, 6 concerns |

## Verdict
CHANGES REQUESTED, confidence MEDIUM-HIGH. Key concern: a 437-line unformatted store with a writable public signal
over mutable entries and a no-op public seam. A 10/10 would split ownership/history-merge/retention, expose a
readonly view, format the files, name the constants and use one cleanup fan-out.
