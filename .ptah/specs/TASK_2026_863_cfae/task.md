---
id: TASK_2026_863_cfae
status: done
type: BUGFIX
title: Fix auto hand-off and idle compaction for background sessions
description: >-
  Automatic session hand-off never fires and idle (pre-cache-expiry) compaction
  fires only when the session is shown. Make both work for background sessions,
  add an option to close the old session after an automatic hand-off, and add
  dev-only overrides to test both live with short thresholds.
depends_on: []
created: 2026-11-03T14:40:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

1. Auto hand-off (`sessionBudget.autoHandoffAtLimit`, commit 5e7b108d4) never fires.
   Suspected cause: the trigger lives in the webview and runs only for the shown session.
2. After an automatic hand-off creates the new session, optionally close the old session.
3. Idle compaction before the prompt-cache TTL expires fires only sometimes, apparently
   only when that session is shown.
4. Dev-only overrides so the serve dev instance can test both live: cache TTL of a few
   seconds and a very low hand-off threshold.
