# Code Style Review — `TASK_2026_533` Batch 7b

Scope: mark renderer, monogram tile, brand mark, brand slug tables (implementation-plan.md
C14, part 1 of 2; C8 theme tokens; D6 tile/theme rules). Reviewed in the worktree
`D:\projects\ptah-extension\.claude-worktrees\agent-a3ed9d6c2c09f2e46-8b97aa5b9a50`
(branch `agent-a3ed9d6c2c09f2e46`, HEAD `71ecac2a7`).

## Summary

| Metric          | Value                          |
| --------------- | ------------------------------ |
| Overall score   | 9/10                           |
| Assessment      | APPROVED                       |
| Blocking issues | 0                              |
| Serious issues  | 0                              |
| Minor issues    | 3                              |
| Files reviewed  | 10 (9 new + 1 modified barrel) |

Files reviewed in full: `mark-svg.component.ts`/`.spec.ts`, `monogram-tile.component.ts`/`.spec.ts`,
`brand-mark.component.ts`/`.spec.ts`, `brand-slugs.ts`/`.spec.ts`, `index.ts` (new sub-barrel),
`native/index.ts` (one added line). Read for comparison: `provider-mark/provider-mark.component.ts`,
`provider-mark/provider-mark.component.spec.ts`, `provider-mark/provider-marks.data.ts`,
`catalog-card/catalog-card.component.ts`, `catalog-card/catalog-card-shell.styles.ts`,
`dependency-boundaries.spec.ts`, `eslint.config.mjs`, `CONVENTIONS.md`, `brand-marks.generated.ts`
(header + type only — this file is Batch 4 output, out of scope for 7b).

Verification run myself, scoped to the affected project only:

- `npx nx test ui --testPathPattern="brand-mark"` → 28 suites / 524 tests pass (includes the
  whole `@ptah-extension/ui` project, cached).
- `npx nx lint ui` → clean.
- `ptah_get_diagnostics` on the four new source files → 0 errors attributable to this batch
  (the 5 reported errors are pre-existing, in `provider-model-picker.component.spec.ts`, untouched
  by this batch).

## Five style questions

### 1. What breaks in six months?

Nothing structural. The one soft spot: `brand-slugs.ts:70-72` asserts as present-tense fact that
`ProviderMarkComponent` "draws these from the small `PROVIDER_BRAND_ART` subset" — that wiring
does not exist yet (Batch 7c, still PENDING per `batches.md`). If 7c is delayed, reworked, or a
reader hits this file before 7c lands, the comment describes code that isn't there. The two
tables it introduces for that purpose (`PROVIDER_BRAND_SLUGS`, `PROVIDER_BRAND_ART`) have zero
production consumers today (`grep` confirms: only this file, its spec, and the barrel touch
them) — expected staging, but the doc comment should say "will" instead of asserting it as done.

### 2. What would a new team member misread?

The same doc-comment issue: someone reading `brand-slugs.ts` cold, without `batches.md`'s
Batch 7b/7c split in front of them, would believe `ProviderMarkComponent` already renders through
the vendored subset. A second smaller trap: `monogram-tile.component.ts:38-44` uses
`bg-neutral/15` where `implementation-plan.md:224` literally specifies `bg-neutral` (no opacity)
for the fifth tint. The code comment explains why (`bg-neutral` is dark in light themes too, so
`text-base-content` on it would be unreadable) and that reasoning is correct — but nothing in
`implementation-plan.md` or the `batches.md` revision log records the fix, so a reader diffing
plan against code sees an unexplained mismatch unless they find the inline comment.

### 3. What does this cost to maintain?

Very little. The component surface is small (four files, ~570 lines total excluding specs),
each file has one clear responsibility, and the specs pin exactly the invariants the plan calls
out as load-bearing (no `onDark` input, no injection, no `innerHTML`, deterministic tint,
resolver order). The main recurring cost is documentation drift risk described in Q1/Q2 — cheap
to fix, cheap to ignore, but it compounds if 7c's authors trust the comment instead of checking
`ProviderMarkComponent` itself.

### 4. Where is this inconsistent with the rest of the repository?

`brand-mark.component.ts:140` sets `styles: BRAND_MARK_THEME_STYLES` — a bare string. Every
other `@Component` in `libs/frontend/ui/src/lib/native` that uses `styles` (11 occurrences:
`tab-group`, `card`, `catalog-card` ×3, `drawer`, `peer-session-picker`, `popover`,
`provider-model-picker`, `dropdown`) wraps the value in an array, including the one sibling that
already extracts styles into a shared module constant for the same "jest-preset-angular strips
inline styles" reason (`catalog-card.component.ts:207-208`,
`styles: [CATALOG_CARD_SHELL_STYLES, \`...\`]`). Angular 22's decorator typing accepts a bare
string (confirmed: no compiler or lint error), so this is not a functional bug, but it is a
100%-vs-0% shape divergence from every sibling that solved the exact same problem first.

### 5. What would you have done differently, and why is that better rather than merely other?

- Wrap `BRAND_MARK_THEME_STYLES` in an array (`styles: [BRAND_MARK_THEME_STYLES]`) to match the
  one shape every other component in this lib uses — cheaper for the next reader than re-deriving
  that Angular also accepts a bare string here.
- Phrase `brand-slugs.ts:70-72` as "Batch 7c will make `ProviderMarkComponent` draw these from…"
  rather than a present-tense claim, since the code it describes is not yet in this batch.
- Add one line to `implementation-plan.md`'s D6 section (or a `batches.md` revision note) marking
  the `bg-neutral` → `bg-neutral/15` fix, so the plan and the code don't silently disagree.

None of these change behaviour; they are traceability and consistency cleanups, which is why
nothing here is Serious or Blocking.

## Blocking issues

None.

## Serious issues

None. Boundary, wiring, and contract checks all passed with direct evidence (see Pattern
compliance table below); nothing found rose to "a better pattern exists and the cost of the
current one is real."

## Minor issues

1. **Doc comment states future work as present fact.**
   - File: `brand-slugs.ts:70-72`
   - `PROVIDER_BRAND_SLUGS` doc comment: "`ProviderMarkComponent` draws these from the small
     `PROVIDER_BRAND_ART` subset, never from the full table." `ProviderMarkComponent`
     (`provider-mark.component.ts`) is untouched by this batch and still resolves purely through
     `PROVIDER_MARKS` (confirmed by reading the file and its spec). The wiring is Batch 7c
     (`batches.md`, Task 7c.1, PENDING).
   - Fix: reword to future tense and name the batch, e.g. "Batch 7c makes `ProviderMarkComponent`
     draw these…".

2. **Plan/code mismatch on the monogram's fifth tint, undocumented.**
   - File: `monogram-tile.component.ts:38-44`; plan: `implementation-plan.md:224`.
   - The plan's literal token list ends `..., bg-neutral`; the code ships `bg-neutral/15` with an
     inline rationale (contrast). The fix is correct, but no revision note in
     `implementation-plan.md` or `batches.md` records the deviation, so the two documents disagree
     with no breadcrumb between them.
   - Fix: one line in the plan's D6 section or a `batches.md` revision entry.

3. **`styles` field shape diverges from every sibling.**
   - File: `brand-mark.component.ts:140`.
   - `styles: BRAND_MARK_THEME_STYLES` (bare string) vs. `styles: [CONST, ...]` used by all 11
     other `styles:`-bearing components in this lib, including the nearest precedent for the same
     "jest strips inline styles" workaround (`catalog-card.component.ts:207-208`).
   - Fix: `styles: [BRAND_MARK_THEME_STYLES]`.

## File-by-file

### mark-svg.component.ts

Score 10/10 — 0B, 0S, 0M. Single responsibility, matches the plan's `art`/`paint` input contract
exactly (`implementation-plan.md:589-591`), binding-only SVG (`[attr.d]` etc., no `[innerHTML]`,
pinned by `mark-svg.component.spec.ts:115-122`), `OnPush`/standalone/signals throughout, no
injection.

### monogram-tile.component.ts

Score 9/10 — 0B, 0S, 1M (the undocumented `bg-neutral/15` deviation above). FNV-1a hashing is
deterministic and pinned with fixed-value test cases (`monogram-tile.component.spec.ts:92-100`);
correctly carries no import of `brand-marks.generated`, verified by both a source-text pin
(`:73-81`) and by this lib's general dependency sweep passing.

### brand-mark.component.ts

Score 9/10 — 0B, 0S, 1M (bare-string `styles`). Tile-selection logic (`tileFor`, lines 56-59)
matches `implementation-plan.md:219-222` exactly in ordering. No `onDark` input, no injection, no
`innerHTML` — all three pinned at the source level (`brand-mark.component.spec.ts:183-192`), which
is the strongest form of enforcement available for an architectural decision the plan calls out
by name (`implementation-plan.md:227`, the D-1 revision rejecting an `onDark` input).

### brand-slugs.ts

Score 9/10 — 0B, 0S, 1M (the present-tense doc-comment issue above). `resolveBrandSlug`'s
five-step order matches `implementation-plan.md:597-602` verbatim and is tested step-by-step,
including the inherited-`Object`-key and `__proto__` edge cases (`brand-slugs.spec.ts:137-140`)
that a naive `object[key]` lookup would miss. Imports only `@ptah-extension/shared`, matching the
D-1 revision's stated reason for moving the resolver into `ui` (`implementation-plan.md:228`).

### index.ts (new sub-barrel)

Score 10/10 — 0B, 0S, 0M. Explicit named exports throughout (`CONVENTIONS.md` §3), 31 lines (far
under the 150-line barrel ceiling — not that the ceiling literally applies to a sub-barrel, but it
would pass regardless). Correctly withholds `BRAND_MARKS`/`BrandMarkRecord` from re-export, so the
vendored table stays reachable only through `brand-mark.component.ts`'s own deep import — matches
both the file's own header comment and the plan's bundle-isolation requirement
(`implementation-plan.md:579`, "no `BRAND_MARKS` in the initial chunk").

### native/index.ts

Score 10/10 — 0B, 0S, 0M. One line added (`export * from './brand-mark';`), placed immediately
after the Task 7d.1 (`catalog-card`) line exactly as `batches.md`'s Task 7b.3 implementation
detail specifies.

## Pattern compliance

| Repository rule or nearby convention                                                 | Status | Evidence                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type:ui` imports only `type:ui`/`type:util`                                         | PASS   | `dependency-boundaries.spec.ts` sweeps this lib's whole `src/` tree and passed (524/524 tests green); `brand-slugs.ts:16-21` imports only `@ptah-extension/shared`                                       |
| No `@ptah-extension/core` import                                                     | PASS   | Same sweep; also confirmed by reading all 4 new source files                                                                                                                                             |
| Component selector `ptah-*`, kebab-case                                              | PASS   | `mark-svg.component.ts:46`, `monogram-tile.component.ts:106`, `brand-mark.component.ts:105` all match `eslint.config.mjs:34-41`                                                                          |
| OnPush + standalone + signal inputs, no injection                                    | PASS   | All three components use `ChangeDetectionStrategy.OnPush`, `standalone: true`, `input()`/`input.required()`; no `inject(` anywhere in the batch                                                          |
| Theme tokens only, documented exception for the white tile                           | PASS   | `TILE_BACKDROP_CLASS` (`brand-mark.component.ts:34-37`) uses `bg-base-200`/`bg-white`/`text-black`/`text-base-content`; the white/black pair is the D6-documented exception, not an undocumented one     |
| CONVENTIONS.md §3 barrel rules (explicit named exports, no over-re-export)           | PASS   | `brand-mark/index.ts` uses named exports only; withholds `BRAND_MARKS`                                                                                                                                   |
| Naming matches plan-specified file/selector names                                    | PASS   | `mark-svg.component.ts`/`ptah-mark-svg`, `monogram-tile.component.ts`/`ptah-monogram-tile`, `brand-mark.component.ts`/`ptah-brand-mark`, `brand-slugs.ts` all match `implementation-plan.md:585-603`     |
| `styles` field shape matches sibling convention                                      | FAIL   | `brand-mark.component.ts:140` — see Minor issue 3                                                                                                                                                        |
| Doc comments describe only already-true behaviour                                    | FAIL   | `brand-slugs.ts:70-72` — see Minor issue 1                                                                                                                                                               |
| Plan and code agree on token literals                                                | FAIL   | `monogram-tile.component.ts:38-44` vs `implementation-plan.md:224` — see Minor issue 2                                                                                                                   |
| Renderer shaped so 7c can converge `ProviderMarkComponent` without a second renderer | PASS   | `MarkSvgComponent` already supports `paint:'mono'` and `kind:'stroke'` — exactly what `PROVIDER_MARKS`' hand-authored stroke glyphs need once re-typed to `MarkArtwork` per `implementation-plan.md:612` |

## Maintenance debt

- Introduced: one renderer (`ptah-mark-svg`), one lettered-fallback tile (`ptah-monogram-tile`),
  one composed brand tile (`ptah-brand-mark`), one slug-resolution module (`brand-slugs.ts`) — all
  new, all single-purpose, all covered by specs that pin the plan's stated invariants rather than
  just happy-path rendering.
- Retired: nothing yet — `ProviderMarkComponent`'s parallel inline-`<svg>` renderer and its two
  lucide pins for `anthropic`/`claude-cli` are still in place. That is expected: Batch 7c is the
  batch that retires them (`batches.md`, Batch 7c, PENDING). Until 7c lands, the repository
  carries two SVG-rendering code paths for provider/vendor marks side by side; Batch 7b did not
  create that duplication, it is a deliberate two-batch split, and this batch's own boundary and
  bundle work (the `PROVIDER_BRAND_ART` subset, the isolated `brand-mark/index.ts` barrel) is
  exactly the shape 7c needs to retire the duplication cleanly.
- Net: positive — the batch adds no duplication of its own and leaves the follow-up batch a
  narrow, well-typed seam to converge through.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the three Minor findings are documentation/consistency cleanups
  (a present-tense doc comment ahead of its own wiring, an undocumented plan/code token mismatch,
  and one bare-string `styles` field) with no functional cost — safe to fix inline in Batch 7c or
  as a follow-up, not a reason to hold this batch.
- What a 10/10 version would do differently: phrase the `PROVIDER_BRAND_SLUGS` doc comment in
  future tense until 7c lands; record the `bg-neutral` → `bg-neutral/15` fix in the plan or
  `batches.md`; wrap `BRAND_MARK_THEME_STYLES` in an array to match every sibling's `styles:[...]`
  shape.
