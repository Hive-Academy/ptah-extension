# Batch 6 report — TASK_2026_626_7b3e (chat-state)

Executor: frontend-developer. No git commands run; batches.md not edited.

## Task 6.1 — `isValidSessionStatsSnapshot` accepts `provisional` — implemented

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-state/src/lib/session-stats-snapshot.ts`
  - Adds `isOptional(value['provisional'], isBoolean)` to the final conjunction and a private
    `isBoolean` helper; doc comment lists the new check. `SessionStatsRevisionFloor` unchanged.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-state/src/lib/session-stats-snapshot.spec.ts`
  - absent / `true` / `false` accepted; `'yes'`, `1`, `null`, `{}` rejected;
    floor admits live r5, admits authoritative r6, then rejects a later live r4.

## Task 6.2 — `TabManagerService.installLiveSessionStats` — implemented

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  - Imports `normalizeModelKey` from `@ptah-extension/shared` (exported by the barrel; `pricing.utils.ts:292`).
  - New public `installLiveSessionStats(tabId, snapshot, context?): boolean` placed after
    `installSessionStats`:
    1. `if (!this.acceptSessionStats(tabId, snapshot)) return false;` — the same admission, called once.
    2. Context branch only when `snapshot.provisional === true && context`: private
       `liveContextStats` reads the tab's current `liveModelStats`, requires
       `normalizeModelKey(prior.model) === normalizeModelKey(context.model)`, then returns
       `postCompactionContextStats(prior, context.contextTokens)` (prior capacity; `null` for
       non-positive / non-finite tokens).
    3. One `updateTabInternal` with `sessionStats: snapshot`, `...budgetPatch(snapshot, undefined)`
       (keeps the last budget) and `liveModelStats` only when step 2 produced a payload.
       Otherwise the fill is not touched (never written as unknown/null).
  - `installSessionStats` unchanged (still `void`).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
  - New `describe('installLiveSessionStats (TASK_2026_626)')` (tabs bound with `attachSession`):
    - admitted provisional r5 + 60 000 → returns `true`, exactly one `updateTabInternal` (spied),
      snapshot installed, fill 60 000 at prior capacity (200 000, 30 %);
    - model matched under `normalizeModelKey` (`Anthropic/Claude-Sonnet-4-5-20250929`);
    - out-of-order: authoritative r10 with fill 40 000, then provisional r8 with 90 000 →
      `false`, no `updateTabInternal` call, `sessionStats` and `liveModelStats` identical, fill 40 000;
    - invalid snapshot (`provisional: 'yes'`) and other session → `false`, no update, tab object identical;
    - unknown tab → `false`;
    - model mismatch, no prior `liveModelStats`, `contextTokens: 0` → `true`, snapshot installed, fill unchanged;
    - equal-revision (r10) authoritative snapshot with a 90 000 context while fill is 40 000 →
      `true`, fill stays 40 000;
    - budget installed with r3 is still the same object after a live r4 install.
  - Post-compaction behaviour: the existing `applyCompactionComplete` / `seedPostCompactionContext`
    cases cover it; `postCompactionContextStats` was not changed.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/fix-live-session-stats-a1634d3869cb/libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`
  - New case: `record(r10, live L)` then `record({ live: null, snapshot: provisional r8 })` →
    snapshot stays r10, `live` stays L.
- NOT modified: `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts`.

## Edge cases / risks handled

| Item | Handling |
| ---- | -------- |
| Non-admitted live payload writes nothing | Early `return false` before any read/write; spec asserts zero `updateTabInternal` calls and unchanged tab objects (out-of-order, invalid, other session, unknown tab). |
| `liveModelStats` only when provisional and model matches | Branch gated on `snapshot.provisional === true`, a prior `liveModelStats`, `normalizeModelKey` equality and a non-null `postCompactionContextStats` result; spec covers each negative. |
| Risk row 1 (late estimate overwrites final figures/context) | Revision floor via `acceptSessionStats`; tab-manager context gate is the last layer — equal-revision authoritative with stray context keeps fill 40 000 (spec). |
| Live install drops the budget | `budgetPatch(snapshot, undefined)` returns `{}`; spec asserts budget identity preserved. |
| Registry must not change | Only its spec gained a case; existing `record` semantics already keep r10 and L. |
| Memory rule (one heavy check machine-wide) | No jest/nx run by this executor, per the team-leader's instruction. |

## Verification

- `mcp__ptah__ptah_get_diagnostics` scoped to the five changed files: **0 errors in the requested files**.
  It also reported 21 pre-existing errors in sibling files this batch did not touch
  (`session-identity.spec.ts`, `tab-manager.history-window.spec.ts`, `tab-manager.intent-mutators.spec.ts`,
  `tab-manager.lifecycle.spec.ts`, `tab-manager.persistence.spec.ts`, `libs/shared/.../capability-id-codec.ts`);
  these come from the diagnostics tool's generic compiler settings (branded ids, ES target), not from this change.
- Jest / `nx typecheck` / `nx lint` for `@ptah-extension/chat-state`: NOT run by me (team-leader runs them
  serially). Commands are in batches.md "Batch 6 verification".

## Fix round

- `tab-manager.service.spec.ts`, case "installs the snapshot but writes no fill when the tab has no
  live reading": a tab that never had a live reading has `liveModelStats` `undefined`, not `null`.
  The case now captures `const fillBefore = tabOf(tabId)?.liveModelStats;` before the call and asserts
  `expect(tabOf(tabId)?.liveModelStats).toBe(fillBefore);` (replacing `toBeNull()`).
  `tab-manager.service.ts` not changed; no jest/nx run.

## Plan deviations

None. Helper `liveContextStats` is a private extraction for readability; there is still no public
method that applies context outside admission.
