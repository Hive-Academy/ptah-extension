# Design

Authoritative long-form system: `.claude/skills/technical-content-writer/DESIGN-SYSTEM.md` ("Egyptian Sacred Tech v2"). Live token source: `apps/ptah-landing-page/tailwind.config.js` (daisyUI `anubis` theme). This file is the quick reference.

## Theme

Dark, dramatic, premium. Obsidian page ground with a single gold accent family. Egyptian sacred-tech: hieroglyph-circuit patterns, scarab/ankh/Horus textures used as atmospheric depth layers, never as clipart foregrounds.

## Color Palette

- Backgrounds: Obsidian `#0a0a0a` (`base-100`, page), Charcoal `#1a1a1a` (`base-200`, cards), Smoke `#2a2a2a` (`base-300`, elevated), `slate-950` overlays for blue-black section warmth.
- Text: Cream `#f5f5dc` primary, `#d1d5db` body, `#9ca3af` list/muted, White for high-emphasis headings.
- Accent (only family): Gold `#d4af37` (`secondary`), Gold Light `#f4d47c` (`accent`), Gold Dark `#8a6d10`; glow alphas 0.2/0.35/0.5.
- Semantic: Lapis `#1e3a8a` (`primary`), Scarab Teal `#2dd4bf` (Thoth accents), Emerald success, Firebrick error, Amber warning.

## Typography

- Display: Cinzel (`font-display`) — hero/section headlines only.
- Body/UI: Inter (`font-sans`). Mono: JetBrains Mono (`font-mono`).
- Scale: hero `text-5xl→text-8xl`, section `text-4xl→text-6xl`, card `text-xl/2xl`, body `text-base→text-xl` lead.
- Headlines are power statements ending in periods. Gold gradient span permitted on one phrase per headline.

## Layout & Spacing

8px grid. Sections `py-24 sm:py-32`, container `max-w-7xl mx-auto px-6 sm:px-10 lg:px-16`, card grids `gap-6 lg:gap-8`, cards `p-8`. Radii: buttons `rounded-md`, cards `rounded-2xl`, section containers `rounded-3xl`, pills `rounded-full`. Adjacent sections must not repeat the same layout skeleton.

## Components

Section header (eyebrow → headline → subheadline), glassmorphism feature card (gold 0.2 border → 0.4 hover), step-number badge, rotating-beam hero CTA (`.cta-glow-button`), ghost arrow link, gradient divider, check-list item, pill badges. Icons: lucide-angular, stroke 1.5, gold on interactive.

## Motion

All motion via `@hive-academy/angular-gsap` (`viewportAnimation` one-shots, `scrollAnimation` scrubs, `agsp-scroll-timeline` / hijacked patterns for pinned sequences). Ease `power2.out`, durations 0.6–0.8s, grid stagger `0.1 + index*0.12` capped 0.5s. Parallax depth layers at speed 0.2–0.5, scrub 1–1.5. Reduced-motion handled globally by the library; custom keyframes need explicit reduce overrides.

## Assets

`apps/ptah-landing-page/public/assets/`: Egyptian textures (`textures/`: ankh-sphere, eye_of_horus, scarab, sun_disk_ra), backgrounds (`backgrounds/`: floating_obelisks, hieroglyph-circuit-pattern, pyramid_energy_apex, temple-bg), product screenshots (`images/showcase/`: panel-orchestration, panel-plugins, panel-providers, panel-setup-wizard, ptah-mcp-server, ptah-openrouter, ptah-setup-wizard, ptah-visual-interface).
