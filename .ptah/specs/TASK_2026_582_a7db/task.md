---
id: TASK_2026_582_a7db
status: backlog
type: REFACTORING
title: >-
  Extract the video projects into a separate repository for an Nx plugin and a marketplace
description: >-
  Move apps/ptah-video-studio, libs/showcase-manifest, the showcase capture
  harness, tools/video-editor, the generic parts of tools/hyperframes and their
  skills and agents into a new public
  repository. The new repository ships an Nx plugin (generators, executors,
  doctor checks) and a Claude plugin marketplace manifest. Ptah keeps only
  what it needs to record its own videos, consumed from the new package.
depends_on: []
created: 2026-09-30T00:00:00.000Z
updated: 2026-10-01T00:00:00.000Z
---

## Description

The user decided on 2026-09-30 that Ptah work stays focused on Ptah. The video tooling moves to its own repository. That repository gives two products: an Nx plugin that installs the code, and a marketplace repository that installs the skills, the agents and the MCP config.

Ptah Setup Hub integration (marketplace install from the AI Team Builder, running an Nx generator from New Project) is not part of this task.

Read `context.md` for the inventory, the scope and the acceptance criteria.
