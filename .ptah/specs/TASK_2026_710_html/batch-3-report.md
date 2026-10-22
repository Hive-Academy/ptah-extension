# Batch 3 report — Electron artifact persistence

## Files changed

- `libs/backend/platform-electron/src/artifacts/electron-artifact-store.ts` — added the `IArtifactStore` implementation.
- `libs/backend/platform-electron/src/artifacts/electron-artifact-store.spec.ts` — added temp-directory regression specs.
- `libs/backend/platform-electron/src/registration.ts` — registered the store using the injected `userDataPath`.
- `apps/ptah-electron/src/main.ts` — resolved published bytes from the DI store after boot, preserving E2E fixture priority.

## Storage layout

`<userData>/artifacts/<opaque-uuid>/1/index.html` and sibling `metadata.json`. Publish writes bytes to a temporary file, renames them, writes and renames metadata, then renames the temporary record directory into its committed location. Failed writes remove the temporary directory. Only committed directories are listed or read. The source HTML is copied into managed storage. A workspace is limited to 500 records; the 501st publish is rejected. Lists return at most 200 records, newest first, scoped to canonical workspace root and session.

## Verification

- Artifact Jest specs: **1 suite, 6 tests passed** (final run).
- `nx typecheck platform-electron --parallel=1`: **passed** (final run).
- `nx typecheck ptah-electron --parallel=1`: **failed** in files owned by another batch: `artifact-tool-handlers.ts` and `artifact-tools.ts` import nonexistent `@ptah-extension/shared/mcp-apps-contracts/artifact.schemas` / `.types` subpaths; `artifact-tools.ts` also has TS2322 on the tool schema type. No errors were reported in this batch's files.
- Electron `container.smoke.spec.ts`: **1 suite, 29 tests passed**.
- `ptah_get_diagnostics` was attempted after edits but unavailable because its TypeScript worker timed out; the scoped Nx typecheck verified the store.

## Decisions

- Registered in `platform-electron/src/registration.ts`, where comparable platform stores receive `userDataPath`. The alternative phase-3 registration would duplicate this existing seam. Reversible by moving this one registration.
- Used the existing `isPathWithinRoots` guard on both the lexical path and the real path, so symlinks outside the workspace are rejected. Reversible only if the platform's containment policy changes.
- Reject at 500 workspace records instead of evicting an existing artifact, because silent eviction would remove user work. Reversible through a future retention policy.

## Not done

- Did not edit `vscode-lm-tools` typecheck failures because Batch 5 owns those files.
- Did not implement named-artifact replacement revisions; the current `IArtifactStore.publish` input has no replacement identifier and every publish creates a new id at revision 1.
