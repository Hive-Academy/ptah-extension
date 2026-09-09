# Local production Electron installer

This path builds an unsigned Windows installer from a clean local checkout. It
uses the production app ID (`com.ptah.desktop`), product/package identity,
version, API, account, `%APPDATA%\Ptah` profile, and `~/.ptah` data. It does not
change `NODE_ENV`, redirect `userData`, publish, or use signing credentials.

## 1. Back up production data while Ptah is closed

Close Ptah completely, choose a new destination outside both production data
directories, then run:

```powershell
npm run electron:backup:production-data -- --destination D:\ptah-backups\before-local-2026-09-09
```

The command refuses to run while `Ptah.exe` is present, refuses an existing or
recursive destination, copies the Electron profile and `~/.ptah`, includes the
SQLite database with its WAL/SHM files, hashes every copied file, and refuses a
backup if database files change during the copy. Rebuildable caches, logs,
downloaded models, and nested backup directories are excluded. Treat the backup
as sensitive because it can contain account/session material.

Never install a local build without its paired backup. Forward database or
settings migrations may make data unreadable by an older production build; an
installer rollback does not reverse those migrations. Restoring the paired
backup must be done with Ptah closed and is intentionally a manual operation.

## 2. Build the installer

Commit or stash every change first; the command deliberately has no dirty-tree
override. Then run:

```powershell
npm run electron:package:local-production
```

Artifacts are isolated under `dist/release/local-production`. The target uses
the normal production build, renderer copy, Electron native rebuild, and packed
native/WASM/ONNX gates. Its packaging guard passes `--publish never`, removes
signing-related environment variables, disables certificate autodiscovery and
refuses custom packaging hooks, embeds the full Git SHA as `ptahBuildIdentity`, and
requires Windows Authenticode status `NotSigned` for every generated executable.

The embedded identity disables both scheduled and manual update checks. Normal
production builds have no marker and retain their existing updater behavior.

## 3. Install and roll back

The local installer deliberately retains the source package version. Check that
version against the installed Ptah version yourself; this workflow does not
claim or synthesize a newer release number and does not automate downgrades.
Windows may warn because the installer is unsigned.

To return to a public build, reinstall the desired official installer. If the
local build ran any forward migration, reinstalling alone is insufficient:
restore the matching pre-install backup with Ptah closed. There is no automatic
downgrade or data rollback command.
