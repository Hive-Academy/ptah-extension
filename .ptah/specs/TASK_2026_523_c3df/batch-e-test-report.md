# Batch E — behaviour pins, TASK_2026_523_c3df

**Author: the orchestrator, not a lane.** The Glm lane wrote the spec files, then
failed twice to run the tests or produce this report, exiting cleanly both times
with nothing written. Per the lane contract a lane that fails twice is dropped, so
the verification and this document are mine. The specs it wrote are kept, because
they are good work; what was missing was proof that they run.

---

## The twelve pins

Mapped against `implementation-plan.md` line 911. Evidence is the spec file that
covers the requirement.

| # | Requirement | Covering spec | State |
| --- | --- | --- | --- |
| 1 | Raw, un-normalised `authMethod` handed to the resolver | `auth-providers/.../effective-route.spec.ts` | Covered |
| 2 | `''` to and from `'inherit'`, both directions | `providers/provider-consumer-assignments.component.spec.ts` (`toPickerModel`, `toBackendJudgeModel`) | Covered |
| 3 | Both new keys in both `file-settings-keys.ts` tables | `platform-core/src/file-settings-keys.spec.ts` | Covered |
| 4 | `judgeProvider: ''` keeps enhancement byte-identical | `skill-synthesis/.../skill-enhancer.service.spec.ts` | Covered |
| 5 | A pinned `judgeProvider` yields a bare tier alias | `skill-synthesis/.../skill-enhancer.service.spec.ts` | Covered |
| 6 | Override control hidden when `supportedTargets` is `['global']` | `providers/setting-scope-row.component.spec.ts` | Covered |
| 7 | `sdkAdapter.reset()` after clearing an auth-scoped key | `rpc-handlers/.../config-scope-rpc.handlers.spec.ts` | Covered, new |
| 8 | `unknown` and `skipped` never render as Connected | `providers/provider-connection-card.component.spec.ts` | Covered |
| 9 | `vsce ls` shows no non-JS file carrying a flagged token | Batch G, `batch-g-release-gate-report.md` | **FAIL — pre-existing only** |
| 10 | A failed probe writes nothing | `auth-providers/.../draft-verification.service.spec.ts` | Covered, new |
| 11 | Classification precedence holds | `auth-providers/.../draft-verification.service.spec.ts` | Covered, new |
| 12 | A superseded `probeId` result is discarded | `providers/provider-setup-wizard.component.spec.ts` | Covered |

Pin 9 fails on two pre-existing hits in `apps/ptah-extension-vscode/package.json`
— the `ptah.authMethod` enum value `claudeCli` and its description naming
Anthropic and Claude — plus a false positive on the CSS `cursor:` property in
bundled gridstack styles. Zero path hits. The file is untouched by this branch.
It blocks release, not merge.

---

## The four named gaps

1. **The ten-rule classifier** had no tests at all. `draft-verification.service.spec.ts`
   is new and drives `classifyDraftProbeFailure` directly, including the three
   cases the plan names: a 401 must be `credential-rejected` rather than
   `unclassified`, a pre-flight `ProviderQuotaError` must be `quota-exhausted`,
   and an in-flight 429 must be `rate-limited`, proving the last two are not
   collapsed.
2. **`resolvedModel` union arms** — fixtures now use the real discriminated union
   after the spec-fidelity repair. Previously a bare string was passed and the
   `kind` branch was never exercised.
3. **The `''` / `'inherit'` sentinel** keeps its existing pins. They were verified
   present and unmodified rather than duplicated.
4. **The draft endpoint fix** has regression cases in
   `provider-auth-resolver.spec.ts` for `local-native` and `local-proxy` with and
   without a draft base URL, and for `oauth` keeping persisted resolution.

---

## Defects found

### 1. The new config-scope spec could not run at all — FIXED

`config-scope-rpc.handlers.spec.ts:68` typed its `registerMethod` mock as
`(name: keyof RpcMethodRegistry, handler: (raw: unknown) => Promise<unknown>)`,
which is not assignable to the real generic
`<TParams, TResult>(name: string, handler: RpcMethodHandler<TParams, TResult>) => void`.

```
TS2322: Type 'unknown' is not assignable to type 'TParams'.
  'TParams' could be instantiated with an arbitrary type which could be
  unrelated to 'unknown'.
```

The suite failed to compile, so none of its cases ran — including pin 7. The lane
never ran the tests, so it never saw this.

Fixed by giving the mock the real generic signature. One cast remains, confined to
the single line where one map holds handlers of differing parameter types, with a
comment stating that the erasure is deliberate and local.

### 2. Type precision lost on the settings write path — FIXED

`skills-synthesis-rpc.handlers.ts:565` had been widened from
`keyof SkillSynthesisSettingsDto` to `string` when the write DTO was introduced.
That key builds `skillSynthesis.${key}` for a configuration write, so as `string`
a mistyped key compiles and writes a setting nothing reads. Restored to
`keyof SkillSynthesisSettingsWriteDto`, which is where those keys now live.

### 3. Dead code in the new spec — FIXED

Two type aliases, `SdkAdapterSurface` and `AuthHandlersSurface`, were declared and
never used. Removed.

---

## Verification

All commands run with `NX_DAEMON=false` and an isolated `NX_CACHE_DIRECTORY`,
cache skipped, in this worktree.

```
nx run-many -t typecheck lint test -p auth-providers rpc-handlers chat
            memory-curator-ui core shared --skip-nx-cache
```

| Project | Tests |
| --- | --- |
| `@ptah-extension/shared` | 60 suites, 1579 passed |
| `@ptah-extension/core` | 31 suites, 784 passed |
| `@ptah-extension/auth-providers` | 42 suites, 788 passed |
| `@ptah-extension/memory-curator-ui` | 17 suites, 193 passed |
| `@ptah-extension/chat` | 89 suites, 1434 passed, 2 skipped |
| `@ptah-extension/rpc-handlers` | 103 suites, 3083 passed, 4 skipped |

Typecheck and lint pass for every project. Lint warnings are pre-existing, plus
the file-size warnings batch F documents.

### One unrelated failure, environmental

`voice-rpc.handlers.spec.ts:284` times out at 5000 ms. It calls
`fs.readdir(os.tmpdir())` and this machine's temp directory holds **108,015
entries**, so the read alone exceeds the timeout.

The file is not touched by this branch — `git diff main...HEAD` returns nothing
for it. The `rpc-handlers` numbers above come from a run excluding it; with it
included, that one suite fails and the other 103 pass. This session added roughly
two dozen files to that directory; the rest is long-term accumulation. The
directory was not mass-deleted, because it is shared with the user's other work.

**This is worth fixing in its own task**: a unit test whose result depends on how
many unrelated files exist on the host is not a reliable test.

---

## Fixture fidelity

The Nx `typecheck` target does not cover spec files, so a structurally invalid
fixture passes a green Nx run. This branch already shipped that failure once and
repaired it.

Language-server diagnostics were used to confirm the two previously broken spec
files report zero errors. The new specs from this batch compile under the Jest
transform, which for `ts-jest` does type-check the file — that is how defect 1 was
caught at all.

**Limit of this check, stated plainly:** the coverage table above is evidence that
a spec exercising each requirement exists and passes. It is not a line-by-line
audit proving each assertion tests exactly the stated condition. Pins 1 through 6,
8 and 12 were written by earlier batches and verified here by their presence and a
green run, not re-derived from the requirement text.

---

## Not done

- No live browser, real-credential, or cross-runtime verification.
- No packaging run; pin 9 relies on batch G's separate report.
- The twelve pins were not re-derived from first principles; see the limit above.
