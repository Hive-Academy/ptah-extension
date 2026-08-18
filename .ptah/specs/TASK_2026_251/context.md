# TASK_2026_251 — two Electron DI risk guards are red

Found 2026-08-15 while establishing a `ptah-electron` baseline for TASK_2026_180
batch B5.1. **Not caused by that task.** Reproduced identically three times: at
the B5.1 baseline (with `libs/backend/rpc-handlers` and `libs/shared` clean,
confirmed by `git status`), after B5.1 landed, and again after B4.4 landed
changes in `rpc-handlers`. Neither batch touches the chat or output-styles DI
path.

## What fails

```
apps/ptah-electron/src/di/container.smoke.spec.ts

  ● Electron DI — PTY host token aliasing (Risk R2)
      › resolves PTY_HOST to the very same instance as PTY_MANAGER_SERVICE
  ● Electron DI — app updater token aliasing (Risk R1)
      › resolves APP_UPDATER to the very same instance as UPDATE_MANAGER_TOKEN

  registerChatServices(): registerOutputStyleServices(container, logger) must
  run first — ChatSessionService injects OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION,
  which output-styles owns. Call it during library registration (phase 2),
  before chat services.
      libs/backend/rpc-handlers/src/lib/chat/di.ts:90
```

Whole-project shape: `Test Suites: 1 failed, 1 skipped, 17 passed, 18 of 19
total` / `Tests: 2 failed, 4 skipped, 236 passed, 242 total`.

## Why this is worth a task rather than a note

**These two specs are the guards for R1 and R2 — token aliasing.** Their entire
job is to prove that `PTY_HOST` and `PTY_MANAGER_SERVICE` resolve to the SAME
instance, and likewise `APP_UPDATER` / `UPDATE_MANAGER_TOKEN`. A second instance
of either is the class of defect that produces two pty hosts or two updaters and
is very hard to see from the outside.

Right now neither guard asserts anything. They fail before reaching their
assertion, on container construction. A red test that everyone knows is red is
indistinguishable from a red test that just started failing for a new reason —
which is exactly how the aliasing regression these specs exist to catch would
get through.

## The chain

The error is thrown by an explicit ordering guard, so the diagnosis is not in
doubt — `registerChatServices()` refuses to run before
`registerOutputStyleServices()`, because `ChatSessionService` injects
`OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION` and `output-styles` owns that token.
The guard names its own fix: output styles belong in library registration
(phase 2), before chat services.

Note `rpc-handlers/CLAUDE.md` already records WHY output-style selection and
activation moved out of `rpc-handlers` into `output-styles` — `cli-agent-runtime`
needed the same composition and could not import `rpc-handlers`. So the guard is
correct and the registration order is what is wrong.

## What to check before assuming it is spec-only

**Does the real app boot path have the same ordering?** The smoke spec builds
the container its own way, and the shipped Electron app evidently works, so the
two paths may already differ. Two very different outcomes:

- If the real `phase-*` bootstrap orders correctly and only the SPEC's container
  is mis-ordered, this is a test-harness fix and the guards come back.
- If the real bootstrap has the same ordering and simply never resolves those
  tokens early enough to trip it, then the app is one lazy resolution away from
  the same failure, and the fix belongs in the bootstrap.

Start at `apps/ptah-electron/src/di/` (the phase files, `phase-2-*` through
`phase-4-handlers.ts`) and compare against what the spec constructs. Do not
"fix" the spec until you know which of the two it is.

## Do not

- Do not delete or skip the two tests. Skipping them removes the R1/R2 guards
  entirely, which is worse than red — and `ptah-electron` has 4 skipped tests
  and 1 skipped suite already, so a fifth would disappear into the noise.
- Do not relax the guard in `chat/di.ts:90`. It is doing its job; it caught a
  real ordering fault and named the fix.

## Verification

`npx jest -c apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron --runInBand --runTestsByPath apps/ptah-electron/src/di/container.smoke.spec.ts`
→ currently `Tests: 2 failed, 4 passed, 6 total`. Green is 6 passed.

**`nx test ptah-electron --runTestsByPath <path>` does NOT filter** — it runs all
suites anyway. Use the direct `npx jest -c … --rootDir …` form above.
