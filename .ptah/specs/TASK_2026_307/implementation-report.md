# TASK_2026_307 — Implementation Report

**Verdict:** Fixed and verified. `EPERM` and `EBUSY` are now absorbed per-entry;
`EACCES` is deliberately excluded with the reasoning recorded at the definition;
skip-and-continue was kept over retry, with the divergence from the
`harness-sync` precedent stated in the code.

**Files changed (2, both in `workspace-intelligence`):**

- `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.ts`
- `D:/projects/ptah-extension/libs/backend/workspace-intelligence/src/file-indexing/workspace-indexer.service.spec.ts`

Nothing in `harness-sync`, `libs/frontend/dashboard`, `libs/frontend/chat-ui` or
`apps/ptah-cli` was touched. `harness-sync/src/lib/quarantine/quarantine.ts` and
`harness-sync/src/lib/fs/windows-retry.ts` were READ as the stated precedent and
left unmodified.

---

## 1. The set: two codes added, and it was renamed

`MISSING_ENTRY_CODES` → **`UNREADABLE_ENTRY_CODES`**, now:

```ts
const UNREADABLE_ENTRY_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR', 'ELOOP', 'EPERM', 'EBUSY']);
```

The rename was required by the task and is also the honest name: the set is no
longer about absence. `EPERM` and `EBUSY` are locks — the entry is very much
there. Renamed with it, for the same reason:

| Before                  | After                      |
| ----------------------- | -------------------------- |
| `MISSING_ENTRY_CODES`   | `UNREADABLE_ENTRY_CODES`   |
| `isMissingEntryError()` | `isUnreadableEntryError()` |
| `skippedMissing` (×6)   | `skippedEntries`           |

All references were confined to this one file (verified by grep across the repo
before editing — the only other hits are `.ptah/specs/TASK_2026_306` and
`TASK_2026_307` prose, which is historical record and correctly keeps the old
name). No barrel export, no cross-lib reference, so the rename is local.

The `statOrNull` doc comment at the old `:156` that referenced
`{@link MISSING_ENTRY_CODES}` was updated to the new link and now names
TASK_2026_307 alongside 306.

## 2. The doc comment was rewritten, not appended to

This was the substantive part of the task. The old comment did not merely omit
`EPERM`/`EBUSY` — it contained the reasoning that **excluded** them:

> Codes NOT listed here (`EACCES`, `EMFILE`, `EIO`, …) describe the environment
> rather than the entry and are still propagated — "the whole index aborted" is
> the honest outcome for those.

The stated rule was "absence vs. environment", and under that rule a lock is
neither, so it fell out. The replacement states the rule as **scope**, which is
what the guard was actually always testing:

> A code belongs here when the condition it reports is a property of one
> directory entry at one moment, so that the very next entry, and this same
> entry on the next pass, may well succeed. A code stays out when the condition
> is a property of the process or the machine.

Windows locking is named explicitly, with the two codes broken out under their
own heading and prefixed **"This is the half the original set got wrong, so do
not re-remove these two"**, plus the concrete lock holders from the carrier
(editor, antivirus scanner, the running Electron host, the Claude CLI writing a
session file). It also records the reason this mattered so much in practice:
the workspace being indexed is by definition the one the user has open in an
editor, so a locked entry is the expected case, and because the lock is
transient the index emptied and the next pass silently succeeded with nothing
correlating the two.

## 3. `EACCES` — EXCLUDED, deliberately

**Decision: `EACCES` is NOT added.** The reasoning is written at the definition,
in its own paragraph, because the whole point is that the next reader must not
re-open it.

Three reasons, in order of weight:

1. **On Windows the two are not the same thing.** A transient sharing violation
   is `EPERM`/`EBUSY`. `EACCES` is a durable ACL decision about a path this
   process has no right to read — it will be just as true for the next entry and
   on the next pass. It fails the scope rule stated above.
2. **Absorbing it would reproduce this very defect one level down.** It would
   trade a permanent, actionable "you cannot read this tree" for a permanently
   and _silently_ partial index. The guard's own `reportSkipped` comment already
   says an index quietly missing 40% of a workspace is as useless as no index
   and just as invisible.
3. **The `harness-sync` divergence is smaller than it looks, and is stated.**
   `RETRYABLE_ERROR_CODES` is a **retry** list on a **destructive write**;
   `withWindowsRetry` retries `EACCES` three times and then **still fails that
   path**. It never decides the failure did not matter. Absorbing is the strictly
   stronger claim, and `EACCES` does not earn it. The comment says this in as
   many words so the two sets can disagree on the record rather than by accident.

`EMFILE` and `EIO` stay out under the same scope rule (process and device
respectively), and the comment names them.

## 4. Retry vs. skip — SKIP-AND-CONTINUE, and why

**Decision: no per-entry retry.** I read `quarantine.ts` and `windows-retry.ts`
first, as instructed. The retry machinery is right for quarantine and wrong
here, for reasons that are about the two call sites, not about Windows:

|                      | `withWindowsRetry` (quarantine)  | this indexer                         |
| -------------------- | -------------------------------- | ------------------------------------ |
| Operation            | one-shot destructive **move**    | read-only **stat**                   |
| Cost of losing       | the user's only undo of a repair | one file absent from a derived index |
| Recovery if it fails | none — the path is stuck         | free: the next pass rebuilds it      |
| Paths per run        | a handful the user ticked        | every file in the workspace          |

Two things follow. First, the recovery is already free — the file index is
derived and is rebuilt on every activation and every session preflight, so a
retry buys a marginally fresher index this pass and nothing durable. Second, the
cost scales the wrong way: quarantine pays `40ms + 80ms` over a handful of
consented paths, whereas here the backoff multiplies by the entry count. During
exactly the scenario that motivates the fix — an antivirus sweep locking many
files at once — a retry would turn a bounded walk into an unbounded one, which
is a worse outcome than the skip for the user staring at the progress bar.

This rationale is in the code, at the end of the same doc comment, so the
disagreement with the precedent is deliberate and documented rather than
apparently-overlooked. The skipped entries are not silent: they already flow
through `reportSkipped`, once per run with `{ workspaceFolder, skipped,
discovered }`.

The bounded `cause` walk at the old `:59-67` is **unchanged** — still
`for (let depth = 0; depth < 5 && current instanceof Error; depth++)`, still
matching on `code` and never on message text. Only the function name and the set
it consults changed.

## 5. Specs

Five new tests in a new `describe('Windows lock codes (TASK_2026_307)')`, plus a
fixture improvement. The pre-existing 306 block was left intact (I briefly split
it while editing, then folded it back — final structure is the original block
unchanged, then the new 307 block).

**Absorbed and continues past** — the locked entry is placed in the **middle** of
four, so "keeps indexing past it" is genuinely proven rather than being the last
entry:

- `absorbs a EPERM entry (...) and keeps indexing past it`
- `absorbs a EBUSY entry (...) and keeps indexing past it`

**Does not reduce the count of the others** — the carrier's explicit ask, run
against the non-streaming `indexWorkspace` sibling so both entry points are
covered:

- `does not reduce the indexed count of the others when one entry is EPERM`
- `... when one entry is EBUSY`

**The realistic shape** — a sweep locking several entries with the two codes
interleaved, asserting both the surviving yield order and that the run reports
`{ skipped: 2, discovered: 5 }` exactly once:

- `survives a mixed EPERM/EBUSY sweep and reports the skips once`

**The absorb did not become a swallow-everything** — the required negative. I
replaced the single pre-existing `EACCES` propagation test with a table over
three environment-level codes, asserting rejection on **both** entry points:

- `still aborts the run on EACCES | EMFILE | EIO, which is about the environment
not the entry`

Its doc block carries the `EACCES` decision so a reader who finds the test before
the definition still gets the reasoning.

**Fixture fix.** `statError()` hardcoded the cause message as
`"<code>: no such file or directory"` for every code. Only `code` is
load-bearing, but a fixture that spelled `EPERM` "no such file or directory"
would quietly teach the next reader that `EPERM` is an absence — the exact
misreading this task corrects. It now takes the real libuv detail per code from
an `ERRNO_DETAIL` map. (I also dropped the hardcoded `errno: -4058`, which was
`ENOENT`'s value being stamped onto every code; nothing reads it.)

## 6. Verification gate — actual output

**`npx nx run workspace-intelligence:typecheck`** — PASS

```
> tsc --noEmit --project libs/backend/workspace-intelligence/tsconfig.lib.json
NX   Successfully ran target typecheck for project @ptah-extension/workspace-intelligence
```

**`npx nx run workspace-intelligence:lint`** — PASS

```
✖ 13 problems (0 errors, 13 warnings)
NX   Successfully ran target lint for project @ptah-extension/workspace-intelligence
```

0 errors. All 13 warnings are pre-existing and in files I did not touch
(`ast/dependency-graph.service.ts`, `ast/tree-sitter-parser.service.ts`,
`autocomplete/agent-discovery.service.ts`,
`context-analysis/context-enrichment.service.ts`,
`diagnostics/type-script-diagnostics-provider.ts`,
`project-analysis/framework-detector.service.ts`,
`project-analysis/project-detector.service.ts`,
`services/file-system.service.ts`). Neither changed file appears in the list.

**`npx nx run workspace-intelligence:test`** — PASS

```
Test Suites: 37 passed, 37 total
Tests:       910 passed, 910 total
Time:        82.105 s
```

Note: `--testPathPattern=workspace-indexer` was not honoured by the target's
argument forwarding and the whole lib ran instead, which is the stronger result
and is the gate as specified.

### Mutation test (the carrier's explicit requirement)

The carrier asks that the spec go red if the code is removed from the set. I
removed **both** `'EPERM'` and `'EBUSY'`, re-ran the spec file, then reverted.

With the codes removed:

```
● WorkspaceIndexerService › Windows lock codes (TASK_2026_307) › absorbs a EPERM entry ... and keeps indexing past it
● WorkspaceIndexerService › Windows lock codes (TASK_2026_307) › absorbs a EBUSY entry ... and keeps indexing past it
● WorkspaceIndexerService › Windows lock codes (TASK_2026_307) › does not reduce the indexed count of the others when one entry is EPERM
● WorkspaceIndexerService › Windows lock codes (TASK_2026_307) › does not reduce the indexed count of the others when one entry is EBUSY
● WorkspaceIndexerService › Windows lock codes (TASK_2026_307) › survives a mixed EPERM/EBUSY sweep and reports the skips once
Test Suites: 1 failed, 1 total
Tests:       5 failed, 25 passed, 30 total
```

Exactly the 5 new tests fail and the other 25 — including the `EACCES`/`EMFILE`/
`EIO` abort table — stay green. That is the result worth having: it proves the
new specs are pinned to the two added codes specifically and are not passing
incidentally, and it proves the negative test is not coupled to the change.

After reverting (`--skip-nx-cache` to defeat the cache):

```
Test Suites: 1 passed, 1 total
Tests:       30 passed, 30 total
```

### Scope check

```
git diff --stat -- libs/backend/workspace-intelligence
 .../workspace-indexer.service.spec.ts              | 204 +++++++++++++++++++--
 .../src/file-indexing/workspace-indexer.service.ts |  94 +++++++---
 2 files changed, 257 insertions(+), 41 deletions(-)
```

No git operations performed — no `add`, no `commit`. The orchestrator handles
commits. Note the working tree also carries unrelated pre-existing changes from a
concurrent session (`harness-sync`, `rpc-handlers`, `libs/shared`); none of them
are mine and I did not stage anything.

## Architecture assessment

**Complexity Level 1 (KISS + YAGNI).** Two string literals in a `Set`, a rename,
and a comment that carries the reasoning. The signals for anything higher are
absent: one call site, one implementation, no new abstraction, no new
collaborator. The only real design decisions were the two judgement calls
(`EACCES`, retry-vs-skip), and the deliverable for both is a recorded rationale
at the definition rather than a mechanism. I explicitly rejected porting
`withWindowsRetry` here — copying the retry machinery would have been pattern
obsession, would have made a read-only walk unbounded under the exact conditions
it was meant to survive, and would have bought nothing durable over the next
scheduled pass.

## Residual risk

A file that is locked for the _entire_ lifetime of a pass is now silently
excluded from that pass's index rather than aborting it. That is the intended
trade and it is the correct one — a 99%-complete index beats an empty one — and
it is not silent in the log: `reportSkipped` emits a per-run `warn` with the
skipped and discovered counts. What it does not do is name the individual paths.
Adding that would mean either per-entry logging (rejected in the existing
`reportSkipped` comment as flooding output on a workspace with thousands of
stale entries) or accumulating a path list on a hot loop, and neither is
justified by this defect. Worth revisiting only if a skip count is ever observed
staying high across consecutive passes, which would indicate a durable lock
rather than the transient one this fix targets.
