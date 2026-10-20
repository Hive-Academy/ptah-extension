---
id: TASK_2026_698_4146
status: done
type: FEATURE
title: Show an estimated prompt-cache expiry timer in the session inspector
description: >-
  Per Claude session, show when the prompt cache is expected to expire (and when an armed idle
  compaction fires) in the right sidebar, using MainRequestTracker data from TASK_2026_692_f748.
depends_on: []
created: 2026-10-18T18:05:00.000Z
updated: 2026-10-20T18:30:00.000Z
---

## Description

Add an optional `cache` field (ttl, lastRequestAt, expiresAt, idleCompactAt) to the
session:stats / session:stats-live payloads. The webview counts down locally from expiresAt and
shows "Cache expires in N min (estimated)", "Idle compaction in N min" and "Cache expired". The
tile is hidden for sessions without cache data (non-Claude providers).
