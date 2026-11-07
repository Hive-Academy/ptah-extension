---
status: backlog
type: devops
title: >-
  Smoke test the Electron installer on macOS and Linux
description: >-
  The packaged Electron 44 installer was run by hand on Windows only. Install and start the
  macOS and Linux artifacts once, and confirm the native modules load.
updated: 2026-11-07T00:00:00.000Z
---

# Electron installer smoke test on macOS and Linux

## Description

Recorded during TASK_2026_498_5513, which took Electron 44 (`package.json:185`) and rebuilt the
native modules. Install and start the macOS and Linux installers once on clean machines and record
the result.

## Current state (2026-11-07)

- CI already checks the packed native modules on `macos-latest` and `ubuntu-latest`:
  `verify-packed-native.js` loads the packed better-sqlite3 ABI and `@parcel/watcher`
  (`.github/workflows/publish-electron.yml:388-399`). It does not install or start the app.
- `node-pty` is no longer a dependency (`277f98ed8`), so the terminal check from the old list is
  gone.
- The database file is `~/.ptah/state/ptah.sqlite`
  (`libs/backend/persistence-sqlite/src/lib/db-path.ts:5-12`), not `~/.ptah/ptah.db`.
- No manual macOS or Linux run is on record.

## Why the Windows result does not carry

`better-sqlite3` and the other native dependencies compile per platform and per
Electron ABI. A successful Windows rebuild says nothing about the macOS or
Linux artifact. The failure mode is a packaged application that starts and then
dies when it first opens `~/.ptah/state/ptah.sqlite`.

## How to close this task

For macOS and for Linux:

1. Take the installer from the `publish-electron.yml` run (do not build it locally unless the
   user asks).
2. Install the artifact on a clean machine or a clean virtual machine.
3. Start the application.
4. Open a workspace and confirm that the SQLite database opens.
5. Confirm that the workspace file watcher (`@parcel/watcher`) and code indexing (tree-sitter
   WASM) work.

Record the platform, the artifact name and the result for each run.
