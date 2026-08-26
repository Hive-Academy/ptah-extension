---
id: TASK_2026_282
status: done
type: bugfix
title: >-
  Nine specs on this branch die in `beforeEach` — three suites failing for three
  unrelated reasons, all of them missing wiring rather than broken behavior
description: >-
  Surfaced while gating TASK_2026_278: `nx affected -t test` fails in three
  projects none of that work touched, and each failure is a test-harness gap,
  not a product defect. `apps/ptah-extension-webview`
  `unit5-message-routing.spec.ts` builds a TestBed mirroring `app.config.ts` but
  never provides `MODEL_REFRESH_CONTROL`, which `HarnessWorkflowMessageHandler →
  HarnessWorkflowService → PermissionHandlerService → TabManagerService` now
  injects, so all six tests die with NG0201. `libs/frontend/thoth-shell` fails
  on `this.state.refreshQueue is not a function` with
  `this.appState.workspaceInfo is not a function` logged alongside — a stub that
  has drifted behind the signals its component reads. `libs/api/member-hub` has
  two SessionsSection three-way-merge cases failing. Left untouched during 278
  so the diff stayed reviewable.
updated: '2026-08-25T21:15:30.192Z'
---

# Pre-existing spec failures on ak/tui-defects

Machine-owned metadata carrier. Prose lives in `./context.md`.
