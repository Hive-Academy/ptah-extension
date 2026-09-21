---
status: backlog
type: devops
title: >-
  Take @sentry/nestjs 11 and drop the peer override
description: >-
  `@sentry/nestjs` 10 declares a peer range that excludes NestJS 12, so the
  root manifest carries an override to force the install. The override is a
  stopgap. Sentry 11 declares `^12.0.0` properly. Lift the dependency and
  delete the override once Sentry 11 leaves release candidate.
---

# @sentry/nestjs 11

Follow-up 1 of TASK_2026_498_5513 and follow-up 2 of TASK_2026_499_a31f. The
same item, recorded in both.

## Why the override exists

The license server runs NestJS 12. `@sentry/nestjs` 10 declares a peer range
that stops at NestJS 11. The override in the root `package.json` forces the
resolution.

An override is load-bearing and invisible. It also interacts with a second
defect found during the migration: Nx `generatePackageJson` drops any root
`overrides` entry whose key is also a direct dependency, which is why the
generated Docker manifest lost this exact entry and failed `npm ci`.

## Trigger

`@sentry/nestjs` 11 stable. Check with `npm view @sentry/nestjs dist-tags`.

## Scope

1. Lift `@sentry/nestjs` to 11.
2. Delete the override from the root `package.json`.
3. Confirm the License Server Image workflow still builds and boots.
4. Confirm the error-capture spec still passes.

Related: TASK_2026_502_c4d2 verifies the automatic HTTP instrumentation, which
no spec covers.
