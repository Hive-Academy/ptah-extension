# Code Logic Review — Batch 7b (TASK_2026_533)

Mark renderer, monogram tile, brand mark, brand slug tables (implementation-plan.md C14).

## Scope reviewed

Worktree `D:\projects\ptah-extension\.claude-worktrees\agent-a3ed9d6c2c09f2e46-8b97aa5b9a50` (branch `agent-a3ed9d6c2c09f2e46`, base `71ecac2a7`), uncommitted:

- `libs/frontend/ui/src/lib/native/brand-mark/mark-svg.component.ts` (+`.spec.ts`)
- `libs/frontend/ui/src/lib/native/brand-mark/monogram-tile.component.ts` (+`.spec.ts`)
- `libs/frontend/ui/src/lib/native/brand-mark/brand-mark.component.ts` (+`.spec.ts`)
- `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts` (+`.spec.ts`)
- `libs/frontend/ui/src/lib/native/brand-mark/index.ts`
- `libs/frontend/ui/src/lib/native/index.ts` (modified, +1 line)
- Generated inputs read for context: `brand-marks.generated.ts`, `mark-artwork.ts` (Batch 4, already committed)
- Cross-checked: `libs/shared/src/lib/utils/mcp-server-identity.ts` (Batch 7a normalizers), `libs/frontend/ui/src/lib/dependency-boundaries.spec.ts`, `libs/frontend/ui/src/lib/native/catalog-card/catalog-card.component.ts:48`, `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts`

Verification run in the worktree: `npx nx run @ptah-extension/ui:test` — 28 suites / 524 tests, all green; `npx nx run-many -t lint,typecheck -p @ptah-extension/ui` — both green. No TODO/FIXME/stub/placeholder tokens in the new files (one false-positive grep hit on the product name "todoist").

## Verdict

**APPROVED** — score **8/10**.

No blocking or serious defects found. One moderate finding is a residual risk in an explicitly architected, tested and documented resolver rule (not an implementation error against the plan). Two minor findings, one of which is the doc-comment mismatch called out for this revise.

## Findings

### 1. [Moderate] Last-`/`-segment resolution lets an attacker-chosen registry name borrow a trusted vendor's mark

- File: `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.ts:139-152` (order step 4, `slugForKey` on the last segment)
- Scenario: `resolveBrandSlug({ serverKey: 'my-malicious-listing/github' })` resolves to `'github'` and `ptah-brand-mark` renders the real GitHub logo, exactly as `resolveBrandSlug({ serverKey: 'io.github.getsentry/sentry' })` → `'sentry'` is required to (pinned by `brand-slugs.spec.ts:112-122`, and by the batch's own edge case list, `batches.md:132`). Only the FIRST normalized key is checked against the catalogue/known-server tables via exact `Map`/`Object.hasOwn` lookup (no substring or fuzzy matching — `evil-github` alone does NOT resolve to `github`, confirmed by tracing `slugForKey`), so spoofing only works through the registry-style `owner/repo` shape, by controlling the `repo` half.
- Impact: this is exactly the behaviour the architecture asked for (C14 step 4, `implementation-plan.md:597-602`) and it is necessary for the legitimate case (an MCP registry server keyed `io.github.<owner>/<real-vendor-name>`). The same mechanism means any third party who can register or advertise an MCP server whose registry id ends in a known slug (`…/github`, `…/anthropic`, `…/sentry`) gets the real vendor's logo next to their listing, which is a visual trust signal a user could reasonably read as vendor affiliation. This is not a defect in Batch 7b's implementation — the resolver does precisely what C14 specifies and what the batch's own spec table requires — but it is a real spoofing surface worth a product-level decision (e.g., only trust the last-segment fallback for a small allowlist of registry namespaces, or add a "third-party" badge at the `provider-row` layer that already knows whether a match came from step 1-3 vs step 4).
- Current handling: none beyond what the plan specifies; `resolveBrandSlug` has no way to report which step matched, so a consumer cannot distinguish a verified catalogue/URL match from a last-segment guess.
- Recommendation: flag for the architect/team-leader as a follow-up (not this batch): either return the match step/confidence from `resolveBrandSlug` so `provider-row.ts` (Batch 8) can visually distinguish a last-segment match, or restrict step 4 to a small set of trusted registry prefixes. Not blocking for 7b, since the batch correctly implements the approved contract and the risk is pre-existing in the design, not introduced by a coding error.

### 2. [Minor] `catalog-card.component.ts:48` doc example still uses `[slug]`, not the real `brandSlug` input

- File: `libs/frontend/ui/src/lib/native/catalog-card/catalog-card.component.ts:48`
- The doc comment shows `<ptah-brand-mark card-mark [slug]="server.brandSlug" [label]="server.name" />`, but `BrandMarkComponent`'s actual input (`brand-mark.component.ts:144`) is `brandSlug`, not `slug`. Copy-pasting the example as written would silently fail to bind (Angular would throw at compile time for an unknown template input on a standalone component with strict template checking, or — if the project's `strictTemplates` is looser — would just leave `brandSlug` at its `null` default and render a monogram instead of the intended mark). Cosmetic/doc-only; carried in from Batch 7d (`catalog-card` is not part of this batch's file list) but flagged here per the review brief for the next revise.
- Fix: change the example to `[brandSlug]="server.brandSlug"`.

### 3. [Minor / forward-looking] `brand-slugs.spec.ts:188` pins the pre-convergence shape of `PROVIDER_MARKS`

- File: `libs/frontend/ui/src/lib/native/brand-mark/brand-slugs.spec.ts:172-191` (`covers every CLI install target with a mark that exists`)
- The assertion `expect(PROVIDER_MARKS[mark.providerId]?.kind).toBe('path')` is correct against today's `provider-marks.data.ts` (`kind: 'path'` for `opencode`, confirmed at `provider-marks.data.ts:81-86`), but Task 7c.1 (`implementation-plan.md:612`) re-types `PROVIDER_MARKS` records to `MarkArtwork` with `kind: 'stroke'`. When Batch 7c lands, this literal `'path'` will need to become `'stroke'` or the assertion will need to test `Object.hasOwn(PROVIDER_MARKS, mark.providerId)` instead of the kind tag. Not a defect today — the test correctly describes the current file — but it is a coupling the Batch 7c executor/reviewer should catch; noting it here so it is not rediscovered from scratch.

### No injection surface found (safety question 1)

- `MarkSvgComponent` (`mark-svg.component.ts:50-74`) builds the `<svg>` purely from `[attr.viewBox]`, `[attr.fill]`, `[attr.stroke*]`, and per-path `[attr.d]`/`[attr.fill]`/`[attr.fill-rule]`/`[attr.opacity]`. No `[innerHTML]`, no `[style]`, no `[href]`/`[src]` binding anywhere in the four new files (grepped; also asserted by `mark-svg.component.spec.ts:115-122` and `brand-mark.component.spec.ts:183-192`, which read the component source text and assert the absence of `innerHTML`).
- The only runtime-variable string reaching the DOM as text is `label` (`monogram-tile.component.ts:116`), and it is only ever interpolated as text content (`{{ glyph() }}`, `monogram-tile.component.ts:111`), never bound to an attribute — Angular auto-escapes interpolation, and a text node cannot execute markup regardless.
- `art`/`onDark` artwork (`d`, `fill`, `viewBox`) come only from the build-time generated `BRAND_MARKS` table or the hand-authored `PROVIDER_MARKS` table — never from `query.serverKey`/`serverUrl`/`label`, which are the only genuinely runtime-controlled strings in this batch. There is no code path where a server-supplied string becomes SVG path or fill data.
- Grapheme handling (`monogram-tile.component.ts:69-91`): `Intl.Segmenter` is used when available (correct for RTL scripts, combining marks, ZWJ emoji sequences), with a documented `Array.from` fallback (code-point splitting, degrades gracefully — a multi-code-point emoji sequence would show only its first code point in that environment). Empty/whitespace-only labels fall back to `'?'` (tested: `monogram-tile.component.spec.ts:122-138`, rows `''`→`'?'`, `'   '`→`'?'`). Leading punctuation is skipped via `LETTER_OR_DIGIT` when a letter/digit follows (`'@scope/tool'`→`'S'`, `'io.github.user/server'`→`'I'`), and the ZWJ-emoji rows (`'👩‍💻 tools'`→`'T'`, `'👩‍💻'`→`'👩‍💻'` alone) are both exercised.

## Five logic questions

### 1. How does this fail silently?

Nothing found that turns a real failure into a false success. `resolveBrandSlug` is total and returns `null` rather than throwing or guessing (`brand-slugs.ts:139-152`, tested exhaustively at `brand-slugs.spec.ts:130-140`). `BrandMarkComponent` never throws for an unknown/`null` slug — it falls back to `MonogramTileComponent` (`brand-mark.component.ts:111-138`), which itself never throws for an empty label. The one place a "failure" could be silently misread as success is Finding 1 above: a last-segment resolver match is presented identically to a first-class catalogue/URL match, so a caller cannot tell a "trusted" resolution from a "guessed" one — but this returns a real, intentional value per the C14 contract, not a masked error.

### 2. What user action produces unexpected behaviour?

Browsing an MCP registry listing whose id ends in a well-known slug segment (e.g. `<anything>/github`, `<anything>/sentry`) shows that vendor's real logo next to an unrelated third-party listing (Finding 1). No other unexpected-behaviour path was found: theme switching, slug changes, and size changes all re-render correctly and are covered by dedicated specs (`brand-mark.component.spec.ts:99-176`).

### 3. What input data produces a wrong answer?

- A registry-style key whose last segment happens to coincide with a known brand (Finding 1) produces a "correct by design, misleading in effect" answer.
- `constructor`, `__proto__`, and `toString` as slugs or server keys are explicitly defused: `brandRecord()` uses `Object.hasOwn(BRAND_MARKS, slug)` (`brand-mark.component.ts:43-46`), `slugForKey()` uses `Object.hasOwn(KNOWN_SERVER_BRANDS, key)` (`brand-slugs.ts:117-124`), and the two lookup tables built from the catalogue (`byUrl`/`byId`) are `Map`s, which are immune to prototype-chain lookups by construction (`brand-slugs.ts:87-114`). All four are pinned by tests: `brand-mark.component.spec.ts:146-156` (`'constructor'`, `'__proto__'` as `brandSlug`) and `brand-slugs.spec.ts:137-140` (`'constructor'`, `'x/__proto__'` as `serverKey`).
- No other input shape (empty string, slashes-only, whitespace, unparsable URL, case/host variance) was found to produce an incorrect (as opposed to `null`/fallback) answer; each is table-driven in `brand-slugs.spec.ts:78-140`.

### 4. What happens when a dependency fails?

There is no runtime dependency in this batch (no RPC, no injected service — `BrandMarkComponent` explicitly takes no injection, verified by the source-text assertion `brand-mark.component.spec.ts:183-192`, `expect(source).not.toMatch(/\binject\(/)`). The one "dependency" is the generated `BRAND_MARKS` table, which is a static compiled constant — it cannot fail at runtime, only be absent-for-a-slug, which is exactly the monogram fallback path, already covered.

### 5. What is missing that the requirements never mentioned?

- No mechanism (yet) to distinguish a "verified" brand match (catalogue id/URL) from a "guessed" one (last-segment fallback) — see Finding 1; the plan did not ask for this distinction, but the risk it creates is real.
- No dedicated RTL-script test case for `monogramGlyph`/`monogramTintClass` (Arabic/Hebrew labels) — the implementation is script-agnostic (regex uses Unicode property escapes, `Intl.Segmenter` is locale-neutral), so this is a coverage gap rather than a suspected defect.

## Focus-item verification (against the review brief)

1. **Safety (SVG/monogram/injection).** No unsanitised path found — see "No injection surface found" above. Not applicable: RTL/emoji/empty label handled and mostly tested (RTL not explicitly tested but not script-dependent).
2. **Resolver order and prototype safety.** Order matches C14 exactly (`brand-slugs.ts:139-152` vs `implementation-plan.md:597-602`): URL → catalogue id → known servers → last-`/`-segment (both checks again) → `null`. Every lookup table (`BRAND_MARKS`, `KNOWN_SERVER_BRANDS`, `byUrl`/`byId` Maps) is safe against `constructor`/`__proto__`/`toString` keys. `io.github.user/server` → `null` is correct (no catalogue/known-server entry named literally `server`). The last-segment fallback CAN resolve a misleading brand for a user/attacker-chosen registry key — see Finding 1 (moderate, by design, not a coding defect).
3. **Tile rules.** Order is dark-variant-first, then `surface:'light'`, then theme tile (`brand-mark.component.ts:56-59`), matching D6 and pinned by `brand-mark.component.spec.ts:53-72`. `:host-context([data-theme-mode='dark'])` is Angular's documented mechanism for matching an ancestor attribute outside the component's own encapsulation boundary and works identically under Emulated encapsulation (the default here, Angular 22.1.7) — it compiles to a plain CSS ancestor-attribute selector, so no Angular change detection is needed for it to react when `ThemeService`/`index.html` flips the attribute on `<html>` after render; this exact "no re-render needed" case is pinned by `brand-mark.component.spec.ts:130-136`. The styles-as-module-constant workaround (`BRAND_MARK_THEME_STYLES`, `brand-mark.component.ts:67-79`) is passed to the `styles` metadata field exactly as an inline string literal would be — nothing in the Angular compiler treats a template-literal constant differently from an inline string, so the production build receives the same CSS either way; the jest-preset-angular caveat only explains why the constant form was necessary to keep it _test-visible_, not a difference in the shipped build.
4. **R7 import hygiene.** Confirmed by reading imports directly: `monogram-tile.component.ts` has zero references to `brand-marks.generated` or `BRAND_MARKS` (also self-tested at `monogram-tile.component.spec.ts:73-81`). `brand-slugs.ts` imports only from `@ptah-extension/shared` (no `brand-marks.generated` import) and builds `connectorIndex` lazily on first `resolveBrandSlug`/`connectors()` call, memoized module-level (`brand-slugs.ts:94-114`). `native/brand-mark/index.ts` exports `MarkSvgComponent`, `MonogramTileComponent`, `BrandMarkComponent`, `CLI_TARGET_BRANDS`, `KNOWN_SERVER_BRANDS`, `PROVIDER_BRAND_SLUGS`, `resolveBrandSlug`, and the `MarkArtwork`/`BrandSlugQuery`/`CliTargetBrand` types — it does NOT export `BRAND_MARKS`, `MONOGRAM_SLUGS`, or `PROVIDER_BRAND_ART`. `dependency-boundaries.spec.ts` (no `@ptah-extension/core` import, only `shared`/`ui` specifiers) passed in the full suite run.
5. **`CLI_TARGET_BRANDS` exhaustiveness.** Typed as `Record<McpInstallTarget, CliTargetBrand>` (`brand-slugs.ts:57-59`) against the 7-member union in `mcp-directory.types.ts:36-43` (`vscode`, `claude`, `cursor`, `copilot`, `codex`, `antigravity`, `opencode`) — TypeScript's `Record<>` mapped type enforces exhaustiveness at compile time, and `typecheck` passed. `opencode` correctly uses the `{ kind: 'provider-mark', providerId: 'opencode' }` branch (`brand-slugs.ts:66`) rather than a monogram, matching R1. Both branches of the discriminated union are consumed correctly in `brand-slugs.spec.ts:183-190` (`mark.kind === 'brand'` vs the `else`).
6. **Deviations.** `bg-neutral/15` (not solid `bg-neutral`) is explained in a code comment (`monogram-tile.component.ts:32-36`, solid neutral would be dark in light themes and unreadable under `text-base-content`) — a reasoned, justified deviation from the plan's literal wording, not a bug. `text-black` on the white tile (`brand-mark.component.ts:36`) is not just cosmetic: the tile is forced to `bg-white` regardless of theme, and using `text-base-content` there would be illegible in dark themes (where `base-content` skews light) for any `currentColor`-painted path — `text-black` is a correctness requirement, not an unjustified deviation. Glyph-skipping-leading-punctuation (`monogram-tile.component.ts:83-91`) directly serves the batch's own required edge cases (`'@scope/tool'`→`'S'`, `'io.github.user/server'`→`'I'`, pinned in `batches.md:131` and tested) — intentional and correct.

## Data flow

1. A page or card passes `brandSlug`/`label` to `ptah-brand-mark`, or a resolved server row calls `resolveBrandSlug({ serverKey, serverUrl })` first (Batch 8, not in scope here) — OK, pure and total.
2. `BrandMarkComponent.record` looks up `BRAND_MARKS` by own-key only — OK, prototype-safe.
3. `BrandMarkComponent.tile` applies the dark-variant → light-surface → theme order — OK, matches D6, tested.
4. Artwork (`art`/`onDark`) is handed to `MarkSvgComponent`, which turns it into attribute-bound `<svg><path>` — OK, no markup parsing, no `[innerHTML]`.
5. CSS (`:host-context([data-theme-mode='dark'])`) — not Angular change detection — decides which of the two rendered `<svg>`s is visible, reacting live to the `<html>` attribute — OK, tested including the "no re-render" case.
6. Fallback: no record → `MonogramTileComponent`, which hashes `label` (FNV-1a) to a tint and extracts the first grapheme — OK, deterministic, script-agnostic, defused against empty input.

No step was found to lose, duplicate, or serve stale data — the components are pure/computed-signal driven with no local mutable state or async boundary.

## Requirements fulfilment

| Requirement                                                                                                                                               | Status   | Gap  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| `ptah-mark-svg`: `art`/`paint` inputs, binding-only, mono/brand/fill/stroke                                                                               | COMPLETE | none |
| `ptah-monogram-tile`: FNV-1a tint, first grapheme, `text-base-content`, no `BRAND_MARKS` import                                                           | COMPLETE | none |
| `ptah-brand-mark`: no `onDark` input, no injection, tile rules, CSS dark switch, monogram fallback, `aria-hidden`                                         | COMPLETE | none |
| `brand-slugs.ts`: `KNOWN_SERVER_BRANDS`, `CLI_TARGET_BRANDS`, `PROVIDER_BRAND_SLUGS`, `resolveBrandSlug` in C14 order                                     | COMPLETE | none |
| Barrels: `native/brand-mark/index.ts`, `native/index.ts` gains `export * from './brand-mark'`                                                             | COMPLETE | none |
| R7: monogram/brand-slugs stay clear of the full artwork table; lazy connector index; barrel withholds `BRAND_MARKS`/`MONOGRAM_SLUGS`/`PROVIDER_BRAND_ART` | COMPLETE | none |
| No stubs/TODO/`[innerHTML]`                                                                                                                               | COMPLETE | none |

Implicit requirements not addressed: a way to tell a "verified" brand match from a "guessed" (last-segment) one (Finding 1) — not asked for by the plan, flagged as a follow-up.

## Edge cases

| Case                                                          | Handled                          | How                                       | Concern                                                                                                            |
| ------------------------------------------------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Missing slug → monogram                                       | YES                              | `BrandMarkComponent` `@else` branch       | none                                                                                                               |
| `io.github.user/server` → `null`                              | YES                              | last-segment check finds nothing          | none                                                                                                               |
| Missing `onDark` on dark theme → shows `art`                  | YES                              | `brand-mark.component.spec.ts:138-143`    | none                                                                                                               |
| `constructor`/`__proto__`/`toString` as slug or key           | YES                              | `Object.hasOwn` / `Map` everywhere        | none                                                                                                               |
| Empty/whitespace label                                        | YES                              | `'?'` fallback                            | none                                                                                                               |
| RTL label                                                     | Implicit (script-agnostic logic) | `Intl.Segmenter` + Unicode property regex | no dedicated test case                                                                                             |
| Emoji / ZWJ sequence label                                    | YES                              | `Intl.Segmenter`, tested                  | `Array.from` fallback (no `Intl.Segmenter`) only picks first code point of a ZWJ sequence — documented, acceptable |
| Registry key borrows a trusted vendor's mark via last segment | YES (by design)                  | resolver step 4                           | Finding 1 — spoofing surface, not a coding defect                                                                  |

## What a robust implementation would add

- A `resolveBrandSlug` variant (or a second return field) that reports which step matched, so a future consumer can visually flag a last-segment-only match differently from a catalogue/URL match.
- One RTL-script test row for `monogramGlyph`/`monogramTintClass` to make the "script-agnostic" claim explicit rather than inferred from the regex.

## Confidence

HIGH — every file in the batch's file list was read in full, the full `@ptah-extension/ui` test suite (524 tests) and lint/typecheck were run against the actual worktree, and every claim above cites the line it rests on.
