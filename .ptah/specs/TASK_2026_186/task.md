---
id: TASK_2026_186
status: done
type: REFACTORING
title: Per-theme base-content-muted token to restore the emphasis ladder TASK_2026_183 removed
description: TASK_2026_183 removed text-base-content/40, /50, /60 and /80 from the Tasks UI because no single alpha floor passes WCAG AA across every shipped theme - on daisyUI dark, base-content is only 7.03:1 at full opacity, so even /60 falls to 3.45:1. The contrast fix was correct but collapsed four emphasis tiers to one, and secondary metadata now renders at the same weight as primary text. This task reintroduces hierarchy the only way that survives a theme swap - a base-content-muted token defined per theme with its own tested value, rather than an alpha modifier on base-content.
assignee:
depends_on: [TASK_2026_183]
executor:
claim:
created: 2026-08-08T00:00:00.000Z
updated: 2026-08-08T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
