# Context — offline backlog drain

## The measurement

`~/.ptah/state/ptah.sqlite` is 1,203.9 MB. `dbstat` attribution:

| object | size | rows |
|---|---|---|
| observation_queue | 878.0 MB | 177,919 |
| memory_chunks_vec_vector_chunks00 | 58.6 MB | — |
| memories | 39.8 MB | 36,278 |

Of the 177,919 queue rows, **171,524 already have `processed_at` set**, holding
780.7 MB of payload text. The oldest is from 2026-06-01.

Schema (migration `0016_observation_queue.ts`):

```sql
CREATE TABLE observation_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  workspace_root TEXT,
  prompt_number INTEGER,
  kind TEXT NOT NULL,
  tool_name TEXT,
  tool_input_json TEXT,
  tool_response_text TEXT,
  assistant_message TEXT,
  user_prompt TEXT,
  file_path TEXT,
  captured_at INTEGER NOT NULL,
  processed_at INTEGER
)
```

Indexes: `idx_obs_queue_session(session_id, processed_at, captured_at)` and the
partial `idx_obs_queue_drain(processed_at, captured_at) WHERE processed_at IS NULL`.

## Why runtime retention cannot do this

TASK_2026_478 fixed the retention livelock, and retention now works correctly.
But under sustained `BackgroundWorkGovernor` contention a run deliberately
purges only 50 rows — that bound exists to keep synchronous SQLite work off a
lagging Electron main thread. Judge round 2 did the arithmetic: **4.8 to 14.3
months** for this backlog. That is the correct runtime trade-off and it should
not be loosened. An offline tool is the right answer instead.

## The invariant you must not break

`libs/backend/memory-curator/CLAUDE.md` states that `observation_queue` rows
leave the table through `ObservationRetentionStore` **only** — there is no other
purge path, and an earlier unbatched purge method was deleted precisely because
it ran one DELETE of ~174k rows on the Electron main thread.

An **offline** script does not violate that rule, because it is not a runtime
path and the app is closed. Do not add a second runtime purge path. Do not
weaken the runtime bounds.

## Scope

Write a maintenance script, wired as an npm script, that:

1. **Refuses to run while the app is open.** Check for the lock at
   `%APPDATA%/ptah/lockfile` (and the equivalent on other platforms), and open
   the database in a mode that fails fast rather than blocking on a held write
   lock. A drain that races the live app is the one genuinely dangerous outcome
   here.
2. **Backs up first**, or refuses without an explicit `--force`. There is
   precedent in `~/.ptah/state/backups/`.
3. **Deletes only rows where `processed_at IS NOT NULL`** and older than a
   configurable cutoff, defaulting to the runtime `processedDays` of 7. Never
   touch a row with `processed_at IS NULL` — those are uncurated observations
   and deleting them loses data silently.
4. **Works in bounded batches** with progress output, so it can be interrupted
   and resumed. Do not build one 171k-row DELETE.
5. **Reclaims pages with `incremental_vacuum`, never `VACUUM`.** Check
   `PRAGMA auto_vacuum` first and report honestly if incremental reclaim is
   unavailable on this file rather than silently falling back.
6. **Reports before and after**: row counts, file size, and pages reclaimed.
7. Supports `--dry-run` that reports what it would delete and changes nothing.

## Verification expected

A dry run against the real 1.2 GB file is the meaningful test. Report the
figures it produces. Unit tests over a temporary fixture database are welcome
but are not a substitute for that.

## Constraints

- `catch (error: unknown)`, narrow with `instanceof Error`. No `@ts-ignore`.
- Never `VACUUM`. Never write `processed_at`. Never add an index on
  `observation_queue` — a migration building one reads the 1 GB file on the
  boot path.
- Do not modify anything under `libs/backend/memory-curator` — the runtime
  retention path is correct as of TASK_2026_478 and another task owns it.
