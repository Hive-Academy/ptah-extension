# Phase B round 2 L2 report

## Changes

| Finding | Change | Source | Spec |
| --- | --- | --- | --- |
| N4 | Extracted small boot attach helpers for Electron, VS Code phase 2 and CLI container. Coordinator resolution and observer attachment errors are caught, logged with a fixed line and `error.name`, and return to the next boot step. | `apps/ptah-electron/src/activation/bootstrap.ts:237,503`; `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:87,194`; `libs/backend/cli-engine/src/lib/container.ts:283,698` | `bootstrap.attention.spec.ts` resolve/attach cases; `phase-2-libraries.attention.spec.ts` resolve/attach cases; `container-attention.spec.ts` resolve/attach cases. The full boot functions need large host DI graphs, so specs exercise the extracted same-file helpers. |
| N5 | Electron considers the renderer ready after its `attention:getSnapshot` RPC from the registered Angular chat attention handler. Readiness is scoped to the current WebContents and reset on reload. The adapter retains at most the latest pending Open route and rechecks the generation before delivery. | `apps/ptah-electron/src/activation/bootstrap.ts:206,274,293`; `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:34,133` | `bootstrap.attention.spec.ts` verifies snapshot handshake, sender and reload; `electron-host-attention-notifications.spec.ts` verifies the bounded cold-start route. |
| N8 | Replaces a shared Electron native handle with an accurate remaining count when one burst member resolves. The last remaining member returns to the single-request body. | `libs/backend/platform-electron/src/implementations/electron-host-attention-notifications.ts:71,96` | Updated burst case in `electron-host-attention-notifications.spec.ts` checks the refreshed body, current click target and close counts. |
| N9 | Removed unused MCP host-attention resolver injection and passage through the HTTP service, dispatcher, approval handler and permission-prompt cleanup. MCP approval stays in-app. | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:310,392`; `mcp-core/protocol-dispatcher.ts:304,1035`; `mcp-core/approval-prompt.handler.ts:9,41,68`; `permission/permission-prompt.service.ts:34,64,163` | Updated approval handler, dispatcher and permission-prompt service specs for in-app resolution. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the renderer's attention snapshot RPC as the Electron readiness handshake. | Page-load event, new frontend ready message, existing snapshot RPC. | `ChatAttentionHostMessageHandler` registers its message handler before its constructor queues `reconcile()`, which sends `attention:getSnapshot`; this is the first reliable observable message from that handler. The current `did-finish-load` was earlier than Angular registration. | Yes |
| Keep only one pending Open route. | Unbounded map, latest route. | A native Open action represents the latest user click; the pending generation is rechecked on delivery. | Yes |
| Remove ownerless MCP resolver plumbing. | Keep dormant resolver with comment, remove it. | MCP approvals have no trustworthy owner session, so coordinator claims none; the extra resolver could never match a host notice. | Yes |

## Not done

- No Nx, Jest, TypeScript, lint, build, diagnostics or other test command ran, per the memory-safe instruction. Specs are written but unexecuted.
- The out-of-scope census `libs/backend/vscode-core/src/api-wrappers/host-attention-ingress.spec.ts` must be adjusted for N9. Its line 54 `expect(source).toMatch(/hostAttention\?\.resolve\s*\(\s*attentionRequestKey\s*\(/)` now fails for the MCP approval producer, and its line 61 `expect(approvalCall).toMatch(/\bhostAttention\s*(?::|[,}])/)` now fails for the dispatcher. The MCP producer should be exempt from the host-release assertion because it is ownerless and remains in-app; its presence in the emission census can stay.
