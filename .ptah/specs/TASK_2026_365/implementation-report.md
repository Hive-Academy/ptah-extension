# TASK_2026_365 — implementation report

## What changed

### 1. The key — `libs/shared/src/lib/types/user-layer-agents.ts` (new)

`userLayerAgentDirName(root, platform?)` returns `<label>-<hash>`.
`agent-generation` writes the directory and `harness-sync` reads it, and neither
lib may import the other, so the key lives in the one bridge — the same reason
the origin-sidecar schema sits beside it.

The hash is a hand-rolled FNV-1a over two 32-bit lanes, not `node:crypto`:
`libs/shared` is imported by `libs/frontend/**`, so a `crypto` import in that
barrel reaches the webview bundle. `process.platform` is read through a guarded
helper for the same reason.

Case folds on `win32` only. Separator collapses cannot invent a match between
two real directories; case folding can, and on ext4 `/a/App` and `/a/app` are
two workspaces.

### 2. The reader — `harness-sync`

- `HarnessSourceLayout.agentsRoot` is now documented as the workspace-scoped
  directory.
- `scopeAgentsRoot(layout, root)` appends the key.
  `PluginConfigSourceResolver.resolve` applies it once, at the top, so the
  read-failure path and the success path cannot describe two different
  directories.
- `resolveAgentMirrorSource(root, gate)` is the ONE agent-mirror decision the
  three hosts make. It resolves the root through `resolveHarnessWorkspaceRoot`
  and gates on `AgentSyncGate.resolve`. The gate is taken as
  `AgentConsentReader`, a one-method structural interface.

### 3. The writer — `agent-generation`

- `getUserLayerRoots(workspaceRoot?)` is the single point where the scope is
  applied. Every method reads its agent root from there, so a caller that omits
  the argument lands in the unscoped base rather than in another project's
  directory.
- `MirrorSources.workspaceRoot` and an optional `workspaceRoot` on
  `RebaseCloneArgs`, `KeepCloneArgs`, `WriteEnhancedFileCloneArgs`,
  `RevertCloneArgs`, `listClones`, `readCloneOrigin` and `listHistory`.
- `seedLegacyAgents` — the migration. See D4 in `context.md`.

### 4. The hosts and the clone surface

`apps/ptah-electron`, `apps/ptah-extension-vscode` and `cli-engine`'s
`harness-boot.ts` all spread `resolveAgentMirrorSource(...)` into their mirror
sources. `SkillRegistryCatalogService.sync`, `SkillEnhancerService` and
`SkillsSynthesisRpcHandlers` pass the workspace so the Library UI reads the
right directory.

## Verification

| Gate      | Result                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck | 8 projects, clean                                                                                                                                                      |
| lint      | 8 projects, 0 errors (warnings all pre-existing)                                                                                                                       |
| test      | 8 projects — shared 1224, harness-sync 363, agent-generation 957, skill-synthesis 1381, rpc-handlers 2612, cli-engine 169, ptah-electron 405, ptah-extension-vscode 36 |

New specs — 10 cases for the key
(`shared/.../user-layer-agents.spec.ts`), 12 for the reader and the writer
decision (`harness-sync/.../agent-workspace-scope.spec.ts`), and 10 for the
mirror and the seed (`agent-generation/.../user-layer-agent-scope.spec.ts`).

One flake observed: `@ptah-extension/cli-engine` failed 1 of 169 under parallel
load in the batched run, then passed 169/169 on three consecutive isolated runs.
Not related to this change.

## Updated specs

The specs below pinned the OLD call shapes and were updated to the new ones —
each is an argument-shape assertion, not a behaviour claim:

- `rpc-handlers/.../skills-synthesis-rpc.handlers.spec.ts` — 9 assertions
- `skill-synthesis/.../skill-enhancer.service.spec.ts` — 6 assertions
- `ptah-electron/.../plugin-activation.spec.ts` — the `harness-sync` mock gained
  `resolveAgentMirrorSource`, and `EXPECTED_SOURCES` gained `workspaceRoot`

## Not done, deliberately

**The committed `.codex/agents/*.toml` are untouched.** They are tracked files,
so `.gitignore:197 .codex/**` does not apply to them and every regeneration
shows as a modification. Untracking them (`git rm --cached`) or committing the
current output are both reasonable, and both are the user's call — this task
fixes the cause, not the working-tree symptom.

**The flat `~/.ptah/user/agents/*.md` clones stay on disk.** See D5.
