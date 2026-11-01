---
id: TASK_2026_856_d668
status: in_progress
type: REFACTORING
title: Move session metrics and timers out of component lifecycle
description: >-
  Audit and fix frontend session calculations (context, tokens, cost, cache, start time, timers)
  that live in Angular component state and reset or drift after navigation; move them to
  persistent stores or host-provided values.
depends_on: []
created: 2026-10-30T15:20:00.000Z
updated: 2026-10-30T15:20:00.000Z
---

## Description

Session calculations and client-side dates/timers are computed inside Angular component
lifecycles and get lost or recomputed wrongly when components are destroyed (navigation, tab
switch, panel toggle). Find every such case systematically and move the state to a persistent
owner (signal store at root, or the host/backend as source of truth).
