---
id: TASK_2026_276
status: backlog
type: feature
title: >-
  Ship the Python half of the StackProfile registry — a ptah-python plugin and
  the two skills its profile already names
description: >-
  TASK_2026_270 built the StackProfile registry with three profiles and shipped
  the .NET one end to end. The `python` profile exists and its detection signals
  are wired into every detector, but `skills.initializer` and `skills.architect`
  name `python-workspace-initializer` and `python-workspace-architect`, which do
  not exist, and its `requiredPlugins` is empty so nothing routes to them today.
  The intake already offers Python as a platform, and the handler reports the
  missing plugins honestly rather than pretending — so this is a visible gap, not
  a hidden one. Ship a `ptah-python` plugin specializing the shared Stage A
  contract, and decide the workspace story: Nx has no first-party Python plugin,
  so the choice is `@nxlv/python` (community, uv/Poetry) or plain uv/Poetry with
  no Nx layer — the same ask-and-default-sensibly posture the .NET profile took.
---

# Python profile — the skills it already names

Machine-owned metadata carrier. Prose lives in `./context.md`.
