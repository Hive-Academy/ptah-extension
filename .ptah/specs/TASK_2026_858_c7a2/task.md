---
id: TASK_2026_858_c7a2
status: in_progress
type: FEATURE
title: Stagger enter and leave animations for chat messages
description: >-
  Motion plan item 4. Staggered enter and class-based leave animations for transcript messages, Electron first.
depends_on: []
created: 2026-11-01T19:10:00.000Z
updated: 2026-11-01T19:10:00.000Z
---

## Description

When several messages appear together, they enter one after another with a short, capped
stagger. Removed messages leave with a short class-based animation without a layout jump.
Follows the active motion preset, glass rules, reduced motion and the Electron Motion setting.
A session switch keeps its pane-switch motion. Streaming chunks never animate again.
Prepended history and messages outside the render window do not animate.
