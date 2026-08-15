# ptah-docs

[Back to Main](../../CLAUDE.md)

## Purpose

Astro Starlight documentation site published at `https://docs.ptah.live`. User guide for the Ptah Electron desktop app — getting started, chat, providers, agents, sessions, workspace, memory, skill synthesis, automation, git, plugins, templates, browser automation, MCP & skills, settings, troubleshooting, and reference.

## Entry Points

- `astro.config.mjs` — Starlight config. Site `https://docs.ptah.live`, GitHub edit link to `Hive-Academy/ptah-extension`, custom CSS from `./src/styles/brand.css`, manually curated sidebar across ~16 sections (mix of `autogenerate` and explicit `items`).
- `src/content.config.ts` — Astro content collections config.

## Structure

- `src/content/` — Markdown/MDX docs (one folder per sidebar section).
- `src/assets/`, `public/` — images, favicons.
- `src/styles/brand.css` — branding overrides on top of Starlight defaults.

## Build & Run

- `nx build ptah-docs` — `astro build --outDir ../../dist/apps/ptah-docs` (runs from `apps/ptah-docs`).
- `nx dev ptah-docs` / `nx serve ptah-docs` — `astro dev`.
- `nx preview ptah-docs` — `astro preview` against the build output.
  **There is no `check` target, deliberately** (TASK_2026_249). One ran `astro
check` without `@astrojs/check` ever being installed, so it hung on an install
  prompt with no output and cost three agents a session. It was deleted rather
  than fixed: this site is 140 `.md` + 2 `.mdx` + exactly one `.ts` file and zero
  `.astro` components, so `astro check` had one file to typecheck — and it never
  validated links, whatever the old line here claimed. `astro build` already
  fails on invalid content-collection frontmatter, which is the part that
  mattered.

**`nx build ptah-docs` is the gate.** If you want link validation, that needs
`starlight-links-validator` in `astro.config.mjs` — a real addition, not a
target that got lost.

## Guidelines

- Sidebar order is curated in `astro.config.mjs`. When adding a doc, decide whether the section uses `autogenerate` (filename order) or explicit `items` (controlled order). Don't mix the two within one section.
- The `/docs` route on `ptah.live` redirects here — never serve docs from the landing page.
- Use the `editLink.baseUrl` GitHub URL when adding deep-link CTAs; it already points at the correct repo path.
