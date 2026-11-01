# Batch 8f-3: Codex executable pin

Removed the production manifest JSON dependency from the executable pin loader. The portable pin now contains only the six fields required by CodexExecutableManifestRow, with values copied exactly from the current win32/x64 manifest row.

## Files modified or created

- Modified `libs/backend/codex-runtime/src/lib/codex-executable-pin.ts:2`: imports the reviewed TypeScript data instead of requiring the JSON manifest. At line 5, the cache starts empty; at line 13, the first lookup validates and freezes the pin. Later lookups reuse that result. The public signature and unsupported-platform behavior are unchanged.
- Created `libs/backend/codex-runtime/src/lib/codex-executable-pin-data.ts:4`: typed, frozen portable identity containing platform, arch, pinnedVersion, version, binarySha256 and schemaSha256. No developer path, method lists or other diagnostic metadata.
- Modified `libs/backend/codex-runtime/src/lib/codex-executable-pin.spec.ts:7`: added an exact comparison of the data constant against the manifest's six-field projection, using test-only fs/path access to `protocol/codex-app-server-protocol.manifest.json`. At line 26, added a cached-result identity assertion. Existing frozen-result, field-exclusion and unsupported-platform cases remain.
- Created `.ptah/specs/TASK_2026_714_c8a2/batch-8f-3-report.md`: this handoff report.

All paths above are relative to `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration`.

## Decisions

- Retained one reviewed row because the current manifest represents only win32/x64.
- Retained both version fields and both hashes because all six properties are required by the public row interface.
- Preserved the existing string validation semantics and frozen return value. Schema construction and parsing now happen inside the first lookup, avoiding import-time validation failures.
- Kept the new data module internal; no index export or host edits were needed.
- The drift assertion compares the raw data constant to an explicit projection, so added diagnostic fields in the pin also fail equality.

## Not done

- No verification, build, test, lint, typecheck, Nx, npm or git-mutating commands were run, as required. Specs are written but unexecuted; the team leader owns verification and commits.
- No changes were made in the parallel Electron, rpc-handlers or agent-sdk lanes.
