# ptah-cli e2e harness

CI-grade end-to-end tests that drive the **built** dist binary
(`dist/apps/ptah-cli/main.mjs`) over JSON-RPC 2.0 NDJSON stdio.

Tests never import CLI source — they spawn the bundle the same way an
external agent (OpenClaw / NemoClaw) would in production. This guarantees
parity with the npm-published artefact.

## Run

```bash
nx build ptah-cli       # produce dist/apps/ptah-cli/main.mjs
nx e2e ptah-cli         # build dependency runs automatically
```

Or directly:

```bash
jest --config apps/ptah-cli/jest.e2e.config.cjs --runInBand
```

The `globalSetup` aborts the run if the dist bundle is missing and warns
if it is older than 24 hours.

## Layout

```
tests/e2e/
  _harness/
    cli-runner.ts        # CliRunner.spawn + spawnOneshot, JSON-RPC client
    rpc-clients.ts       # InteractRpcClient (4 inbound interact methods)
    tmp-home.ts          # createTmpHome — isolated $HOME / .ptah dir
    wait-for.ts          # predicate-driven async polling
    global-setup.cjs     # build-artifact pre-check
    index.ts             # barrel
  bootstrap.e2e.spec.ts          # version, help, session.ready, EOF
  headless-task.e2e.spec.ts      # Bug 1 + Bug 4 — terminal task envelopes
  permission-gates.e2e.spec.ts   # Bug 2 + Bug 3 — auto-approve + autopilot
  once-flag.e2e.spec.ts          # Bug 5 — block-then-exit + drain
  rpc-handlers.e2e.spec.ts       # Bug 6 — 5 RPC handlers registered
  license-cli.e2e.spec.ts        # Bug 8 + Bug 9 — flag norm + cache hydration
  compaction.e2e.spec.ts         # TASK_2026_109 — skipped placeholders
```

Each spec file documents the bug it gates in its top-of-file JSDoc with a
commit hash, so a future investigator can reverse-map a failing test to
the regression surface.

## Adding a new spec

1. Create `your-bug.e2e.spec.ts` next to the existing specs.
2. Import the harness from `./_harness` (the barrel export).
3. Use `createTmpHome()` in `beforeEach` and `cleanup()` in `afterEach`
   so the test owns an isolated `$HOME / %USERPROFILE%`.
4. Pick the spawn mode:
   - **Persistent interact session** — `CliRunner.spawn({ home, args, env })`
     yields a `RunnerHandle` with `request`, `notify`, `awaitNotification`
     and the resolved `session.ready` payload. Use this for any test that
     drives the JSON-RPC channel.
   - **One-shot subcommand** — `CliRunner.spawnOneshot({ home, args, env, timeoutMs })`
     captures `stdoutLines`, `stdoutRaw`, `stderr`, `exitCode`, `signal`,
     and `hasMalformedStdout`. Use this for any test that calls a
     subcommand whose RPC handler is NOT registered on the interact
     channel (config / auth / settings / license / provider / websearch).
5. **Always** inject a fake `ANTHROPIC_API_KEY` via `env` if the test
   needs `session.ready` — SDK init fails closed without an auth source
   and the harness never makes real upstream calls (the fake key is
   rejected at first use, which is exactly what most tests prove).
6. **Do not** rely on wall-clock timing. Use `waitFor(predicate)` from
   the harness; it polls at 50 ms intervals until the predicate or a
   timeout deadline.
7. **Always** clean up — `RunnerHandle.shutdown()` in `afterEach` (the
   existing specs use a try/catch + `kill()` fallback that you can copy).

## Constraints (do not break)

- The harness drives the BUILT bundle. Never `import` CLI source from a
  spec — that defeats the parity guarantee.
- `maxWorkers: 1` is intentional. Parallel DI bootstraps oversubscribe
  the OS file-watch / port budget on Windows runners.
- Tests must complete in **under 3 minutes** wall-clock total. Each spec
  has a 60 s `jest.setTimeout`.
- Never commit a real API key, license key, or OAuth token. The fake
  fixture string `sk-ant-e2e-fake-key-not-real-do-not-call-upstream` is
  deliberately distinctive so it is grep-able if it ever leaks.
- Production code is read-only from this folder. If a test surfaces a
  product bug, file a fix task — do not patch under `apps/ptah-cli/src`
  from a spec helper.
