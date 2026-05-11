# @ptah-extension/markdown

[Back to Main](../../../CLAUDE.md)

## Purpose

Single sanitization + rendering pipeline for all AI-generated markdown in the Ptah webview. Wraps `ngx-markdown` (which wraps `marked`) with a **permissive DOMPurify sanitizer** plus five custom `marked` extensions (callout cards, code-block headers, decorative dividers, enhanced headings, list cards). Exposes one component, one provider factory, and one extension helper.

## Boundaries

**Belongs here**: the `MarkdownBlockComponent` consumed by every layer that renders AI output, the `provideMarkdownRendering` provider factory, the DOMPurify sanitizer config, and the five `marked` extensions.

**Does NOT belong**: feature-specific renderers (those compose `MarkdownBlockComponent`), Monaco editor, syntax highlighting beyond what `ngx-markdown` already wires.

## Public API (from `src/index.ts`)

- `MarkdownBlockComponent` — the renderer
- `provideMarkdownRendering(config)` — provider factory; pick `'full'` (webview app) or `'basic'` (landing page)
- `MarkdownRenderingConfig` — config type
- `getMarkedExtensions()` — exposes the five custom extensions

## Internal Structure

- `src/lib/markdown-block.component.ts` — thin Angular wrapper around `<markdown [data]="...">`
- `src/lib/provide-markdown-rendering.ts` — provider factory, owns the DOMPurify sanitizer config
- `src/lib/marked-extensions.ts` — five custom `marked` extensions

## Key Files — Security-Critical

- `src/lib/provide-markdown-rendering.ts:29` — `createPermissiveSanitizer()`. Calls `DOMPurify.sanitize(html, { ... })` with:
  - **`FORBID_TAGS`**: `script`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `select`, `button` — blocks script injection and form-based UI tampering
  - **`FORBID_ATTR`**: every common DOM event handler (`onerror`, `onload`, `onclick`, `onmouseover`, `onfocus`, `onblur`, `onsubmit`, `onchange`, `oninput`, `onkeydown`, `onkeyup`, `onkeypress`) — blocks inline JS
  - **`ALLOW_DATA_ATTR: true`** — needed for marked extensions to tag rendered output
  - **`ALLOW_ARIA_ATTR: true`** — accessibility
  - **`ALLOWED_URI_REGEXP`**: `/^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i` — allows http(s)/mailto/tel/data URIs; the trailing `/i` (case-insensitive) flag is **load-bearing** — without it, `JAVASCRIPT:` (any casing) would slip through
- `src/lib/markdown-block.component.ts:13` — `<markdown [data]="content()" />`. `ngx-markdown` calls the configured `SANITIZE` provider before emitting HTML; DOMPurify runs on every render.
- `src/lib/marked-extensions.ts` — callouts (`> [!NOTE]` → styled cards), code-block headers, decorative dividers, enhanced headings, step lists

## State Management Pattern

None. `MarkdownBlockComponent` is a pure `input.required<string>()` → rendered output component with `OnPush` change detection. Sanitization is deterministic given the same HTML input.

## Dependencies

**Internal**: none

**External**: `@angular/core`, `ngx-markdown` (which depends on `marked`), `dompurify`

## Angular Conventions Observed

- Standalone, `ChangeDetectionStrategy.OnPush`
- `input.required<string>()` for `content`
- `provideMarkdown(...)` from `ngx-markdown` wired via `provideMarkdownRendering()` factory; `SANITIZE` injection token replaced via `{ provide: SANITIZE, useFactory: createPermissiveSanitizer }`
- `MARKED_EXTENSIONS` multi-provider for the five custom extensions

## Guidelines

1. **Never bind `[innerHTML]` directly to AI-generated text anywhere in the codebase.** Always go through `MarkdownBlockComponent`. The DOMPurify config in this lib is the single XSS chokepoint — bypassing it defeats the protection.
2. **Do not relax `FORBID_TAGS` / `FORBID_ATTR`** without a security review. The allowlist is intentionally inverted (allow everything except known-dangerous) so AI output isn't visually mangled, but every removed entry is a new XSS vector.
3. **Preserve the `/i` flag on `ALLOWED_URI_REGEXP`.** A case-sensitive regex would let `JAVASCRIPT:` URIs through.
4. **Use the `'full'` preset inside the webview app** (callout extensions + permissive sanitizer). Use `'basic'` only for the landing page where AI output is not rendered.
5. **`ALLOW_DATA_ATTR: true`** is required by the marked extensions — do not flip it off.
6. New marked extensions go in `marked-extensions.ts` and must produce HTML that DOMPurify accepts under the current config — verify with a sanitizer round-trip test.
