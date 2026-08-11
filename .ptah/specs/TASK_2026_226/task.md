---
id: TASK_2026_226
status: in_review
type: DEVOPS
title: >-
  Electron e2e silently tests a stale renderer -- libs/frontend changes never
  enter ptah-electron's cache key
description: >-
  apps/ptah-electron/project.json declares no implicitDependencies and has no
  graph edge to ptah-extension-webview, so a change under libs/frontend/**
  never enters ptah-electron's hash. copy-renderer declares outputs but no
  inputs covering the upstream webview dist, so Nx replays its cached output
  and reports success while dist/apps/ptah-electron/renderer/ still holds the
  previous build's chunks. apps/ptah-electron-e2e chains build-dev plus
  copy-renderer via dependsOn on e2e, showcase and e2e:nightly, so the entire
  Electron e2e suite can pass against a renderer that predates the change
  under test. Found during TASK_2026_222 -- cost three debugging cycles before
  a manual `node apps/ptah-electron/scripts/copy-renderer.js` produced fresh
  chunks instantly. Every green Electron e2e result on this repo is suspect
  until this is fixed.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-11T00:00:00.000Z
updated: 2026-08-11T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
