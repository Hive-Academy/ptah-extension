# TASK_2026_381 — Context

## The report

The user observed the Ptah Electron app at about 2.9 GB total across four
processes with one session running.

## Measurements (2026-09-06, the user's running production build)

Taken with `Get-CimInstance Win32_Process -Filter "Name='Ptah.exe'"`.

| Process                                      | Working set | Private     |
| -------------------------------------------- | ----------- | ----------- |
| renderer, one window (PID 4176)              | 2529 MB     | **2474 MB** |
| main (PID 26772)                             | 1119 MB     | 1366 MB     |
| utility — `ptah-embedder-worker` (PID 41772) | 412 MB      | 452 MB      |
| GPU (PID 18932)                              | 170 MB      | 306 MB      |
| network service (PID 13636)                  | 57 MB       | 14 MB       |

The row shown in "Efficiency mode" in the user's screenshot is the renderer.
Chromium applies EcoQoS to a renderer whose window is in the background. The
screenshot therefore does not show the main process as the largest consumer.

Database measurements, read-only against
`C:\Users\abdal\.ptah\state\ptah.sqlite` (1049841664 bytes) using
`node --experimental-sqlite` and the `dbstat` virtual table:

| Table                               | Bytes     | Rows                      |
| ----------------------------------- | --------- | ------------------------- |
| `observation_queue`                 | 885768192 | 163793 (161383 processed) |
| `memory_chunks_vec_vector_chunks00` | 45678592  | 29410                     |
| `memories`                          | 31248384  | 28067                     |
| `code_symbols_vec_vector_chunks00`  | 15753216  | 10202                     |

`observation_queue` is 84 % of the database. Oldest row 2026-06-01. This is
**out of scope here** — see _Scope boundary_ below.

## Root causes, ranked

### 1. Every message mounts a component instance (renderer)

> **Corrected 2026-09-06.** The first version of this section said the
> transcript has "no windowing" and cited
> `chat-transcript.component.ts:62` and `:270`. That was wrong, and the
> correction changes the fix. Both citations are inaccurate, and windowing of a
> kind already ships. The text below is the verified statement.

The transcript **already windows at the paint layer**.
`chat-transcript.component.css:39-42` applies `content-visibility: auto` with
`contain-intrinsic-size: auto 120px`, and `message-bubble.component.css:11-12`
does the same per bubble. `chat-transcript.component.ts:128-134` documents the
choice, and `:436-441` records that an autosize virtual-scroll estimator was
tried in this component and **removed**, because the scroll position oscillated.

`content-visibility` skips layout and paint. It does not free component
instances, DOM nodes, event bindings or parsed markdown. So the defect is not
"windowing is missing" — it is that **nothing ever unmounts**. Every message of
the tab holds a live `<ptah-message-bubble>` and its whole recursive execution
tree for the life of the window.

Two consequences follow, and both were missed by the original reading:

- Auto-collapse buys nothing. `message-bubble.component.html:91-99` collapses
  with a CSS grid `0fr`/`1fr` transition, deliberately **not** an `@if`
  (`message-bubble.component.ts:154-162`). A collapsed old message still
  instantiates everything.
- Tool payload **DOM** is already free. `tool-call-item.component.ts:75,116`
  does gate on `@if (!isCollapsed())`. So cause 2 below is about retained JS
  strings, not about rendered nodes. The two causes are independent.

The fix is therefore unmounting, and the existing CSS layer must be **kept**,
not replaced.

### 2. Finalized messages retain their full execution tree (renderer)

`MessageFinalizationService` attaches the accumulated `streamingState` to each
`ExecutionChatMessage` it produces
(`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:114, 133, 265`).
That tree carries the complete tool input and the complete tool output as
strings. A session that reads large files or runs large searches retains every
payload for the whole window life.

### 3. The bound already exists next door, and proves the shape

`libs/frontend/chat-streaming/src/lib/agent-output-retention.ts` bounds the
agent-monitor card: 50 KB of stdout, 500 segments, 2000 stream events. Each cap
folds what it drops back into what survives, or leaves a visible marker
(TASK_2026_323, TASK_2026_335). The tab transcript has no equivalent. Any cap
this task adds must obey the same rule: **a cap the user cannot see is
indistinguishable from data corruption.**

`ExecutionTreeBuilderService.pruneNodeMaps` already bounds the identity maps
(TASK_2026_327). Read it before touching the builder — the retained
`ExecutionNode` with its tool payloads was exactly that defect one level down.

### 4. Secondary, main process (1366 MB private)

Not the primary target. Contributors: the SQLite page cache over a 1.05 GB
file, the tree-sitter tree cache of 100 trees
(`tree-sitter-parser.service.ts:72`), the workspace file index, and up to
50 000 accumulated stream events per session
(`agent-process-manager-helpers.ts:124`). Measure before acting.

## Scope boundary

**In scope**: the renderer. Transcript virtualization, and a visible bound on
the `streamingState` retained by finalized messages.

**Out of scope, deliberately:**

1. **The 885 MB `observation_queue`.** It belongs to TASK_2026_331.
   `ObservationQueueStore.purgeOlderThan`
   (`libs/backend/memory-curator/src/lib/observation-queue.store.ts:650`) has
   zero production callers. TASK_2026_331 already carries this, and its Batch 2
   was cancelled on a mis-designed probe (recorded in TASK_2026_380's plan,
   evidence row 81). It should land **after** TASK_2026_380, because 380 builds
   the worker-process infrastructure
   (`persistence-sqlite/src/lib/integrity/worker-process.port.ts`,
   `integrity-worker.ts`, two host factories) that a batched purge should reuse
   rather than duplicate.

2. **`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`.** TASK_2026_380
   calls it "the single busiest file in the plan" and already routes two of its
   components through it. Do not add a third writer.

3. **The voice models.** `~/.ptah/models` holds 4.3 GB, including
   `Xenova/whisper-medium` at 2.9 GB. Voice is not enabled in the user's
   settings, so no voice worker is running. Note it; do not act on it here.

## Relationship to TASK_2026_380

Complementary. Zero file overlap — verified against 380's own CREATE/MODIFY
inventory (`implementation-plan.md:1618-1705`).

- 380 fixes the **main process at boot**: it moves `PRAGMA quick_check` into a
  worker, defers the skill boot scan, and gives the renderer a readiness signal.
- 381 fixes the **renderer in steady state**.

Two contact points, neither a conflict:

1. Both tasks touch the Nx project `@ptah-extension/chat`, at different files
   (380: `app-shell.component.html`, `electron-shell.component.ts`;
   381: the transcript folder). Separate worktrees keep the working trees
   disjoint. Merge is clean.
2. `libs/frontend/chat-ui/src/index.ts` is already contested inside 380
   (components 13 and 14e). **381 must not append to that barrel** unless it
   accepts a trivial merge resolution.

One dependency worth stating to the 380 session: 380's evidence row 83 concludes
that the renderer boot gate awaits no backend I/O, so "the freeze is entirely
post-shell-paint". A renderer at 2474 MB garbage-collects under pressure after
that paint. 380 makes the wait legible; 381 makes it shorter. 380's UX outcome
is partly gated on 381 landing.
