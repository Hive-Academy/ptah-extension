---
status: backlog
type: devops
title: >-
  Repair or delete the license-server prune targets
description: >-
  The `prune`, `prune-lockfile` and `copy-workspace-modules` targets on
  `ptah-license-server` cannot run. All three executors read
  `<projectRoot>/package.json`, and this app has never had one. The condition
  predates the dependency migration and does not affect the Docker image path,
  which builds from the root manifest. Decide whether the targets are restored
  or removed, then make `project.json` say so.
---

# License-server prune targets

Found during TASK_2026_498_5513. Recorded, not fixed.

## What is wrong

`apps/ptah-license-server/project.json` declares three targets that depend on a
project-level `package.json`:

- `prune`
- `prune-lockfile`
- `copy-workspace-modules`

The app is built with `generatePackageJson`, so its manifest exists only in the
build output. Nothing generates it at the project root, so every one of the
three targets fails when it is invoked.

## Why it is not urgent

`deploy-server.yml` and `apps/ptah-license-server/Dockerfile` do not call them.
The image builds from the root manifest and runs `npm ci` inside the builder
stage. No shipping path touches these targets.

## The decision this task must make

Either make the targets work, or delete them. A declared target that cannot run
is a trap for the next person who reads `project.json` and believes it.

See also `.ptah/specs/TASK_2026_499_a31f`.
