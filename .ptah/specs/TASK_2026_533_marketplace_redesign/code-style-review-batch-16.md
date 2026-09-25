# Code Style Review — `TASK_2026_533` Batch 16 (Skills pages)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 10 (5 implementation + 5 spec), plus `.gitignore:198-201`, `implementation-plan.md` C9, `batches.md` Batch 16 |

Scope: full read of all 10 uncommitted files in
`libs/frontend/marketplace/src/lib/pages/skills/` in worktree `task533-b16`
(base `a990942f8`), compared against the committed C9 sibling
(`pages/connectors/*` in worktree `task533-b15`), `ui/*` and `shell/*`
(worktree `task533-b15`, same committed base as `feat/task-2026-533` at
handoff), the pre-existing `skills-section.component.ts` this batch replaces,
`marketplace-inventory.store.ts`, `data/skill-ref.ts`, `implementation-plan.md`
§9 (C9), and `batches.md` Batch 16 + the Task 13.1 placement rule it points to.
`ptah_get_diagnostics` on the five `.ts` implementation files returned zero
errors attributable to this batch (the six errors it did return are in
`core/testing/mock-rpc-service.ts`, `connected-surface.component.spec.ts` and
`harness-health.store.spec.ts` — pre-existing, unrelated files).

## Five style questions

### 1. What breaks in six months?

The `installed-skill-rows.ts` module (`installed-skill-rows.ts:100-134`)
centralises the per-kind slice mapping (`SKILL_KIND_SLICE`), labels
(`SKILL_KIND_LABELS`) and group metadata (`GROUP_META`) as `Record`s over the
`MarketplaceSkillKind` union, so a fourth skill kind fails to compile in the
one file that matters. But `KIND_ICONS` (the same shape of per-kind lookup) is
declared twice, independently, in
`installed-skills-page.component.ts:59-63` and `skill-detail.component.ts:62-66`.
A fourth kind added to the union breaks both call sites at compile time (good),
but a new engineer who only touches one file to change an icon (e.g. give
`community-skill` a different glyph) will silently leave the other view
showing the old one — the page row and the open detail would use different
icons for the same item. That is exactly the drift class
`installed-skill-rows.ts`'s own doc comment (`installed-skill-rows.ts:5-8`)
says the file exists to prevent for ref/name/removal-target, but the icon map
was left outside it.

### 2. What would a new team member misread?

`SkillSourceHostComponent`'s `DestroyRef` hook
(`skill-source-host.component.ts:156-162`) calls
`inventory.notifyContentChanged()` when the component is destroyed AND its
`source()` was `'marketplaces'` at that instant. A reader has to trace two
things to see why: (a) `ExternalMarketplacesComponent` has no change output
today (documented in the class doc comment and in the batch report's Deviation
3), so the host cannot react to an install/uninstall the normal way; (b) the
component is destroyed on every route change away from this source, which is
the only reliable signal available. Both facts are stated in the doc comment
directly above (`skill-source-host.component.ts:75-80`), so this is a
one-file read, not a hunt — but it is a `DestroyRef.onDestroy` side effect
gated on component state read at destroy time, a pattern that does not appear
anywhere else in the reviewed siblings (`connector-actions.ts`,
`connectors-page.component.ts`), where content-changed notification is always
tied to an explicit output binding. Low risk, but worth a one-line pointer
comment at the Batch 21 TODO site once `ExternalMarketplacesComponent` gets
outputs, so the workaround is easy to find and delete (the report already
names this in Deviation 3).

### 3. What does this cost to maintain?

Two verbatim duplications outside the shared file:
`plural()` (`installed-skill-rows.ts:148-150` and
`skill-detail.component.ts:74-76`) and `KIND_ICONS`
(`installed-skills-page.component.ts:59-63` and
`skill-detail.component.ts:62-66`). Neither is large, but both are the exact
class of shared, per-kind fact that `installed-skill-rows.ts` was created to
own once. The cost is not size — it is that the file whose entire purpose
(per its own doc comment) is "the page and the detail share this file so a
row's ref, name and removal target are derived once" leaves two more
per-kind facts (icon, pluralisation) to drift independently. Moving both
into `installed-skill-rows.ts` costs one import line change in each
consuming file.

### 4. Where is this inconsistent with the rest of the repository?

It mostly is not, once checked against real files rather than assumption.
Three candidate inconsistencies were checked and all cleared:

- **Inline `template:` vs `templateUrl`.** All four new components use an
  inline template literal. Checked against the actual codebase (not just the
  plan's file list): only 5 of 37 `.component.ts` files in the committed
  marketplace lib at this point in the task use `templateUrl`
  (`connectors-surface.component.ts`, `marketplace-hub.component.ts` — both on
  Batch 17's DELETE list — plus `connector-detail.component.ts`,
  `connectors-page.component.ts` and `marketplace-shell.component.ts`). Inline
  templates are the dominant convention (all of `ui/*`, `harness/*`,
  `shell/marketplace-nav.component.ts`, `shell/marketplace-status-bar.component.ts`,
  and the old `skills-section.component.ts` this batch replaces). The plan's
  C9 file list (`implementation-plan.md:480`) also does not list `.html` for
  any of the four skills components, unlike the two connector pages
  (`:480` cites `.html` explicitly for those). So the skills pages match the
  majority pattern; it is `pages/connectors/*` that is the outlier within C9,
  not this batch. No finding.
- **The extra helper file (`installed-skill-rows.ts`).** Not listed in
  `implementation-plan.md:480` or `batches.md` Task 16.2/16.3's file lists,
  and flagged by the executor as Deviation 1. The direct sibling,
  `pages/connectors/connectors-view-model.ts` (325 lines, `task533-b15`), is
  the same kind of unlisted addition inside the same C9 section for the same
  reason (a page and its detail child must derive a row identically). This is
  an established, repeated pattern for this batch shape, not a one-off. No
  finding — the deviation is correctly justified and precedented.
- **The `destroyed` boolean guard after `await`**
  (`installed-skills-page.component.ts:459,462-464,522,534`;
  `skill-detail.component.ts:437,440-442,483`). Matches the identical pattern
  in every async-capable sibling checked: `connectors-surface.component.ts`,
  `connected-surface.component.ts`, `external-marketplaces.component.ts`,
  `oauth-surface.component.ts`, `smithery-surface.component.ts`,
  `data/marketplace-inventory.store.ts`, `data/connector-links.store.ts`. No
  finding.

The one confirmed inconsistency is the duplication described in Q1/Q3, which
is internal to this batch (the page and the detail disagree on where a
per-kind fact lives) rather than a mismatch with sibling code.

### 5. What would you have done differently?

Move `KIND_ICONS` and `plural()` into `installed-skill-rows.ts` (e.g. add
`icon: LucideIconData` to `InstalledSkillRow` or export a
`SKILL_KIND_ICONS` record next to `SKILL_KIND_LABELS`), and import it from
both `installed-skills-page.component.ts` and `skill-detail.component.ts`.
That is a smaller change than the file split the executor already did for ref/
name/removal, and it finishes the job that file states as its purpose. Not
blocking, because the current duplication is between two files under the same
reviewer's eyes in one batch and is easy to catch in the next touch — but it
is exactly the kind of "it compiled, but only because nobody changed the
other copy yet" cost the shared file was supposed to remove.

## Blocking issues

None.

## Serious issues

### Per-kind icon map duplicated instead of centralised in the shared row module

- File: `installed-skills-page.component.ts:59-63`,
  `skill-detail.component.ts:62-66`
- Problem: `KIND_ICONS: Readonly<Record<MarketplaceSkillKind, LucideIconData>>`
  is defined identically in both files. `installed-skill-rows.ts` exists
  specifically so cross-file per-kind facts (ref, name, removal target) are
  derived once (`installed-skill-rows.ts:5-8`); the icon map is the same
  shape of fact and was left out of it.
- Tradeoff: today the two copies match, so nothing is visibly wrong. The cost
  shows up the next time someone changes one copy (e.g. a new brand icon for
  marketplace plugins) without knowing the second exists — the row list and
  the open detail would then show different icons for the same item, which a
  reviewer has to notice visually rather than have the compiler catch.
- Recommendation: export a `SKILL_KIND_ICONS` (or fold icon selection into
  `InstalledSkillRow`) from `installed-skill-rows.ts`, and delete both local
  copies.

## Minor issues

- `plural()` is duplicated verbatim in `installed-skill-rows.ts:148-150` and
  `skill-detail.component.ts:74-76`. Same fix as above (export it once, import
  it in `skill-detail.component.ts`). Low risk — the function is a single
  ternary and unlikely to drift — but it is the same class of miss as the
  icon map.
- `SkillSourceHostComponent`'s destroy-time `notifyContentChanged()` gate on
  `source() === 'marketplaces'` (`skill-source-host.component.ts:156-162`) is
  a one-off pattern relative to the sibling surfaces' explicit-output style.
  It is well-documented and the report already marks it as a Batch 21 cleanup
  item (Deviation 3), so this is a note for whoever picks that item up, not a
  request to change it now.

## File-by-file

### `installed-skill-rows.ts`

Score 9/10 — 0 blocking, 0 serious, 1 minor (`plural()` duplication, counted
above). Pure, total, well-documented functions; `Record`s over the
`MarketplaceSkillKind`/`InstalledSkillGroupId` unions make a missing case a
compile error (`SKILL_KIND_SLICE`, `SKILL_KIND_LABELS`, `GROUP_META`,
`PLUGIN_SOURCE_LABELS`); matches the `pages/connectors/connectors-view-model.ts`
precedent for an unlisted, page-scoped helper module.

### `skills-section-header.component.ts`

Score 10/10 — no findings. Small, single-purpose, the `aria-hidden` +
`sr-only` split (`:37-40`) for the "3/9" vs "3 of 9" reading matches the
accessibility pattern used elsewhere in the lib (e.g. icon-plus-text pills).

### `skill-source-host.component.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor (the destroy-time notify gate,
above). `@switch` mounts exactly one surface per the plan's "a source host
fires only its surface's own reads" rule (`implementation-plan.md:478`); the
enabled count and badge are correctly gated to the `ptah-plugins` case only
(`:119-121`), matching the same rule.

### `installed-skills-page.component.ts`

Score 8/10 — 0 blocking, 1 serious (shared `KIND_ICONS`, above), 0 minor.
Router-state-driven `openRef` (`:431-434`, refreshed on `NavigationEnd`)
correctly avoids outlet-event timing bugs; the roving-tabindex keyboard
handling (`:547-580`) and the absolute-command router links
(`:421-429`, documented R6 fix for ids containing `/`) are both correct and
match the plan's page contract. Largest file in the batch (595 lines) but
single-responsibility (one page, one keyboard scheme, one placement rule) —
not a split candidate by itself.

### `skill-detail.component.ts`

Score 8/10 — 0 blocking, 1 serious (shared `KIND_ICONS`, above), 1 minor
(`plural()`, above). Frame-agnostic as the plan requires; the `view` state
machine (`:358-371`) correctly distinguishes `loading`/`error`/`not-found`/
`found` off slice state plus match presence, and keeps a stale-but-valid match
on screen while its slice reloads (`:353-356`, matching the class doc comment
at `:142-143`).

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Inline `template:` matches the dominant marketplace-lib convention | PASS | 32/37 component files use `template:`; only the two DELETE-listed hub files and the three shell/connector files use `templateUrl` (see Q4) |
| Unlisted page-scoped helper module (view-model split) has precedent | PASS | `pages/connectors/connectors-view-model.ts` (`task533-b15`), same C9 section, same unlisted-in-plan status |
| Async `destroyed` boolean guard after `await` | PASS | Matches `connectors-surface.component.ts`, `external-marketplaces.component.ts`, `oauth-surface.component.ts`, `smithery-surface.component.ts`, `data/marketplace-inventory.store.ts`, `data/connector-links.store.ts` |
| Absolute router-link commands so a ref containing `/` is not split (R6) | PASS | `installed-skills-page.component.ts:421-429`, pinned by spec per the report |
| Per-kind fact centralised once (`installed-skill-rows.ts` stated purpose) | FAIL | `KIND_ICONS` and `plural()` duplicated outside it (Serious + Minor above) |
| A source host fires only its surface's own reads (`implementation-plan.md:478`) | PASS | `skill-source-host.component.ts:119-121` gates the count/badge to `ptah-plugins` only |
| No `innerHTML`, `TODO`, `FIXME`, stray `console.*` | PASS | Grep over all 10 files, 0 hits |
| `Record<Union, T>` used for per-kind lookups so a new kind fails to compile | PASS | `SKILL_KIND_SLICE`, `SKILL_KIND_LABELS`, `GROUP_META`, `PLUGIN_SOURCE_LABELS`, `SKILL_SOURCE_BANDS`, `KIND_ICONS` (all four, including the duplicated ones) |

## `.gitignore` recommendation

`.gitignore:198` is a bare `skills/` rule that ignores
`libs/frontend/marketplace/src/lib/pages/skills/` wholesale (confirmed:
`git check-ignore -v` on the batch report points to this line; `git status`
in the worktree shows nothing for these 10 files even though they are new,
uncommitted, on-disk source). Two fixes were named in the task: an exception
line next to `.gitignore:199-201`, or `git add -f`.

**Recommend the exception**, not `git add -f`:

- `.gitignore:199-201` already carries two exceptions of exactly this shape
  for legitimate source-tree `skills/` directories that the same bare rule
  would otherwise swallow (`!apps/ptah-extension-vscode/assets/plugins/**/skills/`,
  `!apps/ptah-cli/src/skills/`, `!apps/ptah-cli/src/skills/**`). Adding
  `!libs/frontend/marketplace/src/lib/pages/skills/` (plus the `/**` form, to
  cover the `.html` template file Batch 21 may still add, and any future file
  in the folder) is the same fix, in the same place, for the same class of
  false-positive match — not a new pattern.
- `git add -f` only clears the ignore for files staged at that moment. Batch
  17's route file imports from this folder (per the report), and later
  batches (20-24, the skills.sh/marketplaces restyle) will keep adding files
  here; every one of them would need its own `-f` from whoever stages it,
  silently, with no CI signal if someone forgets — that is a recurring
  footgun the exception removes permanently.
- The comment already sitting above the `.claude/skills/` exceptions
  (`.gitignore:199-201` block, "must sit AFTER the broad `skills/` rule...
  because the last matching rule wins") shows the maintainers already treat
  ordered exceptions as the intended mechanism for this exact bare rule, not
  forced adds.

## Maintenance debt

- Introduced: one new page-scoped helper module (`installed-skill-rows.ts`,
  precedented by the C9 sibling); four new components under
  `pages/skills/`; two small duplicated per-kind lookups (Serious + Minor,
  above) that should be folded into the new helper module in a follow-up
  touch.
- Retired: nothing yet — `skills-section.component.ts` and its callers are
  deleted in Batch 17, not this batch. This batch is purely additive.
- Net: positive. The page/detail split, the shared ref/name/removal derivation,
  and the placement-rule reuse from Task 13.1 reduce what Batch 17's
  deletion has to replace one-for-one; the two duplicated lookups are a small,
  easily-fixed regression against the file that was created to prevent exactly
  that class of drift.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `KIND_ICONS` and `plural()` live in two places instead of the
  one file created to hold exactly this kind of per-kind fact; worth folding
  in before or shortly after Batch 17 wires the route, while the four files
  are still fresh in someone's context.
- What a 10/10 version would do differently: export `SKILL_KIND_ICONS` (or an
  `icon` field on `InstalledSkillRow`) and the `plural()` helper from
  `installed-skill-rows.ts` and delete both local copies; nothing else in the
  batch needs a structural change.

## Round 1 fixes verified (team-leader)

- `SKILL_KIND_ICONS` exported from `installed-skill-rows.ts:123`; imported by
  `installed-skills-page.component.ts:33` and `skill-detail.component.ts:34`; no local copies remain.
- `plural()` exported from `installed-skill-rows.ts:164` and imported by the detail; spec covers it and
  asserts an icon for every kind.
- `.gitignore` exception added after `:199-201` (`!libs/frontend/marketplace/src/lib/pages/skills/` and
  `/**`); `git check-ignore` no longer matches and the 10 files are tracked without `-f`.
- Gate: `lint,typecheck,test -p @ptah-extension/marketplace` green; 50 suites / 1069 tests.
