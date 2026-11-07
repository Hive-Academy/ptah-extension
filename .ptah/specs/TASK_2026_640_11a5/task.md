---
id: TASK_2026_640_11a5
status: backlog
type: FEATURE
title: Skills distribution to CLIs (harness-sync) and capability controls
depends_on: []
created: "2026-10-12T19:39:43.394Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  Epic. Provenance markers on harness copies, capability enforcement on system CLI lanes, harness
  disclosure e2e, the pi target, and the Python and Smithery scope decisions.
estimate: L
labels:
  - epic
  - skills
  - P2
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Epic. Ptah skills reach CLI harnesses (harness-sync) with clear provenance, and capability
controls apply to every lane. The children carry the work: provenance markers on harness skill
and command copies, capability enforcement on system CLI lanes (codex, opencode, ...), e2e
coverage and a cap for the harness disclosure surfaces, the pi harness target, and the Python
plugin and Smithery provider scope decisions.

## Current state (2026-11-07)

- Closed children: TASK_2026_564_87a6 (CLI proxy skill placeholders) is `cancelled`;
  TASK_2026_280 (harness settings UI) is `done`.
- Open children (all `backlog`): TASK_2026_279 (provenance,
  `libs/backend/harness-sync/src/lib/targets/workspace-target.ts`), TASK_2026_560_2ae5 (system CLI
  lane enforcement), TASK_2026_313 (disclosure e2e,
  `libs/frontend/marketplace/src/lib/harness/harness-blocked-paths.component.ts`), TASK_2026_284
  (pi target; `libs/backend/harness-sync/src/lib/targets/rival-targets.ts` has no pi entry),
  TASK_2026_276 (Python plugin), TASK_2026_289 (Smithery).
- Line numbers in `context.md` date from 2026-10-12. The child evidence for 560
  (`sdk-query-options-builder.ts`, `ptah-cli-spawn-options.service.ts`) still exists.

Full context, plan and discussion live in [./context.md](./context.md).
