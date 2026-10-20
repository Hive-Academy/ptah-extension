# Batch 41.1 — Electron DI and RPC surface

## Files changed

- `apps/ptah-electron/src/di/phase-2-libraries.ts`: documented why the skill service registration remains.
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`: based the served-method expectation and partition count on the live RPC handler manifest.

`expected-resolvable.ts`, `container.smoke.spec.ts`, and `surface-composition.spec.ts` already contain no pipeline-only token or hard-coded skill-method expectations, so they needed no edits.

## Tokens removed and kept

- Removed: none. The inspected Electron expectation lists already omit candidate store, drain, queue, curator, judge, and other pipeline-only tokens.
- Kept: `registerSkillSynthesisServices` in phase 2. The current Library RPC handler injects `SKILL_SYNTHESIS_SERVICE`; the skill trigger and `SKILL_TELEMETRY_SEAM` also depend on this registration. The existing smoke spec checks that telemetry seam.
- Kept: `SKILL_REPROPAGATION_TOKEN` registration for the Electron skill path.

## Manifest-relative lists

The Electron RPC surface spec flattens `RPC_HANDLER_MANIFEST[*].methods` and compares that sorted list with `surface.registered`. Its partition count uses the same live manifest length. No fixed skill method names or fixed registry count remain in that spec, so the expectations track the methods present before and after batch 59.

## Decisions

- Retained the full skill registration until the Library handler injection is removed in its planned later batch.
- Left the telemetry seam smoke assertion in place because it checks a retained consumer, not pipeline boot.
- Per task rules, used read-only inspection only; no tests, typecheck, lint, build, serve, e2e, or Electron run.

## Clarifications Needed

none
