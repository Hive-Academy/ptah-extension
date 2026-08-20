---
id: TASK_2026_249
status: in_review
type: BUGFIX
title: >-
  `nx check ptah-docs` has never worked — it hangs on an install prompt, and
  three agents parked on it in one session
description: >-
  `apps/ptah-docs/project.json` exposes a `check` target running `astro check`,
  and `apps/ptah-docs/CLAUDE.md` documents it under Build & Run as the
  type/link validation gate. `@astrojs/check` is not in `package.json`,
  `package-lock.json`, or `node_modules` anywhere in the repo. Under CI it
  errors out; in an interactive shell astro PROMPTS to install the dependency,
  so the command hangs indefinitely with no output — a 600s run produced an
  empty log. On 2026-08-15 three separate docs agents each launched it, stopped
  to wait, and returned with no report, which read as agents misbehaving rather
  than as a broken gate. Either add the dependency or delete the target and the
  CLAUDE.md claim; a documented gate nobody can run is worse than no gate.
---

# `nx check ptah-docs` has never worked

Machine-owned metadata carrier. Prose lives in `./context.md`.
