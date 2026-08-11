---
id: TASK_2026_196
status: done
type: BUGFIX
title: Absolutely positioned Monaco surfaces paint over the terminal panel and swallow its resize handle
description: editor-panel.component.ts:280 renders ptah-diff-view and ptah-code-editor as `absolute inset-0` children of a `relative` container that has no overflow-hidden and no z-index. Positioned elements with z-index auto paint above static in-flow siblings regardless of document order, and hit-testing follows paint order, so overflowing Monaco content paints over the terminal panel and steals the mousedown from the 4px terminal resize separator. Introduced by 3a73a037d (2026-08-04), which converted both surfaces from in-flow to absolute overlays and made them permanently mounted. Surfaced during TASK_2026_187 Batch 1 manual testing; Batch 1 is exonerated by direct evidence.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-09T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
