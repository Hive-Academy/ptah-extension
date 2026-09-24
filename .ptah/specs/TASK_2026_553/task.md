---
id: TASK_2026_553
status: backlog
type: BUGFIX
title: 'Settings: report a failed write to ~/.ptah/settings.json to the caller'
depends_on: []
created: "2026-09-24T08:26:07.000Z"
updated: "2026-09-24T08:26:07.000Z"
description: "PtahFileSettingsManager.persist logs a failed disk write and returns normally, so every settings save reports success, the value applies for the session only, and the change is lost at restart."
executor: backend-developer
estimate: M
labels:
  - settings
  - reliability
  - priority-low
---

# TASK_2026_553 — Settings write errors are swallowed

Priority: **low** (a rare failure, but silent data loss when it occurs).

## Why

`PtahFileSettingsManager.persist` (`libs/backend/platform-core/src/file-settings-manager.ts:483-503`)
catches every write error and only calls `console.warn`. Causes are a full disk, a missing
permission, or a file lock from antivirus or OneDrive on Windows. `set()` (`:97-108`) then
resolves, so:

- every RPC that saves a setting returns success, and the UI says "saved";
- the in-memory value applies until restart, then the change is lost with no error;
- the TASK_2026_538 Cursor key migration can leave the plain value on disk (the next start
  retries it).

CodeRabbit raised this on PR #585 (comment 4090516481). It was deferred because the change reaches
every settings writer in the VS Code extension, the Electron app and the CLI.

## Scope

1. `persist` rethrows after it logs. Decide with evidence whether `set()` restores the previous
   in-memory value on failure (recommended: yes, so memory and disk agree).
2. Find every caller of the file-settings `set` path (`IWorkspaceProvider.setConfiguration` for
   file-backed keys, settings-core stores, migrations) with `ptah_lsp_references`. For each one,
   record whether a throw is already handled. RPC handlers return an error instead of success.
   Startup paths (migrations, bootstrap) must not crash on a write error.
3. The write queue (`writePromise`) keeps working after one failed write.

## Acceptance

- Spec: make the write fail. `set()` rejects, the stored value does not change, and the next
  `set()` succeeds.
- Spec per runtime bootstrap: a failed write during migrations does not stop startup.
- `fix-report.md` carries a write-path trace for the RPC save path.

## Process

BUGFIX, Partial (wide blast radius). Cross-side review. Verify `platform-core`, `settings-core`,
`rpc-handlers`, `cli-engine` and the apps `ptah-extension-vscode`, `ptah-electron`, `ptah-cli`.
