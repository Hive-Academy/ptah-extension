# TASK_2026_395 — migrations as a deploy step, not a start command

## Why

The container start command is:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && node main.cjs"]
```

This couples two unrelated jobs: applying schema migrations, and running the
server. The 2026-09-04 outage (TASK_2026_392) was the cost of that coupling. The
Prisma CLI could not parse its own command, so it exited 2, the `&&`
short-circuited, and the server never ran — for four days — even though the
schema was already fully migrated and the app would have started perfectly.

Splitting the two removes the coupling entirely. A CLI problem could then break
a migration step, which is honest, instead of preventing a boot, which is not.

## Second benefit

It removes the last hand-pinned package from the Dockerfile.

`prisma` cannot reach the Nx-generated manifest for two independent reasons: it
is a devDependency, and more fundamentally `generatePackageJson` only emits
packages the bundle **imports**. `main.cjs` never imports `prisma` — the CMD
invokes it as a binary. So no amount of dependency reclassification will
generate it, and the Dockerfile must name it by hand for as long as the app
image runs migrations. Take migrations out of the image and the CLI leaves with
them.

## Do not lose the fail-closed property

The `&&` is currently load-bearing and the replacement must keep what it
protects. Serving against a partially-applied schema means silent 500s and
possible bad writes. Whatever shape this takes, **the app must not start when
migrations did not apply.**

That is the hard constraint. It is easy to accidentally trade a four-day outage
for silent data corruption, which is worse.

## Options to weigh

1. **One-shot compose service.** Add a `migrate` service to
   `docker-compose.prod.yml` using the same image with an overridden command,
   and have `deploy-server.yml` run `docker compose run --rm migrate` before
   `up -d`. Keeps everything in one place. Still needs the CLI in the image, so
   it does not deliver the second benefit.
2. **Separate migration image.** A small image carrying only the Prisma CLI,
   the schema and the migrations. The app image drops the CLI entirely. More
   moving parts, but the cleanest separation and the only option that fully
   delivers benefit two.
3. **Migrate from the runner.** `deploy-server.yml` applies migrations over the
   database connection before deploying. Removes the CLI from every image, but
   requires the runner to reach the production database, which is a meaningful
   security change. Weigh carefully.

The implementer should pick one with a stated reason, not treat this list as a
menu of equals.

## Interaction with the deploy smoke check

`deploy-server.yml` now has a post-deploy smoke check that asserts
`status: ok` and `database: connected`. Whatever ordering this task lands on,
the smoke check must still run **after** everything, and a failed migration must
surface as a failed workflow rather than a skipped step.

## Acceptance criteria

1. The app container start command is `node main.cjs` alone, or the chosen
   alternative is justified in the implementation plan.
2. A failed migration blocks the deploy and fails the workflow. Proven with a
   deliberately broken migration on a scratch database, not argued.
3. The app never serves against a partially-applied schema.
4. If the chosen option removes the Prisma CLI from the app image, the
   Dockerfile's remaining hand-pinned install is deleted along with its comment.
5. `docker-compose.prod.yml`, the Dockerfile and `deploy-server.yml` stay
   consistent with each other, and the root `CLAUDE.md` release notes are
   updated if the deploy procedure changes.

## Prerequisite

Do this only after the TASK_2026_392 deploy has landed and the temporary
droplet override `/opt/ptah-extension/docker-compose.hotfix.yml` is gone. That
override currently skips migrations, so measuring migration behaviour while it
is in place would produce a misleading result.
