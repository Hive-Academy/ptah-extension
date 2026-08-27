# TASK_2026_325 — ptah_get_diagnostics: honest partial results, no stale cache

Source: regression review of TASK_2026_323 (B3 worker) and commit ceca0c54f.
Contract (libs/backend/workspace-intelligence/CLAUDE.md): `available` + `[]` must only
ever mean "checked, and clean".

## Findings to fix

1. **Per-config failures dropped once any config compiles.**
   `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:218-228`
   reads `outcome.errors` only when `programCount === 0`. Worker pushes errors at
   `ts-diagnostics-worker-source.ts:102-110` and `:148-157`.
   Required: when `outcome.errors.length > 0` and `programCount > 0`, return
   `status: 'available'` only if the caller can see the gap — add the errors to the
   result (`partial: true` + `reason` listing the failed configs, or `status:
   'unavailable'` if the shared `DiagnosticsResult` type has no partial slot; check
   `libs/backend/platform-core` for the port type and extend it additively).
   Spec: two configs, one clean, one malformed → result names the malformed config.

2. **30 s cache keyed on root only returns pre-edit results.**
   `:70-76`, `:129-154`, `:259-280`. The core prompt tells agents to check AFTER edits.
   Required: include a cheap change signal in the cache key or invalidate on it —
   the max `mtimeMs` across the discovered tsconfig files plus the newest `mtimeMs`
   of the workspace's source roots is too slow to walk; use the workspace file
   watcher if one is injected, otherwise reduce the TTL to 5 s and expose
   `invalidate(root)` that `ptah_get_diagnostics` callers can hit after a write.
   Spec: get → edit fixture → get within TTL → the second call reflects the edit.

3. **Failures cached like successes.** `:149-173` `runOnce` writes `unavailable` results
   into the LRU with the full TTL. Required: never cache `unavailable`.
   Spec: worker rejects once → next call recompiles.

4. **Cross-root worker replacement kills an unrelated in-flight compile.**
   `ts-diagnostics-worker.ts:154-196` `ensureWorker` calls `failAll()` when
   `tsModulePath` differs. Required: keep one worker per `tsModulePath` (Map), or
   wait for the in-flight run to settle before replacing. Spec: two roots, two
   compiler paths, both resolve.

5. **`failAll()` fire-and-forgets `terminate()`** (`:222-237`) while `dispose()` awaits
   it (`:145-152`). Required: await in both.

6. **No dedicated worker spec.** Add `ts-diagnostics-worker.spec.ts` covering: `error`
   event, non-zero `exit`, `RUN_TIMEOUT_MS`, replacement, `dispose()` racing a run.

## Constraints

- Worker source stays a `String.raw` string with no backticks and no `${`.
- Do not edit the core prompt (`ptah-core-prompt.ts`).

## Verify

```bash
npx nx test @ptah-extension/workspace-intelligence
npx nx typecheck @ptah-extension/workspace-intelligence
npx nx build-main ptah-electron
```
