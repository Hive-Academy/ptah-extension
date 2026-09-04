# Ptah Design System — Egyptian Sacred Tech v2

## Aesthetic Identity

**Name**: Egyptian Sacred Tech  
**Mood**: Dark, dramatic, premium — "ancient wisdom encoded in modern silicon"  
**Personality**: Powerful, mystical, technically precise, approachable  
**Brand metaphor**: Ptah the creator god — the craftsman who speaks things into existence; Thoth the scribe — the intelligence that remembers and learns  
**Position**: "AI coding orchestra" — not a chat assistant, an orchestration platform

The existing Anubis daisyUI theme is the authoritative token source. All specifications below map to its values.

---

## Color Tokens

All hex values are live in `apps/ptah-landing-page/tailwind.config.js` under the `anubis` theme.

### Background Hierarchy

| Token | Hex | daisyUI key | Usage |
|---|---|---|---|
| Obsidian | `#0a0a0a` | `base-100` | Page background, hero |
| Charcoal | `#1a1a1a` | `base-200` / `neutral` | Cards, panels, nav scrolled |
| Smoke | `#2a2a2a` | `base-300` / `neutral-focus` | Elevated surfaces, modals |
| Slate overlay | `rgba(15,23,42,*)` | — | Section backgrounds (current usage: `slate-950`) |

### Text Hierarchy

| Token | Hex | daisyUI key | Contrast on Obsidian | Usage |
|---|---|---|---|---|
| Cream | `#f5f5dc` | `base-content` | 15.2:1 AAA | Primary text |
| Sand | `#c4b998` | — | 8.4:1 AAA | Secondary text |
| Stone | `#8a8a8a` | — | 4.6:1 AA | Muted / captions |
| White | `#ffffff` | — | 21:1 AAA | High-emphasis headings |
| Gray-300 | `#d1d5db` | `neutral-content` | 11.8:1 AAA | Body in sections |
| Gray-400 | `#9ca3af` | — | 6.2:1 AA | List items |
| Gray-500 | `#6b7280` | — | 4.5:1 AA | Detail / meta |

### Gold Spectrum (Primary Accent)

| Token | Hex | daisyUI key | Usage |
|---|---|---|---|
| Gold | `#d4af37` | `secondary` | Borders, icons, primary accent |
| Gold Light | `#f4d47c` | `accent` / `fbbf24` | Gradient highlight, amber-300 equivalent |
| Gold Dark | `#8a6d10` | `secondary-focus` region | Gradient shadow end |
| Gold Glow SM | `rgba(212,175,55,0.2)` | — | Subtle glow on hover |
| Gold Glow MD | `rgba(212,175,55,0.35)` | — | Active glow |
| Gold Glow LG | `rgba(212,175,55,0.5)` | `shadow-glow-gold` | Hero elements |
| Gold Border | `rgba(212,175,55,0.2)` | — | Default card border |
| Gold Border Active | `rgba(212,175,55,0.4)` | — | Hover card border |

### Semantic Colors

| Token | Hex | daisyUI key | Usage |
|---|---|---|---|
| Lapis Blue | `#1e3a8a` | `primary` | Secondary accent, deep bg |
| Scarab Teal | `#2dd4bf` | — | Success, Thoth suite accents |
| Emerald | `#22c55e` | `success` | Benefit indicators |
| Firebrick | `#b22222` | `error` | Error, pain points |
| Amber | `#fbbf24` | `warning` | Warning, amber CTA variant |
| Info Blue | `#3b82f6` | `info` | Info states |

### Gradient Tokens

```css
--gradient-divine: linear-gradient(135deg, #1e3a8a, #d4af37);
--gradient-cta: linear-gradient(135deg, #d4af37, #fbbf24);
--gradient-text-gold: linear-gradient(135deg, #f4d47c 0%, #d4af37 50%, #8a6d10 100%);
--gradient-hero: linear-gradient(180deg, rgba(212,175,55,0.15), transparent 50%);
--glass-border: rgba(212, 175, 55, 0.2);
--glass-bg: rgba(42, 42, 42, 0.6);
```

---

## Typography

### Font Stack

```
Display / headlines: 'Cinzel', 'Playfair Display', serif  → font-display (Tailwind)
Body / UI:           'Inter', system-ui, sans-serif       → font-sans (default)
Code / mono:         'JetBrains Mono', 'Fira Code', mono  → font-mono (Tailwind)
```

### Type Scale (Tailwind classes)

| Role | Mobile | Tablet (md:) | Desktop (lg:) | Weight | Line-height |
|---|---|---|---|---|---|
| Display hero | `text-5xl` | `text-7xl` | `text-8xl` | `font-bold` | `leading-none` |
| Section headline | `text-4xl` | `text-5xl` | `text-6xl` | `font-bold` | `leading-tight` |
| Sub-section headline | `text-3xl` | `text-4xl` | `text-5xl` | `font-bold` | `leading-tight` |
| Card title | `text-xl` | `text-2xl` | — | `font-bold` | `leading-snug` |
| Feature title | `text-lg` | `text-xl` | — | `font-semibold` | `leading-snug` |
| Body lead | `text-base` | `text-lg` | `text-xl` | `font-normal` | `leading-relaxed` |
| Body | `text-sm` | `text-base` | — | `font-normal` | `leading-relaxed` |
| Label / eyebrow | `text-xs` | — | — | `font-semibold` | — |
| Badge text | `text-xs` | `text-sm` | — | `font-semibold` | — |

**Eyebrow labels** always: `text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70`  
**Gold gradient text**: apply `.gradient-text-gold` (already in `styles.css`)  
**Display font**: use `font-display` class only for hero/section headlines that need the Cinzel serif. Body-level text stays in Inter.

---

## Spacing System (8px grid)

| Token | Value | Tailwind | Usage |
|---|---|---|---|
| Section vertical padding | 96–128px | `py-24 sm:py-32` | Standard for all sections |
| Section internal content gap | 64px | `mb-16 sm:mb-20` | Header-to-grid gap |
| Card gap | 24–32px | `gap-6 lg:gap-8` | Grid card spacing |
| Card internal padding | 32px | `p-8` | Inside feature cards |
| Element gap | 24px | `gap-6` | Between inline elements |
| Text stack gap | 16–24px | `mb-4` / `mb-6` | Between heading + body |
| Container max-width | 1280px | `max-w-7xl mx-auto px-6 sm:px-10 lg:px-16` | All sections |

---

## Effects System

### Glassmorphism

```css
.glassmorphism {
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: rgba(42, 42, 42, 0.6);
  border: 1px solid rgba(212, 175, 55, 0.2);
}
```
Use on: cards over image backgrounds, nav on scroll, modals.

### Shadows / Glows

| Token | Value | Tailwind |
|---|---|---|
| Gold glow | `0 0 60px rgba(212,175,55,0.4)` | `shadow-glow-gold` |
| Gold glow large | `0 0 100px rgba(212,175,55,0.5)` | `shadow-glow-gold-lg` |
| Gold glow pulse | keyframe in `tailwind.config.js` | `animate-glow-pulse` |

### Border Radius

| Token | Value | Tailwind | Usage |
|---|---|---|---|
| Button | 6px | `rounded-md` | Buttons |
| Card small | 12px | `rounded-xl` | Badges, small cards |
| Card standard | 16px | `rounded-2xl` | Feature cards |
| Card large | 24px | `rounded-3xl` | Section containers |
| Pill | full | `rounded-full` | Badges, tags |

---

## Motion Language

### Animation Principles

1. Entrance animations use `@hive-academy/angular-gsap` directives only — no raw GSAP in templates.
2. Scroll-scrub (`scrubbed`) animations use `ScrollAnimationDirective` with `scrollAnimation`.
3. Viewport-triggered one-shot reveals use `ViewportAnimationDirective` with `viewportAnimation`.
4. Stagger delays: 100–150ms between sibling elements in a grid.
5. All animations must respect `prefers-reduced-motion` (angular-gsap handles this).

### Standard Viewport Configs

```typescript
const fadeIn: ViewportAnimationConfig = { animation: 'fadeIn', duration: 0.7, threshold: 0.15 };
const slideUp: ViewportAnimationConfig = { animation: 'slideUp', duration: 0.8, ease: 'power2.out', threshold: 0.15 };
const scaleIn: ViewportAnimationConfig = { animation: 'scaleIn', duration: 0.6, threshold: 0.2 };
const slideRight: ViewportAnimationConfig = { animation: 'slideRight', duration: 0.6, threshold: 0.2 };
const slideLeft: ViewportAnimationConfig = { animation: 'slideLeft', duration: 0.6, threshold: 0.2 };
```

### Standard Scroll Configs

```typescript
const parallaxSlow: ScrollAnimationConfig = { animation: 'parallax', speed: 0.3, scrub: 1.5 };
const contentExit: ScrollAnimationConfig = {
  animation: 'custom', start: 'top top', end: 'bottom 50%',
  scrub: 1.2, from: { opacity: 1, y: 0 }, to: { opacity: 0, y: -120 }
};
```

### Stagger Delay Formula

For `n` children in a card grid: `delay: 0.1 + (index * 0.12)` — capped at 0.5s total offset.

### CSS Animations (tailwind.config.js keyframes)

- `animate-glow-pulse` — box-shadow pulse on hero CTAs
- `animate-pulse-ring` — expanding ring for primary CTAs
- `animate-divider-draw` — section divider line reveal

---

## Component Patterns

### Section Header (standard)

```
eyebrow label    →  text-sm font-semibold uppercase tracking-widest text-[#f4d47c]/70 mb-4
h2               →  text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6
                    optional gradient span: bg-gradient-to-r from-[#d4af37] via-[#f4d47c] to-[#8a6d10] bg-clip-text text-transparent
subheadline      →  text-lg sm:text-xl text-gray-400 max-w-3xl mx-auto leading-relaxed
```

### Feature Card (glassmorphism)

```
container:   rounded-2xl border border-[#d4af37]/20 bg-slate-900/60 backdrop-blur-sm p-8
             hover: border-[#d4af37]/40 transition-all duration-300
hover glow:  absolute inset-0 rounded-2xl bg-gradient-to-b from-[#d4af37]/5 to-transparent opacity-0 group-hover:opacity-100
icon well:   w-12 h-12 rounded-xl bg-[#d4af37]/10 border border-[#d4af37]/20
```

### Step Number Badge

```
w-14 h-14 rounded-full bg-gradient-to-br from-[#d4af37] to-[#8a6d10] text-[#0a0a0a] font-bold text-xl shadow-lg shadow-[#d4af37]/20
```

### Primary CTA Button (rotating beam variant)

See `hero-content-overlay.component.ts` `.cta-glow-button` — this is the canonical hero CTA style.  
Secondary usage: `bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 px-6 py-2.5 rounded-lg font-semibold`.

### Ghost Link Arrow

```
inline-flex items-center gap-3 text-[#f4d47c] hover:text-[#d4af37] font-medium text-sm transition-colors
icon circle: w-9 h-9 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20
```

### Gradient Divider

```
h-[2px] w-full bg-gradient-to-r from-transparent via-secondary to-transparent
```

### Check List Item

```
flex items-start gap-3
lucide Check: w-5 h-5 text-[#d4af37] mt-0.5 shrink-0
span: text-base text-gray-400
```

### Eyebrow Badge (pill)

```
inline-flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-full
dot: w-2 h-2 bg-amber-400 rounded-full animate-pulse
text: text-sm font-medium text-amber-300/90 tracking-wide
```

### Runtime / Capability Badge

```
inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#d4af37]/10 border border-[#d4af37]/20 text-xs font-medium text-[#f4d47c]
```

---

## Iconography (lucide-angular)

- Default stroke-width: 1.5 (lucide default)
- Standard sizes: `w-4 h-4` (inline), `w-5 h-5` (list icons), `w-6 h-6` (card icons), `w-8 h-8` (section icons)
- Color on interactive: `text-[#d4af37]`
- Color on muted: `text-gray-400`
- Always `aria-hidden="true"` when decorative

**Canonical icon assignments for unmarketed capabilities:**

| Capability | Lucide icon |
|---|---|
| Memory / Thoth | `Brain` |
| Skill synthesis | `Sparkles` |
| Cron scheduler | `Clock` |
| Messaging gateway | `MessageSquare` |
| Canvas multi-tile | `LayoutGrid` |
| Workspace intelligence | `Search` |
| CLI / headless | `Terminal` |
| Multi-provider | `Shuffle` |
| Session rewind/fork | `GitBranch` |
| MCP tools | `Wrench` |
| Background agents | `Bot` |
| Monaco editor | `Code` |
| VS Code runtime | `Package` |
| Electron runtime | `Monitor` |

---

## Accessibility

### Minimum Contrast (WCAG 2.1 AA)

All verified against `#0a0a0a` (Obsidian) background:

| Combination | Ratio | Standard |
|---|---|---|
| Cream `#f5f5dc` | 15.2:1 | AAA |
| White `#ffffff` | 21:1 | AAA |
| Gold `#d4af37` | 7.8:1 | AAA |
| Gold Light `#f4d47c` | 11.6:1 | AAA |
| Gray-300 `#d1d5db` | 11.8:1 | AAA |
| Gray-400 `#9ca3af` | 6.2:1 | AA |
| Gray-500 `#6b7280` | 4.5:1 | AA (large text) |
| Amber-300 `#fcd34d` | 11.1:1 | AAA |

### Focus States

All interactive elements: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 focus-visible:outline-offset-2`

### Motion

`@hive-academy/angular-gsap` applies `prefers-reduced-motion` globally. No additional CSS needed, but custom keyframe animations must include:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-glow-pulse, .animate-pulse-ring { animation: none; }
}
```

### Semantic HTML

- Every major section uses `<section>` with `id` and `aria-label`
- Decorative backgrounds: `aria-hidden="true"`
- Icon-only buttons and links: explicit `aria-label`

---

## Do / Don't

**Do:**
- Use `slate-950` for section backgrounds that need slight blue-black warmth (existing pattern)
- Use `base-100` (`#0a0a0a`) as the pure page background
- Wrap all heavy sections in `@defer (on viewport)` for bundle budget
- Export scroll configs as `public readonly` signals in the component class
- Use `ChangeDetectionStrategy.OnPush` on every component
- Stack eyebrow → headline → subheadline → CTA in every section header
- Keep feature cards at 3-column desktop / 2-column tablet / 1-column mobile
- Use `max-w-7xl mx-auto` as the universal content container

**Don't:**
- Use `[innerHTML]` — route all AI/markdown content through `libs/frontend/markdown`
- Add explanatory comments to code (repo rule)
- Use raw hex values in Tailwind classes when a semantic token exists — prefer `text-secondary`, `bg-base-200`
- Hardcode `#d4af37` inline more than necessary — use `text-secondary` or the global CSS var `var(--gold)` for new rules
- Use `@angular/animations` — all motion goes through `@hive-academy/angular-gsap`
- Create new custom CSS animations when an existing keyframe covers the need
- Import backend libs in frontend components

---

## Integration Notes for Content Writer

When writing copy for the landing page, use these brand voice anchors:

- **Ptah** = the harness, the orchestrator, the platform (never "a chatbot" or "an assistant")
- **Thoth** = the intelligent memory/learning subsystem (Electron-exclusive premium feature)
- **Canvas** = the multi-tile orchestra workspace
- **Harness** = the project-aware configuration layer
- **Provider** = any LLM backend (never "model provider" — just "provider")
- **Agent** = a session with a goal; **Orchestra** = multiple agents in parallel
- **Trial** = 100-day free trial, no credit card, all features unlocked

Headlines follow the pattern: **[Power statement].** not questions. Not "Are you ready to..."
