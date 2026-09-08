---
status: backlog
type: bugfix
title: Declare the two runtime imports missing from the published CLI
description: >-
  main.mjs imports @cursor/sdk and @sentry/node but apps/ptah-cli/package.json
  declares neither, so an npm install of @hive-academy/ptah-cli resolves them
  only by accident. Selecting the Cursor adapter throws MODULE_NOT_FOUND.
---

Follow-up from the 2026-09-04 api.ptah.live outage audit (TASK_2026_392).

The same defect class as the outage, in a different app: a package that is
imported at runtime but not declared where the consumer can see it. It is
invisible in this workspace and in Electron, and only breaks for a user who
installed the CLI from npm.

Evidence, the reproduction and acceptance criteria are in `context.md`.
