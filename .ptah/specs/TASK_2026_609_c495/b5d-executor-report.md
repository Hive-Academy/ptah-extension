# B-5d executor report: harness-sync emission core (Task B-5d.1)

Verdict: implemented. Scoped typecheck and lint pass. The test run shows only the 17 baseline failures.

## Files changed (six, all in the batch list)

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\sources\harness-source.port.ts
  - Adds `HarnessSourceState.agentModels?: AgentModelLayers`, typed from `@ptah-extension/shared`.
  - Absent means "no model anywhere".
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\manifest\desired-state.types.ts
  - Adds `HarnessDesiredAgent.models?: Partial<Record<AgentModelProvider, string>>`.
  - The field is absent when no rival provider has a model.
  - Claude is never a key.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.ts
  - Optional constructor `warn` callback. It follows the `ManagedManifestStore` pattern and is silent by default.
  - Private `resolveAgentModels`. For each of codex, copilot, cursor and opencode it calls `resolveAgentModel(layers, slug, provider)?.value`, then gates the value with `isAgentModelEmittable`. A value that fails the gate is skipped with `warn('[harness-sync] agent model not written: not emittable', { slug, provider, scope, wildcard })`. The value itself is not logged.
  - Two exported pure helpers:
    - `desiredAgentModel(agent, target)`
    - `desiredAgentSourceHash(agent, target)`: returns `contentHash` when the target has no model, else `hashContent(contentHash + "\nmodel:" + model)`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\manifest\harness-manifest.builder.spec.ts
  - New describe block "HarnessManifestBuilder agent models (C6)" with 6 cases. Existing cases are unchanged.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\workspace-target.ts
  - The agent entry uses `desiredAgentSourceHash(agent, this.id)` and renders with the target's model.
  - `DesiredEntry.model?` is copied onto the plan write.
  - `writeArtifact` passes the same model to `transform`, so apply writes the bytes plan hashed.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-609-subagent-setup\libs\backend\harness-sync\src\lib\targets\transformers\agent-transformer.port.ts
  - Adds `HarnessAgentSource.model?: string`.

Not touched: the four transformers (B-5e), `rpc.types.ts` (PR8), `harness-target.port.ts`, `register.ts`.

`classifyAgentModelValue` is never called, and no provenance field was added. `grep classifyAgentModelValue libs/backend/harness-sync` finds nothing.

## Evidence per spec case (`harness-manifest.builder.spec.ts`, new block)

1. **[AC4] A Claude-only setting gives a rival agent no `models` field.**
   - Setup: workspace `backend-developer.claude='opus'` and machine `*.claude='sonnet'`.
   - Asserts that `'models' in agent` is false.
   - Asserts that `desiredAgentModel` is undefined for all four rival targets.
   - Asserts that `warn` is not called.
2. **[AC8] With no models, the agent and every target source hash are unchanged.**
   - Builds the agent twice: with no `agentModels`, and with empty layers (`{ workspace: {}, machine: null }`).
   - Asserts that both results `toEqual` exactly `{ slug, sourceFile, contentHash: hashFile(source) }`, which is the pre-change shape.
   - Asserts that `desiredAgentSourceHash` equals the file hash for all four targets.
3. **A present model changes only that target's source hash.**
   - Setup: `codex='gpt-5-codex'`.
   - `models` is `{ codex }` and `contentHash` is still the file hash.
   - The codex source hash differs from `contentHash`; the cursor source hash equals it.
   - A different codex value gives a different codex hash.
4. **A non-emittable value is skipped with a warning; the other values are kept.**
   - Setup: opencode `'no-provider-prefix'` (fails the OpenCode syntax), copilot `'gpt\n5'` (control character), cursor `'sonnet-4'`.
   - Result: `models` is `{ cursor: 'sonnet-4' }`.
   - `warn` is called twice, with `provider: 'opencode'` and `provider: 'copilot'`.
5. **The workspace layer beats the machine layer, per provider.**
   - The workspace slug value beats the machine slug value for codex.
   - The workspace `*` value beats the machine slug value for opencode.
   - The machine `*` value applies for cursor.
6. **Plan/apply consistency (added because apply re-transforms).**
   - Setup: a real `WorkspaceHarnessTarget('codex')` with a recording fake transformer.
   - The plan write's `sourceHash` equals `desiredAgentSourceHash`.
   - The file written by apply contains `model = "gpt-5-codex"`.
   - `hashContent(file) === plan.writes[0].hash === result.written[rel].hash`.
   - Every `transform` call received the model.

Direct run of the spec (`npx jest -c jest.config.ts src/lib/manifest/harness-manifest.builder.spec.ts` in `libs/backend/harness-sync`): `Tests: 16 passed, 16 total`. That is the 10 existing cases plus the 6 new ones.

## Check output (tailed)

```
npx nx run-many -t typecheck,lint -p @ptah-extension/harness-sync
√  nx run @ptah-extension/harness-sync:lint
√  nx run @ptah-extension/harness-sync:typecheck
Successfully ran targets typecheck, lint for project @ptah-extension/harness-sync
```

```
npx nx run-many -t test -p @ptah-extension/harness-sync --maxWorkers=2 --skip-nx-cache
Test Suites: 5 failed, 49 passed, 54 total
Tests:       17 failed, 477 passed, 494 total
```

The failing suites are agent-consent, cancellation, gitignore, skill-consent and write-failure. The failing tests by name:

- agent-consent: 2
- skill-consent: 7
- gitignore E23: 5
- cancellation B8: 2
- write-failure E21: 1

This is exactly the 17-test baseline in batches.md "Batch 1a result". The capability-policy C3 flake passed on this run. No failure is in `harness-manifest.builder.spec.ts` or any file this batch touched.

## How AC4, AC8 and PR1 were held

- **AC4**
  - The builder only iterates the rival providers (`AGENT_MODEL_PROVIDERS` minus `claude`).
  - `resolveAgentModel` reads only the requested provider's leaf, so a Claude value never fills a rival slot.
  - `models` is set only when at least one rival value survives the gate.
  - Spec case 1 checks this.
- **AC8**
  - The builder never folds a model into `contentHash`. The fold is applied per target, in `desiredAgentSourceHash`, and only when that target has a model.
  - With no model, the agent object, the `sourceHash` written to the manifest, `preflightKeys`, and the transformer input (no `model` key is spread) are all identical to before.
  - Existing copies are therefore not rewritten.
  - Spec case 2 checks this, and the unchanged pass/fail set of the reconciler specs is consistent with it.
  - Per-target folding also means that changing the Codex model rewrites only the Codex copy.
- **PR1**
  - `workspace-target.ts` adds no new method and no helper body. The hash and model logic lives in the builder module.
  - The additions are: one import, a model lookup, the model argument to `renderAgent`, a conditional spread on the entry and the write, a guarded read in `writeArtifact`, one optional field, and one local type.
  - The file is 1265 → 1293 lines, comments included. Lint still reports only the pre-existing max-lines warning, and the target passes.

## Plan deviations

- **Where the source-hash fold lives.** The fold is computed per target with the exported `desiredAgentSourceHash`, not folded into `HarnessDesiredAgent.contentHash` inside `build()`.
  - Reason: a single fold over all providers would change every rival copy's `sourceHash` whenever any one provider's model changed, which causes spurious rewrites.
  - This still meets "folds the model only when present".
- **How the model reaches apply.** `apply()` receives only the plan, and re-transforms the agent at write time.
  - The plan write carries the model through a local `AgentModelPlanWrite = HarnessPlanWrite & { model?: string }` type.
  - `writeArtifact` reads it with an `in` + `typeof` guard, so there is no cast.
  - The reconciler passes plan write objects through by reference (`filter` only).
  - The cleaner home would be `HarnessPlanWrite.model?` in `targets/harness-target.port.ts`, which is not in this batch's file list. If the team-leader prefers that, it is a two-line move.
- **Logger.** The builder takes a `warn` callback, the same pattern as `ManagedManifestStore` and `HarnessStateStore`, rather than a `Logger`. `register.ts` still constructs `new HarnessManifestBuilder()`, so in production the warning is silent until that call is wired. See below.

## Out-of-scope observations

- `libs/backend/harness-sync/src/lib/di/register.ts:134` should become `new HarnessManifestBuilder((message, detail) => logger.warn(message, toDetail(detail)))` so the non-emittable warning reaches the host log (plan: `logger.warn` on emission skips). It is a one-line change in a file outside B-5d. B-5f1 or a later harness-sync batch should own it.
- B-5e: each transformer must emit `model` only when `source.model !== undefined`. The port contract and the plan/apply path now deliver it.
