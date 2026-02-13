# Asset Generation - Create Visual Assets with AI

## Purpose

This guide documents workflows for generating production-ready visual assets using AI tools. Learn to craft effective prompts and workflows for different asset types.

---

## Tool Selection Matrix

| Asset Type               | Best Tool                | Why                               |
| ------------------------ | ------------------------ | --------------------------------- |
| **Hero illustrations**   | Midjourney, DALL-E 3     | Complex scenes, unique art styles |
| **Icons**                | Midjourney + refinement  | Consistent style sets             |
| **3D elements**          | Three.js, Spline         | Interactive, animated             |
| **Marketing graphics**   | Canva                    | Templates, quick iterations       |
| **UI mockups**           | Figma, Framer            | Developer handoff                 |
| **Backgrounds/patterns** | Midjourney               | Unique, tileable                  |
| **Product screenshots**  | Screen Studio, CleanShot | Polished presentations            |

---

## Prompting Framework

### The SCSM Formula

**S**ubject + **C**ontext + **S**tyle + **M**odifiers

```
[What you want] + [Environment/Setting] + [Art style/Aesthetic] + [Technical specs]
```

### Example Breakdown

```
Subject:     "A golden ankh symbol"
Context:     "floating in space with particle effects"
Style:       "sacred tech aesthetic, neo-mystical, premium dark theme"
Modifiers:   "--ar 16:9 --v 6 --style raw"

Full prompt: "A golden ankh symbol floating in space with particle effects,
              sacred tech aesthetic, neo-mystical, premium dark theme,
              deep black background (#0a0a0a), gold accents (#d4af37),
              subtle glow, minimalist --ar 16:9 --v 6 --style raw"
```

---

## Asset Type Workflows

### 1. Hero Section Visuals

**Goal**: Create the main visual element for your landing page hero

#### Prompt Template

```markdown
## Hero Visual Brief

**Concept**: [Core visual idea]
**Aesthetic**: [Your design system aesthetic]
**Colors**:

- Background: [hex]
- Accent: [hex]
- Secondary: [hex]
  **Mood**: [Descriptive words]
  **Composition**: [Layout guidance]
  **Technical**: [Aspect ratio, quality settings]
```

#### Example: Ptah-Style Hero

```
Prompt: "Abstract 3D sphere with Egyptian hieroglyph patterns etched in gold,
         floating in deep black void, surrounded by golden particle dust,
         sacred geometry, mystical technology aesthetic, premium dark theme,
         cinematic lighting, volumetric fog, 8k quality,
         deep black background #0a0a0a, gold accents #d4af37,
         subtle ambient glow --ar 16:9 --v 6 --s 250"
```

#### Iteration Process

1. **Generate 4 variations** with base prompt
2. **Pick best direction**, note what works
3. **Refine prompt** with specific improvements
4. **Upscale** winning image
5. **Post-process** (adjust colors to match design system)

---

### 2. Icon Sets

**Goal**: Create consistent icon set for features/navigation

#### Consistency Techniques

```markdown
## Icon Generation Rules

1. **Same prompt structure** for all icons
2. **Same style keywords** every time
3. **Same modifiers** (--v, --s, --style)
4. **Same color reference** in every prompt
5. **Generate in batches** for consistency
```

#### Icon Prompt Template

```
"[Object] icon, [style] design, [color] on [background],
 minimal, geometric, consistent stroke width, centered composition,
 [your aesthetic keywords], clean edges, scalable --ar 1:1 --v 6"
```

#### Example: Feature Icons

```
Base style: "minimal line icon, gold (#d4af37) strokes on transparent,
             geometric, sacred tech aesthetic, 2px stroke weight"

Icons:
- "Search magnifying glass icon, [base style] --ar 1:1"
- "Code brackets icon, [base style] --ar 1:1"
- "Lightning bolt icon, [base style] --ar 1:1"
- "Cube/3D box icon, [base style] --ar 1:1"
```

---

### 3. Background Patterns

**Goal**: Create tileable patterns or abstract backgrounds

#### Pattern Types

| Type              | Use Case              | Prompt Keywords                |
| ----------------- | --------------------- | ------------------------------ |
| **Tileable**      | Repeating backgrounds | "seamless pattern", "tileable" |
| **Hero gradient** | Section backgrounds   | "gradient", "fade to black"    |
| **Texture**       | Subtle overlays       | "noise texture", "grain"       |
| **Geometric**     | Tech aesthetics       | "geometric pattern", "grid"    |

#### Example: Sacred Tech Pattern

```
"Seamless tileable pattern of subtle Egyptian hieroglyphs and sacred geometry,
 very dark gray (#1a1a1a) on black (#0a0a0a), extremely subtle,
 barely visible, minimal, abstract, tech aesthetic --tile --v 6"
```

---

### 4. 3D Elements (Three.js/Spline)

**Goal**: Create interactive 3D elements for web

#### When to Use 3D

- Hero section backgrounds with parallax
- Interactive product showcases
- Animated accents (floating shapes)
- Loading/transition animations

#### Three.js Asset Specs

```yaml
sphere_hero:
  geometry: SphereGeometry(1, 64, 64)
  material:
    type: MeshStandardMaterial
    metalness: 1.0
    roughness: 0.2
    color: '#d4af37'
  effects:
    - UnrealBloomPass
    - Particle halo
  animation:
    - Slow rotation (0.001 rad/frame)
    - Mouse parallax

particle_system:
  count: 500
  size: 0.02
  color: '#d4af37'
  opacity: 0.6
  animation:
    - Random drift
    - Opacity pulse
```

#### Handoff Format

```typescript
// 3D Element Specification
export const heroSphereConfig = {
  geometry: {
    type: 'sphere',
    radius: 1,
    segments: 64,
  },
  material: {
    type: 'standard',
    metalness: 1.0,
    roughness: 0.2,
    color: '#d4af37',
  },
  effects: ['bloom', 'particles'],
  animation: {
    rotation: { y: 0.001 },
    parallax: { sensitivity: 0.5 },
  },
};
```

---

### 5. Marketing Graphics (Canva)

**Goal**: Create social media, presentations, promotional materials

#### Canva Workflow

```typescript
// 1. Search for templates
mcp__Canva__search_designs({
  query: 'SaaS product landing dark theme',
  ownership: 'any',
});

// 2. Generate custom designs
mcp__Canva__generate_design({
  design_type: 'presentation',
  query: `
    Product showcase presentation for developer tool.
    Dark theme (#0a0a0a background), gold accents (#d4af37).
    Clean typography, generous whitespace.
    Include: hero slide, features grid, code examples, CTA.
    Style: Premium tech, sacred geometry patterns, minimal.
  `,
});

// 3. Export production assets
mcp__Canva__export_design({
  design_id: 'selected_design_id',
  format: { type: 'png', width: 1920, height: 1080 },
});
```

---

## Post-Processing Workflow

### Color Correction

After generating assets, ensure colors match your design system:

1. **Open in editor** (Photoshop, Figma, or GIMP)
2. **Sample generated colors** with eyedropper
3. **Adjust to exact tokens** using Hue/Saturation
4. **Verify contrast** still meets WCAG

### Format Optimization

| Asset Type           | Format | Optimization           |
| -------------------- | ------ | ---------------------- |
| Photos/illustrations | WebP   | 80-90% quality         |
| Icons                | SVG    | Minified               |
| UI elements          | PNG    | Transparent, optimized |
| Patterns             | WebP   | Tileable, small size   |
| 3D previews          | WebP   | Fallback for no-JS     |

### Size Guidelines

```yaml
hero_images:
  desktop: 1920x1080 or wider
  tablet: 1024x768
  mobile: 640x480

icons:
  small: 24x24
  medium: 48x48
  large: 96x96
  export: SVG (scalable)

social:
  og_image: 1200x630
  twitter: 1200x600
  instagram: 1080x1080
```

---

## Prompt Library

### Sacred Tech Aesthetic

```
Base keywords: "sacred tech, neo-mystical, ancient wisdom meets technology,
               Egyptian influence, gold accents, deep black, premium dark,
               subtle glow effects, geometric patterns, minimal"
```

### Clean Enterprise

```
Base keywords: "clean minimal design, white background, soft shadows,
               professional, enterprise, subtle gradients, generous whitespace,
               modern typography, indigo accents, trustworthy"
```

### Gradient Modern

```
Base keywords: "modern gradient, purple to blue to teal, dark background,
               glass morphism, blur effects, futuristic, sleek, dynamic,
               neon glow, tech-forward"
```

---

## Asset Documentation Template

For each generated asset, document:

```markdown
## Asset: [Name]

**Type**: [Hero/Icon/Background/etc.]
**Tool**: [Midjourney/DALL-E/Canva/etc.]
**File**: [filename.ext]

### Generation Details

**Prompt**:
```

[Full prompt used]

```

**Settings**: [--v 6 --ar 16:9 --s 250]
**Iterations**: [Number of attempts]

### Post-Processing
- [ ] Color corrected to design system
- [ ] Optimized for web
- [ ] Multiple sizes exported

### Usage
- **Location**: [Where this asset is used]
- **Fallback**: [Alternative if asset fails to load]

### Files
- Original: `/assets/originals/[name]-original.png`
- Web: `/assets/web/[name].webp`
- Mobile: `/assets/mobile/[name]-mobile.webp`
```

---

## Quality Checklist

Before using generated assets:

- [ ] Colors match design system tokens (within 5% variance)
- [ ] Contrast meets accessibility requirements
- [ ] Resolution sufficient for intended display size
- [ ] File size optimized for web (<500KB for heroes)
- [ ] Fallback/alt text defined
- [ ] Asset documented in inventory
- [ ] License/usage rights confirmed (for AI-generated)
