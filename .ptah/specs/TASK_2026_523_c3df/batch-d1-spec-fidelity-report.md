# Batch D1 — Spec Fidelity Report (TASK_2026_523_c3df)

## Scope of this batch

Two spec files only:

- `libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.spec.ts`
- `libs/frontend/chat/src/lib/settings/providers/provider-setup-wizard.component.spec.ts`

No production file changed. No config file changed. No `as any`, `as unknown as X`, `@ts-expect-error`, or loosened local interface was added.

## Errors fixed

### provider-consumer-assignments.component.spec.ts (6 errors)

| Line | Error | Fix |
|------|-------|-----|
| 60 | `route: 'anthropic:direct'` not assignable to `AuthStrategyType \| 'unresolved'` | Set `route: 'api-key'`. `AuthStrategyType` is `'api-key' \| 'oauth-proxy' \| 'local-native' \| 'local-proxy' \| 'cli'` (`libs/shared/src/lib/types/auth-strategy.types.ts:16`). `'anthropic:direct'` was a wire id, never a resolved strategy. |
| 64 | `resolvedModel: 'claude-3-5-sonnet'` — string not assignable to the union | Set `resolvedModel: { kind: 'model', id: 'claude-3-5-sonnet' }`, matching `AuthGetEffectiveRouteResult.resolvedModel` (`libs/shared/src/lib/types/rpc/rpc-auth.types.ts:264-267`). |
| 68 | `status: 'not-configured'` not a member of `EffectiveRouteProvider['status']` | Set `status: 'unknown'`, the real registry verdict for a provider that has never been set up. The component maps `'unknown'` (with `'missing'`/`'skipped'`) to the same "Set up {provider} when you are ready." copy that the fabricated `'not-configured'` fell through to (`provider-consumer-assignments.component.ts:654-676`). |
| 167 | `ScopedSettingEntry` fixture missing `effectiveKey` and `fallbackPreview` | Added `effectiveKey: 'memory.curatorProvider'` and `fallbackPreview: null` to the `memory.curatorProvider` entry. |
| 174 | Same for the `memory.curatorModel` entry | Added `effectiveKey: 'memory.curatorModel'` and `fallbackPreview: null`. |
| 181 | Same for the `skillSynthesis.judgeModel` entry | Added `effectiveKey: 'skillSynthesis.judgeModel'` and `fallbackPreview: null`. |

All three entries stay typed through the `signal<ProvidersSettingsSection<ConfigGetScopesResult>>` generic, so future drift fails loudly without a new local interface.

### provider-setup-wizard.component.spec.ts (14 errors)

Six errors of type 2347 ("Untyped function calls may not accept type arguments") and eight errors of types 2352/2493 (indexing `mock.calls[0][0]` of untyped mocks, plus the `as` conversions on `undefined`).

| Line | Error | Fix |
|------|-------|-----|
| 169 | `fixture.nativeElement.querySelector<HTMLInputElement>(...)` — `nativeElement` is `any`, so a type argument on the untyped call is error 2347 | Dropped the type argument, kept the narrowing the file already uses elsewhere: `as HTMLInputElement \| null` on the result. |
| 221 | Same pattern | Same fix. |
| 242 | Same pattern | Same fix; assigned to a local `customRadio` before `click()`. |
| 276 | `querySelectorAll<HTMLButtonElement>(...)` on `any` | Dropped the type argument; narrowed the result with `as HTMLButtonElement[]`. |
| 438 | Same pattern | Same fix, narrowed result, then `.checked` on it. |
| 453 | Same pattern | Same fix. |
| 474 | `verify.mock.calls[0][0] as AuthVerifyDraftConnectionParams` on an untyped `jest.fn` (errors 2352 + 2493) | Typed the mock: `jest.fn<Promise<AuthVerifyDraftConnectionResult>, [AuthVerifyDraftConnectionParams]>(...)`, matching the style already used at lines 89, 113 and 120 of this file. Removed the now-redundant `as`. |
| 492 | Same pattern | Same fix. |
| 525-526 | `cancel.mock.calls[0][0]` and `verify.mock.calls[0][0]` on untyped mocks | Typed both mocks with the seam parameter tuples; the assertion now reads `cancel.mock.calls[0][0].probeId` directly, without casts. |

For fixture fidelity, the same typing was applied to every remaining untyped `jest.fn` mock in this file even where no error was reported: the verify mocks in "does not probe while the user types" and "renders the unclassified copy", and the cancel mocks in "discards a late result" and "leaves persisted settings untouched for a verify-then-cancel sequence". Each now carries `Promise<AuthVerifyDraftConnectionResult>`/`Promise<AuthCancelDraftVerificationResult>` and the real seam param tuple, so a signature drift in `DraftVerifyConnectionFn`/`DraftCancelVerificationFn` fails at compile time.

## Tests that changed meaning

Two fixtures changed shape; the assertions kept their meaning. Details:

1. **"shows exact state-table copy for not-configured provider"** — the openai fixture status moved from the fabricated `'not-configured'` to the real `'unknown'`. The rendered readiness message, the Set up button, the preserved draft, and the disabled save with its reason are all unchanged, because the component treats `'unknown'`, `'missing'`, `'skipped'` and the old fabricated `'not-configured'` in one default branch. The test now exercises a status the backend can actually report. The inline comment on the fixture selection was updated to say `'unknown'`.
2. **Route fixture `'anthropic:direct'` → `'api-key'`** — no assertion reads the raw `route` string. `formatResolvedSummary` reads `driverProviderId` and `resolvedAuthModality`, and the summary assertion "Follows main agent → anthropic · api-key → Default (haiku tier)" still passes unchanged.
3. **`resolvedModel` plain string → union object** — no assertion in this component reads `resolvedModel` (see Defects found). No assertion changed.
4. **`ScopedSettingEntry` fixtures gained `effectiveKey` and `fallbackPreview: null`** — the component reads only `.scope` from these entries through `scopeEntry(key)`, and `SettingScopeRowComponent` renders provenance from the `scope` input it is given. The "From Global · All Ptah apps" and "Mixed sources" assertions are unchanged.
5. **Wizard mocks gained typed tuples** — no assertion changed. The removed `as AuthVerifyDraftConnectionParams` / `as AuthCancelDraftVerificationParams` casts at lines 474, 492, 525-526 were assertions about type only, not about behaviour; the typed mocks now assert the same thing at compile time.

No assertion was weakened, skipped, or deleted. No test failed after the fixtures were corrected.

## Defects found

One honest negative statement, plus one positive finding:

- **`resolvedModel` union handling is NOT consumed by these two components.** `ProviderConsumerAssignmentsComponent` never reads `resolvedModel`; its summary derives from `driverProviderId`, `resolvedAuthModality` and the row's own lane model (`provider-consumer-assignments.component.ts:777-793`). The union is consumed by `providers-settings.component.ts:78-80`, which branches with `@switch (route.resolvedModel.kind)` over `'model'`, `'tier'` — and implicitly `'unresolved'` renders nothing. That component is outside this batch's scope, and its own spec already feeds the correct shape (`providers-settings.component.spec.ts:47`: `resolvedModel: { kind: 'model', id: 'model-a' }`). The wizard never receives `resolvedModel`.
- **One latent production-code smell, not a defect in this batch:** `provider-consumer-assignments.component.ts:654` writes `const status = entry?.status ?? 'not-configured';` — `'not-configured'` is not a member of `EffectiveRouteProvider['status']`. TypeScript widens the local union, so it compiles, and the fallback case group renders the same copy as `'unknown'`. It is dead literal in a switch whose real members are all real statuses. Left untouched (out of scope); recorded here so the D1 lane owner can decide whether to drop the dead literal.
- **No production defect was exposed by the corrected fixtures.** All 1494 tests passed with the real shapes in place.

## Verification

### Nx (quoted output)

Environment: `NX_DAEMON=false`, `NX_CACHE_DIRECTORY=D:\projects\ptah-extension\.nx\verify-cache-glm`.

```
NX   Running targets typecheck, lint, test for project @ptah-extension/chat:

- @ptah-extension/chat

√  nx run @ptah-extension/chat:test
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:lint

NX   Successfully ran targets typecheck, lint, test for project @ptah-extension/chat

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

Run duration:      56.8s
Cache:             0/3 hit (0%)
```

Test target rerun with `--output-style=static`, quoted Jest summary:

```
Test Suites: 91 passed, 91 total
Tests:       2 skipped, 1494 passed, 1496 total
Snapshots:   0 total
Time:        37.162 s

NX   Successfully ran target test for project @ptah-extension/chat
```

As the task states, Nx cannot typecheck specs: `typecheck` runs `ngc --noEmit` against `tsconfig.lib.json`, which excludes spec files. The language-server result below is the proof for the specs.

### Language server (quoted result)

`ptah_get_diagnostics` (source: `typescript-compiler`) over the whole `@ptah-extension/chat` project:

- **Before** the fixes: 268 errors project-wide, of which this batch's two files carried 20 (6 in `provider-consumer-assignments.component.spec.ts` at lines 59, 63, 67, 166, 173, 180; 14 in `provider-setup-wizard.component.spec.ts` at lines 168, 220, 241, 275, 437, 452, 473, 491, 524, 525).
- **After** the fixes: 248 errors project-wide, and **zero occurrences of either file** — a grep over the full diagnostic payload for `provider-consumer-assignments.component.spec.ts` and `provider-setup-wizard.component.spec.ts` returns no match. Both files report zero errors through the language server.
- The 20-error delta is exactly this batch's fix count; the remaining 248 errors are pre-existing and live in other files, outside this batch's scope.

## Deviations

- Beyond the error sites, four additional untyped `jest.fn` verify/cancel mocks in the wizard spec were given the same explicit type tuples, for the "future drift fails loudly" goal. This widens the diff past the strict error list; the alternative (leaving them untyped) would keep half of the mock fixtures invalid-shaped.
- The wizard spec's generic type-argument errors were fixed by dropping the type argument on `any`-typed `nativeElement` calls and narrowing the result with the file's existing `as HTMLInputElement | null` pattern. This is the same idiom the file already used for other element queries, not a new cast style, and not a silencing cast — `nativeElement` is genuinely `any`, so the narrowing is the only available type information.

## Not done

- No `tsconfig`, `jest.config` or `project.json` change, per the task constraint. The "specs are not typechecked by Nx" condition is repository-wide and was left alone.
- No component change: neither `ProviderConsumerAssignmentsComponent` nor `ProviderSetupWizardComponent` needed a fix once the fixtures were correct.
- No touch of `libs/frontend/core`, `libs/shared`, `settings.component.ts`, the three sibling provider components, or the clean sibling spec files.
- No git action of any kind.

## Clarifications Needed

None. The work was not blocked.