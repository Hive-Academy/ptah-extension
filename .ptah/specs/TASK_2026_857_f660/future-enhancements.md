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
3. **Unseen off-then-on host-routing toggle** (row 29, `phase-b-fix-round2-report.md`). Fix round 2
   tracks the live setting value (`host-routing-config-tracker.ts`), so a change counts from the
   first read that sees it. If an off and an on both land before any read and an old assessment
   settles between them, that result is applied. The first late change event then resets it, but
   a hook in that short window can still inject the old `Routing:` reminder. A settings write that
   never fires a change event (settings-store path, failed persist) can also make the tracker skip
   the reset for a later unseen off/on pair. The settings UI does not send overlapping writes.
   Fix: a write-time configuration generation from the platform settings layer (port in
   platform-core), captured at admission and checked at settlement.
4. Minor: `HostRoutingSettingChange.switchChanged` (lane-routing) is no longer read by the
   coordinator; remove it or use it. Note: since fix round 2 a decision-model change while routing
   stays on also resets routing work (both keys are tracked).
5. **Stale `Routing:` reminder after a decision-model change** (row 31,
   `code-logic-review-phase-b-round3.md` new finding 1, Serious). Since fix round 2 a change from
   one valid decision model to another resets routing work, but the queue's owner gate checks only
   `isEnabled()`. A reminder that is queued, or already drained by a hook that waits on the handoff
   pointer, under the old model can still be injected. Latent before 87d090bfa. Fix: bind each
   routing reminder to a configuration generation, check it at drain and immediately before
   injection, and revoke drained entries when the generation changes (same fix as item 3).

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
