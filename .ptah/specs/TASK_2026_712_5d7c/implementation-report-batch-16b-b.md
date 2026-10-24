# Batch 16b-B: SDK session attachment and lookup

Implemented the store/service checkpoint and regression specs. Admission remains release-held. Diagnostics report no errors or warnings in the three changed files, but one error in an out-of-scope sibling file. Tests were not run, as instructed.

## Files changed

- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`: validated immutable SDK attachment, authoritative SDK lookup, shared persisted-binding parser.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts`: awaitable wrappers with disposed-service refusal; admission behavior unchanged.
- `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`: migration fixture, attachment/lookup/refusal regression cases, and extended disposal assertions.
- This report is the explicitly requested deliverable. No migration, part A report, task state, registration, or other source file was edited. No git command was run.

## API signatures

Both store and service expose:

```ts
attachSdkSession(request: AccountSdkSessionAttachment): Promise<AccountSdkSessionAttachmentResult>
lookupBySdkSession(request: AccountSdkSessionLookup): Promise<AccountBindingLookup>

interface AccountSdkSessionLookup {
  readonly provider: string;
  readonly sdkSessionId: string;
}
interface AccountSdkSessionAttachment extends AccountSdkSessionLookup {
  readonly runId: string;
  readonly attachedAt: number;
}
type AccountSdkSessionAttachmentResult = {
  readonly status: 'attached' | 'binding-absent' | 'session-linked-elsewhere' | 'run-linked-elsewhere';
};
```

Attachment resolves only after transaction commit. Invalid request values reject with the existing safe `ProviderAccountStoreError('conflict')`; malformed persisted evidence rejects with `invalid-bound`. Database failures retain existing sanitized `busy`, `conflict`, or `unavailable-storage` errors. A disposed service rejects attachment with `unavailable-storage`.

Lookup uses exactly the existing `AccountBindingLookup`: `bound` with a full frozen binding, `absent`, `invalid-bound` (malformed), or `unavailable-storage`. A disposed service returns `unavailable-storage`. Do not interpret any refusal as legacy absence.

## Acceptance evidence

Line references below are relative to `libs/backend/auth-providers/src/lib/accounts/`.

1. **Transactional attachment:** `provider-account.store.ts:117` validates input and uses the existing `BEGIN IMMEDIATE`/commit/rollback helper at `:64`. It requires a run binding with matching provider; missing binding/provider mismatch returns `binding-absent`. The session-key check returns idempotent `attached` or `session-linked-elsewhere`; the run-key check returns `run-linked-elsewhere`. Existing links are never updated, including `attached_at`. SQL values use bound parameters. The existing helper reads native SQLite error codes structurally through `providerAccountErrorCode`, never `instanceof Error`.
2. **SDK-ID lookup:** `provider-account.store.ts:145` reads the link and binding within one transaction. Missing link is `absent`; orphan link, malformed link/binding, and provider mismatch refuse as `invalid-bound`. Database failure is `unavailable-storage`. `:191` shares the existing strict binding validation and frozen path-free projection with run-ID lookup.
3. **Service lifecycle:** `provider-account.service.ts:48` and `:53` provide awaitable wrappers and preserve disposed-service refusal. `:68` still returns `release-held`; no prompt admission, sign-in, credentials, or inference behavior was enabled.
4. **Regression specs:** `provider-account.store.spec.ts:83` covers attachment, visibility through an independent connection, full known-identity binding, service delegation, frozen results, idempotency, and preservation of the original timestamp. `:102`, `:112`, and `:122` cover both collision directions, absent binding, and provider mismatch with no write. `:130` covers empty, slash, backslash, raw Unix/Windows paths, overlong, whitespace, and NUL IDs; `:138` covers the 256-character boundary. `:144`, `:152`, and `:161` cover absence, orphan links, provider-mismatched links, and malformed persisted identity. `:176` covers structural I/O failure and a closed database. `:189` tests native constraint rollback; `:199` tests a constraint-code object outside the Error hierarchy. `:256` extends disposed-service checks and retains the held-admission assertion.
5. **Path safety:** SDK IDs accept 1–256 characters without separators, whitespace, or controls (`provider-account.store.ts:16`). Requests are strict schemas; provider identifiers and timestamps are also bounded/validated. Returned attachment results contain only a status; bound lookup returns only the established binding projection. Tests assert exact sanitized refusal messages/statuses, reject path-bearing IDs, and check the successful binding contains no account root or directory properties. No logging call was added to either implementation; caught SQLite messages are not propagated. The new lookup catch includes the library's degradation-audit suppression form and returns an explicit refusal, never an ambient fallback.

## Verification

- Ran `ptah_get_diagnostics` twice, scoped only to the three changed TypeScript files; the second run followed the final source/spec edits.
- Final result: TypeScript compiler, coverage clean, **0 diagnostics in requested files**, **1 error / 0 warnings overall**.
- Out-of-scope error: `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:734`, TS2339: property `binding` is accessed on a union that still includes `{ status: 'unavailable-storage' | 'invalid-bound' }`. That file was not edited. Its owner must resolve the narrowing error; this batch does not claim a clean project/host typecheck.
- Store AST analysis after editing reported `parseStatus: ok`, zero error nodes.
- Did not run Nx, Jest, tsc, ESLint, builds, serve, packaging, or e2e. Regression cases are written, not runtime-verified. No degradation-audit command was run.
- The store spec originally loaded only migration 0058, contrary to the prompt's full-list note. Its fixture now loads migrations 0058 and 0059 from the exported `MIGRATIONS` list and explicitly fails if either is missing. It relies on the parallel migration lane's exact schema; it does not create a substitute table.
- The Ptah file-read workflow (`execute_code` / `ptah.files.read`) returned an error; targeted native source reads were used after that failure.

## Decisions

1. **Use status results for the three required attachment refusals, retaining existing write exceptions for invalid input/storage failure.** Options: local typed result or new shared error codes. Evidence: the exact three-file ownership boundary, existing awaitable commit exception behavior, and existing lookup status conventions. Reversible additive API choice; no shared/public contract was changed.
2. **Limit SDK IDs to 256 characters and reject whitespace/control characters as well as separators.** Options: a generic bounded opaque string or a UUID-only format. Evidence: the task requires bounded path-free identifiers but specifies no SDK UUID format. This permits opaque SDK IDs without assuming a vendor-specific format. Reversible validator bound; no persisted IDs are rewritten.
3. **Share the persisted-binding parser within the existing store.** Options: duplicate validation, call the public transactional run lookup inside another transaction, or extract the existing parser. Evidence: `atomic` rejects nested transactions and both APIs must apply identical evidence validation. The extraction preserves the existing run lookup behavior and avoids a new module. Reversible internal refactor.
4. **Load only account migrations 0058/0059 in the existing focused fixture.** Options: extend the actual account-only fixture or change it to execute every workspace migration. Evidence: source at `provider-account.store.spec.ts:29` originally selected version 58 alone. Adding 59 preserves isolation and uses the real exported migration. Reversible test-only adjustment.

## Batch 17 handoff

After the SDK init message reports its session ID, await:

```ts
const attachment = await providerAccountService.attachSdkSession({
  provider: 'claude', runId, sdkSessionId, attachedAt: Date.now(),
});
```

The run binding must already be committed. Continue only when `attachment.status === 'attached'`; any refusal or rejection keeps prompt release held. Await the existing immutable session-metadata persistence checkpoint as well before releasing the prompt gate. This batch does not coordinate or compensate the two stores and does not lift named-import refusal.

On resume, first await `providerAccountService.lookupBySdkSession({ provider: 'claude', sdkSessionId })`. Pass that authoritative result into the existing server-first metadata resolver. Only genuine `absent` permits legacy classification; `invalid-bound`/`unavailable-storage` refuse. A `bound` result still requires the existing live-route and identity proof; unknown baseline must remain non-resumable. Resolve the sibling TS2339 error and run the focused store specs with migration 0059 present in CI/the authorized verification lane.
