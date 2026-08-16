---
id: TASK_2026_257
status: done
type: bugfix
title: 'Docs site: 30 .md pages import Starlight components that never render'
description: >-
  apps/ptah-docs has ~30 plain `.md` pages carrying
  `import { Card, CardGrid } from '@astrojs/starlight/components';` and rendering
  `<CardGrid>` / `<Card>`. Plain `.md` processes neither imports nor components, so the
  import line ships as a literal paragraph and every card degrades to an unknown lowercase
  element. Confirmed in build output, not inferred. Body text and links survive; the card
  chrome and every `icon=` never render.
---

# Docs site: 30 .md pages import Starlight components that never render

Found while verifying TASK_2026_239 (five-move Tribunal docs). `tribunal/index.md` was
the page under review, but the defect is site-wide and predates that change, so 239 left
it alone rather than making one page inconsistent with the rest of the site.

Evidence: `dist/apps/ptah-docs/tribunal/index.html` contains the import statement as a
smart-quoted paragraph plus five lowercased `<card title="…" icon="…">` unknown elements.

The fix is a rename to `.mdx` per affected page — cheap per file, but it changes every
affected page's build path and wants one sweep with a build check, not a drive-by.

Prose in `context.md`.
