---
id: TASK_2026_326
status: done
type: BUGFIX
title: >-
  Dispose CLI agents and proxy leases on every host shutdown path and close the
  lease and kill gaps in the agent manager
depends_on: []
created: '2026-08-26T02:25:20.170Z'
updated: '2026-08-27T19:30:36.135Z'
description: >-
  ptah-cli never calls disposeAll on SIGINT/SIGTERM; VS Code deactivate disposes
  proxies before agents; ChatPtahCliService.handleStart leaks the proxy lease on
  spawn failure; killProcess has no kill and a ref'd timer for handles without
  getPid; sdkIdleReleaseMs has no runtime floor; readOutput lineCount describes
  the raw buffer.
executor: backend-developer
estimate: M
labels:
  - regression-review
  - cli-agent-runtime
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

ptah-cli never calls disposeAll on SIGINT/SIGTERM; VS Code deactivate disposes proxies before agents; ChatPtahCliService.handleStart leaks the proxy lease on spawn failure; killProcess has no kill and a ref'd timer for handles without getPid; sdkIdleReleaseMs has no runtime floor; readOutput lineCount describes the raw buffer.

Full context, plan and discussion live in [./context.md](./context.md).
