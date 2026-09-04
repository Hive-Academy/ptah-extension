# Layout Patterns - Intelligent Layout Selection

## Purpose

Content-driven layout selection framework. Choose layouts based on content structure and user intent, not arbitrary preference.

---

## Layout Decision Framework

**CRITICAL: Layout choice must be driven by CONTENT TYPE, not arbitrary preference.**

Analyze the content and choose the appropriate layout pattern based on these principles:

---

### 1. Full-Width Individual Sections (SPOTLIGHT PATTERN)

**Use when content items are:**

- **UNIQUE** - Each item has distinct purpose, value proposition, or identity
- **HIGH-VALUE** - Items deserve individual spotlight and attention
- **CONTENT-RICH** - Each item has substantial content (500+ words, multiple features, unique visuals)
- **NARRATIVE-DRIVEN** - Items tell a sequential story or journey
- **DIFFERENTIATED** - Each item has unique layout needs or visual treatment

**Pattern Characteristics:**

- Full viewport width or max-width container per item
- Generous vertical whitespace between sections (128px+)
- Unique composition/layout per section
- Optional animated backgrounds or visual accents
- Scroll-triggered reveals per section

**Examples:**

```markdown
Product feature pages (each feature is unique and high-value)
Library/package showcases (each library has distinct capabilities)
Team member profiles (each person is unique)
Case study deep-dives (each case study tells different story)
Service offerings (each service has different value proposition)
```

**Anti-Examples:**

```markdown
Blog post listings (repeated structure, scannable)
Pricing tiers (need side-by-side comparison)
Testimonial quotes (repeated pattern, social proof)
Gallery images (visual grid pattern)
```

---

### 2. Card Grids (REPEATED PATTERN)

**Use when content items are:**

- **REPEATED** - Items share identical or near-identical structure
- **COMPARABLE** - Users need to scan/compare multiple items quickly
- **UNIFORM** - All items have same content hierarchy and length
- **SCANNABLE** - Users browse through many items (10+)
- **ACTION-ORIENTED** - Each card leads to a click/action

**Pattern Characteristics:**

- Grid layout (2, 3, or 4 columns on desktop)
- Consistent card dimensions and spacing
- Shared visual treatment (same shadows, borders, padding)
- Hover states for interactivity
- Gap spacing (24px-32px between cards)

**Examples:**

```markdown
Blog post listings (repeated: title, excerpt, date, author)
Use case examples (repeated: title, description, metrics, CTA)
Integration partners (repeated: logo, name, description, connect button)
Tutorial steps (repeated: step number, title, description, code snippet)
Pricing tiers (repeated: name, price, features, CTA button)
Team members (repeated: photo, name, role, bio)
Testimonials (repeated: quote, name, company, photo)
```

**Anti-Examples:**

```markdown
Main product features (each deserves spotlight, different content length)
Hero sections (unique, high-value, full-width needed)
Detailed comparisons (need table or side-by-side layout)
Long-form content sections (narrative flow, not scannable)
```

---

### 3. Hybrid Layouts (SPOTLIGHT + CARDS)

**Use when you have BOTH unique high-value items AND repeated elements:**

**Pattern:**

- Full-width sections for unique high-value content
- Card grids WITHIN sections for repeated sub-items

**Example Structure:**

```markdown
## Main Landing Page (Hybrid)

### Hero Section (FULL-WIDTH SPOTLIGHT)

- Unique hero content

### Library A Section (FULL-WIDTH SPOTLIGHT)

- Unique library showcase with detailed explanation
- **Nested card grid**: 4 code example cards (repeated pattern)

### Library B Section (FULL-WIDTH SPOTLIGHT)

- Unique library showcase with different layout
- **Nested card grid**: 3 usage pattern cards (repeated pattern)

### Use Cases Section (FULL-WIDTH CONTAINER)

- Section intro/headline
- **Card grid**: 4 use case cards (repeated pattern)

### Getting Started Section (FULL-WIDTH SPOTLIGHT)

- Unique section with installation instructions
- **Nested card grid**: 3 quick start step cards (repeated pattern)
```

---

### 4. Side-by-Side Comparison (COMPARISON PATTERN)

**Use when:**

- Users need to compare 2-4 items directly
- Items have parallel features/specifications
- Decision-making requires side-by-side evaluation

**Examples:**

```markdown
Pricing plan comparison (3 tiers side-by-side)
Product variant comparison (features table)
Before/after showcases (2 columns)
```

---

## Decision Tree: Choosing the Right Layout

**Step 1: Analyze Content Structure**

```
Q: Are the items UNIQUE with distinct purposes/value props?
-- YES -> Consider FULL-WIDTH INDIVIDUAL SECTIONS
-- NO -> Continue to Step 2

Q: Do items have IDENTICAL or near-identical structure?
-- YES -> Consider CARD GRIDS
-- NO -> Continue to Step 3

Q: Do users need to COMPARE items side-by-side?
-- YES -> Consider COMPARISON LAYOUT
-- NO -> Consider HYBRID LAYOUT
```

**Step 2: Analyze Content Volume**

```
Q: How much content per item?
-- 500+ words, multiple features, rich media -> FULL-WIDTH SECTIONS
-- 100-300 words, 3-5 bullet points -> CARD GRIDS
-- 50-100 words, single concept -> SMALL CARDS or LIST
```

**Step 3: Analyze User Intent**

```
Q: What is the user trying to do?
-- Learn deeply about each item -> FULL-WIDTH SECTIONS (narrative)
-- Browse and compare many items -> CARD GRIDS (scannable)
-- Compare 2-4 specific options -> COMPARISON LAYOUT
-- Quick reference/lookup -> LIST or COMPACT CARDS
```

---

## Layout Selection Examples (Task-Specific)

### Example 1: Library Showcase Landing Page

**Content Analysis:**

- 12 unique product modules/libraries
- Each module has UNIQUE capabilities, business value, use cases
- Each module is HIGH-VALUE (deserves spotlight)
- Content-rich (multiple features, code examples, metrics per module)
- User intent: Learn deeply about each module's value proposition

**Decision:**

```markdown
FULL-WIDTH INDIVIDUAL SECTIONS (12 sections, one per module)

- Section 1: Module A (unique layout, visual representation)
- Section 2: Module B (unique layout, different visual treatment)
- Section 3: Module C (unique layout, foundation theme)
- ... (each with 128px+ vertical spacing, unique animations)

CARD GRID for Use Cases (repeated pattern)

- 4 use case cards (title, description, modules used, CTA)

CARD GRID for Getting Started (repeated pattern)

- 3 step cards (step number, title, code snippet, description)
```

**Anti-Pattern:**

```markdown
WRONG: 2-column grid for Module A + Module B
WRONG: 3-column grid for Module C + Module D + Module E
(Reason: Each module is unique and high-value, deserves individual spotlight)
```

### Example 2: Blog/News Section

**Content Analysis:**

- 20+ blog posts
- REPEATED structure (title, excerpt, date, author, featured image)
- Scannable content (users browse many posts)
- User intent: Find interesting posts to read

**Decision:**

```markdown
CARD GRID (3-column desktop, 1-column mobile)

- Consistent card size and structure
- 24px gap between cards
- Hover effects for interactivity
```

### Example 3: Pricing Page

**Content Analysis:**

- 3 pricing tiers
- COMPARISON needed (features side-by-side)
- User intent: Choose the right plan

**Decision:**

```markdown
COMPARISON LAYOUT (3 columns side-by-side)

- Feature-by-feature comparison table
- Highlight recommended tier
```

---

## Visual Hierarchy & Whitespace Guidelines

**Full-Width Sections:**

- Vertical padding: 128px+ between sections
- Internal padding: 64px vertical within section
- Max-width: 1280px for readability
- Horizontal padding: 64px desktop, 32px mobile

**Card Grids:**

- Section padding: 80px vertical
- Card gap: 32px for 2-3 columns, 24px for 4 columns
- Card padding: 32px internal
- Card min-height: 400px for consistency

**Hybrid Sections:**

- Section padding: 80px vertical
- Intro content: 40px bottom margin
- Card grid: 32px gap

---

## Anti-Patterns to AVOID

**WRONG: Card Grids for Unique High-Value Content**

```markdown
WRONG: 2-column grid cramming unique items into cards
Example: Placing unique high-value modules in a card grid
REASON: Each unique, high-value item deserves individual spotlight, not cramped cards
```

**WRONG: Full-Width Sections for Repeated Elements**

```markdown
WRONG: Giving every blog post its own full-width section with 128px padding
Example: 20 blog posts each in their own full-width section
REASON: Blog posts are repeated structure, should use card grid for scannability
```

**WRONG: Inconsistent Card Sizes in Grids**

```markdown
WRONG: Cards with varying heights in the same grid row
Example: Short card (384px), tall card (600px), medium card (320px) side by side
REASON: Card grids should have consistent dimensions for visual harmony
```

---

## Layout Selection Checklist

Before choosing a layout, answer these questions:

**Content Analysis:**

- [ ] Are items UNIQUE or REPEATED in structure?
- [ ] How much content per item? (50 words / 200 words / 500+ words)
- [ ] Do items have different purposes/value propositions?
- [ ] Are items comparable or independent?

**User Intent:**

- [ ] What is the user trying to accomplish? (learn / browse / compare / reference)
- [ ] Do users need deep understanding or quick scanning?
- [ ] Is this a narrative journey or a reference catalog?

**Design System:**

- [ ] What whitespace does the design system mandate? (minimum spacing)
- [ ] What visual hierarchy patterns exist in the design system?
- [ ] Are there existing layout patterns to follow?

**Decision:**

- [ ] Layout choice matches content type (unique -> sections, repeated -> cards)
- [ ] Whitespace is generous and follows design system (128px+ for sections)
- [ ] Visual hierarchy guides user attention appropriately
- [ ] Responsive transformations are specified (mobile, tablet, desktop)

---

**REMEMBER:** Layout is a function of content structure and user intent, NOT arbitrary design preference. Always analyze FIRST, then choose the appropriate pattern.
