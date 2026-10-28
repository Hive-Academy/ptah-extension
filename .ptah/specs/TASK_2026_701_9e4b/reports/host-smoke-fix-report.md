# Host smoke fix report — TASK_2026_701_9e4b (Batch 11 follow-up)

## Cause

`GenerationPreviewService` (libs/backend/rpc-handlers/src/lib/handlers/wizard-generation/generation-preview.service.ts:241-249)
injects four dependencies:

| Pos | Token | Status in the host minimal containers |
| --- | --- | --- |
| 0 | `TOKENS.LOGGER` | already registered |
| 1 | `PLATFORM_TOKENS.DI_CONTAINER` | already registered (`useValue: c`) |
| 2 | `GenerationCheckpointService` (class token, `@injectable`) | auto-resolves; its own deps (LOGGER, DI_CONTAINER, ...) were already satisfied because `WizardGenerationRpcHandlers` used it before Batch 11 |
| 3 | `AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE` (`Symbol.for('WizardAgentOriginStore')`) | **missing** in all three hosts |

`AGENT_ORIGIN_STORE` is part of the public `AGENT_GENERATION_TOKENS` object
(libs/backend/agent-generation/src/lib/di/tokens.ts:181-202), so the specs use the
already-imported `AGENT_GENERATION_TOKENS`. Production registers it in
libs/backend/agent-generation/src/lib/di/register.ts:181-182; no production change.

## Files changed

- MODIFIED apps/ptah-electron/src/di/container.smoke.spec.ts
- MODIFIED apps/ptah-extension-vscode/src/di/container.smoke.spec.ts
- MODIFIED apps/ptah-cli/src/di/container.smoke.spec.ts

Each got the same stub after the `ANALYSIS_STORAGE_SERVICE` stub, shaped to the
service's `AgentOriginReader` type (`Pick<WizardAgentOriginStore, 'read' | 'hashWrittenFile'>`):

```ts
c.register(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, {
  useValue: { read: jest.fn(), hashWrittenFile: jest.fn() },
});
```

with a comment in the existing style naming Batch 11 `GenerationPreviewService`
and where the real container registers the token.

## Guards

`expected-resolvable.ts` / `rpc-surface.spec.ts` need no change: Batch 11 adds no
new resolvable handler class, and the only failing test in each host target was the
`WizardGenerationRpcHandlers` resolution case; all other guard tests in those
targets pass in the run below.

## Verification

`npm run verify -- -t test -p ptah-electron,ptah-extension-vscode,ptah-cli`
→ `NX   49 tasks: 49 succeeded, 44 cached` (no failures; the three host test
targets plus their dependency tasks).

## Decisions

- Stub with `useValue` rather than registering the real `WizardAgentOriginStore`:
  matches how every other agent-generation token is stubbed in these minimal
  containers and keeps the smoke specs free of file-system state. Reversible.
