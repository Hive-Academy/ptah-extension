# Code Logic Review — `TASK_2026_533` Batch 15 (Connectors pages, C9 part)

## Round 2 (revise round 1)

### Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 9/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues      | 0                                     |
| Serious issues       | 0                                     |
| Moderate issues      | 0                                     |
| Accepted limitations | 1 (documented, judged acceptable)     |

Scope reviewed: the "Revise round 1" diff in `task533-b15` per
`batch-15-report.md` — `pages/connectors/connector-actions.ts` (+spec),
`pages/connectors/connector-cards.ts`/`.spec.ts` (renamed from
`connectors-view-model.*`), `pages/connectors/connectors-page.component.ts`/
`.html`/`.spec.ts`, `pages/connectors/connector-detail.component.ts`/`.html`/
`.spec.ts`, the new `ui/connector-card-content.component.ts`/`.spec.ts`, and
the modified `ui/featured-connectors.component.ts`/`.spec.ts` — read in full,
not as a diff. Cross-checked against Round 1's five findings and re-verified
by running `npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace
--skip-nx-cache` myself: `lint`, `typecheck` and `test` all pass (matches the
report's "50 suites / 1107 tests"). This is direct evidence for this round,
not a reused claim.

### Round 1 findings, re-verified

| # | Round 1 finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Cross-connector action-error mismatch (`lastAction` attributed by start order, message by completion order) | Serious | FIXED | `connector-actions.ts:77-99` (`_errors` is now a `Map<connectorId, TrackedActionError>`; `recordError`/`clearError` at `:219-241` key strictly by the connector each `run()` closure captured); `run()` records the outcome's own `error` string (`outcome.error`, sourced from the RPC result, never the store's shared signal) under its own `connector.id` at `:176`. The store's `links.actionError()` is no longer read anywhere in the page or detail (verified: only remaining reference is `links.actionError()).toBeNull()` in a spec assertion, and one courtesy `dismissActionError()` call that only clears the store's now-unused signal). New test `connector-actions.spec.ts:150-186` reproduces the exact race (B starts after A, B fails first, A fails second) and asserts each error stays on its own connector; new page-level test `connectors-page.component.spec.ts:617-649` proves it end-to-end with two real overlapping grid clicks. I ran the suite myself; both pass. |
| 2 | `harness:health` failure indistinguishable from "still loading" | Serious | FIXED | `connectors-page.component.ts:340-363` (`harnessView` computed) now distinguishes loading / ready-empty / **error** and always resolves `syncedTargets()` to `[]` once the read has returned or failed, never leaving it `null` past that point; failure additionally puts a new `CLI_TILE_ID` hero tile (`connector-cards.ts:32,172-177`) into its `error` state with a working Retry (`connectors-page.component.ts:488-495` `retryTile()`; `storefront-hero.component.ts`'s pre-existing per-tile error/Retry UI, unmodified, now used for a 4th tile). New test `connectors-page.component.spec.ts:651-674` fails the RPC, asserts "No CLI detected" plus the tile's `data-state="error"`, clicks Retry, and asserts a second `harness:health` call actually fires. |
| 3 | Poll-timeout state lost across a page navigate-away-and-back | Moderate | PARTIALLY FIXED, remainder explicitly accepted | `connector-actions.ts:102-112` (`pollAdopt` effect) adopts every catalogue id in `links.pollingIds()` on construction and on every change, regardless of which tracker instance started it, so a new page instance mounted while a poll is still running now correctly inherits it. New test `connector-actions.spec.ts:308-327` starts a poll directly on the store (bypassing `run()`, simulating "a previous page instance") and confirms the (same, but never-`run()`-invoked) tracker still marks the timeout. The narrower remaining case — a poll that both starts and ends while the Connectors page is entirely unmounted — is now explicitly documented as an accepted limitation in the class doc (`connector-actions.ts:57-62`) rather than silently unhandled. See judgement below. |
| 4 | Focus dropped (not redirected) when the full-page detail closes onto a filtered-out card | Moderate | FIXED | `connectors-page.component.ts:548-564` (`focusCard`) now falls back to `this.gridHeading()?.nativeElement.focus()` when no matching `[data-grid-connector]` element is found. New test `connectors-page.component.spec.ts:676-686` opens `/connectors/sentry?category=code` (Sentry is not in the `code` category, so it is filtered out of the grid), presses Esc, and asserts focus lands on `#connectors-grid-heading`. |
| 5 | Wide-tier `harness:health` read vs. plan text "Connectors fires only the link reads" | Moderate | RESOLVED BY AUTHORITY | The report states this was "kept, as the orchestrator accepted" (batch-15-report.md, "Revise round 1" item 5). This was the only finding in Round 1 that asked for a decision rather than a code fix; a decision was made by the process empowered to make it. Nothing further for this review to require. |

### Judgement on the accepted limitation (poll ends while the page is unmounted)

Acceptable for this batch. Reasoning:

- The failure mode is a UI *label* loss, not a data or connection-state loss.
  `ConnectorLinksStore.load()` still runs at the end of every poll regardless
  of who is watching (`connector-links.store.ts:640-644`), so `links()`
  reflects the true status the moment anyone reads it. A connector whose
  setup silently timed out while the user was elsewhere simply shows its
  ordinary `needs-auth` state with an Authorize button on return — not stuck,
  not wrong, just missing the friendlier "Setup was not confirmed within 5
  minutes" copy and the extra Retry affordance (Authorize already does the
  same thing `retry()` would).
- The alternative fixes were already weighed and correctly rejected for this
  batch: moving `timedOut` state into the shell-scoped `ConnectorLinksStore`
  would grow a file already over its 700-line cap (a hard constraint from
  `batches.md`'s C13 net-line rule the executor cannot waive), and a
  shell-level fix is out of this batch's file list entirely.
- It is disclosed, not buried: the class doc names the exact trigger, the
  exact symptom, and what a real fix would require, in the same place a
  future implementer would look. That is the same standard this task's own
  process used for the D-4 tab-coverage assumption and other accepted-limitation
  notes elsewhere in `implementation-plan.md`.
- It is not a new regression relative to pre-Batch-15 behaviour: before this
  batch's Batch 6 follow-up existed at all, EVERY silent timeout looked like
  this (no note, plain needs-auth state). Round 2 narrows the gap from "always
  silent" to "silent only if the user leaves the page during the exact 5
  minutes it takes to time out," which is a real, disclosed improvement, not
  a new gap.

### Regression check (Batch 11's `FeaturedConnectorsComponent`)

No regressions found. This file's public contract changed twice now
(`actionError: {connectorId,message}|null` → `actionErrors: readonly
ConnectorActionErrorView[]`, `dismissError: void` → `dismissError:
string`), and the change was accepted by the coordinator per the report. I
verified:

- `selectFeaturedConnectors()` (the featured rule itself) and its four specs
  (`featured-connectors.component.spec.ts:100-146`) are untouched — the
  ordering/limit/kind-filter/link-map-miss behaviour Batch 11 established is
  identical.
- Card content (pill, Connect/Authorize/Disconnect gating, managed-elsewhere,
  busy/polling, timed-out, Smithery-key link) now flows through the shared
  `connectorCardState()` / `ptah-connector-card-status` /
  `ptah-connector-card-actions` instead of the deleted private `toCardView`,
  but every one of Batch 11's original behavioural assertions has a
  same-meaning replacement in the spec (`:184-406`): heading levels (`h2`
  section title, `h3` cards — `:231-236`), Connect/Authorize/Disconnect
  gating (`:279-332`), managed-elsewhere withholding Disconnect (`:312-332`),
  busy/polling/locked (`:334-371`), and the action-error-on-its-own-card
  invariant, now keyed by id instead of a single object (`:372-406`).
- `loading` / `error` / empty-`ready` section states, the Retry output, and
  the "Browse all connectors" output are byte-for-byte unchanged
  (`featured-connectors.component.ts:157-211`).
- I ran the full marketplace suite myself (`lint,typecheck,test`) rather than
  trusting the report's count, and it passed, including this file's 28 specs.

### Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking. The sole residual item (poll-timeout label lost
  if a Smithery setup both starts and ends while the user is on another
  Marketplace page) is a disclosed, low-impact, non-data-affecting limitation
  that this batch correctly declined to fix by growing an already-over-cap
  store file; it is a reasonable candidate for a future Batch-6-style
  follow-up note in `batches.md`, not a blocker for this batch.
- What would make this a 10: a one-line `batches.md` follow-up entry (in the
  same style as the original Batch 6 follow-ups) recording the accepted
  limitation for whichever future batch touches `connector-links.store.ts`
  next, so it is not only discoverable in the class doc.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score        | 6/10                                  |
| Assessment            | NEEDS_REVISION                        |
| Blocking issues      | 0                                     |
| Serious issues       | 2                                     |
| Moderate issues      | 3                                     |
| Failure modes found  | 5                                     |

Scope reviewed: all 10 files of Batch 15 in
`libs/frontend/marketplace/src/lib/pages/connectors/` (both components, both
templates, `connector-actions.ts`, `connectors-view-model.ts`, and their four
spec files) in the `task533-b15` worktree, plus the collaborators they call
into (`connector-links.store.ts`, `featured-connectors.component.ts`,
`category-bento.component.ts`, `native-drawer.component.ts`,
`storefront-hero.component.ts`, `harness-health.store.ts`,
`marketplace-shell.component.ts`) to trace behaviour past the batch boundary.
Read whole files, not diffs. Cross-checked against `batches.md` Batch 15 /
Batch 11 / Batch 6 follow-up sections, `implementation-plan.md` §9 (C9) and
"Revision 3 — D-4", and `handoff.md` §5.

## Five logic questions

### 1. How does this fail silently?

- **Harness health failure renders as permanent "still loading," never as an
  error.** `connectors-page.component.ts:295-307` computes `syncedTargets()`
  as `null` both while the read is genuinely in flight and after it has
  failed (`this.harness.error() === null ? [] : null`). `null` is exactly
  the value `StorefrontHeroComponent` uses to render the "Detecting CLIs"
  skeleton (`storefront-hero.component.ts:279-285`) — there is no branch for
  "failed." The page never re-asks (`harnessAsked` is set once and never
  reset, `connectors-page.component.ts:292,352-359`) and the hero's own
  `retryTile` output is wired only to `retryLoad()`, which retries the links
  store, not the harness store (`connectors-page.component.html:25-27`,
  `.ts:460-462`). A user who opens the wide-tier Connectors page while
  `harness:health` is down sees a spinner that never resolves and never
  learns anything failed. Not tested: `connectors-page.component.spec.ts`
  only exercises a successful `harness:health` response with `health: null`
  (line 190), never a `fail(...)` response.
- **A cross-connector action race mislabels which card an error belongs
  to** — see Failure modes below (`connector-actions.ts:68-88,142`). The
  symptom is not an exception; it is a plausible-looking error message
  attached to the wrong connector, which reads as a normal, successful
  error report to anyone who has not traced the race.

### 2. What user action produces unexpected behaviour?

- Clicking Connect/Authorize on two *different* cards before the first
  settles: the error banner that appears afterwards can name the wrong
  connector (see Failure modes). Nothing in the UI disables other cards
  while one action is in flight (`[disabled]="card.locked"` only disables
  the button on the card whose *own* `card.locked` is true,
  `connectors-page.component.html:394,411,428`), so this is reachable by
  ordinary rapid clicking, not just synthetic timing.
- Opening a Smithery Authorize (starts a 5-minute poll), navigating away
  from the Connectors page before it settles, then navigating back: the new
  `ConnectorActionsTracker` instance (page-scoped,
  `connectors-page.component.ts:152`) starts with an empty `awaitingSetup`
  set, so it never observes the original poll's outcome. If that poll times
  out while the user is elsewhere, the "Setup was not confirmed within 5
  minutes" + Retry UI (Batch 6 follow-up 2) never appears when the user
  returns — the card just quietly reverts to its normal not-connected/
  needs-auth look. See Failure modes.
- Closing the wide full-page detail after the search box or category filter
  has since removed its connector from the grid: `focusCard()`
  (`connectors-page.component.ts:515-522`) finds no
  `[data-grid-connector]` match and silently focuses nothing, so focus is
  lost to `<body>` instead of landing somewhere sensible (the grid heading,
  for instance).

### 3. What input data produces a wrong answer?

- No catalogue or RPC payload shape produced an obviously wrong rendered
  value in this batch's own logic; `filterConnectors`, `connectorCardState`,
  `placeActionError`, `connectorSetupSteps`, `safeDocsUrl` and
  `formatConnectorDate` are pure, total, and well covered
  (`connectors-view-model.spec.ts`, 44 tests). The one data-shape risk is
  inherited, not introduced: `connectorCardState.canAuthorize` does not
  exclude `managedElsewhere` connectors (`connectors-view-model.ts:170`), so
  a connector Ptah does not own but that needs auth still offers an
  "Authorize" button. This mirrors `ConnectorLinksStore.authorize()`
  itself, which has no `managedElsewhere` guard
  (`connector-links.store.ts:416-436`, unchanged by this batch) — pre-
  existing store behaviour, not a Batch 15 regression, so not scored here.

### 4. What happens when a dependency fails?

- `ConnectorLinksStore` load failure: handled — `links.state()==='error'`
  renders `connectors-load-error` with Retry
  (`connectors-page.component.html:82-110`), verified by spec (line 241).
- `HarnessHealthStore` failure: **not handled** — see Q1 and Failure modes.
- `mcpDirectory:openSmitherySetup` succeeding with `opened:false` and no
  error: handled per the Batch 6 follow-up — the store still reports
  `failed`, but `ConnectorActionsTracker.run()` re-checks the live status
  after the store's own re-read and dismisses the error when the connector
  is in fact connected (`connector-actions.ts:154-163`), confirmed by two
  specs (`connector-actions.spec.ts:179-210`).
- Silent 5-minute Smithery poll deadline: handled while the tracker that
  started the poll is still alive — `pollWatch`
  (`connector-actions.ts:111-130`) turns a deadline with no verdict into
  `timedOutIds`, rendered with Retry on both card and detail. Not handled
  across a tracker recreation (see Q2).
- A thrown RPC error inside `connect`/`authorize`/`disconnect`: the store's
  `failThrown` path (inherited from Batch 6's fix) keeps raw error text out
  of the UI; this batch does not touch that code and does not regress it.

### 5. What is missing that the requirements never mentioned?

- No UI affordance to retry a failed `harness:health` read specifically —
  the plan only anticipated the "empty" case (`health: null`, no error),
  per D6/Overview precedent, not a transport failure at this call site.
- No spec exercises two concurrent actions on different connectors, so the
  race in Failure Mode 1 has no regression guard even though the reviewer
  brief explicitly asked for exactly this class of check.

## Failure modes

### 1. Action-error message attributed to the wrong connector under a cross-connector race

- Trigger: the user starts an action (Connect/Authorize/Disconnect) on
  connector A, then — before A's RPC round trip resolves — starts an action
  on a *different* connector B. `ConnectorLinksStore.isBusy()` only guards
  per-connector concurrency (`connector-links.store.ts:794`), so both run
  concurrently. If B's action completes and fails first, then A's action
  completes and fails second, `ConnectorLinksStore._actionError` (a single
  global signal) ends up holding A's message. But
  `ConnectorActionsTracker.lastAction` was last *set* when `run(B, …)`
  started (`connector-actions.ts:142`), and is only ever updated at the
  *start* of `run()`, never at completion — so it still names B.
- Symptom: the page's `actionError` computed
  (`connector-actions.ts:77-88`) pairs A's failure text with B's
  `connectorId`/`origin`. The error banner or card-level alert
  (`connectors-page.component.html:353-381`,
  `connector-detail.component.html:124-150`) renders A's message on B's
  card — a plausible, well-formatted error that names the wrong app.
- Evidence: `connector-actions.ts:68` (`lastAction` signal, write-on-start
  only), `:77-88` (`actionError` computed mixes tracker-local `lastAction`
  with store-global `links.actionError()`), `:142` (`this.lastAction.set(...)`
  at the top of `run()`, before `await this.dispatch(...)` at `:145`).
  `connector-actions.spec.ts` has no test with two overlapping `run()`
  calls for different connectors (all tests `await` one call to completion
  before starting the next).
- Current handling: none — the mismatch is not detected or guarded against.
- Recommendation: attribute the error to the connector that *completed*
  the failing call, not the one that started most recently. The cleanest
  fix is for `run()` to capture its own `{connectorId, origin}` in a local
  closure variable and only update the *displayed* attribution when the
  outcome it is about to return is the one still reflected in
  `links.actionError()` (e.g. compare against a per-call token, or simply
  have the store's outcome carry the message and have the tracker key its
  own per-connector error state instead of trusting the store's single
  global signal for anything but "is there a message right now").

### 2. `harness:health` failure renders identically to "still loading," forever

- Trigger: `harness.refresh()` (`connectors-page.component.ts:357`, fired
  once at the wide tier when `harness.health() === null`) resolves with a
  transport or handler error.
- Symptom: `HarnessHealthStore.error()` becomes non-null,
  `HarnessHealthStore.loading()` returns to false
  (`harness-health.store.ts:106-136`), but
  `ConnectorsPageComponent.syncedTargets()` maps both "still loading" and
  "failed" to `null` (`connectors-page.component.ts:295-307`), which
  `StorefrontHeroComponent` renders as an indefinite skeleton with the
  screen-reader text "Detecting CLIs" (`storefront-hero.component.ts:279-
  285`). There is no retry path: `retryTile` is wired to the links store's
  reload only.
- Evidence: `connectors-page.component.ts:292-307,352-359`;
  `storefront-hero.component.ts:269-285`;
  `harness-health.store.ts:63-136` (confirms `error()` and `loading()`
  are independent, correctly-set signals — the bug is entirely in how the
  page collapses them).
- Current handling: none.
- Recommendation: distinguish the three states explicitly (loading /
  failed / empty) instead of collapsing "failed" into "loading," and give
  the hero an error affordance for this tile, or fall back to "No CLI
  detected" plus a distinguishable failure indicator so the state is not
  silently indistinguishable from progress.

### 3. A Smithery setup that times out while the user is off the Connectors page loses its "timed out, retry" state

- Trigger: user starts a Smithery Authorize (poll begins in the shell-
  scoped `ConnectorLinksStore`), navigates to another Marketplace page
  (destroying the page-scoped `ConnectorActionsTracker` and its
  `pollWatch` effect), and the poll's 5-minute deadline passes while they
  are away. They then return to the Connectors page.
- Symptom: a fresh `ConnectorActionsTracker` is created
  (`connectors-page.component.ts:152`, provided per-page) with an empty
  `awaitingSetup` set; it never learns that this connector's setup had been
  started and had since timed out, so `timedOutIds` never includes it. The
  card silently reverts to a plain not-connected/needs-auth state with no
  "Setup was not confirmed" message and no Retry affordance — the user has
  to re-discover the state on their own with no indication anything
  happened.
- Evidence: `connector-actions.ts:64-70` (fields are instance-local, no
  persistence), `connectors-page.component.ts:152`
  (`providers: [ConnectorActionsTracker]`, page-scoped) vs.
  `marketplace-shell.component.ts:111-113` (`ConnectorLinksStore` is shell-
  scoped and its poll timers are NOT tied to the page's lifetime, per its
  own class doc at `connector-links.store.ts:168-170`).
- Current handling: none; degrades to the pre-Batch-6-follow-up behaviour
  (silent) for exactly the subset of sessions that navigate away mid-poll.
- Recommendation: either move `awaitingSetup`/`timedOutIds` tracking into
  the shell-scoped store (rejected by the executor for line-count reasons —
  reasonable) or derive "timed out" from data the store already exposes
  reactively (e.g. compare `pollingIds` transitions against a
  page-independent record), so a page remount does not lose in-flight
  poll bookkeeping it did not itself start.

### 4. Focus lost (not returned anywhere) when the full-page detail closes onto a filtered-out grid

- Trigger: open a connector's full-page detail at the wide tier, change the
  search text or category filter (still possible via the "Back to
  connectors" link's target, or via keyboard/URL) so the connector no
  longer appears in `visibleConnectors()`, then close the detail (Esc or
  Back).
- Symptom: `focusCard(previous)` finds no `[data-grid-connector]` element
  matching the closed connector's id and calls nothing further
  (`connectors-page.component.ts:515-522`); no fallback focus target is
  set, so keyboard focus drops to `<body>`.
- Evidence: `connectors-page.component.ts:361-379` (effect scheduling
  `focusCard`), `:515-522` (`focusCard` silently no-ops on a miss).
- Current handling: none.
- Recommendation: fall back to the grid heading (`gridHeading()`, already
  available at `:197-198,528-531`) when the previously-open card is no
  longer in the DOM.

### 5. `harness:health` at the wide tier vs. the plan's "Connectors fires only the link reads" requirement

- Trigger: any wide-tier mount with `HarnessHealthStore.health() === null`.
- Symptom: none user-visible; flagged because `implementation-plan.md:478`
  states as a quality requirement "Connectors fires only the link reads,"
  and the executor's own report calls this out as a deliberate deviation
  (`batch-15-report.md` "Deviations / decisions to review").
- Evidence: `connectors-page.component.ts:352-359` (the gated
  `harness.refresh()` call); `implementation-plan.md:478`.
- Current handling: gated to fire at most once per page instance
  (`harnessAsked`), reuses the root store's cached answer on every other
  page, and is pinned by a spec
  (`connectors-page.component.spec.ts:210-217`). Functionally this mirrors
  the already-accepted C7 Overview pattern ("ensures … and `harness.refresh()`
  if `health()===null`," `batches.md:834`), so it is a defensible choice,
  not an oversight — but it is a plan-text conflict that was never
  formally re-opened, and it means an "RPC set is link reads only" claim
  elsewhere in the codebase (e.g. any cross-page RPC audit) would be wrong
  for the wide tier specifically.
- Recommendation: get this deviation explicitly accepted (team-leader /
  architect sign-off), the way the Overview page's equivalent rule was
  written into the plan, rather than leaving it as a self-reported
  deviation in a batch report.

## Blocking issues

None found.

## Serious issues

### Cross-connector action-error mismatch (Failure mode 1)

- File: `libs/frontend/marketplace/src/lib/pages/connectors/connector-actions.ts:68-88,142`
- Scenario: two different connectors' actions overlap and complete out of
  start order.
- Impact: the user is shown an accurate-looking error message on the wrong
  card, which can send them investigating or retrying the wrong connector
  while the actually-failing one shows no error at all.
- Fix: see Failure mode 1 recommendation — attribute the error by
  completion, not by start order, or key the tracker's error state
  per-connector instead of trusting a single global store signal for
  attribution.

### `harness:health` failure is indistinguishable from "still loading" (Failure mode 2)

- File: `libs/frontend/marketplace/src/lib/pages/connectors/connectors-page.component.ts:295-307`;
  `libs/frontend/marketplace/src/lib/ui/storefront-hero.component.ts:269-285`
- Scenario: the one gated `harness:health` RPC this page makes fails.
- Impact: the "Synced to" row spins forever with no error and no retry;
  the failure is permanently invisible to the user and to anyone reading
  the DOM for a health signal.
- Fix: see Failure mode 2 recommendation — add a distinct failed/empty
  branch and a retry affordance, or at minimum fall back to "No CLI
  detected" so the UI does not claim to still be working.

## Moderate and minor issues

- Poll-timeout tracking is lost across a Connectors-page navigate-away-and-
  back during an in-flight Smithery setup poll (Failure mode 3) —
  `connector-actions.ts:64-70`, `connectors-page.component.ts:152`.
- Focus is dropped (not redirected anywhere) when the full-page detail
  closes onto a connector that has since been filtered out of the grid
  (Failure mode 4) — `connectors-page.component.ts:515-522`.
- The extra `harness:health` read at the wide tier is undisclosed-to-the-
  plan-text even though functionally justified and tested (Failure mode
  5) — `connectors-page.component.ts:352-359` vs. `implementation-plan.md:478`.
- `connectorCardState.canAuthorize` does not exclude `managedElsewhere`
  connectors (`connectors-view-model.ts:170`) — inherited from the store's
  own `authorize()` (`connector-links.store.ts:416-436`), not a regression
  introduced by this batch; noted for completeness, not scored.

## Data flow

1. `ConnectorsPageComponent` constructor calls `links.ensure()`
   (`connectors-page.component.ts:348`) — OK, matches "links only" at
   compact/regular, confirmed by RPC-set spec.
2. Wide tier additionally triggers one gated `harness.refresh()`
   (`:352-359`) — OK functionally, flagged against plan text (Failure mode
   5, Moderate).
3. `links.links()` merges OAuth + Smithery reads into per-connector status
   (`connector-links.store.ts:270-308`) — OK, unchanged by this batch.
4. `connectorCardState()` (pure) turns a link + tracker state into what the
   card/detail draws (`connectors-view-model.ts:146-175`) — OK, thoroughly
   tested.
5. A card/detail action calls `ConnectorActionsTracker.run()`, which
   records `lastAction`, dispatches to the store, and post-processes the
   outcome (already-connected reclassification, timeout watch, inventory
   notification) — OK for the single-connector case; gap for overlapping
   different-connector actions (Failure mode 1).
6. `placeActionError()` (pure) picks exactly one surface for the tracked
   error — OK, matches the Batch 11 follow-up and is spec-covered including
   the page-level fallback.
7. Detail route open/close is driven by `NavigationEnd` → `detailId` →
   `placement()`/`fullPageDetail()` → drawer vs. full-page render — OK,
   tier-flip-with-detail-open is explicitly tested.
8. OAuth-app prefill: `effect()` gated by `prefilledFor`
   (`connector-detail.component.ts:246-262`) — OK, "once per connector,
   never overwrites user input" is correctly implemented and spec-covered
   including the "different connector re-prefills" case.
9. Esc / focus return: drawer restores focus itself
   (`native-drawer.component.ts:212-226,297-306`); full-page detail moves
   focus to its own heading and the page restores focus to the opening
   card on close — OK and tested, except the filtered-out-card edge case
   (Failure mode 4).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Ensures links only at compact/regular (C9) | COMPLETE | — |
| "Connectors fires only the link reads" (plan quality requirement) | PARTIAL | Wide tier adds one gated `harness:health` call; functionally justified, not formally re-opened against the plan text (Failure mode 5) |
| Search + `?category=`, chips + bento navigate via `connectorCategoryQueryParams()` | COMPLETE | — |
| Featured = first 6 not-connected `oauth-dcr` in catalogue order | COMPLETE | Spec asserts order and exclusion |
| Batch 11 follow-up: page-level fallback for an `actionError` whose connector left `items()` | COMPLETE | `placeActionError`, spec-covered |
| Batch 6 follow-up 1: "already connected" is not shown as a failure | COMPLETE | Correct for the single-connector case; correctness across concurrent different-connector actions is undermined by the attribution bug (Failure mode 1), a distinct issue from the reclassification logic itself, which is sound |
| Batch 6 follow-up 2: silent 5-minute poll deadline becomes a visible state | PARTIAL | Correct while the tracker that started the poll is alive; lost across a page navigate-away-and-back (Failure mode 3) |
| OAuth-app prefill once per connector, no overwrite of user input | COMPLETE | Spec-covered including the "different connector" and "never overwrites" cases |
| Detail placement: drawer at compact/regular, full page at wide, Esc + focus return | COMPLETE | Except the filtered-out-card edge case (Failure mode 4, Moderate) |
| Revision 3 D-4 workspace scope for connector rows | N/A (verified) | This page never renders session-derived connector rows and never constructs the real `MarketplaceInventoryStore`; all four specs stub it and only assert `notifyContentChanged()`, matching the binding rule in `batches.md` "Binding notes … Revision 3 D-4.3" |
| `connector-links.store.ts` left untouched (already 905 lines, over the 700 cap) | COMPLETE | Confirmed: no edits in the worktree diff; both follow-ups handled entirely in the page-scoped `ConnectorActionsTracker` |

Implicit requirements not addressed: a retry path for a failed
`harness:health` read at the wide tier (never specified, but the hero's own
"empty" case *was* specified, making the failure case's total silence a
gap the requirements left open, per the five-logic-questions charter).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Smithery `opened:false` with no error, re-read shows connected | YES | `connector-actions.ts:154-163` | None |
| Smithery `opened:false`, re-read still not connected | YES | Same path, error stays | None |
| Failed Disconnect while connected | YES | `action !== 'disconnect'` guard, `:155-156` | None |
| 5-minute poll deadline with no verdict | YES (single-tracker-lifetime) | `pollWatch` effect | Lost across page navigate-away-and-back (Failure mode 3) |
| Two different connectors' actions overlapping | NO | — | Wrong-card error attribution (Failure mode 1) |
| `harness:health` failure | NO | `syncedTargets()` collapses to the loading skeleton | Silent forever (Failure mode 2) |
| Tier flip with detail open | YES | Verified by spec (`follows a tier flip with the detail open`) | None |
| Esc in full-page detail while typing in a field | YES | `isTypingTarget` guard, spec-covered | None |
| Unknown `connectorId` | YES | "Connector not found" + link back, spec-covered at both tiers | None |
| `?category=` preserved across detail open/close | YES | Spec-covered | None |
| Full-page detail closes onto a connector filtered out of the grid | NO | `focusCard` no-ops | Focus dropped, not redirected (Failure mode 4) |
| Smithery no API key | YES | "Add a Smithery key" link, Connect withheld | None |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the cross-connector action-error race (Failure mode 1) is
  reachable by ordinary rapid clicking across two different cards, not a
  contrived timing coincidence, and produces a misleading error attribution
  with no test guarding against it.
- What a robust implementation would add: (1) attribute action errors by
  completion order, not start order, or key error state per-connector
  instead of through the store's single global signal; (2) a distinct
  failed state (with retry) for the wide-tier `harness:health` read,
  instead of collapsing it into the permanent loading skeleton; (3)
  persistence of in-flight poll/timeout bookkeeping across a Connectors-
  page remount, or an explicit accepted-limitation note if that is judged
  out of scope; (4) a focus fallback when the previously-open card is no
  longer in the filtered grid on close.
