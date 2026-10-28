# B2 bounded correction review

Direct source inspection of the correction and its caller paths; no git, tests, or builds run. Source files were not modified.

| Claim | Status | Evidence file:line |
| --- | --- | --- |
| Descriptor map includes disabled installed external plugins | VERIFIED | `libs/backend/agent-sdk/src/lib/helpers/plugin-loader.service.ts:664` iterates every installed external record without enable-state filtering. `libs/backend/plugin-marketplace/src/lib/install/external-plugin-state.store.ts:143` returns the complete recorded-install list. Bundled, harness, and skills.sh descriptors are added at `plugin-loader.service.ts:639`, `:646`, and `:656`. The map is conservatively broader than existing directories because bundled entries and install records need not have downloaded content. |
| All three hosts pass the descriptor map | VERIFIED | Electron: `apps/ptah-electron/src/activation/plugin-activation.ts:365`; VS Code: `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:114`; CLI: `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts:101`. Each passes `getPluginSourceDescriptors()` independently of enabled-path selection. |
| Ambiguity includes installed sources omitted from the pass | VERIFIED | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:211` unions resolved pass paths and descriptor keys, deduplicating paths before counting basenames. Agent mirror/reconcile use it at `:255` and `:275`; skill/command reconcile supplies descriptors at `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:646`. |
| Descriptor-less harness caller cannot assign source identity | VERIFIED (sourceRef/sourceLabel) | The actual caller is `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:176`: it invokes only `mirrorAll` for one harness root, with no descriptors. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:128` preserves the sidecar unchanged when no descriptor exists. This confirms the narrow identity claim; absence of a descriptor alone is not a general proof against content mutation in arbitrary callers. |
| Remaining B2 gap | FIXED | With A disabled but still described, A and B now produce a shared basename. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.ts:187` returns ambiguous for the legacy sidecar; `:405` preserves it during agent mirroring. Reconcile guards at `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1767` and `:1841` return before identity assignment or content reconciliation; `:1893` logs ambiguity. |
| Regression coverage matches the reported scenario | VERIFIED BY INSPECTION | `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-mirror.service.plugin-agents.spec.ts:640` disables A by passing only B while retaining both descriptors, then asserts preserved agent/skill bodies, absent sourceRef, and ambiguity warnings. `:619` checks adoption when only A remains described. `libs/backend/agent-generation/src/lib/services/user-layer/user-layer-plugin-agents.spec.ts:118` checks disabled-source counting and path deduplication. Tests were not executed. |

## New defects

1. None identified at Blocking or Serious severity in this bounded correction.

Verdict: APPROVED
