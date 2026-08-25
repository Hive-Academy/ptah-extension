# TASK_2026_191 — Findings

Defence-in-depth cwd containment at the PtyManager spawn sink (deferred F1/F2/F4
from the TASK_2026_174 review).

## F4 — the asymmetry (PRIMARY): approach chosen

Chose option 2 (favoured by spec): carry the authorized roots DOWN the
`IPtyHost.create` port, and re-validate `cwd` at the `pty.spawn` sink. The sink
takes no `IWorkspaceProvider` dependency, so it stays decoupled from workspace
discovery (option 1 rejected for that coupling).

- The RPC handler computes the authorized-root set once
  (`authorizedTerminalRoots` = open workspace folders + home), uses it for the
  boundary check, AND passes the same array down through the new required
  `PtySpawnRequest.authorizedRoots`. Boundary and sink enforce byte-identical
  policy and cannot drift.
- `PtyManagerService.create` re-validates `cwd` against `params.authorizedRoots`
  at the sink, mirroring the `shell` re-check 174 added one line above. Fails
  closed: empty root set → throws `PtyManager: cwd not permitted`.
- `authorizedRoots` is required so a future second caller is compile-time forced
  to declare roots and cannot inherit the shell guard with an unbounded cwd.

### Shared vs duplicated predicate (hexagonal decision)

Moved the pure containment mechanism into platform-core as
`isPathWithinRoots(candidate, roots, platform?)` — pure, process.platform-aware,
no platform deps, parallel to isAllowedShell / isUnsafeWorkspacePath already
there. Both sides import the one implementation: rpc-handlers builds the policy
(`authorizedTerminalRoots`) and delegates; the Electron sink calls the same
predicate on the roots handed down. Avoids duplicating policy and avoids the
leaf-app → handler-lib dependency inversion. No stateful class added to
platform-core; the public isAuthorizedWorkspace/isWithinHomeDir/
isAuthorizedTerminalCwd keep their signatures.

### Port implementations updated

PtyManagerService is the only IPtyHost implementer (grep "implements IPtyHost"
→ 1 hit); the RPC handler is the only create() caller (IpcBridge uses only
write/resize/onData/onExit/disposeAll). One implementation, one call site.

## F1 — lexical vs realpath (LOW): accept + document

Kept lexical path.resolve, documented in normalize's doc-comment: policy already
authorizes the whole home dir (symlink-out weaker than an already-allowed
primitive); realpath adds an FS call, throws on a not-yet-existing cwd, and makes
the shared predicate impure. Same trade-off 174 used.

## F2 — case-fold over-acceptance (LOW): FIXED

Case fold now win32-only in normalize (mirrors workspace-path-guards.ts).
`/WORKSPACE/x` no longer folds onto `/workspace` on a case-sensitive FS.
workspace-authorization.spec case tests made platform-aware.

## Files changed

Production:

- libs/backend/platform-core/src/utils/path-containment.ts — NEW
- libs/backend/platform-core/src/index.ts:74 — export isPathWithinRoots
- libs/backend/platform-core/src/interfaces/pty-host.interface.ts:16 — required authorizedRoots
- libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.ts — delegate + authorizedTerminalRoots
- libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.ts:30,79-95 — compute/check/pass-down
- apps/ptah-electron/src/services/pty-manager.service.ts:20,66-92 — cwd re-check at sink

Tests:

- libs/backend/platform-core/src/utils/path-containment.spec.ts — NEW
- apps/ptah-electron/src/services/pty-manager.service.spec.ts — thread roots + sink cwd rejection
- libs/backend/rpc-handlers/src/lib/handlers/terminal-rpc.handlers.spec.ts — authorizedRoots in create assertions
- libs/backend/rpc-handlers/src/lib/utils/workspace-authorization.spec.ts — win32-aware case tests

## Verification

- typecheck (platform-core, rpc-handlers, ptah-electron): PASS (3/3)
- test platform-core: 352 passed / 4 todo (incl. new spec)
- test rpc-handlers: 1621 passed / 31 skipped (174 terminal green)
- test ptah-electron: 142 passed / 4 skipped (sink cwd rejection + 174 shell green)
- lint (3 projects): PASS, 0 errors (8 pre-existing warnings in untouched files)

## Note — stricter-than-before invariant

Because `authorizedRoots` is now required on `PtySpawnRequest`, the sink throws
if `getWorkspaceRoot()` ever returns a path that is neither a workspace folder
nor under home. In practice the root is always `folders[0]` (contained) with a
`homedir()` fallback, so the default cwd always passes.
