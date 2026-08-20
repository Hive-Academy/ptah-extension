# Context

## How it surfaced

Memory search returned nothing. `ptah.memory.list()` answered:

```
Persistence is offline: The database schema is newer than this build of Ptah.
Update Ptah, or remove ~/.ptah/state to start fresh.
```

The first reading — "your dev work broke it" — was wrong, and the developer
said so: dev runs use a separate database. They were right. The dev database
was never the problem.

The second wrong reading was about the host. The degraded process was assumed
to be the VS Code extension; the prod-profile log names it outright —
`workerEntry: %LOCALAPPDATA%\Programs\Ptah\resources\app.asar\embedder-worker.mjs`,
`dbPath: ~\.ptah\state\ptah.sqlite`, then `[ERROR] migration failed —
persistence disabled` at 2026-08-18T08:12:10Z. It is the **packaged Electron
app**, and `main.ts:30` corroborates it: the window is titled `Ptah`, not
`Ptah Dev`, so `NODE_ENV` was not `development` there. The dev-serve window
booted the same day at 13:13Z on `ptah-dev.sqlite`, `finalVersion: 38`,
`applied: []` — healthy throughout.

## What the logs actually established

| When (UTC)        | Process                                                         | DB                | Result                                                        |
| ----------------- | --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| 8/17 12:46        | Packaged app, `%LOCALAPPDATA%\Programs\Ptah\resources\app.asar` | `ptah.sqlite`     | `applied: []`, `finalVersion: 30`                             |
| **8/17 17:14:03** | **unlogged**                                                    | **`ptah.sqlite`** | `ptah.pre-migration-20260817T171403Z.sqlite` (965 MB) written |
| 8/17 19:06        | Dev Electron (`Ptah Dev` profile)                               | `ptah-dev.sqlite` | `applied: []`, `finalVersion: 37`                             |
| 8/18 04:06–04:27  | `ptah-cli` from `dist/apps/ptah-cli/`                           | `ptah.sqlite`     | opened production                                             |

`SqliteMigrationRunner` only writes a `pre-migration-*` snapshot when
`pending.length > 0` (`migration-runner.ts:88`), so something with more than 30
migrations opened production at 17:14:03Z. Neither Electron profile log
contains a `migrations applied` line on 8/17 — the only ones on record are
7/11 `[28]` and 7/15 `[29,30]` (production, each seconds after its snapshot)
and 8/13–8/18 `[32..38]` (the dev file). So the migrator logged somewhere else,
i.e. it had its own `userData`.

That is the docs-screenshot harness. It launches through `launchPtah`
(`NODE_ENV=test`, throwaway `--user-data-dir`) against a **real workspace**,
and its default workspace is `D:\projects\property-hub` — the same project the
packaged app's agent was being asked to open at 17:11:19Z, two minutes before
the snapshot, with `PowerShell` and `Bash` tool calls in between. The throwaway
profile is deleted on exit, which is exactly why no log survived.

`--user-data-dir` was never enough: it moves Electron's userData, not
`os.homedir()`, and the DB path is resolved from the home directory.
`real-rpc-fixtures.ts:38-42` already said so in a comment and isolated `HOME`
for its own specs — the docs harness did not.

The 8/18 CLI entry proves the leak was still open: a working-tree build
(`workerEntry: D:\projects\ptah-extension\dist\apps\ptah-cli\embedder-worker.mjs`)
opening the production file.

## Root cause

```typescript
const isDev = opts?.isDev ?? process.env['NODE_ENV'] === 'development';
const dbFileName = isDev ? 'ptah-dev.sqlite' : 'ptah.sqlite';
```

One branch. Everything that was not the literal string `development` —
`test` (the e2e launcher AND Jest's default), unset, CI, `staging` — resolved
to production. Isolation was opt-in via one exact env value, while the
destructive default was silent.

## The fix

`libs/backend/persistence-sqlite/src/lib/db-path.ts`:

- Three profiles, each with its own file: `production` → `ptah.sqlite`,
  `development` → `ptah-dev.sqlite`, `test` → `ptah-test.sqlite`. `test` gets
  its own rather than sharing the dev file — an e2e run migrates and writes
  what it boots, and a developer's dev database is no more disposable than
  production.
- `PTAH_DB_PATH` absolute override, ahead of every profile including an
  explicit `opts.isDev`. Blank is ignored rather than resolved against cwd.
- **Unset `NODE_ENV` still means production.** Packaged Electron and the VS Code
  extension host both run with it unset; flipping that default would point
  every shipped install at an empty database. Non-production has to be asked
  for — the fix is that asking for `test` is now heard.

`apps/ptah-electron-e2e/src/support/electron-launcher.ts`: every launch gets a
`mkdtemp` database through `PTAH_DB_PATH`, dropping any inherited value, and
republishes it as `PTAH_E2E_DB_PATH` so `skill-telemetry-db.ts` reads the file
that launch just wrote instead of re-deriving a path.

`docs-fixtures.ts`: shoots against the isolated database by default.
`PTAH_DOCS_REAL_DB=1` opts back into production for whoever wants real data in
a screenshot and accepts that the capture migrates it.

## Verification

- `nx test @ptah-extension/persistence-sqlite` — 183 passed, 69 skipped (the
  skips are the native-binary suites: `better_sqlite3.node` is built for
  Electron's ABI, unrelated). New `db-path.spec.ts` covers all seven cases,
  including "unset stays production" and "blank override ignored".
- `nx run-many -t typecheck lint -p @ptah-extension/persistence-sqlite
ptah-electron-e2e` — 0 errors (12 pre-existing warnings, untouched files).

## Residual gap

A working-tree build launched by hand with no `NODE_ENV` still opens
production — that is the same rule that keeps packaged installs correct, so it
cannot be closed in `db-path.ts` alone. Closing it needs a build-identity
signal (packaged vs. `dist/`), not an env var. Not attempted here.
