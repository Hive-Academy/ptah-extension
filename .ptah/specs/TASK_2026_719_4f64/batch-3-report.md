# Batch 3 report: certified launch helpers (agent-sdk)

## Backend implementation: `TASK_2026_719_4f64`, batch 3

**Tasks completed**: Task 3.1 (`claude-certified-launch` and `claude-identity-reference`).

**Files** (6, all inside the worktree; nothing else touched):

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.ts`: allowlist env builder, digest, named env, boundary assertion, settings override rule, refusal class, personal subscriptions.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-certified-launch.spec.ts`: regression rows 879, 880, 883, 888 (B3 part).
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-identity-reference.ts`: `claudeIdentityReference(email, organization)`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/claude-identity-reference.spec.ts`: regression row 884 (B3 part).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/lib/helpers/index.ts`: explicit exports next to `applyClaudeAccountRouteEnv` (`:264`).
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-named-accounts/libs/backend/agent-sdk/src/index.ts`: the same exports next to the explicit line `:453`.

`claude-account-route-env.ts` is not touched (it belongs to B13). No B2 or B4 file was edited.

## Evidence per acceptance item

| Acceptance item | Where |
| --- | --- |
| The allowlist drops every selector, the `CLAUDE*`/`ANTHROPIC*` prefixes, the cloud prefixes (AWS/GOOGLE/AZURE/CLOUD_ML), `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN`, `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, `CLAUDE_CODE_MANAGED_SETTINGS_PATH`/`REMOTE_SETTINGS_PATH`, `NODE_OPTIONS` and a lower-case `claude_config_dir` | spec `buildCertifiedClaudeEnv` > "copies only allowlisted keys..." (exact `toEqual` plus prefix checks) |
| Original casing is kept (`Path`, `SystemRoot`) and the result is frozen | same test |
| NO_PROXY rule: appended for every copied casing, empty value becomes `127.0.0.1,localhost`, the key is added when absent | "applies the NO_PROXY rule..." |
| Run-policy keys (`CLAUDE_CODE_DISABLE_WORKFLOWS`, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`) are left out of the digest, value `'1'` only | "excludes run-policy keys...", "returns a fresh copy plus the requested run-policy keys", drift rows `run-policy value` and `run-policy casing value` |
| Drift (executable, missing executable, digest, removed key, cwd, setting sources, missing sources, run-policy value) is refused in both modes | `describe.each(['final','bootstrap'])` drift table |
| `managedSettings` (any value, `{}` included) and an `extraArgs` key `managed-settings` (with a value or null) are refused in both modes | same `describe.each`, parent-managed channel table |
| Bootstrap requires `settingSources: []` and `cwd = os.tmpdir()` | "bootstrap requires no setting sources and the temp cwd" |
| A flag-tier override is refused at final (`apiKeyHelper`, `forceLoginOrgUUID`, non-allowlisted `env`, `enabledPlugins`, non-JSON, non-object) | "final refuses a flag settings tier..." |
| Two routes get different `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` and share no object | "gives two routes different directories and no shared object" (includes a mutation check across `certifiedNamedEnv` results) |
| `certifiedNamedEnv` refuses a missing launch (`identity-unproved`), a directory mismatch for either key, and a digest mismatch (`route-changed`) | `certifiedNamedEnv` describe |
| `claudeSettingsOverride` covers the rev1 keys, `forceLoginMethod` other than `claudeai` (null included), `forceLoginOrgUUID` with any value, an off-allowlist `env` key, non-empty `enabledPlugins`, and `malformed` for a non-object value or a non-object `env` | `claudeSettingsOverride` table (20 rows) |
| The identity formula equals the executor's (`session-query-executor.service.ts:578`) and the lane runner's (`claude-sdk-lane-runner.ts:409`) | `claude-identity-reference.spec.ts`: the template restated verbatim plus a literal-string hash; trimming; null for an empty email |
| Exports from both barrels | `helpers/index.ts`, `src/index.ts` |

`ptah_get_diagnostics` (files = the 6 changed files, severity error): **0 errors, 0 warnings, coverage clean**.
An earlier call listed sibling errors in `off-thread-process-spawner.ts`. That file belongs to Batch 4, which was in progress at the time. Those errors did not appear on the final call.
`npx prettier --write` was run on the 4 new files only.

Not run (rule 12): `npm run verify -- -t lint,test,typecheck -p @ptah-extension/agent-sdk`. The team-leader runs it. The two new specs have not been executed yet.

## Specs that mock or pin changed members (rule 5)

- No existing member changed. Both barrels only gained new names.
- `libs/backend/agent-sdk/src/lib/__contracts__/deleted-exports.contract.spec.ts` (the plan cites it as `src/__contracts__/...`; the real path is under `src/lib/`). It asserts that deleted names are `undefined`. None of the new names is on its list, so it is unaffected.
- `claude-account-route-env.spec.ts` is the only spec that references the neighbouring `applyClaudeAccountRouteEnv` export. Nothing about that export changed.
- Ambient-path pins (plan 943-953) are untouched: no ambient code path changed.

## Decisions

- **Refusal codes.** Drift in executable, digest, cwd, setting sources or a run-policy value, and directory or digest mismatches in `certifiedNamedEnv`, give `route-changed`. A missing launch, an empty canonical directory, the flag-tier override and the managed-settings channel give `identity-unproved`. The plan sets the last two and the missing launch. The rest are this batch's choice, and it is reversible.
- **Setting sources** must be an exact ordered match, and `undefined` is refused. This is stricter than set equality and is reversible.
- **Env values that are `undefined`** are treated as not passed to the child: they are left out of the digest, and a removed key counts as drift.
- **Run-policy names** match case-insensitively, as Windows env names do.
- **`buildCertifiedClaudeEnv`** throws `ClaudeCertifiedLaunchRefusal('identity-unproved')` for an empty or whitespace-only directory.
- **Extra exported types** beyond the plan's list: `ClaudeActualLaunch` (the `actual` shape for `assertCertifiedLaunch`, needed by B12 and B13), `ClaudeRunPolicyKey` (the `runPolicy` argument of `certifiedNamedEnv`) and `ClaudeCertifiedLaunchRefusalCode`. These are type-only and additive.
- **Unparseable `flagSettings`** is treated as `malformed` and refused. The `catch` has a justifying comment, and the failure is not silent.

## Risks handled

- **Ambient expectation drift (HIGH).** Purely additive new files. `claude-account-route-env.ts` and the ambient paths are untouched.
- **D13 / A-S12 parent-managed channel.** Refused in both modes and pinned. `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` is set in the fixture `sourceEnv` and its absence is pinned.
- **Security (rule 11).** The refusal message is fixed and path-free (`Certified Claude launch refused: <code>.`). There is no logging, `process.env` is never read or mutated, and no `process.cwd()` is used. The env is an argument.
- **Dependency direction.** `agent-sdk` imports only types from `@ptah-extension/auth-providers-tokens`, an edge that already exists. No new dependency.

## Plan deviations

- None in behaviour.
- The plan's path for `deleted-exports.contract.spec.ts` is wrong: it is `src/lib/__contracts__/`, not `src/__contracts__/`.

## Out-of-scope observations

- The plan calls the executor formula identical to the "quota formula". `auth-providers/src/lib/quota/provider-owner.resolver.ts` uses the same `ptah-quota-owner\0` domain but a different shape (`<providerId>#<kind>:<16-hex>` over its own material). Only the executor and lane formulas are byte-identical. B5's `claude-account-status.spec.ts` should pin against `claudeIdentityReference`, not against the resolver.
