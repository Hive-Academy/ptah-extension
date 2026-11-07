---
id: TASK_2026_889_d57a
status: in_progress
type: DOCUMENTATION
title: Sweep all docs to match the Electron-only product with code evidence
description: >-
  Remove stale claims from the docs app and repository documents, fix them to match the
  Electron-only PtahCode desktop app and the trimmed landing site, and delete non-essential content.
depends_on: []
created: 2026-11-07T03:00:00.000Z
updated: 2026-11-07T03:00:00.000Z
---

## Description

The user asked for a sweep of every document and of the docs application (`apps/ptah-docs`).
Remove old claims. Fix every claim to match the recent Electron changes and the landing changes.
Each kept claim must have physical evidence in the codebase. Keep only important information and
delete what goes stale quickly.

Background: the VS Code extension, CLI and TUI hosts were removed (1cee6fafe), the license
server and Builders portal moved to Hive-Academy/ptah-builders (0dde8a197), the video tooling
moved to nx-video (b69359901), and the Discourse integration was removed (fd1b4557e).
