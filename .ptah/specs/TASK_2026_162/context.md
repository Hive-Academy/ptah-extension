# TASK_2026_162 — Context

**Type**: CREATIVE · **Workflow**: Partial (content-writer → frontend-developer → visual-reviewer)
**Created**: 2026-07-18 · **cli_delegation**: auto (available: ptah-cli "ollama cloud", ptah-cli "claude cli"; max 3 concurrent)

## User Intent

From /orchestrate: "one or 2 tasks that elevate all areas we discussed." User approved pairing A+B via AskUserQuestion. This is Task A — landing-page repositioning.

## Strategic Background (from 2026-07-18 BD research session)

- Horizontal "AI employee" features (memory, skills, subagents, cron, messaging, provider-agnostic) are now matched free by Hermes Agent (Nous, 110k stars) and OpenClaw (375k stars). Feature-led horizontal positioning cannot win.
- Validated gap: prototype-to-production for SaaS. 65% of vibe-coded production apps have security issues (escape.tech); remediation = 2–4x build time; buyers pay $199–599 boilerplates, $500–3k audits, $5k–25k/mo rescue retainers. No product owns "PRD in → production-shaped SaaS out" for founders/small agencies.
- New positioning: "For technical founders and small agencies who need SaaS that can take real customers and real money, Ptah is the AI dev team that builds production-shaped software from the first commit."
- Audiences (ranked): 1) solo technical founders/indie hackers, 2) freelance devs + 2–10-person agencies, 3) fleet-running power engineers (secondary).
- Business model direction (user-approved in discussion): full open-source app, purge local premium gates (TASK_2026_163), monetize "Ptah Builders" membership (~$29–49/mo: live training, PRD-to-production curriculum, member skill packs, priority support) + Discord free community; hosted/team layer reserved for future paid.

## Current State

- Hero: "It Remembers. It Learns. It Ships." + "Your AI employee on the desktop" (hero-content-overlay.component.ts). Eyebrow: "Persistent · Multi-Agent · Always On". CTA: Download + "100 days free. No credit card."
- Landing page = Angular 21 marketing site + licensed-user portal (see apps/ptah-landing-page/CLAUDE.md). GSAP animations via @hive-academy/angular-gsap. OnPush + signals mandatory.

## Checkpoint 1 — APPROVED (user, 2026-07-18)

- content-spec.md approved. Hero uses **headline A** ("It Knows Your Architecture. It Ships the SaaS.").
- **Headline B** ("Vibe Coding Gets You a Demo. Ptah Ships the SaaS.") is used as the H2 of the re-axed Comparison section.
- Comparison section (S8) reframe is IN SCOPE: compare against vibe-coding tools on the four production-SaaS dimensions (multi-tenant isolation, billing correctness, security review, architecture consistency) instead of Cursor/Copilot horizontal axes.
- 65% security stat: not cited (no primary-source verification requested).

## Constraints

- Keep animation mechanics (decrypt headline, engraving sweep) — copy swap, not redesign.
- No Circle/community-provider integration here (future task). Builders section links can be placeholder/#waitlist.
- Bundle budget: initial < 1mb.
