# B-P sub-batch P3 — Contract and RPC (TASK_2026_620_a13e)

Plan: `pause-switches-plan.md` §3.1, §3.4, §3.6, §3.7, §4 "P3", §5 rpc-handlers row. Nothing committed.

## Files changed

Worktree root: `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`

- MODIFIED `…\libs\shared\src\lib\types\rpc\rpc-error-codes.types.ts`: adds `'PAUSED'` to `RpcUserErrorCode` (:34)
- MODIFIED `…\libs\shared\src\lib\types\rpc\rpc-curator-diagnostics.types.ts`: adds `enabled` to the memory trigger params and results (:228, :234, :242)
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.schema.ts`: `MemorySetTriggersParamsSchema.enabled: z.boolean().optional()`
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.ts`: adds `readMemoryEnabled()` (:225). `setTriggers` writes `memory.enabled` only when `enabled` is sent and returns it (:784). `getTriggers` returns it (:815). `runNow` refuses while paused (:673-677).
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts`: `updateSettings` calls `this.synthesis.restartCurator()` (:663) instead of `curator.stop()/start()`. The now-unused `start`/`stop` are removed from the local `ICuratorService`. Adds `assertSkillsNotPaused()` (:2661) and calls it from 4 manual RPCs.
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.handlers.spec.ts`: new describe "memory pause switch" (:2098)
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\memory-rpc.schema.spec.ts`: new describe for `enabled` (:267)
- MODIFIED `…\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts`: `makeSynthesis()` gains `restartCurator: jest.fn()`. New describes "manual runs while skills are paused" (:4823) and "updateSettings curator restart" (:4957).

## Shared contract for P4

```ts
// rpc-error-codes.types.ts
RpcUserErrorCode |= 'PAUSED';

// rpc-curator-diagnostics.types.ts
interface MemorySetTriggersParams {
  readonly triggers: Partial<MemoryTriggersDto>;
  readonly enabled?: boolean;
}
interface MemorySetTriggersResult {
  readonly triggers: MemoryTriggersDto;
  readonly enabled: boolean;
}
interface MemoryGetTriggersResult {
  readonly triggers: MemoryTriggersDto;
  readonly enabled: boolean;
}
```

- **Memory switch:** call `memory:setTriggers` with `{ triggers: {}, enabled }`. An empty `triggers` writes no trigger key. `enabled` is written to `ptah.memory.enabled` only when it is present. The result carries `enabled` read back after the write.
- **Skills switch:** no contract change. Call `skillSynthesis:updateSettings({ settings: { enabled } })`. `enabled` was already in the write schema, and on its own it does not restart the curator.
- **Paused refusal:** the error arrives as an `RpcUserError` with `errorCode: 'PAUSED'`. The messages are `"Memory is paused"` and `"Skill synthesis is paused"`. These refusals are not reported to Sentry.
- No new RPC method names, so `RPC_METHOD_ENTRIES` and the host-source baseline are unchanged.

## Refused manual actions

Each one is checked after param validation, so bad input still returns `INVALID_PARAMS` first.

| RPC                                 | Gate                                                                      | Spec                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `memory:runNow`                     | `memory-rpc.handlers.ts:673-677`, after the workspace-authorization check | `memory-rpc.handlers.spec.ts:2098` "runNow throws PAUSED…" / "runNow curates once memory is resumed"                                |
| `skillSynthesis:runCurator`         | `skills-synthesis-rpc.handlers.ts:732`                                    | `skills-synthesis-rpc.handlers.spec.ts:4823` `it.each` (paused → PAUSED with no work and no Sentry report; on → runs; unset → runs) |
| `skillSynthesis:analyzeNow`         | `skills-synthesis-rpc.handlers.ts:846`                                    | same `it.each`, plus "analyzeNow reports INVALID_PARAMS before the pause check"                                                     |
| `skillSynthesis:enhanceNow`         | `skills-synthesis-rpc.handlers.ts:1106`                                   | same `it.each`                                                                                                                      |
| `skillSynthesis:previewEnhancement` | `skills-synthesis-rpc.handlers.ts:1157`                                   | same `it.each`                                                                                                                      |

How the switches are read:

- Skills uses `getConfiguration('ptah','skillSynthesis.enabled', FILE_BASED_SETTINGS_DEFAULTS[...])`. Only an explicit `false` pauses.
- Memory uses `MEMORY_TRIGGER_KEYS.enabled` with `MEMORY_TRIGGER_DEFAULTS`, the same read as `MemoryTriggerService.readMemoryEnabled`. A non-boolean value falls back to the default (on).

Both are re-read on every call.

Other §5 rpc-handlers rows are covered:

- `{triggers:{}, enabled:false}` writes only `memory.enabled`.
- `getTriggers` returns `enabled`.
- A non-boolean `enabled` is rejected, both by the schema and at the handler, and nothing is written.
- `updateSettings` with `curatorIntervalHours` or `curatorEnabled` calls `restartCurator` once and never calls `curator.stop`/`start`. `{enabled:false}` alone writes one key and does not restart.

## Boot changes per host

None. The plan assigns no boot file to P3, and the source already behaves as required:

- **Electron** (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`): `memoryTrigger.start()` (:286) runs regardless of `memory.enabled`. `skillSynthesis.start()` (:447) returns early when paused without throwing, and `startSkillTrigger()` (:420) then runs anyway.
- **CLI** (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`): `skillSynthesis.start()` (:289) and `skillTrigger.start()` (:307) run regardless of the master switch. `memoryTrigger.start()` (:266) depends only on the per-workspace `memory_enabled` row. That row is Follow-up F1 (user decision 2), not part of B-P.

So on both hosts the trigger services exist after a paused boot. Resuming without a restart relies on P1/P2: `maybeRearmBootScan` and `ensureStarted`.

## Checks

`npx nx run-many -t test,typecheck,lint -p shared --parallel=1`:

```
NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/shared
```

`npx nx run rpc-handlers:typecheck` is **blocked on P2 `restartCurator`**. That is the only error:

```
libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:663:26 - error TS2339: Property 'restartCurator' does not exist on type 'SkillSynthesisService'.
Found 1 error
```

`npx nx run rpc-handlers:lint`:

```
✖ 50 problems (0 errors, 50 warnings)
NX   Successfully ran target lint for project @ptah-extension/rpc-handlers
```

- The 4 warnings in my files are pre-existing: `max-lines` on both handler files, `SkillStatus` unused, `historyCount`.

rpc-handlers tests:

- With type diagnostics on (`npx jest src/lib/handlers/memory-rpc src/lib/handlers/skills-synthesis-rpc.handlers`), the suites fail to compile on other in-flight work. That run showed `../memory-curator/src/lib/triggers/memory-trigger.service.ts:219:5 TS2322` (P1, in progress), and the missing `restartCurator` (P2) also blocks them.
- The same three spec files with ts-jest `diagnostics: false`:

```
Test Suites: 3 passed, 3 total
Tests:       447 passed, 447 total
```

- The new P3 cases alone (`-t "pause|PAUSED|paused|restart|enabled"`): `Tests: 418 skipped, 29 passed, 447 total`.
- **Re-run needed** once P2 lands `restartCurator`: `npx nx run-many -t test,typecheck,lint -p shared rpc-handlers --parallel=1`.

`npx nx run degradation-audit:lint`:

```
libs/backend/rpc-handlers: 1 ok (baseline 1)
apps/ptah-electron: 5 FAIL (baseline 4)
```

- The `ptah-electron` failure is P5's in-progress file. P3 touched nothing in `apps/`.

`npx prettier --check <8 changed files>`:

```
All matched files use Prettier code style!
```

## Deviations

- `restartCurator()` is called on the agreed contract `restartCurator(): void` (public, synchronous, no args), which P2 has not landed yet. The coordinator will make P2 add exactly that signature.
- `updateSettings` no longer checks `this.curator` before restarting. The service owns the curator, including the case where it is absent.
- The memory pause message is `"Memory is paused"`. For skills the plan's `'<feature> is paused'` became `"Skill synthesis is paused"`.

## Out of scope

- The `ptah-electron` degradation-audit count (5 vs baseline 4) belongs to P5.
- `memory-trigger.service.ts:219` TS2322 (`IDisposable` vs `() => void`) belongs to P1 and was seen mid-edit.
- Frontend mocks of `MemoryGetTriggersResult` will need `enabled`. That is P4.

## Review fixes round 2

Source: `code-logic-review-b-p-backend.md` "Round 2". It covers finding 4 / N1 (moderate) and N4 (minor, skills side). Nothing is committed. The `memory-curator` and `tools/mcp-bench` files were not touched.

### N1: retried start brings up the skill trigger (Electron and CLI)

- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts`:
  - Adds `onStarted(listener): { dispose() }` (:523). The listeners are notified at the end of every successful `performStart()` (:514): the boot start, a deferred resume, or the listener retry after a failed boot start.
  - A listener that throws is warned and does not undo the start.
  - `stop()` clears the listeners (:552), which is their release path.
  - The `registerConfigListener` doc is updated.
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts` (Electron):
  - Subscribes `onStarted(startSkillTrigger)` before `start()` (:446).
  - `startSkillTrigger` is idempotent through `refs.skillTrigger !== null` (:413). On a normal boot it is reached from both the hook and the `.then`, and later from a retry, but it starts the trigger at most once. `SkillTriggerService.start()` keeps its own `started` guard as well.
  - A failed start now KEEPS `refs.skillSynthesis`, so the shutdown `stop()` disposes the config listener and the subscription.
  - The doc comments in `types.ts` are updated.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` (CLI) had the same gap: a rejected `await start()` nulled the ref and skipped the trigger. It gets the same fix: subscribe before `start()` (:320), an idempotent `startSkillTrigger` (:288), and the ref kept on a failed start. The fix uses a single `try` with no `return` in the `catch`, so the degradation-audit baseline holds.
- No new `vscode-core` imports and no polling.

Specs:

- `boot-thoth-runtime.spec.ts:483`: a failed start leaves the trigger unstarted. Firing two retries starts it exactly once. A further case covers the normal boot (hook plus `.then`, started once). Also: "failed start keeps the ref". The existing doubles now go through `makeSkillSynthesis()`, which has a real `onStarted` contract.
- `cli-engine/.../thoth-runtime.spec.ts`: "starts the skill trigger once when a failed skill-synthesis start is retried successfully" and "a normal start … starts the skill trigger once". The `thoth-runtime-edge.spec.ts` double gains `onStarted`.
- `skill-synthesis.pause-resume.spec.ts:575`: `onStarted` fires once on the retried start, not on the failed start, not on a no-op resume, and not after `stop()`. A disposed subscription is not notified.

### N4: skills boot scan with no workspace root releases its arm

- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:891`: the `getWorkspaceRoot()` check moved inside `runBootScan`'s `try`. The generation-owned `finally` now clears `bootScanArmed` on that path too.
- Spec `skill-trigger.boot-defer.spec.ts:611`: armed after `start()`, released after a scan with no root, and nothing enqueued.

### Checks

`npx nx run-many -t test,typecheck,lint -p thoth-runtime cli-engine skill-synthesis --parallel=1`:

```
Tests:       1 skipped, 1863 passed, 1864 total      (skill-synthesis)
Tests:       102 passed, 102 total                    (thoth-runtime)
Tests:       221 passed, 221 total                    (cli-engine)
NX   Successfully ran targets test, typecheck, lint for 3 projects
```

`npx nx run degradation-audit:lint`:

```
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/skill-synthesis: 5 ok (baseline 5)
NX   Successfully ran target lint for project degradation-audit
```

`npx prettier --check` on the 10 changed files:

```
All matched files use Prettier code style!
```

### Round 2b — Electron double and shutdown ref (coordinator follow-up)

**Broken spec:** `apps/ptah-electron/src/activation/boot-order.spec.ts:219`.

- Its skill-synthesis double had no `onStarted()`. The new subscribe-before-start threw inside the boot `try`, so `start()` was never reached.
- A real host cannot hit this path. `SKILL_SYNTHESIS_SERVICE` always resolves the `SkillSynthesisService` class, and that class now has the hook. The fix is therefore in the double, which now follows the real contract. The boot code is unchanged on this point.

**Shutdown gap** (`boot-heavy-services.ts`, previously at :182):

- New optional `BootThothRuntimeOptions.onSkillTriggerStarted(skillTrigger)` in `libs/backend/thoth-runtime/src/lib/types.ts:51`. It is invoked in `startSkillTrigger` right after the trigger starts (`boot-thoth-runtime.ts:426`): on the normal unawaited continuation, a paused boot, or a retried start.
- Electron passes `(t) => { refs.skillTrigger = t; }` (`apps/ptah-electron/src/activation/boot-heavy-services.ts:173`), so the coordinator's stable refs hold the trigger that actually runs.
- The one-shot copy `refs.skillTrigger = thoth.skillTrigger` is removed. It was `null` whenever the trigger started after `bootThothRuntime` returned.
- `shutdown.ts:226` (`refs.skillTrigger?.stop()`) is unchanged. Its stop ordering is already pinned by `main.quit-path.spec.ts`.

Specs:

- `boot-order.spec.ts:222` "skill trigger ref reaches the shutdown refs" has two cases.
  - A failed boot start followed by a successful retry: `coordinator.refs.skillTrigger` is the started trigger, and it was started once.
  - The normal unawaited continuation: same result.
  - `makeStubs(extra)` now accepts override entries.
- `boot-thoth-runtime.spec.ts`: the retry case asserts `onSkillTriggerStarted` is called once, with the running instance.

### Checks (final, round 2 + 2b)

`npx nx run-many -t test,typecheck,lint -p ptah-electron thoth-runtime cli-engine skill-synthesis --parallel=1`:

```
Tests:       1 skipped, 1863 passed, 1864 total      (skill-synthesis)
Tests:       102 passed, 102 total                    (thoth-runtime)
Tests:       221 passed, 221 total                    (cli-engine)
Tests:       3 skipped, 1150 passed, 1153 total       (ptah-electron)
NX   Successfully ran targets test, typecheck, lint for 4 projects and 6 tasks they depend on
```

`npx nx run degradation-audit:lint`:

```
apps/ptah-electron: 4 ok (baseline 4)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/skill-synthesis: 5 ok (baseline 5)
NX   Successfully ran target lint for project degradation-audit
```

`npx prettier --check` on the 12 round-2 files:

```
All matched files use Prettier code style!
```

- The 12 files are the 10 above plus `apps/ptah-electron/src/activation/boot-heavy-services.ts` and `boot-order.spec.ts`.
