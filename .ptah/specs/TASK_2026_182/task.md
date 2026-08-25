---
id: TASK_2026_182
status: done
type: BUGFIX
title: Native-ABI test runner covers only two of the projects that self-skip
description: >-
  scripts/test-native.mjs hardcodes DEFAULT_PROJECTS to persistence-sqlite and task-specs under a comment claiming those are the projects whose suites self-skip. That claim is false - rpc-handlers, messaging-gateway and skill-synthesis carry the identical nativeAvailable ? describe : describe.skip pocket, and apps/ptah-electron is unreachable by construction because the script resolves configs at a hardcoded libs/backend/<project>/jest.config.ts path. A suite that self-skips still reports green, so any of these can hide a real defect indefinitely - one already did. Derive the project list instead of hand-maintaining it, fix app-path resolution, then triage whatever the newly-covered libs turn red.
assignee:
depends_on: [TASK_2026_181]
executor:
claim:
created: 2026-08-05T00:00:00.000Z
updated: 2026-08-05T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
