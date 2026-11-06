# P1 code logic review fixes

## Changes and evidence

1. **Thrown routes:** `RouteDecideService.decide` now catches pre-flight and gate failures, emits one `[lane-routing] route decided` info line with `stage`, `outcome: 'error'`, a categorized error name, and `durationMs`, then rethrows the original error. The existing summary logger contains logging failures. Success summaries carry `outcome: 'ok'`. The pre-flight and gate specs assert one safe log and error identity; the invalid-input spec asserts the safe `unknown` stage.
2. **Reused pre-flight:** The existing reuse spec already asserted exactly one info call and `reused: true`. It now also asserts `outcome: 'ok'`.
3. **Other minor finding:** The review's `LANE_INSTRUCTIONS` wording is in `phase-plan.ts`, outside the allowed files. It was not changed.
4. **Caller labels:** `phaseId` and `executor` logging is unchanged, per the supplied decision.

## Changed files

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.service.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/reasons/decision-summary.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.preflight.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-routing/src/lib/route-decide.gate.spec.ts`

## Verification

No verify, Nx, or git command was run, as instructed. Scoped `ptah_get_diagnostics` was called for all four changed source files; it returned `unchecked` because the TypeScript check was still running after 45 seconds. The orchestrator should run `npm run verify -- -p @ptah-extension/lane-routing`.

## Decisions

- For malformed arguments, log `stage: 'unknown'` because the stage has not passed schema validation. This avoids logging unvalidated caller text and is reversible.
