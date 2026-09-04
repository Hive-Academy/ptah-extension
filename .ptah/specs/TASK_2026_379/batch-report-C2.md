# Batch C2 report — setup-step rendering and docs

## Result

Completed C2.1–C2.4, including the acceptance-review correction. App-required connectors now show their provider setup steps in order, substitute the embedded form's host-provided redirect URL (or the required fallback wording), replace guidance when another app connector is clicked, clear it when any non-app connector is clicked or the form closes, show the setup effort on cards, and pass documented scopes to the surface's OAuth connection path as one space-joined value. The documentation now explains the app-registration flow and host-specific redirect URL.

## Files changed

- `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\connectors-surface.component.ts`
- `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\connectors-surface.component.html`
- `D:\projects\ptah-extension\libs\frontend\marketplace\src\lib\connectors-surface.component.spec.ts`
- `D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\marketplace\connectors.md`

## Marketplace verification

Command:

```text
npx nx run-many -t typecheck lint test -p @ptah-extension/marketplace
```

Result: PASS (exit 0). Nx reported one requested project. Typecheck passed, lint completed with 0 errors and 3 pre-existing `max-lines` warnings in `external-marketplaces.component.ts`, `oauth-surface.component.ts`, and `smithery-surface.component.ts`.

Test counts:

```text
Test Suites: 11 passed, 11 total
Tests:       233 passed, 233 total
Snapshots:   0 total
```

## Documentation build

Command:

```text
npx nx build ptah-docs
```

Result: PASS (exit 0). Screenshot validation resolved all 33 references. Build tail:

```text
14:45:30 [starlight:pagefind] Found 158 HTML files.
14:45:31 [starlight:pagefind] Finished building search index in 683ms.
14:45:31 [@astrojs/sitemap] `sitemap-index.xml` created at `..\..\dist\apps\ptah-docs`
14:45:31 [build] 157 page(s) built in 6.40s
14:45:31 [build] Complete!

NX   Successfully ran target build for project ptah-docs

Entry docs → 404 was not found.
```

The final entry warning was non-fatal; Nx and the shell both reported success.

## Forbidden-word grep

Case-insensitive raw scan:

```text
rg -ni 'copilot|codex|openai|anthropic|claude' D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\marketplace\connectors.md
50:Every chat session shows an **MCP** chip in the header, next to the [cost bar](/chat/cost-and-tokens/). It normally reads a plain connected count. When a server needs authorization or has failed, the chip turns amber and switches to `<connected>/<total>`. The chip also turns amber, with the count unchanged, when your claude.ai connectors are unavailable — see below.
58:## claude.ai connectors
60:If the popover shows a note about **claude.ai connectors**, this chat session is running on a different, third-party provider than the account those connectors belong to. Gmail, Calendar, Drive and Canva connectors live entirely with that account, so Ptah cannot configure, list, or manage them from here — the note only explains why they are absent.
RAW_EXIT=0
```

Every raw match is the explicitly allowed fixed phrase. A case-insensitive strict scan excluding that exact exception returned no matches:

```text
rg -ni --pcre2 'copilot|codex|openai|anthropic|claude(?!\.ai connectors)' D:\projects\ptah-extension\apps\ptah-docs\src\content\docs\marketplace\connectors.md
STRICT_EXIT=1
```

For `rg`, exit 1 means zero matches. Therefore the edited documentation contains none of the forbidden words outside the allowed fixed phrase.
