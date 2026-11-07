# Product

## Register

brand

## Users

Professional software developers and engineering teams evaluating AI coding tools. They arrive at ptah.live from GitHub, search, community posts or word of mouth. They already use a coding assistant and need a concrete reason to try another one.

## Product Purpose

PtahCode is a free, MIT-licensed desktop app (Electron) that runs a team of AI agents on your own machine. It works with the vendors and coding CLIs you already use, keeps project memory locally, and lets you run several sessions side by side. The landing page's job: get a developer to download the app from GitHub releases. Source of truth for the page copy: `apps/ptah-landing-page/src/index.html` and `libs/web/landing/src/lib/sections/`.

## Design Principles

1. **Show the product, not a chat box.** Sections demonstrate real product surface (the clips in `apps/ptah-landing-page/public/assets/live-demo/`), not abstract illustration.
2. **Every claim maps to shipped code.** Copy that has no implementation behind it gets cut.
3. **Motion is meaning.** Animation shows how the product flows; decoration-only animation is cut.
4. **One accent.** Amber is the only accent family (see `DESIGN.md`).

## Accessibility

Text tokens are checked for contrast by the landing specs (`apps/ptah-landing-page/src/app/base-content-muted.spec.ts`). Sections that animate carry `prefers-reduced-motion` overrides in their CSS.
