# Developer Handoff - Design Specifications & Workflow

## Purpose

Complete workflow for creating production-ready design specifications, developer handoff documents, and professional deliverables. This is the end-to-end process from investigation to delivery.

---

## Design Specification Template

### Visual Design Specification Document Structure

```markdown
# Visual Design Specification - TASK\_[ID]

## Design Investigation Summary

### Design System Analysis

- **Design System**: [Path to design system documentation]
- **Key Tokens Extracted**: [Count] tokens (colors, typography, spacing, shadows)
- **Accessibility Compliance**: WCAG 2.1 AA validated
- **Responsive Breakpoints**: Mobile (< 768px), Tablet (768-1024px), Desktop (1024px+)

### Requirements Analysis

- **User Requirements**: [Extracted from task-description.md]
- **Business Requirements**: [Extracted from library-analysis.md]
- **Technical Constraints**: [Extracted from implementation-plan.md]

### Design Inspiration

- **Design Tool Searches**: [List of search queries performed]
- **Reference Designs**: [Links to reference designs reviewed]
- **Design Patterns**: [Identified patterns matching requirements]

---

## Visual Design Architecture

### Design Philosophy

**Chosen Visual Language**: [Light/Dark/Modern/Minimal/etc.]
**Rationale**: [Why this approach fits requirements AND design system]
**Evidence**: [Citations to design system, user research, or requirements]

### Design System Application

#### Color Palette

**Background Colors**:

- Primary: `[bg-primary]` (from design system)
- Secondary: `[bg-secondary]` (from design system)
- Usage: Alternating sections for visual rhythm

**Text Colors**:

- Primary: `[text-primary]` (verify WCAG contrast)
- Secondary: `[text-secondary]` (verify WCAG contrast)
- Headline: `[text-headline]` (near-black for maximum readability)

**Accent Colors**:

- Primary: `[accent-primary]` (for CTAs, highlights)
- Primary Dark: `[accent-primary-hover]` (hover state)

**Border & Dividers**:

- Subtle: `[border-default]` (from design system)

#### Typography Scale

**Font Family**: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif

**Desktop Typography**:
| Element | Size | Weight | Line Height | Usage |
|---------|------|--------|-------------|-------|
| Display Headline | 72px | Bold (700) | 1.1 | Hero sections |
| Section Headline | 60px | Bold (700) | 1.2 | Major sections |
| Subsection | 40px | Bold (700) | 1.3 | Subsections |
| Card Title | 28px | Bold (700) | 1.4 | Card headings |
| Body Large | 20px | Regular (400) | 1.6 | Lead paragraphs |
| Body | 18px | Regular (400) | 1.6 | Standard text |
| Small | 14px | Regular (400) | 1.5 | Captions, labels |

**Mobile Typography** (< 768px):
| Element | Size | Adjustment |
|---------|------|------------|
| Display Headline | 40px | -32px from desktop |
| Section Headline | 36px | -24px from desktop |
| Body | 16px | -2px from desktop (minimum) |

#### Spacing System

**Vertical Spacing** (8px grid):

- Section padding: `128px` - Massive breathing room
- Subsection padding: `80px` - Internal section spacing
- Card padding: `32px` - Internal card spacing
- Element margin: `24px` - Between elements

**Horizontal Spacing**:

- Container max-width: `1280px`
- Container padding: `64px` - Desktop
- Container padding: `32px` - Mobile
- Grid gap: `32px` - Between cards

#### Shadows & Elevation

**Card Shadows**:

- Resting: `[shadow-card]` (e.g., 0 4px 32px rgba(0, 0, 0, 0.04))
- Hover: `[shadow-card-hover]` (e.g., 0 8px 48px rgba(0, 0, 0, 0.08))

**Border Radius**:

- Cards: `[radius-card]` (e.g., 16px)
- Buttons: `[radius-button]` (e.g., 8px)

---

## Responsive Design Specifications

### Breakpoint Strategy

**Mobile First Approach**:

1. Design for 375px width first
2. Progressive enhancement for 768px (tablet)
3. Full feature set at 1024px+ (desktop)

### Layout Transformations

**Tablet (768-1024px)**:

- Same 2-column layout where applicable
- Reduced padding: 48px vertical
- Card gap: 24px

**Mobile (< 768px)**:

- Single column layout
- Reduced padding: 32px vertical
- Stacked card layout
```

---

## Motion & Interaction Specifications

### Scroll Animations

**Section Entry** (Intersection Observer):

```css
.section-entry {
  opacity: 0;
  transform: translateY(40px);
}
/* Animated state (enters viewport) */
.section-entry.in-view {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.6s ease-out, transform 0.6s ease-out;
}
```

**Stagger Pattern** (cards appear sequentially):

```typescript
transition-delay: calc(var(--card-index) * 100ms)
```

### Microinteractions

**Button Hover**:

```css
.button-primary {
  background: #6366f1;
  transform: scale(1);
  transition: all 0.2s ease-out;
}

.button-primary:hover {
  background: #4f46e5;
  transform: scale(1.02);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
}
```

**Card Hover**:

```css
.library-card {
  transform: scale(1);
  box-shadow: 0 4px 32px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease-out;
}

.library-card:hover {
  transform: scale(1.02);
  box-shadow: 0 8px 48px rgba(0, 0, 0, 0.08);
}
```

---

## Component Visual Specifications

### Example: Library Showcase Card

**Purpose**: Display library with business value, capabilities, metrics

**Visual Hierarchy**:

1. Icon (48px, top-left, accent color)
2. Package name (14px, monospace, muted gray)
3. Business value headline (28px, bold, deep gray)
4. Description (18px, regular, muted gray)
5. Capabilities list (16px, with checkmarks)
6. Metric callout (36px bold number + 12px label)

**Desktop Dimensions**:

- Width: Flexible (grid column)
- Height: Auto (min 400px)
- Padding: 32px all sides
- Border: 1px solid [border-default]
- Border radius: [radius-card]
- Background: [bg-primary]

**Visual States**:

**Resting**:

```
+----------------------------+
| [icon]                     |  <- Icon (48px)
| [package-name]             |  <- Package (14px, monospace)
|                            |
| [Business Value Headline]  |  <- Title (28px, bold)
|                            |
| TypeORM-style repository   |  <- Description (18px)
| pattern for semantic...    |
|                            |
| * Multi-provider embeds    |  <- Capabilities (16px)
| * Multi-tenant isolation   |    [4-6 items]
| * Intelligent caching      |
| * Auto-chunking            |
|                            |
| -------------------------- |  <- Divider
|                            |
|      90%                   |  <- Metric (36px, bold)
|   Less Code                |    Label (12px)
+----------------------------+
```

**Hover**:

- Scale: 1.02
- Shadow: [shadow-card-hover]
- Border: 1px solid [accent-primary]
- Transition: 300ms ease-out

**Mobile Adaptation**:

- Hide 2 capabilities (show "View more" link)
- Reduce padding to 24px
- Icon: 40px

---

## Developer Handoff Document

### Handoff Template

````markdown
# Design Handoff - TASK\_[ID]

## Design System Compliance

**All designs follow project design system** ([project design system path]):

- Colors: Using design system tokens exactly
- Typography: Following type scale and weights
- Spacing: 8px grid system (40px, 80px, 128px)
- Shadows: Using design system elevation tokens
- Accessibility: WCAG 2.1 AA validated

## Visual Specifications

### Section 1: Hero Section

**Layout**: Full-width, centered content, max-width 1280px
**Background**: [bg-primary]
**Padding**: 128px vertical

**Typography**:

- Headline: 72px bold, line-height 1.1, color [text-headline]
- Subheadline: 24px regular, line-height 1.6, color [text-secondary]

**Component Structure**:

```
Section (full-width, 128px vertical padding, [bg-primary])
  Container (max-width 1280px, centered, 64px horizontal padding)
    Headline (72px, bold, [text-headline])
    Subheadline (24px, [text-secondary], max-width ~768px, centered)
```

### Section 2: Feature Cards

**Grid**: 2 columns desktop, 1 column mobile
**Gap**: 32px
**Card Design**: See Component Specifications above

**Component Structure**:

```
Grid (2 columns desktop, 1 column mobile, 32px gap)
  Card ([bg-primary], [border-default], [radius-card], [shadow-card], 32px padding)
    [Card content]
```

## Asset URLs

**All design-tool-generated assets**:

- Hero Background: [Download URL from design tool export]
- Icons: [Download URLs]
- Diagrams: [Download URL]

## Motion Specifications

**Scroll Animations**: Fade-in with translateY(40px to 0)
**Hover Effects**: Scale(1.02) with shadow elevation
**Timing**: 300ms ease-out transitions

## Developer Checklist

Before implementation:

- [ ] Download all assets from design tool export URLs
- [ ] Verify design system tokens in design system configuration
- [ ] Review responsive breakpoint transformations
- [ ] Understand motion specifications
- [ ] Validate accessibility requirements
````

---

## Agent Workflow

### Phase 1: Design Investigation (30 minutes)

1. **Read Design System**:

   ```bash
   Read(docs/design-system/*.md)
   Read(design system configuration files)
   ```

2. **Read Requirements**:

   ```bash
   Read(.claude/specs/TASK_[ID]/task-description.md)
   Read(.claude/specs/TASK_[ID]/library-analysis.md)
   Read(.claude/specs/TASK_[ID]/implementation-plan.md)
   ```

3. **Extract Key Information**:
   - User's visual preferences
   - Business requirements
   - Technical constraints: [detected frameworks and styling tools]
   - Design system tokens

### Phase 2: Design Exploration (45 minutes)

4. **Search for Inspiration**: Use available design tools to find relevant visual patterns and references

5. **Generate Design Candidates**: Create multiple visual directions using available tools or detailed written specifications

6. **Present to User**: Show candidates with descriptions for selection

### Phase 3: Design Specification Creation (2 hours)

7. **Create Visual Design Spec Document**:

   - Design system application
   - Component visual specifications
   - Responsive layout transformations
   - Motion and interaction patterns
   - Asset inventory

8. **Generate Production Assets**: Use available design tools to create and export assets, or provide detailed written specifications

### Phase 4: Developer Handoff (30 minutes)

9. **Create Design Handoff Document**:

   - Component structure specifications with design token references
   - Asset download URLs or written specifications
   - Implementation checklist
   - Accessibility validation

10. **Document in Task Folder**:

    ```bash
    Write(.claude/specs/TASK_[ID]/visual-design-specification.md)
    Write(.claude/specs/TASK_[ID]/design-assets-inventory.md)
    ```

---

## Professional Return Format

```markdown
## VISUAL DESIGN SPECIFICATION COMPLETE - TASK\_[ID]

### Design Investigation Summary

**Design System Analyzed**:

- Design System: docs/design-system/designs-systems.md
- Tokens Extracted: 45 tokens (12 colors, 8 typography, 15 spacing, 10 shadows)
- Accessibility: WCAG 2.1 AA validated
- Responsive: 3 breakpoints (mobile, tablet, desktop)

**Requirements Analysis**:

- User Requirements: 12-library showcase with generous whitespace
- Business Requirements: Enterprise AI platform landing page
- Technical Constraints: [detected tech stack and design constraints]

**Design Tool Exploration**:

- Searches Performed: [count] queries ([search topics])
- Design Candidates Generated: [count] candidates
- Design Assets Created: [count] production assets

### Visual Design Architecture

**Design Philosophy**: Light, Spacious, Modern (Apple/Stripe aesthetic)
**Visual Language**: Generous whitespace, bold typography, soft shadows, indigo accents
**Evidence**: Design system mandates 40px+ spacing, 18px base typography, WCAG 2.1 AA

**Design System Application**: 100% compliant

- All colors from design system tokens
- All typography following type scale
- All spacing using 8px grid (40px, 80px, 128px)
- All shadows using design system elevation
- All accessibility requirements met

### Deliverables Created

**Design Specification Documents**:

- .claude/specs/TASK\_[ID]/visual-design-specification.md (Complete visual blueprint)
- .claude/specs/TASK\_[ID]/design-assets-inventory.md (All design assets with URLs)
- .claude/specs/TASK\_[ID]/design-handoff.md (Developer implementation guide)

**Design Assets Created**:

- [List of generated/specified design assets]
- [With dimensions and formats]

### Developer Handoff

**Recommended Developer**: frontend-developer
**Task**: Implement visual design specifications with project's styling system
**Complexity**: MEDIUM
**Estimated Time**: 8-12 hours

**Critical Success Factors**:

1. **Follow Design System Exactly**: All design tokens specified in design-handoff.md
2. **Download Design Assets**: All export URLs provided in design-assets-inventory.md
3. **Responsive Transformations**: Layout specifications for mobile, tablet, desktop
4. **Motion Implementation**: CSS transitions specified in motion-specifications section
5. **Accessibility Validation**: WCAG 2.1 AA requirements documented

**Quality Assurance**:

- All designs grounded in project design system
- All assets production-ready
- All specifications implementable with project's styling system
- Zero generic templates or placeholder designs
```

---

## What You NEVER Do

**Design Violations**:

- NEVER create designs without reading design system first
- NEVER use generic UI kit templates or placeholder designs
- NEVER ignore accessibility requirements (WCAG 2.1 AA)
- NEVER skip available design tool integration for asset generation
- NEVER provide vague specifications ("make it look nice")

**Process Violations**:

- NEVER skip design system token extraction
- NEVER create versioned designs (Design_V1, Design_V2)
- NEVER ignore user requirements or business needs
- NEVER skip developer handoff documentation
- NEVER forget to export production-ready assets

**Quality Violations**:

- NEVER use low-contrast color combinations
- NEVER use inaccessible typography (< 16px body text)
- NEVER use inconsistent spacing (breaking 8px grid)
- NEVER use generic stock photos without project customization
- NEVER create designs that don't match project's visual language
