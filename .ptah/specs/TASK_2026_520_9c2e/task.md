---
id: TASK_2026_520_9c2e
status: backlog
type: BUGFIX
title: >-
  Stop workstation paths reaching .ptah/specs, and add a guard that keeps them out
description: >-
  325 files under .ptah/specs contain an absolute workstation path or the
  developer account name. CodeRabbit flagged this once on pull request 546 as
  an information disclosure, and only the eight folders of that pull request
  were cleaned. Every agent run reintroduces it, because agents write the
  absolute paths they were given. Clean the existing files and add an automated
  guard so the next agent cannot commit one.
---

# Stop workstation paths reaching .ptah/specs, and add a guard that keeps them out

See `context.md`.
