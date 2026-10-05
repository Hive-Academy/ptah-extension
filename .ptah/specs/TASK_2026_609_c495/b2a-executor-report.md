# Batch B-2a executor report — TASK_2026_609_c495

Executor: backend-developer (sub-agent). No git run. batches.md not edited.

## Files (exactly the three listed)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts`: marker validation, snapshot selection, list, restore.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`: facade methods `listQuarantinedAgents(workspaceRoot)` and `restoreQuarantinedAgent(workspaceRoot, slug)`, plus type re-exports.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts`: new specs. The existing specs are unchanged.

`git status --short` also lists the B-1 files (harness-sync and shared). They belong to the other executor and I did not touch them.

## Task B-2a.1: validated marker read and per-item state (`listQuarantinedAgents`). DONE

- `validateSeedQuarantineMarker(raw)` is a pure function. It checks that `version === 1`, that `completedAt` is a string whose `Date.parse` is finite, and that all three lists are arrays of strings. If any check fails, it returns `invalid`. The caller then treats the marker as absent and sets `recordUnreadable: true`. Unparseable JSON and a non-ENOENT read error take the same path. A missing marker gives `recordUnreadable: false`.
- The slug rule `isSafeAgentSlug` is a local copy of `SlugSchema`. It applies the same regex, max length 128, and no `..`, and it refuses `.` and `..` explicitly. There is no cross-lib import. A failing slug is dropped from its list on its own and reported once through `logger.warn('… unsafe slugs dropped', { droppedSlugs })`. Each logged value is JSON-quoted and truncated.
- Snapshot selection: `orderQuarantineSnapshotCandidates` is pure. It keeps `^\d+(-\d+)?$` names whose ms is ≤ `completedAtMs` and sorts them by ms and then by counter, newest first. `selectSnapshot` returns the first candidate that holds a regular `<slug>.md`, checked with `lstat().isFile()`. A missing history dir gives no snapshot. An unreadable one also gives no snapshot and logs a warning.
- States are derived on every call:
  - The item is dropped when the scoped clone `<scopedRoot>/<slug>.md` exists.
  - It is `source-restored` when `{ws}/.claude/agents/<slug>.md` exists.
  - Otherwise it is `quarantined`.
- `quarantinedAt` is the selected snapshot ms as ISO, or `null`. `notOwned` is the union of the validated `keptWithLocalWork` and `keptUnprovable` lists that are still present in the scoped root.
- The domain types (`QuarantinedAgentsListing`, `QuarantinedAgentItem`, `QuarantineRestoreResult`, …) stay in agent-generation and are re-exported from `user-layer-mirror.service.ts`.
- **Gap for B-2b:** these types are not yet exported from `libs/backend/agent-generation/src/index.ts`, which was outside my file list. B-2b can either add them there or infer them from the method return types.

## Task B-2a.2: `restoreQuarantinedAgent(slug)` under `withSlugLock('agent', slug)`. DONE

- **Lock:** the facade passes `(s, fn) => this.withSlugLock('agent', s, fn)`. An unsafe slug is refused as `not-quarantined` before it is joined into any path or takes a lock.
- **Restore order:**
  1. Read the validated marker. If the slug is not in `quarantined`, return `not-quarantined`.
  2. Select the snapshot. If there is none, return `no-snapshot` and write nothing.
  3. If the scoped clone exists, return `conflict`. The path is the clone.
  4. If `dest` exists and its bytes match, return `already-restored` with no write. If it exists with any other content or file type, return `conflict`.
  5. Copy:
     - Write the bytes to `.<slug>.md.ptah-restore-<random>.tmp` using flag `wx`, then verify them.
     - Hard-link the temp file to `dest` with `fs.link`.
     - If the link fails with `EEXIST`, check `dest` again: it is `already-restored` or `conflict`, and is never replaced.
     - If the link fails with `EPERM`, `ENOTSUP`, `EOPNOTSUPP` or `EXDEV`, fall back to `copyFile(tmp, dest, COPYFILE_EXCL)`. If that copy fails with anything other than EEXIST, remove the partial `dest` this call created.
     - Verify `dest`. On a mismatch, remove our own `dest` and return `copy-failed`.
     - The temp file is always unlinked in `finally`.
- **Logging:** `logger.info('[UserLayerMirror] quarantined agent restore', { slug, outcome, path, reason? })`.
- **What restore never does:** it never deletes or writes the snapshot or history. It does not import harness-sync and never calls `AgentSyncGate.enable`.
- **Workspace-root guard (my addition):** the facade rejects a non-absolute `workspaceRoot`. Without this, a relative root would resolve `dest` against the process working directory, and an empty root would address the flat base.

## Specs added (`user-layer-seed-quarantine.spec.ts`)

**Pure function tests**
- The marker validator accepts the written shape and rejects 9 wrong shapes, including a bad `completedAt`, a list given as a string, and a non-string entry.
- Unsafe slugs are dropped one by one: `..`, `.`, traversal, `/`, `\`, empty, and over 129 characters.
- `isSafeAgentSlug` follows the RPC slug rule.
- Candidate ordering puts later dirs and junk names after valid ones.

**Integration tests** (real filesystem; `homedir` redirected; `link` and `copyFile` pass through with one-off injected failures)
- With no marker, the list is empty and `recordUnreadable` is false.
- A wrong-shaped marker (three variants) gives an empty list with `recordUnreadable: true`, restore returns `not-quarantined`, and the scoped tree is byte-unchanged.
- The list shows the quarantined item with its snapshot ISO date, and `notOwned` contains the kept clone.
- An unsafe marker slug is dropped with a warning, and restoring it is refused with nothing written.
- With history missing, the item shows `hasSnapshot:false` and `quarantinedAt:null`, and restore returns `no-snapshot` with no source dir created.
- A later history dir is ignored: restore writes the quarantine bytes, not the later ones. A slug whose only history is later than `completedAt` returns `no-snapshot`.
- Restore copies the snapshot. History, the flat base and another workspace's scoped root stay byte-unchanged. The only change in the workspace is `dest`. The gate state stand-in `{ws}/.ptah/harness/state.json` is byte-unchanged. No temp file is left.
- While the gate is off or propagation has not run, the item stays `source-restored`. After a real `mirrorAll`, the clone exists again and the item leaves the list.
- A retry returns `already-restored` and makes no `link` call. Two concurrent restores serialise on the slug lock and return `restored` and `already-restored`.
- A conflict in the source (different bytes) or in the scoped root leaves both files unchanged.
- **Injected failures:**
  - A `link` failing with EIO gives `copy-failed`, leaves no `dest` and no temp file, and the retry restores.
  - A `link` failing with EPERM falls back to an exclusive copy and restores.
  - A fallback copy that writes wrong bytes is removed and returns `copy-failed`, and the retry restores.
  - A file that appears at `dest` during the restore (`link` throws EEXIST) gives `conflict`, and the user's file is kept.
- A slug from a kept list and an unknown slug are both refused as `not-quarantined`. A relative or empty workspace root is rejected.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation --skip-nx-cache`: Successfully ran targets typecheck, lint.
- `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2 --skip-nx-cache`: Test Suites 35 passed of 35; Tests 1192 passed and 1 skipped (pre-existing POSIX-only skip) of 1193.
- The spec file alone has 56 passed and 1 skipped.
- `eslint` on the three files reports 0 errors. Its one warning is `max-lines` on `user-layer-mirror.service.ts`, which was already over 700 lines before this batch; I added about 45 lines to it.
- Prettier is clean on the files I edited.
- No harness-sync import was added to agent-generation: grep finds no `import … harness-sync` in either source file.

## Risk handling

| Risk | How it was handled |
| --- | --- |
| PR3: partial `dest` or deleted user data | Temp file, then an exclusive `link`, with an EXCL copy fallback. Bytes are verified, `dest` is removed only when this call created it, and the temp file is always removed. Nothing ever overwrites or deletes the snapshot or the user's files. Injected failure and retry specs pass. |
| PR4: malformed marker or traversal slug | The marker is validated as a whole, and each slug is validated and dropped on its own with a warning. The restore entry refuses unsafe slugs before any path join. The RPC-side zod check is B-2b's job. |
| PR5: silent enable of agent-sync consent | No harness-sync import and no gate call. A spec asserts the workspace gate-state stand-in file is byte-unchanged and that `dest` is the only change in the workspace. The real `AgentSyncGate` state assertion belongs in the B-2b handler spec. |

Edge cases from the validation list that belong to B-2a:
- A wrong-shaped marker, an unparseable `completedAt`, a missing history dir and a later timestamp dir are all covered.
- A source that is restored while the gate is off is covered: the item is listed as `source-restored`, and no reconcile happens in this layer.
- A conflict in the source or in the scoped root is covered.

## Plan deviations

None in behaviour. Additions beyond the plan:
- The absolute-workspace-root guard.
- `EOPNOTSUPP` is treated like `ENOTSUP`, because on Linux they are the same errno.
- On a link race (`EEXIST` after the pre-check), `dest` is re-checked and the result is `already-restored` or `conflict`, never a replace.

## Out-of-scope observations

- `libs/backend/agent-generation/src/index.ts` does not export the new result types. Left for B-2b.
- `user-layer-mirror.service.ts` was already over the 700-line `max-lines` warning before this batch.
