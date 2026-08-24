# Context — TASK_2026_319

## Where this came from

TASK_2026_315, finding B1. The original log analysis flagged that a curator LLM
query fires at boot before `bringUpSubsystems` starts the MCP server, so it runs
tool-less (`[WARN] [SdkQueryRunner] MCP disabled (server not running)`,
`tmp/logs/log.log:618`). That was two problems in one finding:

- **(a) the ordering** — fixed in commit `1ef31e8db`. MCP now comes up before
  the heavy boot; a traced boot shows zero `MCP disabled` occurrences.
- **(b) the spend itself** — booting the app makes LLM calls nobody asked for.
  Not fixed. This task is (b).

Recorded as F5 in `.ptah/specs/TASK_2026_315/follow-ups.md`.

## Correct the pointer before starting

TASK_2026_315's `tasks.md` named
`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:802` as
the spender. **It is not.** That path calls `synthesis.enqueueAnalyze`, which is
a local SQLite INSERT and spends nothing upstream; the comment at `:788-799`
says so and a traced boot confirmed it — the enqueue produced no query.

The actual spender, established by that same trace:

```
[memory-curator] no curator model pinned; riding the haiku tier of the resolved provider
[SdkQueryRunner] Starting internal query: {"model":"haiku",...}
```

`MemoryTriggerService.runBootScan`
(`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:805`),
calling `curator.curate` once per session newer than the watermark, gated by
`memory.triggers.bootScan`, default `true`
(`libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:53`).

## Why this was deliberately not fixed inside TASK_2026_315

Three reasons, all still standing:

1. It is outside the file set that task's batch was authorised to touch.
2. It is not an ordering bug and cannot be fixed from an Electron activation
   file. `bootHeavyServices` does not choose to spend; `MemoryTriggerService`
   does.
3. **Flipping a shipped default from `true` to `false` is a product decision**,
   not a bugfix. It changes whether Ptah learns from your history unprompted.

## What is already true, so the decision is narrower than it sounds

The behaviour is not reckless. Before deciding, weigh what already exists:

- **Gated** by a user setting (`memory.triggers.bootScan`).
- **Abortable** via `bootScanController`.
- **Watermarked** — only sessions newer than the mark are processed. In the
  verification boot during TASK_2026_315, this meant **no query was issued at
  all**, because the watermark had already advanced.
- **Budget-limited** downstream.

So the question is not "should this be uncontrolled" — it isn't. It is: should
the default be on, and does the user know it is?

## Options

- **Keep `true`, improve disclosure.** The behaviour is defensible; the problem
  may be that nobody is told. A settings-UI surface plus a first-run note.
- **Flip to `false`, opt in.** Safest for cost and consent, at the price of a
  feature that only helps people who find the switch.
- **Keep `true` but bound it harder** — e.g. cap sessions per boot, or defer
  until the window has been idle.

Whichever is chosen, record the reasoning where the default lives, so the next
person does not re-litigate it from scratch.

## Decision (2026-08-24, user)

**Flip `memory.triggers.bootScan` to default `false`.** Booting must not spend
against the user's provider until they opt in. Consent and cost outweigh the
unprompted-learning benefit, which only reaches users who would have found the
switch anyway.

The decision is recorded here, but the change was **not** implemented in this
session — the deploy batch was scoped to ship blockers only (TASK_2026_307,
TASK_2026_273). Whoever picks this up: flip the default at
`memory-trigger-config.ts:53`, write the reasoning above as a comment where the
default lives so it is not re-litigated, and add a spec pinning the default so a
future edit has to be deliberate. The existing gating (setting, watermark, abort
controller, budget limit) stays as it is.

## Not in scope

- The ordering fix (already landed in `1ef31e8db`).
- `skill-trigger.service.ts` — it does not spend, despite what the original
  plan said.
