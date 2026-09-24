# PR 583 Regen-Agents Fix Review — `TASK_2026_537`

Reviewer: cross-side (GLM CLI lane author). Round 1 of at most 2.
Commit reviewed: `4393f4370` (`fix(scripts): write regenerated agents atomically`).
Scope: `scripts/regen-agents.mjs` (the only source file the commit touches).

## Verdict

**PASS**

## What the commit does

```diff
-import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
+import { readFileSync, readdirSync } from 'node:fs';
 ...
+const { atomicWriteWithRetry } = await jiti.import(join(root, 'libs/backend/harness-sync/src/lib/fs/atomic-write.ts'));
 ...
-    let cur = null; try { cur = readFileSync(join(root, rel), 'utf8'); } catch {}
+    let cur = null; try { cur = readFileSync(join(root, rel), 'utf8'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
     ...
-        if (write) writeFileSync(join(root, rel), out);
+        if (write) atomicWriteWithRetry(join(root, rel), out);
```

## Point 1 — ENOENT-only catch (CodeRabbit comment 1)

`scripts/regen-agents.mjs:20` — the old bare `catch {}` swallowed every read
error (permission denied, EBUSY, a directory where a file was expected,
etc.), so an existing-but-unreadable file was treated the same as
"file does not exist" (`cur = null`), which lets it bypass the
`t.isPtahOutput(cur)` guard at line 22 and get silently overwritten (or
silently counted as `changed`/`WROTE` in `--write` mode) even though it is
plausibly a foreign file whose content the script never inspected.

The fix narrows the swallow to `error?.code === 'ENOENT'` (line 20) and
rethrows everything else, aborting the script instead of guessing. This is
correct: `ENOENT` is the only code that legitimately means "no current
output at this path," and the optional-chaining `error?.code` guards
against a non-Error throw without masking a real code. Confirmed by reading
libs/backend/harness-sync/src/lib/fs/atomic-write.ts and windows-retry.ts —
no behavioural coupling to this catch; it only affects the pre-write read.

No regression found: the ENOENT case (first run, no target file yet) is
exactly what the dry-run and `--write` runs below exercise, and both
completed with `0` changes because all target files already exist and
match — the catch's ENOENT branch was already implicitly proven safe in
past runs and is unchanged by this commit for that case.

## Point 2 — atomic write via `atomicWriteWithRetry` (CodeRabbit comment 2)

Read `libs/backend/harness-sync/src/lib/fs/atomic-write.ts` in full (lines
1-72) and `libs/backend/harness-sync/src/lib/fs/windows-retry.ts` in full
(lines 1-98) to verify the report's claims:

- **Synchronous, no await needed.** `atomicWriteWithRetry(path, content): void`
  (atomic-write.ts:50-53) calls only `withWindowsRetrySync` (three sync
  calls: `mkdirSync`, `writeFileSync`, `renameSync`), and
  `withWindowsRetrySync` (windows-retry.ts:86-98) uses `Atomics.wait` for
  its backoff sleep (windows-retry.ts:64-66), not `setTimeout`/`Promise`.
  There is no `async`/`Promise` anywhere in the call chain. The script
  correctly calls it as `atomicWriteWithRetry(join(root, rel), out)` at
  line 26 with no `await`, matching the sibling calls to
  `t.transform(...)` and the synchronous style of the rest of the loop.
  Confirmed at runtime too — `node scripts/regen-agents.mjs --write`
  printed `WROTE 0` synchronously with no unhandled-promise warning.

- **jiti loads it, including its imports.** `atomic-write.ts:27-29` imports
  only `node:fs`, `node:path`, and the sibling `./windows-retry` (which in
  turn imports nothing beyond built-ins). The dry run and `--write` run
  both completed without a module-resolution error, which is direct
  evidence `jiti.import(...)` at line 10 successfully resolves and
  transpiles both files (jiti already proved it can pull in relative
  siblings for the two existing transformer imports at lines 8-9, and this
  is the same pattern).

- **Missing-parent-directory behaviour is the same or better than before.**
  `atomic-write.ts:54` runs `withWindowsRetrySync(() => mkdirSync(dirname(path), { recursive: true }))`
  before ever touching the temp file. The prior code called
  `writeFileSync(join(root, rel), out)` directly with no `mkdir`, which
  would throw `ENOENT` if `rel`'s parent directory did not exist (e.g. a
  brand-new agent's first `.opencode/agents/` or `.codex/agents/` entry
  before that directory is created). The new path creates the parent
  directory unconditionally first, so the new-agent / new-directory case
  that used to throw now succeeds. This is a strict improvement, not a
  behavioural change that needs separate sign-off — the report's framing
  ("same or better") is accurate.

- **Error handling.** On failure of the temp write or rename,
  `atomic-write.ts:64-71` best-effort removes the temp file and rethrows
  the original error (per the module's own documented contract at
  atomic-write.ts:21-24: "THROWS on final failure rather than logging").
  `regen-agents.mjs` does not catch this, so a failed write still aborts
  the script with a stack trace — identical externally-visible behaviour
  to the old uncaught `writeFileSync` throw, just now preceded by up to
  three retried attempts (40ms/80ms backoff) for the Windows-transient
  codes (`EBUSY`, `EPERM`, `EACCES`, `ENOTEMPTY`) before giving up. No
  swallowed failure, no partial file left behind on the happy-exit path
  (rename is the last step), and a `--write` interruption mid-attempt
  leaves at most a stray `<path>.<pid>.<n>.tmp` file next to the target,
  never a half-written target itself — this is the atomicity property the
  commit set out to add.

Both claims in the author's report (`.ptah/specs/TASK_2026_537/pr-583-regen-lane-report.md:10`)
match what the code does; nothing overstated.

## Commands run (from worktree root)

```
> node scripts/regen-agents.mjs
WOULD CHANGE 0

> node scripts/regen-agents.mjs --write
WROTE 0

> git status --short
(empty — clean)
```

No `SKIPPED` line in either run. `git status --short` was empty after
`--write`, i.e. no unexpected mutation, no stray `.tmp` file left behind,
and no diff versus the committed state. This matches the expected output
in the task and confirms both `atomicWriteWithRetry` and the ENOENT-only
catch behave as no-ops when every target already matches its transform
output, which is the steady-state this script runs in on a clean tree.

## Residual scope not exercised

The dry run and write run both hit the "no changes" branch for every file,
so neither the `changed`/write path under `--write` nor the `skipped`
(foreign-file, non-ENOENT-throw) path was exercised live by these two
commands — only by static reading of the diff and the imported module.
That reading is unambiguous (the code changed is small, the swallowed
branch is a one-line conditional, and the write call is a straight
substitution of `writeFileSync` for `atomicWriteWithRetry` with matching
signatures), so this does not change the verdict, but it is worth noting
as the boundary of what was run versus what was read.

## Verdict detail

- Recommendation: **PASS**
- Confidence: HIGH
- Both CodeRabbit comments are answered correctly and narrowly, with no
  scope creep beyond `scripts/regen-agents.mjs`.
- No blocking or serious issues found.
