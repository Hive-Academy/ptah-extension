# Batch 14 report

## Files changed

- `libs/shared/src/lib/types/execution/stream.ts:291-292`: added the optional idle compaction notice contract.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts:109-116`: reads the lifecycle notice for the SDK session (falling back to the resolved session) and adds the field only when a notice exists.
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts:115-185`: added cases for a matched notice, an unmatched notice, a partial lifecycle fake, and a later manual boundary after a PostCompact-only idle path.

## Verification

- Focused Jest command: `FAIL agent-sdk ...system-message.transformer.spec.ts`; `Test Suites: 1 failed, 1 total`; `Tests: 0 total`; exit 1. Jest reported it could not load the TypeScript ES module `jest.config.ts`, so no tests executed.
- `npx nx typecheck @ptah-extension/shared --parallel=1`: `Cache: 0/1 hit (0%)`; exit 0.
- `npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: first run exited 1 on a branded `SessionId` mismatch; after the cast, `Cache: 0/1 hit (0%)`; exit 0.
- `npx prettier --check` on all three files: `All matched files use Prettier code style!`; exit 0. The spec required `prettier --write` first.
- `npx eslint` on all three files: no diagnostics; exit 0.
- `ptah_get_diagnostics`: first scoped check timed out; after the type fix it reported zero errors for the two backend files. The final three-file request timed out. The two Nx typechecks passed after the final source edit.

## Decisions

- Cast the SDK or resolved session key to the branded `SessionId` at the lifecycle lookup. The plan requires that fallback key, while `TransformerSessionId` can also be a harness or wizard ID; the SDK boundary remains the sole source of the notice. This is reversible.
- Keep the PostCompact-only advisory fallback generic. It is implemented in the frontend and emits no SDK compact boundary through this transformer. The backend spec covers a later manual boundary with no matching notice; direct frontend fallback verification belongs to its own batch. This is reversible.

## Not done

- Focused Jest assertions could not execute because Jest failed while loading its configuration. No out-of-scope files were changed.
