---
id: TASK_2026_283
status: done
type: bugfix
title: >-
  The New Project seed prompt names skills that may not be installed — fall back
  to the generic Stage A contract instead of improvising
description: >-
  `buildProcedureSteps` interpolates `profile.skills.initializer` and
  `profile.skills.architect` into the seed prompt with no existence check, so a
  profile naming an uninstalled skill tells the agent to invoke something that
  is not there and nothing warns. The `python` profile hits this today. The
  `partitionRequiredPlugins` honesty path does not cover it — that reads only
  `requiredPlugins`, and `python`'s is empty, so it returns early and reports
  nothing. Reuse the generic Stage A prose the `other` platform branch already
  carries, gated on `discoverAvailableSkills()`, so the fallback fires for any
  profile whose named skills are absent and stops firing on its own once
  TASK_2026_276 ships the Python plugin.
updated: '2026-08-25T21:15:30.900Z'
---

# Seed prompt must not name skills that are not installed

Machine-owned metadata carrier. Prose lives in `./context.md`.
