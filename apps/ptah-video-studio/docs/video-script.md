# Ptah Promo — "From Cold Clone to Scalable SaaS"

> Full script + storyboard. Build spec for the scenes. Successor to _Speed vs. Scale — Dyad vs. Ptah_.
> Language: remocn motion-design + high-fidelity glass 3D + real product surfaces. **One accent: amber
> `#f5a524`.** Emerald `#34d399` = active/success only. Ink `#08090c` base. Sentence case. No glow blobs.
> Primary render: landscape 1920×1080 @ 30fps. Vertical 1080×1920 as a follow-up cut.
> Narration: Kokoro (matches the proof), one calm technical VO. Target runtime **~55s**.

## Narrative thread (not a feature list)

A SaaS founder opens a cold repo and, instead of an amnesiac autocomplete, boots a project-aware
orchestra that scaffolds, builds, and reviews a production SaaS on an architecture that never has to
be retrofitted. Every beat advances that one story. Facts appear as _payoffs_, never as a catalog.

---

## Storyboard (8 beats, overlapping edges)

| #   | Beat                          | On-screen (components + 3D)                                                                                                                                                              | Transition in          | ~sec |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---- |
| 1   | **Hook — the problem**        | `shader-neuro-noise` field. `soft-blur-in` white line; problem sub-line in muted grey.                                                                                                   | —                      | 6    |
| 2   | **Positioning**               | Line resolves; `tracking-in` "Ptah" wordmark; amber accent sub-line.                                                                                                                     | `focus-pull`           | 5    |
| 3   | **Setup Wizard**              | `progress-steps` / `stepper` running the 7 steps; `number-wheel` → **15 specialist agents**; three CLI chips (Copilot/Codex/Cursor) peel off.                                            | `push-through`         | 9    |
| 4   | **Orchestration + agents**    | `claude-code`/`terminal-simulator`: conductor classifies → delegates to specialists + CLI agents; a review-gate line. Cut to the **glass Ptah core** (3D) with refractive nodes docking. | `push-through`         | 12   |
| 5   | **Nx / hexagonal foundation** | The **glass hexagon** hero holds; `progress-steps` roadmap items light in dependency order; `number-wheel` → **16 platform ports**; 3 adapter chips snap to the hex.                     | `focus-pull`           | 10   |
| 6   | **SaaS lifecycle**            | `glass-code-block` or a compact UI sim: license key + Paddle webhook (200 → verify → domain). Emerald "active" tick.                                                                     | `whip-pan`             | 6    |
| 7   | **Proof**                     | "Ptah runs on this." `rolling-number`/stat card: real NestJS + Prisma + Paddle license server. Calm.                                                                                     | `focus-pull`           | 5    |
| 8   | **CTA**                       | Calm dark hold. `Ptah` lockup; "Build scalable SaaS from day one."; `ptah.live` · "Get Ptah free" (amber).                                                                               | `blur-out-up` out of 7 | 4    |

Total ≈ 57s (beats overlap at edges → ~55s).

---

## Narration script (VO) + captions

**1 · Hook** — VO: _"Most AI coding tools start cold. Every new chat, they forget yesterday's decisions and finish the line you're typing — not the system you're building."_
Captions: `Most AI coding tools start cold.` → `They forget. They autocomplete.`

**2 · Positioning** — VO: _"Ptah is different. It boots a project-aware orchestra that already knows your stack."_
Captions: `Ptah boots a project-aware orchestra.`

**3 · Setup Wizard** — VO: _"It opens by scanning your codebase, then generates fifteen specialist agents from a real analysis of your project — and mirrors them to Copilot, Codex, and Cursor."_
Captions: `Scan → analyze → generate` · `15 specialists, from your real code` · `Mirrored to every CLI`

**4 · Orchestration** — VO: _"From then on, one conductor never writes code — it classifies the work, then delegates to specialist leads and up to three CLI agents in parallel. Nothing ships until an adversarial reviewer signs off."_
Captions: `A conductor that delegates` · `Specialists + CLI agents, in parallel` · `Reviewed before every commit`

**5 · Nx foundation** — VO: _"Underneath is a hexagonal core — sixteen ports, three adapters — so your monorepo's boundaries are enforced from day one, never retrofitted."_
Captions: `A hexagonal core` · `16 ports · 3 adapters` · `Boundaries enforced, day one`

**6 · SaaS lifecycle** — VO: _"Licensing, trials, and Paddle webhooks land alongside the domain that needs them — the whole SaaS lifecycle, scaffolded in order."_
Captions: `Licensing · webhooks · trials` · `Scaffolded in order`

**7 · Proof** — VO: _"This isn't a demo. Ptah itself ships on this exact spine — a real NestJS, Prisma, and Paddle SaaS in production."_
Captions: `Ptah runs on this.` · `NestJS · Prisma · Paddle — in production`

**8 · CTA** — VO: _"Build scalable SaaS from day one. Ptah — free to start."_
Captions: `Build scalable SaaS from day one.` · `ptah.live`

---

## On-screen facts (verified — see feature-knowledge-base.md)

7 wizard steps · **15** agent templates · 3 CLI mirrors · 8 task types · 3 workflow depths · **max 3**
concurrent CLI agents · **16** platform ports · 3 adapters · 3-layer webhooks. (Recount app/lib totals
before putting any on screen.)

## Build notes

- One `PromoReel`-style spec `promos/ptah-saas-story.json`; each beat a slide/scene; VO drives pacing
  via Kokoro (like dyad). Silent-preview first, then narrate.
- Reuse: `FilmGrade` (mask grain OFF the glass 3D), `StageEnvironment`/local-HDRI, `brandify` retired
  for game props but the abstract glass materials stay.
- Glass hero refinement (fold in during beat 4/5): higher transmission, lower roughness, more samples,
  crisper IOR — the one nit from the proof.
- Keep the anti-slop bar: one accent, sentence-case kinetic type, real product surface, restrained
  shader motion, no glow halos, no feature enumeration.
