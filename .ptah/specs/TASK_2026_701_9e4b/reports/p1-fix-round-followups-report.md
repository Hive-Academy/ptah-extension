# P1 fix-round follow-ups — TASK_2026_701_9e4b

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/plugin-config-home.ts` — added the local helper `absentWhenInvalid(schema)`, which returns `schema.optional().catch(undefined)`. It carries one `// degradation-audit: optional-capability - ...` marker directly above its single `.catch`. `LastUpdatedSchema` and the four lenient list fields now use it. The inferred types are unchanged (`ZodCatch<ZodOptional<T>>`, zod 4.6.5), and so is the behaviour.
- MODIFIED `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.ts` — fix for B3. `createCliUserLayerRefresher` now sums `userLayerPassFailures` over both the `mirrorAll` and `reconcileAll` results. If the sum is above 0 it logs a warning and returns `'failed'` instead of `'refreshed'`. Reconcile still runs after a mirror pass that counted failures, as Electron does. The lazy logger lookup moved into a small `warnRefresh` helper that both warning paths use. The existing `reported` marker in the catch is unchanged.
- MODIFIED `libs/backend/cli-engine/src/lib/bootstrap/harness-boot.spec.ts` — the mirror mocks now resolve a `CLEAN_PASS` result (`errors: 0, retiredSkills.errors: 0`), which matches the real result type. Added a regression test, `it.each`, with two cases: a mirror file error, and a reconcile retirement error. Each case expects `'failed'`, a reconcile that still ran, and the warning.
- MODIFIED `libs/shared/src/lib/types/harness-sync.types.ts` — comment only. The `expectedDigest` doc now says it is the strict approval fingerprint from `approval-fingerprint.ts` (content plus identity), not `hashFile`/`hashDir`.

## Verification

- `npx tsx tools/degradation-audit/check-degradation.ts`: exit 0, no FAIL lines. Result: `libs/backend/agent-sdk: 3 ok (baseline 4)` (it was 8 FAIL) and `libs/backend/cli-engine: 12 ok (baseline 12)`. The harness-boot sites the audit lists (:248, :273, :294) are pre-existing catch-return-sentinels in other functions and are already counted in the baseline. `baseline.json` is not edited.
- `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-engine,@ptah-extension/shared`: `9 tasks: 8 succeeded, 1 failed`. The only failure is `@ptah-extension/agent-sdk:lint`, the accepted pre-existing D21 (`session-query-executor.accounts.spec.ts:174,183`). Test and typecheck passed for all three projects, and lint passed for cli-engine and shared.
- `npx eslint` on the four changed files: clean, no output.
- To tie the agent-sdk lint failure to D21: `npx eslint` on `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts` gives `174:3` and `183:3` `no-unexpected-multiline`, 2 problems. These are the same two lines as the accepted D21 failure. That file is not one of the files I changed.

## Decisions

- **The CLI runs reconcile even after a mirror pass with counted failures.** Options: stop early, or run both passes and then aggregate. Evidence: Electron runs both steps and aggregates any `failed` step (fix-round-b report, B3), and reaping and fast-forwarding stay useful when some files fail. Reversible.

## Out-of-scope observations

- None.
