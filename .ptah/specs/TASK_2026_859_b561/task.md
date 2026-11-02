---
id: TASK_2026_859_b561
status: in_progress
type: BUGFIX
title: Fix MCP registry integration for the v0.1 versions/latest API
description: >-
  The MCP directory requests /v0.1/servers/{name}, which now returns 404. Migrate the provider,
  shared types and frontend auto-detect to /v0.1/servers/{name}/versions/latest and the
  packages/remotes server.json schema, fail loudly on unknown shapes, add fixture tests.
depends_on: []
created: 2026-11-01T14:40:00.000Z
updated: 2026-11-01T14:40:00.000Z
---

## Description

Every popular and search entry in the MCP directory shows "Could not auto-detect configuration"
because the registry detail endpoint and schema changed. Fix the fetch/parse/detect path only;
install-scope code belongs to TASK_2026_853 Phase D and stays untouched.
