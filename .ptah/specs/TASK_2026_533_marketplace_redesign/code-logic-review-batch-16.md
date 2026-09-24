# Code Logic Review — `TASK_2026_533` Batch 16 (Skills pages)

Reviewed in worktree `D:\projects\ptah-extension\.claude-worktrees\task533-b16` (base
`a990942f8`), which the executor's `batch-16-report.md` correctly flags as git-ignored by
`.gitignore:198` (`skills/`) — confirmed with `git status` showing nothing for this folder
while `find`/`ls` show the 10 files. All 10 files were read in full, not by diff.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment            | APPROVED                             |
| Blocking issues       | 0                                    |
| Serious issues        | 0                                    |
| Moderate issues       | 2                                    |
| Failure modes found   | 2                                    |

## Five logic questions

### 1. How does this fail silently?

- `installed-skills-page.component.ts:513-517` — uninstalling a marketplace-plugin row
  re-looks up the raw `ExternalPluginListing` by `row.id` in
  `this.inventory.marketplaces().data` at click time (required because `InstalledSkillRow`
  deliberately carries no raw record, per the Batch 8 binding). If the slice has reloaded
  between render and click and no longer contains that id, the function does
  `if (listing === undefined) return;` — no `setActionError`, no console log, no state
  change at all. The button was clickable, the click did nothing, and nothing tells the
  user why. Contrast with every other failure path in this batch (RPC failure, refused
  removal, listing-not-found in the detail route) which all render an inline message.
- `installed-skills-page.component.ts:528-536` (`close()`) — after a successful uninstall
  of the item open in a **docked** inspector, `close()` tries
  `this.rowLink(closing)?.focus()` to return focus to the row the user was reading. By
  the time this runs, `notifyContentChanged()` may already have reloaded the slice and
  removed that row from the DOM (the removal and the reload race with no ordering
  guarantee relative to this focus call). The optional chaining means this fails
  silently — focus falls through to `<body>` with no fallback target (e.g. the search
  input or the group heading), and nothing in the code or the spec suite notices.

### 2. What user action produces unexpected behaviour?

- Clicking "Uninstall" on a marketplace-plugin row at the exact moment its slice is
  reloading elsewhere (e.g. the user just left the Marketplaces source in another tab,
  triggering the Batch-16 `notifyContentChanged()` workaround) does nothing observable —
  see finding above.
- Uninstalling the item that is open in a **docked** inspector (wide tier) leaves a
  keyboard/screen-reader user's focus on `<body>` instead of a nearby element, breaking
  the "focus goes back to something sensible" expectation the same method establishes for
  the Esc-close path (where the row still exists).

### 3. What input data produces a wrong answer?

None found. Deliberately adversarial inputs are exercised and handled correctly:
external ids containing both `/` and `:` (`external:acme/tools/lint-kit`) round-trip
through `encodeSkillRef`/`decodeSkillRef` and through the router without being split
into extra segments (verified against Angular's actual `computeNavigation` command-array
semantics — splitting on `/` only ever happens for `cmdIdx === 0`, and `row.ref` is never
that index in `[...skillsLink, row.ref]`); blank/whitespace-only descriptions and empty
community-skill sources fall back to `null`/`'local'` (`installed-skill-rows.ts:152-155,
191`); a malformed or unknown `:skillRef` decodes to `null` and renders "Not found", not a
crash.

### 4. What happens when a dependency fails?

Handled well and matches the per-slice isolation contract: each of the three slices
renders its own loading skeleton, its own inline error with Retry
(`installed-skills-page.component.ts:195-217`, `skill-detail.component.ts:161-176`), and a
removal failure is shown as the slice's `actionError` without dropping rows
(`marketplace-inventory.store.ts:562-576`, consumed at
`installed-skill-rows.ts:224-225`). A workspace switch mid-view is handled by the intended
"Not found" fallback, not a crash (`skill-detail.component.spec.ts:401-413`, matching
TASK_2026_540 item 6c). The harness badge/catalogue not having answered yet degrades to
"No harness pass has run for this workspace yet." (`skill-detail.component.ts:257-260`)
rather than a broken summary.

### 5. What is missing that the requirements never mentioned?

- No fallback focus target when the docked-inspector close path can't find the row it
  wants to focus (see findings above). The plan's Task 13.1 placement rule specifies
  drawer-vs-docked and focus trapping for the drawer, but is silent on this specific
  interaction, and the executor's own code comment acknowledges the docked pane "never
  took focus" without covering the case where the row is also gone.
- No user-visible feedback when the marketplace-plugin re-lookup at uninstall time comes
  up empty (see above) — this is a real, if narrow, race the store's own `actionError`
  mechanism could have been reused for.

## Failure modes

### Silent no-op uninstalling a marketplace plugin under a reload race

- Trigger: click "Uninstall" on a marketplace-plugin row exactly as
  `inventory.marketplaces()` reloads (e.g. `notifyContentChanged()` fired by leaving the
  Marketplaces source elsewhere, or a concurrent removal's reload) and the row's id is no
  longer in the freshly loaded data.
- Symptom: the button briefly stays enabled/interactive, the click has no visible effect —
  no "Removing…" state, no error, no navigation.
- Evidence: `installed-skills-page.component.ts:513-517`.
- Current handling: silent early `return` inside `runUninstall`.
- Recommendation: surface something, even a generic "This item is no longer listed —
  refresh and try again," via the same `actionError` path the store already uses for
  every other removal failure, or refetch/retry before giving up.

### Lost keyboard focus after uninstalling the item open in a docked inspector

- Trigger: at the `wide` tier, open a row's detail in the docked inspector, then uninstall
  it from the row (not from the detail panel) while the list reload removes the row from
  the DOM before `close()`'s `rowLink(closing)?.focus()` runs.
- Symptom: keyboard/screen-reader focus silently drops to `<body>`; the user loses their
  place in the list with no indication why (contrast with the Esc-close path, which is
  tested and reliably restores focus because the row is still present there).
- Evidence: `installed-skills-page.component.ts:522-536`; the only test for this exact
  interaction (`installed-skills-page.component.spec.ts:475-492`) asserts only
  `router.url`, not focus, so the gap is untested as well as unhandled.
- Recommendation: fall back to a stable, always-present target (the search input, or the
  group heading) when `rowLink(closing)` is `undefined`.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: `installed-skills-page.component.ts:513-517` — silent no-op on a stale
  marketplace listing lookup (see Failure modes).
- Moderate: `installed-skills-page.component.ts:522-536` — no fallback focus target after
  uninstalling the docked panel's own item (see Failure modes).
- Minor: `skills-section-header.component.ts:37-41` — the visible `{enabled}/{total}` text
  carries `aria-hidden="true"` with a separate `sr-only` span for the spoken form; this is
  intentional (documented and tested at `skills-section-header.component.spec.ts:72-83`)
  and not a defect, but it means a sighted keyboard user who inspects the accessibility
  tree sees no accessible name on that span at all — only the sibling `sr-only` text
  carries it. Worth a note for the eventual axe/a11y pass, not a logic defect.

## Data flow

1. `InstalledSkillsPageComponent` construction calls `ensure('plugins' | 'community' |
   'marketplaces')` — OK, matches the RPC-set spec
   (`installed-skills-page.component.spec.ts:248-255`, confirms `mcpDirectory:listInstalled`
   is never called).
2. `MarketplaceInventoryStore.plugins()` derives its `data` from
   `catalog.enabledPlugins()` only once `ensure('plugins')` has resolved
   (`marketplace-inventory.store.ts:327-333, 463`) — OK, pre-existing store behaviour, the
   page's "Everything installed or enabled" copy matches it correctly.
3. `installedSkillGroups()` / `filterInstalledSkillGroups()` turn the three raw slices into
   display groups and apply the search filter without touching `total`, so "no match" and
   "nothing installed" stay distinguishable — OK, unit-tested exhaustively
   (`installed-skill-rows.spec.ts:207-236`).
4. A row's `ref` (`encodeSkillRef`) is both the `routerLink` target segment and the
   store's `removalIdOf` key (`marketplace-inventory.store.ts:141-145`) — OK, verified by
   direct code inspection, not just the report's claim.
5. Opening a row navigates to `[...skillsLink, row.ref]`; the router does not split
   `row.ref` because it is not `commands[0]` — OK, verified against Angular's own
   command-array splitting rule, and pinned by a real click + `router.url` assertion
   (`installed-skills-page.component.spec.ts:439-448`).
6. `SkillDetailComponent` decodes the same ref and resolves it against the same three
   slices via the shared `findInstalledSkill` — OK, the page and the detail can never
   disagree about a row's identity because both derive it from the same pure function.
7. Uninstall (from either the row or the detail panel) goes through
   `MarketplaceInventoryStore.removeCommunitySkill` / `removeMarketplacePlugin`, which sets
   `pendingIds`, performs the RPC, sets `actionError` on failure, and calls
   `notifyContentChanged()` on success — OK for the community-skill path (no re-lookup
   needed); GAP for the marketplace-plugin path when the re-lookup misses (see Failure
   modes).
8. Closing the detail navigates to `['.']` relative to the page route, which the
   `NavigationEnd` listener picks up to null out `openRef` — OK, tested across drawer,
   docked, and tier-flip cases.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 16.1 header `{enabled}/{total}` + harness badge | COMPLETE | — |
| 16.1 source host mounts exactly one surface | COMPLETE | — |
| 16.1 `saved`/install/uninstall → `notifyContentChanged()` (+ fresh harness refresh for plugin saves) | COMPLETE | — |
| 16.1 route `data` → `source` input | COMPLETE (input is `input.required`; actual route wiring is Batch 17's job per batches.md) | — |
| 16.2 ensures only `plugins`/`community`/`marketplaces` | COMPLETE | — |
| 16.2 three grouped lists, Manage/Uninstall/version | COMPLETE | — |
| 16.2 detail placement (Task 13.1 rule) | COMPLETE | Focus restoration after uninstalling the docked item's own row is unhandled (see Moderate) |
| 16.2 per-slice error isolation | COMPLETE | — |
| 16.2 keyboard (roving tab stop, Enter, Esc) | COMPLETE | — |
| 16.3 decodes `:skillRef`, resolves via shared lookup | COMPLETE | — |
| 16.3 four states incl. "Not found" for malformed/vanished refs | COMPLETE | — |
| 16.3 facts, broken-plugin issues, harness summary, actions | COMPLETE | — |
| External id with `/` decodes correctly (R6) | COMPLETE | — |
| Batch 10 binding: harness badge stays on `/marketplace/skills` | COMPLETE | — |

Implicit requirements not addressed: user-visible feedback when a marketplace-plugin
uninstall's re-lookup silently misses (see Failure modes); a focus fallback for the
docked-close-after-removal race.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| External id with `/` and `:` | YES | Absolute command array keeps the ref out of `commands[0]` | none |
| Search filters out the open detail's row | YES | `openRef`/`detailHeading` read from unfiltered slices, not `detailLinks` | none |
| Workspace switch removes the open ref | YES | `reloadRequested(true)` clears `data`; detail falls to "not-found" | none, matches TASK_2026_540 6c |
| Tier flip while detail is open | YES | `docked` recomputes off `layout.tier()`, ref stays open | none |
| Uninstalling the open item (community skill, from row) | YES | Store-side id match, `close()` navigates away | none |
| Uninstalling the open item (marketplace plugin, from row) | PARTIAL | Same path, but see focus-loss finding | focus target lost if row DOM is already gone |
| Marketplace-plugin uninstall re-lookup misses | NO | Silent `return` | no feedback to user |
| Removal already in progress, second click | YES | Store `refusalFor` → `in-progress`; button already disabled via `pendingIds` | none |
| Plugin disabled while its detail is open | YES | `plugins` slice data drops it, view becomes "not-found" | matches "enabled only" design |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the two moderate findings are both narrow races (a slice reload landing
  between render and click), not deterministic on any common path, and neither loses data
  or misleads the user about a *state change* — the worst outcome is "the click looked
  like it did nothing" or "keyboard focus needs a manual Tab afterward." Neither should
  block a merge; both should be filed as small follow-ups.
- What a robust implementation would add: route the marketplace-plugin re-lookup miss
  through `setActionError` (or trigger a fresh `reload('marketplaces')` before giving up)
  instead of a bare `return`; give `close()` a non-DOM-dependent fallback focus target
  (e.g. the search input ref) for when the previously-open row's link element is gone.

## Round 1 fixes verified (team-leader)

- Uninstall with the listing gone: `installed-skills-page.component.ts:526-528` writes a page-local
  `pageErrors` entry ("... is no longer installed. The list has been refreshed.") and calls
  `inventory.reload('marketplaces')`; rendered in the shared `role="alert"` at `:177` (store
  `actionError` wins). Pinned by a new spec (alert text, only a `plugins:list-marketplaces` re-read).
- Focus on close: `close()` at `:553-568` focuses the row link, else `input[type="search"]`; new spec
  asserts `document.activeElement` is the search input after the row disappears.
- Gate: `lint,typecheck,test -p @ptah-extension/marketplace` green; 50 suites / 1069 tests.
