# Batch 15 — Review-Fix Report (Findings 1 + 2)

**Task**: TASK_2026_177 · **Input**: `code-logic-review-batch-15.md` (CHANGES REQUESTED, 1 blocking)
**Scope**: Finding 1 (blocking) and Finding 2 (non-blocking). Finding 3 and R6.2 untouched, deliberately.
**Verdict**: both findings fixed, both proved non-vacuous by deliberate failure, all gates green, nothing committed.

|                                                   | Before                    | After                                           |
| ------------------------------------------------- | ------------------------- | ----------------------------------------------- |
| `web-members`                                     | 45 suites / **922** tests | 45 suites / **933** tests (+11)                 |
| `web-panel-ui`                                    | 5 suites / **41** tests   | 5 suites / **41** tests (unchanged)             |
| `web-members` lint / typecheck                    | clean                     | clean                                           |
| `members-notifications.spec.ts` (live Playwright) | —                         | **10/10 passed**                                |
| `members-courses.spec.ts` (live Playwright)       | —                         | 11/12 passed (1 pre-existing env gap, see §6.3) |

Files changed — **four, all inside Batch 15's own untracked frontend**:

- `D:/projects/ptah-extension/libs/web/members/src/lib/state/member-notifications.store.ts`
- `D:/projects/ptah-extension/libs/web/members/src/lib/state/member-notifications.store.spec.ts`
- `D:/projects/ptah-extension/libs/web/members/src/lib/notifications/notifications-page.ts`
- `D:/projects/ptah-extension/libs/web/members/src/lib/notifications/notifications-page.spec.ts`

---

## 1. Finding 1 — the fix, and why this shape

### 1.1 What was wrong

15B's `countInFlight` was a **presence** gate: "a count read is running, so this one is redundant." That premise is only true for reads asking the **same question**. The reviewer's ordering breaks the premise:

```
t0  start()          → GET unread-count            (in flight, gen: irrelevant to a boolean)
t1  markRead('n1')   → POST n1/read
t2  write resolves   → refreshCount()  ── DROPPED, "one is already running"
t3  t0's response lands: 99  ─────────→ badge := 99   ← the PRE-WRITE count
```

The badge then held a wrong, higher number until the next 60 s poll tick or navigation. Confirmed exactly as the reviewer described; my six new tests all fail against the un-fixed store (§4).

### 1.2 What it is now — a write generation, not a dirty flag

Both properties the brief demands are kept:

- **no duplicate** for the same navigation — `start()` + immediate `NavigationEnd` still costs exactly one request;
- **no dropped refresh** that represents genuinely new state.

The mechanism is a monotonic `writeGeneration` that changes **every time the set of in-flight writes changes** (once when a write is issued, once when it settles), and a count read stamped with the generation it was issued in:

```ts
public refreshCount(): void {
  if (this.countReadGeneration !== null) return;

  const generation = this.writeGeneration;
  this.countReadGeneration = generation;

  this.api.unreadCount().subscribe({
    next: (summary) => {
      this.countReadGeneration = null;
      if (generation !== this.writeGeneration) { this.reissueStaleCount(); return; }
      this._unreadCount.set(summary.unreadCount);
    },
    error: () => {
      this.countReadGeneration = null;
      if (generation !== this.writeGeneration) this.reissueStaleCount();
    },
  });
}

private reissueStaleCount(): void {
  if (this.writing) return;   // RISK-AP: the write's own handler re-reads
  this.refreshCount();
}
```

The decision moves from **issue time** (where the answer is unknowable) to **settle time** (where it is): same generation → the read answers the question that was asked, use it; different generation → the write set moved underneath it, **discard the value and issue exactly one follow-up**.

Write bookkeeping is now funnelled through two helpers so the two counters cannot drift apart:

```ts
private beginWrite(): void { this.inFlightWrites += 1; this.writeGeneration += 1; }
private endWrite(): void   { this.inFlightWrites -= 1; this.writeGeneration += 1; }
```

`markRead`, `markAllRead` and `markManyRead` all call them. Nothing else touches either counter — asserted structurally (§4.2).

### 1.3 Why NOT the reviewer's first suggestion (a bare "dirty" flag)

The reviewer offered two shapes. **I took the second (request identity / monotonic sequence) because the first is unsound here**, and this is worth stating precisely rather than as a preference:

A bare dirty flag records _"a refresh was requested while one was in flight"_ — but that is **exactly what the de-duplication case looks like too**. `start()`'s eager fetch and the `NavigationEnd` for that same navigation are one suppressed request; a dirty flag would set on the second and re-issue a follow-up when the first resolved, turning the measured `[unread-count, unread-count, hub]` back into two requests and **breaking `member-notifications.store.spec.ts:281-306`, the test that pins 15B's fix**. The flag cannot tell "duplicate for the same navigation" from "refresh representing new state", because the distinguishing fact — _did the state change in between?_ — is not in it.

The generation **is** that fact, held in one integer. It is also the thing that is hardest to get wrong later, for three reasons:

1. It is checked at the **one moment the answer is knowable** (response landing), so there is no window where a stale value is briefly displayed and then corrected — the stale value never reaches the badge, so there is no flicker either.
2. It **cannot loop**: a follow-up is stamped with the _current_ generation, so it can only be stale again if the member performs another write. Bounded by user actions, and `http.verify()` in `afterEach` proves the chain stops (§4.1, test 6).
3. A new write path added in six months inherits the property **by construction**, because it must call `beginWrite`/`endWrite` to be visible to the poll at all — and a structural test fails loudly if it increments `inFlightWrites` directly instead.

The de-duplication 15B measured is untouched: two reads at the same generation still collapse to one request.

### 1.4 One case considered and deliberately left alone

A `NavigationEnd` that fires **while** a write is in flight still issues a count read (the poll yields to writes; the navigation refresh never has). That read can observe pre-commit state and land before the write settles, showing a transient higher number — pre-existing behaviour, identical before and after this change. It is **not** the reported defect and it self-corrects within one round trip rather than 60 s, because the write's own completion bumps the generation: if that read lands _after_ the write settles it is now discarded (an improvement), and if it lands before, the write's success handler re-reads immediately. Gating navigation refreshes on `writing` is a behaviour change beyond this finding's scope, so it was not made.

---

## 2. Finding 2 — the selection now outlives the round trip

`NotificationsPage.markSelectedRead()` cleared the checkboxes synchronously on click. On a `500` the store correctly restores the rows and the count — with the toolbar already gone, so the member watched the rows un-strike-through with no control left to retry from.

**Store** — `markSelectedRead` / `markAllRead` / `markManyRead` take an optional `onSettled?: (succeeded: boolean) => void`, invoked once: `true` on success (including the "nothing to send" case, where the selected rows were already read and there is nothing to retry), `false` after the rollback. A **callback, not a returned `Observable`** — these methods already subscribe on the member's behalf, so handing back a second cold stream would either issue the write twice or need a `share()` whose lifetime is a third thing to get wrong. It is optional, so `markRead` and every existing caller stay fire-and-forget and no existing test signature moved.

**Page**:

- success → `deselect(submitted)` drops **exactly the ids that were submitted**, not `clearSelection()`. The member can keep ticking rows while the request is in the air, and those ticks were never part of the request that already left; clearing wholesale would silently discard them. Pinned by a test.
- failure → the selection and the toolbar **stay**, so retry is one click.
- a `marking` signal disables the "Mark read" button while the write is outstanding (`[disabled]` + `aria-busy`). This is required by the change, not decoration: now that the selection survives the round trip, without it the member could submit the same rows twice.

Angular standards held: `ChangeDetectionStrategy.OnPush`, `signal()` + `computed()` + `inject()`, no `any`, no new `[innerHTML]`. The page's existing structural guards still pass — it reads no `unreadCount`, names no `IntersectionObserver`/`scroll`, and imports no markdown renderer.

---

## 3. What I did NOT touch, as instructed

- **Finding 3 / light-theme WCAG AA** — no alphas patched, `tailwind.config.js` untouched, the `expectOnlyKnownViolations` quarantine untouched.
- **`members-content.spec.ts`** — still absent from `git status` entirely (verified again at the end, §6.2).
- **15A's equivalence guard** (`page === 1 && !hasMore && total === items.length`) — intact; its three pinning tests are green. `markSelectedRead` still routes a provably-whole-inbox selection to `read-all`, and `onSettled` is threaded through that branch too so the page behaves identically on both.

---

## 4. Regression tests — 11 new, and the deliberate-failure proof

### 4.1 New tests

`member-notifications.store.spec.ts` — new describe `🔴 the de-duplication must not DROP a refresh that is needed` (7):

1. **the reviewer's exact ordering** — in-flight count read, then `markRead`, then the stale response landing. Asserts the badge is **never** 99, that exactly **one** follow-up is issued, and that the follow-up's value is what the badge shows. Also re-asserts `http.match(UNREAD_COUNT)).toHaveLength(0)` at the moment of the write, so the de-dup property is pinned inside the same test that pins the rescue.
2. **the same ordering through the BULK write** (`markSelectedRead` → `POST notifications/read`) — a sharper assertion, because the pre-write count `5` and the post-write count `4` differ: without the fix the badge reads 5 with the row struck through.
3. **the same ordering through `markAllRead`** — the late pre-write `6` must not overwrite the optimistic `0`.
4. **a stale read landing DURING the write** — discarded, and **no** follow-up while `writing` (RISK-AP); the write's own handler is what re-reads.
5. **a stale read that FAILS still owes the follow-up** — the write's authoritative re-read must not be lost because an unrelated request 500'd.
6. **anti-loop** — the follow-up settles the matter; `http.verify()` proves no third request.
7. **structural** — `inFlightWrites += 1` / `-= 1` appear exactly once each and `writeGeneration += 1` exactly twice, with anti-vacuity assertions that the identifiers exist at all.

`notifications-page.spec.ts` (4): a failed bulk write keeps the selection, the toolbar and the checkbox (and restores the row to unread); a failed `read-all` keeps it too (the other branch); the button is disabled while in flight; rows ticked during the flight survive its success.

**Kept green, unmodified**: `:281-306` (start + NavigationEnd = ONE request), `:308-321` (a later refresh does issue a new request), the two wedge tests, and both RISK-AP poll-skipped-during-write tests.

### 4.2 Deliberate-failure proof — actual output

**Proof A — the behavioural fix.** Neutralised both generation comparisons in `refreshCount` (reverting to bare presence-gating), leaving the tests untouched:

```
$ npx nx test web-members --skip-nx-cache --testPathPatterns="member-notifications.store.spec|notifications-page.spec"
Test Suites: 1 failed, 1 passed, 2 total
Tests:       6 failed, 99 passed, 105 total

● … › 🔴 an in-flight count read at the moment of a write cannot land as the badge
● … › 🔴 the same ordering through the BULK write
● … › 🔴 the same ordering through markAllRead
● … › 🔴 a stale read that lands DURING the write is discarded and NOT re-issued (RISK-AP)
● … › 🔴 a stale read that FAILS still owes the follow-up
● … › 🔴 the follow-up settles the matter — it does not re-issue forever
```

Exactly the six new behavioural tests went red and **nothing else** — which independently re-confirms the reviewer's "why the existing tests don't catch it" analysis: 99 pre-existing tests, including the whole dedup and RISK-AP families, pass against the broken store.

**Proof B — the structural test.** Separately, inlined the two counters in `markRead` so it bypasses `beginWrite`:

```
Test Suites: 1 failed, 1 total
Tests:       1 failed, 65 passed, 66 total
● … › 🔴 the write counter and the generation are mutated in ONE place each
```

**Restore, both times, byte-identical** (`git stash`/`checkout` are forbidden, so the file was copied to a scratch path outside the repo and copied back):

```
$ diff /tmp/b15fix/store.fixed.ts libs/web/members/src/lib/state/member-notifications.store.ts && echo "IDENTICAL"
IDENTICAL
$ md5sum libs/web/members/src/lib/state/member-notifications.store.ts
50b580af19641ffbf1de3e8b68f2db8d   ← identical to the pre-proof hash
```

All gates in §5 were run **after** the second restore.

---

## 5. Gates — actual output (`--skip-nx-cache`, explicit project lists, `nx affected` never used)

**Baseline, before any edit** (matches the reviewer's numbers exactly):

```
$ npx nx run-many -t test -p web-members,web-panel-ui --skip-nx-cache
  web-panel-ui   Test Suites: 5 passed, 5 total   Tests: 41 passed, 41 total
  web-members    Test Suites: 45 passed, 45 total Tests: 922 passed, 922 total
  NX   Successfully ran target test for 2 projects
```

**After the fix:**

```
$ npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui --skip-nx-cache

> nx run web-panel-ui:lint
  Linting "web-panel-ui"...
  ✔ All files pass linting
> nx run web-panel-ui:test
  Test Suites: 5 passed, 5 total
  Tests:       41 passed, 41 total
> nx run web-panel-ui:typecheck
  > npx ngc --noEmit --project libs/web/panel-ui/tsconfig.lib.json
> nx run web-members:lint
  Linting "web-members"...
  ✔ All files pass linting
> nx run web-members:typecheck
  > npx ngc --noEmit --project libs/web/members/tsconfig.lib.json
> nx run web-members:test
  Test Suites: 45 passed, 45 total
  Tests:       933 passed, 933 total

NX   Successfully ran targets lint, typecheck, test for 2 projects
```

`922 → 933` is exactly the 11 new tests; suite count unchanged (no new spec files, both additions went into the existing specs).

---

## 6. Live verification, and the working-tree re-derivation

### 6.1 Playwright, against the watch-mode server on `:3000`

I did not start a server; `nx serve` was already bind-mounted over the working tree and picked the change up. No process was stopped, by PID or otherwise.

```
$ npx playwright test --config=playwright.config.ts src/specs/members-notifications.spec.ts --reporter=list
  [e2e preflight] license server + Postgres reachable — proceeding.
  ok  1 … the inbox renders the member’s own rows, newest first (6.2s)
  ok  2 … NFR-S2 — bodyPreview is an ESCAPED TEXT NODE, never rendered markup (1.9s)
  ok  3 … 🔴 clause 2 — the nav badge reads the unread count and CLEARS without a reload (2.9s)
  ok  4 … 🔴 R9.7 — a PARTIAL selection costs ONE request and marks only those rows (6.4s)
  ok  5 … 🔴 RISK-AO — a hostile stored route is REFUSED and never leaves the origin (4.0s)
  ok  6 … a LEGITIMATE stored route navigates, so the guard is not refusing everything (2.2s)
  ok  7 … renders in operator-member (NFR-U5) (1.9s)
  ok  8 … renders in operator-member-light (NFR-U5) (2.0s)
  ok  9 … 🔴 clause 3 — axe is clean on the inbox, populated AND empty (8.1s)
  ok 10 … 🔴 a FAILED request renders the error cell, not "you are all caught up" (2.9s)
  10 passed (1.0m)
```

Test 3 is the live proof that the badge still clears through the real store after a real write, and test 4 that the deferred selection-clearing did not break the bulk toolbar flow against a real server.

I also re-ran the **request census** that measured the original double-fetch, since it is the direct live check that the de-duplication survived:

```
$ npx playwright test --config=playwright.config.ts src/specs/members-courses.spec.ts --reporter=list
  ok 12 … 🔴 the hub still issues exactly ONE member request, with a live course present (5.1s)
  1 failed, 11 passed (1.4m)
```

No throwaway Postgres fixture was needed beyond what the specs seed and tear down themselves, so there is nothing left behind.

### 6.2 The one failure is an environment gap, not a regression

```
x 11 … an admin CAN mark a question answered, and it renders a StatusBadge
  Error: E2E_ADMIN_EMAIL not set. Admin specs need a user whose email is in the
  server's ADMIN_EMAILS allowlist (§7).
    at ../support/fixtures.ts:77
```

It throws inside the `adminPage` **fixture**, before the browser touches any page, and the file it throws from is not in this diff. It is a missing local env var, deterministic, and unrelated to both findings — every member-facing test in the same file passed.

### 6.3 Foreign files — re-derived at the start AND at the end

The concurrent session **was active during this work**: `git status` gained `libs/frontend/editor/**` (6 files), `.ptah/specs/TASK_2026_173/tasks.md`, and three `.harvested.json` files between my first and last snapshot. I touched none of them, and none of `libs/shared/**`, `libs/backend/**`, `marketing/**`, `.commitlintrc.json`, `CLAUDE.md`, `apps/ptah-extension-*/**`, `apps/ptah-electron*/**`, or any `.ptah/specs/` folder other than this report's own. `members-content.spec.ts` remains absent from the modified list entirely.

**No git write of any kind was performed** — no `commit`, no `add`, no `stash`, no `checkout`. The revert/restore cycles in §4.2 used a scratch copy outside the repo precisely to avoid them.

---

## 7. Residual risk

- **The navigation-triggered refresh is still not gated on `writing`** (§1.4) — pre-existing, unchanged, self-correcting within one round trip, and out of this finding's scope. Worth a line in a future batch if the flicker is ever observed live; it was not.
- **The `onSettled` callback is optional**, so a future caller can silently ignore a failed bulk write. The one caller that matters uses it, and the page test pins the failure path; a required callback would have forced churn on `markRead`, which has no selection to preserve.
- **The structural test is a regex over source.** It has anti-vacuity assertions, but a rename of `inFlightWrites`/`writeGeneration` must update it. The behavioural tests (1–6) are the real defence; the structural one exists to point the next author at `beginWrite` rather than to be the proof.
