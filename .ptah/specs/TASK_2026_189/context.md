# Context — TASK_2026_189

## Status

**The one-line path fix is applied and verified.** It is in
`apps/ptah-license-server/prisma.config.ts` on branch
`ak/license-server-validation-pipe`. This carrier stays open for the parts that
were deliberately _not_ done — see [What is left](#what-is-left).

## What the code did

`apps/ptah-license-server/prisma.config.ts`, before:

```ts
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env['DATABASE_URL'] || '',
  },
});
```

`apps/ptah-license-server/.env` **does not exist**. The only dotenv file in that
directory is `.env.example`, and it is not a copy of a database config — it
carries the admin-dashboard and marketing subset (`ADMIN_EMAILS`,
`UNSUBSCRIBE_TOKEN_SECRET`, `RESEND_WEBHOOK_SECRET`,
`MARKETING_POSTAL_ADDRESS`, `MARKETING_UNSUBSCRIBE_BASE_URL`) and contains **no
`DATABASE_URL` at all**. So "copy `.env.example` to `.env`" — the obvious guess,
and the one that costs the next person twenty minutes — does not fix it either.

`DATABASE_URL` lives in the **repo-root** `.env`, and the root `.env.example`
documents it at line 25:

```
DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db"
```

`dotenv` does not throw on a missing file — it returns `{ error }` and moves on.
So `process.env['DATABASE_URL']` stayed undefined, `|| ''` swallowed it, and
Prisma reported:

```
◇ injected env (0) from .env
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database
Error: Connection url is empty. See https://pris.ly/d/config-url
```

Note that `◇ injected env (0)` line. Prisma 7's CLI ships its own dotenvx pass
over the cwd `.env`, which is also absent, so it too reports zero — and then the
config's own explicit load fails silently. Two independent env loaders both find
nothing and neither says so in a way that points at a path.

**The misleading part is the whole cost.** "Connection url is empty" reads as a
Postgres problem: is the container up, is the port right, is the password
rotated. The container was up and all 20 migrations were applied the entire
time. Multiple agents and one human each burned real time on this.

## Blast radius — who was affected and who was not

**Affected: every root `package.json` prisma script.** All five `cd` into the app
directory first, which is exactly the case the missing local `.env` breaks:

```
"prisma:generate":       "cd apps/ptah-license-server && npx prisma generate",
"prisma:migrate:dev":    "cd apps/ptah-license-server && npx prisma migrate dev",
"prisma:migrate:deploy": "cd apps/ptah-license-server && npx prisma migrate deploy",
"prisma:db:push":        "cd apps/ptah-license-server && npx prisma db push",
"prisma:studio":         "cd apps/ptah-license-server && npx prisma studio",
```

`prisma generate` is the exception that hides it: generation never connects, so
an empty `datasource.url` is harmless there and the command succeeds. Every
command that _connects_ — `migrate dev`, `migrate deploy`, `db push`, `studio`,
`migrate status` — failed. That asymmetry is part of why this survived: the
command in the setup instructions people run first is the one that works.

**Not affected: CI.** `.github/workflows/ci.yml:89` and
`nightly-coverage.yml:62` run `npx nx run ptah-license-server:prisma:generate`
via the `@nx-tools/nx-prisma:generate` executor — generate only, no connection.

**Not affected: Docker.** `apps/ptah-license-server/Dockerfile:109` copies
`prisma.config.ts` to `/app`, and `:143` runs
`CMD ["sh", "-c", "npx prisma migrate deploy && node main.cjs"]`. There is no
`.env` at `/app` either, but the image is run with `--env-file`, so
`DATABASE_URL` is already in `process.env` before the config is evaluated.
`dotenv` never overwrites an already-set key, so the missing file is irrelevant
there.

So this was **purely a local-developer defect** — which is why it was never
caught by anything, and why the fix has no production blast radius.

## The fix that was applied

Both paths are now loaded, local first:

```ts
config({ path: resolve(__dirname, '.env') });
config({ path: resolve(__dirname, '..', '..', '.env') });
```

Precedence, which falls out of `dotenv`'s default `override: false`:

```
real injected env (Docker --env-file, CI secrets)  >  app-local .env  >  repo-root .env
```

- A future `apps/ptah-license-server/.env` still wins over the root one, so
  per-app overrides keep working.
- A missing file is a silent no-op, so the container case is untouched — inside
  the image `__dirname` is `/app` and the fallback resolves to `/.env`, which
  does not exist and does not matter because the env is already injected.
- `datasource.url` keeps its `|| ''`. Making it throw on an unset
  `DATABASE_URL` was considered and **rejected**: CI's `prisma:generate` runs
  with no `DATABASE_URL` and currently passes on the empty string, so throwing
  would turn a local-dev fix into a CI break.

A long docblock explaining all of the above sits above the two lines, because
the next person to see two `config()` calls will otherwise delete one.

### Verification

Run from `apps/ptah-license-server` with **no** manually exported
`DATABASE_URL`:

```
$ npx prisma migrate status

◇ injected env (0) from .env
◇ injected env (41) from ..\..\.env
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

20 migrations found in prisma/migrations

Database schema is up to date!
```

`migrate status` is read-only and was the only Prisma command run. `migrate
dev`, `db push` and `migrate reset` were explicitly avoided.

## The workaround, recorded so nobody rediscovers it

If you are on a commit that predates the fix, or the config regresses: from the
repo root, pull the value out of the root `.env` and prefix the command.

```bash
DB="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')"
cd apps/ptah-license-server
DATABASE_URL="$DB" npx prisma migrate status
```

The `sed` strips the surrounding double quotes, which the root `.env` uses and
which `cut` leaves attached — a quoted URL produces a _different_, equally
confusing Prisma error about an invalid protocol.

## What is left

The path bug is closed. These are not, and are why the carrier is open:

1. **Nothing prevents the regression.** A `prisma.config.ts` that resolves an
   env file which does not exist is exactly the kind of thing a structural spec
   catches for free — assert that `datasource.url` is non-empty when a root
   `.env` is present, or simply that every path passed to `config()` in that file
   is one that exists in a fresh clone.
2. **The setup docs still do not mention it.** Root `CLAUDE.md` says
   `npm run prisma:migrate:dev` under Setup with no note about where
   `DATABASE_URL` comes from, and `apps/ptah-license-server/CLAUDE.md` lists
   `DATABASE_URL` under "Required Environment" without saying which file holds
   it. Both should name the repo-root `.env`.
3. **`apps/ptah-license-server/.env.example` is misleading by omission.** It
   looks like the app's env template and is not — it is a partial one covering
   two features. Either it documents that the database and third-party config
   live in the root `.env`, or it is renamed to something that does not invite
   the copy.
4. **Prisma 7's own dotenvx pass is unexplained.** The `◇ injected env (0) from
.env` line comes from the CLI, not from this config, and it will keep printing
   `(0)`. Worth one sentence somewhere so it is not read as a symptom.

## Notes

- `.ptah/**` is gitignored; this carrier is never committed. The
  `prisma.config.ts` change was committed on its own.
- There is no `prisma.config.ts` at the workspace root, so running `npx prisma`
  from the repo root does not pick up a config at all — it is a different and
  equally unhelpful failure. Always run Prisma from `apps/ptah-license-server`.
