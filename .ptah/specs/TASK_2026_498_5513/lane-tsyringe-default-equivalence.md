## Audit

The AST audit covered production TypeScript under `libs/**/src/**/*.ts` and
`apps/**/src/**/*.ts`, excluding specs, tests, declarations, build output, and
fixtures. A repository-wide search found no product tsyringe source outside
those roots; the only non-`src` TypeScript reference was a Jest config. The
audit found these six constructor-default candidates:

| file:line                                                                           | class                      | parameter          | default shape                                       | verdict                | reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------- | ------------------ | --------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/agent-generation/src/lib/services/content-generation.service.ts:171`  | `ContentGenerationService` | `sectionValidator` | `= new GeneratedSectionValidator()`                 | defect (already fixed) | `GeneratedSectionValidator` is `@injectable()` and constructor position 0 injects `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`; zero-argument default omits it. Without outer `@inject(GeneratedSectionValidator)`, packaged resolution constructs validator with `fileSystem === null`. Observable consequence: `checkCitedPaths` cannot probe disk, so a real path opened by model but absent from analysis index is rejected and authored fallback ships instead of valid generated section. Listed uncommitted fix was present and preserved. |
| `libs/backend/memory-curator/src/lib/memory-curator.service.ts:186`                 | `MemoryCuratorService`     | `tracer`           | `= new NoopTracer()`                                | safe                   | Parameter already has `@inject(PLATFORM_TOKENS.TRACER)`. `NoopTracer` is `@injectable()` but has no constructor dependencies, so manual fallback is self-contained and container-equivalent for hand-built instances.                                                                                                                                                                                                                                                                                                                       |
| `libs/backend/memory-curator/src/lib/memory-search.service.ts:201`                  | `MemorySearchService`      | `tracer`           | `= new NoopTracer()`                                | safe                   | Same shape: explicit outer token plus dependency with no constructor parameters. No injected capability is lost.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.ts:90`         | `EmbedderWorkerClient`     | `tracer`           | `= new NoopTracer()`                                | safe                   | Same shape: explicit outer token plus dependency with no constructor parameters. No injected capability is lost.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `libs/backend/agent-sdk/src/lib/peer-sessions/peer-session-directory.service.ts:90` | `PeerSessionDirectory`     | `probe`            | `this.probe = probe ?? new ProcessStartTimeProbe()` | safe                   | `ProcessStartTimeProbe` is not a tsyringe class. Its only constructor input is an optional options object; omitted values use `process.platform` and local command runner. `new ProcessStartTimeProbe()` is intended production behavior and loses no injected dependency.                                                                                                                                                                                                                                                                  |
| `libs/backend/auth-providers/src/lib/providers/codex/codex-auth.service.ts:109`     | `CodexAuthService`         | `codexHome`        | `= new CodexHomeResolver()`                         | safe                   | Parameter already has `@inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_HOME_RESOLVER)`. `CodexHomeResolver` is deliberately not `@injectable()`; its optional override/environment/home-directory inputs are test seams with equivalent production fallbacks.                                                                                                                                                                                                                                                                                       |

No additional production defect was found.

## Fixes

- Extended `tools/di-lint/check-injects.ts` with default-equivalence analysis for
  parameter initializers and constructor-body nullish fallbacks.
- Added `tools/di-lint/__fixtures__/default-equivalence.ts`. It contains two
  violations (one per supported syntax) and two safe controls: an injectable
  self-contained dependency and the non-injectable `ProcessStartTimeProbe`
  shape.
- Strengthened self-test assertions for all three detectors. It now checks exact
  planted findings instead of accepting any non-zero exit, and confirms both
  safe controls were discovered without becoming violations.
- Added `--audit-defaults` diagnostics so candidate inventory and conservative
  classification can be inspected without changing lint result.
- No new production source fix was needed. Existing uncommitted
  `@inject(GeneratedSectionValidator)` fix was temporarily removed only for
  requested proof, then restored. That fix restores real file-system provider
  injection, allowing generated-section citation checks to consult workspace
  disk instead of silently operating with `canCheckByDisk === false`.

## Detector

First pass indexes directly decorated tsyringe classes
(`@injectable`, `@singleton`, `@scoped`, `@autoInjectable`) and constructor
positions carrying `@inject`, `@injectAll`, `@injectWithTransform`, or
`@injectAllWithTransform`.

Second pass examines constructors of container-built classes for:

- `parameter: X = new X(...)`
- `this.parameter = parameter ?? new X(...)`

It reports only when all conditions hold:

1. Outer parameter has no injection decorator.
2. Constructed target resolves to exactly one indexed tsyringe class.
3. Target has at least one injected constructor position omitted by supplied
   argument count.

It deliberately does not flag non-injectable helpers, injectable classes with
no injected constructor positions, defaults that supply every injected
position, already decorated outer parameters, or unresolved/ambiguous class
names. This keeps `ProcessStartTimeProbe` and `NoopTracer` shapes quiet.

## Verification

### Self-test: all existing detectors plus default-equivalence detector

Command:

```text
npx nx run di-lint:self-test --skip-nx-cache
```

Output:

```text
> nx run di-lint:self-test

> node tools/di-lint/run-self-test.js

 NX   Successfully ran target self-test for project di-lint

  Run duration:      1.8s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     1.7s (1 task)
  Recoverable time:  <1ms

di-lint self-test: 1 unregistered @inject token(s), 1 missing @inject(s), and 2 non-equivalent default(s) in fixtures (expected)
ERROR: tools/di-lint/__fixtures__/unregistered-inject.ts:12 injects FIXTURE_TOKENS.TOKEN_THAT_IS_NEVER_REGISTERED but no register*.ts registers it
ERROR: tools/di-lint/__fixtures__/missing-inject.ts:28 FixtureClassWithMissingInject parameter #1 'collaborator' has no @inject
ERROR: tools/di-lint/__fixtures__/default-equivalence.ts:25 FixtureClassWithDefaultEquivalenceCases parameter #0 'unsafeInitializer' defaults to new InjectedDependency() but has no @inject
ERROR: tools/di-lint/__fixtures__/default-equivalence.ts:27 FixtureClassWithDefaultEquivalenceCases parameter #2 'unsafeBody' defaults to new InjectedDependency() but has no @inject
di-lint self-test PASS: fixture violation detected, exit code 1 as expected
```

### Repository lint with fix present

Command:

```text
npx nx run di-lint:lint --skip-nx-cache
```

Output:

```text
> nx run di-lint:lint

> npx ts-node --transpile-only tools/di-lint/check-injects.ts

di-lint OK: 1558 @inject sites all resolve to a registered token (702 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies

 NX   Successfully ran target lint for project di-lint

  Run duration:      6.4s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     6.3s (1 task)
  Recoverable time:  <1ms
```

### Real-case proof: decorator temporarily removed

Command:

```text
npx nx run di-lint:lint --skip-nx-cache
```

Output:

```text
> nx run di-lint:lint

> npx ts-node --transpile-only tools/di-lint/check-injects.ts

di-lint FAIL: 1 non-equivalent defaulted constructor dependency/dependencies with no @inject
  The default constructs a tsyringe class while omitting one or more of
  that class's injected constructor positions. Production resolution skips
  the container for this parameter and silently builds a weaker instance.
ERROR: libs/backend/agent-generation/src/lib/services/content-generation.service.ts:171 ContentGenerationService parameter #4 'sectionValidator' defaults to new GeneratedSectionValidator() but has no @inject
Warning: command "npx ts-node --transpile-only tools/di-lint/check-injects.ts" exited with non-zero status code
 NX   Running target lint for project di-lint failed

Failed tasks:

- di-lint:lint
```

### Real-case proof: decorator restored

Command:

```text
npx nx run di-lint:lint --skip-nx-cache
```

Output:

```text
> nx run di-lint:lint

> npx ts-node --transpile-only tools/di-lint/check-injects.ts

di-lint OK: 1558 @inject sites all resolve to a registered token (702 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies

 NX   Successfully ran target lint for project di-lint

  Run duration:      6.7s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     6.6s (1 task)
  Recoverable time:  <1ms
```

### Tests and typecheck

Command:

```text
npx nx run-many -t test typecheck -p di-lint "@ptah-extension/agent-generation" --skip-nx-cache --output-style=static
```

Output:

```text
 NX   Running targets test, typecheck for project @ptah-extension/agent-generation:

- @ptah-extension/agent-generation

> nx run @ptah-extension/agent-generation:test

Test Suites: 32 passed, 32 total
Tests:       1027 passed, 1027 total
Snapshots:   0 total
Time:        10.414 s, estimated 12 s
Ran all test suites.

> nx run @ptah-extension/agent-generation:typecheck

> tsc --noEmit --project libs/backend/agent-generation/tsconfig.lib.json

 NX   Successfully ran targets test, typecheck for project @ptah-extension/agent-generation

  Run duration:      16.5s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     16.4s (1 task)
  Recoverable time:  <1ms

 NX   The following projects do not have a configuration for any of the provided targets ("test, typecheck")

- di-lint
```

`di-lint` has no Nx `test` or `typecheck` target. Its TypeScript config was also
checked directly:

```text
npx tsc -p tools/di-lint/tsconfig.json --noEmit
Exit code: 0
```

## Limits

- Target resolution is intentionally conservative and name-based. Namespace
  access (`new ns.X()`), aliased class names that become ambiguous, duplicate
  class names, dynamic constructors, factories, and custom decorator aliases
  are not reported.
- Constructor-body matching is exact: `this.x = x ?? new X(...)`. It does not
  infer equivalence through helper methods, `||`, ternaries, destructuring,
  property renaming, field initializers, or later assignments.
- Supplied arguments are assessed by position count. The rule does not prove
  that a supplied value is semantically equivalent to the container token; an
  explicit `undefined`, spread argument, or wrong collaborator can still be
  non-equivalent.
- Scan excludes specs/tests and declaration/build output. It checks direct
  production TypeScript under project `src` roots; future tsyringe production
  code outside those roots must be added to globs.
- This rule closes the confirmed zero-argument/default-omission form, not every
  possible manual-construction equivalence error. Conservative skips are
  deliberate so ambiguous findings do not become ignored lint noise.
