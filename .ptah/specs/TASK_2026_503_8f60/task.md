---
status: backlog
type: devops
title: >-
  Smoke test the Electron installer on macOS and Linux
description: >-
  TASK_2026_498_5513 took Electron 44 and rebuilt the native modules. The
  packaged installer was verified on Windows only. macOS and Linux are
  unticked, and the native rebuild chain is the part of the build most likely
  to differ per platform.
---

# Electron installer smoke test on macOS and Linux

Recorded during TASK_2026_498_5513.

## Why the Windows result does not carry

`better-sqlite3` and the other native dependencies compile per platform and per
Electron ABI. A successful Windows rebuild says nothing about the macOS or
Linux artifact. The failure mode is a packaged application that starts and then
dies when it first opens `~/.ptah/ptah.db`.

## How to close this task

For macOS and for Linux:

1. Build the installer with the normal publish target.
2. Install the artifact on a clean machine or a clean virtual machine.
3. Start the application.
4. Open a workspace and confirm that the SQLite database opens.
5. Confirm that the terminal (node-pty) starts.

Record the platform, the artifact name and the result for each run.
