---
id: TASK_2026_260
status: backlog
type: bugfix
title: '27 broken screenshot references ship to production on docs.ptah.live'
description: >-
  The docs site references 47 distinct `/screenshots/*.png` files across 40 pages;
  `public/screenshots/` holds 22 and `src/assets/screenshots/` is empty. 27 referenced
  images do not exist anywhere in the repo. `astro build` does not validate public-asset
  references, so the build passes and the broken `src` attributes ship — confirmed present
  in the built HTML.
---

# 27 broken screenshot references ship to production on docs.ptah.live

Found while closing TASK_2026_258. Three broken references were fixed there as part of the
Plugins work; the sweep that followed showed the problem is site-wide and mostly outside
that section — Sessions, Agents, Git, Settings, Workspace and Browser Automation are all
affected.

Analysis and the full list in `context.md`.
