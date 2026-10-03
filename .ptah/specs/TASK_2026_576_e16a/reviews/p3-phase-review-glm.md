# Code Logic Review — `TASK_2026_576_e16a` (P3, part 1)

Review of `git diff origin/feat/task-2026-576-p2...HEAD`, excluding
`text-diff-view.component.ts`(+spec) and `diff-renderer.ts` (reviewed separately).
Batches in scope: 20 (eager-bundle guard), 21 (git-ui/services entry), 22
(@pierre/diffs host + hunk mapping), 25 (change-set types + numstat reader),
26 (recorder + store), 27 (`git:turnChangeSets` RPC + DI), 28 (`ptah.review.*`
commands + HEAD content provider).

Read-only review: no source files were edited, no state-changing git commands
were run.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | NEEDS_REVISION (verdict: REVISE)     |
| Blocking issues     | 0                                    |
| Serious issues      | 2                                    |
| Moderate issues     | 3                                    |
| Minor issues        | 4                                    |
| Failure modes found | 9                                    |

### Findings table

| # | Severity | Finding | Evidence |
| - | -------- | ------- | -------- |
| 1 | Serious | A file the turn committed (untracked at baseline, clean at turn end) is recorded with status `D` — "Deleted" — though it exists and is in HEAD | `turn-change-set-recorder.service.ts:408-413` |
| 2 | Serious | Change-set paths are repository-relative but `ptah.review.*` resolves them against the workspace folder; when the folder is a repo subfolder, the commands open wrong nonexistent paths that pass containment, then serve empty sides / "does not exist at HEAD" — a silent wrong answer, not a refusal | `review-commands.ts:239,254-257`; `ptah-git-head-content-provider.ts:53`; `git-info.service.ts:1322-1326` |
| 3 | Moderate | `openChanges` fallback and entry-building loops are all-or-nothing: one failing file aborts the whole command, valid files never open | `review-commands.ts:106-108,123-126` |
| 4 | Moderate | `ptah-git-head:` URIs pin a workspace-folder *index*, resolved against live `workspaceFolders` at render time; folder reorder/removal after open silently serves another folder's HEAD content (or the "no longer open" line) | `ptah-git-head-content-provider.ts:84-89`; `review-commands.ts:197,205` |
| 5 | Moderate | A multi-file patch (`file-count` mapping error) shows "Hunk actions are unavailable for this file." while nothing at all is rendered | `pierre-diff-host.component.ts:80-91,263-270` |
| 6 | Minor | Eager-bundle guard's static-import regex misses query-suffixed `.js?…` imports; such a forbidden module would escape the closure walk | `assert-eager-bundle.mjs:64,77` |
| 7 | Minor | Untracked line counts resolve repository-root-relative paths against the workspace path — wrong counts when the workspace is a repo subfolder (documented deviation, batch 25 Outcome) | `git-change-set-numstat.reader.ts:39-42,109`; `git-info.service.ts:813` |
| 8 | Minor | SHA-256 repository on an unborn branch: the SHA-1 empty-tree stand-in is rejected by git, so all counts are null (`countsUnavailable`), not just untracked ones (documented deviation, batch 25 Outcome) | `git-change-set-numstat.reader.ts:16,125-133` |
| 9 | Minor | Store's shape filter silently discards a stored record that fails the guard, and the next append persists the list without it — history loss is invisible | `turn-change-set.store.ts:99-105,82-92` |

## Five logic questions

### 1. How does this fail silently?

- **Committed file shown as Deleted.** `diffSnapshots` maps any baseline path
  missing from the after-status to `status: then.status === 'A' ? 'D' : 'M'`
  (`turn-change-set-recorder.service.ts:408-413`). An untracked file
  (`statusOf` maps `??` → `'A'`, `:443`) that the turn *commits* disappears
  from `git status` the same way a deleted one does, so the change-set card
  reports the file as Deleted. Nothing distinguishes the two states: no disk
  presence check, no HEAD membership check. Agents commit routinely, so this
  is a wrong card on a common path, with no error anywhere.
- **Repo-subfolder review commands open wrong paths without refusing.**
  Change-set `files[].path` values come from `git status --porcelain=v2 -z`
  (root-relative; `git-info.service.ts:80-81` `STATUS_Z`, no `--relative`).
  `containedPath` resolves them with `path.resolve(root.root, candidate)`
  (`review-commands.ts:239`) — the *workspace folder*, not the repository
  root. When the folder is a repo subfolder, the result is a nonexistent
  `folder + repo-relative` path. The lexical containment check passes by
  construction, and `realNearestAncestor` finds an existing ancestor under
  the root (the folder itself), so the symlink containment check also passes
  (`:247-250`) — the wrong path is returned, not refused. The diff then
  shows an empty right side, and the left side reads the wrong
  folder-relative path through `readHeadText`
  (`ptah-git-head-content-provider.ts:53`, `git-info.service.ts:1322-1326`,
  which validates but does not rebase the path), yielding
  "This file does not exist at HEAD." (`ptah-git-head-content-provider.ts:97`)
  for a file that does exist at HEAD. Every step succeeds; the user sees
  wrong content.
- **Stale folderIndex in HEAD URIs.** `toGitHeadUri` encodes
  `root=<folderIndex>` (`review-commands.ts:197,205` →
  `ptah-git-head-content-provider.ts:29-34`); `resolveTarget` reads
  `workspaceFolders[Number(rawIndex)]` at render time
  (`:84-89`). VS Code can re-request document content later (window reload
  with restored editors, revert). After folders are reordered or one is
  added above, the index resolves to a different folder and the provider
  serves that folder's HEAD content for the path, or the explanatory
  "no longer open" line — silently.
- **Store drops malformed records on append.** `readChangeSets` filters with
  `isTurnChangeSet` (`turn-change-set.store.ts:99-118`); `write` re-reads the
  same list and persists it (`:82-92`), so a record that fails the guard is
  removed from storage by the next append with no log.

### 2. What user action produces unexpected behaviour?

- The user asks the agent to commit its work. The turn's change-set card then
  lists every committed-untracked file as Deleted (finding 1).
- The user opens a repository subfolder as the workspace folder (or one folder
  of a multi-root workspace is a repo subfolder) and clicks a change-set
  card's review action. Files open at wrong paths; diff sides are empty or
  show "does not exist at HEAD" (finding 2).
- In a multi-root workspace the user reorders folders (drag), adds a folder,
  or removes one, while a `ptah-git-head:` diff editor is open. A later
  re-render resolves the URI against the changed list (finding 4).
- The user triggers `ptah.review.openChanges` for a turn that touched one file
  outside the workspace (e.g. a path the webview crafted, or a stale
  change-set after the folder moved). `toEntry` throws on that file at
  `review-commands.ts:106-108`, so no file opens at all, and the error is
  the generic `Path is outside the workspace.` (finding 3).

### 3. What input data makes this produce a wrong answer rather than an error?

- A rename whose `origPath` was itself untracked-then-committed during the
  turn: the disappeared origPath is reported `M` (`:412` else-branch) even
  though it was added and committed, inflating the file list with a phantom
  modification.
- A patch input with more than one file to `PierreDiffHostComponent`
  (`pierre-diff-host.component.ts:263-270`): returns `file-count` error and
  the message shown is "Hunk actions are unavailable for this file."
  (`:86-90`) — the diff is not rendered at all, and the message describes a
  different (milder) state.
- Workspace state under `ptah.turnChangeSets:<id>` written by an older schema
  or truncated by a hard exit: the RPC returns `[]` (treated as "no
  history", `git-change-set-rpc.handlers.ts:56`) — indistinguishable from
  the honest empty case, though the handler's own comment demands the two
  stay distinct for *read failures*. Storage-level corruption is folded
  into "no history".
- A `ptah-git-head:` URI whose query index is `042`-style with leading
  zeros, or huge: `/^\d+$/` accepts them and `Number()` maps to a valid
  folder for `042` — benign; a huge index maps to `undefined` → the
  explanatory line. Acceptable.

### 4. What happens when a dependency fails?

- **`getGitInfo` fails at turn end** → `unavailable` snapshot → warn, no
  change set recorded (`turn-change-set-recorder.service.ts:208-215`). The
  turn is silently absent from history — acceptable per the design note, and
  logged.
- **Baseline git read fails at prompt submit** → baseline snapshot is
  `unavailable`, so `baselineSnapshot?.kind !== 'ok'` → `baselineMissing:
  true` and `files` is *every* dirty file (`:217-231`). Documented
  behaviour; the card flags it. OK.
- **`store.append` fails** → warn, broadcast still runs (`:233-242`) — the
  live card shows but is lost on session reopen. Deliberate and commented.
  Sound.
- **`readChangeSetNumstat` / git fails** → every path keeps `null` counts,
  `countsUnavailable: true` (`git-change-set-numstat.reader.ts:77-121`);
  the card shows "counts unavailable", never zeros. Verified: the catch
  path warns and returns partials.
- **`vscode.changes` unavailable** → per-file fallback (`review-commands.ts:118-126`),
  but see finding 3: the first failing `openEntry` aborts the remaining
  files.
- **`broadcastMessage` fails** → warn only (`:245-252`). Fire-and-forget is
  observable in the log. Acceptable for a push.
- **Dependency ordering** — verified, not a failure: `TOKENS.GIT_INFO_SERVICE`
  is registered before `activateSessionLifecycleNotifier` (which now resolves
  the recorder, which injects GIT_INFO_SERVICE) in all three hosts: VS Code
  `phase-3-handlers.ts:62` before `:92-93`; Electron `bootstrap.ts:230`
  (`ElectronDIContainer.setup` → `phase-4-handlers.ts:118`) before
  `bootstrap.ts:397`; CLI `container.ts:259` before `:830`.

### 5. What is missing that the requirements never mentioned?

- No distinction between "committed" and "deleted" for disappeared paths
  (finding 1) — the requirement says "files one agent turn changed"; a
  commit is a change the turn made, and the current mapping reports its
  opposite.
- No stability guarantee for the HEAD-side URI across workspace-folder
  changes (finding 4) — nothing in the requirements, but a diff editor that
  survives reload must not silently change meaning.
- The `Stop`/`StopFailure` double-fire question: the SDK emits `turnEnded`
  from the Stop hook and `turnFailed` from StopFailure
  (`stop-hook-handler.ts:105`, `stop-failure-hook-handler.ts:92`) — one
  terminal hook per turn end, so no duplicate change set. If both ever fired,
  the second would find the baseline already deleted
  (`turn-change-set-recorder.service.ts:186-188`) and record a second,
  `baselineMissing` change set for the same turn. Residual uncertainty: the
  SDK's hook contract is not verifiable inside this repository; no guard
  (e.g. a per-session in-flight flag) exists against it.
- `openScm` has no workspace validation at all (`review-commands.ts:165-167`)
  — it only opens a view, so nothing to validate. OK.

## Failure modes

### FM1 — Committed-untracked file reported as Deleted

- Trigger: a path untracked at baseline (`statusOf` → `'A'`) that the turn
  commits, so it vanishes from `git status`.
- Symptom: the change-set card lists the file as Deleted; a user who trusts
  it may restore or investigate a deletion that never happened.
- Evidence: `turn-change-set-recorder.service.ts:408-413` (else-branch of the
  disappeared-path loop), `:436-444` (`??` → `'A'`).
- Current handling: none — the comment at `:410-411` asserts "a file the turn
  added is now deleted", which is only one of the two states that produce
  this signature.
- Recommendation: at turn end, for disappeared `'A'` paths, distinguish by
  disk presence (`fs.stat`) and/or `git cat-file -e HEAD:<path>`: absent on
  disk → `D`; present (and now in HEAD) → keep `'A'` — the turn added it to
  the repository. Severity: Serious.

### FM2 — Repo-subfolder workspace resolves change-set paths against the wrong base

- Trigger: workspace folder is a repository subfolder; the user opens any
  review action from a change-set card.
- Symptom: `ptah.review.openDiff`/`openChanges` open nonexistent paths;
  right side empty, left side shows "This file does not exist at HEAD."
  for a file that exists. No error, no refusal.
- Evidence: `review-commands.ts:239` (`path.resolve(root.root, candidate)`),
  `:254-257` (folder-relative `relativePath` passed onward);
  `ptah-git-head-content-provider.ts:53` feeding
  `git-info.service.ts:1322-1326` (`readHeadText` expects a
  repository-relative path — `git show HEAD:<path>` is repo-root relative).
  Batch 28's Outcome documents the `readHeadText` half of this; the
  containment-pass-instead-of-refuse half is not documented.
- Current handling: containment succeeds because the wrong path is lexically
  under the folder and its nearest existing ancestor is the folder itself
  (`review-commands.ts:247-250`).
- Recommendation: make the review flow repo-aware — resolve the repository
  root once (e.g. `git rev-parse --show-toplevel`) and rebase change-set
  paths against it before containment and HEAD reads, or store
  folder-relative paths in `TurnChangeSetFile.path` alongside the existing
  repo-relative ones. Severity: Serious (silent wrong answer in a supported
  configuration).

### FM3 — One bad file aborts the whole review command

- Trigger: any entry in `files` whose `toEntry`/`openEntry` throws (path
  outside the workspace, an editor command rejecting) while other entries
  are valid.
- Symptom: `openChanges` throws from the loop at `:106-108` before opening
  anything; the fallback loop at `:123-126` aborts on the first failing
  `openEntry`, leaving the remaining diffs unopened.
- Evidence: `review-commands.ts:106-108,123-126`.
- Current handling: the error propagates to `command:execute` — visible, but
  the partial-open behaviour a 500-file list warrants is absent.
- Recommendation: validate/open per entry inside try/catch, continue on
  failure, and surface a count of failed entries. Severity: Moderate.

### FM4 — HEAD-side URI pins a folder index, not the folder

- Trigger: the URI is minted (`review-commands.ts:197,205`), then
  `workspaceFolders` changes order or membership before a later content
  re-request.
- Symptom: the provider serves a different folder's HEAD content (wrong
  file content, no warning) or the "no longer open" line.
- Evidence: `ptah-git-head-content-provider.ts:29-34,84-89`.
- Current handling: none; index-based resolution is live at every render.
- Recommendation: encode a folder identifier that survives reordering —
  e.g. the folder's URI string in the query, matched against the live list
  (still without leaking paths into error messages), or re-resolve through
  the same `validateRoot` used at open time. Severity: Moderate.

### FM5 — `file-count` mapping error shows the wrong message

- Trigger: a patch describing more than one file (or zero) reaches the
  host component.
- Symptom: the note reads "Hunk actions are unavailable for this file."
  while the diff itself is not rendered — the message describes the
  read-only fallback, implying the diff is visible.
- Evidence: `pierre-diff-host.component.ts:86-90` (template ternary covers
  only `parse-failed`), `:263-270` (`files.length !== 1` → `file-count`).
- Current handling: the state is correctly terminal and no guessing happens;
  only the message is wrong.
- Recommendation: a third branch for `file-count` ("This diff could not be
  displayed." or a dedicated line naming the file count). Severity: Moderate.

### FM6 — Eager-bundle guard misses query-suffixed imports

- Trigger: a module in the eager graph imports `./x.js?raw` (or any
  `.js?query`).
- Symptom: the import is absent from the static closure walk, so a forbidden
  marker reachable only through it is never reported.
- Evidence: `assert-eager-bundle.mjs:64`
  (`/(?:\bfrom\s*|\bimport\s*)["']([^"']+\.js)["']/g`), `:77`.
- Current handling: none; the Angular esbuild output does not emit
  query-suffixed imports today, so this is a guard-robustness gap, not a
  live leak.
- Recommendation: broaden the capture to `([^"']+\.js(?:\?[^"']*)?)`. Severity:
  Minor.

### FM7 — Untracked counts wrong in a repo-subfolder workspace

- Trigger: an untracked changed path in a workspace that is a repo
  subfolder.
- Symptom: `readUntrackedNumstat(workspacePath, relativePath)` resolves the
  repo-root-relative path against the workspace path → the file is not
  found → null counts → "counts unavailable" (or a wrong file's counts).
- Evidence: `git-change-set-numstat.reader.ts:39-42,108-110`;
  `git-info.service.ts:813`. Documented deviation (batch 25 Outcome).
- Current handling: degrades to `countsUnavailable`, never wrong-zero.
- Recommendation: rebase the path with `--show-toplevel` before the read, or
  accept and keep documenting. Severity: Minor (documented).

### FM8 — SHA-256 repository on unborn HEAD gets no counts

- Trigger: a SHA-256 repository with no commits.
- Symptom: `git diff --numstat <SHA-1 empty tree>` fails → all counts null →
  `countsUnavailable: true`.
- Evidence: `git-change-set-numstat.reader.ts:16,125-133,141-161`.
- Current handling: graceful degradation, documented (batch 25 Outcome).
- Recommendation: use `git hash-object -t tree /dev/null` computed at runtime
  (hashes with the repo's algorithm) instead of the constant. Severity:
  Minor (documented).

### FM9 — Store silently drops guard-failing records on append

- Trigger: a stored change-set record that fails `isTurnChangeSet` (partial
  write after a hard exit, manual edit).
- Symptom: `list` filters it out; the next `append` persists the filtered
  list, permanently removing it. No log at the moment of drop.
- Evidence: `turn-change-set.store.ts:99-105` (filter), `:82-92`
  (read-modify-write).
- Current handling: shape validation treats unknown data as absent — the
  right call for reads; the destructive side effect is on the next write.
- Recommendation: count and warn on dropped records, or leave stored bytes
  untouched until a schema migration explicitly rewrites them. Severity:
  Minor.

## Blocking issues

None. No data loss beyond the store's documented bounds, no security
boundary breach, no corruption path found.

## Serious issues

### S1 — Committed-untracked file recorded as `D` ("Deleted")

- File: `libs/backend/rpc-handlers/src/lib/chat/change-set/turn-change-set-recorder.service.ts:408-413`
- Scenario: the agent commits a file it created during the turn (a routine
  agent action) — the file was `A` at baseline and absent from status at turn
  end.
- Impact: every user reading the turn's change-set card is told the file was
  deleted. The card is the feature's primary output; this is a wrong answer
  on a likely path, produced silently.
- Fix: see FM1 — distinguish commit (present on disk / in HEAD) from delete
  (absent on disk) for disappeared `'A'` paths.

### S2 — Review commands resolve repository-relative paths against the workspace folder

- File: `apps/ptah-extension-vscode/src/commands/review-commands.ts:239,254-257`
  (with `apps/ptah-extension-vscode/src/commands/ptah-git-head-content-provider.ts:53`
  and `libs/backend/vscode-core/src/services/git-info.service.ts:1322-1326`)
- Scenario: workspace folder is a repository subfolder; the user opens a
  change-set card's review action.
- Impact: wrong absolute paths that *pass* both containment checks (lexical
  and symlink-resolved) because they sit under the folder by construction;
  the user gets empty diff sides and "This file does not exist at HEAD."
  instead of either the real file or an error. The security check gives false
  assurance here — it validates the wrong path.
- Fix: see FM2 — resolve the repository root once and rebase change-set paths
  onto it before containment and HEAD reads (or carry folder-relative paths
  in the stored change set).

## Moderate and minor issues

- M1 — `openChanges` all-or-nothing entry and fallback loops
  (`review-commands.ts:106-108,123-126`). See FM3.
- M2 — HEAD URI pins a live-resolved folder index
  (`ptah-git-head-content-provider.ts:84-89`). See FM4.
- M3 — `file-count` error shows the read-only-fallback message while
  rendering nothing (`pierre-diff-host.component.ts:86-90`). See FM5.
- m1 — Eager-bundle regex misses `.js?query` imports
  (`assert-eager-bundle.mjs:64`). See FM6.
- m2 — Untracked counts resolve against workspace path in repo-subfolder
  workspaces (`git-change-set-numstat.reader.ts:109`, documented).
- m3 — SHA-256 unborn HEAD falls back to null counts
  (`git-change-set-numstat.reader.ts:16`, documented).
- m4 — Store re-persists without guard-failing records, silently
  (`turn-change-set.store.ts:99-105,82-92`). See FM9.

## Data flow

Turn change-set recording (entry → exit):

1. Prompt submit hook → `UserPromptSubmitCallbackRegistry.register`
   (`turn-change-set-recorder.service.ts:130-134`) — OK; synchronous
   baseline Map entry set before any await (`:160-164`), so a turn end that
   races the snapshot still awaits it. OK.
2. Baseline capture: `resolveWorkingDirectory` (hook cwd, else session
   metadata, else null → no recording) then `getGitInfo` + bounded `stat`
   (`:168-181,337-382`) — OK; never rejects.
3. Steering (second prompt in the same turn) keeps the first baseline
   (`:156-158`) — documented deviation, gives whole-turn coverage. OK.
4. Turn end (`Stop` or `StopFailure` hook — mutually exclusive terminal
   events, `stop-hook-handler.ts:105` / `stop-failure-hook-handler.ts:92`):
   baseline deleted before any await (`:186-188`) — no leak on later error.
   OK.
5. After snapshot → `diffSnapshots` — the `'A'`→`'D'` conflation (S1) and
   the phantom-`M` rename-origPath sibling (Q3) live here. GAP.
6. `buildChangeSet`: numstat via `readChangeSetNumstat` — path conventions
   match (status porcelain-v2 and `:(top,literal)` numstat are both
   repo-root-relative; verified empirically pre-review that `parseNumstat`
   keys normal, rename and binary `-z` records by the new path, matching
   `counts.get(c.path)`); null-vs-binary distinction preserved;
   `truncatedCount`/totals consistent. OK except FM7/FM8 degradation paths.
7. `store.append` — serialized per session through the promise tail
   (`turn-change-set.store.ts:65-80`); `release` deletes the chain only if
   still the tail; append failure rejects to a warn while the broadcast
   still runs. OK. Silent record drop on append (FM9). MINOR GAP.
8. Broadcast `git:turnChangeSet` — fire-and-forget with warn. OK.
9. RPC `git:turnChangeSets` — strict zod params; storage failure rejects
   (distinct from empty history) (`git-change-set-rpc.handlers.ts:46-58`).
   OK.
10. Webview → `ptah.review.*` via `command:execute` (`ptah.` prefix
    allowlist, `command-rpc.handlers.ts:29,124`) → zod args → `validateRoot`
    (absolute + realpath + folder match) → `containedPath` (NUL check,
    lexical containment, nearest-existing-ancestor symlink containment) —
    sound for the paths it is given, but given the wrong base (S2). GAP.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Batch 20: eager-bundle guard blocks forbidden modules, size report | COMPLETE | Query-suffixed imports escape the walk (m1) |
| Batch 21: narrow `git-ui/services` entry keeps Pierre out of the eager bundle | COMPLETE | None found; `app.config.ts` imports only the four status services |
| R3.2/3.3 + batch 22: Pierre host with per-hunk slots, dispose, read-only fallback | COMPLETE | `file-count` message wrong (M3); theme default is a construction-time read — correctness depends on the (out-of-scope) renderer binding `[themeType]` live |
| Batch 25: change-set types + numstat reader (rename `origPath`, untracked, unborn HEAD) | COMPLETE | m2, m3 documented deviations |
| R4.1: record files changed per turn at prompt-submit/turn-end | PARTIAL | S1 — committed-untracked reported `D`; rename-origPath sibling reported `M` |
| R4.2: failed turns recorded too; ≤1 entry per session | COMPLETE | Verified: `onTurnFailed` wired (`:138-140`), baseline delete-before-await, single-baseline guard |
| R4.3/R4.4: persistence per session (own key, bounded, serialized) + RPC read | COMPLETE | FM9 silent drop; storage failure correctly distinct from empty |
| R5: `ptah.review.*` commands + HEAD content provider | PARTIAL | S2 subfolder base mismatch; M1 all-or-nothing loops; M2 unstable folder index |

Implicit requirements not addressed: none beyond the above — the manifest
coverage invariant (`RPC_HANDLER_MANIFEST` union vs `RPC_METHOD_NAMES`) holds
for `git:turnChangeSets` (verified: `manifest.ts` entry, `rpc.types.ts`
registry + entries, `message-constants.ts` `GIT_TURN_CHANGE_SET =
'git:turnChangeSet'`, `payload-map.ts`), and the Electron worker storage
cache exclusion for the new key prefix is in place
(`phase-1-infra.ts`, `TURN_CHANGE_SETS_KEY_PREFIX`).

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Steering (prompt during a running turn) | YES | First baseline kept (`:156-158`) | Card covers the whole turn — intended |
| Turn ends before baseline snapshot finishes | YES | `recordTurn` awaits `baseline.ready` (`:201`) | None |
| App started mid-turn (no baseline) | YES | `baselineMissing: true`, all dirty files | Documented; correct |
| Unborn branch HEAD | YES | SHA-1 empty-tree stand-in | SHA-256 repos: null counts (m3) |
| Binary file | YES | `binary: true`, excluded from `countsUnavailable` | None |
| >500 changed files | YES | `truncatedCount` + totals | None |
| >2000 paths to stat | YES | `MAX_STAT_PATHS` bound, status-only comparison beyond | mtime/size changes past the bound go unnoticed if status/numstat are unchanged — acceptable |
| 32 KiB+ argv pathspec | YES | 16 KiB chunking (`chunkPathspecs`) | None |
| Corrupt workspace state | PARTIAL | Guard filters | FM9 silent drop on next append |
| Path outside workspace / symlink escape | YES | Lexical + realpath + nearest-existing-ancestor | TOCTOU between check and editor read is inherent to the filesystem; not fixable here |
| Multi-file patch to Pierre host | YES | Terminal `file-count` state | M3 wrong message |
| `vscode.changes` unavailable | PARTIAL | Per-file fallback | M3-adjacent abort on first failure (M1) |
| Folder removed/reordered after open | PARTIAL | Index lookup returns null → explanatory line | M4 wrong folder, no warning |

## Verification evidence

- `npx jest src/lib/chat/change-set src/lib/handlers/git-change-set-rpc.handlers.spec.ts`
  in `libs/backend/rpc-handlers`: **3 suites, 37 tests, all pass**.
- `npx jest src/commands/review-commands.spec.ts src/commands/ptah-git-head-content-provider.spec.ts`
  in `apps/ptah-extension-vscode`: **2 suites, 31 tests, all pass**.
- `git-info.service.change-set.real-git.spec.ts` is opt-in
  (`testPathIgnorePatterns: \.real-git\.spec\.ts$`) and was not executed;
  its behaviour (numstat `-z` parsing) was instead verified empirically in a
  scratch repository before this report: normal, rename and binary records
  parse correctly and are keyed by the new path, matching
  `counts.get(c.path)`.
- Full `nx test rpc-handlers` run: 3 failing suites
  (`harness-skill-selection-rpc.service.spec.ts`,
  `voice-rpc.handlers.spec.ts`, `skills-sh-legacy-adoption.spec.ts`) —
  all pre-existing and outside this diff's scope; none of the P3 files.
- No test currently pins S1 (commit-during-turn) or S2 (subfolder
  workspace) — the recorder spec exercises deletion, not commit; the
  review-commands specs use folder-as-repo-root fixtures.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: S1 — a routine agent commit makes the turn's change-set card
  report the committed file as Deleted, silently and on the feature's
  primary surface.
- What a robust implementation would add:
  1. Commit-vs-delete discrimination for disappeared baseline paths (disk
     presence or `git cat-file -e HEAD:<path>`).
  2. Repository-root rebasing of change-set paths in the review commands
     (and for `readHeadText` inputs), or folder-relative paths stored
     alongside repo-relative ones.
  3. Per-entry try/catch in `openChanges` with a failed-count surface.
  4. A stable folder identifier (not an index) in `ptah-git-head:` URIs.
  5. A third template branch for `file-count` in the Pierre host.
  6. Tests pinning both serious findings: a commit-during-turn recorder
     case, and a repo-subfolder review-commands fixture.