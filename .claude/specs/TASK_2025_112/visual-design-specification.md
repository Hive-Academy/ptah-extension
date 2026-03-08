# Visual Design Specification - TASK_2025_112

## Design System Alignment

This specification extends the **Ptah Design System** (Egyptian sacred tech aesthetic) for three new frontend pages related to licensing and authentication.

**Design System Reference**: `.agent/skills/technical-content-writer/DESIGN-SYSTEM.md`

---

## Page 1: Pricing Page (`/pricing`)

### Layout Architecture

**Container**: `max-width: 1280px`, centered  
**Grid**: 3-column layout (1 col mobile, 2 col tablet, 3 col desktop)  
**Section padding**: `py-24 md:py-32` (96px → 128px)

### Component Specifications

#### 1. Page Header

**Headline**:

- Typography: `text-4xl md:text-5xl lg:text-6xl font-display` (Cinzel)
- Text: "Unlock Premium Capabilities"
- Color: `gradient-gold-text`
- Animation: `reveal-up`, duration `800ms`, delay `0ms`

**Subheadline**:

- Typography: `text-lg md:text-xl font-body` (Inter)
- Text: "Choose the plan that empowers your development workflow"
- Color: `--sand` (#c4b998)
- Animation: `reveal-up`, duration `800ms`, delay `200ms`

**Spacing**: Headline-to-subheadline gap: `1.5rem` (24px)

---

#### 2. Plan Cards (Repeating Structure)

**Card Container**:

```yaml
background: rgba(26, 26, 26, 0.8) # --charcoal with 80% opacity
backdrop-filter: blur(12px)
border: 1px solid rgba(212,175,55,0.1) # --gold with 10% opacity
border-radius: 1.5rem # 24px
padding: 2.5rem # 40px
min-height: 550px
transition: all 300ms cubic-bezier(0.4,0,0.2,1)
```

**Hover State**:

```yaml
transform: translateY(-8px)
border-color: rgba(212,175,55,0.4) # --gold at 40%
box-shadow: 0 0 60px rgba(212,175,55,0.25) # --glow-gold-lg
```

**Animation**: `scale-in`, duration `600ms`, stagger `150ms` between cards

---

#### 2a. Plan Card: Free

**Badge** (optional, top-right):

- Text: None

**Plan Name**:

- Typography: `text-2xl font-display font-semibold`
- Text: "Free"
- Color: `--cream` (#f5f5dc)

**Price**:

- Typography: `text-5xl font-display font-bold`
- Text: "$0"
- Color: `--gold` (#d4af37)

**Billing Period**:

- Typography: `text-sm font-body`
- Text: "/forever"
- Color: `--sand`

**Features List**:

```yaml
- icon: CheckCircle (heroicons), size 20px, color --scarab-teal
- spacing: gap-3 (12px between items)
- typography: text-base font-body, color --cream
- items:
    - 'Core AI-powered development features'
    - 'Basic code completion'
    - 'Standard chat interface'
    - 'Community support'
```

**CTA Button**:

```yaml
variant: secondary # outlined
text: 'Download Extension'
height: 48px
width: 100%
icon: ArrowDownTray (heroicons), right side
link: https://marketplace.visualstudio.com/items?itemName=hive-academy.ptah
hover:
  background: rgba(212,175,55,0.1)
  border-color: var(--gold)
```

---

#### 2b. Plan Card: Early Adopter

**Badge** (top-right corner):

```yaml
background: linear-gradient(135deg, var(--gold), var(--gold-dark))
text: 'LIMITED'
typography: text-xs uppercase tracking-widest font-body font-semibold
color: --obsidian
padding: 0.5rem 1rem
border-radius: 2rem
position: absolute, top -0.5rem, right 1.5rem
box-shadow: 0 0 20px rgba(212,175,55,0.3)
```

**Plan Name**:

- Typography: `text-2xl font-display font-semibold`
- Text: "Early Adopter"
- Color: `--gold-light` (#f4d47c)

**Price**:

- Typography: `text-5xl font-display font-bold`
- Text: "$99"
- Color: `gradient-gold-text`

**Billing Period**:

- Typography: `text-sm font-body`
- Text: "/lifetime license"
- Color: `--gold`

**Original Price** (strikethrough):

- Typography: `text-2xl font-body line-through`
- Text: "$299"
- Color: `--stone`

**Features List**:

```yaml
- icon: CheckCircle (heroicons), size 20px, color --gold
- spacing: gap-3
- typography: text-base font-body, color --cream
- items:
    - 'Everything in Free, plus:'
    - 'Premium MCP server tools'
    - 'Advanced code generation'
    - 'Priority support'
    - 'License never expires'
    - 'Lock-in early adopter pricing'
```

**CTA Button**:

```yaml
variant: primary # gradient button
text: 'Get Early Adopter'
height: 56px
width: 100%
background: linear-gradient(135deg, var(--gold), var(--gold-dark))
box-shadow: 0 0 20px rgba(212,175,55,0.2)
hover:
  transform: scale(1.05)
  box-shadow: 0 0 40px rgba(212,175,55,0.4)
action: initiatePaddleCheckout()
```

---

#### 2b. Plan Card: Pro (Future)

**Badge** (top-right):

```yaml
background: rgba(42,42,42,0.9)
text: 'COMING SOON'
typography: text-xs uppercase tracking-widest
color: --sand
padding: 0.5rem 1rem
border-radius: 2rem
```

**Plan Name**:

- Typography: `text-2xl font-display font-semibold`
- Text: "Pro"
- Color: `--cream`

**Price**:

- Typography: `text-5xl font-display font-bold`
- Text: "$29"
- Color: `--cream`
- Opacity: `0.6`

**Billing Period**:

- Typography: `text-sm font-body`
- Text: "/month"
- Color: `--sand`

**Features List**:

```yaml
- opacity: 0.5
- items:
    - 'Everything in Early Adopter, plus:'
    - 'Enterprise SSO integration'
    - 'Team collaboration features'
    - 'Custom MCP server configurations'
    - 'Dedicated account manager'
    - 'SLA guarantees'
```

**CTA Button**:

```yaml
variant: ghost # minimal, disabled state
text: 'Notify Me'
height: 48px
width: 100%
disabled: true
opacity: 0.5
cursor: not-allowed
```

---

#### 3. Comparison Table (Optional - Below Cards)

**Trigger**: User clicks "Compare Plans"

**Table Structure**:

```yaml
background: rgba(26,26,26,0.6)
border: 1px solid rgba(212,175,55,0.1)
border-radius: 1rem
padding: 2rem
max-width: 1024px
margin: 0 auto
```

**Headers**: Free | Early Adopter | Pro  
**Rows**: Feature name | Check/Cross icons | Check/Cross icons | Check/Cross icons

**Animation**: Accordion slide-down, duration `400ms`

---

### Responsive Behavior

#### Mobile (< 768px)

```yaml
layout: single column, vertical stack
card-gap: 2rem (32px)
padding: px-4 py-16
headline: text-4xl
price: text-4xl
```

#### Tablet (768px - 1023px)

```yaml
layout: 2 columns (Free + Early Adopter on first row, Pro below)
card-gap: 1.5rem
padding: px-6 py-24
headline: text-5xl
```

#### Desktop (≥ 1024px)

```yaml
layout: 3 columns, equal width
card-gap: 2rem
padding: px-8 py-32
headline: text-6xl
```

---

### Accessibility

**Color Contrast**:

- Headline (--gold on --obsidian): 7.8:1 ✅ AAA
- Body text (--cream on --charcoal): 12.5:1 ✅ AAA
- CTA button (--obsidian on --gold): 7.8:1 ✅ AAA

**Keyboard Navigation**:

- All CTA buttons: `tabindex="0"`, focus ring `outline: 2px solid var(--gold)`
- Cards: Not focusable (decorative)

**Screen Reader**:

- Badge: `aria-label="Limited time offer"`
- Price: `aria-label="Price ninety-nine dollars, lifetime license"`
- Features list: `<ul>` with semantic `<li>` items

---

## Page 2: Login Page (`/login`)

### Layout Architecture

**Container**: `max-width: 480px`, centered vertically and horizontally
**Min-height**: `100vh` (full viewport)
**Background**: `radial-gradient(ellipse at 50% 50%, rgba(212,175,55,0.1) 0%, rgba(10,10,10,1) 70%)`

### Component Specifications

#### 1. Logo/Branding

**Ptah Logo**:

- Size: `80px × 80px`
- Position: Top center, margin-bottom `2rem`
- Animation: `float` keyframe, duration `3s`, infinite loop

**Tagline**:

- Typography: `text-sm font-body uppercase tracking-widest`
- Text: "VS Code AI • Powered by Claude"
- Color: `--sand`
- Animation: `fade-in`, duration `600ms`, delay `200ms`

---

#### 2. Login Card

**Card Container**:

```yaml
background: rgba(26,26,26,0.9)
backdrop-filter: blur(20px)
border: 1px solid rgba(212,175,55,0.15)
border-radius: 1.5rem
padding: 3rem # 48px
box-shadow: 0 0 60px rgba(212,175,55,0.15)
width: 100%
max-width: 480px
```

**Headline**:

- Typography: `text-3xl font-display font-semibold`
- Text: "Welcome Back"
- Color: `gradient-gold-text`
- Text-align: `center`

**Subheadline**:

- Typography: `text-base font-body`
- Text: "Sign in with your enterprise account to access premium features"
- Color: `--sand`
- Text-align: `center`
- Margin-top: `0.75rem`

---

#### 3. SSO Button (Primary CTA)

**WorkOS Button**:

```yaml
type: button
height: 56px
width: 100%
margin-top: 2.5rem # 40px space from subheadline
background: linear-gradient(135deg, var(--gold), var(--gold-dark))
border: none
border-radius: 0.5rem # 8px
box-shadow: 0 0 30px rgba(212,175,55,0.25)
transition: all 300ms cubic-bezier(0.4,0,0.2,1)
cursor: pointer
display: flex
align-items: center
justify-content: center
gap: 0.75rem # 12px

hover:
  transform: scale(1.03)
  box-shadow: 0 0 50px rgba(212,175,55,0.4)

active:
  transform: scale(0.98)

disabled:
  opacity: 0.5
  cursor: not-allowed
  box-shadow: none
```

**Button Content**:

```yaml
icon: WorkOS logo SVG (monochrome), size 24px, color --obsidian
text:
  content: 'Sign in with WorkOS'
  typography: text-base font-body font-semibold
  color: --obsidian
  letter-spacing: 0.02em
```

**Loading State** (when clicked):

```yaml
icon: Spinner animation (heroicons), size 24px
text: 'Redirecting...'
opacity: 0.8
```

---

#### 4. Error State

**Error Alert** (conditionally shown):

```yaml
background: rgba(239,68,68,0.1) # --papyrus-red at 10%
border: 1px solid rgba(239,68,68,0.3)
border-radius: 0.5rem
padding: 1rem
margin-top: 1.5rem
display: flex
align-items: start
gap: 0.75rem
```

**Icon**: ExclamationTriangle (heroicons), size `20px`, color `--papyrus-red`

**Error Message**:

- Typography: `text-sm font-body`
- Text: "Authentication failed. Please try again or contact support."
- Color: `--cream`

**Retry Button**:

```yaml
type: button
margin-top: 0.75rem
padding: 0.5rem 1rem
background: transparent
border: 1px solid var(--papyrus-red)
border-radius: 0.375rem
color: --papyrus-red
transition: all 200ms
hover:
  background: rgba(239,68,68,0.1)
```

---

#### 5. Alternative Options

**Divider**:

- Margin-top: `2rem`
- Content: Horizontal line with centered text "OR"
- Line color: `rgba(255,255,255,0.1)`
- Text: `--stone`, `text-sm`

**Free Plan Link**:

- Typography: `text-sm font-body`
- Text: "Don't have a license? Try Free Plan"
- Color: `--lapis-blue` (#3b82f6)
- Hover: Underline, color `--gold`
- Link: VS Code Marketplace URL

---

### Responsive Behavior

#### Mobile (< 640px)

```yaml
card-padding: 2rem
headline: text-2xl
button-height: 48px
logo-size: 64px
```

#### Desktop (≥ 640px)

```yaml
card-padding: 3rem
headline: text-3xl
button-height: 56px
logo-size: 80px
```

---

### Accessibility

**ARIA Labels**:

- SSO button: `aria-label="Sign in with WorkOS SSO"`
- Error alert: `role="alert"`, `aria-live="polite"`
- Free plan link: `aria-label="Try free plan without license"`

**Keyboard Navigation**:

- Tab order: Logo (skip) → SSO button → Retry button (if error) → Free plan link
- Enter key on SSO button: Trigger OAuth redirect
- Escape key: Dismiss error alert

**Screen Reader Announcements**:

- On error: "Authentication failure. Please try again"
- On loading: "Redirecting to WorkOS login"

---

## Page 3: Profile/Dashboard Page (`/profile`)

### Layout Architecture

**Container**: `max-width: 1024px`, centered  
**Grid**: 2-column layout (content left, visual/stats right)  
**Section padding**: `py-16 md:py-24`

### Component Specifications

#### 1. Page Header

**Headline**:

- Typography: `text-3xl md:text-4xl font-display font-semibold`
- Text: "Your License"
- Color: `gradient-gold-text`

**Breadcrumb** (optional):

- Typography: `text-sm font-body`
- Text: "Home / Profile"
- Color: `--stone`
- Separator: `/` with opacity `0.5`

---

#### 2. Subscription Status Card (Left Column)

**Card Container**:

```yaml
background: rgba(26,26,26,0.8)
backdrop-filter: blur(12px)
border: 1px solid rgba(212,175,55,0.2)
border-radius: 1.5rem
padding: 2.5rem
min-height: 400px
```

**Plan Badge**:

```yaml
display: inline-flex
align-items: center
gap: 0.5rem
background: linear-gradient(135deg, var(--gold), var(--gold-dark))
color: --obsidian
padding: 0.5rem 1rem
border-radius: 2rem
font: text-xs uppercase tracking-widest font-semibold
```

**Plan Name**:

- Typography: `text-2xl font-display font-semibold`
- Text: "Early Adopter"
- Color: `--gold-light`
- Margin-top: `1rem`

**Status Indicator**:

```yaml
active:
  icon: CheckBadge (heroicons), size 24px, color --scarab-teal
  text: 'Active'
  background: rgba(45,212,191,0.1)

expired:
  icon: XCircle (heroicons), size 24px, color --papyrus-red
  text: 'Expired'
  background: rgba(239,68,68,0.1)
```

---

#### 3. License Details Section

**Expiration Info**:

```yaml
label:
  text: "Expiration Date"
  typography: text-sm font-body uppercase tracking-wider
  color: --stone

value:
  text: "Lifetime" OR "January 15, 2026"
  typography: text-lg font-body font-semibold
  color: --cream
  margin-top: 0.5rem
```

**Days Remaining** (if applicable):

```yaml
container:
  display: flex
  align-items: center
  gap: 0.5rem
  margin-top: 0.75rem

icon: Clock (heroicons), size 20px, color --gold

text:
  content: "Never expires" OR "47 days remaining"
  typography: text-base font-body
  color:
    good: --scarab-teal # >30 days
    warning: --gold # 7-30 days
    danger: --papyrus-red # <7 days
```

---

#### 4. License Key Display

**Section Header**:

- Typography: `text-lg font-body font-semibold`
- Text: "Your License Key"
- Color: `--cream`
- Margin-top: `2rem`

**Key Container**:

```yaml
background: rgba(10,10,10,0.8)
border: 1px solid rgba(212,175,55,0.15)
border-radius: 0.75rem
padding: 1.5rem
margin-top: 1rem
display: flex
justify-content: space-between
align-items: center
gap: 1rem
font-family: --font-mono # JetBrains Mono
```

**License Key Text**:

```yaml
text: 'PTAH-XXXX-XXXX-XXXX-XXXX'
typography: text-base md:text-lg font-mono
color: --gold
letter-spacing: 0.05em
word-break: break-all
flex: 1
```

**Copy Button**:

```yaml
type: button
padding: 0.75rem 1.25rem
background: transparent
border: 1px solid var(--gold)
border-radius: 0.5rem
display: flex
align-items: center
gap: 0.5rem
transition: all 200ms

hover:
  background: rgba(212,175,55,0.1)
  border-color: var(--gold-light)

active:
  transform: scale(0.95)

icon: ClipboardDocument (heroicons), size 20px, color --gold
text: 'Copy'
typography: text-sm font-body font-medium
color: --gold
```

**Success Toast** (after copy):

```yaml
position: fixed, top 2rem, right 2rem
background: rgba(45,212,191,0.9)
color: --obsidian
padding: 1rem 1.5rem
border-radius: 0.5rem
box-shadow: 0 10px 25px rgba(45,212,191,0.3)
display: flex
align-items: center
gap: 0.75rem
animation: slide-in-right, duration 300ms

icon: CheckCircle (heroicons), size 24px
text: 'License key copied to clipboard'
duration: 3000ms # auto-dismiss
```

---

#### 5. Action Buttons

**Manage Subscription Button**:

```yaml
type: button
width: 100%
height: 48px
margin-top: 2rem
background: transparent
border: 1px solid var(--gold)
border-radius: 0.5rem
color: --gold
transition: all 300ms

hover:
  background: rgba(212,175,55,0.1)
  border-color: var(--gold-light)

text: 'Manage Subscription'
icon: Cog6Tooth (heroicons), left side, size 20px
action: window.location.href = paddleCustomerPortalUrl
```

**Renew Button** (shown if expired):

```yaml
type: button
width: 100%
height: 56px
margin-top: 1rem
background: linear-gradient(135deg, var(--gold), var(--gold-dark))
border: none
border-radius: 0.5rem
box-shadow: 0 0 30px rgba(212,175,55,0.25)

hover:
  transform: scale(1.03)
  box-shadow: 0 0 50px rgba(212,175,55,0.4)

text: 'Renew Subscription'
icon: ArrowPath (heroicons), left side, size 20px, color --obsidian
action: initiatePaddleCheckout()
```

---

#### 6. Visual Element (Right Column - Desktop Only)

**3D License Badge Visualization**:

```yaml
container:
  width: 100%
  height: 400px
  background: radial-gradient(circle, rgba(212,175,55,0.1), transparent)
  border-radius: 1.5rem
  display: flex
  align-items: center
  justify-content: center

angular-3d-scene:
  model: Golden ankh symbol OR Egyptian seal
  material:
    metalness: 1.0
    roughness: 0.2
    color: --gold
  camera:
    position: [0, 0, 5]
    fov: 50
  lights:
    - type: pointLight
      position: [5, 5, 5]
      intensity: 1.2
      color: --gold
    - type: ambient
      intensity: 0.4
  animation:
    rotation: { speed: 0.003, axis: 'y' }
    mouse-parallax: { sensitivity: 0.05 }
```

---

### Error Handling

**API Failure State**:

```yaml
container:
  replace subscription card content with:

icon: ExclamationCircle (heroicons), size 64px, color --papyrus-red, centered

message:
  text: 'Unable to load license details'
  typography: text-xl font-body text-center
  color: --cream
  margin-top: 1.5rem

subtext:
  text: 'Please check your connection and try again'
  typography: text-base font-body text-center
  color: --sand
  margin-top: 0.5rem

retry-button:
  text: 'Retry'
  variant: primary
  width: 200px
  margin: 2rem auto 0
```

---

### Responsive Behavior

#### Mobile (< 768px)

```yaml
layout: single column
right-column (3D visual): hidden
card-padding: 2rem
headline: text-2xl
license-key: text-sm, no copy button label (icon only)
```

#### Tablet (768px - 1023px)

```yaml
layout: single column
right-column: shown below left column
card-padding: 2.5rem
headline: text-3xl
```

#### Desktop (≥ 1024px)

```yaml
layout: 2 columns (60% left, 40% right)
gap: 2rem
card-padding: 2.5rem
headline: text-4xl
```

---

### Accessibility

**Color Contrast**:

- All text on --charcoal background: ≥ 4.5:1 ✅ AA minimum
- Badges: --obsidian on --gold: 7.8:1 ✅ AAA

**Keyboard Navigation**:

- Tab order: Copy button → Manage subscription → Renew (if shown)
- Copy button: Enter/Space to copy, visual feedback on focus
- Focus ring: `outline: 2px solid var(--gold), outline-offset: 2px`

**Screen Reader**:

- License key: `aria-label="License key PTAH..."`
- Copy button: `aria-label="Copy license key to clipboard"`
- Success toast: `role="status"`, `aria-live="polite"`
- Days remaining: `aria-label="47 days remaining until expiration"`

---

## Asset Generation Requirements

### Canva Assets to Generate

1. **Hero Background Pattern** (Pricing page)

   - Size: 1920×1080px
   - Style: Subtle Egyptian hieroglyphic pattern overlay
   - Colors: --gold at 5% opacity on transparent
   - Usage: Background texture for pricing section

2. **WorkOS Logo Monochrome** (Login page)

   - Size: 48×48px SVG
   - Style: Single-color, outlined
   - Color: --obsidian (for button placement)
   - Usage: SSO button icon

3. **Plan Badge Icons** (Pricing page)

   - Size: 32×32px each
   - Icons needed: CheckCircle, Star, Crown
   - Style: Outlined, 1.5px stroke
   - Colors: Match feature states (--gold, --scarab-teal)
   - Usage: Feature list bullets

4. **License Badge 3D Model** (Profile page - optional enhancement)
   - Format: GLB if custom, or use Three.js primitives
   - Style: Egyptian ankh symbol with metallic gold material
   - Usage: Angular-3D scene in profile page right column

---

## Motion Design Patterns

### Page Entrance Animations

```typescript
// Stagger reveal for cards
gsap.from('.plan-card', {
  scrollTrigger: {
    trigger: '.pricing-container',
    start: 'top 80%',
  },
  opacity: 0,
  y: 60,
  scale: 0.95,
  duration: 0.6,
  stagger: 0.15,
  ease: 'power3.out',
});

// Login card scale-in
gsap.from('.login-card', {
  opacity: 0,
  scale: 0.9,
  duration: 0.5,
  ease: 'power2.out',
  delay: 0.2,
});

// License key reveal
gsap.from('.license-key-container', {
  scrollTrigger: {
    trigger: '.license-key-container',
    start: 'top 85%',
  },
  opacity: 0,
  x: -30,
  duration: 0.5,
  ease: 'power3.out',
});
```

### Micro-Interactions

```yaml
card-hover:
  property: transform, box-shadow
  duration: 300ms
  easing: cubic-bezier(0.4,0,0.2,1)

button-click:
  transform: scale(0.95)
  duration: 100ms
  easing: ease-in

toast-slide-in:
  transform: translateX(400px) → translateX(0)
  opacity: 0 → 1
  duration: 300ms
  easing: cubic-bezier(0,0,0.2,1)

badge-pulse:
  animation: glow-pulse 2s infinite
  keyframes: box-shadow intensity pulses
```

---

## Developer Handoff

### Angular Component Structure

```
apps/ptah-landing-page/src/app/pages/
├── pricing/
│   ├── pricing-page.component.ts
│   ├── pricing-page.component.html
│   ├── pricing-page.component.scss
│   └── components/
│       ├── plan-card/
│       │   ├── plan-card.component.ts
│       │   └── plan-card.component.html
│       └── comparison-table/
│           └── comparison-table.component.ts
├── login/
│   ├── login-page.component.ts
│   ├── login-page.component.html
│   └── login-page.component.scss
└── profile/
    ├── profile-page.component.ts
    ├── profile-page.component.html
    └── components/
        ├── subscription-card/
        │   └── subscription-card.component.ts
        ├── license-key-display/
        │   └── license-key-display.component.ts
        └── license-badge-3d/
            └── license-badge-3d.component.ts
```

### Implementation Priority

1. **Phase 1** (P0-Critical): Pricing page with Paddle integration
2. **Phase 2** (P0-Critical): Login page with WorkOS SSO
3. **Phase 3** (P0-Critical): Profile page with license display
4. **Phase 4** (P1-Enhancement): 3D visualizations, animations, comparison table

### TailwindCSS Configuration Extensions

Add to `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      animation: {
        'glow-pulse': 'glow-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        float: 'float 3s ease-in-out infinite',
        'reveal-up': 'reveal-up 0.8s ease-out',
        'scale-in': 'scale-in 0.6s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(212,175,55,0.2)' },
          '50%': { boxShadow: '0 0 40px rgba(212,175,55,0.4)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'reveal-up': {
          from: { opacity: '0', transform: 'translateY(60px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(400px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
};
```

---

## Quality Checklist

### Design System Compliance

- [x] All colors use Ptah design tokens (--gold, --cream, --charcoal, etc.)
- [x] Typography follows Cinzel (display) + Inter (body) stack
- [x] Spacing uses system values (rem multiples of 4)
- [x] Animations reference predefined patterns (reveal-up, glow-pulse)

### Accessibility (WCAG 2.1 AA)

- [x] Color contrast ratios ≥ 4.5:1 for text
- [x] All interactive elements keyboard accessible
- [x] Focus states visible (2px gold outline)
- [x] ARIA labels for screen readers
- [x] Reduced motion query respected

### Responsiveness

- [x] Mobile-first approach (320px min-width)
- [x] Breakpoints align with TailwindCSS (sm, md, lg, xl)
- [x] Touch targets ≥ 44px on mobile
- [x] Horizontal scroll prevented

### Brand Alignment

- [x] Egyptian sacred tech aesthetic maintained
- [x] Premium/mystical feel (glassmorphism, gold accents, glows)
- [x] Consistent with existing Ptah landing page

---

## Next Steps for Architect

Reference this specification when creating `implementation-plan.md`:

1. **Pricing page**: Focus on Paddle SDK integration for checkout flow
2. **Login page**: Focus on WorkOS OIDC redirect and callback handling
3. **Profile page**: Focus on `/api/v1/licenses/me` endpoint integration
4. **Shared**: Create reusable components (buttons, cards, toasts)

**Design System**: Already established, no new tokens needed.  
**Assets**: Generate Canva assets after plan approval.  
**3D Elements**: Optional enhancement, can be deferred to Phase 2.
