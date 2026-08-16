---
id: TASK_2026_261
status: cancelled
type: bugfix
title: 'Plugin skill updates never reach workspaces once the user layer has mirrored them'
description: >-
  `UserLayerMirrorService.mirrorSkill` returns early when the target clone directory already
  exists, so an updated `SKILL.md` in `~/.ptah/plugins/` is never re-copied into
  `~/.ptah/user/skills/`. Workspace junctions point at that clone, and the user layer wins on
  collision, so the workspace keeps serving the version captured at first mirror. The drift
  detector that would catch this — `reconcile()` — exists, sets `diverged` / `pendingSourceHash`,
  and has no caller in production code. `listClones` reads those stored flags rather than
  computing drift, so the Skills tab shows every clone as up to date.
---

# Plugin skill updates never reach workspaces once the user layer has mirrored them

Found while explaining the `~/.ptah` → workspace sync path. Not observed against a live
profile — this is a read of the code, and step 1 is to reproduce it.

The practical shape: ship a fix to a bundled skill, publish the manifest, users download it
into `~/.ptah/plugins/` — and every user who had already mirrored that skill keeps running
the old one, with nothing in the UI saying so.

Analysis in `context.md`.
