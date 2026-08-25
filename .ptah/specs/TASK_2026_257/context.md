# Context — TASK_2026_257

## Origin

Surfaced twice during TASK_2026_239 — first disclosed by `technical-content-writer` in
that task's `docs-changes.md`, then independently confirmed against the built HTML by
`code-logic-reviewer` (`code-logic-review.md` §I1). Deliberately left unfixed there: it
is pre-existing and site-wide, and fixing it on `tribunal/index.md` alone would have made
that one page inconsistent with the ~29 others doing the same thing.

## The defect

Astro processes `import` statements and JSX-style components in `.mdx` only. A plain
`.md` file does neither. So a page like `apps/ptah-docs/src/content/docs/tribunal/index.md`
that opens with:

```md
import { Card, CardGrid } from '@astrojs/starlight/components';
```

ships that line to the reader as a paragraph of prose — smart-quoted by the markdown
typographer, which is how you can tell it went through the text path rather than the
component path — and renders `<CardGrid>` / `<Card>` as unknown lowercase HTML elements
that the browser drops into the DOM with no styling and no icon.

Confirmed in build output, not inferred:

```
dist/apps/ptah-docs/tribunal/index.html
  → literal <p>import { Card, CardGrid } from …</p>
  → <cardgrid> + five <card title="…" icon="…"> unknown elements
```

## What is and isn't lost

- **Survives**: each card's body text and its `[How it works →]` link. No information is
  missing from the page; a reader gets the content, just not the grid.
- **Lost**: the card chrome, the grid layout, and every `icon=` value. An icon name can be
  perfectly valid in `@astrojs/starlight/components-internals/Icons.ts` and still never
  render here — validity and rendering are different questions.

## Scope

The site is 140 `.md` + 2 `.mdx` files. Roughly 30 of the `.md` files carry a Starlight
component import. The fix per page is a rename to `.mdx`; the work is the sweep and the
verification, not any one rename.

**In scope**

- Enumerate every `.md` under `apps/ptah-docs/src/content/docs/` containing an
  `@astrojs/starlight/components` import.
- Rename each to `.mdx` and confirm the components render.
- `nx build ptah-docs` is the gate — there is deliberately no `check` target
  (TASK_2026_249).

**Out of scope**

- Rewriting the content of any page.
- Adding `starlight-links-validator`, which `apps/ptah-docs/CLAUDE.md` notes is a real
  addition rather than a lost target. Separate concern.

## Watch for

Renaming changes the file the Starlight `editLink.baseUrl` points at, and the sidebar in
`astro.config.mjs` addresses pages by `slug` rather than by filename — so a `.md` → `.mdx`
rename should leave every sidebar entry alone. Verify that assumption on the first page
before doing the other twenty-nine.
