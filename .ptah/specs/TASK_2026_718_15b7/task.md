---
id: TASK_2026_718_15b7
status: done
type: BUGFIX
title: Test hygiene for chat unit tests and the webview session-create e2e flake
description: >-
  Cut libs/frontend/chat unit-test console noise (zoneless setup, IntersectionObserver stub,
  RPC and TabManager mocks) and harden the session-create e2e spec against a leftover popover.
depends_on: []
created: 2026-10-24T13:42:29.000Z
updated: "2026-10-30T01:09:07.477Z"
---

## Description

1. libs/frontend/chat unit tests print about 582 console lines in CI (PR #788, run 39499246629).
   Fix the test setup and shared mocks so the suite passes with near-zero console output.
   Confirm the NG0101 and tabManager.activeTabSessionId causes before silencing anything.
2. session-create.e2e.spec.ts "blank session name" flake: navbar popover backdrop intercepted
   the "Previous sessions" click (PR #788, Webview E2E run 39499246669).
