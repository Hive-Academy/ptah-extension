---
status: backlog
type: devops
title: Run license-server migrations as a deploy step, not in the app start command
description: >-
  Move prisma migrate deploy out of the container CMD into its own one-shot
  deploy step, so the app image needs no Prisma CLI and a CLI version split can
  no longer stop the server from booting.
---

Follow-up from the 2026-09-04 api.ptah.live outage (TASK_2026_392).

The outage happened because the container start command couples two unrelated
things: applying migrations and starting the server. A CLI that could not parse
its own command therefore prevented the app from ever running.

Splitting them removes the coupling and removes the last hand-pinned package
from the Dockerfile. This is a deliberate change to deploy orchestration and
failure semantics, so it is filed rather than folded into the incident fix.

Design options, trade-offs and acceptance criteria are in `context.md`.
