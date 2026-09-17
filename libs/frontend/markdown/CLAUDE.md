# @ptah-extension/markdown

[Back to Main](../../../CLAUDE.md)

## Purpose

Single sanitization + rendering pipeline for all AI-generated markdown in the Ptah webview. Wraps `ngx-markdown` (which wraps `marked`) with a **permissive DOMPurify sanitizer** plus six custom `marked` extensions (callout cards, code-block headers, decorative dividers, enhanced headings, list cards, file links). Exposes one component, one provider factory, one extension helper, and opt-in file-link capture (parser, handler port, document listener).

## Boundaries

**Belongs here**: the `MarkdownBlockComponent` consumed by every layer that renders AI output, the `provideMarkdownRendering` provider factory, the DOMPurify sanitizer config, the six `marked` extensions, the file-link target parser, and the file-link click listener with its handler port.

**Does NOT belong**: feature-specific renderers (those compose `MarkdownBlockComponent`), Monaco editor, syntax highlighting beyond what `ngx-markdown` already wires, and deciding where a clicked file opens (chat implements `MARKDOWN_FILE_LINK_HANDLER`; the composition root binds it).

## Public API (from `src/index.ts`)

- `MarkdownBlockComponent` — the renderer
- `provideMarkdownRendering(config)` — provider factory; pick `'full'` (webview app) or `'basic'` (landing page)
- `MarkdownRenderingConfig` — config type
- `getMarkedExtensions()` — exposes the six custom extensions
- `parseFileLinkHref(raw)` + `MarkdownFileLinkTarget` — link destination → `{ path, line?, column? }` or `null`
- `provideMarkdownFileLinks()` — environment providers that install the document click listener
- `MARKDOWN_FILE_LINK_HANDLER` + `MarkdownFileLinkHandler` — the handler port (no default provider)
- `MARKDOWN_FILE_LINKS_OPT_IN_ATTR` — `'data-ptah-file-links'`, the opt-in marker

## Internal Structure

- `src/lib/markdown-block.component.ts` — thin Angular wrapper around `<markdown [data]="...">`
- `src/lib/provide-markdown-rendering.ts` — provider factory, owns the DOMPurify sanitizer config
- `src/lib/marked-extensions.ts` — six custom `marked` extensions
- `src/lib/file-link-target.ts` — pure file-link target parser
- `src/lib/markdown-file-links.ts` — handler port, opt-in marker, and the document click listener

## Key Files — Security-Critical

- `src/lib/provide-markdown-rendering.ts:29` — `createPermissiveSanitizer()`. Calls `DOMPurify.sanitize(html, { ... })` with:
  - **`FORBID_TAGS`**: `script`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`, `select`, `button` — blocks script injection and form-based UI tampering
  - **`FORBID_ATTR`**: every common DOM event handler (`onerror`, `onload`, `onclick`, `onmouseover`, `onfocus`, `onblur`, `onsubmit`, `onchange`, `oninput`, `onkeydown`, `onkeyup`, `onkeypress`) — blocks inline JS; plus `data-ptah-file-links`, the file-link opt-in marker, which rendered content must never carry (FORBID_ATTR wins over `ALLOW_DATA_ATTR`)
  - **`ALLOW_DATA_ATTR: true`** — needed for marked extensions to tag rendered output
  - **`ALLOW_ARIA_ATTR: true`** — accessibility
  - **`ALLOWED_URI_REGEXP`**: `/^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i` — allows http(s)/mailto/tel/data URIs; the trailing `/i` (case-insensitive) flag is **load-bearing** — without it, `JAVASCRIPT:` (any casing) would slip through
- `src/lib/markdown-block.component.ts:13` — `<markdown [data]="content()" />`. `ngx-markdown` calls the configured `SANITIZE` provider before emitting HTML; DOMPurify runs on every render.
- `src/lib/marked-extensions.ts` — callouts (`> [!NOTE]` → styled cards), code-block headers, decorative dividers, enhanced headings, step lists, file links

## File links (TASK_2026_413)

1. `createFileLinkExtension()` (`marked-extensions.ts`) renders a link whose destination `parseFileLinkHref` accepts as `<a href="#" data-ptah-file-href="<original>" title="<original>" class="ptah-file-link">`. It runs **before** DOMPurify, so `ALLOWED_URI_REGEXP` and the `FORBID_*` lists are unchanged: `#` passes the allowlist and the target travels in a data attribute. Non-file links return `false` and keep marked's default renderer.
2. `provideMarkdownFileLinks()` installs one capture-phase `click` and one `auxclick` listener per `Document` (ref-counted, removed when the last installing injector is destroyed). It acts only when ALL hold: button ≤ 1; the anchor is inside a `markdown, [markdown]` host; `host.parentElement.closest('[data-ptah-file-links]')` matches; the anchor is not inside `pre`/`code` within that host; `parseFileLinkHref(data-ptah-file-href ?? href)` is non-null. Then it calls `preventDefault()` (never `stopPropagation`) and `MARKDOWN_FILE_LINK_HANDLER.handleMarkdownFileLink(target, anchor)`. A throw or rejection is logged with `[MarkdownFileLinks]`; navigation stays prevented.
3. **Opt-in marker rule**: `data-ptah-file-links` goes only on containers that render agent output, as an Angular host binding, never on a `<markdown>` element or inside rendered content. Unmarked `'full'` surfaces (task detail, settings, release notes) keep plain link behaviour. The lookup starts at the host's parent, and the permissive sanitizer strips the marker from content, so agent HTML cannot opt a surface in.
4. **The data attribute is transport, not trust.** Agent HTML can author `data-ptah-file-href` (or a raw relative `href`) at the same trust level as a markdown link. The parser returns a path hint only; the backend resolves and re-authorizes every path.
5. Accepted parser limits: a POSIX file name ending in `:<n>` reads as a line; CommonMark backslash escapes are already resolved when the href arrives (`C:\a\.hidden` → `C:\a.hidden`). Bare `path:line` text is never linkified.

## State Management Pattern

None. `MarkdownBlockComponent` is a pure `input.required<string>()` → rendered output component with `OnPush` change detection. Sanitization is deterministic given the same HTML input.

## Dependencies

**Internal**: none

**External**: `@angular/core`, `ngx-markdown` (which depends on `marked`), `dompurify`

## Angular Conventions Observed

- Standalone, `ChangeDetectionStrategy.OnPush`
- `input.required<string>()` for `content`
- `provideMarkdown(...)` from `ngx-markdown` wired via `provideMarkdownRendering()` factory; `SANITIZE` injection token replaced via `{ provide: SANITIZE, useFactory: createPermissiveSanitizer }`
- `MARKED_EXTENSIONS` multi-provider for the six custom extensions
- `provideMarkdownFileLinks()` is an `EnvironmentProviders` factory (`provideEnvironmentInitializer`) that injects `DOCUMENT`, `MARKDOWN_FILE_LINK_HANDLER` and `DestroyRef`

## Guidelines

1. **Never bind `[innerHTML]` directly to AI-generated text anywhere in the codebase.** Always go through `MarkdownBlockComponent`. The DOMPurify config in this lib is the single XSS chokepoint — bypassing it defeats the protection.
2. **Do not relax `FORBID_TAGS` / `FORBID_ATTR`** without a security review. The allowlist is intentionally inverted (allow everything except known-dangerous) so AI output isn't visually mangled, but every removed entry is a new XSS vector.
3. **Preserve the `/i` flag on `ALLOWED_URI_REGEXP`.** A case-sensitive regex would let `JAVASCRIPT:` URIs through.
4. **Use the `'full'` preset inside the webview app** (callout extensions + permissive sanitizer). Use `'basic'` only for the landing page where AI output is not rendered.
5. **`ALLOW_DATA_ATTR: true`** is required by the marked extensions — do not flip it off.
6. New marked extensions go in `marked-extensions.ts` and must produce HTML that DOMPurify accepts under the current config — verify with a sanitizer round-trip test.
7. **Opt in to file-link capture only on agent-output containers**, with `data-ptah-file-links` as an Angular host binding outside the `<markdown>` element. Never put it on the markdown host or in rendered content, and never remove it from the permissive `FORBID_ATTR`.
8. **`data-ptah-file-href` is transport, not trust.** Never treat its presence as proof that the renderer produced it. Every consumer passes the parsed path to a backend that re-authorizes it.
