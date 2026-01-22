# Design Assets Inventory - TASK_2025_112

## Purpose

This document catalogs all generated visual assets for the Production License System frontend pages.

---

## Generated Assets

### 1. Pricing Hero Pattern

![Pricing Hero Pattern](C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/pricing_hero_pattern_1769086677833.png)

**Filename**: `pricing_hero_pattern_1769086677833.png`  
**Dimensions**: 1920×1080px  
**Format**: PNG  
**Color Mode**: Dark background with gold (#d4af37) hieroglyphics at ~5% opacity

**Usage**:

- Background texture for `/pricing` page header section
- Apply as `background-image` with `background-size: cover`
- Overlay with radial gradient for depth

**Implementation**:

```css
.pricing-hero {
  background-image: radial-gradient(ellipse at 50% 70%, rgba(212, 175, 55, 0.15), transparent 70%), url('/assets/images/pricing_hero_pattern.png');
  background-size: cover;
  background-position: center;
}
```

---

### 2. WorkOS SSO Icon

![WorkOS Icon](C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/workos_sso_icon_1769086697953.png)

**Filename**: `workos_sso_icon_1769086697953.png`  
**Dimensions**: 48×48px (suitable for button)  
**Format**: PNG with transparent background  
**Color Mode**: Monochrome black (will be recolored via CSS to --obsidian on gold button)

**Usage**:

- Icon for "Sign in with WorkOS" button on `/login` page
- Display at 24px×24px within button (48px source scales down smoothly)

**Implementation**:

```html
<button class="sso-button">
  <img src="/assets/images/workos_icon.png" alt="" class="w-6 h-6" aria-hidden="true" />
  <span>Sign in with WorkOS</span>
</button>
```

**Alternative**: Convert to SVG for better quality at any size

---

### 3. License Badge 3D Ankh

![3D Ankh Badge](C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/license_badge_3d_1769086718789.png)

**Filename**: `license_badge_3d_1769086718789.png`  
**Dimensions**: 800×800px  
**Format**: PNG  
**Color Mode**: Golden metal ankh with cosmic background, glowing effect

**Usage**:

- Visual element for `/profile` page right column (desktop only)
- Can be used as static image OR as texture for Three.js 3D scene
- Serves as premium quality indicator for licensed users

**Implementation (Static)**:

```html
<div class="relative w-full h-96 flex items-center justify-center">
  <img src="/assets/images/license_badge_3d.png" alt="Premium license badge" class="w-64 h-64 animate-float" />
</div>
```

**Implementation (3D Scene Alternative)**:

- Use as texture map on 3D ankh geometry in Angular-3D component
- Apply metallic material with `@angular-3d/core`
- Add slow rotation animation (0.003 rad/frame on Y-axis)

---

### 4. Early Adopter "LIMITED" Badge

![Limited Badge](C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/plan_badge_early_adopter_1769086735079.png)

**Filename**: `plan_badge_early_adopter_1769086735079.png`  
**Dimensions**: Scalable (rendered at 300×100px source)  
**Format**: PNG  
**Color Mode**: Golden gradient with hieroglyphic details, glowing effect

**Usage**:

- Corner badge for "Early Adopter" plan card on `/pricing` page
- Position absolutely in top-right corner of card
- Indicates limited-time offer scarcity

**Implementation**:

```html
<div class="plan-card relative">
  <img src="/assets/images/limited_badge.png" alt="Limited time offer" class="absolute -top-2 right-6 w-32 h-auto" />
  <!-- Rest of card content -->
</div>
```

**CSS Enhancement**:

```css
.limited-badge {
  filter: drop-shadow(0 0 20px rgba(212, 175, 55, 0.4));
  animation: glow-pulse 2s infinite;
}
```

---

## Asset Locations

**Production Deployment**:

- Path: `apps/ptah-landing-page/src/assets/images/license-system/`
- Copy all assets to this directory before build

**Current Artifacts Location**:

- Path: `C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/`
- Assets generated during design phase

---

## Asset Optimization

### Before Production Deployment

1. **Compress PNGs**:

   ```bash
   # Use TinyPNG or similar
   pngquant --quality=80-90 pricing_hero_pattern.png
   ```

2. **Convert to WebP** (for browsers that support it):

   ```bash
   cwebp -q 85 pricing_hero_pattern.png -o pricing_hero_pattern.webp
   ```

3. **Responsive Variants** (for hero pattern):

   - Desktop: 1920×1080px (original)
   - Tablet: 1280×720px (scaled down)
   - Mobile: 768×432px (scaled down)

4. **Lazy Loading**:
   ```html
   <img src="/assets/images/license_badge_3d.png" loading="lazy" decoding="async" />
   ```

---

## Missing Assets (Optional Enhancements)

The following assets were specified in the visual design but not yet generated:

### Plan Badge Icons (Feature List Bullets)

- **CheckCircle Icon** (32×32px, gold color)
- **Star Icon** (32×32px, for premium features)
- **Crown Icon** (32×32px, for pro plan)

**Recommendation**: Use Heroicons SVG library instead of custom assets:

```bash
npm install @heroicons/react
```

Then import as React/Angular components:

```typescript
import { CheckCircleIcon } from '@heroicons/react/24/outline';
```

**Rationale**: Heroicons are vector-based, color-customizable, and save asset bandwidth.

---

## Asset Usage Matrix

| Asset                | Pricing Page  | Login Page     | Profile Page      |
| -------------------- | ------------- | -------------- | ----------------- |
| Pricing Hero Pattern | ✅ Background | ❌             | ❌                |
| WorkOS SSO Icon      | ❌            | ✅ Button icon | ❌                |
| 3D Ankh Badge        | ❌            | ❌             | ✅ Visual element |
| Limited Badge        | ✅ Card badge | ❌             | ❌                |

---

## Design System Alignment

All assets adhere to the **Ptah Design System** specifications:

- **Colors**: Gold (#d4af37, #f4d47c, #9a7b2c) on dark backgrounds (#0a0a0a, #1a1a1a)
- **Style**: Egyptian sacred tech aesthetic with hieroglyphics and mystical elements
- **Effects**: Glowing, metallic, premium quality
- **Accessibility**: Decorative assets use `alt=""` or `aria-hidden="true"`

---

## Next Steps for Developers

1. **Copy assets to project**:

   ```bash
   mkdir -p apps/ptah-landing-page/src/assets/images/license-system
   cp C:/Users/abdal/.gemini/antigravity/brain/32121498-83ed-4b41-8ac3-b07f38c9c97a/*.png \
      apps/ptah-landing-page/src/assets/images/license-system/
   ```

2. **Optimize for production** (see "Asset Optimization" section above)

3. **Reference in components** using Angular asset paths:

   ```typescript
   backgroundImage: 'url(/assets/images/license-system/pricing_hero_pattern.png)';
   ```

4. **Test loading performance** using Chrome DevTools Network panel:

   - Target: < 200KB total for all images
   - Current total: ~800KB (before WebP conversion)

5. **Implement lazy loading** for below-the-fold images (3D badge, profile page)

---

## Version History

| Version | Date       | Changes                                    |
| ------- | ---------- | ------------------------------------------ |
| 1.0     | 2026-01-22 | Initial asset generation for TASK_2025_112 |

---

**Asset Generation Tool**: Gemini Deep Research `generate_image`  
**Design Lead**: ui-ux-designer agent  
**Task**: TASK_2025_112 - Production License System
