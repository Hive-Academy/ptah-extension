---
title: Background Learning
description: The durable queue, cron tiers, and per-stage provider lanes that let Skill Synthesis learn without competing for your chat quota.
---

import { Aside } from '@astrojs/starlight/components';

# Background Learning

Every stage between "a session ended" and "a skill got promoted" — reading the transcript, drafting a skill, judging it, checking whether retrieval actually finds it — can involve a model call. Doing that inline, the moment your session ends, would mean the same request queue and the same quota your own conversation just used. Skill Synthesis doesn't do that. It queues the work, drains it on its own schedule, and — the part worth knowing about — can send it to a completely different provider than the one you chat with.

<Aside type="danger" title="On by default, and it spends tokens">
`skillSynthesis.enabled` defaults to **`true`**. Background learning runs, and it spends real tokens, from the moment Ptah starts, unless you turn it off. The master switch is that same key — in the Electron tray it's the **"Pause background learning"** toggle, and flipping it off makes the drain read no settings and touch nothing, not just skip the expensive parts.
</Aside>

## The queue

Every capture and every gate is a row in a durable SQLite queue (`skill_synthesis_queue`), not a fire-and-forget call made the moment a session ends. That matters for one concrete reason: work survives closing the app. A session that ends five minutes before you quit for the day still gets captured, archaeology-read, and judged once Ptah is running again — nothing is lost to the app not being open at the right moment.

## Three cron tiers

Three schedules drain the queue, and each is a superset of the one below it — a stage an earlier tier couldn't get to is still eligible on the next one up:

| Tier       | Schedule         | Stages                                                                |
| ---------- | ---------------- | --------------------------------------------------------------------- |
| `frequent` | every 15 minutes | prefilter, synthesis, embedding, clustering, cluster-synthesis, judge |
| `nightly`  | daily at 3am     | + archaeology, digest                                                 |
| `weekly`   | Sunday at 4am    | + judge-panel, replay, trigger-eval                                   |

The split isn't arbitrary. `frequent` carries only the stages a session needs to become a visible candidate quickly. `nightly` adds the archaeologist — the most expensive per-item stage — batched onto a schedule that doesn't compete with your working hours. `weekly` adds the three deepest evaluation stages, which measure quality rather than gate initial capture.

Before any tier spends anything, five gates run in order, and the first one that stops the tick stops it before a single setting past it is even read:

1. **`skillSynthesis.enabled`** — the master switch. Off means nothing else below is evaluated.
2. **Daily token budget exhausted** — a tick that starts over budget does no work at all.
3. **On battery** (if `pauseOnBattery` is set — default on)
4. **You're mid-conversation** — a foreground backoff window (default 5 minutes since your last chat activity) so background work never competes with a session you're actively in.
5. **The scheduled run was cancelled** before it started.

## Lane routing — the part that changes your bill

Every background LLM call runs on one of four **lanes** — `archaeologist`, `synthesis`, `judge`, `replay` — and each lane has its own provider and model setting, completely independent of the provider you chat with.

By default, every lane is set to **inherit**: an install that never touches these settings behaves exactly as if lanes didn't exist, resolving to the same model your foreground chat would use. But because each lane is independently configurable, you can point background learning at a different provider entirely — Ollama running locally, or a hosted alternative like Z.AI, Moonshot Kimi, or OpenRouter — and none of the archaeology reads, skill drafts, or judge calls touch your Anthropic quota at all. This is the practical effect of the queue/lane split: background learning becomes something that costs you _nothing_ on your primary provider, rather than a second consumer of the same budget your chat sessions draw from.

A lane's auth is resolved fresh for each call and never mutates your live chat session's credentials — background work genuinely cannot leak into or interfere with a foreground conversation, in either direction. If a configured lane's credentials can't be resolved, that lane's work stalls on a 30-minute backoff and waits for you to fix the configuration — it does not silently fall back to your foreground provider. That silent fallback is exactly the behavior lane routing exists to prevent.

## The session archaeologist

Where the [prefilter](/skill-synthesis/how-it-works/#stage-1--capture-sessions) is a free regex pass, the archaeologist is the first stage that actually reads a transcript with a model. It runs nightly, per captured session, and produces a structured verdict instead of a guess:

- **Intent** — what the session was actually trying to do (often only legible once you can see how it ended)
- **Outcome** — how strongly the result is evidenced: a passing test suite outranks "the user didn't complain," which outranks nothing at all
- **Friction map** — specific turns where something went wrong and was corrected, cited by turn index, not summarized away

That friction map is why the prefilter deliberately lets short, messy, three-failed-attempts-then-a-fix sessions through: a clean one-shot session teaches an agent nothing it didn't already know, but a debugging loop with a real correction in it is exactly the material a reusable skill should encode. When the archaeologist can't determine something, it says so — a verdict with a null intent and a reason attached is a real, usable record: "analyzed, nothing transferable here," not a silent gap.

## The budget

`skillSynthesis.budget.maxTokensPerDay` (default **2,000,000**, `0` = unlimited) is a hard daily ceiling, checked both before a tick starts and again before every individual item inside it — a lane call mid-tick can still exhaust the budget, at which point token-spending stages stop and the free stages (prefilter, embedding, clustering, trigger-eval) keep going. Once spend crosses 80% of the daily budget, the drain deliberately orders the remaining work cheapest-first, so whatever budget is left buys the most items rather than being spent on the single most expensive one first.

## Where to tune it

The exact settings keys — per-lane provider/model, drain cadence, item caps, and the budget itself — are documented in [Settings](/skill-synthesis/settings/).
