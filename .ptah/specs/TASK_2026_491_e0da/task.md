---
id: TASK_2026_491_e0da
status: in_review
type: BUGFIX
title: >-
  Make the Electron permission handler origin-aware and add a CSP to the shell
description: >-
  The session permission handlers in the Electron main window approve each
  request when the top-level webContents id agrees. A subframe shares that id,
  so the check is not an origin policy. The app shell also has no runtime
  Content-Security-Policy. Replace the check with a policy on requesting
  origin, embedding origin, main-frame flag and permission, with deny as the
  default, and add a restrictive CSP to the shell. This has value without the
  apps feature and is a precondition for any iframe work.
---

# Make the Electron permission handler origin-aware and add a CSP to the shell

Lane B. Depends on: none. Parent research: `.ptah/specs/TASK_2026_490_583c`.

See `context.md`.
