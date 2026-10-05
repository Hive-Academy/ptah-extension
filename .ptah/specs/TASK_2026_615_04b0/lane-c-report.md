# Lane C report — TASK_2026_615 (owner suffix, tile self-repeat, caption wrap)

Lanes A/B files untouched. All three items Done. Verified with the scoped
`run-many` (below); no `as any`/`@ts-ignore`, no console logging, no git.

## Item 1 — Owner label suffix (`ownerKeySuffix` / `ownerDisplayLabel`) — Done

**New helper** `libs/shared/src/lib/utils/plan-limits/owner-display.ts`:
- `ownerKeySuffix(key)` (owner-display.ts:23) → last 4 chars of the fingerprint
  (segment after the last `:`) when it matches `/^[0-9a-f]{8,}$/`, else `null`.
  Pure, nothing throws; the full key is never returned.
- `ownerDisplayLabel(owner)` (owner-display.ts:36) → `` `${label} · ${suffix}` ``
  or plain `label` when there is no readable fingerprint.

**Exports**: barrel `libs/shared/src/lib/utils/plan-limits/index.ts:53-54`
(export group added before the format group) and the lib-internal re-export
`libs/shared/src/lib/utils/index.ts:76-77`, so both come out of
`@ptah-extension/shared` the way siblings (`ownerRelation`) do.

**Use sites** (every heading/caption the task named; the full key is never shown):
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:514`
  — `buildOwnerSection` label. The `<h4>` (:162), section `aria-label` (:152)
  and Refresh `aria-label` (:179) render `section.label`, so all three carry the
  suffix automatically.
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts:93`
  (tile caption "Claude account · aaaa plan limit") and `:160`
  ("… does not report plan usage" detail line).
- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts:266,268,269`
  ("Different owner · …" / both "Unknown owner · … showing … only" ownerText lines).

**Specs**:
- New `libs/shared/src/lib/utils/plan-limits/owner-display.spec.ts` — valid 16-hex
  and minimal 8-hex keys, malformed fingerprint (label-as-fingerprint, uppercase,
  short, empty), no `:`, plain label without suffix, and two owners sharing the
  generic label getting distinct suffixes.
- `provider-account-card.component.spec.ts` — `owner()` helper now builds keys
  with a 16-hex fingerprint (default `0123456789abcdef`); the exact-label
  assertions at :164, :370, :373 assert `'Claude account · cdef usage'` etc.; new
  test at :376-385 proves two same-label owners render distinct headings and the
  full key never appears.
- `stats-limit-view-model.spec.ts:38-41` — CLAUDE_A/CLAUDE_B/CODEX fixtures get
  16-hex fingerprints; the caption assertion at :771 is
  `'Claude account · aaaa plan limit'`. ANTHROPIC_KEY/PROXY keep their non-hex
  fingerprints, so the no-suffix path stays covered.
- `lane-usage-tile.component.spec.ts` — CLAUDE_A/CLAUDE_B fixtures (:15, :264) and
  subgroup keys/planTileIds carry 16-hex fingerprints; the builder-driven
  assertion at :330-332 is `'Different owner · Claude account · bbbb'`; the
  DIFFERENT_SUBGROUP fixture ownerText (:61) and its assertion (:206-208) carry
  the suffix too.
- `plan-limit-tile.component.spec.ts:27` — fixture caption
  `'Claude account · cdef plan limit'`, asserted at :97.

## Item 2 — Open plan tile repeats its own face — Done

- `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.ts`:
  new signal input `showSummary` (:120, default `true`). The template hides the
  label+chip header (:31), the meter / "Used: …" row and the source chips (:82)
  behind `@if (showSummary())`; reset facts and the note always render. The lane
  subgroup use (lane-usage-tile.component.ts:167) keeps the default and still
  shows everything.
- `plan-limit-tile.component.ts:103` — the open panel passes `[showSummary]="false"`,
  so it shows only the facts the face does not have (reset facts, note).
- **Specs**: `plan-limit-tile.component.spec.ts` — the open-panel tests (:131-165)
  now prove the panel shows the reset facts and never repeats the face
  label/value/chip/source chips and draws no meter; a new
  `plan-window-detail.component.spec.ts` proves the default still shows the
  label, chip, meter (aria-valuenow/valuetext/label), used text, source chips,
  facts and note, keeps "unknown is never 0" ("Used: unknown", no meter, no `0%`),
  and that `showSummary=false` hides the summary but keeps facts + note.

## Item 3 — Captions wrap at 280 px — Done

- `plan-limit-tile.component.ts:54-60` — face caption gets
  `[class.truncate]="!open()"` plus `[attr.title]="t.caption"` and
  `data-testid="plan-limit-caption"`. Closed tile: one line, ellipsis, full text
  in the `title`; open tile (`col-span-full`) keeps wrapping, title always present.
- `lane-usage-tile.component.ts:56-63` — same change on the lane face caption
  (`data-testid="lane-caption"` already existed).
- Shared classes `TILE_FACE` / `CHIP_BASE` in `stats-tile.styles.ts` were NOT
  changed (truncate belongs to the caption only, not every tile face/chip); both
  tile hosts already carry `block min-w-0`, so the 2-column grid constrains the
  captions correctly.
- **Specs**: `plan-limit-tile.component.spec.ts:104-122` and the extended
  lane-caption test in `lane-usage-tile.component.spec.ts:133-150` assert
  `truncate` while closed, no `truncate` once open, and the `title` text.

## Not done / deliberate scope decisions

- `lane-tiles.ts:419` (`No usage source · ${snapshot.owner.label} does not report
  plan usage` lane note) left unchanged: it is a note body, not a
  heading/caption, and the task's named sites for lane-tiles.ts are the ownerText
  lines only. Same-shaped detail line in plan-limit-tiles.ts (:160) WAS changed
  because the task named it.
- `session-stats-summary.component.spec.ts` fixture (OWNER, fp `aaa`) left
  unchanged: it asserts no label/caption text, and a non-hex fingerprint still
  exercises the no-suffix path.
- Before/after screenshots (dark/light): out of this lane's scope per the task
  text — the orchestrator owns the webview-e2e-harness visual baselines.

## Verification

`npx nx run-many -t typecheck,test,lint -p shared chat-ui dashboard --outputStyle=static --parallel=2`
from `<root>` — **exit 0**, "Successfully ran targets typecheck, test, lint for
3 projects":

- shared: Tests 2718 passed, 2718 total (includes the new owner-display suite).
- chat-ui: Tests 525 passed, 525 total (new detail suite + updated tile/lane
  suites; one initial failure — my detail spec rendered twice in one test, which
  the TestBed rejects — fixed by reusing one fixture).
- dashboard: Tests 145 passed, 145 total.
- lint: 0 errors; the warnings printed by the aggregate run come from files this
  lane did not touch — `npx eslint` over all 15 changed files prints nothing.

## Files changed (15)

| File | Kind |
|---|---|
| `libs/shared/src/lib/utils/plan-limits/owner-display.ts` | new |
| `libs/shared/src/lib/utils/plan-limits/owner-display.spec.ts` | new |
| `libs/shared/src/lib/utils/plan-limits/index.ts` | export |
| `libs/shared/src/lib/utils/index.ts` | export |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tiles.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-tiles.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-limit-tile.component.spec.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/plan-window-detail.component.spec.ts` | new |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.spec.ts` | edit |
| `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/stats-limit-view-model.spec.ts` | edit |
| `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts` | edit |
| `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts` | edit |
