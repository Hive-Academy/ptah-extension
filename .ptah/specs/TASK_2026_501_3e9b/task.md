---
status: backlog
type: devops
title: >-
  Prove the docs and landing deployments after the dependency migration
description: >-
  TASK_2026_498_5513 changed the build of `ptah-docs` and `ptah-landing-page`,
  including the Starlight sidebar configuration and the rollup native-binary pin
  in `scripts/do-docs-build.sh`. The build outputs match the DigitalOcean spec,
  but no real deploy has run. Only a run against `release/docs` and
  `release/landing` settles it.
---

# Prove the docs and landing deployments

Recorded during TASK_2026_498_5513 as an open risk, not a defect.

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
The sync workflow fast-forwards it. See the root `CLAUDE.md`.
