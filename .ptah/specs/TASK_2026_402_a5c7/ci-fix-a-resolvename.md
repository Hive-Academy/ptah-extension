# CI fix: resolveName

Changed `resolveName` to derive fallback workspace labels with the existing cross-platform `deriveWorkspaceLabel` helper. Added a POSIX-path regression case while retaining the Windows-path coverage.

Verification:

- `test` exited 0 and ran `@ptah-extension/agent-sdk` (1 project): 101 passed suites, 1 skipped; 1,767 passed tests, 2 skipped; 0 snapshots.
- `typecheck` exited 0 and ran `@ptah-extension/agent-sdk` (1 project).

Nothing could not be completed.
