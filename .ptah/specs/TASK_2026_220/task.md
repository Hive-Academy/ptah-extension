---
status: backlog
type: BUGFIX
title: >-
  applyHunks inherits the undocumented service-wide assumption that
  workspacePath is the repository top level
description: >-
  Every GitInfoService method already assumes workspacePath is the
  repository top level (readBlob uses root-relative rev:path,
  readWorktreeBlob joins workspacePath + path). If a user opens a
  subdirectory of a repo, git diff emits root-relative paths while git apply
  resolves them relative to cwd, so the apply fails safely -- it cannot
  corrupt. Correctly left alone under NFR-9 as pre-existing and out of
  scope, but a safe failure nobody has documented reads as a bug to whoever
  hits it. Register item 14 from TASK_2026_173 Batch 9.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

See `context.md`. **Severity**: MODERATE. Fails safely today -- cannot corrupt -- but is undocumented.
