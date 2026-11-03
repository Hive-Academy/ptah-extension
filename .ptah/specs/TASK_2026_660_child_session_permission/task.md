---
id: TASK_2026_660_child_session_permission
status: done
type: BUGFIX
title: "Child sessions start at the parent's autopilot level"
depends_on: []
created: "2026-10-14T21:55:46.000Z"
updated: "2026-10-30T01:09:07.477Z"
description: "A child session started with ptah_session_start must use the parent session's autopilot or permission level instead of auto-edit."
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

A child session started with ptah_session_start must use the parent session's autopilot or permission level instead of auto-edit.

Full context, plan and discussion live in [./context.md](./context.md).
