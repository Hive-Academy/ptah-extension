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
- **Budget-limited** downstream. **This claim was FALSE when it was written.**
  `runBootScan` called `curator.curate` directly, and `curate` holds no limiter
  of its own — its only internal gate is the provider QUOTA gate.
  `CuratorRateLimitService.tryAcquire` was reached from the cue path and the
  episode path only, so `maxCuratesPerHour` did not apply to the boot scan at
  all. It applies as of this task, and only as of this task.

The watermark bullet also hid a matching hole: it is only reassuring in **steady
state**. A cold read — fresh install, changed workspace fingerprint, reset
`ptah.db` — produced a watermark of `0`, so every session on disk satisfied
`mtime > watermark` and the FIRST launch in a workspace curated that project's
entire Claude history, one LLM call each. That is exactly why the verification
boot saw nothing: it was not a cold one.

So the question is not "should this be uncontrolled" — but it was less
controlled than this section claimed. Both holes are now closed, which is what
makes the `true` default defensible.

## Options

- **Keep `true`, improve disclosure.** The behaviour is defensible; the problem
  may be that nobody is told. A settings-UI surface plus a first-run note.
- **Flip to `false`, opt in.** Safest for cost and consent, at the price of a
  feature that only helps people who find the switch.
- **Keep `true` but bound it harder** — e.g. cap sessions per boot, or defer
  until the window has been idle.

Whichever is chosen, record the reasoning where the default lives, so the next
person does not re-litigate it from scratch.

## Decision (2026-08-24, user) — keep `true`, bound the cold start

**`memory.triggers.bootScan` stays `true`.** Do not flip it.

Flipping the default to `false` was considered first, and an earlier revision of
this file recorded it as the decision. It was **superseded on the same day**,
before any code was written. The reasoning: the objection was never "the boot
scan exists", it was "the boot scan is unbounded and unbudgeted" — and both of
those were real defects with real fixes, not properties of the feature. Turning
the feature off would have hidden them rather than fixed them, and would have
cost unprompted learning to everyone who never finds a settings switch.

So the two defects were fixed instead (TASK_2026_319):

1. **A cold start is bounded to the last 7 days.** `BootScanRunner.readWatermark`
   now returns `null` for an absent row — including when the read throws — and
   the caller floors that to `now - 7 days`. A persisted watermark is used
   verbatim and never floored, in either direction. Nothing the user did before
   they installed Ptah is eligible.
2. **The boot scan draws from `maxCuratesPerHour`.** The `run` callback in
   `MemoryTriggerService.runBootScan` acquires from the same hourly bucket as
   the cue and episode paths, and a refusal returns `'stalled'` — so the runner
   stops the scan, leaves the watermark below the refused session, emits a
   `rate-limited` event, and the next boot retries it.

Both defaults stay exactly where they are: `memory-trigger-config.ts:53` and
`platform-core/src/file-settings-keys.ts:555`. The pre-existing gating (setting,
watermark, abort controller) is unchanged; the budget limit is new.

Do not re-litigate the default without first reading the two fixes above — the
version of this feature that motivated the flip no longer exists.

## Not in scope

- The ordering fix (already landed in `1ef31e8db`).
- `skill-trigger.service.ts` — it does not spend, despite what the original
  plan said.
