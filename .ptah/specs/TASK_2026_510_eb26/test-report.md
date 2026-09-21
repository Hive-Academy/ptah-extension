# Test report

## Result

PASS. A clean local-production package completed from commit
`c24b6e4cf8a5f8c2d3aaeaf2a63eb99c37372135`.

## Root causes and fixes

1. The dependency refresh resolved the declared `^26.8.1` range to
   electron-builder 26.15.3. That release fails when Windows temporarily keeps
   `win-unpacked.tmp` open during the final directory rename. The current stable
   v26 release, 26.16.1, retries and then safely falls back to copy-and-delete.
   The manifest and lockfile now pin that tested release.
2. The better-sqlite3 v13 packaging fix existed on an unmerged branch. Main
   still expected `build/Release/better_sqlite3.node`, while v13 loads
   `prebuilds/win32-x64.node`. The fix now forces a source build, promotes it to
   the loader-selected path, and executes a real SQLite query under Electron.

## Automated checks

- `local-production-build.spec.ts`: 4/4 passed.
- `better-sqlite3-packaging.spec.ts`: 4/4 passed under Electron 44.4.3,
  ABI 149, N-API 10, SQLite 3.53.4.
- `nx lint ptah-electron`: passed with 12 pre-existing warnings and no errors.
- Repository pre-commit affected lint and Electron dependency validation:
  passed for both implementation commits.
- `npx nx package-local-production ptah-electron`: passed all 15 tasks.
- Unsigned installer/app policy: 11 executables inspected and passed.
- Packed better-sqlite3: exact rebuilt-binary hash match and real Electron
  SQLite query passed.
- Packed `@parcel/watcher`: require, subscribe, and unsubscribe passed.
- Packed tree-sitter WASM grammars: passed.
- Packed onnxruntime-node 1.24.3: passed.

## Artifact

- File: `dist/release/local-production/Ptah-Local-c24b6e4cf8a5-0.1.70.exe`
- Size: 515,559,708 bytes
- SHA-256: `629CA0E0E9B8930A8C4DA7411795A828393B78A499C6629346230E505B1FF687`
- Embedded source identity:
  `c24b6e4cf8a5f8c2d3aaeaf2a63eb99c37372135`
