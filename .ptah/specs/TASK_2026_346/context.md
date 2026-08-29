# TASK_2026_346 — harness-sync removes/rewrites 44 artifacts on every workspace switch

## The report

Switching from `property-hub` back to `qa3elhamor` removed 44 harness artifacts
(`tmp/logs/log.log:1647`); switching back rewrote them (`:1822`, expected 127).
Each tab switch between two open folders tore down and re-materialised harness
directories across four targets. Separately, the 12-path "blocked" list for
`property-hub` was emitted in full five times in one session (`:1286`, `:1290`,
`:1315`, `:1824`, `:2154`).

## Root cause

The reconciler built its desired state from a PROCESS-GLOBAL cursor instead of
the root it was reconciling.

- `harness-reconciler.service.ts:359` (`runReconcile`) and `:187` (`verify`)
  called `sourceResolver.resolve()` with no workspace argument.
- `PluginConfigSourceResolver` (`plugin-config-source-resolver.ts:110-120`)
  called `PluginLoaderService.getWorkspacePluginConfig` /
  `resolveCurrentPluginPaths` / `getDisabledSkillIds`.
- Those read `this.workspaceState` — on Electron the `WorkspaceAwareStateStorage`
  proxy, which delegates to the ACTIVE workspace
  (`workspace-aware-state-storage.ts:95-97, 127-138`) — and
  `this.workspace.getWorkspaceRoot()` for `{ws}/.ptah/plugins`
  (`plugin-loader.service.ts:864-866`).

Log proof of the ordering: `workspace:addFolder property-hub` (`:1109`) fires
`onDidChangeWorkspaceFolders` while `qa3elhamor` is still active, so
`wire-runtime.ts:302` propagates `qa3elhamor`; `workspace:switch` (`:1122-1123`)
then flips storage to `property-hub` (3 plugins); the `qa3elhamor` pass resolves
`property-hub`'s overlay and writes 44 skill copies into `qa3elhamor` (`:1225`,
expected 95 = 51 + 44, 11 per target across claude/codex/copilot/antigravity),
recording them in `qa3elhamor`'s manifests. Switching back correctly reaps them
(`:1647`, removed 44) because they are manifest-owned and the now-correct
desired state does not name them. `property-hub` itself was never rewritten
(`:1285`, `:1822`, `:2152` all identical 115/127, removed 0). The same
mis-scoping hits session preflights for non-active folders (`:2301`; the
skill-synthesis drain visits three workspaces).

Second defect: `logBlocked` (`harness-reconciler.service.ts:840-881`) re-emitted
the identical 12-path list on every full pass. `full` is not rare — activation,
the download callback, every folder change and every plugin toggle are all
`full`.

E12 (no teardown on folder REMOVAL) is correct and stays.

## Decisions

**The desired state is a function of the root.** `IHarnessSourceResolver.resolve`
takes an optional, already-normalized `workspaceRoot`; the reconciler passes it
from `reconcile` (full and preflight) and from `verify`. `HarnessPluginConfigReader`'s
three methods take the same optional root. Optional rather than required so
`createStaticSourceResolver`, every spec and every hand-built reader stay
assignable with zero-argument methods.

**`PluginLoaderService.storageFor(root)`, one private helper, three cases.** No
root → the injected storage (byte-identical to today). A root with a
single-scope storage → the injected storage, because a one-workspace host (CLI,
VS Code) has exactly one storage which IS the answer for every root. A root with
a workspace-scoped storage → that root's own storage, or `null` → the default
empty config. The workspace-scoped capability is the new structural port
`IWorkspaceScopedStateStorage` in `platform-core`, probed with
`isWorkspaceScopedStateStorage`. It is deliberately NOT a new `PLATFORM_TOKENS`
entry: the same object is already registered under `WORKSPACE_STATE_STORAGE`,
and a second token would let one host register two objects that disagree.
`WorkspaceAwareStateStorage` (`vscode-core`) satisfies it as-is, with no import
either way. Win32 gets a case-insensitive second pass over
`getAllWorkspacePaths()`, because roots arriving from different sources disagree
about the drive letter's case.

**An unscoped reader is answered by FORWARDING, not by an empty source state.**
The plan proposed returning the existing `empty` state when a reader cannot
scope, on the grounds that a missing `overlayPluginPathsKnown` filters nothing.
That is true of the plugin FILTER and false of the overlay's CONTENTS: an empty
`overlayPluginPaths` drops every overlay-only skill (skills.sh roots,
workspace-scoped `ptah-harness-*`) out of the desired state, and skills are
manifest-owned — so the "safe" fallback would REAP them. Worse, "cannot scope"
is not detectable at runtime: a wrapper lambda that ignores its argument is
indistinguishable from one that honours it. Forwarding a root a reader ignores
leaves that reader exactly as it behaved before, which is the only fallback here
that removes nothing. In practice the branch would have been dead anyway: the
VS Code host and `cli-engine` resolve `PluginLoaderService` directly (so they
get the scoped methods for free) and Electron's wrapper lambda now forwards.

**`readDormantSkillSlugs` is NOT widened.** It is backed by the single
machine-level `~/.ptah/ptah.db`, and dormancy is a residency-budget decision
about the model's prompt rather than about a folder. Giving it a workspace
argument it could not honour would be a scope that side cannot keep.

**Blocked WARN: once per SET, per workspace root.** Key is sorted
`target|relPath|reason`, so target registration order cannot read as a change
and a `reason` change is a real change. Unchanged → one `debug` line ("Blocked
set unchanged since the last full pass"); emptied → one `debug` line ("Blocked
set is now empty"), so the last word on a since-repaired workspace is not "twelve
paths blocked". Per process, not persisted: a fresh host reporting the state it
found is correct. `full`-only gating, the `action`/`note`/`reason` strings and
the shared wording allowlist are untouched.

## Implementation notes

### Changed

- `libs/backend/platform-core/src/interfaces/workspace-scoped-state-storage.interface.ts`
  (new) — `IWorkspaceScopedStateStorage` + `isWorkspaceScopedStateStorage`;
  exported from `platform-core/src/index.ts`.
- `libs/backend/harness-sync/src/lib/sources/harness-source.port.ts` —
  `resolve(workspaceRoot?: string)`.
- `libs/backend/harness-sync/src/lib/sources/plugin-config-source-resolver.ts` —
  `HarnessPluginConfigReader`'s three methods take the optional root;
  `PluginConfigSourceResolver.resolve` forwards it to all three in one read.
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts` —
  `resolve(workspaceRoot)` at the `verify` and `runReconcile` call sites; the
  `loggedBlockedSets` map, the `blockedSetKey` canonicaliser and the three-way
  branch in `logBlocked`. No pass semantics changed, no new removal path.
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts` —
  `storageFor`, `emptyPluginConfig`, and the optional root threaded through
  `getWorkspacePluginConfig`, `getDisabledSkillIds`, `resolvePluginPaths`,
  `resolveCurrentPluginPaths`, `getWorkspacePluginsBasePath`,
  `discoverWorkspaceHarnessPluginPaths`, `resolveHarnessOverlayPaths`.
- `apps/ptah-electron/src/di/phase-2-libraries.ts` — the resolver lambda's three
  wrappers forward `workspaceRoot`.
- `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.ts`
  — `getSelection` resolves the root first and passes it.
- `libs/backend/harness-sync/CLAUDE.md` — new section "The desired state is a
  function of the ROOT", the blocked-once-per-set paragraph, the `Ports:` row,
  and the E12/E13 rows plus their spec pointers.

### Tests

- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.workspace-scoped-sources.spec.ts`
  (new, 3 cases) — A → B → A over ONE reconciler with a per-root overlay: the
  third pass removes 0 and A's manifest holds only A-derived entries; a
  workspace switch landing between the trigger and the source resolve (modelled
  on `serializePerWorkspace`'s microtask deferral, no timers) cannot put B's
  entries in A; `resolve` is called with the NORMALIZED root for a full pass, a
  preflight and a verify, from a cwd inside a sub-package.
- `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.blocked-logging.spec.ts`
  — the converged-pass case now asserts one WARN then one `debug` "unchanged";
  added a re-emit-on-change case (new occupant → fresh WARN, still
  `HARNESS_BLOCKED_APPROVED_ACTIONS['reconcile-warn']` with
  `harnessBlockedWordingViolations` empty; then a cleared set → the "now empty"
  debug) and a per-workspace-key case.
- `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.spec.ts` — new
  `reads scoped to a workspace root` block (5 cases): B's config while A is
  active, no-argument calls unchanged, an unregistered root reading as the
  default empty config, `resolveCurrentPluginPaths(rootB)` scanning B's
  `{ws}/.ptah/plugins`, and a single-scope storage answering for every root.

### Test results

See the task report for the verbatim counts.

### Not done here

`wire-runtime.ts` / `boot-heavy-services.ts` (the duplicate trigger —
TASK_2026_345) and `harness-sync/targets/` (TASK_2026_354) are untouched.
