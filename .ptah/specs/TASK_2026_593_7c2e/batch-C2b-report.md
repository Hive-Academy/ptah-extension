# Batch C2b report

| File:line | Change |
| --- | --- |
| `libs/frontend/git-ui/src/lib/services/git-status-attention.service.ts:27` | Root service keeps git status listening across dock unmounts and projects one keyed warning per active workspace. Visibility suppresses its snackbar while keeping Recent; recovery or workspace change resolves it. |
| `libs/frontend/git-ui/src/lib/services/git-status-attention.service.ts:72` | Implements the `NOTICE_ACTION_HANDLER` Retry contract. It refreshes the active workspace and reports completed on recovery or unavailable when retry cannot apply or status stays unavailable. |
| `libs/frontend/git-ui/src/lib/services/git-status-attention.service.ts:95` | `provideGitStatusAttention()` starts the service with an environment initializer and registers the multi action provider. |
| `libs/frontend/git-ui/src/index.ts:16` | Exports the app startup provider. |
| `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts:388` | Removes notice publication and git listener ownership; keeps only the dismissible local strip and its Retry. |
| `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.spec.ts:393` | Updates shell arming expectations and tests local Retry, dismiss, recovery, visibility independence, and workspace change. |
| `libs/frontend/git-ui/src/lib/services/git-status-attention.service.spec.ts:15` | Adds root service publication, snackbar lifetime, visibility, recovery, workspace change, and action handler specs. |

## Specs

The new service spec covers a warning with no shell mounted, visible dock suppression, hidden dock warning snackbar and 10-second expiry, one persistent Recent row, recovery, workspace change, and Retry outcomes. The shell spec now checks that shell destruction leaves the root git listener alone and that the local strip resets after recovery or workspace change.

## Decisions

- The root service owns `GitStatusService.startListening()` and stops it when the root injector is destroyed. The shell no longer starts or stops git status, so publication can continue after dock unmount.
- The handler accepts Retry only for the active workspace's `git-status-unavailable` key. A stale key, wrong generation, or recovered condition returns unavailable without refreshing. A refresh that leaves the condition active returns unavailable with fixed text.
- The warning uses `NotificationService`'s 10-second warning clock. Inline suppression is applied before publication when the dock is visible. The notice contains no raw git diagnostics and does not affect the badge count.
- No Nx, Jest, or TypeScript command was run, as required. `git diff --check` found no whitespace errors in the tracked git UI edits.

## Not done

- Another lane owns the call to `provideGitStatusAttention()` in `apps/ptah-extension-webview/src/app/app.config.ts` and the shared non-chat dispatcher route.
- `apps/ptah-extension-webview/src/app/git-dock-arming-identity.spec.ts` still asserts that shell destroy closes the git status push gate. That expectation now conflicts with root service ownership and needs an update outside this batch's file scope.
