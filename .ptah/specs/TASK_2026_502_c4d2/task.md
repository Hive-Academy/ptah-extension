---
status: backlog
type: devops
title: >-
  Verify Sentry automatic HTTP instrumentation on NestJS 12
description: >-
  `sentry.module.spec.ts` covers the exception-filter path only. Automatic
  request-span instrumentation is a separate mechanism that patches the HTTP
  layer at runtime. It fails by losing tracing rather than by losing error
  reports, so a green test suite does not cover it. Confirm on staging that
  request spans still arrive after the NestJS 12 upgrade.
---

# Sentry automatic HTTP instrumentation on NestJS 12

Follow-up 1 of TASK_2026_499_a31f.

## Why a test cannot answer this

Sentry patches the HTTP layer when the process starts. The spec suite asserts
that a thrown exception reaches Sentry through the exception filter. That path
is independent of the instrumentation that produces request spans.

A silent loss of tracing looks identical to a healthy service in every check
this repository runs today.

## How to close this task

1. Deploy the license server to staging with a real `SENTRY_DSN`.
2. Send a request to an instrumented route.
3. Confirm in Sentry that a transaction span exists for that request, and that
   it carries the route name rather than a raw path.

If the spans are missing, the remedy is likely the `@sentry/nestjs` version,
which is held on an override today. See TASK_2026_507_9c06.
