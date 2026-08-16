---
id: TASK_2026_239
status: in_review
type: documentation
title: Publish the Crucible move and the five-move Tribunal docs
description: >-
  apps/ptah-docs/src/content/docs/tribunal/ still documents four moves. It has no
  crucible.md, no vendor-panel page, an index that says four, and it predates both
  the discovery-driven vendor selection and the panel UI that now launches every
  move. This is a writing job, not a file copy — the shipped skill reference is
  conductor-facing protocol, while the docs site is user-facing explanation.
---

# Publish the Crucible move and the five-move Tribunal docs

TASK_2026_237 deliberately split this out (its requirements §10) so the public
docs could be written **after** the panel shipped and therefore describe the real
UI rather than a plan. The panel landed in `06cf3ed68`.

Prose lives in `context.md`.
