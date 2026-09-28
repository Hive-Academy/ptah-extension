# Code Style Review — Batch 7c (`TASK_2026_533`)

`ProviderMarkComponent` convergence onto `ptah-mark-svg` / `MarkArtwork` (C14 part).

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 9/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 0                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 4 (+ 4 sibling files for comparison) |

Scope: `libs/frontend/ui/src/lib/native/provider-mark/{provider-mark.component.ts, provider-mark.component.spec.ts, provider-marks.data.ts, provider-marks.data.spec.ts}` (uncommitted, worktree `agent-a0ab0da49105ebed8-fb161ae9c208`, diff against `9efeb5bea`). Compared against the committed sibling `libs/frontend/ui/src/lib/native/brand-mark/*` (Batch 7b) and specs/implementation-plan.md C14, batches.md Batch 7c, batch-7c-report.md.

## Five style questions

### 1. What breaks in six months?

Nothing structural. The resolution order (vendored → tabled stroke → tabled lucide pin → host fallback) is documented once in the class doc (`provider-mark.component.ts:55-64`) and enforced by `Object.hasOwn` lookups (`:97-99, 107-109`), matching the "tables are the allowlist" rule the sibling `brand-slugs.ts:6-9` states for its own tables. A sixth provider id added later is a one-row edit to `PROVIDER_MARKS` or `PROVIDER_BRAND_SLUGS`, not a new branch — consistent with the existing pattern.

### 2. What would a new team member misread?

`provider-mark.component.ts:8-10` and `provider-marks.data.ts:27-32` both assert "imported directly, never through the barrel" as a hard rule, but nothing in the code enforces it beyond the spec's source-text pin at `provider-mark.component.spec.ts:125-140`. A reader who does not find that test could reasonably re-export `PROVIDER_BRAND_ART` from `brand-mark/index.ts` for convenience and silently regress R7 (bundle-size gate). This is the same self-enforcement style `brand-mark/index.ts:10-12` already uses ("The vendored artwork table itself is not exported"), so it is consistent with the codebase, not a defect of this batch — flagged only because it is easy to misread as optional.

### 3. What does this cost to maintain?

Low. The diff is a converge-not-duplicate change: the inline `<svg>` template and the old `{kind:'path', viewBox, d}` shape are gone, replaced by `MarkArtwork`/`ptah-mark-svg`, so there is now exactly one SVG-building template in the lib (`mark-svg.component.ts:50-74`) instead of two. `strokeMark()` (`provider-marks.data.ts:59-65`) removes the repetition of `{viewBox:'0 0 24 24', kind:'stroke', paths:[...]}` across six table records.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere material. `ProviderStrokeMark = MarkArtwork & { readonly kind: 'stroke' }` (`provider-marks.data.ts:48`) mirrors the intersection style the plan specifies for `MarkArtwork` itself (implementation-plan.md, C14 section: `kind: 'fill' | 'stroke'`). The lucide-variant of `ProviderMark` stays an anonymous inline object type (`provider-marks.data.ts:54-56`) rather than a named interface like `BrandMarkRecord` (`brand-marks.generated.ts:121`) — but that shape is unchanged from the pre-batch file (`git show 9efeb5bea:.../provider-marks.data.ts:44-49` has the identical anonymous-object pattern), so it is not something this batch introduced or was asked to fix.

### 5. What would you have done differently?

Nothing on the reviewed files. The one thing I'd flag for the team-leader rather than the executor: the two stale-comment sites the executor already surfaced under "Out-of-scope observations" (batch-7c-report.md:158-161) sit in `brand-slugs.ts` and `brand-slugs.spec.ts`, both owned and committed by Batch 7b, not part of Task 7c.1's file list (batches.md, Task 7c.1 "Files:"). Editing them here would violate the batches.md file-disjointness rule ("Decomposition defaults" line 20-21) for a batch that has already landed. They should be fixed as a one-line follow-up scoped to whichever batch is still open against `brand-mark/`, not folded into 7c's diff.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

1. `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:71-72` — comment reads "Batch 7c wires `ProviderMarkComponent` to draw these…" in future tense; Batch 7c has now done exactly that. Stale, but the file is outside Task 7c.1's file list (owned by the already-committed Batch 7b) — do not fix inside this batch's diff; route to team-leader for a follow-up edit against `brand-mark/`.
2. `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.spec.ts:368` — comment "Presence only: the record's internal shape changes in Batch 7c" is likewise now stale (the shape change already landed); same file-ownership reasoning as #1 — not a 7c fix.

Both were independently identified and disclosed by the executor in batch-7c-report.md:158-161; this review confirms the text is still present at those lines and confirms the file-ownership reasoning for leaving them alone.

## File-by-file

### provider-mark.component.ts

Score 10/10 — 0 blocking, 0 serious, 0 minor. Standalone, `OnPush`, all-signal (`input`, `computed`); template is markup-only (`<ptah-mark-svg [art]="art()" paint="mono">`), no `[innerHTML]` anywhere; the direct `brand-marks.generated` import is commented at the import site (`:8-10`) exactly per the plan's boundary rule; resolution order matches the class doc 1:1 (`:55-64` vs `:96-101`); `Object.hasOwn` guards both lookups against prototype pollution (`:97, 107`).

### provider-marks.data.ts

Score 9/10 — 0 blocking, 0 serious, 1 minor (doc-comment cross-reference, see finding 1/2 context, but those live in a sibling file not this one). `ProviderStrokeMark = MarkArtwork & {kind:'stroke'}` is precisely typed, no widening to `string` or `any`; `strokeMark()` is a small, well-named builder placed beside the table it serves — the right home, since it is consumed both here and by `provider-mark.component.ts`'s `LUCIDE_MARKS` within the same folder (not re-exported through the barrel, matching the plan's "not added to the provider-mark/index.ts barrel" deviation note in batch-7c-report.md:154).

### provider-mark.component.spec.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor beyond the general note above. Source-text pin (`:125-140`) asserting `PROVIDER_BRAND_ART` is imported and `BRAND_MARKS` is not, and that no `innerHTML` appears, follows the same `readFileSync(__dirname, ...)` pattern already used in `brand-slugs.spec.ts` and `catalog-card-skeleton.component.spec.ts` — not a new test idiom. Assertions read DOM via `[data-kind]`/`[data-paint]`/`fill` attributes rather than parsing markup, matching the renderer's attribute-binding contract.

### provider-marks.data.spec.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor. `keysWithin` + `ALLOWED_*_KEYS` allowlists (`:11-17`) enforce the "sanitized fields only" invariant the header doc promises, and the `PATH_DATA_PATTERN` regex (`:10`) is a real runtime check, not a comment-only claim.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Direct import of `brand-marks.generated`, not through barrel (plan quality requirement) | PASS | `provider-mark.component.ts:11`; `brand-mark/index.ts:16-38` does not export `PROVIDER_BRAND_ART` |
| No `BRAND_MARKS` reachable from this component (R7 eager-bundle gate) | PASS | `provider-mark.component.ts:11` imports only `PROVIDER_BRAND_ART`; spec pin at `:135-139`; batch-7c-report.md:122-147 (build-output proof) |
| `OnPush` + standalone + signal inputs/computed | PASS | `provider-mark.component.ts:66-70, 87-102` |
| SVG built from `[attr.*]` bindings only, no markup parsing | PASS (delegated) | Binding lives in shared `mark-svg.component.ts:65-72`; `provider-mark.component.ts` only passes `art()`/`paint` |
| No `innerHTML` | PASS | Source-text assertion `provider-mark.component.spec.ts:132` |
| `MarkArtwork` `kind: 'stroke'` type precision | PASS | `ProviderStrokeMark = MarkArtwork & { readonly kind: 'stroke' }`, `provider-marks.data.ts:48` |
| Table-is-the-allowlist / no id branching | PASS | `Object.hasOwn` guards, `provider-mark.component.ts:97, 107`; doc rule `:55-64` |
| Batch file-disjointness (batches.md "Decomposition defaults") | PASS | Diff touches only the 4 files Task 7c.1 names; stale comments in `brand-mark/` (Batch 7b's files) correctly left untouched |

## Maintenance debt

- Introduced: one small `strokeMark()` builder; `MarkArtwork`-typed lucide glyphs inlined in the component (documented rationale for staying out of `type:ui`'s lucide-free bundle, `provider-mark.component.ts:21-27`).
- Retired: the component's private inline `<svg>` template and the old `{kind:'path', viewBox, d}` shape; the two now-unnecessary `anthropic`/`claude-cli` lucide pins in `provider-marks.data.ts` (superseded by `PROVIDER_BRAND_SLUGS`).
- Net: negative — one fewer SVG-building code path in the lib, one fewer artwork shape to keep in sync with `MarkArtwork`.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the two stale "Batch 7c" comments in `brand-mark/brand-slugs.ts` and `brand-slugs.spec.ts` are real but belong to a different (already-committed) batch's files and should be swept up as a small follow-up, not folded into this diff.
- What a 10/10 version would do differently: nothing in the reviewed files; at the task level, the team-leader could open a one-line follow-up task to retire the two stale "Batch 7c" comments now that the batch they anticipated has landed.
