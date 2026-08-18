---
title: Skill Synthesis
description: Ptah turns repeated workflows into durable skills — some automatically, some only after you say yes.
---

import { Card, CardGrid } from '@astrojs/starlight/components';

# Skill Synthesis

The third time you do the same thing, Ptah notices — and for a single repeated workflow, it doesn't wait for you to say yes.

Skill Synthesis watches your sessions for **trajectories** — sequences of turns, tool calls, and outcomes that look like a reusable workflow — and turns the ones that hold up into permanent skills at:

```text
~/.ptah/skills/<slug>/SKILL.md
```

From that point on, any agent can invoke it like a hand-authored skill — same trigger semantics, same on-the-fly context injection.

:::caution[Two tracks, and only one of them asks first]
**A single workflow that succeeds enough times promotes itself.** No review screen, no Accept button — it clears a quality judge and a couple of safety gates, then Ptah writes the `SKILL.md` and it's live in your library. This is the intended design: the gates are the safety mechanism, not a person.

**A cluster of similar-but-not-identical sessions is different.** Ptah distills the cluster into one candidate, judges it, and stops — it only reaches your library after you review it in **Recommended** and click **Accept**.

If you've only ever noticed the Recommended queue, it's worth knowing the first path exists. [How It Works](/skill-synthesis/how-it-works/) covers the full split; [Background Learning](/skill-synthesis/background-learning/) covers what runs unattended and how to control it.
:::

## What's in this section

<CardGrid>
  <Card title="The Skills tab" icon="open-book">
    Recommended, Sessions & Library — and what to delete. [Learn more →](/skill-synthesis/the-skills-tab/)
  </Card>
  <Card title="How it works" icon="setting">
    Capture, the two promotion tracks, and the gates between them. [Learn more →](/skill-synthesis/how-it-works/)
  </Card>
  <Card title="Background learning" icon="rocket">
    The queue, the cron tiers, and why it doesn't burn your chat quota. [Learn more →](/skill-synthesis/background-learning/)
  </Card>
  <Card title="Reviewing candidates" icon="approve-check">
    Promote, reject, or just watch what Ptah found. [Learn more →](/skill-synthesis/reviewing-candidates/)
  </Card>
  <Card title="SKILL.md anatomy" icon="document">
    What the generated file looks like — and what it deliberately leaves out. [Learn more →](/skill-synthesis/skill-md-anatomy/)
  </Card>
  <Card title="Settings" icon="setting">
    Thresholds and caps. [Learn more →](/skill-synthesis/settings/)
  </Card>
</CardGrid>

## Why it exists

Hand-authored skills are great when you know up-front what's worth abstracting. Most workflows aren't like that — they emerge from repetition. Skill Synthesis catches those without you having to notice them yourself.

## Limits

Active skills are capped at **200** by default (`skillSynthesis.maxActiveSkills`). When the cap is exceeded, the weakest resident is demoted to **`dormant`** — kept on disk and in the database but skipped when skills load. Dormant skills are never deleted, and authored skills are exempt. Cosine dedup against the active set prevents near-duplicates from polluting the directory.
