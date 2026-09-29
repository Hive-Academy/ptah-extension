# Code Logic Review — PR #605 CodeRabbit Follow-up, Round 1 (`TASK_2026_575_74a4`)

> **SAME-SIDE DISCLOSURE**: This review was performed by an in-process
> subagent, not an independent CLI lane. All CLI lanes were unavailable at
> review time (Codex: usage limit; Glm/Ollama: session limit; Antigravity:
> quota; opencode: error). The independence guarantee normally provided by a
> separate vendor lane does not apply to this review.

Scope: re-review of Fix 2 (`apps/ptah-tui/src/hooks/use-sessions.ts` +
`use-sessions.spec.ts`) after the executor addressed the Serious and
Moderate findings from `code-logic-review-pr605-coderabbit.md`. Fixes 1 and 3
are unchanged from round 0 and are not re-reviewed here.

## Summary

| Metric              | Value                                   |
| -------------------- | --------------------------------------- |
| Overall score        | 8/10                                    |
| Assessment            | APPROVED                                |
| Blocking issues       | 0                                       |
| Serious issues        | 0                                       |
| Moderate issues       | 2 (both pre-existing, not introduced or worsened by this round) |
| Failure modes found   | 0 newly introduced; 2 residual, out-of-scope pre-existing gaps confirmed |

Both round-0 findings are fixed and verified against the actual code and a
passing test run (23/23). `handleStats` now applies a push only when it names
the active session; a push while no session is active is held per-session-id
and only the entry matching the session that actually resolves is replayed;
`pushGeneration` now only advances on an *applied* push, so it is
transitively scoped to the active session. The two items the executor left
open — `handleIdResolved` ignoring `tabId`, and the previous session's stats
staying visible during the `activate → seedStats` window — are both real but
pre-existing (present before round 0 touched this file) and not worsened by
this diff. Neither blocks approval of this round; both are worth a follow-up
ticket.

## Verification of the round-0 findings

### Serious: "pushGeneration guard is not scoped to the seeded session" — FIXED

`apps/ptah-tui/src/hooks/use-sessions.ts:356-380`

```ts
private handleStats(payload: unknown): void {
  const push = payload as SessionStatsPush;
  if (!push.sessionId) return;
  if (this.activeSessionId === null) {
    this.unresolvedPushes.set(push.sessionId, push);
    return;
  }
  if (push.sessionId !== this.activeSessionId) return;
  this.applyPush(push);
}

private applyPush(push: SessionStatsPush): void {
  const next = deriveStats(push, this.stats);
  if (!next) return;
  this.pushGeneration++;
  this.stats = next;
  this.onChange();
}
```

- A push naming a session other than `this.activeSessionId` now returns
  before `applyPush`, so it never increments `pushGeneration` and never
  overwrites `this.stats`. This directly closes the round-0 trace: a
  background/other-session push arriving while the active session's seed is
  in flight can no longer bump `pushGeneration` out from under that seed, and
  can no longer paint the wrong session's numbers over the active one.
- `pushGeneration` is only ever incremented inside `applyPush`
  (`use-sessions.ts:376-380`), which is reached from `handleStats` only when
  `push.sessionId === this.activeSessionId`, and from `handleIdResolved` only
  for the held push matching the just-resolved id (see below). So the guard
  captured in `seedStats` (`:307-333`) is now transitively scoped to the
  session being seeded — exactly the fix requested.
- New test `applies the active seed when a push for another session arrives
  meanwhile, never showing it` (`use-sessions.spec.ts:552-566`) reproduces the
  exact round-0 scenario: `loadSession('a')` starts a seed, a push for `'b'`
  arrives mid-flight, and the assertions confirm (1) `c.stats?.sessionId` is
  never `'b'` at any point and (2) `a`'s seed still applies with its own
  values once the batch resolves. This is not tautological — it fails against
  the round-0 code (which had no per-session filter in `handleStats`) exactly
  the way the round-0 review predicted.
- Ran the suite directly: `apps/ptah-tui/src/hooks/use-sessions.spec.ts` →
  `23 passed, 23 total`, matching the executor's claim.

### Moderate: "handleStats accepts a push for any session regardless of activeSessionId" — FIXED

`apps/ptah-tui/src/hooks/use-sessions.ts:356-362`

- The `push.sessionId !== this.activeSessionId → return` branch closes this
  directly. The previously-pinning test "does not carry one session cost over
  to another session" (`use-sessions.spec.ts:184-201` in the diff) is not
  loosened to hide a regression — it is legitimately adapted: it now calls
  `c.setActiveSession('s2')` before emitting the push for `'s2'`, because
  under the new (correct) contract a push for a session that was never
  activated must no longer change `this.stats` at all. The adapted test still
  asserts the same end state (`stats.sessionId === 's2'`,
  `costUSD === null`), it simply establishes that state through the
  now-required activation step rather than through an unscoped push — this
  is fixing the test to match the corrected contract, not weakening the
  assertion.
- New test `a push for a non-active session never changes stats`
  (`use-sessions.spec.ts:520-533`) explicitly asserts identity equality
  (`expect(c.stats).toBe(before)`) after a push for a different session,
  which a silently-accepted cross-session push would break.

## New-session / held-push path

The executor added a `Map<string, SessionStatsPush>` (`unresolvedPushes`) to
cover the window where `activeSessionId === null` (a brand-new session whose
real id has not yet arrived via `session:id-resolved`), plus a private
`activate(id)` that both sets `activeSessionId` and clears the map, used
consistently by `loadSession`, `deleteSession`, `setActiveSession`, and
`handleIdResolved` (`use-sessions.ts:292, 349, 362-366, 398-405`).

**Bounded / no leak.** The map is cleared on every `activate()` call
(`use-sessions.ts:363-366`), i.e. on every session switch, every new-session
request, and every id resolution — so it cannot accumulate across the
session's lifetime; it can only hold, at most, one entry per distinct session
that pushed during the current "no active session" window, and that window is
opened by an explicit user action (new session / `setActiveSession(null)`)
and closed by the next `activate()`. Not unbounded growth.

**No cross-session leak on resolution.** `handleIdResolved`
(`use-sessions.ts:395-405`):

```ts
private handleIdResolved(payload: unknown): void {
  const data = payload as SessionIdResolvedPayload;
  if (data.realSessionId && data.realSessionId.length > 0) {
    const held = this.unresolvedPushes.get(data.realSessionId);
    this.activate(data.realSessionId);
    if (held) this.applyPush(held);
    this.onChange();
  }
}
```

`held` is looked up **before** `activate()` clears the map, and only the
entry keyed by the *resolving* session's id is ever replayed — a held push
for an unrelated background session (a different key in the map) is simply
discarded when `activate()` clears it, never applied. Verified by
`keeps a push that arrives before its session id resolves and shows it on
resolution` (`use-sessions.spec.ts:568-577`): a push for `'new'` and a push
for `'background'` both arrive while inactive; only `'new'`'s push is shown
once `'new'` resolves, and `'background'`'s is silently dropped, not queued
for later or ever applied to the wrong session.

**Ordering claim (id-resolved before any result push) — verified.** Traced
`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`: the
`isSystemInit(sdkMessage)` branch that calls `onSessionIdResolved(tabId,
realSessionId)` (`:472-476`) is reached inside the same `for await` loop over
SDK messages strictly before the `isResult` branch that calls `onResultStats`
(`~:775` onward) — `system_init` is always the first SDK message of a run,
`result` always later, and the loop processes messages one at a time in
arrival order, so for a single turn the callback invocation order is
guaranteed. `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:26-30`
confirms `sendMessage`/`broadcastMessage` call `this.dispatch(type, payload)`
synchronously (no queuing, no separate tick), so the two backend callbacks
translate into the same order of `pushAdapter.emit(...)` calls the TUI
receives. The claim holds for the case that matters (a session's first push).
The held-push map is then correctly understood as defense-in-depth for an
out-of-order case that the traced code does not actually produce today, not
as covering for a known-broken ordering.

**"new session sets active to null" claim — verified.**
`apps/ptah-tui/src/components/sidebar/Sidebar.tsx:38` (`setActiveSession(null)`
in `handleCreate`) and `apps/ptah-tui/src/components/App.tsx:236`
(`setActiveSession(null)` on the `meta+n` chord) both confirmed by direct
read; both routes go through `SessionController.setActiveSession` →
`activate(null)`, opening the held-push window intentionally.

## The two items the executor left open

### 1. `handleIdResolved` ignores `tabId`

`use-sessions.ts:395-405`, `SessionIdResolvedPayload` (`:56-59`) carries
`tabId`, but the handler only reads `realSessionId`. This is **pre-existing**
— the original code before either round also did `this.activeSessionId =
data.realSessionId` unconditionally, with no `tabId` check. There is no
other `tabId`-aware state anywhere in this file or in the TUI app's session
plumbing (`grep` across `apps/ptah-tui/src` for `tabId` outside this file and
its spec returns nothing), consistent with the TUI modelling one active
session at a time rather than the VS Code webview's multi-tab model.

Judgment: **plausible latent bug, not introduced or worsened by this round**.
Concretely: if a user opens a new session (`activeSessionId → null`), and
before its `system_init`/id-resolution arrives triggers a *second* new
session (`activeSessionId → null` again, clearing `unresolvedPushes`), then
the *first* session's `session:id-resolved` event still arrives untagged by
which "new session request" it belongs to and will call `activate(id-1)`,
silently reactivating the abandoned first session instead of leaving the
controller pointed at the second, still-unresolved one. This requires two
rapid new-session actions before the first resolves — a narrow but not
implausible fast-typing scenario in a terminal UI. It is unchanged in shape
and severity from round 0 (the round-0 code had the identical gap); this
round's `held`-push replay makes the *symptom* slightly more visible (a held
push for the wrong session, if one arrived, is now actively re-painted into
`this.stats` at the moment of the stray `activate`, rather than only
flipping `activeSessionId` and waiting for the next push) but does not
create the underlying defect. Recommend a follow-up ticket to have
`loadSession`/the new-session flow track a pending-tab token and have
`handleIdResolved` ignore an id-resolution for a `tabId` that is no longer
the one currently awaited. Not blocking for this round, since it is outside
the CodeRabbit finding this batch was scoped to fix and behaves no worse than
before.

### 2. Previous session's stats stay visible until the new seed/push arrives

`use-sessions.ts:276-295` (`loadSession`): `this.activate(id)` runs
synchronously (updates `activeSessionId`, clears `unresolvedPushes`)
*before* `await this.seedStats(id)` resolves. Between those two points,
`this.stats` still holds the **previous** session's `SessionStats` object
(with its own `sessionId`, `costUSD`, `inputTokens`, etc.), while
`activeSessionId` already names the new session.

Traced the only consumer: `apps/ptah-tui/src/components/layout/StatusBar.tsx:51-66`
passes `stats` straight into `deriveStatusLine`
(`apps/ptah-tui/src/lib/status-line.ts:104-127`), and `StatusLineStats` /
`StatusLineInput` (`status-line.ts:14-36`) carry **no `sessionId` field at
all** — the session *label* comes from `activeSessionId`/`sessionName`, but
the cost/token figures come unconditionally from whatever `stats` object is
current, with no check that it belongs to the same session as the label.
`SessionController.loading` is `true` for this entire window
(`use-sessions.ts:277-278` through the `finally` at `:305-308`) but is not
part of `StatusLineInput` and is not consulted anywhere in the traced path to
suppress or grey out the stale figure.

Judgment: **real, but pre-existing and transient** — this gap exists
identically before round 0 (the old code also did
`this.activeSessionId = id;` synchronously then `await this.seedStats(id)`
unconditionally overwriting `this.stats` at the end); neither round of this
batch's fix touches the `activate`-then-`await seedStats` ordering. The
window is bounded by a single `session:stats-batch` RPC round trip (typically
tens to low hundreds of milliseconds locally), and it does self-correct as
soon as the seed resolves or a push for the new session arrives — it is not
a permanent or silently-diverging state. It does, however, match the shape
of bug this task exists to eliminate (a session's identity shown with
another session's money), so it is worth flagging even though it predates
this diff. Recommend either clearing `this.stats` (or setting a
`stats.sessionId`-tagged sentinel) synchronously in `activate()` when the id
actually changes, or having `StatusLineInput`/`deriveStatusLine` accept and
check a `sessionId` on `stats` against `activeSessionId` and suppress the
cost/token fields on mismatch. Not blocking for this round — it is outside
the CodeRabbit finding this batch was scoped to fix, and is no worse than
before.

## Five logic questions (delta from round 0)

### 1. How does this fail silently?

Round-0's cross-session silent overwrite is closed. The two residual items
above are the only remaining silent-display gaps, both pre-existing.

### 2. What user action produces unexpected behaviour?

Two rapid new-session actions before the first resolves (item 1); switching
sessions and reading the status bar within the same RPC round trip as the
switch (item 2, self-correcting).

### 3. What input data produces a wrong answer?

None found in the round-1 diff itself.

### 4. What happens when a dependency fails?

Unchanged from round 0 — `session:stats-batch` rejection still correctly
falls through to `next = null` and the same generation/session guard applies
it or not (`use-sessions.ts:307-333`), now additionally protected from a
concurrent other-session push corrupting `pushGeneration`.

### 5. What is missing that the requirements never mentioned?

A test for the `tabId`-ignored double-new-session race (item 1) and for the
`activate`-before-`seedStats` stale-display window (item 2) — both
legitimately out of this batch's scope, tracked as follow-ups above rather
than as gating findings.

## Moderate and minor issues

- Moderate (pre-existing, not introduced this round): `handleIdResolved`
  ignores `tabId` — `use-sessions.ts:395-405`. See item 1 above.
- Moderate (pre-existing, not introduced this round): the previous session's
  stats remain visible, unlabelled as stale, for the duration of
  `activate()` → `seedStats()` resolution — `use-sessions.ts:276-295`,
  rendered without a session check in `apps/ptah-tui/src/lib/status-line.ts:104-127`.
  See item 2 above.
- Minor: `unresolvedPushes` (`use-sessions.ts:224-229`) is a plain `Map` with
  no explicit size cap; bounded in practice by `activate()` clearing it on
  every session-change/new-session action, so this is not a realistic growth
  concern, only worth a one-line comment if it is ever reused in a context
  without that clearing discipline.

## Data flow (delta)

1. `loadSession(id)` → `activate(id)` (sets `activeSessionId`, clears
   `unresolvedPushes`) → `seedStats(id)` starts, capturing
   `seed`/`pushGeneration` → OK, same as round 0.
2. `handleStats(payload)`: no `sessionId` → dropped. `activeSessionId ===
   null` → held per-session in `unresolvedPushes`. `sessionId !==
   activeSessionId` → dropped. Otherwise → `applyPush` → OK, closes the
   round-0 gap.
3. `applyPush`: `pushGeneration++`, `this.stats = next` → OK, now reachable
   only for the active session (or the just-resolved one via
   `handleIdResolved`).
4. `handleIdResolved`: captures `held` for the resolving id before
   `activate()` clears the map, replays only that entry → OK, no
   cross-session replay possible.
5. `seedStats` continuation: `seed`, `pushGeneration`, `activeSessionId`
   checks → now transitively scoped correctly, since `pushGeneration` can
   only have moved because of a push that belonged to the same active
   session → OK.
6. Gap (pre-existing, item 2): between step 1's `activate(id)` and step 5's
   eventual `this.stats = next`, `this.stats` still names the previous
   session while `activeSessionId` names the new one, and the one consumer
   traced (`StatusBar`/`status-line.ts`) does not check for the mismatch.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Round-0 Serious: scope `pushGeneration` to the seeded session | COMPLETE | None found |
| Round-0 Moderate: `handleStats` must not accept/display a push for a non-active session | COMPLETE | None found |
| New session's first push must not be lost across the id-resolution race | COMPLETE | None found; ordering claim verified and held-push path is defense-in-depth |
| (Out of scope, flagged by executor) `handleIdResolved` should use `tabId` to disambiguate concurrent pending sessions | NOT ADDRESSED | Pre-existing; narrow double-new-session race remains |
| (Out of scope, flagged by executor) stats should not show the previous session's numbers under the new session's identity during the load window | NOT ADDRESSED | Pre-existing; transient, self-correcting |

Implicit requirements not addressed: none beyond the two items above, both
explicitly called out by the executor as left open.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Push for a different session while the active session's seed is in flight | YES | `handleStats` filters by `activeSessionId` before `applyPush` | None |
| Push for the active session while its own seed is in flight | YES | `pushGeneration` guard in `seedStats` | None |
| New session's first push races its own `session:id-resolved` | YES | held-push map + ordering guarantee traced in the backend | None |
| Background session's push while a different session is being created (`activeSessionId === null`) | YES | held per-id, discarded on `activate()` unless it matches the resolving id | None |
| Two new-session requests before the first resolves | NO | — | `handleIdResolved` ignores `tabId`; pre-existing, narrow, flagged for follow-up |
| Session switch's stats display during the `activate → seedStats` await window | NO | — | Previous session's numbers shown under the new session's label; pre-existing, transient, flagged for follow-up |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none newly introduced by this round; the two residual gaps
  (`tabId` ignored, stale-stats display window) are pre-existing, unchanged
  in severity, and were explicitly disclosed by the executor rather than
  hidden — recommend tracking both as a follow-up rather than reopening this
  batch.
- What a robust implementation would add: a pending-tab token so
  `handleIdResolved` can reject a resolution for an abandoned new-session
  request, and either an eager `this.stats = null` in `activate()` or a
  `sessionId`-aware check in `deriveStatusLine` so the status bar cannot
  show one session's money under another session's label even for the
  duration of a single RPC round trip.
