# Code logic review — TASK_2026_ONBOARDING batch B1

Review family: ollama-cloud (implementer: claude)

Scope: the uncommitted working-tree diff on `feat/onboarding-module` —
`libs/frontend/onboarding/**` (new), `libs/frontend/core/src/lib/routing/onboarding-routes(.spec).ts`
(new), and the diffs to `initial-navigation.ts`, `surface-router.service.ts`, `app.routes.ts`,
`app.config.ts`, `webview-surface.types.ts`, `routing/index.ts`, `eslint.config.mjs`,
`tsconfig.base.json`, the vscode `initial-view` spec. `HANDOFF.md` ignored; `nx.json` eslint/jest
include-list addition is user-approved and excluded. Specs were skimmed for coverage only.

Score: **7/10**
Verdict: **REVISE**

---

## Lead from the previous reviewer — CONFIRMED (blocking)

**"The first redirect may save `/onboarding` as the route to reopen, bypassing the chat guard on
the next boot."** Confirmed, with evidence:

1. `SurfaceRoutePersistence` persists **every** `NavigationEnd.urlAfterRedirects`
   (`libs/frontend/core/src/lib/routing/surface-route-persistence.ts:56-64`) — the only URL it
   filters out is the setup-wizard generation route without a valid tab
   (`surface-route-persistence.ts:78-85`). When the chat guard redirects the first boot to
   `/onboarding`, the replacement navigation's `NavigationEnd` carries `urlAfterRedirects =
   '/onboarding'`, and that is written under `ptahRoute` (verified connected on Electron; the
   whole restore mechanism is TASK_2026_524's Electron feature).
2. `/onboarding` is restorable: `webview-surface.types.ts` adds `onboarding` to `SURFACE_ROUTE_IDS`,
   so `navigateToUrl`'s surface check passes (`surface-router.service.ts:203`), and
   `parseWebviewRouteState` accepts the URL (no colon, ≤2048 chars —
   `libs/shared/src/lib/types/webview-route-state.ts`).
3. On the next boot, `resolveBootNavigation` rule 3 restores the saved route whenever the host
   `initialView` equals the saved `seed` (`boot-navigation.ts:58-62`, precedence rules at `:9-18`).
   The seed persisted on boot 1 is that boot's own host value, so the restore always wins on a
   plain restart.

So the second boot restores `/onboarding` directly and the chat guard never runs — the user reopens
onboarding, not chat. The flag is not re-shown-eligible (shownAt is set), so this is not an
infinite loop and self-heals once the user navigates to chat (which re-persists `/chat`), but it
deterministically contradicts the B1 acceptance criterion "a second boot lands on chat"
(`implementation-plan.md:954-955`). The guard spec's "lands the second boot on chat" case does not
exercise persistence: the test harness has `vscodeService` disconnected and
`SurfaceRoutePersistence.persist` returns early at `surface-route-persistence.ts:71`.

## Defects

1. **[blocking] First-run redirect is persisted as the restore route, so the second boot reopens
   onboarding** — see the lead above. Fix: in `SurfaceRoutePersistence.persist`
   (`surface-route-persistence.ts:68-85`), skip records whose first primary segment is
   `onboarding`, mirroring the existing setup-wizard special case, so the pre-redirect route stays
   saved; add a two-boot webview spec that runs with a connected fake `vscodeService` so
   `ptahRoute` actually round-trips. (If a deliberate product decision is made that restoring
   onboarding is desirable, it must be recorded against the acceptance criterion instead.)

2. **[minor] A stale restored route on a first-eligible boot consumes the one-time redirect in a
   flash and then hides it.** `initial-navigation.ts:120-128` accepts a settle on `onboarding` only
   when `plannedSegment === 'chat'`. For a restored *stale* route (e.g. `/settings/obsolete` from an
   older build), the wildcard sends it to `/chat`, the guard redirects to `/onboarding`, the
   tracker commits `shownAt` on the redirect's `NavigationEnd`, and then the settle check sees
   `settled='onboarding' ≠ planned='settings'` → warns and falls back to the host view
   (`initial-navigation.ts:129-132`), landing on chat. The user saw at most a flash, the flag says
   shown, and the automatic showing is permanently spent. Needs the flag empty *and* a persisted
   stale route (an upgrading user), so it is an edge — but the acceptance's spirit ("shown once,
   to the user") is silently broken. Fix: accept `settledSegment === 'onboarding'` for any
   `plannedSegment` (the guard's redirect is the only automatic producer of onboarding), or let the
   fallback skip navigations the tracker committed.

3. **[minor] Guard redirects without recording when `currentNavigation()` is `undefined`
   (`onboarding-first-run.guard.ts:26-29`).** In that branch the guard still returns the
   `/onboarding` `UrlTree` but `recordRedirect` is never called, so `shownAt` is never committed —
   and because the flag stays eligible, *every* later navigation to chat re-redirects: the user
   cannot leave onboarding. Unreachable with the real Router today (guards run inside a
   navigation), so this is a wrong-fallback robustness hole, not a live bug. Fix: return `true`
   when `navigationId === undefined` (no record → no commit → no redirect), instead of redirecting
   untracked.

4. **[observation, not a defect] B1 scaffold: every Home tile link dead-ends back on Home.**
   `onboarding-home.component.ts:243-262` links to `/onboarding/analyze`, `/onboarding/new-project`,
   `/onboarding/team-builder`, but B1's route table declares only `''` plus the `**` redirect
   (`onboarding.routes.ts:12-21`), so clicking "Start analysis" silently lands back on Home. This
   matches the plan's staging (flow routes arrive in B3/B4) and is listed only so it is a tracked
   intermediate state, not an oversight.

## The five logic questions

1. **Silent failure?** Defect 1 is the silent one: a correct-looking boot (restores a "saved"
   route) that violates the acceptance without any warning. Also defect 2's flash-and-suppress.
2. **Unexpected user action?** A user who quits the app while still on the first-run onboarding
   page reopens onboarding on the next boot (defect 1); a user who clicks a Home tile in a B1
   build stays on Home with no feedback (observation 4).
3. **Input data producing a wrong answer?** An unreadable stored record (`invalid JSON`, an
   unknown key via `z.strictObject`) correctly yields `unreadable` → no redirect, never
   overwritten (`onboarding-flag.service.ts:140-154`, `:117-125`); a repeated query key (`tab=a&tab=b`)
   arrives as an array and `isOnboardingIdentityValue` rejects it
   (`onboarding-routes.ts:53-60`) ✓. The wrong-answer input is the *valid* persisted
   `/onboarding` record (defect 1).
4. **Dependency failure?** Storage probe failure → no redirect, no loop
   (`onboarding-flag.service.ts:156-168`); late write failure → `suppressed`, chat reachable
   (`onboarding-flag.service.ts:90-92`); a failed lazy chunk for the onboarding route →
   `NavigationError(replacementId)` clears the pending redirect and leaves `shownAt` unset
   (`onboarding-first-run.tracker.ts:85-88`) so the next boot tries again ✓.
5. **Missing from requirements?** The plan never said who owns persisting the route the guard
   redirected away from — that gap is defect 1. Everything else in the B1 acceptance list is
   implemented and specified.

## Checklist against the acceptance criteria

- **shownAt written exactly once, after arrival** — yes: the single write site is the tracker's
  `NavigationEnd` handler (`onboarding-first-run.tracker.ts:101-106`); a manual visit to
  `/onboarding` never commits (no pending redirect), and a second chat navigation in the same
  session passes the guard because the in-memory flag is already set. ✓
- **SWITCH_VIEW during the in-flight redirect wins, shownAt unset** — yes, traced: the replacement
  navigation's `NavigationCancel`/`NavigationError`/`NavigationSkipped` clears the pending entry
  (`tracker.ts:72-88`); a start of a different URL while awaiting clears it too
  (`tracker.ts:90-98`). Specified in `webview-routing.spec.ts` ("leaves shownAt unset when
  SWITCH_VIEW supersedes the redirect"). ✓
- **Non-Electron: no redirect** — `guard.ts:22` returns `true` before the flag service is ever
  injected. ✓
- **Unreadable record: no redirect, not overwritten; probe failure / late write failure: chat
  reachable** — verified in `onboarding-flag.service.ts` (see Q3/Q4). ✓
- **Deep link to another surface never runs the guard** — guard is `canActivate` on the `chat`
  route only (`app.routes.ts:97-100`); a restored `/settings` etc. never reaches it. ✓
- **`navigateToSurface(..., { queryParams })` serialises; `already-there` with identical query** —
  the tree is built through `createUrlTree` with the query, and `navigateToTree` compares
  serialized URLs on both sides (`surface-router.service.ts:161-169`, `:273-295`), so query
  identity is part of the comparison. Query is dropped on the no-route fallback, matching `subPath`.
  ✓
- **`src/services.ts` names nothing under `src/lib/focus/`** — it exports first-run pieces only
  (`services.ts:47-54`). ✓
- **Restored `/chat` → onboarding without the fallback warning** — `initial-navigation.ts:123-128`.
  ✓ (but see defect 2 for non-chat planned segments)
- **Route parser edge cases** — colon/slash/backslash rejected, 256-char cap, array rejection,
  path table matches the builders (`onboarding-routes.ts:116-129`); the parser accepting
  `/onboarding/analyze/guidance` (which no builder emits) is documented as intentional
  (`onboarding-routes.ts:100-105`). ✓
- **Lazy wiring** — `app.routes.ts` loads `ONBOARDING_ROUTES` via `loadChildren` from the main
  entry; only the narrow `services` entry is eager; `onboarding` declared right after `chat`;
  legacy surfaces untouched; eslint `checkDynamicDependenciesExceptions` + tsconfig paths wired.
  ✓
- **Tests** — guard (Electron/VS Code/eligible/suppressed/unreadable), tracker state table, flag
  service (probe/invalid JSON/write failure), initial-navigation restored `/chat`, route
  builders/parser, webview-routing composition: all present and passing. The one uncovered
  interaction is persistence across boots (defect 1).

## Severity calibration

The core mechanism (guard → tracker → single commit) is sound and unusually well defended against
storage failure, supersession and manual visits; the specs enumerate the failure modes row by row.
What separates this from a clean pass is one deterministic acceptance violation on the priority
host (defect 1) plus two edge holes (2, 3). Fix 1 is required before B1 can be accepted; 2 and 3
are small hardening fixes that can ride along.

## Decisions

- Treated the lead's persistence question as the primary verification target and confirmed it from
  code (no runtime repro was needed; `run` nothing per instruction). Reversible: a one-line filter
  in `SurfaceRoutePersistence` plus a two-boot spec.
- Did not run `npm run verify`, lint, typecheck or any build/serve/e2e target (tests reported
  passing by the orchestrator; review is read-only). Remaining uncertainty: the exact `initialView`
  the Electron main window sends on boot was not read — but both candidate values (`'chat'` or
  `null`) leave restore precedence on the saved route, so defect 1 holds either way.

---

## Revise round 1

Review family: ollama-cloud (implementer: claude)

Scope: only the three fixes for round 1's defects 1–3, read from the working-tree diff
(`git diff` for the two tracked files; the guard is new, so read in full) plus the four new
spec cases and a repo-wide search for other producers of an onboarding redirect. No checks run
(tests reported passing: webview 680/680, core, onboarding); review is read-only.

### Per-defect status

1. **[blocking] Onboarding persisted as restore target — FIXED.**
   `SurfaceRoutePersistence.persist` now returns early when the first primary segment is
   `onboarding` (`libs/frontend/core/src/lib/routing/surface-route-persistence.ts:78-81`), before
   the setup-wizard branch, mirroring the keep-last-route contract. The redirect's
   `NavigationEnd` carries `urlAfterRedirects = '/onboarding'` and is now skipped, so the last
   pre-redirect route stays saved. Pinned by `surface-route-persistence.spec.ts:167-177`
   ("keeps the last route when the Router settles on onboarding"): navigates `/chat/tab-1`, then
   to onboarding, and asserts exactly one write whose parsed `route` is still `/chat/tab-1` —
   non-vacuous, connected fake `vscodeService`, so the round-1 gap (disconnected harness) is
   closed for this unit.

2. **[minor] Stale restored route consumes the one-time showing then falls back — FIXED.**
   `initial-navigation.ts:120-127` now accepts any restore that settles on `onboarding`
   (`if (settledSegment === 'onboarding') return result;`) instead of only `plannedSegment ===
   'chat'`. Pinned twice: `app.spec.ts:278-290` (restored `/settings` settling on onboarding is
   accepted, no fallback `navigateToSurface` call, no warning) and, end-to-end,
   `webview-routing.spec.ts:680-691` — a real boot with saved `/settings/obsolete` under Electron
   runs the wildcard → chat → guard chain and asserts the Router lands on `/onboarding`, the
   flag commits `shownAt`, and the fallback warning does not fire. That is the acceptance's
   "shown once, to the user" restored.

3. **[minor] Guard redirects untracked when `currentNavigation()` undefined — FIXED.**
   `onboarding-first-run.guard.ts:28-29` returns `true` before `recordRedirect` when
   `navigationId === undefined`, exactly the recommended no-record → no-commit → no-redirect
   fallback. Pinned by `onboarding-first-run.guard.spec.ts:77-80` ("returns true without
   recording when no navigation is in flight": result `true`, `recordRedirect` not called).

### Regression analysis (the two questions raised)

- **Does accepting any onboarding settle hide a real stale-route problem?** No. A repo-wide
  search for `createUrlTree(['/onboarding'])` / `redirectTo` targeting onboarding (non-spec)
  finds exactly one producer outside onboarding's own subtree: the guard
  (`onboarding-first-run.guard.ts:31`); `onboarding.routes.ts` `**` redirects stay inside the
  onboarding segment. So a settle on `onboarding` with a non-onboarding plan can only mean the
  guard spent the one-time showing — the one case where warning and falling back is wrong.
  The stale-route signal is not lost where it matters: a stale route falling through the
  wildcard to chat on a *spent* flag still settles on `chat ≠ planned` and warns/falls back
  (`initial-navigation.ts:128-131`). Residual edge (pre-existing, unreachable, not a
  regression): a stored `/onboarding/...` record written before this fix would restore with
  `planned === settled` and be accepted by the earlier check — impossible in practice since
  `onboarding` does not exist on `main` and this fix stops all future writes.

- **Does skipping onboarding persistence break a later manual visit?** No. If the user opens
  onboarding manually after the first run and quits there, the next boot restores the last
  non-onboarding route — which is the fix's stated design ("onboarding is never a restore
  target"), not a side effect. The kept record's `seed` cannot go stale: `persist` is always
  handed the one session constant captured at `start()` (`surface-route-persistence.ts:56-64`),
  so skipping changes only which route is kept, never seed freshness. And since the flag is
  spent by then, restoring chat (not re-showing onboarding) is the correct next boot.

### New defects

None. The one soft spot considered — the accepted settle also suppresses the warning for the
stale `/settings/obsolete` case — is the behavior the spec now pins (`webview-routing.spec.ts:
687-691`), so it is specified intent, not a silent failure.

Verdict: APPROVED