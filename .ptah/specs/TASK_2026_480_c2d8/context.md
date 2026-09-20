# Context — renderer holds a full core

## Measured on the live host, 2026-09-19 (16 logical cores)

Ptah process roles:

```
ProcessId  Role              MB
14932      renderer        1051
13840      MAIN             295
32476      gpu-process      138
```

Live CPU sampling:

| Process | Role | 10 s sample | Lifetime avg (67 min) |
|---|---|---|---|
| 14932 | renderer | 111.7% of one core | **94% of one core** |
| 13840 | main | — | 7% of one core |

The renderer has never been idle. The main process is nearly idle. The reported
symptoms — laggy scrolling, typing indicators, opening session detail — are all
renderer work, so the renderer is the correct target.

Sampling over 100% of one core means work is also landing on helper threads,
which is consistent with sustained V8 garbage collection against a large heap.

## Known heap pressure

7 sessions open. `STREAMING_EVENT_CAP` is 5000 events per session, and at least
one session reached it:

```
[chat-types] StreamingState.events reached cap of 5000; evicting oldest events FIFO.
```

Each retained event carries tool input and output payloads. Seven sessions at or
near the cap is a plausible but UNVERIFIED explanation for 1,051 MB.

Also present in the same log, 33 times:

```
[ChatStore] handleSessionStats: suppressed context-fill update
(cumulative fallback over window/post-compaction); preserved per-model breakdown
```

## Why this task is investigation-first

No CPU profile exists. `%APPDATA%\ptah\DevToolsActivePort` reads 61874 but
nothing listens there, so the running instance cannot be profiled. A profile
needs a relaunch with `--remote-debugging-port`.

**Do not guess at a fix and start editing.** The chat-streaming CLAUDE.md records
several already-completed optimisations in this exact area — the incremental
three-layer tree build, the `StreamingIndexes` memo, `pruneNodeMaps`, the
`mixNumber` signed-fold fix, and the O(E + M) `HistoryMessageBuilder` rewrite
under TASK_2026_453. Another speculative pass risks undoing measured work.

## Deliverable

A written analysis in this folder naming:

1. The instrumentation needed to get a real profile, as concrete commands for
   this repository and this Electron app.
2. Ranked candidate hot paths, each with a `file:line` anchor and the reasoning
   that puts it on the list.
3. For each candidate, the cheapest experiment that would confirm or refute it.
4. Explicitly separate "continuously burns CPU while idle" from "expensive on
   interaction". A pegged core with no user input points at a timer, an effect
   loop, or GC — not at a slow click handler.

Read-only. Make no source edits under this task.
