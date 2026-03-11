# Reference Library - Curated Design Inspiration

## Purpose

A curated collection of design patterns, reference sites, and aesthetic archetypes to accelerate your design discovery process.

---

## Aesthetic Archetypes

### 1. Sacred Tech / Neo-Mystical

**Characteristics**:

- Dark backgrounds (black, deep gray)
- Gold/amber accents
- Ancient symbols + modern tech
- Particle effects, glowing elements
- Serif display fonts
- Mystical, premium feel

**Reference Sites**:

- BlueYard Capital - nano-scale + organic imagery
- Stripe.press - editorial + technical depth
- Augmentcode - glassmorphism + code aesthetic

**Color Palette**:

```css
--bg: #0a0a0a;
--accent: #d4af37;
--text: #f5f5dc;
--glow: rgba(212, 175, 55, 0.4);
```

**Typography**:

- Display: Cinzel, Playfair Display, Cormorant
- Body: Inter, DM Sans

**When to Use**:

- Developer tools with unique positioning
- Premium/luxury tech products
- Products with historical/cultural connection

---

### 2. Clean Enterprise

**Characteristics**:

- Light backgrounds (white, off-white)
- Indigo/blue accents
- Generous whitespace
- Soft shadows
- Sans-serif throughout
- Professional, trustworthy feel

**Reference Sites**:

- Stripe - gradient sophistication
- Linear - minimal precision
- Notion - friendly professional
- Vercel - developer-focused clean

**Color Palette**:

```css
--bg: #ffffff;
--bg-alt: #f9fafb;
--accent: #6366f1;
--text: #1f2937;
--text-muted: #6b7280;
```

**Typography**:

- Display: Inter Bold, SF Pro Display
- Body: Inter, System fonts

**When to Use**:

- B2B SaaS products
- Enterprise software
- Documentation-heavy products
- Products requiring trust/credibility

---

### 3. Gradient Modern

**Characteristics**:

- Dark backgrounds with color pops
- Multi-color gradients (purple → blue → teal)
- Glass morphism effects
- Animated backgrounds
- Futuristic, dynamic feel

**Reference Sites**:

- Raycast - purple gradients + glass
- Vercel - black + gradient accents
- Railway - colorful developer aesthetic
- Arc Browser - playful gradients

**Color Palette**:

```css
--bg: #0f0f0f;
--gradient: linear-gradient(135deg, #7c3aed, #3b82f6, #06b6d4);
--text: #ffffff;
--text-muted: #a1a1aa;
```

**Typography**:

- Display: Clash Display, Satoshi, Manrope
- Body: Inter, Plus Jakarta Sans

**When to Use**:

- Modern developer tools
- Creative applications
- Startups wanting to feel cutting-edge
- Products targeting younger developers

---

### 4. Terminal/Hacker

**Characteristics**:

- Pure black backgrounds
- Monospace typography
- Green/cyan accents (terminal colors)
- ASCII art, code blocks
- Minimal, focused, fast feel

**Reference Sites**:

- GitHub CLI documentation
- Warp terminal
- Fig (now part of AWS)
- Charm.sh

**Color Palette**:

```css
--bg: #000000;
--accent: #22c55e; /* or #06b6d4 */
--text: #e5e7eb;
--code-bg: #1a1a1a;
```

**Typography**:

- Display: JetBrains Mono Bold, SF Mono
- Body: JetBrains Mono, system monospace

**When to Use**:

- CLI tools
- Terminal applications
- Developer-first products
- Open source projects

---

### 5. Organic Tech

**Characteristics**:

- Warm, natural colors
- Soft, rounded shapes
- Nature imagery
- Gentle animations
- Approachable, calming feel

**Reference Sites**:

- Calm - wellness + tech
- Linear (light mode) - soft and precise
- Notion - warm and friendly
- Cron - minimal warmth

**Color Palette**:

```css
--bg: #fafaf9;
--accent: #22c55e;
--text: #292524;
--warm: #f5f5f4;
```

**Typography**:

- Display: DM Serif Display, Recoleta
- Body: DM Sans, Plus Jakarta Sans

**When to Use**:

- Health/wellness tech
- Sustainability products
- Consumer-friendly developer tools
- Products emphasizing simplicity

---

### 6. Neo-Brutalist

**Characteristics**:

- Bold, stark contrasts
- Heavy borders, shadows
- Raw, unpolished aesthetic
- Unconventional layouts
- Confident, honest feel

**Reference Sites**:

- Gumroad - raw functionality
- Poolsuite - retro brutalist
- Some Figma experiments

**Color Palette**:

```css
--bg: #fffef5;
--accent: #000000;
--highlight: #ffff00;
--border: 3px solid #000;
```

**Typography**:

- Display: Archivo Black, IBM Plex Mono Bold
- Body: System fonts, monospace

**When to Use**:

- Indie/bootstrapped products
- Products emphasizing transparency
- Anti-corporate positioning
- Creative tools

---

## Component Pattern Library

### Hero Sections

#### Centered Hero (Clean Enterprise)

```
┌─────────────────────────────────────────┐
│                                         │
│          [Label]                        │
│    Giant Headline Here                  │
│    Across Multiple Lines                │
│                                         │
│    Subheadline with more context        │
│    that explains the value prop         │
│                                         │
│    [Primary CTA]  [Secondary CTA]       │
│                                         │
└─────────────────────────────────────────┘
```

#### Split Hero (Product Demo)

```
┌─────────────────────────────────────────┐
│                         │               │
│    Headline             │   [Product    │
│    Text                 │    Image/     │
│                         │    Demo]      │
│    [CTA Buttons]        │               │
│                         │               │
└─────────────────────────────────────────┘
```

#### Immersive Hero (3D/Visual)

```
┌─────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  ░░░░░   [3D Background Scene]   ░░░░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│           Headline                      │
│           Subheadline                   │
│           [CTA]                         │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
└─────────────────────────────────────────┘
```

---

### Feature Sections

#### Card Grid

```
┌─────────────────────────────────────────┐
│          Section Headline               │
│          Section Description            │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ Icon    │  │ Icon    │  │ Icon    │ │
│  │ Title   │  │ Title   │  │ Title   │ │
│  │ Desc    │  │ Desc    │  │ Desc    │ │
│  └─────────┘  └─────────┘  └─────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

#### Alternating Sections

```
┌─────────────────────────────────────────┐
│  [Image/Demo]     │    Feature 1        │
│                   │    Description      │
├───────────────────┼─────────────────────┤
│    Feature 2      │    [Image/Demo]     │
│    Description    │                     │
├───────────────────┼─────────────────────┤
│  [Image/Demo]     │    Feature 3        │
│                   │    Description      │
└─────────────────────────────────────────┘
```

---

### Social Proof

#### Logo Cloud

```
┌─────────────────────────────────────────┐
│     Trusted by teams at                 │
│  [Logo] [Logo] [Logo] [Logo] [Logo]     │
└─────────────────────────────────────────┘
```

#### Testimonial Cards

```
┌─────────────────────────────────────────┐
│  ┌─────────────────────────────────┐    │
│  │  "Quote from customer..."       │    │
│  │                                 │    │
│  │  [Photo] Name, Title @ Company  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

#### Metrics Bar

```
┌─────────────────────────────────────────┐
│    10K+        99.9%        50ms        │
│   Users       Uptime      Response      │
└─────────────────────────────────────────┘
```

---

## Animation Patterns

### Scroll Reveals

| Pattern  | Entry                         | Exit    | Use Case             |
| -------- | ----------------------------- | ------- | -------------------- |
| Fade Up  | opacity 0→1, y: 20→0          | Reverse | Content sections     |
| Scale In | opacity 0→1, scale: 0.95→1    | Reverse | Cards, images        |
| Slide In | x: -100→0 or x: 100→0         | Reverse | Alternating sections |
| Stagger  | Children with 100-200ms delay | -       | Card grids           |

### Hover Effects

| Element | Effect                                  | Duration  |
| ------- | --------------------------------------- | --------- |
| Buttons | Scale 1.02-1.05, shadow increase        | 150-200ms |
| Cards   | Lift (translateY -4px), shadow increase | 200-300ms |
| Links   | Color change, underline animation       | 150ms     |
| Images  | Scale 1.05, slight brightness           | 300ms     |

### Continuous Animations

| Effect         | Use Case                 | Implementation               |
| -------------- | ------------------------ | ---------------------------- |
| Float          | 3D elements, decorations | translateY oscillation, 4-6s |
| Pulse          | CTAs, notifications      | scale oscillation, 2s        |
| Rotate         | Loading, 3D objects      | continuous rotation          |
| Particle drift | Backgrounds              | random movement              |

---

## Spacing Reference

### Section Spacing by Aesthetic

| Aesthetic        | Section Gap | Internal Padding |
| ---------------- | ----------- | ---------------- |
| Sacred Tech      | 128px+      | 96px             |
| Clean Enterprise | 80-128px    | 64-80px          |
| Gradient Modern  | 64-96px     | 48-64px          |
| Terminal         | 48-64px     | 32-48px          |
| Neo-Brutalist    | 32-48px     | 24-32px          |

### Card Spacing

| Type          | Gap  | Internal Padding |
| ------------- | ---- | ---------------- |
| Feature cards | 32px | 32px             |
| Compact cards | 24px | 24px             |
| List items    | 16px | 16px             |

---

## Resources

### Inspiration Sites

- [Awwwards](https://awwwards.com) - Award-winning designs
- [Dribbble](https://dribbble.com) - UI/UX exploration
- [Mobbin](https://mobbin.com) - Mobile patterns
- [Land-book](https://land-book.com) - Landing pages
- [SaaS Pages](https://saaspages.xyz) - SaaS landing patterns

### Color Tools

- [Coolors](https://coolors.co) - Palette generation
- [Realtime Colors](https://realtimecolors.com) - Live preview
- [Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Typography

- [Typewolf](https://typewolf.com) - Font pairings
- [Fontjoy](https://fontjoy.com) - AI font pairing
- [Google Fonts](https://fonts.google.com) - Free fonts

### 3D/Animation

- [Spline](https://spline.design) - 3D for web
- [Rive](https://rive.app) - Interactive animations
- [LottieFiles](https://lottiefiles.com) - Animated icons

---

## Quick Reference Cards

### Starting a Design System

```
1. Pick aesthetic archetype (above)
2. Extract 3 reference site URLs
3. Define: 3 bg colors, 2 text colors, 1 accent
4. Choose: display font + body font
5. Set: section padding (64/96/128px)
6. Define: card style (shadow/border/both)
```

### Design Review Checklist

```
□ Colors match chosen aesthetic
□ Typography hierarchy is clear
□ Spacing is consistent (8px grid)
□ Contrast meets WCAG AA (4.5:1)
□ Animations are subtle, purposeful
□ Mobile layout considered
□ Loading states defined
□ Error states designed
```
