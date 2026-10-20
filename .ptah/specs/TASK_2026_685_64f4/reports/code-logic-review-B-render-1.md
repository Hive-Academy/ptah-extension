# Code Logic Review — TASK_2026_685_64f4, phase B-render (part 1)

Scope: 4e4198193 (B5a lane + canvas), a5ac376f5 (B5b bubble + tile), 479009c5b (spec fallout),
8894470c8 (B5b.4 nested chips). Store consumers checked against the current
`subagent-execution.store.ts` (6205bae6b). Specs run (scoped, `--maxWorkers=2`): subagent-lane,
inline-agent-bubble, subagent-tile, transcript-agent-facts: 4 suites, 72 tests, all pass.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | NEEDS_REVISION (light) |
| Blocking | 0 |
| Moderate | 5 |
| Minor | 5 |

Why 7: every state line, the P1/P2/P3 decisions, the cycle break and the canvas cleanup are
implemented and match the plan. The defects are lifecycle and wiring edges (a retain effect that
re-runs on every record update, a dead "Load agent output" button, no feedback after the click)
and cost that now scales with every store publish. Nothing loses data or misleads on the main path.

## Plan checklist

| Item | Result |
| --- | --- |
| Lane states live / loading / loaded-empty / not-found / unresolved / error / truncated / clipped | OK `subagent-lane.component.ts:82-105`. Retry only on error and unresolved, `not-found` has none (matches plan). No loop: auto-load fires only on `live=false && history==='idle'` (`:166-170`); every outcome leaves `idle`. No timer or observer. |
| One retain per mount, release on destroy | Lane: see M1 (re-runs per record update). Bubble: OK, keyed on a `computed` string (`inline-agent-bubble.component.ts:677-682`), so no re-run on node updates. |
| ensureHistory only when not live and not loaded | Lane OK (`:169`). Bubble: user-triggered only, OK. |
| P1 | OK. Header uses `summary().toolCount \|\| record.toolUses` (`:27`); summary util counts the parent's own tools. Spec added. |
| P2 | Present (`:436-438`) but see M2 and M3. |
| P3 | OK. `displayChildren` uses the store tree when non-empty, else `node.children` (`:919`), so summary-chunk text never renders twice. |
| hasChildren / childStats fallback | OK (`:845-872`). Cosmetic: "1 tools". |
| Import cycle | Still broken. The bubble imports only `SubagentExecutionStore` from chat-streaming and stamps `nodeTemplate`. |
| Canvas lane view | OK. No tab/tree-builder/transcript members left (grep clean). Passes `record` + `sessionId`. Header, steer, Stop/Background, permissions and Escape back are untouched code. |
| Nested chips: cycle guard, top-level precedence, parent turn, reactivity | OK (`transcript-agent-facts.ts:14-38`, `transcript-turn-contexts.ts:147-163`). Gaps below. |
| `$agents` source includes nested agents | OK (`transcript-ptah-ui-host-sources.ts`), with M5. |
| Spec fallout 479009c5b | Intent kept and strengthened: tab keeps only `agent_start` (`['seed-agent-start']`), the continuation lives in the store, text appears exactly once through `treeFor`, and after finalize it is absent from the finalized tab message and still once in the store. Not weakened. The large diff is formatting only. |

## Moderate

### M1. Lane retain effect re-runs on every record update
`subagent-lane.component.ts:160-164`. The effect reads `this.record().parentToolUseId`, so it
depends on the `record` signal, not on the key. `AgentMonitorStore` replaces the record
immutably on each update (`agent-monitor.store.ts:1871+`). Each update therefore runs
release then retain on the same key. Consequences:
- Each pair publishes `entries()` twice (`store.ts:173-195` publishes in both) and `release`
  also runs `evictFinalized`. For a live agent this happens on every progress or usage tick.
- If the lane is the only holder and history is `loading`, `release` takes refs to 0 and calls
  `abort()` (`store.ts:181-183`, `:269-275`). The in-flight load is cancelled and restarts via
  the third effect. A record update during a load wastes the page fetches.
- `release` at refs 0 may evict this very entry when over `FINALIZED_ENTRY_CAP` (20), and `retain`
  then reopens it empty, losing the finalized tree until history reloads.
The spec (`:150-156`) only covers a stable record, so it misses this. Fix: compute
`const key = computed(() => this.record().parentToolUseId)` and read that in the effect, as the
bubble does.

### M2. "Load agent output" is a dead button when the entry has no `sessionId`
`inline-agent-bubble.component.ts:926-929`, `:677-682`, `store.ts:201-211`. The bubble calls
`retain(key)` and never passes a session id. The entry gets one only through `syncRecord` from a
monitor record. `ensureHistory` returns silently when `!entry.sessionId`. For a restored bubble
with no matching record (or one without `parentSessionId`), the button shows, the click does
nothing, and the history stays `idle`. Fix: give `retain` or the bubble a session id (the
transcript knows it), or hide the button without a resolvable session.

### M3. No feedback after "Load agent output"
`inline-agent-bubble.component.ts:436`, `:920-925`. While `loading` the button disappears and the
body shows nothing (the "No children" branch). On `not-found` or `unresolved` it disappears for
good and the body is empty with no explanation. On `error` the button silently reappears with no
message. The plan only requires the button for the bubble, but P2 is a user-approved fetch-on-click
path, and a click that ends in an unexplained empty body reads as a silent failure. Fix: render the
lane's state lines (loading, error with Retry, not-found, unresolved) next to the button, or reuse
a shared state component.

### M4. Nested agents under a background top-level agent are dropped from `$agents`
`transcript-agent-facts.ts` (`collectTree`, around `:149-160`; nested pass around `:107-123`).
`seenAgentKeys` is filled only for foreground agent nodes, and the nested pass is skipped when
`turn.nodes.length === 0`. A turn whose only top-level agent is background gets no nested walk, and
nested foreground agents of a background parent are never reached. The chips path
(`turnAgentKeysOf`) does include background top-level keys, so chips and `$agents` disagree. Fix:
seed the walk from every agent key in the turn (`spawnToolCallIds` already holds them) and drop the
`nodes.length === 0` guard.

### M5. Store publishes now re-run whole-session derivations
`entries()` is a fresh `Map` on every `publish` (`store.ts:128-130`), including each streamed
sub-agent event. These now depend on it:
- `turnAgentKeys` in the transcript (`chat-transcript.component.ts:~721`) walks every store tree of
  every turn that has an agent.
- The `$agents` `turnFacts` (`transcript-ptah-ui-host-sources.ts`) redoes `collectTurnAgentFacts`
  for all turns.
- Each bubble and tile `storeTree` calls `treeFor` and returns a new array, so
  `displayChildren`, `childStats` and the tile counts recompute for every agent on any agent's event.
Cost grows with session length and agent count per streamed delta. Also, `treeFor` bumps `lastRead`
(`store.ts:~168`), so these whole-session reads mark every entry recently used and blunt the LRU
eviction order. Mitigate by comparing the entry's `revision` per key (it exists but is unused here)
in a per-key `computed`, and by using a non-touching read for derivations.

## Minor

- m1. Nested chips and `$agents` for nested agents exist only while the parent's store entry is
  resident. After restore the store is empty, so nested chips appear only once the parent's history
  has been loaded. Unretained finalized entries are evicted beyond 20, after which an open nested
  in-place view closes with "no longer available" (`chat-transcript.component.ts:963-973`,
  `findSubagent`). Consistent with the Risk 12 choice but not documented in the batch report.
- m2. The tile fallback order changed: `lastToolName` now precedes `latestSummary`
  (`subagent-tile.component.ts`, activity computed). The plan only asked for the store tree first;
  this reorders the existing fallback.
- m3. Tile `activity` can return the full text of a long text node; it needs truncation or CSS clamp.
- m4. `"1 tools"` pluralisation in `childStats` (`:846-848`).
- m5. The lane shows `finishedSummary` (`record.latestSummary`) above a store tree that may end with
  the same final text (`:79-81`). P3 specified this only for the bubble; check the visual pass for
  duplicate text.

## Five logic questions

1. Silent failure: M2 (dead button), M3 (not-found and unresolved hidden in the bubble). The lane
   shows every history state.
2. Unexpected user action: a clicked "Load agent output" that vanishes (M3). Switching the selected
   sub-agent in the canvas reuses the lane instance; the effect handles it (M1 aside).
3. Wrong answer from input: M4 (`$agents` count misses nested agents under a background parent).
4. Dependency failure: `subagent:history-page` errors land in `history='error'`. The lane shows
   Retry, the bubble does not explain (M3).
5. Missing: a non-touching store read, an explicit "restored session shows no nested chips until
   loaded" note, and a spec that updates the record while the lane is mounted.

## Verdict

NEEDS_REVISION (light), no Blocking. Fix M1 first (one line, with a spec) and M2/M3 together.
M4 is a small guard change. M5 can follow in the perf pass. Confidence: MEDIUM-HIGH. M1 and M5
rest on reading the signal graph, not on a run. I did not run the canvas, transcript or
host-sources specs.
