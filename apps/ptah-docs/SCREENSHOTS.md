# Screenshots

PNG files live in `apps/ptah-docs/public/screenshots/` and are served at `/screenshots/<name>.png`.
Reference them from pages in `apps/ptah-docs/src/content/docs/`.

**Specs** (the capture harness, `apps/ptah-electron-e2e/src/docs-screenshots/_harness/shooter.ts`, follows these)

- Format: PNG (lossless), fall back to WebP if size matters
- Width: 1600px for full-window shots, 800px for panel crops (retina-ready)
- Theme: dark theme, matching the docs site's dark-first look

## Check references

```bash
nx run ptah-docs:check-screenshots   # every /screenshots/... reference resolves
```

It runs `apps/ptah-docs/scripts/check-screenshot-refs.mjs`, and `nx build ptah-docs` runs the same
script before `astro build`. The build alone does not catch a missing `/screenshots/...` file.

## Capture workflow

```bash
nx run ptah-docs:screenshots         # drives the real app, writes public/screenshots/
```

`screenshots` runs Playwright against the built Electron app
(`apps/ptah-electron-e2e/docs-screenshots.config.ts`, shot files in
`apps/ptah-electron-e2e/src/docs-screenshots/*.shot.ts`) and writes PNGs straight into
`public/screenshots/`. It is NOT part of `nx run ptah-electron-e2e:e2e`: a capture pass writes
files, so it only runs when asked. Screenshots not covered by a shot file are captured by hand.

How the run is set up (`apps/ptah-electron-e2e/src/docs-screenshots/_harness/`):

- **Real backend, no RPC mocks.** The e2e fixtures replace the whole `rpc` IPC listener, which
  paints an empty state on every surface. These fixtures only launch and navigate.
- **A copy of the real profile.** Session metadata lives in the Electron `userData` dir, so a fresh
  profile has no sessions and no settings. The harness copies the state-bearing part of `~/.ptah`
  (override with `PTAH_DOCS_SOURCE_PROFILE`) into a temp dir. It does not copy the secret
  envelopes, and it drops the cached license, so no key, name or email reaches an asset.
- **A real project for read-only surfaces** (`PTAH_DOCS_WORKSPACE`), **a throwaway sample repo for
  git surfaces.** The app rewrites `.codex/agents/*.toml` in any workspace it opens, and Source
  Control row actions stage files for real, so git shots never point at a developer's repository.

Adding a shot: put it in the matching `*.shot.ts`, call `shoot(page, '<filename-without-extension>')`,
and crop to the subject with `{ crop: locator }`. Re-run the target and look at the PNG before
committing it.

Do not reference a screenshot for a surface the app does not have. Remove the reference instead.
