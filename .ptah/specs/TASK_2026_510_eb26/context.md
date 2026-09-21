# Context

- `cbba134b3` built successfully with electron-builder/app-builder-lib 26.8.1.
- `88d473b3e` refreshed the lockfile within the declared `^26.8.1` range and
  resolved electron-builder/app-builder-lib 26.15.3.
- On Windows, 26.15.3 repeatedly fails with `EPERM` while renaming
  `win-unpacked.tmp` to `win-unpacked`.
- npm's `latest` tag is 26.15.3, while its current stable `v26` tag is 26.16.1.
- A fresh directory in the same parent renames successfully. The extracted
  tree's original `locales` directory is the only element that reproduces the
  lock; copied locale files in a newly created directory rename successfully.
- Microsoft Sysinternals Handle reports no user-visible file handle. Windows
  Search is active, and the failure is a transient directory-handle race rather
  than an ACL problem: a fresh directory in the same parent renames normally.
- Marking the release directory as not content-indexed did not prevent the
  handle race, so the fix does not depend on a machine-specific Search setting.
- electron-builder 26.16.1 retries the failed rename five times and then safely
  falls back to copy-and-delete. The same build that fails on 26.15.3 completed
  with 26.16.1 and produced the NSIS installer.
- Both failed attempts completed the Electron 44.4.3 native rebuild and all 14
  prerequisite Nx tasks before reaching this dependency-owned rename.
