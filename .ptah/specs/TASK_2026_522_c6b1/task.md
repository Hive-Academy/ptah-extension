---
id: TASK_2026_522_c6b1
status: backlog
type: BUGFIX
title: >-
  The MCP OAuth Electron e2e spec reads the real user profile and fails on a
  developer machine
description: >-
  The spec asserts that a fresh launch reports zero OAuth-connected MCP
  servers, but the launched app reads the real profile directory of whoever
  runs it. A developer who has ever connected an MCP server through OAuth gets
  a failure that has nothing to do with the change under test. It passes on
  continuous integration only because that machine starts clean. Give the spec
  its own profile directory so its result depends on the code, not on the
  machine.
---

# The MCP OAuth Electron e2e spec reads the real user profile

Found while verifying TASK_2026_491_e0da. See `context.md`.
