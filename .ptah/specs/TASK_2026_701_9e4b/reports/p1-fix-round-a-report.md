# P1 fix round A — `TASK_2026_701_9e4b`

Source: `reviews/p1-code-logic-review-a.md` (findings A1–A4). All four are fixed in
`libs/backend/harness-sync/` only. `libs/shared/` was not changed.

## A1 (Serious): a Claude apply overwrote a save made after planning

**What changed**

- `targets/artifact-retirement.ts:186-298`: new shared `prepareOwnedOverwrite()` with an
  `OverwriteGate` result (`publish` | `kept-local-edit` | `failed`). It runs `detachForOverwrite`,
  then `restoreDetachedEdit` and `discardRestoredSnapshot`, and it exports `publishFailureReason`.
  The helpers moved here unchanged from `workspace-target.ts`, so both targets use one guarded
  path and the code is not copied.
- `targets/workspace-target.ts` (`applyWrite`): now calls `prepareOwnedOverwrite`. The behaviour
  is the same. About 70 lines of duplicated helpers and unused imports were removed.
- `targets/claude-target.ts:405-470`: new `applyWrite`. When the plan says `update` and the path
  is owned, it detaches the copy and decides on it there:
  - Ptah's own bytes are discarded.
  - An edit saved after the plan is put back and reported in `keptLocalEdit`. Nothing goes into
    `written`, so the manifest keeps the old ownership hash.
  - Every publish (update or create) is an exclusive create, so a path that became occupied after
    planning gets `writeFailed` with the EEXIST reason and is never touched.
- `targets/copy-engine.ts` (`copyDirectory`): always exclusive now (non-recursive `mkdir`, no
  `rm -r`). Its only caller is the Claude target, so the replace mode was dead code and was
  removed.

**Regression tests**: `targets/claude-target.overwrite-detach.spec.ts` (new, 5 cases). Each case
edits the workspace between `plan` and `apply`:

- an ordinary update still replaces the copy and leaves no history behind;
- a command saved late is kept, with its old hash preserved;
- a skill directory edited late is kept with every file;
- a command created at a path the plan saw vacant is kept (`writeFailed` EEXIST);
- a skill directory created at a vacant path is neither deleted nor written into.

## A2 (Serious): repair reported `repaired` without evidence of an installed copy

**What changed**: `repair/blocked-repair.service.ts`

- `settle` (`:317-355`) now runs entirely under the workspace lock. A path counts as `repaired`
  only when both checks below pass.
  1. `passDisproves()` (`:486`) finds nothing wrong in the pass report. A path is ruled out when:
     - the health is null;
     - the target is absent or not detected;
     - there is a target-wide `(target)` failure or a write failure at that path;
     - the path is in `missing`, `keptLocalEdit` or `foreign`.
  2. `managedCopyAbsent()` (`:358`) finds the copy installed after a fresh read of the target's
     manifest and the disk. The manifest must own the path, the path must not be a link, and the
     current `hashDir`/`hashFile` must equal the recorded entry hash.
- Any other outcome goes through the existing non-destructive `restoreFromQuarantine` and is
  logged with the reason.
- `missingByTarget` was removed.
- The constructor gains a `ManagedManifestStore`, wired in `di/register.ts`.
- The `'(target)'` literal is now `TARGET_WIDE_FAILURE` in `health/harness-health.ts:26`, used by
  the reconciler and the repair.

**Regression tests**: `repair/blocked-repair.service.spec.ts`, new describe block "reports
repaired only on positive evidence…" (4 cases):

- a target-wide failure with `missing: []` restores the original;
- a target the pass did not detect restores the original;
- a pass report that looks clean but has no copy on disk restores the original (this is what
  pins the fresh manifest and disk check);
- a different save that replaces the managed copy during the pass restores the original, and the
  raced save is moved aside (`supersededPath` is logged and its content checked), not deleted.

## A3 (Serious): the approval probe accepted incomplete directory hashes

**What changed**

- New `health/approval-fingerprint.ts` with `approvalFingerprint()` (`:56`). It is a strict
  consent proof, kept separate from the permissive sync hash:
  - It visits every entry, including the names the sync hash ignores (`.history`, `_candidates`,
    `.ptah-origin.json`), because the move takes those too.
  - A link below the root contributes its target string.
  - It returns `null` for an unlistable directory, an unreadable file, depth past `MAX_DEPTH`, or
    an unsupported node type. It never produces a sentinel digest.
- `health/harness-destination-scanner.ts` (`probeDestination`, `:115`):
  - `digest` is now this fingerprint. It is the value the scanner hands out and the value the
    repair re-checks under the lock.
  - A new `contentHash` (`hashDir`/`hashFile`) is used only to classify a path as
    owned-unmodified or owned-edited.
  - A path with no fingerprint reads as `unreadable` with `digest: null`, so it cannot be
    approved.
- The repair's gate at `blocked-repair.service.ts` (moveOccupants) did not change. It now
  compares the strict digest.

**Regression tests**

- `health/approval-fingerprint.spec.ts` (new): an unlistable empty descendant gives `null` while
  `hashDir` is unchanged; an unreadable file gives `null`; entries the sync hash ignores are
  covered; the result is stable when nothing changes; an absent path gives `null`.
- `health/harness-destination-scanner.spec.ts`: a new case where an unlistable empty descendant
  reports `unreadable` with no digest. The existing digest assertions now expect the fingerprint.
- `repair/blocked-repair.service.spec.ts`: "keeps a path whose empty descendant directory became
  unlistable since approval". This adds a `readdir` failure switch to the existing `fs/promises`
  mock.

## A4 (Moderate): delete and recreate with identical bytes bypassed the change check

**What changed**: the same fingerprint binds object identity as well as content. Each entry
contributes `dev:ino:birthtimeNs:ctimeNs`, read with `lstat({ bigint: true })` so a 64-bit NTFS
file id is never rounded. The approval is still re-checked under the mutation lock in
`moveOccupants`.

**Identity guarantees across platforms** (documented in the module header):

- `ino` is stable on NTFS and ReFS (file index) and on ext4, xfs, btrfs, APFS and HFS+.
- `birthtime` is added where the platform reports one.
- `ctime` covers a POSIX filesystem that reuses a freed inode number at once.
- A filesystem that reports neither an inode nor a birth time gives no fingerprint, so the path
  cannot be approved. This fails safe.

**Regression tests**

- `approval-fingerprint.spec.ts`: a file inside a skill, deleted and recreated with identical
  bytes, changes the fingerprint (the content hash does not); a single-file path recreated the
  same way also changes it.
- `blocked-repair.service.spec.ts`: "keeps a path deleted and recreated with IDENTICAL bytes since
  approval". The outcome is `changed-since-approval`, no pass runs and nothing is quarantined.

## Verification

`npm run verify -- -p @ptah-extension/harness-sync -- --output-style=static` passed:

- `Successfully ran targets lint, test, typecheck for project @ptah-extension/harness-sync`
- Tests: 60 suites and 604 tests passed (the earlier run had 5 failures in the new Claude spec
  from a missing source directory in its own setup; that was fixed).
- Lint: 0 errors. 5 warnings were already there before this round; `workspace-target.ts`
  `max-lines` dropped to 753 because this round moved helpers out of it.
- No stray `%TEMP%\.claude` / `%TEMP%\.ptah` marker failures were seen.

## Decisions

- **A disagreement with the review's literal wording:** the review asked to "preserve the old
  ownership hash when keeping an edit". That is achieved structurally: a kept path never enters
  `written`, so `mergeEntries(plan.baseEntries, written, …)` keeps the old entry. The test asserts
  the base entry's hash rather than adding a new mechanism. This can be reversed.
- `HarnessDestination.digest` keeps its name but now holds the approval fingerprint, not a content
  hash. No production code reads it yet. The only uses are the repair and specs; `grep` found no
  consumer in `apps/`, `agent-generation` or `rpc-handlers`. A caller that wrongly passed a
  content hash as `expectedDigest` would always get `changed-since-approval`, which is the safe
  direction. This can be reversed.
- Editor saves that rename a new file over the old one (new identity, same bytes) count as a
  change since approval. That direction is deliberate and documented.
- `ctime` is part of identity, so a `chmod` after approval also counts as a change. This is the
  conservative choice.

## Out-of-scope observations

- `libs/shared/src/lib/types/harness-sync.types.ts:527-528`: the `expectedDigest` doc comment
  still says "`hashFile` for a file, `hashDir` for a skill directory". It should now read "the
  approval fingerprint from the destination scanner (`probeDestination().digest`)". This is
  comment-only, so it was not changed here under the shared-lib ownership rule.
- The Claude target's REMOVAL path (`claude-target.ts` apply → `removeManaged`) still deletes an
  owned skill or command with no detach. The workspace target uses `retireOwnedArtifact` for
  this. It is outside A1, which covers writes, but it is the same class of late-edit loss.
