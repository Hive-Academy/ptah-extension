---
id: TASK_2026_276
status: backlog
type: feature
title: >-
  Ship a ptah-python plugin with the two skills the Python stack profile names
description: >-
  The Python StackProfile names `python-workspace-initializer` and `python-workspace-architect`,
  but no plugin ships them and `requiredPlugins` is empty. Add a `plugins/ptah-python` plugin
  with those skills and route the profile to it.
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_640_11a5
labels:
  - P4
---

# Python profile — the skills it already names

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

The `python` profile in `libs/shared/src/lib/constants/stack-profiles.ts` names two skills
that do not exist (:183-184) and has `requiredPlugins: []` (:187), so nothing routes to them.
Remaining work:

- Add `plugins/ptah-python/skills/` with `python-workspace-initializer` (Stage A, specializes
  the shared contract from `saas-workspace-initializer`) and `python-workspace-architect`.
  Follow the layout of `plugins/ptah-dotnet/skills/`.
- Set `requiredPlugins` for the Python profile to the new plugin.
- Decide the workspace story. The profile today fixes plain uv (`monorepoDecision: 'given'`,
  `scaffoldCommands: ['uv init']`, :178-180). `implementation-plan.md` section A proposes an
  `'ask'` option with `@nxlv/python`; if chosen, `monorepoTool` must also change.

## Current state (2026-11-07)

- Not started. `plugins/` has `ptah-angular`, `ptah-core`, `ptah-dotnet`, `ptah-nx-saas` and
  `ptah-react`, but no `ptah-python`.
- The skill names appear only in `stack-profiles.ts` and
  `libs/backend/rpc-handlers/src/lib/harness/harness-constants.spec.ts`.
- `implementation-plan.md` and `research-report.md` hold the design. Their line references to
  `stack-profiles.ts` still match.
