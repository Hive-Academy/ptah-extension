---
id: TASK_2026_463_f13d
status: in_progress
type: DEVOPS
title: >-
  TASK_2026_437 leftovers: CI bump-branch guard, internal-query slot reservation, Electron publish dry-run, load-test scripts
depends_on: []
created: '2026-09-16T00:00:00.000Z'
updated: '2026-09-16T00:00:00.000Z'
description: >-
  Four small follow-ups left open by TASK_2026_437. Narrow the chore/bump-* CI
  skip guard to the three bot bump prefixes so human dependency bumps run CI.
  Align the internalQuery.maxConcurrent default, raise the global internal-query
  limit to 3 and cap background lanes at limit - 1 so user actions keep a slot.
  Add a dry-run input to publish-electron.yml that builds and packages on all
  three OSes without signing, tagging, opening the bump PR or publishing. Add
  property-hub load-test setup and cleanup scripts; the run stays manual.
executor: software-architect
estimate: M
labels:
  - ci
  - reliability
relates_to:
  - TASK_2026_437_0778
  - TASK_2026_453_1eb4
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

TASK_2026_437 leftovers: CI guard, internal-query slot reservation, publish-electron dry-run, load-test scripts.

Full context, plan and discussion live in [./context.md](./context.md).
