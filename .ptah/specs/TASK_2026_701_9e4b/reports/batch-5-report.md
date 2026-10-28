# Backend implementation — `TASK_2026_701_9e4b`, batch 5

**Tasks completed**: 5.1 Plugin-agent mirroring, clone edit state, source identity, skills.sh doc.

## Files

All paths are under `D:/projects/ptah-extension/.claude-worktrees/wizard-library-alignment/`.

- CREATED `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts`: the
  `UserLayerPluginAgents` collaborator, with create-if-absent `mirror()` and three-way `reconcile()`
  over `<plugin>/agents/*.md` into `getUserLayerRoots(libraryScopeRoot).agents`. It also holds the
  `MirrorPluginDescriptor(s)` types and the pure helpers `withSourceIdentity`,
  `sourceIdentityChanged` and `ownsSourcedClone` (ownership by `pluginId` plus `sourceRef`).
- CREATED `.../user-layer/user-layer-plugin-agents.spec.ts`: tests for the helpers, a missing
  `agents/` dir, an unreadable `agents/` path (counted, not thrown), and the reconcile skipping
  user-authored files.
- CREATED `.../user-layer/user-layer-clone-state.ts`: `readCloneEditStateIn(roots, kind, slug)`
  returns `CloneEditState | null` = `{exists, edited, pluginId, sourceRef?, sourceLabel?,
  contentDigest}`.
- CREATED `.../user-layer/user-layer-clone-state.spec.ts`
- CREATED `.../user-layer/user-layer-mirror.service.plugin-agents.spec.ts`: covers every required
  case (list below).
- MODIFIED `.../user-layer/user-layer-mirror.service.ts`:
  - `MirrorSources.libraryScopeRoot?` and `pluginDescriptors?`.
  - `mirrorAll` and `reconcile` each delegate to the collaborator in one place (`pluginAgentPass`).
  - New facade method `readCloneEditState(kind, slug, scopeRoot?)`.
  - Descriptors are threaded through every plugin skill and command create and reconcile path.
  - `ownsClone` is replaced by `ownsSourcedClone`.
  - Changes to the reap scope, the legacy seed and the seed quarantine, described under Decisions.
- MODIFIED `.../user-layer/user-layer-reap.spec.ts`: a vanished skills.sh root is reaped like a
  harness root; an edited skills.sh clone is orphaned and keeps `sourceRef`/`sourceLabel`; an
  orphaned command keeps its source fields.
- MODIFIED `libs/backend/agent-generation/src/index.ts`: exports the types `MirrorPluginDescriptor`,
  `MirrorPluginDescriptors` and `CloneEditState`.
- MODIFIED `libs/backend/rpc-handlers/src/lib/skills-sh/skills-sh-source-root.ts`: the doc block
  (formerly lines 35-42) only. It now says skills.sh roots are mirrored and that uninstall still reaps
  through the deleted-upstream sweep.

Required spec cases, all in `user-layer-mirror.service.plugin-agents.spec.ts`:

- A fresh workspace with no consent flag, and one with sync explicitly disabled. This uses the real
  `AgentSyncGate` and `resolveAgentMirrorSource`. Plugin agents are cloned, and
  `HarnessManifestBuilder.build(...).agents` is still `[]`.
- Workspace collision: the workspace agent wins and the plugin agent is recorded in `conflictsWith`.
- Two-plugin collision: first write wins, and the loser never marks the winner diverged.
- An edited clone diverges on update, and an unedited one fast-forwards.
- An orphan after removal keeps `sourceLabel`.
- Two external plugins with one basename: ownership is decided by `sourceRef`.
- Added beyond the list:
  - Sidecar-less user-authored file: the plugin agent never overwrites or claims it.
  - Descriptor backfill on reconcile.
  - An unedited clone is reaped when agent sync is off.
  - Legacy seed after later consent, with no quarantine listing of plugin clones.

## Stack observed

- tsyringe facade with internal collaborators built in the constructor, as `UserLayerFsOps`,
  `UserLayerOrphanReaper` and `UserLayerSeedQuarantine` are (`user-layer-mirror.service.ts`
  constructor). No DI registration changed.
- Sidecar format and zod parse: `@ptah-extension/shared` `origin-sidecar.types.ts`
  (`parseOriginSidecar`, used at the file boundary in clone-state).
- Logging: the injected vscode-core `Logger`.
- Error policy: per-file errors are counted in the result and never thrown. The degradation-audit
  marker convention comes from `tools/degradation-audit/check-degradation.ts`.

## Verification

- `npm run verify -- -p @ptah-extension/agent-generation,@ptah-extension/rpc-handlers` (tail
  filtered): **6 tasks: 6 succeeded** (lint, test and typecheck × 2 projects), lock exit code 0.
  - The first run had 1 failure, caused by my new spec. The workspace's harness-root walk escaped
    into the real home; see Deviations. After the fix, the one allowed re-run passed.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`, run under the verify
  lock:
  - My new sites are clean. I fixed one orphaned marker and one unmarked catch on the first audit
    run.
  - `libs/backend/agent-generation` still reports **3 FAIL (baseline 1)**. None of the three is mine:
    - `user-layer-mirror.service.ts:2229` is the old `catch { return; }` in `seedLegacyAgents`.
      It is unchanged and is the baseline's 1.
    - `wizard-agent-origin.store.ts:88` (catch-return-sentinel) is Batch 4's file.
    - `wizard-agent-origin.store.ts:92` (orphaned-suppression marker) is Batch 4's file.
  - `rpc-handlers`: 1 ok (baseline 1).
- Host checks (ptah-electron, ptah-extension-vscode, ptah-cli): not run, as instructed; the
  orchestrator runs them. The new `MirrorSources` fields are optional, so the hosts compile unchanged.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `contentDigest` is `string \| null` (null when the body is absent or unreadable). An unreadable body reports `edited: true`. `null` overall = no or invalid sidecar | non-null digest; throw on unreadable | Plan :670 type; A21 treats "unreadable" as changed; `readCloneOrigin` null convention | yes |
| Plugin-agent ownership and the shared `ownsClone` both use `pluginId` plus `sourceRef` (when both are known). A legacy sidecar without `sourceRef` is owned on `pluginId` and backfilled on reconcile | pluginId only | Required case "two external plugins with one basename"; `externalPluginDir` basename = plugin name | yes |
| The plugin-agent pass runs after the workspace-agent pass in `mirrorAll` | before | A8 (workspace collision → plugin skips); the legacy seed is keyed off directory contents | yes |
| The legacy seed now runs while the scoped dir holds no workspace clone (pluginId null or no sidecar), instead of "dir absent", and never overwrites an existing clone | keep "dir absent" | Otherwise plugin agents mirrored before consent create the dir and permanently disable the seed for that workspace | yes |
| The seed quarantine receives the source listing plus every plugin-owned slug in the scoped root | leave it | Without this, every plugin clone is listed as `notOwned` in the Agents tab (`listQuarantined`), and a byte-equal flat file would be quarantined | yes |
| The reap sweep walks `libraryScopeRoot`'s agent dir when `workspaceRoot` and `agentSourceDir` are both absent (agent sync off) | no reap of plugin agents without consent | Otherwise uninstalled plugins' agent clones are never reaped. With no `agentSourceDir`, workspace clones there read `'unknown'`, so only plugin-owned clones are judged | yes |
| A relative `libraryScopeRoot` is refused and counted in `errors` | silently use it | `quarantineLocation` precedent: a relative root keys off cwd | yes |
| A sidecar-less clone at a plugin agent's slug is user-authored: it is never minted or claimed (unlike the skill and command missing-sidecar path) | mint, as for skills | Plan: an existing clone not owned → skip | yes |

## Deviations

- **Spec isolation incident, cleaned up, needs your attention.** The first draft of
  `user-layer-mirror.service.plugin-agents.spec.ts` put its workspace in the OS temp dir, outside the
  mocked home. `resolveHarnessWorkspaceRoot` walked up to the real `C:\Users\abdal`, which has
  `.ptah/`, and the spec wrote into the real home:
  - `C:\Users\abdal\.claude\agents\{reviewer,local-only,builder}.md`. These were test fixtures; the
    directory was created by the spec run, judging by directory mtimes. **Deleted.**
  - `C:\Users\abdal\.ptah\harness\state.json` was rewritten (load + spread + save) with
    `agentSyncEnabled: false`. The other fields are as loaded. The "no consent flag" case passed
    before the "disabled" case ran, so the gate already resolved to `false` there. The effective
    state is unchanged, but the flag may have been absent before and is now explicit. **Left as is.**
    Delete the `agentSyncEnabled` key if an absent flag matters.
  - Fix: the spec workspace now lives inside the fake home with a `.git` marker, and asserts
    `resolveHarnessWorkspaceRoot(workspace) === workspace`. The re-run touched nothing in the real
    home (I checked the directory and the state.json mtime).
- The plan's `user-layer-mirror.service.reap.spec.ts` does not exist; I edited `user-layer-reap.spec.ts`
  (as batches.md says).
- Sidecar writers (A-sidecar): every existing-sidecar write path in `user-layer/` already spreads the
  existing sidecar. The reaper mark/clear, refresh, markDiverged, keep, rebase, save, enhance, revert
  and recordConflict all carry forward. Only the fresh-create paths (`writeOriginSidecar`,
  `writeFileSidecar`) needed identity. Both now go through `newSourcedSidecar` (reusing
  `buildSidecar`). `user-layer-orphan-reaper.ts` needed no change.

## Out-of-scope observations

- The degradation-audit ratchet for `libs/backend/agent-generation` fails because of Batch 4's
  `wizard-agent-origin.store.ts:88,92`: one unmarked catch, and one marker that does not attach.
- `plugin-loader.service.ts:1453-1468` (agent-sdk) says skills.sh roots reach only the junction path
  and not `buildMirrorSources`. That becomes stale once Batch 9 adds `discoverSkillsShPluginPaths()`
  to the hosts' mirror sources.
- Reaper, pre-existing: `resolveVerdict` probes `pluginsBasePath/<pluginId>` for a plugin that was not
  scanned. External plugins live at `external/<owner>/<repo>/<plugin>`, so a merely *disabled*
  external plugin reads as uninstalled. Its unedited clones (skills, commands, and now agents) are
  reaped, with a `.history` snapshot, and re-mirrored on re-enable.
- Reverse workspace collision: when a plugin agent clone already holds a slug and the workspace later
  gets its own `.claude/agents/<slug>.md` (after consent), `mirrorAgents` skips it and the workspace
  agent stays shadowed. The B12 consent plan ("workspace agents shadowing this plugin's agents")
  should surface this.
- Batch 9 host wiring needs to set `libraryScopeRoot = resolveHarnessWorkspaceRoot(workspace)` and
  `pluginDescriptors = pluginLoader.getPluginSourceDescriptors()` in all three hosts.
