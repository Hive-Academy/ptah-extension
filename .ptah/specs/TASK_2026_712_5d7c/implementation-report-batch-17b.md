# Batch 17b implementation report

Implemented the six assigned source/spec changes. Final scoped diagnostics: **0 errors, 0 warnings**. Tests were added but not executed, as instructed. Named import remains explicitly unsupported when its optional authoritative lookup is not registered. No DI registration, RPC-handler file, task state, or git operation was changed.

## Files changed

Paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/provider-accounts/`.

1. `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`
2. `libs/backend/agent-sdk/src/lib/session-metadata-store.account-binding.spec.ts`
3. `libs/backend/agent-sdk/src/lib/session-importer.service.ts`
4. `libs/backend/agent-sdk/src/lib/session-importer.service.spec.ts`
5. `libs/shared/src/lib/types/provider-account.schemas.ts`
6. `libs/shared/src/lib/types/provider-account.schemas.spec.ts`

This report is the only additional file written.

## Acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Resume requires both durable stores | `session-metadata-store.ts:736` throws typed `linkage-incomplete` when the authoritative binding exists but metadata or its linkage is absent. The following comparison still rejects conflicts; unknown identity still rejects resume. Authoritative absence plus local linkage still refuses, and genuinely absent linkage remains ambient. |
| Lookup rather than directory-derived binding | `session-importer.service.ts:33` defines `SessionImportBindingLookup`; `:40` exports its token; `:212` injects it optionally. `:336` awaits authoritative lookup by provider and SDK session ID, then checks profile, fingerprint, route revision and auth epoch against the resolved route. Absent, invalid or unavailable attachments refuse. No run binding or identity is manufactured. |
| Unwired named import remains held | `session-importer.service.ts:257` rejects with the existing `unsupported` resource error before filesystem/metadata work or joining another scan. |
| Context and scan isolation | `session-importer.service.ts:259` keys scans by normalized workspace, resource key and profile. `:273` passes context to runScan; `:296`, `:303` and `:313` carry it to root resolution and both scan strategies. |
| Collisions cannot enter the existing-record skip | `session-importer.service.ts:608` and `:717` obtain the authoritative binding and call `getAccountBound` before skipping. `:668`, `:683` and `:762` propagate named failures through both per-entry and outer catches. |
| Success follows durable linkage | `session-importer.service.ts:660` and `:753` await `saveAccountBound` before incrementing the imported count. Failures reject the scan. |
| No intermediate ambient child write | `session-importer.service.ts:621` and `:727` explicitly refuse unverified global child references before `createChild`. `:324` excludes named scans from global-ID pruning. |
| Named metadata cannot attach under a different transcript ID | `session-importer.service.ts:749` checks parsed metadata against the filename SDK ID before the bound write. |
| Account paths are not logged by newly enabled named helper paths | `session-importer.service.ts:819`, `:911` and `:990` convert named directory/read/parse failures to fixed resource refusals before the existing ambient logging paths. |
| Zero-based binding epochs/revisions only | `provider-account.schemas.ts:50`, `:124` and `:126` accept nonnegative safe integers for binding routeRevision/authEpoch. Summary revision stays on the original positive schema; all other fields and strict-object validation remain unchanged. Migration evidence: `libs/backend/persistence-sqlite/src/lib/migrations/0058_provider_accounts.ts:19`, `:20`, `:63`, `:65`. |

Source basenames in this table refer to the files listed above.

## Test cases added or extended

- `session-metadata-store.account-binding.spec.ts:117`: authoritative bound plus no metadata; authoritative bound plus metadata with no linkage; authoritative lookup happens first.
- `session-metadata-store.account-binding.spec.ts:129`: matching durable metadata survives reconstruction and resolves; `:137`: both stores absent remain ambient. Existing unknown-identity, conflict and dangling-link tests remain (`:77`, `:150`).
- `session-importer.service.spec.ts:108`: the new named-linkage suite exercises both index and JSONL discovery. It covers delayed bound saves, failed saves, same-ID ambient and other-route collisions, matching existing records, unsafe child refusal with no write, absent/invalid/unavailable lookup results, route mismatch, unknown-identity import with resume refusal, and ambient imports without lookup use.
- `session-importer.service.spec.ts:269`: no injected lookup refuses before I/O; `:279`: the authoritative lookup must settle before local linkage is read; `:299`: named transcript read errors do not log account paths; `:309`: same-route deduplication and separation from ambient/other routes.
- `provider-account.schemas.spec.ts:295`: each binding epoch/revision accepts 0, 1 and MAX_SAFE_INTEGER; rejects -1, 1.5, MAX_SAFE_INTEGER+1 and numeric strings. `:304` keeps summary revision zero invalid. Existing malformed-binding expectations were updated to stop treating zero as malformed.
- Fixed the metadata spec's concrete MockLogger-to-Logger diagnostic using a typed projection of the four mocked methods (`session-metadata-store.account-binding.spec.ts:25`). The importer logger helper uses the same projection, removing its previous double assertion.

These are authored regression cases, not executed test results. The named-root helper is mocked in importer unit fixtures; host filesystem certification remains integration work.

## Diagnostics

- Used `ptah_get_diagnostics` scoped to exactly the six changed files; no Nx, Jest, tsc, eslint, build, serve, e2e or package command was run.
- Initial request exceeded the tool's 45-second response window and reported six unchecked files. A subsequent result reported 17,981 errors, including missing standard globals (`Promise`, `JSON`) and `tsyringe` declarations. That result also exposed the concrete logger-fixture mismatch, which was corrected.
- **Final request after all source/spec edits completed: typescript-compiler, clean coverage, 0 errors, 0 warnings; 0 requested-file or sibling-file issues.** The earlier diagnostic failures are not presented as a passing check.
- Tests and host builds were not run. No runtime certification or end-to-end named-account release is claimed.
- `ptah_code_search_symbols` returned an empty index; targeted native searches/reads supplemented AST analysis. No tooling or dependency configuration was modified.

## Decisions

1. **Optional authoritative import lookup, separate from resume resolution.** Options: reuse the resume port; infer a binding from a directory; inject an SDK-session lookup. Chose the lookup because resume now requires local metadata, while import is creating it, and the Batch 16 handoff forbids inferred bindings. The existing `ProviderAccountService.lookupBySdkSession` contract matches it (`libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:53`, store lookup types at `provider-account.store.ts:31`). Reversible additive host wiring; absence retains explicit refusal.
2. **Refuse unscoped child references; do not prune named scans.** Options: add a cross-store child ownership model; trust global SDK IDs; explicitly refuse the unsafe cases. Chose refusal and omitted named pruning because the handoff explicitly permits this and the allowed files do not supply a scoped parent-link contract. Ambient behavior stays unchanged. Reversible when scoped child/prune contracts are implemented.
3. **Compare the imported binding's route, not the scan's run ID.** The lookup returns the original immutable SDK-session attachment, including its original run ID. A scan's run may differ. Profile, fingerprint, revision and epoch must match, and the entire returned binding is validated/persisted through metadata-store APIs. Reversible only with a separately defined import policy; no immutable attachment is rewritten.
4. **Keep summary revisions positive.** Options: loosen the shared revision helper for every consumer; add a binding-only nonnegative schema. Chose the latter because the request names route revision/auth epoch and prohibits loosening other fields. Evidence: summary revision uses the original helper at `provider-account.schemas.ts:92`; binding fields use the new helper at `:124`/`:126`. Reversible without a storage migration.
5. **Retain unknown identity as evidence, never as resume authorization.** The Batch 16 handoff explicitly allows unknown imported evidence. The importer persists it, while the two-store resume resolver still rejects it. No account identity is inferred from filenames or directories. This retains the existing immutable-binding policy.

## DI and other out-of-scope changes needed

- `libs/backend/agent-sdk/src/index.ts:69`: re-export `SDK_SESSION_IMPORT_BINDING_LOOKUP` and type `SessionImportBindingLookup` alongside the importer for the composition-root owner. This file was not edited.
- `libs/backend/agent-sdk/src/lib/di/register.ts:222`: the importer registration continues to resolve successfully without the new optional dependency. The Electron composition owner must register the token with an adapter forwarding to `ProviderAccountService.lookupBySdkSession` (`libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:53`) before enabling named import. The token is `Symbol.for('SdkSessionImportBindingLookup')`, declared at `session-importer.service.ts:40`. Add DI guard coverage in that owner's batch; no registration was performed here.
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:559`: the existing named persistence adapter contract still needs host wiring. Its resume implementation can now delegate to `SessionMetadataStore.resolveAccountBinding` with authoritative SDK-session lookup, because the store itself enforces both checkpoints. Import must use the new lookup contract instead of this resume resolver.
- Missing authoritative attachment remains `linkage-incomplete`; this batch does not create registry attachments from transcript directories. A failed metadata write leaves the existing authoritative attachment unresumable until matching metadata is durably present.
- The earlier `jsonl-reader.service.ts` logging/symlink follow-ups and process-termination certification remain outside these six owned files. Named admission stays release-held pending its coordinating workflow; this batch does not change that gate.

## Shared schema consumers checked

Searched direct `provider-account.schemas` imports and the exported binding/summary parsers/schemas across `libs` and `apps`, including barrel consumers.

| Consumer | Finding |
| --- | --- |
| `libs/shared/src/schemas.ts:28` | Re-export only; no positivity assumption. |
| `libs/shared/src/lib/types/provider-profile.schemas.ts:11`, `:16` | Composes the optional binding schema; performs no epoch/revision arithmetic or positivity check. Zero now passes the nested binding schema as intended. |
| `libs/shared/src/lib/types/provider-account-binding.spec.ts:11` | Tests selection and binding/profile transport. Existing positive fixtures remain valid; malformed cases do not depend on rejecting epoch/revision zero. No edit needed. |
| `libs/shared/src/lib/types/provider-profile.types.spec.ts:1` | Tests profile validation. Its nonpositive rejection concerns defaultMaxTokens, which is unchanged. |
| `libs/shared/src/lib/types/provider-account.schemas.spec.ts:319` | The old malformed-binding list rejected zero routeRevision/authEpoch; updated in the owned spec and covered by explicit zero/noninteger cases. |
| `libs/shared/src/lib/types/provider-account.types.ts:5` | Documentation reference only; no runtime schema import or positivity dependency. |

No additional runtime consumer relying on positive binding epochs/revisions was found. Summary revision and defaultMaxTokens constraints remain positive.
