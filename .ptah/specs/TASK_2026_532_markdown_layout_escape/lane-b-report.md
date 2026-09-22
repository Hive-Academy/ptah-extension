# TASK_2026_532 — Lane B report: harden the 'full' markdown sanitizer

## Change summary

The `'full'` preset now sanitizes through a **private DOMPurify instance**
carrying an `uponSanitizeAttribute` hook that strips layout-escape utilities
from `class` and drops `style` attributes that declare positioning. The
global DOMPurify instance and the member preset are untouched.

## Changes with file:line

All work is in `libs/frontend/markdown/src/lib/`.

### `provide-markdown-rendering.ts`

- `POSITION_UTILITY_REGEXP` (~line 40) — one pattern for the denied Tailwind
  utilities: `fixed` / `absolute` / `sticky` exact, plus the prefix families
  `inset-`, `inset-x-`, `inset-y-`, `top-`, `right-`, `bottom-`, `left-`,
  `start-`, `end-`, `z-`, each tolerating a leading negative (`-top-4`) and
  matching arbitrary values (`z-[999]`, `top-[0px]`) because they are prefix
  matches.
- `POSITION_STYLE_PROPERTIES` (~line 56) — `position`, `inset`, `top`,
  `right`, `bottom`, `left`, `z-index`.
- `isPositionUtility()` (~line 70) — drops every `:`-separated variant prefix
  (`md:`, `hover:`, `[&>*]:`) before testing, so `md:fixed` and `hover:z-50`
  are judged as `fixed` and `z-50`.
- `declaresPositioningStyle()` (~line 79) — splits the `style` value on `;`,
  reads the property name before the first `:`, trims and lowercases it.
  Case-insensitive, whitespace-tolerant. The whole attribute is dropped, not
  one declaration, because the hook API is per-attribute and half-rewritten
  CSS is a parser trap this pipeline should not own.
- `enforceLayoutContainment` hook (~line 96) — for `class`, filters tokens
  and writes the remainder back via `hookEvent.attrValue`; sets
  `hookEvent.keepAttr = false` when nothing remains (verified against the
  installed dompurify dist: `_sanitizeAttributes` reads `hookEvent.attrValue`
  after `uponSanitizeAttribute` and removes the attribute on
  `!hookEvent.keepAttr`). For `style`, drops the attribute when it declares a
  positioning property.
- `fullPurifier` / `getFullPurifier()` (~line 137) — lazy private instance,
  same factory pattern as `getMemberPurifier()` (~line 344 after the edit).
  The hook is registered on this instance only, so it cannot leak onto the
  global instance or the member preset.
- `createPermissiveSanitizer()` (~line 165) — now calls
  `getFullPurifier().sanitize(...)` with the options unchanged; only the
  instance changed.
- Docblock of `createPermissiveSanitizer` (~line 158) — updated: `class` and
  `style` are now "a safe subset" with the new rule described and
  TASK_2026_532 referenced.

### `provide-markdown-rendering.spec.ts`

New `describe("the 'full' preset strips layout-escape utilities")` block at
the end of the file (~line 375 onward), running through the **shipped
factory** (`presetConfig('full').sanitize.useFactory()`), not a re-statement
of options:

- `<div class="fixed inset-0 z-50 flex">x</div>` — `flex` kept, `fixed` /
  `inset-0` / `z-50` stripped.
- class attribute dropped entirely when only positioning utilities remain.
- `it.each` over 16 utilities: `md:fixed`, `hover:z-50`, `dark:sticky`,
  `z-[999]`, `top-[0px]`, `-top-4`, `-inset-4`, `inset-x-0`, `inset-y-0`,
  `start-0`, `end-0`, `left-4`, `right-4`, `bottom-4`, `absolute`, `sticky`
  — each stripped while a neighbouring `p-2` survives.
- `class="text-sm font-bold"` kept byte-for-byte.
- extension-emitted classes (`callout callout-note`, `prose-list-card`,
  `language-ts`, `ptah-file-link`) kept.
- `style="position:fixed;top:0"` dropped.
- `style="POSITION : fixed ; Z-INDEX : 50"` (mixed casing, padded) dropped.
- `style="color:red"` kept.
- global DOMPurify (`DOMPurify.sanitize`) still keeps `fixed` / `z-50`
  — hook not leaked to the default instance.
- member preset keeps `class="fixed z-50"` — hook not leaked to the member
  instance.

## Extension class audit

Every class the marked extensions in `marked-extensions.ts` emit:

- Callouts (line 90): `callout`, `callout-${type}` (`note`/`tip`/`warning`/
  `important`/`caution`), `callout-header`, `callout-dot`, `callout-title`,
  `callout-body`
- Code block header (lines 193–218): `code-lang-badge`, `code-line-count`,
  `code-block-header`, `code-block-container`, `code-block-collapsible`,
  `code-block-toggle`, `language-*` (the fence language, line 201)
- Dividers (line 238): `prose-divider`, `prose-divider-ornament`
- Headings (lines 269–273): `prose-heading-accented`, `prose-heading-dot`,
  `prose-heading-bordered`
- List cards (lines 309–312): `prose-list-card` (the `start` on `<ol>` is an
  attribute, not a class)
- File links (line 347): `ptah-file-link`

**None matches the deny pattern.** No token is `fixed`/`absolute`/`sticky`,
and none begins with `inset-`, `top-`, `right-`, `bottom-`, `left-`,
`start-`, `end-` or `z-`. No exemptions were needed. `marked`'s own output
(`language-*` classes, `align-*` attributes) is likewise unaffected.

## Consumer audit

`<ptah-markdown-block>` consumers in `libs/frontend` (chat update-dialog,
output-style-editor, enhanced-prompts-config, chat-ui code-output /
subagent transcript / compaction marker, skill-synthesis-ui, tasks-ui,
git-ui file-view and git-dock, tribunal-panel, markdown-file-links spec):

- The `prose prose-sm prose-invert max-w-none` classes in
  `markdown-block.component.ts:46-49` are set through Angular's `[class]`
  **template binding** on the `<markdown>` host, outside the sanitizer —
  unaffected.
- The update-dialog's own `modal modal-open` overlay classes live in its
  template (`update-dialog.component.ts:48`), not in markdown content —
  unaffected. Its release-notes body now cannot overlay the app either,
  which is the containment this task wants.
- File links: the extension emits `class="ptah-file-link"` before DOMPurify
  runs; it survives (asserted in the new spec and in the pre-existing
  `file links through the shipped 'full' pipeline` suite).
- No consumer passes markdown content that relies on `fixed` / `inset-*` /
  `z-*` utilities or positioning `style` inside the sanitized body.

## Verification

Command:

```
npx nx run-many -t test,lint,typecheck -p @ptah-extension/markdown --skip-nx-cache
```

Observed: **all three targets green** (typecheck √, test √, lint √), run
duration 8.2s. Test totals: **177 passed / 177 total, 5 suites** for the
project; the edited spec alone runs **58 passed / 58 total** — 32
pre-existing + 26 new containment tests.

## Not done

Nothing. No clarifications needed.

## Revise round 1

Two defects fixed, both in `provide-markdown-rendering.ts` with spec cases in
`provide-markdown-rendering.spec.ts`.

### Defect 1 — `<style>` elements survived the 'full' preset

- `createPermissiveSanitizer` FORBID_TAGS (~line 186): added `'style'`
  immediately after `'script'`, with a comment explaining why — the
  declarations are element content, not an attribute, so the containment hook
  could never reach them, and DOMPurify's default allowlist keeps the tag
  (verified in the installed `dist/purify.cjs.js`: `style` is in the default
  `html` tag list). `link`, `meta` and `base` were **checked, not assumed**:
  none of the three is in DOMPurify's default allowlist, so they are already
  dropped and are deliberately not named. `style` is also in DOMPurify's
  default `FORBID_CONTENTS` (verified, `dist/purify.cjs.js` line 730), so the
  CSS text is dropped with the tag rather than hoisted.
- Extension audit re-run: `grep '<style|<link|<meta|<base' marked-extensions.ts`
  — no marked extension emits any of these elements. No exemption needed.
- Spec (~line 460): `'removes a <style> element and its declarations, keeping
  surrounding markup'` — `<p>before</p><style>body{display:none}</style>
  <p>after</p>` loses the tag and the `display:none` text, keeps both
  `<p>` elements.

### Defect 2 — Tailwind important modifier bypassed the class filter

- `isPositionUtility` (~line 70): after dropping variant prefixes, a single
  leading `!` (Tailwind's important modifier) is stripped before the regex
  test: `.replace(/^!/, '')`. `!fixed`, `md:!z-50`, `!-top-4`, `!z-[999]` now
  reduce to `fixed`, `z-50`, `-top-4`, `z-[999]` and match
  `POSITION_UTILITY_REGEXP` (the `-?` in the pattern already tolerated the
  negative after the `!`). Docblock updated to name the modifier.
- Spec: four entries added to the existing `it.each` — `!fixed`, `md:!z-50`,
  `!-top-4`, `!z-[999]` (each stripped while the neighbouring `p-2` survives).

### Verification

```
npx nx run-many -t test,lint,typecheck -p @ptah-extension/markdown --skip-nx-cache
```

Exit code 0 — typecheck √, test √, lint √, run duration 6.7s. Project totals:
**182 passed / 182 total, 5 suites** (was 177; +5 = 1 new `<style>` test + 4
new important-modifier `it.each` cases). Nothing outstanding.

## Revise round 2 (FINAL)

The cross-vendor review (review-lane-b.md) confirmed in a real Chromium harness
that a token deny-list cannot guarantee containment. The design changed from
"deny bad tokens" to two independent layers. All six review defects are closed.

### Layer 1 — host containment (apps/ptah-extension-webview/src/styles.css)

New rule after the "MARKDOWN CONTENT STYLING" section header (~line 688),
before `.prose {`:

```css
markdown {
  display: block;
  contain: layout paint;
  isolation: isolate;
}
```

- `contain: layout` makes the host the containing block for every fixed or
  absolute descendant. `contain: paint` clips descendants to the host padding
  box. `isolation: isolate` caps the stacking context. This holds no matter how
  the CSS was spelled, so it closes what the sanitizer's text-level policy
  cannot.
- `display: block` is required: `containment` does not apply to inline boxes and
  `markdown` is otherwise an unknown (inline) element.

**`<markdown` usage audit (10 template usages, all checked):**
`markdown-block.component.ts:26`; chat-ui `tool-input-display:75`,
`diff-display:53`, `code-output:43`, `thinking-block:75`,
`agent-summary:75/102`; chat `message-bubble.component.html:111/250/256`,
`execution-node.component.ts:140`; setup-wizard `analysis-results:156`.
Every usage sits inside a block container (`<div>`, some with
`overflow-y-auto overflow-x-auto` wrappers). No usage relies on the element
being inline or on content overflowing the host. Wide content is not clipped
away: `.prose pre { overflow-x: auto; }` (~line 805) and
`.prose table { width: 100%; overflow: hidden; }` make wide blocks scroll inside
their own boxes, below the clip. No usage needs a narrower selector.

### Layer 2 — class allowlist (provide-markdown-rendering.ts)

- `ALLOWED_CLASS_EXACT` (~line 42) — `callout`, `code-lang-badge`,
  `code-line-count`, `prose-divider`, `prose-list-card`, `ptah-file-link`.
- `ALLOWED_CLASS_PREFIXES` (~line 56) — `callout-`, `code-block-`,
  `prose-divider-`, `prose-heading-`, `language-`.
- `isAllowedClassToken()` (~line 64) — exact set or prefix match.
- **Deleted**: `POSITION_UTILITY_REGEXP`, `isPositionUtility`, all variant
  (`:`) and important-modifier (`!`) parsing (closes review defect 6 —
  `fixed-width` is now dropped as a non-allowed token, not matched as a
  prefix). A token the pipeline did not emit is dropped, whatever it spells.
- `enforceClassStylePolicy` (~line 130, renamed from `enforceLayoutContainment`)
  — `class`: keep allowed tokens, drop the attribute when none survive.
  `style`: drop when obfuscated or positioning (unchanged mechanism).
- `isObfuscatedStyle()` (~line 97) — rejects the whole attribute when the value
  contains `/*` or a backslash (closes review defect 1: `/**/position:fixed`,
  `position/**/:fixed`, `\70 osition:fixed` all compute to `position: fixed` in
  Chromium but none reaches the property-name check as a clean declaration).
- `declaresPositioningStyle()` (~line 108) — property deny check kept.
  `transform` / `translate` / `margin*` deliberately NOT added (review defect 4
  is closed by layer 1 clipping, not by a longer deny list).
- FORBID_TAGS (~line 203) — added `dialog` (UA out-of-flow geometry, review
  defect 3). `style` stays from round 1.
- FORBID_ATTR (~line 226) — added `popover`, `popovertarget`,
  `popovertargetaction`, `command`, `commandfor` (browser-stylesheet
  positioning with no `position` declaration, review defect 3).
- Top docblock and `createPermissiveSanitizer` docblocks updated to state the
  allowlist policy and the two-layer design.

### Spec rework (provide-markdown-rendering.spec.ts)

- The copied-config suite (~line 193) now routes through the real shipped
  factory: `presetConfig('full').sanitize.useFactory()` (review defect 5).
- New describe `"the 'full' preset class and style policy (TASK_2026_532)"`:
  - `<div class="fixed inset-0 z-50 flex">` → `<div>` (class dropped entirely).
  - `class="text-sm font-bold"` → `<p>` (utilities no longer kept).
  - `class="callout callout-note fixed modal"` keeps only
    `callout callout-note`.
  - `modal modal-open` and `modal-open` alone: dropped entirely (review
    defect 2 — daisyUI overlay and `:root:has()` scrollbar rule unreachable).
  - `it.each` over 13 tokens: `fixed`, `inset-0`, `z-50`, `md:fixed`,
    `hover:z-50`, `dark:sticky`, `z-[999]`, `top-[0px]`, `-top-4`, `!fixed`,
    `md:!z-50`, `!-top-4`, `fixed-width` — each dropped, neighbouring `callout`
    survives.
  - Three obfuscated style spellings, each run on `div` AND `svg`: style
    dropped, other attributes kept.
  - `<div popover style="display:block">` — `popover` stripped,
    `display:block` kept.
  - `<dialog open>` removed, `<p>` siblings kept.
  - Global DOMPurify and member preset non-leak tests kept.
- New final describe `"the 'full' preset keeps every extension's rendered
  output"`: 6 tests invoke each real marked renderer (callout, code-block
  header, divider, heading, list-card, file link) and sanitize its output
  through the factory; every emitted class survives.

### Verification

```
npx nx run-many -t test,lint,typecheck -p @ptah-extension/markdown --skip-nx-cache
npx nx run-many -t lint -p ptah-extension-webview --skip-nx-cache
```

Both exit 0. Markdown: typecheck √, test √, lint √ (5.2s). Project test totals:
**191 passed / 191 total, 5 suites** (was 182; the spec grew by the
real-factory describe, the class/style policy describe and the
extension-output describe). Webview lint: √ (2.4s).

### Layer 1 cannot be Jest-tested

jsdom has no layout engine, so `contain: layout paint` and stacking-context
containment cannot be asserted in Jest. Layer 1 needs browser verification;
the reviewer's Chromium harness is the instrument for that.

### Not done

Nothing outstanding. No git commands were run. Files written this round:
`provide-markdown-rendering.ts`, `provide-markdown-rendering.spec.ts`,
`apps/ptah-extension-webview/src/styles.css`, this report.