---
id: TASK_2026_495_2d9f
status: backlog
type: FEATURE
title: >-
  Pinned apps - store, deterministic refresh, and text delivery
description: >-
  Let a user pin a dashboard: store its spec and tool call (credential references only), re-run
  the tool call on a schedule without a model, and deliver a text summary with a deep link.
updated: 2026-11-07T00:00:00.000Z
---

# Pinned apps - store, deterministic refresh, and text delivery

## Description

Lane A. Parent research: `.ptah/specs/TASK_2026_490_583c`. The full deliverable list, the persisted
tool-call fields, the snapshot commit rules and the refresh budgets are in `context.md`; they are
still the scope.

In short: add SQLite tables and numbered migrations in `libs/backend/persistence-sqlite` for pinned
apps, versions, grants and refresh records. Add a named scheduler handler (`handler:NAME`,
`libs/backend/cron-scheduler/src/lib/job-runner.ts:14,61`) that re-runs the stored tool call without
a model. Deliver a text summary with a deep link through the messaging gateway
(`libs/backend/messaging-gateway/src/lib/adapters/adapter.interface.ts:107,116`). Unpin removes the
schedule, the grants and the cache, and cancels an in-flight refresh.

## Current state (2026-11-07)

- Dependency TASK_2026_494_ca38 is `done`.
- Not started. `dashboard.pin` exists only as a catalog action id
  (`libs/shared/src/mcp-apps-contracts/dashboard-catalog.ts:79`). No host code handles it.
- No pinned-app store, migration or refresh handler exists in `libs/backend`.
- The Schedules view and the Cron tab item (deliverable 6) apply to
  `libs/frontend/cron-scheduler-ui/src/lib/components/cron-scheduler-tab.component.ts`.
