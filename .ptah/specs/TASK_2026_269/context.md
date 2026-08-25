# TASK_2026_269 — context

## Where this came from

User, 2026-08-17, after a live ID collision destroyed a committed carrier:
"can you generate a new task to wire this into our create path? so we make sure
it's always up to date without any back filling?"

The intent is right. The named mechanism — the create path — is the smaller half
of it, and this file exists mostly to say why.

## What is actually wrong

`registry.md` calls itself derived. Nothing derives it.

- `TaskWriterService.create` and `updateStatus` contain **no reference to the
  registry at all** (grepped). Creating a task or changing its status leaves the
  file untouched.
- The only writer is the `tasks:generateRegistry` RPC, called when a human or
  agent remembers to call it.
- Result, measured 2026-08-17 before regeneration: **42 rows against 113
  folders**, last generated 2026-08-09, newest id ~196 while disk was at 267.
  `TASK_2026_194` was listed `in_progress` while its own carrier said `done`.

The `Status` column makes `updateStatus` a staleness source too, not just
`create` — a board can be entirely up to date on disk and the registry still
wrong about every status in it.

## Why this is not cosmetic

A stale registry is not a wrong-looking table. It is a **loaded gun for ID
allocation.** "Highest + 1" derived from a registry whose highest id lags disk by
71 folders lands on a live folder and silently overwrites another session's
carrier.

That is TASK_2026_194's failure mode. 194 is `done` — it made
`TaskWriterService.create` atomic via `createDirectoryExclusive` + EEXIST rescan.
It recurred anyway on 2026-08-17, destroying the committed `TASK_2026_264`
carrier (recovered; the colliding task now lives at `TASK_2026_267`), because
194 closed the RPC path and left hand-allocation open.

## Correction to the user's framing — the create path is not enough

**Agents do not create carriers through the RPC.** They write `task.md` with a
file write, because that is what a file-writing tool does. Every carrier filed in
this session — 265, 269, and the recovered 267 — was written that way. The two
carriers that collided were written that way.

So a `create`-only hook regenerates the registry for the callers who were never
the problem, and misses the callers who are. It would look like a fix and leave
the failure mode intact.

## The seam that already exists

`TaskIndexService` (`task-index.service.ts`):

- watches `.ptah/specs/` per workspace (`IFileWatcher`);
- coalesces bursts behind a **300ms debounce** — "a burst of N writes in one
  folder" becomes one reindex;
- raises `onDidChangeIndex` with `reason: 'watcher' | 'write' | 'reindex'`,
  which already drives the `tasks:changed` push;
- **already writes a file into the directory it watches** (the specs
  `README.md`) and suppresses that write **path-based**, with a comment
  explaining that a time-based guard would be wrong for a coalescing watcher.

That is the whole mechanism this task needs, including the part that is easy to
get wrong. A watcher-driven regeneration covers hand-written carriers, RPC
writes, external edits, and a `git checkout` that rewrites carriers underneath a
running host — none of which a `create` hook sees.

## The hazard, stated before anyone hits it

**`registry.md` lives inside `.ptah/specs/`, the watched directory.** Regenerating
it from a watcher handler re-triggers the watcher, which regenerates it, forever.

The existing `README.md` suppression is the precedent to follow, and the comment
at `task-index.service.ts:105-107` argues explicitly for path-based over
time-based suppression, "whereas these paths are NEVER a task folder, so dropping
them is safe". `registry.md` satisfies the same property. Do not invent a new
guard; extend the one that is there, and pin the loop with a test — a
regeneration must produce exactly zero further reindex cycles.

`RegistryGeneratorService` is already **write-if-changed**, which bounds the
damage of a mistake here but does not prevent the loop: the first regeneration
after a real change does write, and that write is what re-triggers.

## Open design questions — decide, do not assume

1. **Watcher only, or watcher + write path?** The watcher covers everything but
   is asynchronous — a `tasks:create` RPC returning success followed immediately
   by a registry read could observe the old file. If any caller depends on
   read-after-write, the write path needs its own synchronous regeneration and
   the watcher needs to not double it.
2. **Where does the dependency live?** `TaskIndexService` and
   `RegistryGeneratorService` are both in `task-specs`, so there is no cycle.
   But the index service's stated concern is the SQLite derived index, and the
   registry is a different derived view. One concern per lib is a repo rule;
   one concern per service is the same rule one level down. A shared
   "derived views" trigger may be the honest shape rather than bolting the
   registry onto the index service.
3. **Concurrency.** Two sessions creating carriers at once produce two
   regenerations of a whole-file write. Each scans after its own folder exists,
   so the later write should be a superset — but "should" is doing work in that
   sentence. Reason it through and pin it, or accept it in writing.
4. **Cost.** Full folder scan + parse of every `task.md` per debounce window;
   113 folders today and growing. The 300ms debounce coalesces bursts, and
   write-if-changed avoids disk churn, but the parse is not free.

## What "always up to date" can and cannot mean

Achievable: the registry converges within one debounce window of any carrier
change made **by a process with the watcher running**.

Not achievable by this task: a carrier written while no host is running. The
next start reindexes, so it self-heals — but there is a window, and the honest
version of this task says so rather than promising a guarantee it cannot keep.
The header warning added in TASK_2026_265 ("never allocate an ID from this
file") stays regardless; a fresher registry is not a licence to allocate from it,
and removing that warning is explicitly not part of this task.

## Deployment reality — read before scheduling this

`main` is at 2026-07-16, **533 commits behind** the working branch, and does not
contain `task-writer.service.ts` at all. TASK_2026_194's atomic allocator,
TASK_2026_265's header warning and anything this task adds are all invisible to
the Ptah binary in use until that lands.

Until then the collision-safe method is unchanged and needs no deploy: scan
`.ptah/specs/TASK_*` for the highest NNN, then claim NNN+1 with an exclusive,
fail-if-exists `mkdir`; on EEXIST rescan and retry. That is the same lock 194
implements, performed by hand. It caught a real race twice on 2026-08-17 —
`TASK_2026_266` and `TASK_2026_268` were both taken between a scan and a reserve.

## Verification

- A spec proving a carrier written **directly to disk** (not via the RPC) causes
  `registry.md` to contain its row, with no explicit `generateRegistry` call.
  This is the assertion that distinguishes this task from the create-path-only
  version of it; if only the RPC path is covered, the task has not been done.
- A spec proving `updateStatus` is reflected — the `Status` column is a
  staleness source in its own right.
- A loop guard test: regeneration triggers **zero** further reindex cycles.
- Determinism preserved — `render` must stay wall-clock free
  (`libs/backend/task-specs/CLAUDE.md`), so a regeneration with no carrier change
  must produce a byte-identical file and therefore no write.
- `nx test task-specs`, lint, typecheck.
