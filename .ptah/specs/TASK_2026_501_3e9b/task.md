---
status: backlog
type: devops
title: >-
  Prove the docs and landing deployments after the dependency migration
description: >-
  TASK_2026_498_5513 changed the ptah-docs and ptah-landing-page builds. Neither release
  branch has been synced since, so no real deploy has proved them. Sync and check both.
updated: 2026-11-07T00:00:00.000Z
---

# Prove the docs and landing deployments

## Description

Recorded during TASK_2026_498_5513 as an open risk, not a defect. That task changed the build of
`apps/ptah-docs` and `apps/ptah-landing-page`, including the Starlight sidebar configuration and the
rollup native-binary pin in `scripts/do-docs-build.sh` (`5dddec2ee`). Only a real deploy from
`release/docs` and `release/landing` proves them.

## Current state (2026-11-07)

- Not done. On the remote, `release/docs` is at `cac691266` (2026-09-08, PR #473) and
  `release/landing` is at `5733e00cb` (2026-09-17, PR #529). Neither contains `5dddec2ee`.
- The sync workflow is `.github/workflows/sync-release-branch.yml` (targets `landing` and `docs`,
  `:33-34`). It fast-forwards the branch and then runs `deploy-landing.yml` or `deploy-docs.yml`
  (`:140-141`).
- The DigitalOcean specs are `.do/app.yaml` and `.do/docs-app.yaml`.

## What is verified today

- Both projects build locally and in CI.
- The output directory of each build matches the DigitalOcean app spec.

## What is not verified

The deploy itself. Two defects in this area failed only at deploy time and not
in any build:

1. A fatally broken Starlight sidebar configuration.
2. A rollup native-binary pin in `scripts/do-docs-build.sh`.

Both are fixed. Neither was caught by a passing build, which is the point.

## How to close this task

1. Run the **Sync Release Branch** workflow for `docs`.
2. Confirm the DigitalOcean build log and the served site.
3. Repeat for `landing`.

Never merge into a release branch and never open a pull request against one.
The sync workflow fast-forwards it.
