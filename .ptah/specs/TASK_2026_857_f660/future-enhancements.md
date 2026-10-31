# Future enhancements - TASK_2026_857_f660

Deferred items from the phase reviews of this task. Each was judged Moderate or Minor with no
config break or data loss, except the items under "Open defects". Sources are in this folder.

## Open defects (known, disclosed in the PR)

1. **Replayed early review counts twice** (decisions.md row 27, `code-logic-review-phase-a-round3.md`).
   An identical `ptah_outcome_report` review sent with a bare agent target before the implementer
   row exists, then again after the row lands, gets two report ids (`review:<agentId>|r`, then
   `review:<agentId>:<completedAt>|r`) and increments `reviseRounds` twice.
   Fix: when a held review joins a row, keep a receipt for both the alias id and the canonical id,
   or normalize both submissions to one stable event key before the receipt lookup. Add a
   two-store fixture that repeats identical tool arguments before and after the row lands.
2. **Second review turn by the same reviewer agent is a duplicate** (row 26, round 2 finding 1).
   The review report id is per (reviewed run, reviewer agent), so a later, distinct review turn of
   the same agent on the same run is dropped. Fix: a host-minted per-turn review event id shared by
   host capture and the MCP report path (stable on replay, new on a new turn). Items 1 and 2 have
   one shared fix: a stable review event identity.
3. FIXED in 923950f27: **Unseen off-then-on host-routing toggle** (row 29). A platform
   write-time routing configuration generation replaces the value tracker; admission captures it
   and settlement discards work from an older generation, including event-less writes.
4. FIXED in 923950f27: Minor `HostRoutingSettingChange.switchChanged` removed; the change event
   has no payload.
5. FIXED in 923950f27: **Stale `Routing:` reminder after a decision-model change** (row 31).
   Routing reminders carry their generation; the owner gate checks it at drain and again before
   hook injection.
6. FIXED after PR #872 CodeRabbit review: a provider without the method now falls back to a
   count of observed routing change events (`host-routing-setting.ts`), so stale-work detection
   stays on (event-timed only). Original note: Moderate (`code-logic-review-phase-b-round4.md`
   finding 1): the generation is an
   optional `IWorkspaceProvider` method. A provider without it reads a constant 0, which turns off
   stale-work detection for host routing (no reset on writes or change events). All three host
   providers implement it today and host routing is Electron-only. Making it required changes 30+
   spec doubles. Fix: make the method required, or warn once at construction when it is missing.
7. Deferred, Moderate (review round 4 finding 2): one counter covers both routing keys, and a
   same-value `set()` also bumps it, so re-saving an unchanged value resets every tab and drops
   queued routing reminders. Bounded (two keys, rare UI writes). Fix: bump only on an effective
   value change.

## Phase A - learning integrity (rows 25-27, `code-logic-review-phase-a.md`, `code-style-review-phase-a.md`)

- F5: a later producer never fills `role` or the mapped task kind.
- F6: task-kind classification has no global bound, and for subagents its input is the result,
  not the task.
- F7: closed-store review refusal (B8 D-B8-1).
- F8: exit-0 429 detection depends on the CLI putting the text in an `error` segment.
- F10: the held-runs index can be overwritten with a stale copy (codex round 2 confirmed that the
  journal prunes expiries on each update, so no wrong count was found).
- F11: the expired-hold ledger entry is written lazily.
- F13: `void this.laneCompletion.signal(...)` is not observed.
- Style 4: `reportedSubagentStopRow` is a row factory exported from the recorder service file.
- Style 6: magic numbers and lone constants in the process manager.
- `outcome-write-pipeline.ts` is over the 700-line lint warning (724 lines); split it.

## Phase B - host routing (row 28, `code-logic-review-phase-b-claude.md`, `code-logic-review-phase-b-lanes.md`, `code-style-review-phase-b.md`)

- Codex F3 (disputed): a follow-up held behind a turn in flight can receive the reminder from its
  own assessment. Optional: tag reminders with the producing turn and drain only earlier turns.
- Codex F4: a throwing setting read turns routing off with no log. Log a safe error class.
- Codex F5: closed tabs keep routing state and aliases until LRU eviction (cap 200). Prune on tab
  or session close.
- Pre-flight reuse does not check that the caller's `request` still matches the cached scope.
- `stored !== false` reads non-boolean values of `agentOrchestration.hostRouting` as on. Add a
  boolean advanced-setting descriptor so `settings:set` and `settings:import` validate the type.
- A reuse-miss counter, so model pre-flight calls that bypass the cache can be observed.
- Reminder queue: refresh alias recency on `put`, or clear aliases on session end.
- Log the scope-check failure class.
- Style: one exported `RouteDecideContext` type instead of the inline `{ readonly sessionKey?: string }`
  in three places; one source for the cap constants (coordinator and scope check); dotted role
  suffixes on two scope files; the duplicate `@ptah-extension/rpc-handlers` import in
  `expected-resolvable.ts`; barrel exports of concrete classes used only as types.
- `nonFatal` in the Electron quit chain logs `error.message`; switch to the error name if dispose
  ever handles prompt text.

## Phase C - blending and settings UI (row 19, `code-logic-review-phase-c.md`)

- "Host-routing toggle state races": F2 (stale no-model guard after mount) and F3 (an earlier Undo
  is lost when a later save fails).

## Not started

- CI and PR-merge outcome signals as an extra quality source for learned cells (the user listed
  them as optional later).
- Prettier: seven files in `apps/ptah-electron/src/activation/` and six older lane-routing specs
  fail `prettier --check` on main. They are outside this task.
