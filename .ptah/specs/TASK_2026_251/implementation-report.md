# TASK_2026_251 — implementation report

## Verdict: SPEC-ONLY. The real bootstrap is correctly ordered in all three hosts.

The failing tests never ran phase 2. They call `registerPhase4Handlers` directly
on a bare child of the tsyringe root container, so the phase-2 registration that
satisfies the guard had no opportunity to happen. Nothing is latent in the app.

### Evidence — the spec's call path

The baseline stack trace names the caller precisely (both tests, identical
shape):

```
at assertOutputStyleServicesRegistered (../../libs/backend/rpc-handlers/src/lib/chat/di.ts:90:9)
at registerChatServices              (../../libs/backend/rpc-handlers/src/lib/chat/di.ts:43:3)
at registerPhase4Handlers            (src/di/phase-4-handlers.ts:85:23)
at Object.<anonymous>                (src/di/container.smoke.spec.ts:200:27)   <- Risk R2
at Object.<anonymous>                (src/di/container.smoke.spec.ts:243:27)   <- Risk R1
```

`container.smoke.spec.ts:200` and `:243` were `registerPhase4Handlers(c, logger)`
where `c = rootContainer.createChildContainer()` (spec lines 191 and 228 before
the fix). Neither describe ran `registerPhase0Platform` … `registerPhase3Storage`,
and neither registered `OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION` by hand.

The `isRegistered(token, true)` parent recursion is not defeated by anything
subtle — it recursed to the tsyringe root container, where the token is genuinely
not bound. The first describe in the same file (`buildMinimalContainer`,
spec line 42) registers only onto its _own_ child, so it cannot bleed the token
onto the root either. The recursion worked correctly and correctly found nothing.

### Evidence — the real Electron bootstrap is fine

`apps/ptah-electron/src/di/container.ts:38-48` runs the phases in a fixed
sequence inside `ElectronDIContainer.setup()`:

- `container.ts:43` → `registerPhase2Libraries(root, logger)`
- `container.ts:45` → `registerPhase4Handlers(root, logger)`

`apps/ptah-electron/src/di/phase-2-libraries.ts:188` calls
`registerOutputStyleServices(container, logger)` at function top level — not
inside a `try`, not behind a conditional. (The nearest `try`/`catch` closes at
`:176` for memory-curator; `:177`, `:178`, `:183` and `:188` are all unguarded
statements.) So phase 2 either reaches `:188` or throws and aborts the whole
boot — there is no path where phase 4 runs after a phase 2 that silently skipped
output styles.

`apps/ptah-electron/src/di/phase-4-handlers.ts:85` calls
`registerChatServices(container)`. 43 < 45, and `:188` is unconditional. Correct.

### The other two hosts share no fault

**VS Code** — `apps/ptah-extension-vscode/src/di/container.ts:53-54` runs
`registerPhase2Libraries` then `registerPhase3Handlers`.
`phase-2-libraries.ts:66` = `registerOutputStyleServices`;
`phase-3-handlers.ts:60` = `registerChatServices`. Correctly ordered.

**CLI engine** — `libs/backend/cli-engine/src/lib/container.ts:529` calls
`registerThothLibraries(container, logger)` (phase 2, ends at `:531`), and
`register-thoth-libraries.ts:136` calls `registerOutputStyleServices` at function
top level, deliberately outside the surrounding `try` blocks (the comment at
`:132-135` says so explicitly: fanned to every host, must resolve here too).
`registerChatServices` runs later at `container.ts:700`. 529 < 700, and `:136` is
unconditional. Correctly ordered.

All three composition roots match what `output-styles/CLAUDE.md` documents as the
requirement. No bootstrap change was needed or made.

---

## Files changed

Exactly one file. `apps/ptah-electron/src/di/phase-4-handlers.ts` was
**not** modified (`git diff` on it is empty).

### `apps/ptah-electron/src/di/container.smoke.spec.ts`

1. **Line 25** — `import { TOKENS, type Logger } from '@ptah-extension/vscode-core';`
   (added the `Logger` type).
2. **Line 27** — added
   `import { registerOutputStyleServices } from '@ptah-extension/output-styles';`
3. **Lines 175-205** — new `buildPhase4Container()` helper plus a docblock that
   records _why_ phase 4 has a registration-time phase-2 precondition and where
   the real boot satisfies it (`phase-2-libraries.ts:188` via `container.ts:43`,
   three phases before `phase-4-handlers.ts:85` via `container.ts:45`). The
   helper creates the child container, builds the logger mock, and calls the
   **real** `registerOutputStyleServices(c, logger)`.
4. **Line 224** (Risk R2) and **line 254** (Risk R1) — both now start from
   `const { c, logger } = buildPhase4Container();`.

Two incidental cleanups fell out of the helper: the duplicated five-method logger
mock collapsed to one definition, and the two
`as unknown as Parameters<typeof registerPhase4Handlers>[1]` casts are gone —
that parameter _is_ `Logger`, so the helper's return type satisfies it directly.
No new cast was introduced; no `@ts-ignore`; no test deleted or skipped.

### Why the real `registerOutputStyleServices`, not a token stub

`rpc-handlers/src/lib/chat/di.spec.ts:49` sets the precedent for stubbing
(`c.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, { useValue: {} })`), and it
is right for that spec — it is testing the guard itself. Here the subject is the
_Electron phase wiring_, so the harness calls the same function phase 2 calls.
A stub would satisfy the guard forever even if phase 2's contract moved; the real
call keeps the harness tracking it. It is also cheap: `registerOutputStyleServices`
only performs five `registerSingleton` + five `useToken` binds and resolves
nothing, so it needs no filesystem, workspace or settings adapter at registration
time.

---

## Proof the aliasing assertions EXECUTE, not merely stop throwing

Passing green is necessary but not sufficient, so the wiring was mutated to
reintroduce exactly the defect R1 and R2 exist to catch, and the tests were
re-run.

Temporary mutation in `phase-4-handlers.ts` (since reverted):

- `PLATFORM_TOKENS.PTY_HOST`: `{ useToken: ELECTRON_TOKENS.PTY_MANAGER_SERVICE }`
  → `{ useValue: new PtyManagerService(logger) }` (a second instance)
- `PLATFORM_TOKENS.APP_UPDATER`: `{ useToken: UPDATE_MANAGER_TOKEN }`
  → `container.registerSingleton(PLATFORM_TOKENS.APP_UPDATER, UpdateManager)`

Result — both tests failed, and failed **at the assertion**, not at the guard:

```
● Electron DI — PTY host token aliasing (Risk R2)
    expect(received).toBe(expected) // Object.is equality
    Expected: {"dataCallback": null, "exitCallback": null, "logger": {...}, "sessions": Map {}}
    Received: serializes to the same string
      at Object.<anonymous> (src/di/container.smoke.spec.ts:232:21)   <- expect(viaPort).toBe(viaConcreteToken)

● Electron DI — app updater token aliasing (Risk R1)
    expect(received).toBe(expected) // Object.is equality
    Expected: {"_checkInterval": null, "_currentState": {"state": "idle"}, "logger": {...}, "webviewManager": {...}}
    Received: serializes to the same string
      at Object.<anonymous> (src/di/container.smoke.spec.ts:268:21)   <- expect(viaPort).toBe(viaConcreteToken)
```

"serializes to the same string" is the decisive detail: the two objects are
structurally identical and distinct by reference — precisely the duplicate-instance
wiring that a `toEqual` would have waved through, and precisely what the docblocks
at spec lines 174-188 and 210-225 say these guards are for. Both reached line
232 / 268 and both caught it. The mutation was then reverted; `git diff` on
`phase-4-handlers.ts` is empty and the suite is green again.

R1 and R2 are guarding again.

---

## Verification output (real numbers)

### Target spec — before

```
Tests:       2 failed, 4 passed, 6 total
Test Suites: 1 failed, 1 total
```

### Target spec — after

```
$ npx jest -c apps/ptah-electron/jest.config.ts --rootDir apps/ptah-electron \
    --runInBand --runTestsByPath apps/ptah-electron/src/di/container.smoke.spec.ts

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Time:        7.715 s
```

### Whole project

Before: `Test Suites: 1 failed, 1 skipped, 17 passed, 18 of 19 total` /
`Tests: 2 failed, 4 skipped, 236 passed, 242 total`

After:

```
$ npx nx test ptah-electron --skip-nx-cache

Test Suites: 1 skipped, 18 passed, 18 of 19 total
Tests:       4 skipped, 238 passed, 242 total
Time:        25.635 s
NX   Successfully ran target test for project ptah-electron
```

The 2 failures became passes; the pre-existing 4 skipped tests and 1 skipped
suite are unchanged — nothing was skipped to get here.

### Typecheck

```
$ npx nx typecheck ptah-electron
> tsc --noEmit --project apps/ptah-electron/tsconfig.app.json
NX   Successfully ran target typecheck for project ptah-electron
```

### Lint

```
$ npx nx lint ptah-electron
✖ 3 problems (0 errors, 3 warnings)
NX   Successfully ran target lint for project ptah-electron
```

All 3 warnings are pre-existing `no-empty-function` warnings in
`src/di/electron-adapters.ts:253` and
`src/services/electron-browser-capabilities.ts:498,605` — files not touched here.

### `rpc-handlers`

Not run, and not required: `libs/backend/rpc-handlers` was not modified. The
guard at `chat/di.ts:90` is byte-for-byte unchanged, as are its four specs in
`chat/di.spec.ts`. (`rpc-handlers` does carry unrelated working-tree changes from
other in-flight tasks; none of them are mine.)

---

## Constraints honoured

- Guard at `libs/backend/rpc-handlers/src/lib/chat/di.ts:90` untouched — it was
  right, and the report above is the ordering fault it correctly named.
- No test deleted, skipped, or weakened. Skip count is still 4 tests / 1 suite.
- Bootstrap untouched; `phase-4-handlers.ts` diff is empty. Change is confined to
  the harness because the fault was confined to the harness.
- `libs/backend/skill-synthesis` not touched.
- No `@ts-ignore`, no dead code, no commit made.
