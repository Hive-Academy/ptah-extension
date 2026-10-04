# Batch 1 executor report — TASK_2026_609_c495

Executor: backend-developer (sub-agent). Worktree `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup`. No git run. `batches.md`, `file-writer.service.ts` and its spec were not touched.

## Verdict

Tasks 1.1 and 1.2 are done and pass their checks. Task 1.3 hit its stop condition. The reconciler DELETES a hand-edited rival-CLI copy when its agent leaves the desired state. As instructed, I made no harness-sync change and added no spec. The team-leader has to decide whether the quarantine stays wired, because R4 is real (see A5/R4).

## Tasks

### Task 1.1 — seed only the slugs this workspace owns: DONE

- `user-layer-mirror.service.ts` `mirrorAll` (`:347-370`) now reads the agent source once with `readAgentSourceListing` and passes that one listing to both the seed and the quarantine, so the two cannot disagree about ownership.
- `seedLegacyAgents(workspaceRoot, scopedAgentsRoot, agentSource)` (`:1861`) takes the listing, not the raw directory path, because the listing is read once and shared (minor deviation, see below). The existing guards stay as they were: workspace undefined, scoped root equal to the flat root, scoped dir already exists. `.history` is still never copied.
- Absent or unreadable source: nothing is seeded, and one info line is logged with `workspaceRoot`, `agentSourceDir`, `sourceStatus` and `flatClonesNotSeeded` (`:1880`).
- Empty source, or no flat clone owned: nothing is seeded, the scoped dir is not created, and an info line with `flatClonesNotSeeded` is logged.
- Otherwise only flat `.md` files whose slug exists in the source are copied, together with their sidecars. The final log line now includes `flatClonesNotSeeded`.
- The doc comment was rewritten, not appended to. It states the owned-only rule, the reason (TASK_2026_609 cross-workspace leak), and the absent-or-unreadable behaviour.

### Task 1.2 — one-time quarantine: DONE

- New file `user-layer-seed-quarantine.ts` contains:
  - `readAgentSourceListing`, which returns `ok` (with slugs, possibly an empty set), `absent` (ENOENT) or `unreadable`.
  - A pure `classifySeededClone`, which returns `owned`, `quarantine`, `kept-local-work` or `kept-unprovable`. It compares raw bytes with `Buffer.equals` and does not normalise CRLF.
  - `UserLayerSeedQuarantine.run`.
- Criterion: (a) the listing status is `ok`, (b) the slug is not in it, (c) the scoped clone's bytes equal flat `~/.ptah/user/agents/<slug>.md`.
- The pass is a move, never a delete:
  1. `fsOps.snapshotFileToHistory` copies the clone into `<scoped>/.history/<slug>/<ts>/`. This is the store `revertFileClone` restores from, so the user can revert it.
  2. The sidecar is copied into the same `<ts>` directory.
  3. The snapshot bytes are re-read and compared with the clone, and the sidecar copy's existence is checked.
  4. Only then are the sidecar and then the clone removed. Sidecar first, so a half-failure leaves a sidecar-less clone that the next pass picks up again. The flat base is never written; every write goes through the `UserLayerFsOps` guards.
- It runs inside `mirrorAll` after the seed and before `mirrorAgents`, one slug at a time under `withSlugLock('agent', slug)`. The lock is passed in as a callback, and the classification is done inside the lock.
- Failures are counted into `MirrorResult.errors`.
- One info line per run (`[UserLayerMirror] seed quarantine pass`) gives the counts and slugs for: quarantined, kept with local work, kept unprovable, and failed.
- Marker: `<scoped>/.ptah-seed-quarantine.json`. It starts with a dot and is not `.md`. It records the three lists and is written only when a pass has zero failures.
- The pass is skipped when the scoped root does not exist yet. No marker is written in that case, so the check simply runs again on a later pass.

### Task 1.3 — reconciler handling of retired agent copies: STOPPED, finding reported

See A5/R4 below. Evidence came from a temporary probe spec that used the real reconciler, the Codex target and a temp workspace. I deleted the probe after the run, as the stop rule requires. No harness-sync file is changed (`git status` shows none).

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-mirror.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-agent-scope.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\agent-generation\src\lib\services\user-layer\user-layer-seed-quarantine.spec.ts`
- `workspace-target.agent-retire.spec.ts`: created as a temporary probe, then deleted. It is not in the diff.

## Specs added or changed

The agent-scope spec now covers:
- seed of owned slugs only, including the sidecar and the `flatClonesNotSeeded` log;
- absent source: nothing seeded, skip logged;
- empty source: nothing seeded.

The existing tests "own source wins", "never deletes flat", "seeds once" and "no `.history`" were kept. The no-`.history` test now has an owned source slug. One old test was replaced, not deleted silently: "seeds a workspace that has no `.claude/agents`" asserted the old leak behaviour, an empty source seeding everything, which is exactly what F1 forbids.

The quarantine spec covers:
- classifier branches, including CRLF counting as local work;
- a byte-identical foreign clone plus sidecar moved into `.history/<slug>/<ts>/`, with the flat base untouched and the owned agent mirrored;
- a sidecar-less clone quarantined;
- a clone whose copied sidecar says `diverged`/`orphaned` quarantined (this pins A4);
- local work kept;
- flat file missing kept;
- an owned slug never quarantined;
- absent source: no run, no marker;
- empty source: run;
- marker present: a second pass is a no-op;
- the marker is not listed as a clone;
- no workspace root: no-op;
- EBUSY on one slug: the others proceed, no marker, the next pass retries and writes the marker;
- a snapshot without the clone's bytes: the clone is not removed;
- the lock is taken once per foreign slug and never for an owned one;
- no scoped root: skipped;
- scoped root equal to the flat root: refused;
- an unreadable source (EACCES) does not run. This test is POSIX-only and is skipped on win32 and for root, which accounts for the 1 skipped test.

## Risks and edge cases

- **R1 (wrong ownership filter).** Ownership means "has `<slug>.md` in this workspace's `agentSourceDir`" (A3). The seed and the quarantine share one listing. Removal needs bytes equal to the flat file. Every other case is kept and logged.
- **R2 (data loss).** The pass copies, verifies the copy, then removes. The snapshot lands in the `.history` store that revert reads, and the flat originals are never written. A failed verification throws and keeps the clone.
- **R3 (no source dir).** Default as planned: nothing is seeded, and the skip is logged with the workspace and the count of flat files not seeded. Reviewer to confirm.
- **R4.** The stop condition fired. See A5.
- **R5 (one-time, retry after partial failure).** The marker is written only after zero failures. When the scoped root is absent the pass skips without a marker. The marker name is dot-prefixed and not `.md`. `listClones` skips it (no sidecar). The reaper and harness builder read only `*.md` (`harness-manifest.builder.ts:537`; reaper uses `listMarkdownFiles`).
- **R6 (concurrent passes).** Each slug runs under `withSlugLock('agent', slug)`, and bytes are compared inside the lock.
- **Edge: workspace undefined, or scoped root equal to the flat root.** Both the seed and the quarantine are no-ops (spec'd).
- **Edge: source empty, absent or unreadable.** Empty: nothing seeded, quarantine runs. Absent or unreadable: nothing seeded, quarantine does not run (spec'd).
- **Edge: no sidecar but identical bytes.** Quarantined. **Differs from flat:** kept as local work. **Flat file gone:** kept as unprovable. **EBUSY on one slug:** the others proceed, no marker, retried next pass. All spec'd.

## A4 — why the orphan reaper did not remove the leaked clones

The reaper does run on the propagate path, so "the reaper never ran" is ruled out:
- `HarnessPropagationService.propagate` → `refresher.refresh` (`harness-propagation.service.ts:105-109`).
- In Electron, that refresh is `runUserLayerPass`, which calls `mirrorUserLayer` and then `reconcileUserLayer` → `reconcileAll` (`apps/ptah-electron/src/activation/plugin-activation.ts:493-501, 438`).
- `reconcileAll` calls `reapDeletedUpstream` (`user-layer-mirror.service.ts`, `reconcileAll`).
- VS Code follows the same mirror-then-reconcile order (`apps/ptah-extension-vscode/src/activation/wire-runtime.ts:49-54`).
- The sources are the same object passed to both passes, built in one place (`buildMirrorSources`, Electron `:285-310`). So `agentSourceDir` is present whenever consent is, and `classifyUpstream` returns `orphan` for a foreign slug (`user-layer-orphan-reaper.ts:135-137`).

The clones survive at the next two filters:
- **No sidecar ⇒ skipped.** `reapFileClones` does `if (!sidecar) continue` (`user-layer-orphan-reaper.ts:257-258`). The old seed copied a sidecar only if the flat base had one (`seedLegacyAgents`, old `:1861`). `mirrorAgents`/`reconcileMissingFileSidecar` mint sidecars only for slugs that are in the source, never for foreign ones.
- **"Local work" ⇒ kept as `orphaned: true`.** `hasLocalWork` is true when `diverged`, or when the live hash differs from `sourceHash` (`:266-270, 318-339`). Flat-base clones were reconciled or enhanced across several workspaces, so a sidecar copied verbatim often says `diverged`, or carries a `sourceHash` from another project's source.

Which of the two applies on the user's machine cannot be checked from here (I did not inspect `~/.ptah/user/agents`). The quarantine criterion ignores the sidecar and covers both. Both cases are pinned in the quarantine spec ("sidecar-less clone" and "copied sidecar says diverged/orphaned").

## A5 / R4 — does the reconciler delete a hand-edited CLI copy? YES. STOP.

When an agent slug leaves the desired state:

1. **An unmodified manifest-owned rival copy is removed.**
   - `WorkspaceHarnessTarget.plan` → `planRemovals` (`libs/backend/harness-sync/src/lib/targets/workspace-target.ts:580-598`) queues every manifest entry not in `desiredEntries`.
   - `apply` (`:251-262`) calls `removeManaged` (`copy-engine.ts:235-251`, `unlink`).
   - Existing coverage: `harness-reconciler.agent-consent.spec.ts:226` ("[286] a disabled agent is reaped from every target") and `harness-reconciler.idempotency-removal.spec.ts:237`.
2. **A hand-edited manifest-owned rival copy is also removed.**
   - `planRemovals` never compares the on-disk hash with `entry.hash`. Drift is checked only for desired entries (`planEntry`, `:523-530`).
   - The reconciler adds no filter: removals pass straight to `apply`, and only the fail-closed `freezeToMcp` path strips them (`harness-reconciler.service.ts:1036-1055`).
   - Empirical probe, using the real `HarnessReconcilerService` + `createCodexTarget` on a temp workspace:
     - First reconcile wrote `a1`, `a2` and `a3` to `.codex/agents`.
     - I overwrote `.codex/agents/a2.toml` with `HAND EDITED` and deleted the sources `a2.md` and `a3.md`.
     - Second reconcile output: `{"a2":false,"a3":false,"removed":[".codex/agents/a2.toml",".codex/agents/a3.toml"],"overwritten":[]}`.
   - So the hand-edited file was deleted, and it was reported only in `removed`, not in `overwrittenLocalEdit`.
   - No existing spec pins case 2.

**Consequence for Batch 1.** Each quarantined slug leaves the scoped user layer, so the next harness pass deletes that slug's manifest-owned copies in `{ws}/.codex/agents`, `.github/agents`, `.cursor/agents` and `.opencode/agent`, including any copy the user edited by hand. The rival copies are not snapshotted anywhere. The scoped clone and the flat original survive, but a hand edit made directly in, say, `.codex/agents/video-director.toml` would be lost.

This is the same pre-existing behaviour as the existing reaper and a disabled agent. Task 1.2 still makes it reachable for the leaked slugs on the first pass after upgrade.

**The quarantine is wired and on in this diff.** Options for the team-leader:
- (a) Accept it: the leaked copies are derivatives the user did not author.
- (b) Hold the `seedQuarantine.run` call in `mirrorAll` (`user-layer-mirror.service.ts:360`) until a harness-sync change makes `planRemovals` keep and report drifted owned copies.
- (c) Make that harness-sync change in a follow-up batch.

I did not add the harness-sync spec, because it would pin a deletion the plan treats as a blocker.

## Plan deviations

- `seedLegacyAgents` takes the `AgentSourceListing` (which carries `dir`), not the raw `agentSourceDir` string. Reason: the plan requires the source to be read once and the quarantine to use the same ownership set, and passing the listing does both with a single read.
- One existing spec test was replaced because it asserted the leak (see "Specs added or changed").

## Checks

- `npx nx run-many -t typecheck,lint -p @ptah-extension/agent-generation`: both targets succeeded. Re-run after `prettier --write` on the four files: succeeded again.
- `npx nx run-many -t test -p @ptah-extension/agent-generation --maxWorkers=2`: succeeded.
- Uncached re-run (`nx run @ptah-extension/agent-generation:test --maxWorkers=2 --skip-nx-cache`): 35 of 35 suites passed; 1158 tests passed, 1 skipped (the POSIX-only EACCES test on win32), 1159 total. This run included Batch 2's in-flight `file-writer.service*` edits, which passed.
- `@ptah-extension/harness-sync` was not checked: I changed no harness-sync file, and the only spec run there was the deleted probe (1 passed).

## Out-of-scope observations

- `planRemovals` reports a hand-edited deletion only in `removed`. `overwrittenLocalEdit` stays empty, so health does not tell the user their edit was lost (`workspace-target.ts:580-598`).
