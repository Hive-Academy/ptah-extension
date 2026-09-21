---
id: TASK_2026_521_3d8b
status: backlog
type: BUGFIX
title: >-
  Set strictMcpConfig so a settings-file server cannot start a second process
description: >-
  strictMcpConfig appears nowhere in the repository. The TASK_2026_496 spike
  proved that without it, a settings-file MCP server whose name matches a
  programmatically registered server starts a SECOND upstream process,
  silently, and takes over the name. Two processes for one stdio server means
  two memories, lock and port conflicts, double OAuth refresh and a second
  authorization path. Decide and enforce the setting, and pin the collision
  behaviour with a test.
---

# Set strictMcpConfig so a settings-file server cannot start a second process

Found by the TASK_2026_496_fc4a Gate 0 spike. The spike recorded it as a mandatory condition on
its PASS.

See `context.md`.
