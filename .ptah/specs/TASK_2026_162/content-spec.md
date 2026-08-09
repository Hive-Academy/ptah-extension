# TASK_2026_162 — Content Specification: Landing Page Repositioning to the Production-SaaS Wedge

**Author**: technical-content-writer · **Status**: ready for frontend-developer implementation
**Scope**: copy only. No component logic, gating, or Paddle/Circle integration changes (see Assumptions).

---

## 1. Positioning Recap + Voice/Tone Rules

**Recap (3 lines)**

1. Horizontal "AI employee" claims (memory, skills, subagents, cron, messaging) are now matched free by OSS competitors (Hermes Agent, OpenClaw) — cannot win on that axis alone.
2. The open gap: prototype-to-production for SaaS. Vibe-coded apps demo well and fail on multi-tenancy, billing correctness, security review, and architectural consistency past the first few features.
3. New line: Ptah is the AI dev team that builds production-shaped software from the first commit — for technical founders and small agencies who need to take real customers and real money, not just a demo.

**Voice/tone rules (developer audience, no hype)**

- Ban adjective-stacking: no "powerful," "seamless," "revolutionary," "cutting-edge," "game-changing," "effortless," "magical," "blazing fast." Replace any adjective with the mechanism (tree-sitter AST, RRF hybrid search, SQLite-backed cron, cross-vendor review) or the concrete outcome (architecture stays consistent past feature ten, diff reviewed by a different vendor than the one that wrote it).
- Every capability claim must trace to code already in this repo (file citations inline below). Do not invent benchmark numbers.
- Prefer second person / imperative and outcome-first headlines. Retain the "It \_\_\_." cadence established by the hero (Section 2) as the page recurring rhetorical device — reuse where natural, do not force it everywhere.
- Money/time claims stay literal: name the mechanism, not a vibe ("no server to babysit" not "runs seamlessly").
- The app is going fully open source (strategy doc, Business model section). CTA copy shifts from trial framing ("100 days free. No credit card.") to ownership framing ("Download free. Open source."). Every instance of "100-day(s) free trial" across the page and pricing page must be swapped — see Sections 2 and 5 for the full list of touched files, since this phrase appears in five places, not just the hero.

---

## 2. Hero Rewrite

**File**: `apps/ptah-landing-page/src/app/sections/hero/hero-content-overlay.component.ts`

Keep the decrypt/scramble + engraving-sweep animation mechanics exactly as implemented (decryptInPlace, engrave, SplitText/ScrambleTextPlugin) — this is a copy swap only. The animation is char-driven (SplitText on [data-plain]), so it works unchanged with new text; no timing constants need to change.

### Headline — APPROVED

**Decision (final)**: ship **Headline A**. This is no longer a candidate — it is the approved, shipping hero headline. Headline B has been reassigned: it now ships verbatim as the Comparison section H2 (see Section 3f, updated below) rather than competing for the hero slot. Headline C is not used anywhere; kept below only as a documented rejected alternative for the record.

**A — APPROVED, ship this**

- aria-label: `It Knows Your Architecture. It Ships the SaaS.`
- data-plain markup: `It Knows Your Architecture. <span data-glow>It Ships the SaaS.</span>`
- Why: keeps the exact three-word amber equity token ("It Ships") that is already load-bearing elsewhere on the site (OG title, Twitter title, page title in apps/ptah-landing-page/src/index.html lines 19 and 33, and landing-page.component.ts line 94 all read "Ptah — It Remembers. It Learns. It Ships."). Swaps "It Remembers. It Learns." (horizontal, feature-led, now-contested) for a single clause that states the production-consistency wedge directly, without adding a third beat that would over-lengthen the line at xl:text-7xl.

**B — Not used in hero; reassigned to Comparison section H2 (Section 3f)**

- `Vibe Coding Gets You a Demo. Ptah Ships the SaaS.`
- Ships verbatim as the Comparison section's H2 — see Section 3f below. Do not also use it in the hero; it appears exactly once on the page.

**C — Rejected, not used anywhere**

- `It Remembers Your Architecture. It Ships the SaaS.`
- Kept only as a documented alternative that was considered and passed over (weaker on the "vibe coding" contrast than A+B combined).

### Eyebrow (kicker)

- OLD: `Persistent · Multi-Agent · Always On`
- NEW: `Multi-Tenant · Billing-Ready · Security-Reviewed`

### Subheadline

- OLD: `Your AI employee on the desktop — persistent memory of your codebase, skills that compound with every task, and up to nine agents shipping in parallel while you are away. Bring any model.`
- NEW: `Ptah is the AI dev team for SaaS you will actually charge for — multi-tenant data isolation, billing integration, cross-vendor security review, and architecture that stays consistent past the first feature. Up to nine agents shipping in parallel. Bring any model.`

### CTA copy (drop trial language — app is going open source)

- Primary button label: unchanged, `Download Ptah`
- OLD helper text under primary button: `100 days free. No credit card.`
- NEW helper text: `Free. Open source. No credit card, ever.`
- Secondary CTA ("Watch it work"): unchanged — no trial language there.

### SEO/meta equity carrying "It Ships" (touch alongside hero — same equity token)

- apps/ptah-landing-page/src/index.html line 19 (og:title) and line 33 (twitter:title): change `Ptah — It Remembers. It Learns. It Ships.` to `Ptah — It Knows Your Architecture. It Ships the SaaS.`
- apps/ptah-landing-page/src/app/pages/landing-page.component.ts line 90 (title) and line 94 (ogTitle): same swap. description/ogDescription (lines 91-92, 95-96) currently read "A desktop AI coding agent that remembers your codebase, runs agents in parallel, and works on a schedule... Free trial." Replace with: `The AI dev team that ships production-shaped SaaS — multi-tenant, billing-integrated, security-reviewed, and architecturally consistent from the first commit. Free and open source.` (drop "Free trial." — see trial-language note above).

### Other trial-language instances to reconcile with the hero change

These are NOT the hero file but repeat the same "100 days free" claim the hero is dropping — flag for the frontend-developer to update in the same pass so the page does not contradict itself:

- apps/ptah-landing-page/src/app/sections/hero/hero-device-showcase.component.ts — stats array, entry `{ value: '100-day', label: 'free trial' }` (around line 75) → replace with `{ value: 'Free', label: 'and open source' }`.
- apps/ptah-landing-page/src/app/sections/cta/cta-section.component.ts — subheadline `100 days free. No credit card. Windows, macOS, and Linux.` (around line 51) → `Free. Open source. Windows, macOS, and Linux.` Also trustSignals array (around lines 109-112): `100-Day Free Trial`, `No Credit Card Required`, `Open Source (FSL-1.1-MIT)` → `Free, Forever`, `No Credit Card, Ever`, `Open Source (FSL-1.1-MIT)`.

---

## 3. Feature Sections — OLD to NEW Copy Table

### 3a. Problem Section (bridge/S2) — name the wedge explicitly

**File**: `apps/ptah-landing-page/src/app/sections/problem/problem-section.component.ts`

| Slot        | OLD                                                                                                                                                                                                                                                                                                                                                           | NEW                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow     | THE PROBLEM                                                                                                                                                                                                                                                                                                                                                   | THE GAP                                                                                                                                                                                                                                                                                                                                                                                                                          |
| H2          | Your AI Agent Is the New Hire Nobody Onboarded                                                                                                                                                                                                                                                                                                                | Vibe Coding Gets You a Demo. It Does Not Get You a Business.                                                                                                                                                                                                                                                                                                                                                                     |
| Body para 1 | An engineer who shows up on day one with no context ignores your architecture — not out of malice, but because nobody told them the rules. Most AI coding tools put your agent in exactly that position, every single session. They do not know your patterns. They do not remember yesterday decision. They start from zero, every time you open a new chat. | A prototype that impresses in a demo and a SaaS you can actually charge customers on are different products. Multi-tenant data isolation, billing webhooks that reconcile correctly, an auth model that survives a pen test, architecture that stays consistent past feature five — none of that shows up in a twenty-minute vibe-coding session, and most of it does not surface until a customer or an auditor finds it first. |
| Body para 2 | Ptah onboards its agents the way you would onboard an engineer: it studies the codebase before the first message, keeps what it learns, and gets better the longer it works with you.                                                                                                                                                                         | Ptah is built for the second product. It studies your codebase before the first message, keeps every architectural decision it makes, and staffs the parts of the job a solo prototype skips — security review, billing correctness, tenant isolation — the way a founder would staff a real team.                                                                                                                               |

No changes needed to the terminal device mock component or its props.

### 3b. Pillar 1 — Memory (S4): "knows your architecture, never re-learns it"

**File**: `apps/ptah-landing-page/src/app/sections/pillar-memory/pillar-memory.component.ts`

| Slot         | OLD                                                                                                                                                                         | NEW                                                                                                                                                                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow      | PILLAR 1 — REMEMBERS                                                                                                                                                        | PILLAR 1 — KNOWS YOUR ARCHITECTURE                                                                                                                                                                                                                                      |
| H2           | It Remembers Your Codebase. Every Session.                                                                                                                                  | It Knows Your Architecture. It Never Re-Learns It.                                                                                                                                                                                                                      |
| Sub          | Most agents start cold. Ptah indexes your project before the first message and keeps what it learns after the last one.                                                     | Vibe-coded prototypes forget every session — that is how duplicate services and missing auth checks pile up. Ptah indexes your project before the first message and keeps the decisions it makes after the last one, so feature ten stays as consistent as feature one. |
| Card 1 title | Persistent Memory                                                                                                                                                           | unchanged                                                                                                                                                                                                                                                               |
| Card 1 body  | Hybrid BM25 and vector search, fused with Reciprocal Rank Fusion, recalls decisions, bug fixes, and project context across every session — auto-curated, no manual tagging. | Hybrid BM25 and vector search, fused with Reciprocal Rank Fusion, recalls the architectural decisions, security fixes, and data-model conventions from session one — so the agent building feature five does not reinvent the auth pattern from feature one.            |
| Card 2 title | Tree-sitter Codebase Indexing                                                                                                                                               | unchanged                                                                                                                                                                                                                                                               |
| Card 2 body  | Structural AST parsing across JavaScript, TypeScript, Python, and Go indexes every function, class, and import with exact file positions — not regex guesses.               | Structural AST parsing across JavaScript, TypeScript, Python, and Go indexes every function, class, and import with exact file positions — the same map every agent works from, not a fresh guess per session.                                                          |
| Card 3 title | Hybrid Symbol Search                                                                                                                                                        | unchanged                                                                                                                                                                                                                                                               |
| Card 3 body  | Ask "where do we validate auth tokens" in plain English and get ranked, cited results injected straight into agent context.                                                 | unchanged — already outcome-first and on-wedge                                                                                                                                                                                                                          |
| Stat callout | Hybrid BM25 + vector memory search, fused with Reciprocal Rank Fusion.                                                                                                      | unchanged (factual)                                                                                                                                                                                                                                                     |
| Ghost link   | See how memory works                                                                                                                                                        | unchanged                                                                                                                                                                                                                                                               |

### 3c. Pillar 2 — Skills & Orchestration (S5): "delivery patterns that compound" + "a staffed team"

**File**: `apps/ptah-landing-page/src/app/sections/pillar-skills-orchestration/pillar-skills-orchestration.component.ts`

| Slot         | OLD                                                                                                                                                                             | NEW                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow      | PILLAR 2 — LEARNS AND SCALES                                                                                                                                                    | PILLAR 2 — A STAFFED TEAM, NOT A SOLO AGENT                                                                                                                                                                                                                         |
| H2           | It Gets Better Every Session. Then It Multiplies Itself.                                                                                                                        | Delivery Patterns That Compound. A Staffed Team That Ships Them.                                                                                                                                                                                                    |
| Sub          | Repeat a workflow and Ptah turns it into a reusable skill. Then it can run that skill nine times over, in parallel.                                                             | Ptah is not one generalist agent guessing at your stack — it is a staffed team: architect, backend developer, frontend developer, tester, and reviewer, each reusing the delivery pattern that worked last time instead of relearning it from scratch.              |
| Card 1 title | Auto-Learning Skills Curator                                                                                                                                                    | unchanged                                                                                                                                                                                                                                                           |
| Card 1 body  | When a workflow repeats successfully, Ptah extracts the trajectory, judges its quality, and promotes it to a permanent, shareable SKILL.md file — no manual authoring required. | When a delivery pattern succeeds — a tenant-isolation guard, a billing webhook, a migration — Ptah extracts the trajectory, judges its quality, and promotes it to a permanent, shareable SKILL.md file. The tenth SaaS you ship reuses what the first one learned. |
| Card 2 title | Sub-Agent Orchestration                                                                                                                                                         | unchanged                                                                                                                                                                                                                                                           |
| Card 2 body  | A main agent fans work out to parallel sub-agents across a three-tier hierarchy, each with its own provider, model, and context window.                                         | A main agent fans work out to specialist sub-agents — architect, backend developer, frontend developer, tester, reviewer — across a three-tier hierarchy, each with its own provider, model, and context window.                                                    |
| Card 3 title | Orchestra Canvas                                                                                                                                                                | unchanged                                                                                                                                                                                                                                                           |
| Card 3 body  | Run up to nine concurrent agent sessions in one drag-and-resize grid. Background agents keep working while you focus on a single tile.                                          | Run up to nine concurrent agent sessions in one drag-and-resize grid — architecture in one tile, billing integration in another, tests in a third. Background agents keep working while you review a single tile.                                                   |
| Card 4 title | Built-in Workflows & Skills Library                                                                                                                                             | unchanged                                                                                                                                                                                                                                                           |
| Card 4 body  | Ship with pre-built skills for common stacks and browse more from the skills registry — install with one click.                                                                 | Ship with pre-built delivery patterns for common SaaS stacks — multi-tenant setup, billing integration, auth guards — and browse more from the skills registry, install with one click.                                                                             |
| Stat callout | Up to 9 concurrent agent tiles in one gridstack view, each with an independent provider and model.                                                                              | Up to 9 concurrent agent tiles — architect, backend, frontend, tester, and reviewer among them — in one gridstack view, each with an independent provider and model.                                                                                                |

### 3d. Provider Strip (S7) — repurposed as the tribunal / cross-vendor-review carrier: "no model grades its own homework"

**File**: `apps/ptah-landing-page/src/app/sections/provider-strip/provider-strip.component.ts`

There is no existing dedicated tribunal section on the landing page. Rather than add a fifth card to the already-full 4-card Pillar 2 grid, or a new standalone section (adds page weight against the under-1mb budget), this spec repurposes Provider Strip — which already sells "bring any model, no lock-in" — since cross-vendor review is a direct extension of that same multi-provider capability, and it is a real, shipped capability (the tribunal skill: COUNCIL/FORGE/RACE/RELAY workflows for cross-vendor cross-critique).

| Slot       | OLD                                                                                                                                                 | NEW                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow    | ONE APP. YOUR CHOICE OF BRAIN.                                                                                                                      | CROSS-VENDOR REVIEW, NOT SELF-GRADED HOMEWORK                                                                                                                                                       |
| H2         | No Lock-In. Bring Any Model.                                                                                                                        | No Model Grades Its Own Homework.                                                                                                                                                                   |
| Sub        | Claude, GitHub Copilot, OpenAI Codex, 200+ OpenRouter models, local Ollama, Kimi K2, and GLM — switch providers mid-session without losing context. | Claude, GitHub Copilot, OpenAI Codex, 200+ OpenRouter models, local Ollama, Kimi K2, and GLM — mix vendors so the model reviewing a security-sensitive diff is not the model that wrote it.         |
| Chips      | Claude, GitHub Copilot, OpenAI Codex, OpenRouter (200+ models), Ollama (local), Kimi K2, GLM                                                        | unchanged                                                                                                                                                                                           |
| Trust line | Secure per-provider API key management. Real-time cost and token tracking per session.                                                              | Run a review panel: one vendor implements, a different vendor reviews the diff, a third judges the disagreement — before anything merges. Per-provider API keys, real-time cost and token tracking. |

### 3e. Pillar 3 — Always On (S6): "keeps shipping overnight; approve from Telegram"

**File**: `apps/ptah-landing-page/src/app/sections/pillar-always-on/pillar-always-on.component.ts`

| Slot         | OLD                                                                                                                                                                                          | NEW                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow      | PILLAR 3 — ALWAYS ON, REACHABLE ANYWHERE                                                                                                                                                     | PILLAR 3 — SHIPS OVERNIGHT, APPROVED FROM YOUR PHONE                                                                                                                                                                      |
| H2           | It Works While You Sleep. It Answers Where You Already Are.                                                                                                                                  | It Keeps Shipping Overnight. You Approve From Telegram.                                                                                                                                                                   |
| Sub          | Schedule agents like cron jobs. Approve their work from your phone.                                                                                                                          | Schedule the next migration, the nightly security scan, the dependency bump like a cron job. Wake up to a diff waiting for your approval — from Telegram, Discord, or Slack, not a laptop you have to keep open.          |
| Card 1 title | Cron Scheduler                                                                                                                                                                               | unchanged                                                                                                                                                                                                                 |
| Card 1 body  | SQLite-backed, slot-claimed scheduled runs. Nightly code reviews, Sunday dependency scans, daily standup summaries — no server to babysit.                                                   | SQLite-backed, slot-claimed scheduled runs. Nightly security reviews, Sunday dependency scans, the next ticket in the backlog — no server to babysit, no laptop that has to stay open.                                    |
| Card 2 title | Messaging Gateways                                                                                                                                                                           | unchanged                                                                                                                                                                                                                 |
| Card 2 body  | Trigger and approve agent work from Telegram, Discord, or Slack, including voice input. Discord supports per-thread multi-session conversations, so each thread keeps its own agent context. | unchanged — already on-wedge                                                                                                                                                                                              |
| Card 3 title | Approval Relay                                                                                                                                                                               | unchanged                                                                                                                                                                                                                 |
| Card 3 body  | Review and approve tool calls before they execute, from any connected gateway — nothing runs unattended that you have not authorized.                                                        | Review and approve every tool call and diff before it executes — including the ones that touch billing, auth, or tenant isolation — from any connected gateway. Nothing ships unattended that you have not signed off on. |
| Stat callout | Trigger and approve agent runs from Telegram, Discord, or Slack — including per-thread sessions on Discord.                                                                                  | Trigger and approve agent runs — including production-sensitive diffs — from Telegram, Discord, or Slack, including per-thread sessions on Discord.                                                                       |

### 3f. Comparison section (S8) — IN SCOPE (approved): re-axed to the four production-SaaS dimensions, H2 = Headline B verbatim

**File**: `apps/ptah-landing-page/src/app/sections/comparison/comparison-split-scroll.component.ts`

**Why**: this section currently comparison-sells on the contested horizontal axes (persistence, multi-agent, schedulability, reachability) vs. Cursor/Copilot by name — the exact framing the strategy doc says is now matched free by OSS tools, and naming specific editor competitors is off-brief for a wedge that is about production-readiness, not autocomplete. Re-axed below to the four production-SaaS dimensions (multi-tenant isolation, billing correctness, security review, architecture consistency), compared generically against "vibe-coding tools" (no specific competitor brand names, per instruction). This is also where **Headline B** ships — it did not become the hero headline (Section 2 ships Headline A), but its "demo vs. SaaS" contrast is the exact thesis of this section, so it becomes the H2 here.

The component's `AxisRow` interface (`axis: string`, `detail: string`) and the two-column layout (recessed left column, elevated right column with amber border) are unchanged — only the header strings, the `cursorRows`/`ptahRows` data arrays (rename to `vibeCodingRows`/`ptahRows` — see note below), the left-column header, and the closing paragraph change.

**Component rename note**: `cursorRows` should be renamed `vibeCodingRows` in the TS class (and its column-header string, below) since the axis is no longer "Cursor/Copilot-class tools" — flag this as a small identifier rename alongside the copy swap, not a structural change.

#### Section header

| Slot    | OLD (verbatim, grepped from source)                                                                                                                                                                                                                      | NEW                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow | `THE PTAH DIFFERENCE`                                                                                                                                                                                                                                    | `DEMO VS. PRODUCTION`                                                                                                                                                                                                                                                                                     |
| H2      | `Autocomplete Ends at the Cursor. Ptah Doesn't.`                                                                                                                                                                                                         | `Vibe Coding Gets You a Demo. Ptah Ships the SaaS.`                                                                                                                                                                                                                                                       |
| Sub     | `Cursor and Copilot are excellent at finishing your sentence. They don't remember yesterday's decision, they don't work while you're away from the keyboard, and they don't take a message from your phone. That's a different job — the one Ptah does.` | `Vibe-coding tools are excellent at turning a prompt into a working demo, fast. They don't isolate tenant data, they don't get billing edge cases right, nothing reviews the code before it ships, and nothing stays consistent past the first few features. That's a different job — the one Ptah does.` |

#### Left column (recessed) — header rename

| Slot          | OLD                            | NEW                 |
| ------------- | ------------------------------ | ------------------- |
| Column header | `Cursor / Copilot-Class Tools` | `Vibe-Coding Tools` |

#### Right column (elevated) — header unchanged

| Slot          | OLD            | NEW       |
| ------------- | -------------- | --------- |
| Column header | `Ptah Desktop` | unchanged |

#### Axis rows — re-axed from the four horizontal dimensions to the four production-SaaS dimensions

**OLD `cursorRows` (verbatim, grepped from source, for reference — being replaced, not kept)**:

1. axis: `Persistence` — detail: `No cross-session memory — each chat starts cold.`
2. axis: `Multi-agent` — detail: `One inline suggestion stream per editor tab.`
3. axis: `Schedulability` — detail: `Runs only while your editor is open and you're typing.`
4. axis: `Reachability` — detail: `Desktop editor only.`

**OLD `ptahRows` (verbatim, grepped from source — being replaced, not kept)**:

1. axis: `Persistence` — detail: `Hybrid BM25 + vector memory, auto-curated, recalled across every session.`
2. axis: `Multi-agent` — detail: `Up to 9 concurrent agents in one grid, each with independent provider, model, and context.`
3. axis: `Schedulability` — detail: `SQLite-backed cron scheduler runs agents unattended on any cron expression.`
4. axis: `Reachability` — detail: `Telegram, Discord, and Slack — approve or trigger work from your phone, including voice.`

**NEW `vibeCodingRows`** (left column, recessed):

1. axis: `Multi-Tenant Isolation` — detail: `Tenant data isolation is whatever the generated scaffold happened to include — often nothing, until someone finds the leak.`
2. axis: `Billing Correctness` — detail: `Billing gets wired once. Webhook retries, edge cases, and reconciliation are rarely touched again after the demo works.`
3. axis: `Security Review` — detail: `No review step before the code ships — the model that wrote it is the only one that ever looked at it.`
4. axis: `Architecture Consistency` — detail: `Consistency degrades fast. Feature ten doesn't look like feature one, because nothing remembers feature one.`

**NEW `ptahRows`** (right column, elevated):

1. axis: `Multi-Tenant Isolation` — detail: `Every tenant-isolation pattern that shipped before is recalled next session — an agent that already got it right doesn't re-guess it.`
2. axis: `Billing Correctness` — detail: `A staffed team — architect, backend, tester — builds and reviews the billing integration the way it would for a paying customer, not a demo.`
3. axis: `Security Review` — detail: `Cross-vendor review: a different model reviews the diff than the one that wrote it, before anything merges.`
4. axis: `Architecture Consistency` — detail: `The same architectural decisions recalled every session, from feature one through feature fifty — Ptah keeps what it learns instead of starting cold.`

#### Closing "honest framing, no FUD" paragraph

| Slot              | OLD (verbatim, grepped from source)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | NEW                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Closing paragraph | `Cursor and Copilot remain the better choice if all you want is inline completion inside an editor you already love — Ptah doesn't compete on autocomplete latency inside a text buffer, and it doesn't pretend to. Raw CLI agents remain the right call for a single scripted task in CI. Ptah is for the fourth axis nobody else covers: an agent that persists, works in parallel, runs unattended, and is reachable outside the IDE. That's a different job description — "employee," not "autocomplete."` | `Vibe-coding tools remain a fast way to get from an idea to a clickable demo — Ptah doesn't compete on demo speed, and doesn't pretend to. A raw CLI agent is still the right call for a single scripted task in CI. Ptah is for the moment after the demo lands: a codebase that has to isolate tenants, bill correctly, survive a review, and stay consistent past the tenth feature. That's a different job description — "production team," not "prototype generator."` |

---

## 4. New "Ptah Builders" Section — Full Copy

**Target file (new component)**: `apps/ptah-landing-page/src/app/sections/builders/builders-section.component.ts`
**Selector**: `ptah-builders-section` · **Section id**: `builders`
**Placement**: insert after Comparison (S8) and before Also Available (S9) in apps/ptah-landing-page/src/app/pages/landing-page.component.ts (confirm exact import/template wiring in that file — not directly readable in this pass, see Assumptions).
**Visual pattern**: reuse the existing hybrid layout already established by the pillar sections for consistency (no dedicated DESIGN-SYSTEM.md exists in this repo yet — see Assumptions): ConsoleGridBackgroundComponent background, centered font-mono amber eyebrow, text-3xl sm:text-4xl lg:text-5xl font-bold H2, text-lg sm:text-xl text-ink-400 subhead, rounded-xl border border-ink-700 bg-ink-850 cards, ViewportAnimationDirective entrances matching the pillar sections fadeIn/slideUp pattern.

### Copy

**Eyebrow**: `PTAH BUILDERS`

**H2**: `Ship Production SaaS Faster — With Builders Who Have Already Done It.`

**Subheadline**: `Ptah the app is free and open source. Ptah Builders is where you go deeper: live build sessions, a PRD-to-production curriculum, and the delivery patterns other builders have already turned into skills.`

**Value bullets (4)**:

1. Title: `Live Training Sessions` — Body: `Weekly live sessions where we ship a real feature end-to-end — multi-tenant auth, billing integration, a security-review pass — and take questions on your build.`
2. Title: `PRD-to-Production Curriculum` — Body: `A structured path from a one-page PRD to a production-shaped SaaS: architecture decisions, tenant isolation, billing integration, and the review gates a solo prototype skips.`
3. Title: `Member Skill Packs` — Body: `Delivery patterns other Builders have already extracted and shared as SKILL.md packs — install the multi-tenant guard or billing webhook someone else already got right.`
4. Title: `Priority Support` — Body: `Direct access for build questions and architecture reviews, ahead of the public queue.`

**Price anchor**: `Founding-member pricing: $29 to $49 per month — locked in for early members.`
(Placeholder framing — exact price TBD by pricing/business owner; do not hardcode a single number in the shipped copy until confirmed. Render as a range, not a specific figure, until finalized.)

**CTA**: `Join the Waitlist` linking to `href="#waitlist"` (placeholder anchor; no Circle or other community-provider integration in this task — see constraints)

**Microcopy under CTA**: `We will email you when Builders opens. No spam, no community platform yet — just the waitlist.`

---

## 5. Pricing Page Copy Reframe

**Files**:

- apps/ptah-landing-page/src/app/pages/pricing/pricing-page.component.ts (page-level SEO)
- apps/ptah-landing-page/src/app/pages/pricing/components/pricing-hero.component.ts
- apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts (plan data objects communityPlan, proMonthlyPlan, proYearlyPlan)
- apps/ptah-landing-page/src/app/pages/pricing/components/community-plan-card.component.ts
- apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts

**Framing shift**: the page currently sells a Community(free)/Pro($5-50) feature-gated split. Per strategy, the app becomes fully free and open source (gating removal is TASK_2026_163 — copy only here) and monetization moves to the Ptah Builders membership. Copy below assumes the eventual two-card layout is Ptah (free, open source) + Ptah Builders (membership), replacing Community/Pro. Until TASK_2026_163 lands, the frontend-developer should treat community-plan-card.component.ts as the carrier for the "Ptah (free)" copy and pro-plan-card.component.ts as the carrier for "Ptah Builders" copy — the Paddle checkout wiring inside pro-plan-card stays as-is structurally until 163 removes/replaces it; only the visible strings below change now.

### 5a. Page SEO (pricing-page.component.ts)

| Slot          | OLD                                                                                                                                                      | NEW                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title         | Ptah Pricing — Free Community Tier or Pro at $5/Month                                                                                                    | Ptah Pricing — Free, Open Source, Plus Ptah Builders Membership                                                                                                     |
| description   | Start free with the Community tier, or unlock the full desktop suite with Pro: $5/month or $50/year after a 100-day free trial. No credit card required. | Ptah is free and open source — download the full desktop suite today. Join Ptah Builders for live training, a PRD-to-production curriculum, and member skill packs. |
| ogTitle       | Ptah Pricing — Community (Free) or Pro ($5/mo)                                                                                                           | Ptah Pricing — Free and Open Source, Plus Ptah Builders                                                                                                             |
| ogDescription | Free forever on Community. Unlock Memory, Skills, Cron, and Gateways with Pro — $5/month or $50/year after a 100-day free trial.                         | The Ptah desktop app — Memory, Skills, Cron, and Gateways — is free and open source. Ptah Builders adds live training, curriculum, and member skill packs.          |

### 5b. Pricing hero (pricing-hero.component.ts)

| Slot    | OLD                                                                                                                                         | NEW                                                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eyebrow | PRICING & PLANS                                                                                                                             | unchanged                                                                                                                                                                       |
| H1      | Try 100 Days Free. / amber: Then $5 a Month.                                                                                                | Ptah Is Free. / amber: Open Source, No Catch.                                                                                                                                   |
| Sub     | Start free with the Community tier. Unlock the full desktop suite — Memory, Skills, Cron, and Gateways — with Pro. No credit card required. | The full desktop suite — Memory, Skills, Cron, and Gateways — is free and open source. Join Ptah Builders if you want live training, curriculum, and member skill packs on top. |

### 5c. Plan cards (pricing-grid.component.ts data + card components)

**Card 1 — "Ptah" (was Community)**

| Field                      | OLD                                                                                                                                                                                  | NEW                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| name                       | Community                                                                                                                                                                            | Ptah                                                                                                                                                                                                   |
| price / priceSubtext       | Free / forever                                                                                                                                                                       | Free / forever, open source                                                                                                                                                                            |
| idealFor                   | Perfect for getting started                                                                                                                                                          | The full desktop app — no catch                                                                                                                                                                        |
| standoutFeatures           | Beautiful visual interface, Use your Claude Pro/Max subscription, Native VS Code integration, Real-time streaming responses, Session history and management, Basic workspace context | Memory, Skills, Cron, and Gateway suite; Bring any of 7 model providers; Native VS Code integration; Real-time streaming responses; Session history and management; Tree-sitter workspace intelligence |
| ctaText                    | Install Free                                                                                                                                                                         | Download Free                                                                                                                                                                                          |
| Card badge (default state) | Free Forever                                                                                                                                                                         | unchanged — already on-message                                                                                                                                                                         |

**Card 2 — "Ptah Builders" (was Pro)**

| Field                          | OLD                                                                                                                                                                                                 | NEW                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| name                           | Pro                                                                                                                                                                                                 | Ptah Builders                                                                                                                                                       |
| price (monthly)                | $5 / per month                                                                                                                                                                                      | $29-49 / per month, founding-member pricing                                                                                                                         |
| price (yearly)                 | $50 / per year                                                                                                                                                                                      | drop the separate yearly SKU for now — membership pricing is not finalized; keep monthly only until business owner confirms an annual rate                          |
| idealFor                       | For serious developers                                                                                                                                                                              | Live training and curriculum for shipping SaaS                                                                                                                      |
| standoutFeatures / proFeatures | All Community features included, Intelligent Setup Wizard, Code Execution MCP Server, Workspace Intelligence (13+ project types), OpenRouter proxy (200+ models), Project-adaptive agent generation | Everything in Ptah (it is free); Weekly live build sessions; PRD-to-production curriculum; Member skill packs; Priority support; Founding-member pricing, locked in |
| Section header above features  | Everything in Community, plus:                                                                                                                                                                      | Everything free, plus:                                                                                                                                              |
| ctaText                        | Start 100-Day Free Trial                                                                                                                                                                            | Join the Waitlist                                                                                                                                                   |
| Badge (default "Most Popular") | Most Popular                                                                                                                                                                                        | Founding Member                                                                                                                                                     |

**Note on scope**: the Paddle checkout wiring (priceId, ctaAction: checkout, subscription-state badges like "Trial - X days left," "Subscription Paused," etc.) is business logic, not copy — leave as-is structurally per this task copy-only boundary. If ctaText becomes "Join the Waitlist" per above, ctaAction should logically become a waitlist link rather than a Paddle checkout call — flagging this as a likely code touch that belongs to TASK_2026_163, not this task.

---

## Assumptions / Gaps (read access notes)

- apps/ptah-landing-page/src/app/pages/landing-page.component.ts and the pricing-page/pricing-hero/pricing-grid/pro-plan-card files were not readable via the Read tool in this session (permission system declined mid-session); their exact SEO/copy strings above were recovered via targeted Grep reads instead, which is why some line-number references are approximate ranges rather than exact Read-tool line numbers. Frontend-developer should treat the quoted OLD strings as ground truth (grepped verbatim) but re-verify surrounding line numbers before editing.
- No .claude/skills/technical-content-writer/DESIGN-SYSTEM.md exists in this repo. The Builders section spec (Section 4) reuses the landing page own established visual tokens (ink-950/900/850/700 backgrounds, amber-500/400 accents, font-mono uppercase kickers, ConsoleGridBackgroundComponent, ViewportAnimationDirective fade/slide/scale patterns) as the de facto system — confirm with ui-ux-designer if a formal design system should be authored before/alongside implementation.
- The Builders section exact placement in landing-page.component.ts template (imports array, section ordering) could not be directly confirmed by reading that file this session; the recommended position (after Comparison/S8, before Also Available/S9) is inferred from each section component own docblock ordering comments (S1-S10) found across the sections directory.
- The comparison-section reframe (3f) was initially flagged as a recommended addition beyond the five required scope items; it has since been approved as in-scope and is now written as exact copy in Section 3f, including the `cursorRows` to `vibeCodingRows` identifier rename needed alongside the copy swap.
- The "65% of vibe-coded production apps have security issues" statistic from the strategy research (context.md, escape.tech) was deliberately NOT used as a quoted/cited number anywhere in this copy — it is an external claim this agent could not independently verify against a primary source. If the team wants to cite it (e.g., in the Problem section or a stat callout), get the exact source URL/methodology from whoever ran the BD research session first, per the "no invented benchmark numbers" rule in Section 1.
