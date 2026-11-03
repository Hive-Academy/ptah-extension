# Review G5 revise round 1

Verdict: REVISE  
Score: 7/10

## Defects

1. **Medium — Cross-project source imports violate the stated import boundary** (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.resume-permission.spec.ts:25-34`). The three `typeof import('../../../../../agent-sdk/src/lib/...')` references and matching `jest.requireActual` paths reach into another library's `src/lib`. Use the `@ptah-extension/agent-sdk` public alias or expose a suitable public test seam. This is a new spec, even though nearby older specs use the same pattern.
2. **Low — The extra “reference” fingerprint check is circular** (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.resume-permission.spec.ts:200-223,243-245`). `referenceFingerprint` takes `resumed.profile.permissionLevel` and feeds it to the same `buildCodexExecutionProfile` implementation used by the host. It checks builder consistency, not an independent expected fingerprint. The separate comparison with `saved.identity.profileFingerprint` at lines 240-242 *is* independent across save and resume and catches a wrong restored level; keep that check and remove or replace the redundant reference assertion.

## Notes

- The two earlier blocking defects are resolved for the host resume-profile path. `saveAndClose` writes an identity into a stateful map; `readResumeIdentity` reads it on the reopened `createCodexChatHostPorts` instance. The resume call at line 233 supplies no permission level or fingerprint. The host selects the saved workspace level at `codex-chat-host-ports.ts:387` and builds the profile at line 413. Forcing Ask or ignoring the saved setting would fail the Auto-edit and Plan cases at lines 239-242. The Ask case catches a restore to a different level.
- The persisted-fingerprint comparison is a precondition check rather than an actual `CodexRuntime.open` refusal test. The low-level runtime specs retain supplied profiles, and their new names state that limitation honestly.
- The inspected production path has no apparent restoration gap: Electron binds `readSavedPermissionLevel` to scoped settings in `apps/ptah-electron/src/di/codex-runtime-composition.ts:498-502`; the host reads the saved level when resume config omits it. No production change appears necessary for this issue.
- Static inspection found `import 'reflect-metadata';` first, no readonly mock assignment, private-member bracket access, `any`, `as unknown as`, `@ts-ignore`, `eslint-disable`, excess typed fixture properties, or pending real timer in the new spec. The runtime additions use `setImmediate` flushes and label their supplied-profile behavior accurately. Tests, verification, lint, typecheck, diagnostics, builds, Nx, and npm were prohibited and were not run. `rg` was access-denied; PowerShell source search was used after Ptah's symbol index returned no usable results. Skill discovery found no locally invocable code-review skill.
