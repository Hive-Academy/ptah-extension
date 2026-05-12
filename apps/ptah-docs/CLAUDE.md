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
- `nx check ptah-docs` — `astro check` (type/link validation).

## Guidelines

- Sidebar order is curated in `astro.config.mjs`. When adding a doc, decide whether the section uses `autogenerate` (filename order) or explicit `items` (controlled order). Don't mix the two within one section.
- The `/docs` route on `ptah.live` redirects here — never serve docs from the landing page.
- Use the `editLink.baseUrl` GitHub URL when adding deep-link CTAs; it already points at the correct repo path.
