# Batch A8 report

| File:line | Change |
| --- | --- |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.ts:6` | Claims generation workflow sessions in the active workspace and navigates to their generation route. |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.service.ts:6` | Claims builder workflow sessions in the active workspace and navigates to their builder route. |
| `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-router.service.ts:6` | Claims the active apps session and navigates to the apps page. |
| `libs/frontend/setup-wizard/src/lib/services/wizard-internal-state.provider.ts:29` | Registers all three `SURFACE_FOCUS_ROUTER` multi providers through the existing root provider helper. |
| `libs/frontend/harness-builder/src/services.ts:30`; `libs/frontend/mcp-apps-page/src/index.ts:3` | Exports routers for registration. |
| `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.ts:181` | Resolves tab-less or surface-mode host targets through a matching session owner; Open remains snapshot guarded. |
| `libs/frontend/chat/src/lib/services/chat-attention-source.service.ts:129` | Enables Open for a tab-less live request when a surface router owns its session. |

## New specs

| File:line | Coverage |
| --- | --- |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.spec.ts:29` | Owned and foreign sessions; successful focus and missing result. |
| `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.service.spec.ts:29` | Owned and foreign sessions; already-there focus and missing result. |
| `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-router.service.spec.ts:23` | Active and foreign sessions; successful focus and missing result. |
| `libs/frontend/chat/src/lib/services/chat-attention-host-message-handler.service.spec.ts:196` | Tab-less host projection and guarded Open dispatch to its surface. |
| `libs/frontend/chat/src/lib/services/chat-attention-source.service.spec.ts:110` | Tab-less live request exposes enabled Open. |

## Decisions

- Router ownership is resolved from the session binding. No `surfaceKind` field was added to `AttentionItem`; the host target's existing optional `surfaceKind` is honored when present.
- Builder and generation routers claim tabs only in the active workspace. Apps claims its active session. This avoids opening a different workspace's surface while leaving its session unresolved.
- The existing `provideWizardInternalState()` call in webview app config supplies the root multi providers without editing that out-of-scope file. This does introduce eager imports of the apps and harness router services; bundle impact should be reviewed by the orchestrator.

## Not done

- Nx, Jest, and TypeScript checks were not run, as directed. Changes were self-checked by reading the touched source and specs.
