# Context — TASK_2026_302

## Origin

Surfaced during TASK_2026_299 Batch 7, while writing the Task 6.5 DI-override
specs. Recorded in `.ptah/specs/TASK_2026_299/test-report.md` §"Job 2", which
documents the empirical finding and the precedent it followed.

## The problem

Two specs needed to answer one question: after Phase 2 registration, does
`container.resolve(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)` return the real
`TypeScriptDiagnosticsProvider` rather than the Phase 0 placeholder?

The direct way to answer it is to import the registration function and call it.
That is not currently possible:

- `require('apps/ptah-electron/src/di/phase-2-libraries')` **throws at module
  evaluation**, before any test body runs. The import graph transitively reaches
  `persistence-sqlite` (better-sqlite3 native binding), `memory-curator`,
  `messaging-gateway`, `voice-providers` and others. Verified with a throwaway
  import-check spec during TASK_2026_299, which was then deleted.
- `CliDIContainer.setup()` in `libs/backend/cli-engine/src/lib/container.ts` is
  a single ~600-line static method carrying the same transitive weight.

## What was done instead, and why it is not enough

Both specs — `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`
and `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts` —
call the REAL exported `registerWorkspaceIntelligenceServices(container, logger)`
against a minimal child container, then execute the override lines **copied
verbatim** from `phase-2-libraries.ts:170-178` and `container.ts:528-536`.

This is genuinely useful: it proves the override mechanism, the resolution
order, and that the placeholder is displaced. It is also structurally blind —
the assertion runs against a copy, so any future edit to the real override lines
passes these tests unchanged. Both spec headers carry an explicit DRIFT CAVEAT.

## The wider issue

This workaround is not new. The repo has already normalized it:

- `with-engine.spec.ts` documents mocking the bootstrap "so tests do not pay the
  real container cost".
- `container.smoke.spec.ts` hand-builds a minimal container rather than calling
  `registerPhase2Libraries` / `registerPhase4Handlers`.

So the DI composition layer — the thing that decides which adapter every port
resolves to, across three runtimes — has no end-to-end test in any host. Each
individual workaround was reasonable; the accumulation is the problem.

## Scope

- `apps/ptah-electron/src/di/phase-2-libraries.ts`
- `libs/backend/cli-engine/src/lib/container.ts`
- `apps/ptah-electron/src/di/phase-2-diagnostics-override.spec.ts`
- `libs/backend/cli-engine/src/lib/container-diagnostics-override.spec.ts`
- Possibly the Jest setup for `ptah-electron` and `cli-engine`.

## Approach options (not yet decided)

1. **Make the heavy imports lazy** — move `persistence-sqlite`, `memory-curator`,
   `messaging-gateway`, `voice-providers` behind `useFactory` closures or dynamic
   `import()` so module evaluation stays cheap and registration functions become
   importable. Fixes the root cause; touches DI wiring across hosts.
2. **Jest moduleNameMapper stubs** for the native/heavy leaves in the host test
   configs. Cheaper, unblocks importing the real registration functions, but adds
   a stub surface that itself drifts.
3. **Extract the override into a named exported function** (e.g.
   `registerDiagnosticsOverride(container)`) called by both hosts and imported
   directly by both specs. Narrowest fix — kills the mirroring for THIS override
   only, leaves the composition layer untestable in general.

Option 3 is a cheap immediate win and could ship independently. Option 1 is the
real fix. They are not mutually exclusive.

## Acceptance

- The DI-override specs assert against imported production code, not a mirrored
  copy — editing the override lines must be able to fail a test.
- The DRIFT CAVEAT comments come out of both spec headers when it is no longer
  true.
