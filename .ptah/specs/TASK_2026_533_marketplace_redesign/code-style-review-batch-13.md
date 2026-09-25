# Code Style Review — `TASK_2026_533` Batch 13

Scope: Installed servers list and server-detail pages, plus the two Batch-10-mandated
pre-fixes. Worktree `D:\projects\ptah-extension\.claude-worktrees\task533-b13` (branch
`task533-b13`, base `a990942f8`). All files read in full (not diff-only):

- `libs/frontend/marketplace/src/lib/data/provider-filtering.ts` (+`.spec.ts`)
- `libs/frontend/marketplace/src/lib/ui/bulk-action-bar.component.ts` (+`.spec.ts`)
- `libs/frontend/marketplace/src/lib/pages/servers/installed-provider-rows.ts`
- `libs/frontend/marketplace/src/lib/pages/servers/provider-list-view.component.{ts,html,spec.ts}`
- `libs/frontend/marketplace/src/lib/pages/servers/installed-servers-page.component.{ts,spec.ts}`
- `libs/frontend/marketplace/src/lib/pages/servers/server-detail.component.{ts,html,spec.ts}`

Compared against: `data/provider-row.ts`, `ui/provider-table.component.ts`,
`ui/docked-inspector.component.ts`, `ui/status-pill.component.ts`,
`ui/native-drawer.component.ts`, `data/connector-links.store.ts`,
`data/workspace-session-status.ts` (Batch 12b), `shell/marketplace-nav-counts.ts` (Batch 12),
`ui/native/shared/keyboard-navigation.service.ts` and its one existing consumer
(`tasks-ui/.../task-command-palette.component.ts`), `implementation-plan.md` (C5, C7, C8),
`batches.md` Batch 8/9/10/12b binding notes, `handoff.md` §5.

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 7/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 0                                    |
| Serious issues  | 2                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 12 (6 new components + 3 new specs across 2 pages/1 view, 2 modified + 2 modified specs) |

## Five style questions

### 1. What breaks in six months?

Nothing breaks outright — the batch is functionally sound and its specs are strong (real
router harness, real stores with RPC spies, masking assertions, workspace-switch fallback).
The maintenance risk is in `installed-provider-rows.ts:1-53`: its own doc comment says
"Batch 14's Overview can reuse it" (`installed-provider-rows.ts:9`, confirmed in
`batches.md:775-817` Batch 14 depends on Batch 13). Once Batch 14 (`pages/overview/`)
imports from `pages/servers/installed-provider-rows.ts`, the repo will have its first
page-folder-to-page-folder import in this lib, with no boundary rule governing it. A third
consumer (Batch 16, skills) doing the same for its own domain, or someone "fixing" the
cross-import, either compounds the drift or forces a rename six months from now that the
data/ placement would have avoided today.

### 2. What would a new team member misread?

Two things: (a) they would look at `data/` for "the thing that turns installed groups into
rows for a page to inject" (it is exactly the shape of `data/workspace-session-status.ts`,
`data/provider-row.ts`, `data/connector-links.store.ts`) and not find `injectProviderRows`
there — it is one level down in `pages/servers/`. (b) `provider-list-view.component.ts:442-460`
`moveActive()` calls `keyboardNav.configure({...})` on every keydown, which the service's own
JSDoc (`keyboard-navigation.service.ts:85-111`) documents as resetting `activeIndex` to `0`;
the very next line calls `setActiveIndex(current)` to undo that reset. A reader who only
knows the service from its documented example (configure once via an `effect`,
`task-command-palette.component.ts:314,340-353`) will read this as a bug before realising it
is deliberate (row refs, not positions, are this component's real state — Batch 3's A1
guarantee that selection survives a tier flip needs that). The class doc at
`provider-list-view.component.ts:163-165` names the sequence but not why the reset canvas
each keystroke is safe.

### 3. What does this cost to maintain?

The direct-removal confirmation UI (warning copy, path list, "Remove anyway"/"Cancel") is
written twice: `provider-list-view.component.html:36-92` (bulk/single) and
`server-detail.component.html:380-419` (single only), with matching classes
(`rounded-lg border border-warning/40 bg-base-200 p-3`, `btn btn-error btn-xs`, near-identical
copy). A future wording, a11y, or i18n change to this warning has two places to find and one
is easy to miss, especially since this batch's own C8 siblings (`BulkActionBarComponent`,
`RemovalLockBadgeComponent`) already established the pattern of extracting exactly this kind
of repeated bit into `ui/`.

### 4. Where is this inconsistent with the rest of the repository?

- Injection-context helpers meant for more than one consumer live in `data/`
  (`data/workspace-session-status.ts`, Batch 12b) or `shell/` when shell-only
  (`shell/marketplace-nav-counts.ts`, Batch 12). `installed-provider-rows.ts` is the first one
  placed inside a `pages/<x>/` folder while explicitly designed for a different page folder
  to import from.
- The confirm-direct-removal block duplicates markup the C8 kit's own precedent
  (`BulkActionBarComponent`, `RemovalLockBadgeComponent`) says should be extracted.
- Everything else checked is consistent: `.html` templates on `ProviderListViewComponent` and
  `ServerDetailComponent` match the plan's own file list (`implementation-plan.md:427`, which
  lists `+.html` for exactly these two and no `.html` for `InstalledServersPageComponent`),
  and match the established page/shell-tier convention (`shell/marketplace-shell.component.html`,
  Batch 12) versus the inline-template convention used by the smaller `ui/` kit pieces
  (Batches 9–11) — this is not a deviation, it is the plan's own split honoured correctly.

### 5. What would you have done differently, and why is that better rather than merely other?

Move `injectProviderRows`/`findGroupByRef` into `data/` (e.g. `data/provider-rows.injected.ts`,
or fold into `data/provider-row.ts`'s neighbourhood) before Batch 14 lands, and extract the
direct-removal-confirm block into one `ui/` component consumed by both the list view and the
detail. Both are cheap now (three import-site edits; one small presentational extraction) and
expensive later: the first because Batch 14 is the very next batch and will otherwise
normalise the page-to-page import path, the second because two copies of safety-critical
warning copy is exactly the kind of drift the hunt list calls out.

## Blocking issues

None.

## Serious issues

### Cross-page-folder collaborator placed outside `data/`

- File: `libs/frontend/marketplace/src/lib/pages/servers/installed-provider-rows.ts:1-53`
- Problem: `injectProviderRows()` and `findGroupByRef()` are injection-context helpers over
  the two shell-scoped stores (`MarketplaceInventoryStore`, `ConnectorLinksStore`), exactly
  the shape of `injectWorkspaceSessionStatus` in `data/workspace-session-status.ts:1-71`
  (Batch 12b) — but placed in `pages/servers/` instead of `data/`. The file's own doc comment
  (line 9) and the batch report's decision #2 (`batch-13-report.md:109`, "Batch 14's Overview
  can reuse it") both say it is meant for a *different* page folder
  (`pages/overview/`, Batch 14) to import.
- Impact: Batch 14 (already queued, depends on Batch 13 per `batches.md:819-825`) will import
  `../servers/installed-provider-rows` from `pages/overview/`, creating a `pages/*` →
  `pages/*` import this lib has never had. `data/` is where cross-page shared read logic goes
  today (`provider-row.ts`, `provider-filtering.ts`, `connector-links.store.ts`,
  `workspace-session-status.ts`); nothing marks `pages/servers/` as a shared surface other
  pages may reach into, so the boundary is accidental rather than declared. Batch 16
  (skills pages, running in parallel) is positioned to make the same choice for its own
  page-local row helper with no convention to follow either way.
- Fix: move the file to `data/` (e.g. `data/provider-rows.injected.ts`) before Batch 14
  starts, and update the three import sites: `provider-list-view.component.ts:52`,
  `installed-servers-page.component.ts:14`, `server-detail.component.ts:47`.

### Direct-removal confirmation markup duplicated across two templates

- File: `provider-list-view.component.html:36-92`, `server-detail.component.html:380-419`
- Problem: both templates independently render the "Ptah did not install …/Removing it edits
  a config file you own:" warning, the per-row config-path list, and the "Remove anyway" /
  "Cancel" button pair, with matching classes (`rounded-lg border border-warning/40
  bg-base-200 p-3`, `btn btn-error btn-xs`, `btn btn-ghost btn-xs`) and near-identical copy.
  Both are inside the same batch, by the same author, immediately after the C8 kit
  (Batch 9) established `BulkActionBarComponent` and `RemovalLockBadgeComponent` as the
  pattern for exactly this kind of repeated confirmation/action chrome.
- Tradeoff: as written, a future change to the warning's wording, its `role="group"`
  labelling, or its path-list markup has two call sites to update; missing one leaves the
  bulk and single confirmation flows visibly different for the same "you own this config
  file" situation, which is the accessibility-relevant text in the whole batch.
- Recommendation: extract a small presentational component (e.g.
  `ptah-direct-removal-confirm`, inputs `rows: readonly { title; configPaths }[]`,
  `mode: 'single' | 'bulk'`, outputs `confirmed`/`cancelled`) under `ui/`, consumed by both
  `ProviderListViewComponent` and `ServerDetailComponent`.

## Minor issues

- `provider-list-view.component.ts:399-400`: `this.route.firstChild?.snapshot as
  ActivatedRouteSnapshot | undefined` — the `as` cast is redundant; optional chaining on
  `ActivatedRoute | null` already yields `ActivatedRouteSnapshot | undefined` without it.
- `provider-list-view.component.ts:445-455`: `moveActive()` calls
  `keyboardNav.configure({ itemCount, wrap: false })` on every keydown rather than once via
  an `effect` on row count (the pattern the service's own JSDoc,
  `keyboard-navigation.service.ts:94-111`, and its one other consumer,
  `task-command-palette.component.ts:314-353`, both use). The choice is defensible — row
  refs, not positions, are this component's real active-item state, which the service's
  index cannot be — but nothing marks it as a deliberate divergence from the documented
  idiom beyond the class-level doc summary at line 163-165. A one-line comment at the call
  site would keep a future reader from "fixing" it into the documented pattern and breaking
  tier-flip selection stability (A1).

## File-by-file

### `data/provider-filtering.ts` (+`.spec.ts`)

Score 10/10 — 0/0/0. Exactly the Batch 10 binding fix: `providerStatusLabel` now derives from
`statusPresentation()` (`provider-filtering.ts:82-84`), search matches the pill's own word
including the `unknown` raw-text case (`:116`), and the diff against `a990942f8` shows no
change beyond what the binding note required. New specs assert every `ProviderStatus` label
equals the pill word.

### `ui/bulk-action-bar.component.ts` (+`.spec.ts`)

Score 10/10 — 0/0/0. Exactly the Batch 10 binding fix: the tone now sits on a wrapper
`<span data-tone>` (`bulk-action-bar.component.ts:148-163`) instead of `[class]` on
`lucide-angular` (which its own `class` input was overwriting), with an inline comment
explaining why, and four new regression specs.

### `pages/servers/installed-provider-rows.ts`

Score 6/10 — 0 blocking / 1 serious / 0 minor. The logic itself is correct and exactly
matches the Batch 8 "no raw group on the row, look it up by `ref`" contract
(`installed-provider-rows.ts:38-53`). The serious issue is placement (see Serious issues).

### `pages/servers/provider-list-view.component.ts` (+`.html`, +`.spec.ts`)

Score 8/10 — 0 blocking / 1 serious (shared with the duplication finding above) / 2 minor.
Detail placement (`:298-343`), keyboard handling (`:408-491`), bulk/single removal
(`:493-586`) and the origin grouping (`:264-277`) all match the plan and the Batch 9/10
binding notes precisely; the drawer/docked branch, the escape layering, and the bulk-scope
decision (selected + visible + selectable only, `:289-294`) are all correctly reasoned and
tested. 692-line spec covers tier flip, focus trap/no-steal, keyboard, and partial-failure
bulk removal.

### `pages/servers/installed-servers-page.component.ts` (+`.spec.ts`)

Score 9/10 — 0/0/0. Thin page exactly as specified: one `h1`, the summary line built from
`liveInLastSession()` (exported, pure, `:22-26`), ensures only `installed` + links
(`:107-110`). RPC-set spec pins the exact call list.

### `pages/servers/server-detail.component.ts` (+`.html`, +`.spec.ts`)

Score 8/10 — 0 blocking / 1 serious (shared with the duplication finding above) / 0 minor.
Masking is correct and tested (`server-detail.component.spec.ts:354-378` asserts no secret
text in any tab's `innerHTML`); the not-found and workspace-switch fallback
(TASK_2026_540 item 6c) is pinned by a real `WorkspaceScopeService.switchTo` spec
(`:274-290`); tabs, lock banner, reconnect and removal all match plan C7 and the C4/C8
contracts precisely.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Page-tier components use `.html`, `ui/`-kit components use inline `template` (plan file list) | PASS | `implementation-plan.md:427` lists `+.html` only for `ProviderListView`/`ServerDetail`; `provider-list-view.component.ts:195`, `server-detail.component.ts:135` use `templateUrl`; `installed-servers-page.component.ts:43-82` (no `.html` in plan) uses inline `template` |
| `ProviderRow` carries no raw group; look up by `ref` (Batch 8 binding) | PASS | `installed-provider-rows.ts:39-53`, used at `provider-list-view.component.ts:533,552`, `server-detail.component.ts:179-181,402` |
| `providerStatusLabel` derives from `statusPresentation()` (Batch 10 binding) | PASS | `provider-filtering.ts:82-84,116` |
| Bulk-bar icon tone on a wrapper span, never `[class]` on `lucide-angular` (Batch 10 follow-up) | PASS | `bulk-action-bar.component.ts:148-163` |
| `ptah-docked-inspector` owns no Escape; page owns it (Batch 9 binding) | PASS | `provider-list-view.component.ts:412-420` |
| `ptah-copy-command-button` requires `selectTarget` (Batch 9 binding) | PASS | `server-detail.component.html:126-136` |
| Page contract: search inside `<main>` as `input[type=search]`, one `<h1>`, ↑↓/Enter/Esc implemented (Batch 12 binding) | PASS | `provider-filters.component.ts:76` (`type="search"`, pre-existing, correctly consumed); `installed-servers-page.component.ts:52` (single `h1`); `provider-list-view.component.ts:408-440` (keyboard) |
| `catch (error: unknown)`, no `innerHTML`, theme tokens only | PASS | `provider-list-view.component.ts:570`; grep for `innerHTML`/hex literals in all new `pages/servers/*` files returns none outside spec assertions |
| Injection-context, cross-page-reusable helpers live in `data/` (or `shell/` when shell-only) | FAIL | `pages/servers/installed-provider-rows.ts` vs. `data/workspace-session-status.ts` (Batch 12b), `shell/marketplace-nav-counts.ts` (Batch 12) |
| Repeated confirmation/action chrome is extracted into `ui/` (C8 precedent) | FAIL | `provider-list-view.component.html:36-92` vs. `server-detail.component.html:380-419` |
| No `TabManagerService`/store-construction mismatch (Revision 3 D-4.3 spec rule) | PASS | `installed-servers-page.component.spec.ts:1-30` stubs `TabManagerService` for the real store |

## Maintenance debt

- Introduced: one correctly-scoped cross-page helper file in the wrong directory (cheap to
  relocate now, before Batch 14 imports it); one duplicated confirmation-dialog block across
  two templates.
- Retired: the two Batch 10 binding defects (status-label disagreement, bulk-bar icon tone)
  are fully closed with regression specs.
- Net: slightly negative on the two serious items above; strongly positive everywhere else
  (masking, workspace-switch fallback, keyboard, and detail-placement logic are all correct,
  tested, and match every binding contract from Batches 8, 9, 10 and 12b).

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `installed-provider-rows.ts` sits in `pages/servers/` while explicitly built
  for `pages/overview/` (Batch 14) to import — fix before Batch 14 starts, or the wrong
  boundary becomes load-bearing.
- What a 10/10 version would do differently: place `injectProviderRows`/`findGroupByRef` in
  `data/`; extract the direct-removal-confirm block into one shared `ui/` component consumed
  by both the list view and the detail; add a one-line comment at the
  `KeyboardNavigationService.configure()` call site noting the deliberate per-keystroke
  reconfigure.

## Round 2 (revise round 1)

Scope: the 4 style fixes from Round 1 plus the new spec-file split, applied in
`D:\projects\ptah-extension\.claude-worktrees\task533-b13` (`batch-13-report.md` "Revise
round 1", items 5-8). Verified against Round 1's evidence, not re-derived from scratch.
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace` reported green by
the executor (50 suites, 1091 tests) — accepted from the report; not independently rerun.

### Fix-by-fix verification

1. **Helper relocated to `data/`.** `libs/frontend/marketplace/src/lib/data/installed-provider-rows.ts:1-53` — the file moved verbatim (same body, same doc comment) from `pages/servers/`; imports now `./connector-links.store`, `./marketplace-inventory.store`, `./provider-row`, `./server-ref` (all same-directory). The three call sites correctly import `../../data/installed-provider-rows`: `provider-list-view.component.ts:52`, `installed-servers-page.component.ts:14`, `server-detail.component.ts:47`. Matches the `data/workspace-session-status.ts` precedent this review cited. Resolved.
2. **Duplicated confirm markup extracted.** `libs/frontend/marketplace/src/lib/ui/direct-removal-confirm.component.ts:1-122` (+ 107-line spec, 4 tests) is a clean presentational extraction: `targets`/`selectedCount` inputs, `confirmed`/`cancelled` outputs, no `inject()`, single vs. bulk copy driven by one `bulk()` computed. Both consumers now render `<ptah-direct-removal-confirm>` (`provider-list-view.component.html:37`, `server-detail.component.html:381`) instead of inline markup, and the component doc comment correctly cites the pattern's origin (`mcp-directory-browser.component.ts:380-425`). Resolved.
3. **Redundant cast dropped.** `provider-list-view.component.ts:444-445` now reads `this.route.firstChild?.snapshot?.paramMap.get('serverRef') ?? null` with no `as` cast; the comment explaining why the snapshot can be briefly absent is kept immediately above it. Resolved.
4. **Keyboard-service comment added.** `provider-list-view.component.ts:489-490`: "Re-configured on every key: the state is the active row's REF (rows re-filter and re-sort between keys), so its index is re-seeded each time." Directly answers the concern raised in Round 1's Minor #2. Resolved.

### New structural choice: spec split + shared `.testing.ts` harness

`provider-list-view.component.spec.ts` (286 lines) was split into itself (tiers, detail
placement, focus, keyboard) plus `provider-list-view.removal.spec.ts` (301 lines: removal,
the live-re-derived confirmation, the bulk/single race, empty states,
`bulkRemovalResult`), sharing `provider-list-view.testing.ts` (308 lines: fixtures, the
routed test-host components, `configureListViewTestBed`, and a `ListViewPage` DOM driver).

**Split into aspect-named sibling specs.** Strongly precedented in this repository, not
novel: `libs/frontend/chat-state/src/lib/tab-manager.{cross-workspace,history-window,
intent-mutators,lifecycle,notification-pulse,persistence}.spec.ts` (6 aspect files beside
`tab-manager.service.spec.ts`) and `libs/frontend/chat/src/lib/components/templates/
chat-view.{keepalive,memo}.spec.ts`, `app-shell.{auth-redirect,notification-center,
outlet-wrapper}.spec.ts` all use the same `<name>.<aspect>.spec.ts` shape. Accepted — no
different shape required.

**Shared non-spec `.testing.ts` harness, typechecked as library code.** Verified the
specific claim: `libs/frontend/marketplace/tsconfig.lib.json:9-14` excludes only
`src/**/*.spec.ts` and `src/**/*.test.ts`, so `provider-list-view.testing.ts` (no `.spec.`
in its name) is included in `tsc -p tsconfig.lib.json` same as production source.
`libs/frontend/dashboard/tsconfig.lib.json` has the byte-identical exclude list, and
`libs/frontend/dashboard/src/lib/services/session-analytics-state.testing.ts` is the same
shape: a spec-only module (own doc comment: "Spec-only: no production file imports this
module") holding fixtures, a fake collaborator and helpers, consumed by more than one
sibling spec, and — checked — not re-exported from either lib's public barrel
(`grep` of `installed-provider-rows|provider-list-view.testing` and
`session-analytics-state.testing` against both `src/index.ts` files: no matches). The new
file follows the precedent's own conventions closely, including the "no jest globals; specs
use `jest.spyOn`" discipline and an explicit citation of the precedent in its header
comment. Accepted — this is not a new pattern being introduced unreviewed; it reproduces an
existing, unchallenged one exactly, including the same tooling trade-off (the harness is
typechecked with the library, not excluded like a spec), which is inherited from the
precedent rather than newly introduced by this batch.

Both split specs correctly import only from `./provider-list-view.testing` (no duplicated
fixture/TestBed setup between them) and use the `describe('ProviderListViewComponent —
removal', …)` naming that matches the "aspect after an em dash" convention used by the
`tab-manager` and `chat-view` precedents' `describe` blocks.

### Round 2 summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 0                                    |
| Files reviewed  | 7 (2 moved/created + spec, 1 new component + spec, 3 spec-split files) |

### Round 2 verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none remaining from Round 1. The spec split and shared harness are a
  faithfully-applied, precedented pattern (aspect-split specs: `tab-manager.*`,
  `chat-view.*`, `app-shell.*`; shared `.testing.ts` harness: `dashboard/.../
  session-analytics-state.testing.ts`, same tsconfig shape, same non-barrel status).
- Remaining observation (not a finding): the `.testing.ts` convention relies on author
  discipline ("no production file imports this module") rather than a tooling boundary
  (ESLint import-boundary rule or a tsconfig exclude), same as its precedent. If this
  pattern spreads to more pages in this lib, a lint rule restricting `*.testing.ts` imports
  to `*.spec.ts` files would close that gap — worth a future task, not a Batch 13 blocker.
