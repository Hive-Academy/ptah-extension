---
id: TASK_2026_388
status: backlog
type: feature
title: >-
  Private chat sessions on their own provider — an isolated session runtime
  beside the untouched global path
description: >-
  Supersedes TASK_2026_304 (cancelled). That plan threaded a `providerId`
  through the process-global `SdkAgentAdapter` path and was rejected in
  `.ptah/specs/TASK_2026_304/plan-review-codex.md`: the global initialization
  gate, four adapter-reset routes, a silent `undefined` fallback to global auth,
  mutable provider on continue, no durable session binding, uncovered
  slash/rewind/fork query paths, a `...process.env` leak and a proxy-pool race
  all survive that design. This task takes the other route. The global/default
  provider path stays as it is. A user can instead START a new session as a
  private session with its own full, immutable execution configuration
  (provider, auth route, model, tier snapshot), served by an in-process private
  session runtime that owns its lifecycle and a fail-closed provider-profile
  lease, is routed by tab id and real session id, is never disposed by a global
  auth reset, and is restored from durable session metadata after a host
  restart. Planning is done by Codex with its software-architect subagent, then
  reviewed here before any batch runs.
---

# Private chat sessions on their own provider

Machine-owned metadata carrier. User intent and the design constraints live in
`./context.md`. The plan goes in `./implementation-plan.md` and the batch
breakdown in `./batches.md`.
