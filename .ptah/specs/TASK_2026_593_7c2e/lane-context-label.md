# Attention context labels

## Root cause

`ChatAttentionSourceService.add()` used `owner?.workspacePath ?? ''` and never set `AttentionItem.context` (`libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:121,160`). `TabWorkspacePartitionService.findTabByIdAcrossWorkspaces()` can return a matching active tab with `workspacePath: null` when no partition path is active (`libs/frontend/chat-state/src/lib/tab-workspace-partition.service.ts:329-338`). That is an intentional lookup contract, especially for an unpartitioned tab set. The host projection similarly labeled a nonlocal target `Unknown workspace` (`libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:179-204`). Electron exposes its startup workspace root through `window.ptahConfig` (`apps/ptah-electron/src/preload.ts:35-40`), but neither attention path used that fallback. The renderer templates already had context bindings, while the snackbar previously chose context *or* workspace name, hiding the latter whenever context existed.

## Changed files

- `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts`
- `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts`
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts`
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts`
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts`
- This report.

## Context format

Parts are joined with ` · ` and rendered by Angular interpolation. Local request context uses a known provider label, a nondefault tab title, and `Tool: <toolName>` for permissions or the first question collapsed to one line and truncated to 80 characters. Examples: `Claude · Fix notifications · Tool: Bash` and `Claude · Fix notifications · Which option should we choose?…`. Unsafe path or secret-like title/question strings and invalid tool names are omitted. The bell row renders the workspace basename on its own line; the snackbar appends it to the single muted context line, for example `Claude · Fix notifications · Tool: Bash · ptah-extension`. A host projection uses the payload session title and a locally verified provider if available; its wire payload has no tool or question field. Labels select the tab owner's workspace first, then the active workspace, then the renderer startup root, and use `Unknown workspace` only if all are absent. The opaque projection workspace identity used for routing remains unchanged. Stable source values keep `JSON.stringify` reconciliation deterministic.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts --coverage=false --maxWorkers=2`: **PASS**, 2 suites and 23 tests. Jest reported a worker teardown warning after passing.
- `NX_DAEMON=false npx nx typecheck @ptah-extension/chat --parallel=1`: **PASS**, `Successfully ran target typecheck`. It emitted existing NG8107 warnings in other files.
- `NX_DAEMON=false npx nx run-many -t typecheck,lint,test -p @ptah-extension/notification-center --parallel=1`: **PASS**, all three targets.
- `ptah_get_diagnostics` on changed notification files: no diagnostics in requested files; five BigInt target errors appeared in untouched shared sibling files. An earlier scoped diagnostic attempt timed out; Nx typechecks above completed.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep the partition lookup contract and resolve the label in the attention sources | Changing `findTabByIdAcrossWorkspaces()` versus fallback at presentation. The lookup documents null for unpartitioned active tabs; `TabManagerService` exposes `activeWorkspacePath`, and Electron preload exposes a startup root. | Yes |
| Show host session title as context without a tool or question | The strict `AttentionNoticeSchema` exposes `title` and `target` only; adding wire fields is outside this batch. | Yes |
| Reuse existing muted template classes and interpolation | Both notification templates already render context with `text-base-content-muted`; the snackbar needed to retain the workspace name when context exists. | Yes |

## Not done

No Electron UI screenshot or end-to-end run was requested. The host wire payload does not provide tool or question text, so remote projections can only show the session title and any locally verified provider.
