---
id: TASK_2026_529_b482
status: backlog
type: BUGFIX
title: >-
  Filled badge-success and badge-info fail WCAG AA in the anubis theme, and
  anubis-light was never audited
description: >-
  In anubis, success #16a34a and info #3b82f6 on #e8e6e1 content measure 2.64:1 and 2.95:1,
  below WCAG AA. Fix the tokens and pin the filled-badge pairs for anubis and anubis-light.
updated: 2026-11-07T00:00:00.000Z
---

# Filled badge-success and badge-info fail WCAG AA in anubis

## Description

In the default anubis theme, `success` (`#16a34a`) and `info` (`#3b82f6`) pair with
`success-content` and `info-content` `#e8e6e1`
(`apps/ptah-extension-webview/tailwind.config.js:129-133`). Measured contrast: 2.64:1 for success
and 2.95:1 for info. WCAG AA needs 4.5:1 for normal text and 3:1 for large text and UI parts. Both
fail for normal text, and success also fails 3:1.

1. Change the anubis tokens so filled `badge-success` and `badge-info` meet AA. Keep the glass-mode
   fills in `apps/ptah-extension-webview/src/styles.css:3259-3260,3389` consistent.
2. Measure the anubis-light pairs (`oklch` values, `tailwind.config.js:204-208`), which were never
   audited.
3. Pin both themes' filled pairs in a contrast spec, next to
   `apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts`.

## Current state (2026-11-07)

- Not fixed. The anubis tokens above are unchanged.
- The defect is live: 29 non-spec files under `libs` and `apps` use `badge-success` or `badge-info`
  (56 occurrences, 3 of them outline/ghost/soft), for example
  `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-header.component.ts`.
- `status-badge-contrast.spec.ts` (TASK_2026_576) covers the file-status badge and ink overrides,
  not the filled `badge-success`/`badge-info` pairs.
- The triage note in `context.md` that says no template uses these classes is wrong.
