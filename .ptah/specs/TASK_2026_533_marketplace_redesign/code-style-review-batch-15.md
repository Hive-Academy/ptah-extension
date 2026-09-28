# Code Style Review — `TASK_2026_533` Batch 15 (Connectors pages)

Worktree reviewed: `D:\projects\ptah-extension\.claude-worktrees\task533-b15` (branch
`task533-b15`, base `a990942f8`). Compared against `ui/` (Batches 9–11, especially
`featured-connectors.component.ts`), `shell/` (Batch 12), the parallel Batch 13
(`task533-b13\...\pages\servers\`) and Batch 16 (`task533-b16\...\pages\skills\`).

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 6/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 0                                    |
| Serious issues  | 2                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 8 (all `pages/connectors/*`) + 3 comparison files (`featured-connectors.component.ts`, `installed-provider-rows.ts`, `installed-skill-rows.ts`) |

## Five style questions

### 1. What breaks in six months?

The card-status block (managed-elsewhere note, activity spinner, timed-out banner,
Smithery-key link, dismissible error) is written out three separate times:
`ui/featured-connectors.component.ts:315-391`, `connectors-page.component.html:266-383`,
and `connector-detail.component.html:47-152`. They are already not identical — the
featured row's `hasStatus`/`toCardView` (`featured-connectors.component.ts:139-175`) has
no `timedOut` or `needsSmitheryKey` fields, while the page's `ConnectorCardState`
(`connectors-view-model.ts:119-137`) does. The next person to add a fourth connector
state (there is precedent — Batch 6 added two: timed-out and Smithery-no-key) has to
remember to touch three template blocks and reconcile two independent state-derivation
functions, or the surfaces silently disagree on what a connector's status is.

### 2. What would a new team member misread?

`connectors-view-model.ts` reads as the page's one pure helper, matching the role
`installed-provider-rows.ts` (Batch 13) and `installed-skill-rows.ts` (Batch 16) play in
their own folders — but it is named with vocabulary ("view-model") that appears nowhere
else in the repository (confirmed: no other `*view-model*` file exists in
`libs/frontend/marketplace`). A reader who has just read `pages/servers/` or
`pages/skills/` and is now skimming `pages/connectors/` for "the pure page helper" will
not immediately connect `connectors-view-model.ts` to the same architectural role, and
may wonder whether it is a different (MVVM) pattern this codebase does not otherwise use.

### 3. What does this cost to maintain?

Roughly 150 lines of near-identical template markup per surface (three surfaces), plus
two independently written and independently tested card-state derivation functions
(`toCardView` in `featured-connectors.component.ts:139-175`, `connectorCardState` in
`connectors-view-model.ts:146-175`) that must be kept in sync by convention (the doc
comment at `connectors-view-model.ts:140-144` says as much: "They match the featured
row's ... Connect when not connected, Authorize when listed but unusable..."). Every
future connector-state change is a three-file, two-function edit instead of a one-file
edit, with no compiler or test that would catch the surfaces drifting apart other than
manual review.

### 4. Where is this inconsistent with the rest of the repository?

- Naming: `connectors-view-model.ts` vs. the sibling batches' `installed-provider-rows.ts`
  / `installed-skill-rows.ts`, and the pre-existing `mcp-connector-rows.ts`
  (`libs/frontend/marketplace/src/lib/mcp-connector-rows.ts:1`). Three page folders, three
  different names for the same kind of file.
- Method naming inside this batch itself: `connectors-page.component.ts:389`
  (`hasStatus(card)`) and `connector-detail.component.ts:295`
  (`hasStatusNotes(card)`) compute the identical predicate — "does the status slot have
  anything to draw" — under two different names in two files of the same PR.
- What is **not** inconsistent, despite looking like it at first glance: the
  inline-template (`pages/skills/`) vs. separate-`.html` (`pages/connectors/`,
  most of `pages/servers/`) split across the three page folders is not an executor
  choice — `implementation-plan.md:480` lists `connectors-page.component.ts (+.html,
  +spec)` and `connector-detail.component.ts (+.html, +spec)` for C9's connectors files,
  and lists the four skills files with no `+.html` at all; `implementation-plan.md:427`
  does the same split within C7's servers files (`.html` for
  `provider-list-view`/`server-detail`, none for
  `installed-servers-page`/`server-source-host`). Batch 15 followed the plan's file list
  exactly. No fix needed here; this is not a Batch 15 defect.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have used C13's `CatalogCardComponent` content-projection slots to carry a single
shared presentational partial for the status block and the action-button row — either a
small `ui/` component (e.g. `ConnectorCardBodyComponent`, taking the already-shared
`ConnectorCardState`-shaped input and emitting `action`) or, at minimum, an
`ng-template`/`ngTemplateOutlet` exported once and consumed by
`FeaturedConnectorsComponent`, the grid, and the detail. That collapses three
maintenance sites into one and removes the possibility of the drift already observed
between the grid and the featured row. This is better than "leave it for a later ui
batch" (the executor's own suggestion, `batch-15-report.md:68`) because the drift is not
hypothetical — it already exists in this batch, and every render tier (compact, regular,
wide) is live in production behind this PR, not behind the deferred batch.

## Blocking issues

None. No boundary violation, no import crossing a layer the repository disallows, no
contract or type-safety weakening was found. `ConnectorActionsTracker`'s
`@Injectable()` without `providedIn` is a recognized, already-used repository pattern
(see Pattern compliance) and is used correctly and disclosed.

## Serious issues

### Card markup and card-state logic triplicated across grid, featured row and detail, with observed drift

- File: `connectors-page.component.html:248-445` (grid card body), compare
  `ui/featured-connectors.component.ts:296-460` (featured card body) and
  `connector-detail.component.html:1-208` (detail's equivalent blocks); underlying state
  derivation: `connectors-view-model.ts:146-175` (`connectorCardState`) vs.
  `ui/featured-connectors.component.ts:139-175` (`toCardView`, private/unexported).
- Problem: three independent implementations of "how a connector's status and actions
  render" exist in this batch and its dependency. The plan's stated intent for C8
  (`implementation-plan.md:447`) is that "connector cards ... share one card" — satisfied
  only at the `CatalogCardComponent` shell level, not at the status/action content that
  fills it. The two state-derivation functions are documented as required to match by
  convention rather than by a shared implementation, and they have already diverged:
  `toCardView`'s `FeaturedCardView` has no `timedOut`/`needsSmitheryKey` fields that
  `ConnectorCardState` has (Batch 6 follow-ups, handled only in the page layer per
  `batch-15-report.md:51-56`).
- Tradeoff: leaving three copies means every new connector state (there have already been
  two added post-hoc: timed-out, Smithery-no-key) requires editing three templates and
  reconciling two functions by hand, with nothing enforcing the "they match" comment at
  `connectors-view-model.ts:140-144`. A shared partial makes the next state addition a
  one-file change and removes the drift risk entirely.
- Recommendation: extract the status/action content (the `card-status` and
  `card-actions` projected content, plus the state-derivation function) into one shared
  unit both `FeaturedConnectorsComponent` and `ConnectorsPageComponent`/
  `ConnectorDetailComponent` consume — a presentational `ui/` component using
  `ConnectorCardState` as its contract (a strict superset of `FeaturedCardView` already),
  or an exported `ng-template`. Do this before or as part of accepting this batch, not
  deferred to "a later ui batch" (`batch-15-report.md:68`) — the drift is already
  present, not merely a future risk.

### Pure page-helper file named outside the convention its two sibling batches established

- File: `connectors-view-model.ts:1` (the file itself), compare
  `task533-b13\...\pages\servers\installed-provider-rows.ts:1` and
  `task533-b16\...\pages\skills\installed-skill-rows.ts:1`, and the pre-existing
  `libs/frontend/marketplace/src/lib/mcp-connector-rows.ts:1`.
- Problem: all three page folders need one pure file that a page and its detail share
  for filtering, row/card shaping and lookups. Batches 13 and 16 (and the file that
  predates all three, `mcp-connector-rows.ts`) name it `*-rows.ts`; Batch 15 introduces
  `*-view-model.ts`, a term used nowhere else in the repository. `grep -rn "view-model" \
  libs/frontend/marketplace/src` (main checkout) returns nothing prior to this batch.
- Tradeoff: `connectors-view-model.ts` does cover a broader surface than a pure
  "rows" transformer would suggest (card state, action-error placement, keyboard
  targeting, date formatting) — but so does `installed-skill-rows.ts` (search filtering,
  ref decoding, group construction), and it still kept the `-rows.ts` name. Introducing a
  second vocabulary for the same architectural role costs a new reader the extra step of
  confirming the two names mean the same thing.
- Recommendation: rename to fit the domain-noun pattern already used twice in this task
  (e.g. `connector-cards.ts`, since the domain unit here is a card, not a row) rather
  than the unprecedented "view-model" suffix — or, if the team wants "view-model" to
  become the new convention going forward, say so once in a place future batches will
  read (not just this file's own doc comment) so Batches 13/16's naming does not look
  like the outlier in hindsight.

## Minor issues

- `connectors-page.component.ts:389` (`hasStatus`) and `connector-detail.component.ts:295`
  (`hasStatusNotes`) name the same predicate differently within this batch itself.
- `connectors-page.component.spec.ts` is exactly 700 lines (`wc -l` confirms), i.e. at,
  not under, the ceiling implementation-plan.md states ("New human-maintained files stay
  under 700 lines", `implementation-plan.md:688`). `eslint.config.mjs:507-518` exempts
  `*.spec.ts` from the `max-lines` rule, so this is not a lint failure, and the file's
  content reads as naturally organized (no sign of artificial compression to hit the
  number) — but it sits exactly on the boundary the plan's own stricter precedent
  (`batches.md:745`, "≤699" for a file the plan explicitly capped) treats as already over.
  Worth a glance before Batch 17 adds the route-wiring assertions this file's own doc
  comment (`connectors-page.component.spec.ts:2-3`) says are coming.

## File-by-file

### connectors-page.component.ts

Score 7/10 — 0 blocking, 1 serious (shared with the triplication finding), 0 minor. Well
structured signal-based state, correct RPC-set discipline (`links.ensure()` only, one
conditional `harness:health` read pinned by spec), correct keyboard/focus handling
(`connectors-page.component.ts:464-522`). The `hasStatus` naming drift
(`connectors-page.component.ts:389`) is the only local nit.

### connectors-page.component.html

Score 5/10 — 0 blocking, 1 serious (the triplicated card markup, `:248-445`), 0 minor.
Otherwise faithful to the C9 quality bar (skeletons before first read settles, one `h1`
per tier, drawer vs. full-page split, empty/error/notice states).

### connector-detail.component.ts

Score 7/10 — 0 blocking, 1 serious (shared), 1 minor (`hasStatusNotes` naming,
`:295`). Correct once-per-connector prefill guard (`:246-262`), correct focus handoff
between drawer `<h2>` and page `<h1>` (`:264-274`), reuses `connectorCardState` rather
than re-deriving.

### connector-detail.component.html

Score 6/10 — 0 blocking, 1 serious (shared, `:47-152`), 0 minor. Facts list, docs-link
`rel="noopener noreferrer"` handling and the oauth-app setup section are all correctly
built from the shared view-model functions.

### connector-actions.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor. Clean, well-justified page-scoped
`@Injectable()` with a matching, already-used repository pattern for the
`eslint-disable` (see Pattern compliance). Handles both disclosed Batch 6 follow-ups
without growing the over-cap store. This is the strongest file in the batch.

### connectors-view-model.ts

Score 6/10 — 0 blocking, 1 serious (naming, the file itself), 0 minor. The functions
themselves are small, pure, well-documented and well-tested; the file's name and its
`connectorCardState` duplicating `toCardView` are the issues, not its content.

### connectors-page.component.spec.ts / connector-detail.component.spec.ts / connector-actions.spec.ts / connectors-view-model.spec.ts

Score 8/10 each — 0 blocking, 0 serious, spec-file-line-count note above applies only to
`connectors-page.component.spec.ts` (minor). RPC-spy discipline, tier stubs, the D-4.3
real-store/stub-store spec rule (`connectors-page.component.spec.ts:107-198`: real
`ConnectorLinksStore` via the host component, stubbed `MarketplaceInventoryStore`) and
the featured-rule and prefill specs are all present and match the plan's verification
seam requirements.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Page-scoped `@Injectable()` without `providedIn`, disclosed with `eslint-disable` + note | PASS | `connector-actions.ts:62-63`; matches `libs/frontend/skill-synthesis-ui/src/lib/services/clone-bulk-rebase.service.ts:53`, `libs/web/members/src/lib/learning/course-player.store.ts:84` |
| C9 file-list template split (`.html` for connectors, inline for skills) | PASS | `implementation-plan.md:480` (plan-specified, not an executor choice) |
| Card consumers set `role="listitem"`, `heading` input, `<ptah-catalog-card-skeleton>` for loading | PASS | `connectors-page.component.html:229,251,445` |
| No `[innerHTML]` | PASS | confirmed by report grep (`batch-15-report.md:24`); not contradicted by inspection |
| One `<h1>` per tier, shell owns no `<h1>` | PASS | `connectors-page.component.html:40`, `connector-detail.component.html:11,291`; spec `connectors-page.component.spec.ts:257-266` |
| `ptah-featured-connectors`/`ptah-category-bento` contract (Batch 11 binding notes) | PASS | `connectors-page.component.ts:263-277,406-427`; matches `batches.md:693-697` |
| Connector cards "share one card" (plan C8, `implementation-plan.md:447`) | PARTIAL | Shared `CatalogCardComponent` shell; NOT shared status/action content — see Serious issue 1 |
| One naming convention per architectural role across sibling page folders | FAIL | `connectors-view-model.ts` vs. `installed-provider-rows.ts` / `installed-skill-rows.ts` — see Serious issue 2 |
| `catch (error: unknown)` throughout | N/A | No raw `try/catch` in this batch; errors flow through `ConnectorActionOutcome` |
| New human-maintained files stay under 700 lines | PASS (boundary) | `connectors-page.component.spec.ts` = 700, not >700; see Minor issues |

## Maintenance debt

- Introduced: two new pure/collaborator helper files (`connectors-view-model.ts`,
  `connector-actions.ts`); a third card-status implementation alongside the two Batch 11
  already created; two Batch 6 follow-ups now handled (timed-out state, "already
  connected" false-failure dismissal) that were previously open debt.
- Retired: nothing yet (`connectors-surface.component.ts` is untouched, scheduled for
  Batch 17 deletion per the report).
- Net: closes two disclosed follow-up items from Batch 6; opens one new duplication site
  (the third card-status/actions implementation) that should close before or shortly
  after this batch, and one small naming inconsistency between three sibling page
  folders.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: three independent, already-drifted implementations of the same
  connector-status/action content (grid, featured row, detail) is a real and growing
  maintenance liability that the plan's C8 "share one card" intent argues against; it
  should be collapsed to one shared partial before or immediately after this batch lands,
  not deferred indefinitely to an unscheduled future ui batch.
- What a 10/10 version would do differently: extract the shared status/action content
  into one `ui/` partial (or exported `ng-template`) consumed by
  `FeaturedConnectorsComponent`, the grid and the detail; reconcile `connectorCardState`
  and `toCardView` into a single exported function; name the pure page-helper file
  consistently with `installed-provider-rows.ts` / `installed-skill-rows.ts` (or document
  the new "view-model" vocabulary once, for those two batches to follow rather than
  precede); and give `hasStatus`/`hasStatusNotes` one name.

---

## Round 2 (Revise round 1)

Re-reviewed `D:\projects\ptah-extension\.claude-worktrees\task533-b15` after
`batch-15-report.md`'s "Revise round 1" section (both the logic fixes and the style
fixes 6-9). Read all four required-fix areas end to end plus every file the report lists
as modified; re-read `featured-connectors.component.ts`, `connectors-page.component.html`,
`connector-detail.component.html`, `connector-cards.ts` (renamed),
`connector-card-content.component.ts` (new) and its spec in full. Ran a repo-wide check
(`grep -c "@Component("` per file) across `libs/frontend/ui/src` and
`libs/frontend/marketplace/src` in the integration worktree
(`feat-task-2026-533-marketplace-redesign`) to confirm the current state of the
one-component-per-file convention before judging the new file against it.

### Round 1 required fixes — verified

1. **Triplicated card markup/state — FIXED.** `connectorCardState()` is now the single
   rule (`ui/connector-card-content.component.ts:137-185`); the featured row's private
   `toCardView` is gone (confirmed absent from `featured-connectors.component.ts`). All
   three consumers now render the same two components instead of hand-rolled markup:
   grid (`connectors-page.component.html:264-279`), detail
   (`connector-detail.component.html:44-60`), featured row
   (`featured-connectors.component.ts:230-248`). This closes the drift that was the
   round-1 finding's core evidence (timed-out/Smithery-key states are now identical on
   all three surfaces because they render from one component).
2. **Naming (`connectors-view-model.ts`) — FIXED.** Renamed to `connector-cards.ts`
   (`pages/connectors/connector-cards.ts:1`), matching the domain-noun pattern this
   review recommended and no longer using "view-model" vocabulary found nowhere else in
   the repo. The card-state code that used to live here moved out to
   `connector-card-content.component.ts`, and the file's own doc comment
   (`connector-cards.ts:1-8`) points to where it went — good cross-reference.
3. **`hasStatus`/`hasStatusNotes` naming drift — FIXED.** Both replaced by
   `card.hasStatus` / `card.hasActions` fields on the one shared `ConnectorCardState`
   (`connector-card-content.component.ts:125-128`), read identically by all three
   consumers.
4. Spec-line-count minor note: `connectors-page.component.spec.ts` is now 688 lines
   (`batch-15-report.md:89`), comfortably under the plan's ceiling; no longer at the
   boundary.

### New judgment requested: two components in one file

`ui/connector-card-content.component.ts` now holds `ConnectorCardStatusComponent`
(`:193-328`) and `ConnectorCardActionsComponent` (`:336-429`) plus the shared pure rules
(`:29-185`). Batch 10's round-1 review made "one file, one component" an explicit,
mechanically-verified rule for these two libraries (`ProviderFilterSelectComponent` was
required to move to its own file; see `code-style-review-batch-10.md`'s "Serious issues"
§1 and the verified fix in that file's "Fix 1 — split into its own file"). Re-running
that same mechanical check now (`grep -c "@Component(" $f` over every non-spec file in
`libs/frontend/ui/src` and `libs/frontend/marketplace/src` in the integration worktree)
finds exactly one file with more than one `@Component`, and it is a `.testing.ts` test
double (`pages/servers/provider-list-view.testing.ts`), not a production file. Batch 15
round 2's `connector-card-content.component.ts` would be the first production exception
since the Batch 10 fix.

This case is genuinely closer to acceptable than Batch 10's was: the two components are
not independent, generically-reusable units competing with an existing shared service —
they are the two halves of exactly one domain concept (`ConnectorCardState`), split only
because `CatalogCardComponent` exposes two named content-projection slots
(`[card-status]`/`[card-actions]`) that a connector card must fill together, every
consumer uses both, and the file's own doc comment (`:29-41`) states the pairing and the
reason up front — unlike `ProviderFilterSelectComponent`, which was undocumented and
undiscoverable until 245 lines in. But the doc comment mitigates discoverability; it does
not restore the mechanical invariant Batch 10 established ("a grep for components
expects file-count to equal component-count") — that invariant still breaks here exactly
as it did there. And the seams to split along already exist and cost nothing to use: the
spec file itself is already organized in three natural groups — `describe('connector
card state', ...)` for the pure rules
(`connector-card-content.component.spec.ts:45`), and (by the file layout) one section per
component — mirroring the pure-rules-file-plus-component-file shape this same batch just
adopted for the page level (`connector-cards.ts` next to `connectors-page.component.ts`).
Splitting costs one new file, not new design: `connector-card-state.ts` (the pure rules,
`:29-185`) next to `connector-card-status.component.ts` and
`connector-card-actions.component.ts`, each already self-contained with no injected
state or cross-file coupling beyond importing the shared type.

Given the low cost of compliance and the absence of any other exception in either
library, this is judged a real, if narrow and cheap-to-fix, deviation — not a new
sanctioned pattern. If the team wants "paired slot-content components" to become an
accepted exception to one-file-one-component, that should be a one-line decision
recorded somewhere future batches will read (e.g. `implementation-plan.md`'s C8/C13
entry, or a note the C13 `CatalogCardComponent` file itself carries), the same way this
review asked Batch 10 to either resolve or explicitly document its
`KeyboardNavigationService` trade-off — not left to one file's own doc comment to assert.

### Summary — Round 2

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 7/10                                 |
| Assessment      | NEEDS_REVISION                       |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 0                                    |
| Files reviewed  | 14 (per `batch-15-report.md`'s round-1 file table), all read in full |

### Serious issues — Round 2

#### `connector-card-content.component.ts` holds two components, the only production exception to this repository's one-file-one-component convention

- File: `libs/frontend/marketplace/src/lib/ui/connector-card-content.component.ts:193-328` (`ConnectorCardStatusComponent`) and `:336-429` (`ConnectorCardActionsComponent`)
- Problem: two `@Component`-decorated classes in one file. Verified via
  `grep -c "@Component(" <file>` across every non-spec `.ts` file in
  `libs/frontend/ui/src` and `libs/frontend/marketplace/src` (integration worktree) that
  this is currently the only production file that would hold more than one — the
  identical shape this review required Batch 10 to fix.
- Impact: a grep for "components in `ui/`" undercounts by one; a future edit to either
  component has to first discover the file holds two before reasoning about which one it
  is touching.
- Fix: split into `connector-card-status.component.ts`,
  `connector-card-actions.component.ts`, and (recommended, mirroring the
  `connector-cards.ts` pattern this batch already uses at the page level)
  `connector-card-state.ts` for `connectorCardState`, `connectorPillStatus`,
  `connectorKindText`, `connectorMeta`, `ConnectorCardState`, `ConnectorCardInput` and
  `ConnectorCardAction`. The spec can split along the same three groups it is already
  organized into.

### Verdict — Round 2

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: all four round-1 fixes are verified correct and, for the card-content
  duplication, unusually thorough — but the extraction introduced the one remaining
  structural inconsistency in the batch: two components sharing a file, against a
  convention this same task enforced without exception in Batch 10.
- What a 10/10 version would do differently: the same shared-content fix, split three
  ways (`connector-card-state.ts`, `connector-card-status.component.ts`,
  `connector-card-actions.component.ts`) instead of one two-component file.

## Round 3 — fix verified (team-leader)

Revise round 2 split `ui/connector-card-content.component.ts`. Checked on disk by the
team-leader. This was the final allowed revise round.

- One `@Component` per production file: `ui/connector-card-status.component.ts` (1),
  `ui/connector-card-actions.component.ts` (1). `ui/connector-card-state.ts` has none. It
  holds the pure rules: `ConnectorCardAction`, `connectorPillStatus`, `connectorKindText`,
  `connectorMeta`, `ConnectorCardInput`, `ConnectorCardState`, `connectorCardState`.
- No shim: no `connector-card-content.*` or `connectors-view-model.*` file exists, and no
  reference to either path remains in `libs/frontend/marketplace`.
- Imports updated: `featured-connectors.component.ts`, `connectors-page.component.ts`,
  `connector-detail.component.ts` and `connector-actions.ts` import from the three new files.
- No behaviour change: the split specs pass with the same test ids.
  `nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace` passed. Direct Jest
  passed 62/62 suites and 1270/1270 tests, twice, with no flaky failure.

Verdict: the Round 2 serious issue is resolved. Accepted for commit.
