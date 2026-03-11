# Landing Page Content Patterns - Rich Visual Design System

## Purpose

Generate **design-integrated landing page content** that works with:

- 3D Three.js scenes and animations
- GSAP scroll-triggered reveals
- Glassmorphism UI components
- Premium typography hierarchy
- Egyptian/tech-sacred design aesthetic

This skill produces content **alongside design specifications**, not just text.

---

## Design System Reference

Before generating content, understand the visual language:

### Color Palette

| Token         | Value                  | Usage                     |
| ------------- | ---------------------- | ------------------------- |
| `--obsidian`  | `#0a0a0a`              | Primary background        |
| `--gold`      | `#d4af37`              | Accents, CTAs, highlights |
| `--gold-glow` | `rgba(212,175,55,0.4)` | Glow effects              |
| `--cream`     | `#f5f5dc`              | Secondary text            |
| `--charcoal`  | `#1a1a1a`              | Card backgrounds          |

### Typography Scale

| Level            | Size                  | Font           | Usage            |
| ---------------- | --------------------- | -------------- | ---------------- |
| Hero Headline    | `text-7xl`/`text-8xl` | Cinzel Display | Main hero        |
| Section Headline | `text-5xl`/`text-6xl` | Cinzel         | Section headers  |
| Feature Headline | `text-2xl`/`text-3xl` | Inter          | Card titles      |
| Body             | `text-lg`             | Inter          | Descriptions     |
| Caption          | `text-sm`             | Inter          | Labels, metadata |

### Animation Patterns

| Pattern         | Trigger           | Effect                    |
| --------------- | ----------------- | ------------------------- |
| `reveal-up`     | ScrollTrigger 85% | opacity 0→1, y: 60→0      |
| `scale-in`      | ScrollTrigger 85% | scale 0.95→1, opacity 0→1 |
| `stagger-cards` | ScrollTrigger     | 0.15s delay between items |
| `glow-pulse`    | Continuous        | 2s ease-in-out infinite   |
| `float`         | Continuous        | 6s ease-in-out infinite   |

---

## Investigation Protocol

Before writing landing page content:

```bash
# 1. Understand the product
Read(CLAUDE.md)
Read(libs/*/CLAUDE.md)

# 2. Find the story
Grep("<feature>", task-tracking/registry.md)
Read(task-tracking/TASK_XXXX/context.md)

# 3. Check design specs
Read(task-tracking/TASK_2025_072/visual-design-specification.md)
Read(task-tracking/TASK_2025_072/context.md)

# 4. Review design assets
Glob(task-tracking/TASK_2025_072/design-assets/*)
```

---

## Section Templates

### 1. Hero Section - "Commanding Presence"

**Design Reference**: BlueYard Capital + Egyptian sacred tech

```markdown
## Hero Section

### Visual Design

- **Layout**: Full viewport, centered content
- **3D Element**: [Specify: Ankh sphere / Pyramid / Scarab]
- **Background**: Radial gradient (gold glow center → obsidian edge)
- **Particles**: Gold dust emanating from 3D element

### Typography

- **Headline Style**: Cinzel Display, text-7xl md:text-8xl
- **Position**: Centered below 3D element
- **Effect**: Gold gradient text with subtle glow animation

### Content

**Headline**: "[Dramatic, thought-provoking statement]"

- Character limit: 40-60 chars
- Tone: Aspirational, confident, not salesy
- Pattern: [Benefit] + [Emotion] or [Question that provokes thought]

**Examples**:

- "Ancient Wisdom for Modern AI"
- "Where Code Meets Consciousness"
- "VS Code AI, Enlightened"

**Subheadline**: "[What it does + key differentiator]"

- Character limit: 80-120 chars
- Include: Product category + unique value
- Evidence: [Link to CLAUDE.md or feature]

**Primary CTA**:

- Text: "[Action verb] + [Immediate benefit]"
- Style: Golden gradient, 64px height, pulse animation
- Examples: "Install Free", "Begin the Journey", "Unlock Powers"

**Secondary Element**: Scroll indicator with "↓" or animated chevron

### Animation Timeline (GSAP)

| Time       | Element    | Effect                         |
| ---------- | ---------- | ------------------------------ |
| 0ms        | Background | Visible                        |
| 300ms      | 3D Element | Fade in, scale 0.8→1.0         |
| 600ms      | Particles  | Begin emanating                |
| 900ms      | Headline   | Fade up, blur-to-clear         |
| 1200ms     | CTA        | Bounce in gently               |
| Continuous | 3D Element | Mouse parallax + slow rotation |

### Code Evidence

- Feature claim: [libs/path/CLAUDE.md section]
- Metric claim: [task-tracking reference]
```

---

### 2. Demo Section - "Showcase Excellence"

**Design Reference**: Augmentcode code window chrome

```markdown
## Demo Section

### Visual Design

- **Container**: Glassmorphism panel (blur 20px, 60% opacity)
- **Window Chrome**: Gradient header bar with traffic light dots
- **Border**: Animated gold pulse on hover
- **Shadow**: Grows as section enters viewport

### Content

**Section Label** (optional): "SEE IT IN ACTION" (text-sm, tracking-widest)

**Demo Headline**: "[Action-oriented title]"

- Pattern: "Watch [Product] [Do Something Impressive]"
- Examples:
  - "Watch Ptah Understand Your Codebase"
  - "See AI Development, Reimagined"

**Demo Type**: [Choose one]

- [ ] Video embed (autoplay, muted, looping)
- [ ] Interactive code playground
- [ ] Animated GIF walkthrough
- [ ] Static screenshot with callouts

**Callout Points** (3-4 max):

1. [Feature being demonstrated]
2. [User benefit visible]
3. [Differentiator shown]

### Animation

- **Entry**: Scale 0.95→1.0 with fade-in
- **Scroll**: Parallax float effect
- **Interaction**: Border glow on hover

### Evidence

- Demo shows: [Actual feature from libs/*/CLAUDE.md]
- Recording source: [Path to video/gif asset]
```

---

### 3. Features Section - "Power Cards"

**Design Reference**: Augmentcode features + Glassmorphism cards

````markdown
## Features Section

### Visual Design

- **Layout**: Grid (1 col mobile, 2 col tablet, 3 col desktop)
- **Card Size**: Min-height 400px
- **Card Style**: Glassmorphism with gold border on hover
- **Gap**: 48px (gap-12)

### Section Header

**Eyebrow**: "[CATEGORY]" (text-sm, tracking-widest, gold)
**Headline**: "[Benefit-focused section title]"

- Pattern: "Everything You Need to [Achieve Goal]"
- Example: "Superpowers for Your Claude Agent"

### Feature Card Template

For each feature (3-6 cards recommended):

```yaml
feature:
  icon: '[Icon name from lucide/heroicons]'
  icon_style: '80px with gradient background circle'

  headline: '[Benefit, not feature name]'
  # Bad: "Multi-Session Support"
  # Good: "Work on Multiple Tasks Without Losing Context"

  description: |
    [2-3 sentences explaining:]
    - What it does (from CLAUDE.md)
    - Why it matters (user benefit)
    - How it's different (differentiator)

  capabilities: # Styled as pills/tags
    - '[Capability 1]'
    - '[Capability 2]'
    - '[Capability 3]'

  evidence:
    library: 'libs/[name]'
    task: 'TASK_XXXX'
    key_file: '[path to implementation]'

  code_example: | # Optional
    // Real code from codebase
    const result = await feature.doThing();
```
````

### Card Interactions

- **Hover**: translateY(-8px) + rotate(1deg)
- **Border**: Gold border fades in
- **Glow**: `box-shadow: 0 0 60px rgba(212,175,55,0.3)`

### Animation

- **Entry**: Stagger 0.15s delay between cards
- **Trigger**: ScrollTrigger at 85% viewport

````

---

### 4. Comparison Section - "Transformation Story"

**Design Reference**: Antigravity scroll reveal + Before/After cards

```markdown
## Comparison Section

### Visual Design
- **Layout**: Two cards side-by-side (stack on mobile)
- **Before Card**: Muted grayscale with subtle red accent
- **After Card**: Vibrant gold glow border
- **Connector**: Animated SVG arrow between cards

### Content Structure

**Section Headline**: "[Pain] → [Solution]"
- Example: "From Context Chaos to AI Clarity"

**Before Card (Pain Points)**:
```yaml
card_type: "before"
style: "muted, grayscale, shake animation on entry"
headline: "[The Problem State]"
icon_style: "X icons, red accent"
points:
  - icon: "x-circle"
    text: "[Specific pain point 1]"
  - icon: "x-circle"
    text: "[Specific pain point 2]"
  - icon: "x-circle"
    text: "[Specific pain point 3]"
````

**After Card (Benefits)**:

```yaml
card_type: 'after'
style: 'gold glow, scale-punch entry, particles'
headline: '[The Solution State]'
icon_style: 'Check icons, gold accent, animated draw-in'
points:
  - icon: 'check-circle'
    text: '[Specific benefit 1]'
    evidence: '[Code/task reference]'
  - icon: 'check-circle'
    text: '[Specific benefit 2]'
    evidence: '[Code/task reference]'
  - icon: 'check-circle'
    text: '[Specific benefit 3]'
    evidence: '[Code/task reference]'
```

### Transition Arrow

- **Type**: Animated SVG that draws on scroll
- **Effect**: Glow trail, color transition (muted → gold)

### Animation

- **Before Card**: Shake effect on scroll-in
- **After Card**: Scale 0.9→1.0 with punch
- **Arrow**: Draws as user scrolls past

````

---

### 5. Social Proof Section (Optional)

```markdown
## Social Proof Section

### Visual Design
- **Layout**: Centered, max-width container
- **Style**: Subtle, builds trust without bragging

### Content Options

**Option A: Metrics Bar**
```yaml
metrics:
  - value: "12"
    label: "Specialized Libraries"
    evidence: "CLAUDE.md workspace stats"
  - value: "48+"
    label: "UI Components"
    evidence: "CLAUDE.md workspace stats"
  - value: "5"
    label: "LLM Providers"
    evidence: "llm-abstraction CLAUDE.md"
````

**Option B: Logo Cloud** (if integrations)

```yaml
integrations:
  - name: 'Claude Agent SDK'
    logo: '[path]'
  - name: 'VS Code'
    logo: '[path]'
  - name: 'Langchain'
    logo: '[path]'
```

**Option C: Testimonial Quotes** (if available)

```yaml
testimonials:
  - quote: '[Authentic user quote]'
    author: '[Name]'
    role: '[Title at Company]'
    avatar: '[path]'
```

### Animation

- **Entry**: Fade up with stagger
- **Numbers**: Count-up animation

````

---

### 6. CTA Section - "Bold Conversion"

**Design Reference**: Augmentcode footer CTA

```markdown
## CTA Section

### Visual Design
- **Background**: Gradient overlay or pattern
- **Typography**: text-7xl headline
- **Button**: Large (64px height), golden gradient, pulse ring

### Content

**Headline**: "[Urgency + Benefit]"
- Pattern: "[Action] Your [Workflow/Experience] Today"
- Character limit: 30-50 chars
- Examples:
  - "Ready to Build Smarter?"
  - "Your AI Upgrade Awaits"
  - "Begin the Journey"

**Subheadline** (optional): "[Remove friction, add benefit]"
- Example: "Free to install. No configuration needed."

**Primary CTA Button**:
```yaml
text: "[Strong action verb]"
style:
  height: "64px"
  background: "golden gradient"
  effect: "pulse ring behind button"
  hover: "scale 1.08, intensified glow"
  click: "ripple effect"
````

**Secondary Link** (optional):

- Text: "Read the documentation →"
- Style: Text link, gold color, arrow animates on hover

### Animation

- **Headline**: Gold gradient text with glow
- **Button**: Continuous subtle pulse
- **Divider**: Animated golden line that draws in

````

---

### 7. Footer Section

```markdown
## Footer Section

### Content

**Brand**: Logo + tagline
**Links**: Documentation | GitHub | Marketplace | Community
**Social**: Twitter/X | Discord | GitHub
**Legal**: © 2025 | Privacy | Terms

### Visual Design
- **Style**: Minimal, dark background
- **Hover**: Subtle lift + color shift on icons
- **Divider**: Thin gold line above
````

---

## Output Format

When generating landing page content, deliver:

```markdown
# Landing Page Content Specification

## Investigation Summary

- Libraries reviewed: [list]
- Tasks analyzed: [list]
- Design spec reference: TASK_2025_072

## Design System Tokens Used

[List any custom tokens for this page]

## Sections

### 1. Hero

[Full hero specification following template]

### 2. Demo

[Full demo specification following template]

### 3. Features

[Full features specification with all cards]

### 4. Comparison

[Full comparison specification]

### 5. CTA

[Full CTA specification]

### 6. Footer

[Full footer specification]

## Animation Choreography

[Overall page animation flow]

## Technical Validation

- [ ] All claims backed by code evidence
- [ ] All metrics verifiable
- [ ] Design tokens match system
- [ ] Animations respect prefers-reduced-motion
- [ ] Mobile-responsive specifications included
```

---

## Anti-Patterns

**DON'T**:

- Generate text-only content without design context
- Use generic headlines that could apply to any product
- Ignore the visual hierarchy and animation system
- Write copy that fights the design instead of enhancing it
- Forget mobile-specific content considerations

**DO**:

- Generate content that works WITH the design system
- Provide specific animation triggers and effects
- Include code evidence for every claim
- Consider how text will look at each typography scale
- Specify interactions (hover, scroll, click states)

---

## Quick Start Checklist

Before generating:

- [ ] Read TASK_2025_072 visual design spec
- [ ] Review design assets in design-assets/
- [ ] Understand color palette and typography
- [ ] Know the animation patterns
- [ ] Have code evidence ready for claims

When generating:

- [ ] Use section templates above
- [ ] Include visual design specs with copy
- [ ] Specify animations for each element
- [ ] Provide yaml/structured content for components
- [ ] Map every claim to codebase evidence
