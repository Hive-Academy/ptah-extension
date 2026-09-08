---
status: in_review
type: devops
title: Pin license-server runtime deps and add API uptime monitoring
description: >-
  Pin the eight unpinned packages in the Dockerfile deps stage to exact
  lockfile versions, fail the deploy workflow when the API is not serving,
  and probe api.ptah.live on a schedule with a deduplicated outage issue.
---

Prevention work for the 2026-09-04 to 2026-09-08 api.ptah.live outage.
Outage timeline, root cause, the four monitoring gaps and the mandatory
droplet hotfix removal procedure are in `context.md`.
