---
id: TASK_2026_519_4f1a
status: backlog
type: BUGFIX
title: >-
  Give the CDP automation window its own session partition
description: >-
  ElectronBrowserCapabilities creates a second BrowserWindow for Chrome
  DevTools Protocol automation and passes no partition, so that window shares
  session.defaultSession with the trusted application shell. Untrusted pages
  driven by browser automation therefore share cookies, local storage, the HTTP
  cache and stored credentials with the shell. The shared session also means
  the shell permission handlers apply to the automation window, where they deny
  every request. Give the automation window an ephemeral partition of its own
  and its own permission policy.
---

# Give the CDP automation window its own session partition

Found during the adversarial security review of TASK_2026_491_e0da. Independent of that
task: the defect exists on `main` today.

See `context.md`.
