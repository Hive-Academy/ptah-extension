# Batch G5 revise round 1 report

## Files changed

- `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-host-ports.resume-permission.spec.ts` (new)
- `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/batch-g5-revise-1.md`

No production code changed.

## Host resume specs

The new parameterized spec runs once for each saved level: `auto-edit`, `ask`, and `plan`.

Each case drives this sequence:

1. Save the selected level in a stateful workspace-settings fixture.
2. Build the initial session profile through `createCodexChatHostPorts(...).profile(...)` with that explicit level.
3. Persist the resulting thread identity and profile fingerprint in a stateful in-memory identity store.
4. Mark the identity inactive to model close while retaining it for resume.
5. Create host ports again and resume through `profile(config, sessionId)` with no `permissionLevel` in `config`.
6. Read the identity through the host `readResumeIdentity` dependency and the level through the real `resolveSavedCodexPermissionLevel` function.

Each case asserts:

- The resumed identity is the identity returned by the stateful store.
- The host reads the saved level for the original workspace.
- The reopened profile has the saved level.
- The reopened fingerprint equals the persisted identity fingerprint.
- The reopened fingerprint also equals an independent fingerprint reference built by the real `buildCodexExecutionProfile` function.

These assertions exercise `codex-chat-host-ports.ts` resume identity loading, profile construction, saved-level selection, and fingerprint generation. The fingerprint equality is the precondition that prevents the resume-profile refusal in `codex-runtime.ts:51-55`.

## Why a wrong level fails

The resumed profile level is compared directly with the level saved before close. A host that restores `ask` after `auto-edit` or `plan` fails that assertion. A host that restores any other incorrect level also fails it.

A wrong level also changes the execution policy fingerprint. The resumed fingerprint then differs from the persisted identity fingerprint. The Auto-edit and Plan cases therefore detect both the wrong level and the runtime refusal condition. The Ask case detects any restoration to a non-Ask level.

The resume call supplies neither the expected level nor a fingerprint. The host must obtain both through its production read and build path.

## Runtime spec corrections

The three prior runtime specs remain as low-level runtime coverage, with honest names:

- `resumes with a supplied Auto-edit profile and auto-accepts a plain file change`
- `resumes with a supplied Ask profile and keeps a plain file change interactive`
- `resumes with a supplied Plan profile and declines a plain file change`

Their helper is now named `resumeWithProfile`. These specs prove runtime resume behavior for a supplied profile. They do not claim to prove host-level restoration or stateful persistence. The new host spec covers that gap.

## Production gap

None found. The current host path reads the saved workspace level when the resume config has no explicit level. It rebuilds the profile and fingerprint through `buildCodexExecutionProfile`. No `it.todo` is needed.

## Verification

The lane rules prohibited tests, lint, typecheck, diagnostics, builds, Nx, and npm commands. None ran. The new spec passed a TypeScript AST parse with no error nodes.

Verify these Nx projects:

- `@ptah-extension/rpc-handlers`
- `@ptah-extension/codex-runtime`

Scoped command for the coordinator:

```sh
npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/codex-runtime
```
