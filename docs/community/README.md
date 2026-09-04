# docs/community

`discourse-export.json` is **not documentation. Do not delete it.**

It is the one content source the community seed reads
(`EXPORT_PATH` in `apps/ptah-license-server/prisma/seed/community-seed.ts`),
and `community-seed.spec.ts` reads the same file at module load. Removing it
fails `nx test ptah-license-server` with `ENOENT` before a single test runs.

It lives here rather than beside the seed because the file is authored content
that non-engineers edit. Move it if that stops being true — and move
`EXPORT_PATH` with it.
