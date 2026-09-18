# Backend Fix Round 1 — `TASK_2026_469_3e56`

## Fix Status Summary

### Item 1: Defect 1 (serious) — Stash Identity and ExpectedHash Pre-check

- **Status**: fixed
- **Files**:
  - `libs/shared/src/lib/types/rpc/rpc-git.types.ts:495` (`GitStashRefParams.expectedHash`)
  - `libs/shared/src/lib/types/rpc/rpc-git.types.ts:601` (`StashEntry.hash`)
  - `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts:106` (`GitStashRefParamsSchema.expectedHash`)
  - `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:821`, `854`, `880` (`registerGitStashMutations` and `registerGitStashShow` forwarding `expectedHash`)
  - `libs/backend/vscode-core/src/services/git-info.service.ts:2455` (`computeStashList` includes `%H` in format and populates `hash`)
  - `libs/backend/vscode-core/src/services/git-info.service.ts:2519` (`runStashMutation` pre-verifies ref with `git rev-parse --verify` when `expectedHash` is provided)
  - `libs/backend/vscode-core/src/services/git-info.service.ts:2572` (`stashShow` pre-verifies ref with `git rev-parse --verify` when `expectedHash` is provided)
- **Tests**:
  - `libs/backend/vscode-core/src/services/git-info.service.remote-stash.spec.ts`:
    - `populates full commit hash on each stash entry`
    - `verifies expectedHash before running apply, pop or drop mutation`
    - `verifies expectedHash in stashShow before reading contents`
  - `libs/backend/vscode-core/src/services/git-info.service.spec.ts`:
    - `parses tab-separated stash list output into StashEntry[]`
  - `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.spec.ts`:
    - `delegates expectedHash when provided`
    - `rejects invalid params {"index":0,"expectedHash":"not-a-hash"} without invoking git`
    - `rejects invalid params {"index":0,"expectedHash":"1234"} without invoking git`

### Item 2: Defect 2 — StashList Cache Removal (No-Cache)

- **Status**: fixed
- **Files**:
  - `libs/backend/vscode-core/src/services/git-info.service.ts:2446` (`stashList` returns `computeStashList` directly, stopping `cachedRead`)
- **Tests**:
  - `libs/backend/vscode-core/src/services/git-info.service.remote-stash.spec.ts`:
    - `immediately reflects an external git stash drop without caching`

### Item 3: Defect 3 — Network Verbs Auth Failure & GIT_TERMINAL_PROMPT=0

- **Status**: fixed
- **Files**:
  - `libs/backend/vscode-core/src/services/git-info.service.ts:235` (`isGitAuthFailure` classifier)
  - `libs/backend/vscode-core/src/services/git-info.service.ts:1006` (`push` passes `GIT_TERMINAL_PROMPT=0` and handles authentication failure)
  - `libs/backend/vscode-core/src/services/git-info.service.ts:1097` (`runRemoteSync` for `pull`/`fetch` passes `GIT_TERMINAL_PROMPT=0` and handles authentication failure)
- **Tests**:
  - `libs/backend/vscode-core/src/services/git-info.service.spec.ts`:
    - `push passes GIT_TERMINAL_PROMPT=0 and translates auth failures`
    - `pull passes GIT_TERMINAL_PROMPT=0 and translates auth failures`
    - `fetch passes GIT_TERMINAL_PROMPT=0 and translates auth failures`

### Item 4: Defect 6 — Terminal Launch Fallback to Next Detected Candidate

- **Status**: fixed
- **Files**:
  - `libs/backend/platform-core/src/utils/terminal-launch.ts:172` (`spawnTerminalProcess` loops over subsequent candidates when launch fails before throwing)
  - `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:185` (`openDetected` loops over all matching candidates for `targetId` on launch failure)
- **Tests**:
  - `libs/backend/platform-core/src/utils/terminal-launch.spec.ts`:
    - `tries the next candidate when the first candidate fails to start`
  - `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.spec.ts`:
    - `tries the next detected candidate when the first candidate launch fails`

### Item 5: Defect 7 — StashShow Untracked Files from Parent 3

- **Status**: fixed
- **Files**:
  - `libs/backend/vscode-core/src/services/git-info.service.ts:2605` (`stashShow` checks `git rev-parse --verify --quiet stash@{N}^3` and includes untracked files via `ls-tree -r --name-only -z` as status `'A'`)
- **Tests**:
  - `libs/backend/vscode-core/src/services/git-info.service.remote-stash.spec.ts`:
    - `includes untracked files from parent 3 as status A in stashShow`

---

## Verbatim Verification Outputs

### Test Execution

Command:

```bash
npx nx run-many -t test -p @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/platform-core @ptah-extension/shared --parallel=1
```

Header and Summary:

```
 NX   Running target test for 4 projects:

- @ptah-extension/platform-core
- @ptah-extension/shared
- @ptah-extension/vscode-core
- @ptah-extension/rpc-handlers

Test Suites: 101 passed, 101 total
Tests:       33 skipped, 3074 passed, 3107 total
Snapshots:   0 total
Time:        34.158 s
Ran all test suites.

 NX   Successfully ran target test for 4 projects
```

### Typecheck Execution

Command:

```bash
npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/platform-core @ptah-extension/platform-electron @ptah-extension/platform-cli @ptah-extension/platform-vscode @ptah-extension/vscode-core @ptah-extension/rpc-handlers @ptah-extension/cli-engine
```

Header and Summary:

```
 NX   Running target typecheck for 8 projects:

- @ptah-extension/shared
- @ptah-extension/platform-core
- @ptah-extension/platform-electron
- @ptah-extension/platform-cli
- @ptah-extension/platform-vscode
- @ptah-extension/vscode-core
- @ptah-extension/rpc-handlers
- @ptah-extension/cli-engine

> nx run @ptah-extension/platform-core:typecheck

> tsc --noEmit --project libs/backend/platform-core/tsconfig.lib.json


> nx run @ptah-extension/shared:typecheck

> tsc --noEmit --project libs/shared/tsconfig.lib.json


> nx run @ptah-extension/vscode-core:typecheck

> tsc --noEmit --project libs/backend/vscode-core/tsconfig.lib.json


> nx run @ptah-extension/platform-cli:typecheck

> tsc --noEmit --project libs/backend/platform-cli/tsconfig.lib.json


> nx run @ptah-extension/platform-electron:typecheck

> tsc --noEmit --project libs/backend/platform-electron/tsconfig.lib.json


> nx run @ptah-extension/platform-vscode:typecheck

> tsc --noEmit --project libs/backend/platform-vscode/tsconfig.lib.json


> nx run @ptah-extension/rpc-handlers:typecheck

> tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json


> nx run @ptah-extension/cli-engine:typecheck

> tsc --noEmit --project libs/backend/cli-engine/tsconfig.lib.json




 NX   Successfully ran target typecheck for 8 projects
```
