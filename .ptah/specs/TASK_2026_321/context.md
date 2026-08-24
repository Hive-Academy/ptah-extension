# Context — TASK_2026_321

## Where this came from

Finding C6 of TASK_2026_315, originally batched with the Electron boot-ordering
work because three findings all touched `wire-runtime.ts`. Split out by user
decision partway through: a concurrent session was editing roughly 24 files
under `libs/backend/harness-sync/**`, including `harness-reconciler.service.ts`
and most of its spec suite, and two sessions editing one reconciler would have
meant merge pain and a plausible lost edit.

The full original specification is preserved verbatim in
`.ptah/specs/TASK_2026_315/tasks.md` under Task 4.4. Recorded as F7 in that
task's `follow-ups.md`.

**Check that the concurrent session's harness-sync work has landed before
starting.**

## The observation

From `tmp/logs/log.log`, two passes back to back:

- `:654-655` — `reason: activation`, `mode: full`, `expected: 119`,
  `found: 106`, `missing: 13`, `foreign: 19`, `blocked: 13`
- `:661-663` — `reason: content-download-complete`, byte-identical counts and
  the same thirteen `.claude/skills/*` paths

Both payloads enumerate all thirteen paths in full, with the same explanatory
`note` and `action` text.

## What must NOT change

This is the important half of the task.

The refusal is **correct**. A path occupied by a file Ptah cannot prove it wrote
is counted in `missing` (the artifact is not installed) and in `foreign` (Ptah
will not touch it), and never enters the write plan — which is why `writeFailed`
can never report one. That design is deliberate and load-bearing: the occupant
may be the user's own work.

The second pass is also **legitimate** — it is a genuine re-run after content
download completes, and it must keep running.

So the only question is: when the blocked set is identical to the pass before
it, does the second emission need to repeat the entire payload?

Specifically preserve:

- `blockedReason()` (`:775`) unchanged in behaviour
- the `full`-only guard (`:725`) unchanged
- a second pass with a **changed** blocked set still reporting in full
- the same list still reaching the Dashboard's "Your harness is short" card and
  `ptah harness doctor`

## Acceptance

- Two identical passes produce one full payload, not two.
- A second pass whose blocked set differs — even by one path — reports fully.
- `harness-reconciler.blocked-logging.spec.ts` still passes, extended to pin
  the identical-set suppression.
- Behaviour of the reconciler itself is unchanged; this is a logging change.

## Out of scope

- Resolving the thirteen blocked paths on any particular machine. That is a
  data condition, not a code defect. The user's own `.claude/skills/*`
  directories are theirs.
- The VS Code twin (`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:77`)
  unless shared code forces it — and say so if it does.
- Anything about the refusal rule itself.

## Related, if you are in this lib anyway

`TASK_2026_318` (F12) concerns `CodeExecutionMCP` writing `.mcp.json` outside
`withMcpConfigLock` — the second-writer pattern harness-sync's own design note
forbids. Whoever picks this up will already have the lock and the reconciler
loaded in context and is well placed to take that one too.

## Verification note

`npx nx test projA projB projC` silently runs only the FIRST project and exits 0. Use `npx nx run-many -t test -p projA projB projC`. Confirmed independently
by two agents during TASK_2026_315.
