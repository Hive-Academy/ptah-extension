---
id: TASK_2026_579_f2e2
status: backlog
type: BUGFIX
title: Fall back to another curator provider when the configured one is rate-limited
depends_on: []
created: '2026-09-30T13:53:38.000Z'
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The curator resolves one provider, so a rate-limited provider stalls every pass. Add an ordered
  fallback list so curation continues on another provider with usable auth.
labels:
  - memory-curator
  - P1
relates_to:
  - TASK_2026_311
parent: TASK_2026_635_5ea5
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

On 2026-09-30 `openai-codex` was rate-limited. Every curation pass stalled with
`provider-unreachable` or `provider-cooling-down`, and a manual Run now took 202 s and consumed
nothing. The stall-safe behavior is correct. The defect is that curation depends on one provider.

- Add an ordered fallback list of curator providers (a setting). Default: the configured provider,
  then the active chat provider. Try only providers with usable auth, and dedupe by provider
  identity.
- On `cooling-down` or `unreachable`, retry the failed window (not the whole pass) on the next
  provider. Keep the drafts of the windows that completed.
- `cooling-down` is decided before dispatch, so fallback is always allowed. `unreachable` is
  decided after the stream: fall back only when the failed run made no mutating tool call. The
  `unreachable` outcome must carry the tool names it saw.
- End the attempt early on a 429 instead of retrying for minutes inside the proxy.
- Show the serving provider and the cooling-down providers in memory diagnostics.

The acceptance criteria in `./context.md` are still current. Its line numbers are not (see below).

## Current state (2026-11-07)

- Not started. No fallback-provider logic exists in `libs/backend/memory-curator/src/lib/curator-llm`
  or in `libs/backend/agent-sdk/src/lib/curator-llm-adapter`.
- One provider is resolved:
  `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:279-301`
  (returns `cooling-down` on quota errors). `CURATOR_MAX_TURNS` is at `:225`. The `unreachable`
  outcome carries only `signal` (`:154`, `:649`, `:672`).
- A stall drops the drafts of earlier windows:
  `libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.ts:218`.
- The skill enhancer uses the same resolution:
  `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts`.

Full context, plan and discussion live in [./context.md](./context.md).
