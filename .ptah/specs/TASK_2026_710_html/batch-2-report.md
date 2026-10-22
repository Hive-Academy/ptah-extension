# Batch 2 report

## Files changed

- `libs/shared/src/mcp-apps-contracts/artifact.types.ts` — plain artifact, RPC and bridge types.
- `libs/shared/src/mcp-apps-contracts/artifact.schemas.ts` — strict Zod schemas and artifact limits/constants.
- `libs/shared/src/mcp-apps-contracts/artifact.schemas.spec.ts` — publish and bridge edge-case tests.
- `libs/shared/src/mcp-apps-contracts/index.ts` — secondary-entry exports.
- `libs/shared/src/index.ts` — type-only artifact exports; Zod remains out of this path.
- `libs/backend/platform-core/src/interfaces/artifact-store.interface.ts` — scoped store port and typed errors.
- `libs/backend/platform-core/src/di/tokens.ts` — `ARTIFACT_STORE` token.
- `libs/backend/platform-core/src/index.ts` — port and error exports.

## Exported names

- Shared types: `ArtifactRecord`, `ArtifactPublishInput`, `ArtifactPublishResult`, `ArtifactPublishedNotification`, `ArtifactListRequest`, `ArtifactListResponse`, `ArtifactThemeVarName`, `ArtifactThemeMessage`, `ArtifactHeightMessage`, `ArtifactOpenLinkMessage`, `ArtifactHostToPageMessage`, `ArtifactPageToHostMessage`.
- Schemas: `ArtifactPublishInputSchema`, `ArtifactRecordSchema`, `ArtifactPublishResultSchema`, `ArtifactPublishedNotificationSchema`, `ArtifactListRequestSchema`, `ArtifactListResponseSchema`, `ArtifactThemeMessageSchema`, `ArtifactHeightMessageSchema`, `ArtifactOpenLinkMessageSchema`, `ArtifactPageToHostMessageSchema`.
- Constants: `ARTIFACT_MAX_BYTES`, `ARTIFACT_HEIGHT_MIN`, `ARTIFACT_HEIGHT_MAX`, `ARTIFACT_PROTOCOL_SCHEME`, `ARTIFACT_THEME_VAR_ALLOWLIST`.
- Platform: `IArtifactStore`, `ArtifactScope`, `ArtifactStoreErrorCode`, `ArtifactStoreError`, `PLATFORM_TOKENS.ARTIFACT_STORE`.

## Verification

- Named Jest run: 2 suites passed, 15 tests passed (artifact schemas and Zod-free contract guard). Jest reported a worker teardown warning, but exited 0.
- `npx nx typecheck shared --parallel=1`: passed.
- `npx nx typecheck platform-core --parallel=1`: passed.
- Scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
- Nx Cloud reported a disabled organization after successful local typechecks; it did not affect exit status.

## Decisions

- List request is an empty strict object. The host derives workspace/session scope rather than accepting an agent or renderer supplied identity. Reversible if a later RPC needs a verified selector.
- `ArtifactStoreError` carries a safe typed code for invalid input, path, size, absence and unsupported host behavior. Adapters must avoid leaking HTML/path text and must commit records atomically. Reversible by extending the code union.
- Theme allowlist uses 11 variables confirmed in `apps/ptah-extension-webview/src/styles.css`; values are bounded strings and unknown names fail validation. Reversible by adding specific variables.

## Not done / integration note

- No store adapter, RPC handler, protocol import or Electron files were part of this batch.
- Batch 1's `apps/ptah-electron/src/artifacts/artifact-protocol.ts` already defines `ARTIFACT_SCHEME = 'ptah-artifact'` and `ARTIFACT_CSP`. The shared contract independently defines `ARTIFACT_PROTOCOL_SCHEME`; the orchestrator should reconcile the duplicated scheme literal when integrating batches.
