# Implementation report — Batch 1

Status: **NOT COMPLETE**. Source correction after checkpoint B01-V1 is written. Correction tests were not run. `batches.md` and the task carrier were not edited. No commit was created.

## Executor

- Family: xAI
- Model: Grok 4.7
- Lane tools: `ptah_*` MCP tools were not listed (`search_tool` returned no ptah server). Native reads and edits were used for the assigned files. No compiler, Nx, Jest, or `ptah_get_diagnostics` run in this correction lane.
- Git: read-only `rev-parse`, `status`, `diff`, and `hash-object` (without `-w`). No stage, commit, or push.

## Checkpoint

- Worktree: `D:/projects/ptah-extension/.claude-worktrees/provider-accounts`
- Input HEAD: `0fc0c3a09d104517e4a19a7ece73ddcc0ed788d1`
- HEAD was not moved.
- Acceptance checkpoint B01-V1 stays **NOT ACCEPTED**. Task 1.1 stays **IN_PROGRESS**. This section records the source correction the B01-V1 findings asked for. It is not a new acceptance checkpoint.

### Prior verification, before this correction

Attributed to the B01-V1 note in `batches.md`. The verifier returned findings in the team-leader transcript. `implementation-verification-batch-01.md` was not created. This correction lane did not re-run those checks.

- `@ptah-extension/shared` typecheck, lint, and test passed: 122 suites, 3745 tests, six lint warnings.
- All five host typechecks passed.
- Host lint passed except the webview circular-boundary error at `app.routes.ts:224:7`.
- All five host test projects had failures or blocked suites. Electron, CLI, TUI, and VS Code test targets required forbidden builds. Direct existing Jest-config runs were diagnostic alternatives, not passing equivalents.
- Those host failures are unresolved. This lane did not change host test or lint infrastructure.

### Hashes after the correction

| Path | Git blob (`hash-object`, not written) | SHA-256 | Versus pre-correction report |
| --- | --- | --- | --- |
| `libs/shared/src/index.ts` | `f9576b99890b669535344ee873ae47945b89f630` | `531D02292039F7ED0D7817A6CB26FEC4A5DEA55A69CD23E3E2DA9EC082D6B0A8` | Unchanged. Still the types-only line. |
| `libs/shared/src/schemas.ts` | `687ae01a1755689d89b76222f5672dbccdd80177` | `74FEE9874755867F13AFB07D3FA9B8588E7B183448A179711CDD2C891A5F8ABE` | One added re-export. Parent blob in `git diff` is `85e71816d`. |
| `libs/shared/src/lib/types/provider-account.types.ts` | `44a71bd5b7c0f7b70295980fc2020760adf84ecc` | `1AF0E7E6C6C34E17BD40B311B6A5D490575B40F895E215A2F616A4424B1293B8` | Label predicate replaced. Prior blob `47b43c3bfa6bcdfb5ffc7d5c04606706fb00e6b5`, SHA-256 `DB49BC226C6C0F32ABE7E02E899BBBBE987485E722EEA9D94A4B91F79B45D8CE`. |
| `libs/shared/src/lib/types/provider-account.schemas.ts` | `7d6c48d1963a42c3ddf6f3113f3020e372f9a8b6` | `35A8F96899C50F3DB4B933B9D597E490DD374C50A7BC2E376EEE2C72724F5AAF` | Unchanged. Binding shape not redesigned. |
| `libs/shared/src/lib/types/provider-account.schemas.spec.ts` | `e038c7010dc6cc4a20acadadeb45bb41bb43a70c` | `53997548C0C18D1F9B15FFE398847BA1AC1907C8D91C2080737E46F0D87CCDDA` | Public-entry import and label cases. Prior blob `3c1b0c02b07bd0ff64367f4d54b7519d199b8995`, SHA-256 `6FB23AB7B3A6503F7E06CCE2379B5ADACBD35D31CC8E8D32343A925C2B991F07`. |

Prior content blobs were produced by `git hash-object` without `-w`, so they are not objects in this repository. The correction diff below is the edit applied to the source this lane read, identified by those prior hashes.

Working tree for this batch: `M libs/shared/src/index.ts`, `M libs/shared/src/schemas.ts`, plus the three untracked provider-account files. `index.ts` diff against HEAD is still only `export * from './lib/types/provider-account.types';`.

## Correction outcomes

1. **Public schema export — done.** `@ptah-extension/shared/schemas` (`libs/shared/src/schemas.ts`) re-exports `./lib/types/provider-account.schemas`. The owned spec imports the schema values from `@ptah-extension/shared/schemas`, which `tsconfig.base.json` maps to that barrel. Types stay on `./provider-account.types` and on the main `@ptah-extension/shared` barrel. The main barrel does not export the schema module and does not gain a `zod` import. No deep `libs/shared/src/lib/types/provider-account.schemas` import was added for other projects.

2. **Display labels — done.** `isSafeProviderAccountLabel` is bounded user text: length 1 through 64, no leading or trailing whitespace, and no C0 or DEL controls (`<= 0x1f` or `0x7f`). It accepts `Research & Development`, `Work: Europe`, and `Team/A`. The path, flag, and shell blacklist (`/`, `\`, `:`, `&`, `=`, `@`, leading `-`, `.`, `..`) is no longer applied to labels. Sanitized result sentences still reject those characters. Strict `.strict()` rejection of authority keys and secret-bearing fields on selection, summary, and binding is unchanged. `provider-account.schemas.ts` is byte-identical to the pre-correction blob.

### Exact `schemas.ts` diff against HEAD

```diff
diff --git a/libs/shared/src/schemas.ts b/libs/shared/src/schemas.ts
index 85e71816d..687ae01a1 100644
--- a/libs/shared/src/schemas.ts
+++ b/libs/shared/src/schemas.ts
@@ -25,6 +25,7 @@ export * from './lib/types/task-filter.schemas';
 export * from './lib/types/task-saved-view.schemas';
 export * from './lib/types/claude-domain.schemas';
 export * from './lib/types/provider-profile.schemas';
+export * from './lib/types/provider-account.schemas';
 export * from './lib/types/rpc/rpc-harness.schemas';
 export * from './lib/types/execution/schemas';
 export * from './lib/types/messages/schemas';
```

### Label predicate

`UNSAFE_SUMMARY_TEXT` and `hasUnsafeSummaryText` apply only to `isSafeProviderAccountSummary`. `isSafeProviderAccountLabel` calls `hasControlCharacter` after the length and trim checks. The `.` and leading-`-` label rejections were removed with the path and command blacklist.

### Spec correction

- Schema value import path changed from `./provider-account.schemas` to `@ptah-extension/shared/schemas`.
- Replaced `rejects label` cases (`../secret`, `a/b`, `a\\b`, `-flagged`, `key=value`, `user@example.com`, and the length and newline cases mixed into that blacklist) with:
  - accepts `Research & Development`, `Work: Europe`, `Team/A`, `Büro work`
  - rejects `''`, `' '`, `' padded'`, `'padded '`, 65 `x` characters, a newline, NUL, and DEL
- Selection authority-key tests, summary secret-field tests, and binding malformed-versus-absent tests were left in place.

## What was implemented

Additive shared vocabulary only. `SYSTEM_CLI_TYPES` and runtime registration were not touched.

- Closed providers `claude` | `codex`, scopes `main` | `lane`, and the seven design sign-in states.
- Selection: explicit `omitted`, `ambient`, or `named` profile id. A missing field classifies as omitted. `null` and excess keys classify as invalid.
- Public selection and summary schemas are strict. They reject path, env, epoch, owner, directory, and a completed binding injected by the caller.
- Summary fields are id, label, provider, state, `verified` | `unknown`, revision, and active-run count.
- Action results use a closed code list and a sanitized summary. Parse helpers return data or `rejected` and do not return Zod issues.
- Binding version is `1` and carries provider, profile id, route revision, opaque fingerprint, auth epoch, run id, and identity `known` (64-char lowercase hex) or `unknown`. No directory field.
- `classifyProviderAccountBinding(undefined)` is `absent`. Any other malformed value, including `null` and a wrong version, is `invalid-bound`.

## Tests added

`libs/shared/src/lib/types/provider-account.schemas.spec.ts` covers round-trips, excess authority keys, invalid provider, scope, revision, and version, malformed versus absent binding, sanitized summary rejection, display-label acceptance, and label length and control-character rejection. The schema import is the public-entry regression.

**Tests NOT RUN** in this correction lane, including the new display-label cases and the public-entry import. The 3745 passing shared tests are the pre-correction B01-V1 result, not evidence for these edits.

Orchestrator serial command, from the worktree, when the heavy-check lock is free:

```powershell
$H = @('ptah-electron','ptah-cli','ptah-tui','ptah-extension-vscode','ptah-extension-webview')
Verify-ProviderAccountsBatch -Projects @('@ptah-extension/shared') -Hosts $H
```

Focused diagnosis only if that gate fails:

```powershell
npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/provider-account.schemas.spec.ts --coverage=false --maxWorkers=2
```

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Export types from `src/index.ts` and schemas from `src/schemas.ts` | Re-export schemas from the main barrel; leave schemas unreachable | Main barrel stays zod-free. `provider-profile.schemas.ts` is already on `src/schemas.ts`. B01-V1 required the same public entry. Batch ownership of `schemas.ts` was authorized for this correction | Yes. One re-export line |
| Spec imports schemas through `@ptah-extension/shared/schemas` | Keep the relative schema import; import a deep file path from another project | B01-V1: public-entry regression, no deep cross-project imports. Path is `tsconfig.base.json` | Yes |
| Provider union is `claude` and `codex` | Claude only until Phase 2; both providers now | The task vocabulary covers both account providers. Batch 1 forbids system-tuple activation, not naming Codex on an account record | Yes, until callers exhaust the union |
| Scopes are `main` and `lane` | Add `default` or `workspace` as a scope | Plan lines 100 and 118. Default is an action. Workspace stays with the later RPC batch | Yes |
| Summary owner is `verified` \| `unknown`. Binding identity is `known` plus a hex digest, or `unknown` | One shared enum | Design §3.3 versus plan line 117. Binding file was not changed; verifier said the binding matches plan 117 | Yes |
| Labels are bounded display text. Summaries still reject path, env, address, and secret characters | Keep the label character blacklist; apply the summary blacklist to labels too | Plan line 122. B01-V1: accept `Research & Development`, `Work: Europe`, `Team/A`, with length and control-character checks | Yes |
| Safe parse helpers drop Zod issues | Return the issue list | A rejected payload can contain a path or identity, and Zod issues can echo input | Yes |

## Unresolved risks

- This correction was not typechecked or tested. A failure of the public-entry import under Jest, or a label case the predicate still rejects, would show up on the parent re-verification. The 3745 shared passes and the host failures above predate these edits.
- Host test and lint failures from B01-V1 remain unresolved and are outside this batch.
- Later batches still need to thread the binding through provider-profile and agent contracts. This batch did not do that.
- No installed-runtime or credential behavior was exercised.

## Blockers

No owned file was skipped. Completion is not claimed. Parent re-verification still owns B01-V1 acceptance.
