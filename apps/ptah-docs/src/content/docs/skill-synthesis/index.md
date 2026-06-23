---
title: Skill Synthesis
description: Auto-discover repeated workflows and promote them to durable SKILL.md files.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Skill Synthesis

The third time you do the same thing, Ptah notices.

Skill Synthesis watches your sessions for **trajectories** — sequences of (turn count, tool calls, outcome) that look like reusable workflows. When several similar sessions cluster together (or the same trajectory succeeds **3 times**), Ptah distills them into one generalized skill, runs it past a quality judge, and — once you accept it — materialises it as a permanent skill at:

```text
~/.ptah/skills/<slug>/SKILL.md
```

From that point on, any agent can invoke it like a hand-authored skill — same trigger semantics, same on-the-fly context injection.

## What's in this section

<CardGrid>
  <Card title="The Skills tab" icon="open-book">
    Recommended, Sessions & Library — and what to delete. [Learn more →](/skill-synthesis/the-skills-tab/)
  </Card>
  <Card title="How it works" icon="setting">
    Trajectory extraction, dedup, promotion. [Learn more →](/skill-synthesis/how-it-works/)
  </Card>
  <Card title="Reviewing candidates" icon="approve-check">
    Promote, reject, or just watch what Ptah found. [Learn more →](/skill-synthesis/reviewing-candidates/)
  </Card>
  <Card title="SKILL.md anatomy" icon="document">
    What the generated file looks like. [Learn more →](/skill-synthesis/skill-md-anatomy/)
  </Card>
  <Card title="Settings" icon="setting">
    Thresholds and caps. [Learn more →](/skill-synthesis/settings/)
  </Card>
</CardGrid>

## Why it exists

Hand-authored skills are great when you know up-front what's worth abstracting. Most workflows aren't like that — they emerge from repetition. Skill Synthesis catches those without you having to notice them yourself.

## Limits

Active skills are capped at **200** by default (`skillSynthesis.maxActiveSkills`). When the cap is exceeded, the weakest resident is demoted to **`dormant`** — kept on disk and in the database but skipped when skills load. Dormant skills are never deleted, and authored skills are exempt. Cosine dedup against the active set prevents near-duplicates from polluting the directory.
