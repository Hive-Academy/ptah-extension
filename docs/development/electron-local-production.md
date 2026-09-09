# Local production Electron installer

This path builds an unsigned Windows installer from a clean local checkout. It
uses the production app ID (`com.ptah.desktop`), product/package identity,
version, API, account, `%APPDATA%\Ptah` profile, and `~/.ptah` data. It does not
change `NODE_ENV`, redirect `userData`, publish, or use signing credentials.

## 1. Back up production data while every Ptah host is closed

Close the Ptah desktop app, every Ptah CLI/TUI process, and all VS Code windows
before starting the backup. VS Code must be fully closed because Windows process
metadata cannot prove whether the Ptah extension is active in an extension host.
Choose a new destination outside both production data directories, then run:

```powershell
npm run electron:backup:production-data -- --destination D:\ptah-backups\before-local-2026-09-09
```

The command inspects Windows processes without terminating them. It refuses a
desktop process, any VS Code-family process, an identifiable packaged or
workspace Ptah CLI/TUI process, a Node process whose command line cannot be
inspected, or any malformed/failed inspection. It also requires every discovered
SQLite database, WAL, and SHM file to be exclusively openable before copying.
An existing or recursive destination is refused. The Electron profile and
`~/.ptah` are copied together; hashes verify that each copied file matches the
bytes read from its source, while a database size/mtime comparison is only a
secondary change detector and is not treated as proof of consistency.
Rebuildable caches, logs, downloaded models, and nested backup directories are
excluded. Treat the backup as sensitive because it can contain account/session
material.

This is a conservative offline preflight, not a filesystem snapshot: another
writer could still be launched after inspection begins, and an unrelated process
that edits these directories may not identify itself as Ptah. Do not start Ptah,
the CLI/TUI, VS Code, or another writer until the command finishes. If the command
cannot verify safety, keep the existing data untouched, close the reported
processes, and retry; do not work around the guard.

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
