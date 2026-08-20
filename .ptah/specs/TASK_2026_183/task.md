---
id: TASK_2026_183
status: done
type: BUGFIX
title: Opacity-modified base-content fails contrast on every theme it is used in
description: text-base-content/NN is a daisyUI theme token with an opacity modifier, so its contrast ratio depends on the active theme's base-100 - and this app ships 30-plus themes. A full audit during TASK_2026_181 Batch 7 showed NO opacity level clears 4.5:1 on all four mandated bases; even /70 fails on daisyUI dark at 4.18:1. Raising the floor is therefore not a remedy. Sweep the remaining instances in task-card, tasks-view and task-relations, replacing them with full-opacity base-content and taking hierarchy from size and weight. Also decide the separate anubis primary-content defect (4.14:1), which affects every badge-primary and btn-primary small-text site in the product.
assignee:
depends_on: [TASK_2026_181]
executor:
claim:
created: 2026-08-05T00:00:00.000Z
updated: 2026-08-05T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
