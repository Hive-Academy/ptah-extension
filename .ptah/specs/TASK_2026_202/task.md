---
id: TASK_2026_202
status: in_progress
type: DOCUMENTATION
title: >-
  Restructure the seeded Builders curriculum from 8 weekly modules to a 10-day
  intensive across 5 domains
description: >-
  The seeded course is an eight-week, one-module-per-week cohort assembled from
  the 8 "Week N build thread" topics in `docs/community/discourse-export.json`
  (lines 203-341) by `apps/ptah-license-server/prisma/seed/map-course.ts`. The
  cohort is being run instead as a 2-week intensive at 3h/day — 10 weekday
  sessions, ~30 live hours, against roughly 12 in the weekly format — so the
  seed data no longer describes the product. Restructure to 10 daily modules
  grouped under 5 domains (foundation/workspace/CI; auth + user + tenancy;
  domain modelling for projects + products; billing + entitlements; AI agent
  integrations plus ONE social integration end-to-end). The remaining social
  platforms move to a post-cohort bonus session rather than inflating the
  cohort. Touch points are coupled and count-checked, so they change together —
  `discourse-export.json` topics, `map-course.ts` `MODULE_TITLES` and
  `CURRICULUM_TOPIC_IDS` (line 196 hard-throws when the two lengths disagree),
  `map-topics.ts`, and the course description at `map-course.ts:61` which
  hardcodes "The eight-week Ptah Builders cohort, one module per week". Also
  repair the pre-existing defect the seed already documents at
  `map-course.ts:38-40` — source topic 21 is titled "Week 7 Hardening" while its
  module title is simply "Hardening". Date-based unlock already operates per
  module (`map-course.ts:10`), so a daily cadence needs new dates, not new
  mechanics.
assignee:
depends_on: []
executor:
claim:
created: 2026-08-10T00:00:00.000Z
updated: 2026-08-10T00:00:00.000Z
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
