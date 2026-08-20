# Batch 15B report — P5-FE tasks 15.8–15.11, plus the bulk-endpoint wiring

**Executor**: `frontend-developer` · **Date**: 2026-08-10
**Scope**: the `markSelectedRead` wiring + tasks 15.8, 15.9, 15.10, 15.11. The final frontend dispatch of Phase 5.
**Commits made**: **NONE.** No `git add`, `git commit`, `git stash` or `git checkout` was run at any point.

---

## 0. Executive summary — the twelve lines that matter

1. **All four tasks complete and green, plus the wiring.** `web-members` 44 suites/869 tests → **45/922**; `web-panel-ui` 4/32 → **5/41**; `web-core` 4/25 unchanged. **34 new e2e tests** across four new spec files. Zero lint errors, zero lint warnings in both libs I touched.
2. 🔴 **THE BIGGEST FINDING — THE LIGHT THEME HAS NEVER BEEN AUDITED, AND IT FAILS WCAG AA.** `text-base-content/60` measures **4.42:1 against the required 4.5:1** in `operator-member-light` (`#747477` on `#faf9f7`). It affects ~21 elements on `/members/account` alone, including the shared panel nav — so **every panel surface, member and admin**. **Every axe pass in this repository before this batch ran in the DARK theme only.** §6.3.
3. 🔴 **And it lands on B13's F-1's own element.** F-1 was fixed by moving `EmptyState`'s hint from `/40` to `/60`. `/60` is what fails here. **The fix was correct for the theme it was measured in and insufficient for the other one.** Reported, not fixed — every failing element uses the _correct_ semantic token and the TOKEN is what is wrong (RK-1). §6.3.
4. 🔴 **SECOND REAL DEFECT, FOUND AND FIXED: `DetailDrawer` kept focusable content in the tab order while `aria-hidden`.** axe `aria-hidden-focus`, **serious**. `pointer-events-none` blocks the mouse and does nothing to the keyboard. Fixed with `inert`; `detail-drawer.spec.ts` is its first spec. **The axe-dependency migration is what surfaced it** — the CDN 4.10.2 loader did not report it. §6.2.
5. 🔴 **THIRD REAL DEFECT, FOUND AND FIXED: the panel fetched the unread count TWICE on every entry.** `start()`'s eager fetch and the router's `NavigationEnd` for the same navigation both fired. Measured live: `[unread-count, unread-count, hub]`. De-duplicated in the store. **Only an e2e request census could see this.** §6.1.
6. 🔴 **R6.2 — STATED PLAINLY: PASS.** `members-content.spec.ts` was re-run **completely unedited** (`git diff` byte-identical to HEAD) and **all 3 tests pass**, including both halves of the one-request assertion. §7.
7. 🔴 **BUT ITS STRICTER SIBLING WENT RED, AND THAT IS THE FINDING.** `members-courses.spec.ts:585` counts _every_ member API call and caught the badge poll. R6.2 in `members-content.spec.ts` passes only because its filters are scoped to `/hub`, `/community`, `/search` — the poll slips through all three. §7.2.
8. 🔴 **THE DISPATCH'S ENVIRONMENT PREMISE IS WRONG.** `:3000` is **not** "a container running OLD code that will 404 the routes you need". It bind-mounts `libs/` and runs `nx serve` in **watch mode** over the live working tree — its route table shows it hot-reloading the _uncommitted_ `POST .../read` at 14:49. No second server was needed and none was started. §8.1.
9. **`tasks.md` was wrong at the code in four more places**, including ground truth 12's claim that `/members/search` has "only indirect coverage" — it is directly covered. §8.
10. **Five deliberate-failure proofs**, three of them proven red at **both** the unit and the e2e layer, each reverted and verified. §9.
11. **DB returned to its exact pre-batch census.** Dev server stopped **by PID identity from two sources**, never by port; both containers `Up (healthy)`. §10.
12. 🔴 **The foreign file list did NOT grow, and HEAD did NOT move** — the first dispatch in this task for which both are true. §1.2.

---

## 1. File set

### 1.1 Mine — 9 modified, 1 deleted, 7 new

**Modified (9):**

| File                                                                         | Why                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `libs/web/members/src/lib/services/member-notifications-api.service.ts`      | The wiring — `markManyRead(ids)` + the `bulkReadIds` guard. Four endpoints → five.                          |
| `libs/web/members/src/lib/services/member-notifications-api.service.spec.ts` | +10 `it`s for the bulk endpoint.                                                                            |
| `libs/web/members/src/lib/state/member-notifications.store.ts`               | The wiring (partial selection → one request, guard KEPT) **and** the `countInFlight` de-duplication (§6.1). |
| `libs/web/members/src/lib/state/member-notifications.store.spec.ts`          | +18 `it`s: the bulk path, the kept guard, the cap, the dedupe.                                              |
| `libs/web/members/src/lib/notifications/notifications-page.spec.ts`          | The two pinning tests' POSITIVE half (N requests → one). Negative half unchanged.                           |
| `libs/web/members/src/lib/notifications/notifications-page.ts`               | Docblock only — the store's request shape changed.                                                          |
| `libs/web/members/src/lib/members.routes.ts`                                 | **15.8** — both placeholder routes swapped, both helpers and the import deleted.                            |
| `libs/web/members/src/lib/members.routes.spec.ts`                            | **15.8** — the placeholder assertions replaced by whole-tree ones.                                          |
| `libs/web/members/src/lib/member-guard-wiring.spec.ts`                       | **15.8** — ground truth 7's case, _answered_ rather than moved.                                             |
| `libs/web/members/README.md`                                                 | **15.8** — it still described the placeholder as live.                                                      |
| `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.html`                 | **The `inert` a11y fix** (§6.2).                                                                            |
| `libs/web/panel-ui/src/lib/empty-state/empty-state.spec.ts`                  | **15.10** — `/40` prohibition re-scoped to text-bearing elements.                                           |
| `apps/ptah-landing-page-e2e/src/specs/members-courses.spec.ts`               | **15.10** — CDN axe copy deleted. **15.11** — the R6.2 sibling repaired _and tightened_ (§7.2).             |
| `apps/ptah-landing-page-e2e/src/specs/members-live.spec.ts`                  | **15.10** — CDN axe copy deleted.                                                                           |
| `apps/ptah-landing-page-e2e/src/support/db.ts`                               | **15.11** — pack + notification fixtures.                                                                   |

**Deleted (1):** `libs/web/members/src/lib/placeholder/member-phase-placeholder.ts` — **and its now-empty directory**, which `rm` left behind and which my own new assertion caught (§3).

**New (7):**

- `libs/web/members/src/lib/account/account-page.spec.ts` (15.9 — 25 tests)
- `libs/web/panel-ui/src/lib/detail-drawer/detail-drawer.spec.ts` (its FIRST spec — 6 tests)
- `apps/ptah-landing-page-e2e/src/support/axe.ts` (15.10 — the single shared helper)
- `apps/ptah-landing-page-e2e/src/specs/members-packs.spec.ts` (15.11 — 11 tests)
- `apps/ptah-landing-page-e2e/src/specs/members-notifications.spec.ts` (15.11 — 10 tests)
- `apps/ptah-landing-page-e2e/src/specs/members-account.spec.ts` (15.11 — 9 tests)
- `apps/ptah-landing-page-e2e/src/specs/members-search.spec.ts` (15.11 — 4 tests)

🔴 **Nothing outside `libs/web/members/**`, `libs/web/panel-ui/**`and`apps/ptah-landing-page-e2e/**`was touched.** No`package.json`(the axe dependency was already installed — F-I is accurate), no`tsconfig.base.json`, no `nx.json`, no `eslint.config.mjs`, no `tailwind.config.js`, no `proxy.conf.json`, no `.ptah/specs/` file other than this report.

### 1.2 🔴 The foreign footprint — RE-DERIVED AT THE START **AND** AT THE END. It did not grow.

**HEAD did NOT move during this dispatch: `b57d3c8d4` at start and at end.** The first dispatch in this task for which that is true — and the first for which the foreign list is byte-identical start to end.

**Not mine, untouched, in three separate bodies:**

- **(a) Batch 15A's frontend** — `member-layout.ts`, `member-nav-admin-link.spec.ts`, `member-nav-badge.spec.ts`, `services/member-packs-api.service.*`, `notifications/`, `packs/`, `state/`, `panel-ui/selection-toolbar/selection-toolbar.spec.ts`. **I added to this body; I rewrote none of it** except the four files listed in §1.1 where 15.8–15.11 or the wiring required it.
- **(b) The new backend endpoint** — `libs/api/notifications/**`, `libs/api-contracts/community/**`, `apps/ptah-license-server/src/common/{route-map,controller-validation}.spec.ts`, `dto/mark-notifications-read.dto.ts`. **Read, never edited.** I consume `MAX_BULK_MARK_READ_IDS` and `MarkNotificationsReadRequest` from the barrel.
- **(c) The concurrent session (TASK_2026_173 Batch 5)** — `.ptah/specs/TASK_2026_173/{tasks.md, batch-7-dispatch.md}`, `.ptah/specs/TASK_2026_{171,179,187,197}/.harvested.json`, `.ptah/specs/TASK_2026_{179,184}/task.md`, `marketing/scripts/01-open-source-announcement.md`, and **`.ptah/specs/TASK_2026_177/tasks.md` (NOT mine — modified before I started)**.

**Guidance for the team-leader's commit**: stage `libs/web/members/**`, `libs/web/panel-ui/**` and `apps/ptah-landing-page-e2e/**` explicitly. **Never `git add .` and never `git add .ptah/specs`.** Note the **deletion** needs `git rm` or `git add -A` scoped to the members lib.

**Still recommended separately** (15A §5.5, carried into 15B by `tasks.md`): `selection-toolbar.spec.ts`. **I add a second to that list**: `detail-drawer.{html,spec.ts}` is a cross-panel a11y fix benefiting four admin consumers, in the exact shape of B13's `e9181716f`, and should stay independently revertible.

---

## 2. The wiring — `markSelectedRead` → `POST /v1/members/notifications/read`

### 2.1 What changed, and what deliberately did not

```
before:  whole-inbox selection -> read-all        |  partial selection -> N × :id/read
after:   whole-inbox selection -> read-all        |  partial selection -> ONE × POST read
                                 ^^^^^^^^ KEPT                            ^^^^^^^^^^^^^ NEW
```

🔴 **15A's equivalence-guarded fallback is intact.** `page === 1 && !hasMore && total === items.length` still routes to `read-all`, and its pinning tests still run. The bulk-endpoint report's §10.1 recommends deleting it; **the USER DECISION in `tasks.md` says it stays, and I followed the decision.** I also think the decision is right, and the store docblock now records why: mark-unread was explicitly NOT added, so every write here is irreversible, and the two branches fail in _opposite_ directions — `read-all` over-reaches if the page is not the whole inbox (which is exactly what the guard's three conditions test), while the bulk endpoint under-reaches harmlessly (absent / already-read / foreign ids contribute zero and are not errors). On an operation with no undo, deleting a working guard buys nothing but a smaller diff.

### 2.2 The two pinning tests changed their POSITIVE half only

`notifications-page.spec.ts`'s _"a PARTIAL selection does NOT issue read-all"_ and _"selecting every row on a page that is NOT the whole inbox avoids read-all"_ keep `expectNone(READ_ALL)` **verbatim** — that is the load-bearing claim. What changed is what they assert _instead of_ `read-all`: one bulk request, with **the body asserted**, not just the URL. A bulk call posting the wrong ids is identical at the routing layer and marks the wrong rows read, permanently.

### 2.3 🔴 The array cap: chunking is unreachable, so none was written

`MAX_BULK_MARK_READ_IDS === MAX_PAGE_SIZE` (**derived** server-side, not copied — asserted directly in two specs). A selection is a subset of `items()`, which is **one page**, and a page cannot exceed `MAX_PAGE_SIZE`. So the largest selection reachable from the store is _exactly_ the cap and never more. **A chunk loop on that path could never execute and would be untestable dead code**, so there is none — and there is a test pinning a full 50-row page as **one** request sitting exactly on the boundary.

The API service nonetheless **throws a `RangeError`** above the cap and on an **empty** array, matching `pageParams`'s established idiom (ground truth 10: "a client-side guard that throws before issuing a request the server would `400`"). The empty case is deliberate and is the more important of the two: the server refuses `[]` with a `400` precisely because _"mark these, where these is empty"_ is the one phrasing that could be re-read as _"mark all"_. Swallowing that `400` as a client-side no-op would re-open the door from this side, so it throws instead. A separate store test proves an empty selection issues **nothing at all**, so the throw is unreachable in practice.

### 2.4 `{ marked }` stays unparsed

Consistent with the other two writes, and with the backend report's item 3. There is a test that flushes `{ marked: 99 }` and asserts the badge reads the server's re-read value (`4`), not `99`.

---

## 3. Task 15.8 — the last two placeholders ✅

Both routes swapped to real `loadComponent` imports; `data:` blocks deleted; `loadPlaceholder()`, `placeholder()`, the `MemberPlaceholderData` import and the component file **all deleted**. Three docblocks promised this batch would do it and it did.

**Verification gate — `rg "MemberPlaceholderData|loadPlaceholder|member-phase-placeholder" libs/web` → 0 hits.** My first draft's replacement comment named the file literally and produced 1 hit; the comment was rephrased so the gate reads zero while the reasoning survives. (Same trap as §5.2 and §6.4 — a comment explaining an absence registering as a presence.)

`members.routes.spec.ts`: the two placeholder-era assertions were **replaced, and widened**. It now asserts every lazy route resolves a real, distinctly-named component (13+, count-checked so a tree that lost children cannot pass vacuously), that **no** route carries a `data` block, and — 🔴 — that the placeholder module is **gone from disk**.

**That last assertion earned its place immediately: it failed on the first run.** `rm` had removed the file and left the empty `placeholder/` directory, which git does not track and no other check would have seen.

`member-guard-wiring.spec.ts` (ground truth 7): **answered, not moved.** Its own comment offered two repairs and this is the second. Moving it a third time was not available — _every_ member surface now fetches on activation, so "a surface with no activation fetch" had become a category with no members. The request is answered with a **500**, exactly as the `/members` case above it does, and two assertions were **added** (`not.toContain('/admin')`, plus the shell check), so the case is stronger than before.

---

## 4. Task 15.9 — `AccountPage` ✅ — 25 tests

🔴 **Ground truth 11 is accurate: this page did not need authoring, it needed a test.** 258 lines, shipped in Phase 1, routed and rendering for four phases with zero coverage. This spec **describes a shipped surface**.

**The a11y pass found NOTHING to fix on this page.** All 25 pass against the component unmodified — every control is a real `<button>`/`<a>`, every one has a non-empty accessible name, all three sections are landmarks whose `aria-labelledby` **resolves**, one `h1` and no heading-level skips, every icon `aria-hidden`, and no `/40` on any text-bearing element. I changed **not one line** of `account-page.ts`. Stated plainly because the task asked for fixes to be reported as findings, and there are none to report.

**A real bug in my own spec, caught by the spec:** the auth hint was seeded as `'1'`. `hasAuthHint()` is `localStorage.getItem(...) === 'true'`, so all 25 cases failed on a missing request. My docblock had claimed "the value is not read — only its presence is", which was simply wrong. Both the value and the claim are corrected, and the docblock now records the failure — because the honest reading is that a signed-in member whose hint was written that way really would see "Not available".

**Two notes on the shipped code, neither a defect:**

- `AccountPage.signOut()`'s `error:` branch is **unreachable through `AuthService`** — `logout()` already `catchError`s to `of(undefined)`. It is harmless belt-and-braces on an irreversible-feeling action, and I left it. The e2e proves the _observable_ property (the session clears and the panel is left) regardless of which branch runs.
- The panel **shell** carries a theme control _and_ the page carries a second pair. Both write the same key so they cannot disagree, but it means `getByRole('button', { name: 'Light' })` matches two controls. Recorded in the spec.

---

## 5. Task 15.10 — the axe migration ✅

### 5.1 F-I is accurate; both loaders were lying

`@axe-core/playwright` **is** a devDependency — `package.json:202`, `^4.12.1`, and `node_modules` resolves **4.12.1**. Both CDN loaders still asserted its absence in comments (`members-courses.spec.ts:663`, `members-live.spec.ts:504`). **Both are deleted** — 74 lines and 78 lines respectively — and replaced by one import.

**Gate — `rg "cdn.jsdelivr.net" apps/ptah-landing-page-e2e` → 0 hits.** (My helper's docblock originally named the CDN while explaining its removal; rephrased.)

The violation shape is **the live spec's** (`targets: string[]` + `summary`), as instructed — it is the one that made B13's F-1 diagnosable. B10's scope (`include: body`, `exclude: iframe`) is kept **verbatim** and the reason is stated in the file rather than inherited silently.

### 5.2 🔴 `auditPopulatedAndEmpty` — the helper points at EMPTY surfaces, and cannot deceive itself

The helper runs a surface **twice** and takes an `emptyIt` callback (emptying is surface-specific: packs stubs a `[]` response so it does not disturb rows other specs share; notifications **deletes its own fixture rows**, which is an honest empty rather than a faked one; search is empty by default).

🔴 **It asserts the surface is genuinely empty before measuring it** — a positive empty-marker check _and_ `toHaveCount(0)` on the populated marker. Without that, an `emptyIt` that silently failed would run the populated pass twice and report a clean sweep, which is the true-because-nothing-rendered failure the helper exists to prevent wearing the opposite disguise. **Proof P5 confirms it fires.**

### 5.3 `empty-state.spec.ts` — text-bearing scope adopted (15A §7)

Re-scoped from `<p>` to **every element owning a non-whitespace _direct_ text child**, excluding `aria-hidden` subtrees and `<svg>`. Three tests added, including one that builds F-1's exact defect out of a detached node and confirms the walk **reports** it — a negative assertion over a walk nobody has seen produce a hit is worth very little.

---

## 6. 🔴 The three real defects this batch found

### 6.1 The unread count was fetched TWICE on every panel entry — FIXED

Measured live during the courses R6.2 sibling: `["…/notifications/unread-count", "…/notifications/unread-count", "…/hub"]`.

`start()` fetches eagerly (so the badge is populated on first paint) **and** subscribes to `NavigationEnd` (so it is fresh on every move). On the first load both fire — the layout is constructed during route activation, and the router emits `NavigationEnd` for that same navigation moments later. Neither half can be deleted: without the eager fetch the badge is blank until the next navigation; without the subscription it is up to 60 s stale.

**Fixed by de-duplicating concurrent count reads** (`countInFlight`). The flag is cleared in **both** the `next` and the `error` path — clearing only on success would let one 500 wedge the badge permanently, which is worse than the duplicate it replaced. Four tests pin it, including two specifically for the wedge.

### 6.2 `DetailDrawer` — `aria-hidden` with focusable content — FIXED

```html
<!-- before -->
<div class="fixed inset-0 z-50" [class.pointer-events-none]="!open()" [attr.aria-hidden]="!open()"></div>
```

While **closed**, the container was `aria-hidden="true"` and its contents — the "Close panel" button and everything a consumer projects — **remained in the tab order**. `pointer-events-none` stops the mouse and does nothing whatever to the keyboard. axe: `aria-hidden-focus`, **serious**. A keyboard user could Tab into an invisible, off-screen drawer hidden from screen readers and press a button they cannot see.

**Fixed with `[attr.inert]="open() ? null : ''"`** — the one primitive that removes a subtree from both the tab order _and_ the accessibility tree. Written as the empty string, not `true`: `inert` is a boolean attribute, so `inert="false"` is still inert and the attribute must be **absent** when open. There is a test for exactly that.

🔴 **The migration is what found it.** The CDN axe-core 4.10.2 did not report it; the pinned 4.12.1 does. It was invisible for four phases for the same three reasons B13's F-1 was: the Task 4.7 lint rule reads only `libs/web/members/**`, every axe pass used the older CDN build, and `panel-ui` had no spec for the component. It now has one — **`detail-drawer.spec.ts`, its first**.

### 6.3 🔴 THE LIGHT THEME FAILS WCAG AA — REPORTED, NOT FIXED

```
color-contrast · serious · 4.42:1 (required 4.5:1)
#747477 on #faf9f7 · 14px · normal weight
```

**Source confirmed by arithmetic, not guessed.** `operator-member-light` sets `base-content: #1a1c22` on `base-100: #faf9f7` (`apps/ptah-landing-page/tailwind.config.js:248`). Compositing `#1a1c22` at 60% over `#faf9f7` gives `#747477` — exactly the value axe reports. **The failing token is `text-base-content/60`.**

**~21 elements on `/members/account` alone**, including:

| Target                                                                                       | What it is                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `.max-w-sm`                                                                                  | 🔴 **`EmptyState`'s hint — B13's F-1's own element**                                  |
| `.justify-center > p:nth-child(2)`                                                           | `EmptyState`'s message                                                                |
| `a[href$="notifications"] > span`, `…"replays"`, `…"request"`, `…"my-threads"`, `…"courses"` | 🔴 **the shared `PanelLayout` secondary nav — every panel surface, member AND admin** |
| `.mt-5…text-[11px].uppercase` ×3                                                             | nav group headings                                                                    |
| `#account-identity`, `#account-appearance`, `#account-billing`                               | section headings                                                                      |
| `header > .mt-1`, `dt` ×2, `.p-4… > p`                                                       | page subtitle, labels, body copy                                                      |

🔴 **Why it survived four phases: every axe pass in this repository before this batch ran in the DARK theme only.** B10's and B13's helpers never set `ptah.members.theme`. Exit-gate clause 3 asks for "both themes"; this is the first run that did it, and the missing half was hiding a real AA failure.

🔴 **And it is B13's F-1 again, one theme over.** F-1 was fixed by moving the hint from `/40` to `/60`. `/60` is what fails here. The fix was correct for the theme it was measured in and insufficient for the other.

**Why I report rather than fix (RK-1).** Every one of the ~21 elements is using the **correct** semantic token — `panel-theme-spec.md` §2 rules `base-content/60` the safe muted-text token. The elements obey the spec and **the spec is what is wrong for this theme**. Rewriting 21 call sites would encode the defect as a workaround. The real fix is one of two token changes, both in files this batch does not own and which the **admin** panel shares:

- darken light `base-content` `#1a1c22` → ~`#15171c`, or
- raise the muted token to `/70` → `#5d5e62`, which clears AA comfortably.

**It is quarantined, not waived.** `expectOnlyKnownViolations` permits **exactly** this one rule id, **in the light theme only**; the dark theme is asserted completely clean with no allowance. Any additional rule, on any surface, in either theme, still fails. 🔴 **And it fails if the defect is ever ABSENT** — so fixing the token breaks the suite and forces the exemption out in the same commit. An allowance that passes once the bug is fixed is an allowance nobody ever removes.

---

## 7. 🔴 R6.2 — stated plainly

### 7.1 **PASS.**

```
$ npx playwright test … members-content.spec.ts
  ok 1 › /members resolves to the hub inside the panel shell and shows the cohort (4.7s)
  ok 2 › the community entry point is an in-product route, not an outbound link (1.7s)
  ok 3 › the live hub still costs exactly one request now that community returns real data (4.3s)
  3 passed (12.4s)

$ git diff --quiet apps/ptah-landing-page-e2e/src/specs/members-content.spec.ts
  members-content.spec.ts: BYTE-IDENTICAL TO HEAD ✓
```

**Both halves — the stubbed one and the live one — re-run completely unedited, four phases later, and both pass.** Exit-gate clause 5 is met.

### 7.2 🔴 But its stricter sibling went red, and that is a finding

`members-courses.spec.ts:585` — _"the hub still issues exactly ONE member request, with a live course present"_ — **failed**, measuring `[unread-count, unread-count, hub]`.

That test counts **every** `/api/v1/members/*` call except the guard probe. `members-content.spec.ts` passes because its three assertions are scoped to `p === '/api/v1/members/hub'`, `startsWith('/community')` and `startsWith('/search')` — **the notifications poll matches none of them and slips through all three.** So R6.2's literal clause is satisfied, and the property "the hub costs one member request" is _not_ what `members-content.spec.ts` actually measures.

**Two separate things came out of it:**

1. **A real bug** — the duplicate poll (§6.1), now fixed.
2. **A legitimate exclusion** — the badge poll is issued by `MemberLayout`, the **shell**, on every member surface, for exactly the reason the entitlement probe already excluded there is: it belongs to the panel, not to any page in it. R10.4/R10.5/AD-14 _require_ it. Counting it would turn the assertion into a statement about the shell.

🔴 **The repair made the test STRICTER, not looser.** The poll is now excluded _and_ asserted to fire **exactly once**, with anti-vacuity on both exclusions. Proof P3 shows the new clause is what catches the duplicate while the original `toHaveLength(1)` stays green — the exclusion is not a hole.

### 7.3 A related design finding I did **not** act on

On `/members/hub` the unread count is now sourced **twice**: the hub aggregate carries `sections.notifications.data.unreadCount` (rendered as the `StatTile` labelled **"Unread replies"**, `hub-page.ts:96`), and the shell polls `/unread-count` for the nav badge. They are fetched from different endpoints at different times and **can disagree** — mark everything read and the badge clears while the tile keeps its stale number until the hub is re-fetched.

R9.3 forbids a second **badge**; a `StatTile` is not a badge, and 15A's type-scoped structural spec correctly does not catch it (`hub-page.ts` never names `MemberNotificationsStore`). **Also: the tile is labelled "Unread replies" but its value is the unread _notification_ count**, which includes `session_request.status` and `announcement` kinds. Both are Batch 14's surface, both are out of this batch's file set, and fixing the hub risks the very R6.2 assertion I was told to preserve. **Reported, not fixed.**

---

## 8. 🔴 What was wrong in `tasks.md` and in the dispatch

### 8.1 The environment premise — `:3000` is NOT running old code

The dispatch states: _"`:3000` is held by a container running OLD code predating both `54650edee` and the new endpoint — it will 404 the routes you need."_

**Measured:**

```
POST /api/v1/members/notifications/read          -> 401   (route EXISTS)
POST /api/v1/members/definitely-not-a-route      -> 404   (control: absent routes 404)
GET  /api/v1/members/packs                       -> 401
```

`docker inspect` shows the container **bind-mounts `libs/`, `apps/ptah-license-server/src` and `tsconfig.base.json`** and its command is `npx nx serve ptah-license-server` — **watch mode over the live working tree**. Its own logs show it reloading and mapping five notification routes at 14:48, then **six including `POST …/read` at 14:49** — the moment the backend dispatch's _uncommitted_ endpoint hit disk.

**Consequence: no second server was needed and none was started.** Every live check in this report ran against the standard `:4200 → :3000` proxy with **no config change**. The only process I started was the Angular dev server, and it was stopped by PID (§10).

This also means both prior dispatches' `:3011` servers were unnecessary — harmless, but the premise should not be carried into Batch 16.

### 8.2 Ground truth 12 — `/members/search` is **not** "only indirect coverage"

`tasks.md` lists `/members/search` among "the four with none today" and calls its coverage "indirect … via `members-community.spec.ts:392`". That test **navigates to `/members/search`**, fills the real input, clicks the real button and asserts all three result groups including an empty one. It is **direct** coverage; it merely _lives_ in the community file because the thread it searches for must be authored there.

**So I did not duplicate it.** `members-search.spec.ts` adds the half that was genuinely missing — the **a11y pass**, which the surface has never had, across the untouched state, the zero-result state and both themes. `/members/search` is the one member surface whose **default** state is empty, and its zero-hit state renders `EmptyState` with a hint — F-1's element — which is why it is the most valuable axe target in the batch and why it went four phases unmeasured.

### 8.3 Task 15.11 proof #4's predicted symptom is wrong

The task says binding `[innerHTML]` on `bodyPreview` makes _"`markdown-chokepoint.spec.ts` go red **and the importer list move off six**"_. **The importer list does not move** — binding `[innerHTML]` imports no renderer. What goes red is the chokepoint's _other_ assertion, `no file contains innerHTML`, which is the stronger guard. Proof P4 confirms: 3 red, importer list still six.

### 8.4 Task 15.10's `EmptyState` premise, re-confirmed

15A already reported F-1 as fixed in `empty-state.html` (`/60`), and that holds. What §6.3 adds is that the fix is **theme-conditional** — the element it fixed is in the light-theme failing set.

### 8.5 Ground truth 13 — B7's five, as found

Two reproduce as failures: `auth.spec.ts:65` and `pricing-waitlist.spec.ts:22`. The three admin ones (`admin-crud.spec.ts:16`, `admin-founding-invites.spec.ts:28,65`) **skip** rather than fail, because `E2E_ADMIN_EMAIL` is unset. One **additional** admin-dependent test fails for the same reason and is **not mine and not new**: `members-courses.spec.ts:547` (_"an admin CAN mark a question answered"_), which throws in the `adminPage` fixture at `fixtures.ts:77`. Same environmental cause, different file.

---

## 9. 🔴 Five deliberate-failure proofs — three proven at BOTH layers

| #      | Mutation                                                       | Result                                                                                                                                                                                                                                                                                                   | Restored           |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **P1** | 🔴 **`inert` removed from `DetailDrawer`**                     | **2 unit red** (`while CLOSED it is aria-hidden AND inert`; `inert is the EMPTY STRING`) **AND the e2e axe assertion red** with the identical violation: `aria-hidden-focus / serious / .fixed`.                                                                                                         | ✔ verified present |
| **P2** | 🔴 **`markSelectedRead` forced to `read-all` unconditionally** | **20 red**, every one in the `markSelectedRead` block, including all four _"the guard is KEPT"_ cases. 🔴 **The whole-inbox case stayed GREEN** — forcing `read-all` still satisfies it, which is exactly the anti-vacuity signal: only the over-reach cases fail.                                       | ✔ 94/94 green      |
| **P3** | 🔴 **`countInFlight` dedupe removed**                          | **exactly 1 unit red** (`start() PLUS an immediate NavigationEnd costs ONE request`) **AND the e2e red**, printing `badge polls: [unread-count, unread-count]`. 🔴 **`memberRequests).toHaveLength(1)` still PASSED** — proving my exclusion is not a hole and the new clause is what does the catching. | ✔ 59/59 green      |
| **P4** | **`[innerHTML]` bound on `bodyPreview`** (15.11's #4)          | **3 red**, incl. `markdown-chokepoint.spec.ts › no file contains innerHTML`. Importer list **unchanged at six** — see §8.3.                                                                                                                                                                              | ✔ 52/52 green      |
| **P5** | 🔴 **`auditPopulatedAndEmpty`'s `emptyIt` made a no-op**       | **The helper's own anti-vacuity assertion fired** (`axe.ts:210` — empty marker not found). A broken `emptyIt` **cannot** masquerade as a clean empty-state pass — the property RISK-AR needed and the one B13's three phases lacked.                                                                     | ✔ green            |

P1, P3 and P5 are the ones worth reading: P1 and P3 each demonstrate a **real defect I fixed** being genuinely caught at two independent layers, and P5 tests the _test infrastructure_ rather than the product — the failure mode that let F-1 survive three phases.

---

## 10. Final gate — actual output

```
$ npx nx run-many -t lint,typecheck,test -p web-members,web-panel-ui,web-core --skip-nx-cache
  web-core      Test Suites:  4 passed /  25 tests   (baseline 4 / 25   — unchanged)
  web-panel-ui  Test Suites:  5 passed /  41 tests   (baseline 4 / 32   — +1 suite, +9)
  web-members   Test Suites: 45 passed / 922 tests   (baseline 44 / 869 — +1 suite, +53)
  ✔ All files pass linting          (web-members, web-panel-ui: ZERO warnings)
  NX  Successfully ran targets lint, typecheck, test for 3 projects
  (5 warnings total, ALL pre-existing in web-core.)

$ npx nx run-many -t lint,typecheck -p ptah-landing-page-e2e --skip-nx-cache
  ✔ All files pass linting
  NX  Successfully ran targets lint, typecheck for project ptah-landing-page-e2e

$ npx nx build ptah-landing-page --configuration=production
  Initial total  1.32 MB | 313.69 kB gzipped     (baseline 1.32 MB | 313.67 kB)
  ▲ WARNING bundle initial exceeded maximum budget … 1.32 MB
  ▲ WARNING @fullcalendar/angular/skeleton.css … 20.71 kB
  NO NEW WARNING.
```

🔴 **15A's carried-forward item 6 confirmed — the two pages now ship as separate lazy chunks**, and the initial bundle did not move:

```
$ grep -rl "No packs are available to you yet" dist/ptah-landing-page/browser/
  chunk-G3QPPBMO.js
$ grep -rl "You have no notifications yet"     dist/ptah-landing-page/browser/
  chunk-Q2E23QC6.js
```

**Full e2e suite** (`:4200 → :3000`, real Postgres):

```
  86 passed · 11 skipped · 3 failed  (2.3m)
    auth.spec.ts:65                — B7 pre-existing (ground truth 13)
    pricing-waitlist.spec.ts:22    — B7 pre-existing (ground truth 13)
    members-courses.spec.ts:547    — E2E_ADMIN_EMAIL unset; same cause as B7's
                                     three admin specs, which SKIP. Not mine.
```

**The 34 new tests, per file:** `members-packs` 11/11 · `members-notifications` 10/10 · `members-account` 9/9 · `members-search` 4/4.

Two notification tests failed once, mid-run, when the **Angular dev server crashed** with exit code `3221226505` (`0xC0000409`, a Windows stack-buffer-overrun inside vite). Both passed on the restarted server, in isolation and in the full suite. Environmental, not spec instability — recorded because it will recur.

`--skip-nx-cache` and explicit project lists throughout. **`nx affected` was never used.**

Markdown chokepoint: **green, importer list unchanged at SIX**, and proven still able to fail (P4).

---

## 11. Fixtures, teardown and how the server was stopped

**Pre-batch census:**

```
users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1 waitlist=0
```

**Post-batch census:**

```
users=0 licenses=0 subs=0 packs=0 mv_true=0 notifs=0 audit=0 topics=9 posts=10 cats=4 groups=1 waitlist=0
b15b_packs=0   e2e_users=0   ntf=0
```

🔴 **Byte-identical**, including Batch 8's 9 topics / 10 posts and the 4 categories / 1 member group. Every fixture is minted with a stamped slug and removed **by id**, one statement per row with a `console.warn` on failure — the shape `cleanupCourse` was repaired into. Notifications are scoped by owner, and that owner is a throwaway `builderUser` deleted moments later by the existing fixture. **No `TRUNCATE`, no unqualified `DELETE`.** `admin_audit_log` is 0 and I deleted nothing from it.

**No token or `.env` residue** — the e2e fixtures mint the `ptah_auth` cookie in-process via `injectAuth` and write nothing to disk.

### 🔴 The dev server was stopped BY PID IDENTITY, never by port

```
$ netstat -ano | grep ":4200" | grep LISTENING   ->  6720
$ tasklist /FI "PID eq 6720"                     ->  node.exe  6720
$ # guarded: kill only if the PID is still the one both sources named
$ taskkill /PID 6720 /F /T                       ->  SUCCESS

HEALTH_4200=000   HEALTH_3000=200
ptah_license_server  Up 4 hours (healthy)
ptah_postgres        Up 4 hours (healthy)
```

Two independent sources agreed on 6720, and the kill was guarded by an explicit equality check that would have refused on a mismatch. **Docker proxies `:3000` and `:5432`, not `:4200`, and nothing Docker owns was touched.** I started **no** license server, so there was nothing on `:3011` to stop (§8.1).

---

## 12. What I deliberately did NOT do

| Not done                                                                                                                      | Why                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Any git operation**                                                                                                         | Hard constraint 1.                                                                                                                                                                                                                                                             |
| 🔴 **Fix the light-theme contrast failure**                                                                                   | RK-1. Every failing element uses the **correct** token; the token is what is wrong, and it lives in `tailwind.config.js` + the design-system spec, which this batch does not own and the **admin** panel shares. Reported in §6.3 with the arithmetic and two candidate fixes. |
| 🔴 **Delete 15A's equivalence-guarded fallback**                                                                              | The USER DECISION says it stays. The bulk-endpoint report's §10.1 recommends deleting it; the decision overrides, and §2.1 records why I also think it is right.                                                                                                               |
| **Fix the hub's duplicate unread-count source / the "Unread replies" mislabel**                                               | §7.3 — Batch 14's surface, outside my file set, and touching the hub risks the R6.2 assertion I was told to preserve. Reported.                                                                                                                                                |
| **Duplicate the `/members/search` functional journey**                                                                        | §8.2 — it already exists and is direct. A second copy would need the same fixture and the same composer flow. The a11y half, which was genuinely missing, is what I added.                                                                                                     |
| **Chunk the bulk id array**                                                                                                   | §2.3 — unreachable by construction (cap is _derived_ from the page size), so a chunk loop would be untestable dead code. The `RangeError` guard is the honest alternative.                                                                                                     |
| **Edit `members-content.spec.ts`**                                                                                            | Exit-gate clause 5. `git diff` confirms byte-identical.                                                                                                                                                                                                                        |
| **Touch `proxy.conf.json`, `package.json`, `tailwind.config.js`, `tsconfig.base.json`, `nx.json`**                            | Not needed (§8.1 removed the only reason to), and outside the file set.                                                                                                                                                                                                        |
| **Touch `libs/api/**`, `libs/api-contracts/**`, `apps/ptah-license-server/**`, `marketing/**`, other `.ptah/specs/` folders** | The three foreign bodies (§1.2).                                                                                                                                                                                                                                               |
| **Fix `/40` on text in `libs/web/auth` and `libs/web/admin`**                                                                 | RK-1, as Task 15.10 instructs. **Note these are now the _lesser_ finding** — §6.3's `/60` failure is broader and hits the same surfaces.                                                                                                                                       |
| **Websocket / SSE / push / digest / email**                                                                                   | AD-14, RK-1. Nothing was imported or extended.                                                                                                                                                                                                                                 |
| **A second markdown renderer or sanitizer**                                                                                   | NFR-S2. Importer list stays at six.                                                                                                                                                                                                                                            |
| **Claim a design was matched**                                                                                                | 🔴 Ground truth 8 remains accurate: **there is NO approved Packs, Notifications or Account screen.** Both new surfaces were derived from `panel-theme-spec.md` and the shipped member surfaces. **No approved screen was matched, and none is implied.**                       |

---

## 13. Carried forward to Batch 16

1. 🔴 **§6.3 — the light theme fails WCAG AA at 4.42:1 on `text-base-content/60`.** Broad (every panel surface, member and admin), pre-existing, quarantined in `members-{account,search}.spec.ts`. **The quarantine fails when the defect is fixed**, so the closing change is forced to remove it. Two candidate token fixes are given.
2. 🔴 **§8.1 — `:3000` is a watch-mode container over the live working tree.** Do not carry the "old code, will 404" premise forward; no second server is needed.
3. **§7.3 — the hub surfaces the unread count from a second source** (`sections.notifications` → the `StatTile` labelled "Unread replies", which is also mislabelled — it is all notification kinds, not replies).
4. **§8.2 — ground truth 12 is wrong about `/members/search`.** Its functional coverage is direct and lives in `members-community.spec.ts`.
5. **§8.3 — Task 15.11's proof #4 predicts the wrong symptom.** The importer list does not move; `no file contains innerHTML` is what fails.
6. **Commit `selection-toolbar.spec.ts` and `detail-drawer.{html,spec.ts}` separately** — both are cross-panel improvements benefiting existing admin consumers, in B13's `e9181716f` shape.
7. **`E2E_ADMIN_EMAIL` is unset in this workspace**, which skips three admin specs and fails `members-courses.spec.ts:547`. Setting it would close four known-red/skipped items at once.
8. **The Angular dev server crashes intermittently** with `0xC0000409` under sustained Playwright load. It cost one re-run here; it will recur.
