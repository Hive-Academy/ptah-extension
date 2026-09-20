---
status: in_review
type: bugfix
title: Cap Jest workers so a test run does not starve the running app
description: >-
  The root Jest preset sets no maxWorkers, so Jest defaults to cores minus one.
  One nx run-many took 15 workers and 11 GB on a 16-core host, starving the
  Electron app the developer was working in.
---

# Cap Jest workers

Set `maxWorkers: '50%'` in the root Jest preset. The two `apps/ptah-cli`
configs that pin `maxWorkers: 1` set it explicitly and are unaffected.

See `context.md` for the measurement.
