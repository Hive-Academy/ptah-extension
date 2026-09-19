# Context — SQLite on the Electron main thread

## Measured on the live host, 2026-09-19

From `Ptah Electron-2026-09-19.log`:

| signal | value |
|---|---|
| `[event-loop] lag` warnings | 54 |
| worst block | 2,912.9 ms |
| mean reported block | 839.5 ms |
| `[SQLite] slow statement` warnings | 71 |
| total time inside those statements | 23.2 s |
| worst single statement | 1,672.7 ms |

Watchdog, previous day (`logs/ptah-hang.log`):

```
{"source":"main-loop-watchdog","event":"hang","blockedForMs":5011}
{"source":"main-loop-watchdog","event":"recovered","blockedForMs":7877}
```

Top offenders are memory retrieval and vector search:

```
SELECT m.id, m.subject, ... FROM memories m WHERE workspace_root IS ?   (11 hits)
SELECT rowid, distance FROM memory_chunks_vec WHERE embedding MATCH ?   (10 hits)
SELECT rowid, distance FROM code_symbols_vec  WHERE embedding MATCH ?    (4 hits)
```

## Why this is real but second priority

The main process averages only 7% of one core; the renderer averages 94%
(TASK_2026_480). These stalls are intermittent, not continuous, so they are not
the whole of the reported UI lag. They ARE real IPC stalls and worth removing.

`slow-statement-timing.ts:5` states this measurement exists precisely to justify
moving a store to a worker before anyone does it. That bar is now met.

Note also that the 1.2 GB file size (TASK_2026_478) worsens these timings: under
memory pressure the page cache for a file that large cannot stay resident.
Fixing 478 may reduce these numbers on its own. Account for that — do not assume
the worker move is the only available lever.

## Scope: design before code

Produce an implementation plan covering:

1. Which stores move. Memory search and vector search are the measured
   offenders; a blanket move of all SQLite access is a much larger blast radius.
2. The transport. `persistence-sqlite` and `memory-curator` already run an
   embedder worker over Electron `utilityProcess` with an id-correlated protocol
   (`embedder-worker-protocol.ts`) — reuse that shape rather than inventing one.
3. How `platform-cli` and `platform-vscode` behave, since `libs/backend/**` must
   run unchanged in all three hosts. A worker that only exists in Electron needs
   a documented degrade path, like the existing embedder BM25-only fallback.
4. Write-path ordering and transaction integrity once reads become async.

## Constraints

- Do not add an unreaped child-process family. See TASK_2026_479 for the fault
  this repository is already living with.
- `ElectronStateWorkerProtocolError: Worker message contains a non-cloneable
  JSON value` already occurs on the existing state worker, logged at
  `[electron RPC] Failed to persist CLI session reference after retries`. Any new
  worker protocol must not repeat that serialisation fault.
- Hexagonal rule holds: backend libs depend on `platform-core` ports, never on a
  concrete adapter. Electron `utilityProcess.fork` is host-implemented behind a
  port — `memory-curator` does this via `IEmbedderWorkerProcessFactory` and never
  imports `electron`.
- All DB access goes through the shared connection from `persistence-sqlite`.
  Never open a second handle.
