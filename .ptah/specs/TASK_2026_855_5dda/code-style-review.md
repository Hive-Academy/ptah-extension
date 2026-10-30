# Code Style Review — `TASK_2026_855_5dda`

Scope: worktree `feat-session-git-view-d7cc38a5745d` against `main` (53 changed files plus the untracked new files). I read the new files in full (resolver, watcher pool, root resolver, watch handler, scope store, lease service, scope token, opener) and the diffs of the wiring files. Spec files and the remaining modified files were checked by diff only, so the approval does not cover them at the same depth. `ptah_get_diagnostics` and the verify run were not executed by me (reviewer lane, no build).

## Summary

| Metric          | Value          |
| --------------- | -------------- |
| Overall score   | 7/10           |
| Assessment      | APPROVED       |
| Blocking issues | 0              |
| Serious issues  | 3              |
| Minor issues    | 5              |
| Files reviewed  | about 25 in full, the rest by diff |

## Five style questions

### 1. What breaks in six months?

- Three path normalizers now coexist with different rules. `libs/shared/src/lib/utils/workspace-root-key.ts:44` lower-cases every path. `libs/frontend/chat/src/lib/services/workspace-root.ts:2-5` lower-cases only drive-letter paths. The new dock, the watcher pool (`git-root-watcher-pool.ts:179-189`) and `isSameWorkingRoot` (`session-working-root.ts:74-82`) use the shared one. `session-git-stats.store.ts:21` and `change-set.store.ts:24` still use the chat one. The stats card and the dock can disagree about whether two roots are the same on POSIX hosts. On a case-sensitive file system the shared rule also merges two real directories that differ only by case.
- The list of five workspace-aware git services now exists twice with an order constraint in a comment each time: `workspace-coordinator.service.ts` (the `services` array in `resolveGitServices`) and `git-dock-scope.store.ts:187-194`. Adding a sixth service means editing both, and nothing enforces it.
- `git-watcher.service.ts` (1395 lines, +78) and `git-rpc.handlers.ts` (1183 lines) keep growing as the place for git behaviour.

### 2. What would a new team member misread?

- `GitRootWatcherPool` is registered with `useValue: new GitRootWatcherPool(logger)` in `phase-4-handlers.ts`, and `boot-heavy-services.ts` later resolves it as `unknown` and checks `pool instanceof GitRootWatcherPool` before `attach()`. The reader has to learn a two-phase lifecycle (bound at phase 4, armed at heavy boot, leases recorded before attach and answered `watched: []`). The pool header documents it well (`git-root-watcher-pool.ts:23-24`), but the `instanceof` guard hides what happens if the binding changes: the pool silently never attaches.
- `GitDockScopeStore.setWorkspace` is called by the chat coordinator, and the store then switches the git services. The comment in the coordinator explains this, but the ownership move from "coordinator switches services" to "store switches services" is non-obvious from the store name alone.

### 3. What does this cost to maintain?

- One more port (`IGitRootWatchRegistry`), one capability, one handler, one pool, one lease client, one scope store and one chat-side source. Each has a stated reason in its header. The cost is acceptable for the feature, and the scope token (`git-session-scope.token.ts:106-128`) keeps git-ui free of a chat import.
- `GitDockScopeStore` (375 lines) mixes pin state, scope derivation, service fan-out and lease-list computation. It is still one concept, but the lease-root computation at `git-dock-scope.store.ts:344-356` is a separable piece.

### 4. Where is this inconsistent with the rest of the repository?

- Duplicated normalizer and service list (see questions 1). Both are drift, not new patterns.
- `GitRootWatchLeaseService` logs with `console.warn` (`git-root-watch-lease.service.ts:96,103`). The coordinator and opener also use `console.*`, so this matches the local frontend convention.
- The port has no contract runner in `libs/backend/platform-core/src/testing/contracts/`, and no binding in `platform-vscode`, `platform-electron` or `platform-cli` `registration.ts`. The repo rule says a port bound in only one adapter is incomplete. Here it is deliberate and consistent with the `APP_UPDATER` precedent: the token is bound in `apps/ptah-electron/src/di/phase-4-handlers.ts`, gated by the `gitRootWatch` capability, and `expected-absent.ts` lists the handler for VS Code and CLI. I treat this as compliant with a caveat (see Minor 3).

### 5. What would I have done differently?

- Export one `GIT_WORKSPACE_AWARE_SERVICES` accessor from git-ui (or have the coordinator ask the store for the list) so the five-service order lives in one place.
- Delete `libs/frontend/chat/src/lib/services/workspace-root.ts` and use the shared helper, or make the shared helper's POSIX behaviour explicit in one place. The point is a single definition of "same root".
- Have the pool register through a small factory that also performs `attach`, so the heavy boot does not need an `instanceof` guard.

## Blocking issues

None. No `eslint-disable` of `@nx/enforce-module-boundaries` was added. A grep of added lines found no `@ts-ignore`, no `as any` and no `: any`. The `as unknown as X` casts appear only in new spec files (pool and handler specs) for mocks, which is the repo's test idiom.

## Serious issues

### Divergent path normalizers used for the same identity check

- File: `libs/frontend/chat/src/lib/services/workspace-root.ts:2-5`, `libs/shared/src/lib/utils/workspace-root-key.ts:44`, used at `libs/frontend/chat/src/lib/services/session-git-stats/session-git-stats.store.ts:21`
- Problem: this task makes `resolveSessionWorkingRoot` the single precedence rule shared by stats cards and the dock (`session-git-stats.store.ts` doc comment, "always agree on the root"). Root identity is still decided by two different functions, so agreement is only partial.
- Tradeoff: switching chat to the shared helper changes keys for POSIX paths (they become lower-cased). Keeping both avoids touching chat but leaves the drift.
- Recommendation: make the chat file re-export the shared function, or fix the shared one to fold case only for drive-letter paths. Pick one rule and cover it with the existing `session-working-root.spec.ts`.

### Five-service list duplicated between coordinator and scope store

- File: `libs/frontend/git-ui/src/lib/services/git-dock-scope.store.ts:187-194`; `libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts` (`resolveGitServices`, diff lines around the `services:` array)
- Problem: the coordinator keeps its own array for `removeWorkspaceState`, and the store keeps another for `switchWorkspace`. Both carry an ordering comment about `ReviewNavigationService`.
- Tradeoff: the split exists because the coordinator must not import git-ui statically. Exposing the list through the store removes the second copy at no boundary cost.
- Recommendation: add a `removeWorkspaceServices(path)` (or reuse `removeWorkspace`) on the store so the coordinator no longer holds the services at all.

### Capability-gated port bound by `useValue` plus an `instanceof` handshake

- File: `apps/ptah-electron/src/di/phase-4-handlers.ts` (the `GIT_ROOT_WATCH_REGISTRY` registration), `apps/ptah-electron/src/activation/boot-heavy-services.ts` (the `pool instanceof GitRootWatcherPool` block)
- Problem: the heavy boot resolves the port as `unknown` and narrows by class. If the binding is later replaced by another implementation, the pool is not attached and leases stay unarmed with no log line. The failure mode is silent.
- Tradeoff: the explicit `attach` exists because the primary watcher is built later. A log in the `else` branch, or resolving the concrete pool through its own token, costs a few lines.
- Recommendation: log a warning when the registry is registered but is not the pool, or register `GitRootWatcherPool` under a concrete class token and alias the port to it.

## Minor issues

1. `libs/backend/platform-core/src/di/tokens.ts:36-38` contains an unrelated reformat of `HOST_ATTENTION_NOTIFICATIONS`. It adds diff noise to a shared token file.
2. `libs/backend/platform-core/src/interfaces/git-root-watch-registry.interface.ts` is exported with the other ports, but the `I*` port has no contract runner. A small `run-git-root-watch-registry-contract` using the pool with a fake watcher would match the sibling ports.
3. `libs/frontend/chat/src/lib/services/session-git-scope/session-git-dock-opener.service.ts` logs with `console.error` and a `degradation-audit` comment; confirm that tag matches the repo's audit grep format.
4. `GitDockScopeStore` (375 lines) could move the lease-root computation (`git-dock-scope.store.ts:344-356`) into a pure function next to `scopeFrom`, which already exists as a pure helper.
5. `libs/frontend/chat/src/index.ts` adds three exports on single long lines; `SessionWorktreeLookup` is exported but only the scope source and opener are wired in `app.config.ts`. Confirm it is used outside chat, otherwise drop it from the barrel.

## File-by-file

### libs/shared/src/lib/utils/session-working-root.ts

Score 9/10 — 0 blocking, 0 serious, 0 minor. Pure, no I/O, precedence documented in the header and implemented as an ordered table (`:58-70`). Placement in `scope:shared` `type:util` is the only location both webview features can import without a cycle. Exports go through `utils/index.ts`.

### libs/frontend/core/src/lib/tokens/git-session-scope.token.ts

Score 9/10 — Contract-only token with the dependency direction written out (`:106-112`: core defines, chat implements, app provides). Matches the existing `WORKSPACE_COORDINATOR` and `SESSION_DATA_PROVIDER` tokens, and `app.config.ts` provides it with `useExisting`, the same as the sibling.

### libs/frontend/git-ui/src/lib/services/git-dock-scope.store.ts

Score 7/10 — 0 blocking, 1 serious, 1 minor. Signal-based, `inject()`, untracked effect reads handled deliberately (`:189-196`). Duplicated service list and a few mixed responsibilities (see above).

### libs/frontend/git-ui/src/lib/services/git-root-watch-lease.service.ts

Score 8/10 — One debounce timer, one renew interval, released through `DestroyRef` (`:34-60`), so no per-item timers. Host gating is by `isElectron` here and by capability on the backend, which is consistent.

### apps/ptah-electron/src/services/git-root-watcher-pool.ts

Score 8/10 — Bounded by constants (`:39-43`), one unref'd expiry timer, `dispose()` stops every watcher. Dependencies are the narrow `RootWatcher` interface, not the concrete service, which is the right abstraction at a real boundary. Registration handshake noted above.

### libs/backend/rpc-handlers/src/lib/handlers/git-root-resolver.ts and git-watch-rpc.handlers.ts

Score 8/10 — One rule for which root a `git:*` call may run in; refusals never fall back to the active folder (`:9-11`). Handler is registered through the manifest with `requires: ['gitRootWatch']`, listed in `expected-resolvable.ts` for Electron and `expected-absent.ts` for VS Code and CLI. Zod parsing at the boundary in `git-watch-rpc.schema.ts`. Imports `vscode-core` tokens like every other handler in this lib, so there is no new leak.

### libs/frontend/chat/src/lib/services/session-git-scope/*

Score 8/10 — Small files, one responsibility each; git-ui is reached by dynamic import of the services-only entry, matching the coordinator.

### libs/frontend/chat/src/lib/services/workspace-coordinator.service.ts

Score 7/10 — Delegates the switch to the store correctly; keeps its own service array for teardown (serious issue 2).

### libs/frontend/git-ui/src/lib/services/git-status.service.ts

Score 8/10 — Cache keys normalized consistently via `isActive` and `writeCache`; bounded cache with eviction that never drops the active root.

### libs/shared/src/lib/types/rpc/rpc-git.types.ts and rpc.types.ts

Score 9/10 — The new contract lives in the git domain file (not appended to the oversized `rpc.types.ts`), and `rpc.types.ts` only carries the registry entry and the method-name record that the type system requires.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No `eslint-disable` of module boundaries in production code | PASS | grep of added lines, none found |
| Cross-lib imports through barrels or declared entry points | PASS | `@ptah-extension/git-ui/services` (tsconfig.base.json:126), `@ptah-extension/core` |
| git-ui does not import chat | PASS | token indirection, `git-session-scope.token.ts:106-128` |
| Agnostic libs depend on ports, not adapters | PASS | `git-watch-rpc.handlers.ts:130-135` injects `IGitRootWatchRegistry` |
| New port bound in every adapter plus contract runner | NOT_APPLICABLE / partial | capability-gated, Electron composition root only (`phase-4-handlers.ts`); no contract runner (Minor 2) |
| New token is a `Symbol.for` in the token object | PASS | `tokens.ts` `GIT_ROOT_WATCH_REGISTRY` |
| Ports are `I*` and exported with `export type` | PASS | `platform-core/src/index.ts` diff |
| Filenames kebab-case with role suffix | PASS | `git-root-watch-registry.interface.ts`, `git-dock-scope.store.ts` |
| Host handler manifest and expected-resolvable/absent updated | PASS | `manifest.ts`, `expected-resolvable.ts`, vscode and cli `expected-absent.ts` |
| Webview-to-host messages through typed contract | PASS | `rpc-git.types.ts` + `RpcMethodRegistry` entry |
| No new `as any`, `@ts-ignore`, implicit `any` | PASS | grep of added lines |
| Angular: standalone OnPush, `inject()`, signals | PASS | scope store, lease service, header component |
| Single definition of root identity | FAIL | two normalizers (Serious 1) |
| Commit scopes in `.commitlintrc.json` | NOT_APPLICABLE | no commits reviewed |

## Maintenance debt

- Introduced: one port with a capability gate, a watcher pool, a lease client, a scope store, a chat-side source and an opener; a second service list and a still-divergent normalizer.
- Retired: the single hard-wired "active folder only" git state; chat's private copy of the working-root precedence now delegates to the shared function.
- Net: slightly up, with a clear separation (token indirection, capability gating) that keeps the new cost in Electron and in git-ui.

## Verdict

- Recommendation: APPROVE (revise the serious items in a follow-up or before merge at the owner's choice)
- Confidence: MEDIUM — the new files and wiring were read in full, but some spec files and unchanged-adjacent callers were checked by diff only, and the verify run was not part of this review.
- Key concern: root identity is still defined in two places, so the stats card and the dock can disagree on POSIX hosts.
- What a 10/10 version would do differently:
  - One normalizer for root identity, with the case rule stated and tested.
  - The git service list owned by the scope store only; the coordinator asks it to tear a folder down.
  - A log or a typed token in place of the `instanceof` handshake in the heavy boot.
  - A contract runner for `IGitRootWatchRegistry` beside the other port runners.
  - No unrelated reformat in `platform-core/src/di/tokens.ts`.
