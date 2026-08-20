---
id: TASK_2026_280
status: backlog
type: feature
title: >-
  Surface the harness where the user already is — settings controls, orphaned
  clones, and the doctor's path lists in the UI
description: >-
  TASK_2026_278 shipped the harness reconciler with a health report, a
  Marketplace badge, and a `ptah harness doctor` that lists the exact paths
  behind every count. Three surfaces did not land with it. The two settings the
  reconciler reads — `harness.manageGitignore` and `harness.preflightTimeoutMs`
  — exist only in `~/.ptah/settings.json` with no UI control, because there is
  no `harness` analogue of `SkillSynthesisSettingsSchema`. The Library still
  offers Rebase on an `orphaned` clone, whose upstream no longer exists, so the
  action can only fail. And the badge panel shows counts where the CLI shows
  paths, which is the difference between "23 missing" and a list the user can
  act on.
---

# Harness UI surfaces

Machine-owned metadata carrier. Prose lives in `./context.md`.
