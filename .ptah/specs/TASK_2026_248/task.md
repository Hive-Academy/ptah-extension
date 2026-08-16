---
id: TASK_2026_248
status: done
type: DOCUMENTATION
title: >-
  Rewrite the skill-synthesis docs section against what TASK_2026_180 actually
  shipped, and say plainly what runs without asking
description: >-
  All six pages under `apps/ptah-docs/src/content/docs/skill-synthesis/` date
  from 2026-07-11 and predate every TASK_2026_180 commit. They describe a
  pipeline that no longer exists — no durable queue, no cron tiers, no lane
  routing, no session archaeologist, no empirical gates, no judge panel — and
  `index.md` tells users a skill ships "once you accept it", which is true only
  of the cluster track. Single-session candidates promote at three successes and
  write a live `SKILL.md` with no user action anywhere in the path. User-decided
  2026-08-15: the code is right and the docs must describe the split honestly,
  including the background token spend.
---

# Rewrite the skill-synthesis docs section

Machine-owned metadata carrier. Prose lives in `./context.md`.
