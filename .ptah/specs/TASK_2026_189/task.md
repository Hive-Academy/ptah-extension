---
id: TASK_2026_189
status: in_progress
type: DEVOPS
title: Guard-rail and setup docs for the prisma.config.ts env-path regression
description: >-
  The path bug itself is CLOSED — commit 4898d2601 made prisma.config.ts load
  the app-local .env and then the repo-root .env, and npx prisma migrate status
  now resolves ptah_db with no manually exported DATABASE_URL (20 migrations,
  schema up to date). This carrier is open only for the guard-rail and
  documentation half, none of which is started. Remaining work: (1) a structural
  guard so the regression cannot come back — assert that every path passed to
  config() in prisma.config.ts exists in a fresh clone, or that datasource.url is
  non-empty when a root .env is present; note that making datasource.url throw on
  an unset DATABASE_URL was considered and rejected, because CI's prisma:generate
  runs with no DATABASE_URL and passes on the empty string. (2) Setup docs — root
  CLAUDE.md tells people to run npm run prisma:migrate:dev without saying where
  DATABASE_URL comes from, and apps/ptah-license-server/CLAUDE.md lists it under
  Required Environment without naming the file; both should name the repo-root
  .env. (3) apps/ptah-license-server/.env.example is misleading by omission — it
  looks like the app's env template but only covers the admin/marketing subset,
  so it should either say the database config lives in the root .env or be
  renamed so it stops inviting the copy. (4) One sentence somewhere explaining
  that Prisma 7's own dotenvx pass prints "injected env (0) from .env"
  permanently and is not a symptom. Full detail in context.md under What is left.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-09T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
