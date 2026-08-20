---
id: TASK_2026_237
status: done
type: FEATURE
title: Wire Tribunal Relay and Crucible moves into the panel UI
description: >-
  Relay and Crucible ship as markdown-only moves in the ptah-core tribunal skill.
  The Tribunal panel wizard still hardcodes TribunalMove to council | forge | race,
  so neither move can be launched from the UI. Widen the panel to cover both
  (they are sequential and role-asymmetric, not flat fan-outs) and re-sync the
  diverged .github/skills and ptah-docs copies of the tribunal skill.
---

# Wire Tribunal Relay and Crucible moves into the panel UI

Panel wizard offers three moves; the shipped skill documents five. Relay
(plan -> architect -> implement -> review across pinned CLI lanes) and Crucible
(cheap executor vs strong judge, bounded revise loop) exist only as skill
markdown and can be reached only by typing the trigger phrase in chat.

Prose lives in `context.md`. Batch breakdown lives in `tasks.md`.
