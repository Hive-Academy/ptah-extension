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
- `nx check ptah-docs` — **BROKEN, do not use. See `TASK_2026_249`.** The target
  exists and runs `astro check`, but `@astrojs/check` is not installed anywhere
  in this repo. Under CI it errors; in an interactive shell astro **prompts to
  install it and the command hangs with no output** — a 600-second run produced
  an empty log. Three agents parked on it in one session and returned with no
  report, which reads as agents quitting early rather than as a broken gate.
  **Never hand this to a subagent as an acceptance gate.** Use `nx build
ptah-docs` (~7s, 143 pages) and validate links by hand until 249 is resolved.

## Guidelines

- Sidebar order is curated in `astro.config.mjs`. When adding a doc, decide whether the section uses `autogenerate` (filename order) or explicit `items` (controlled order). Don't mix the two within one section.
- The `/docs` route on `ptah.live` redirects here — never serve docs from the landing page.
- Use the `editLink.baseUrl` GitHub URL when adding deep-link CTAs; it already points at the correct repo path.
