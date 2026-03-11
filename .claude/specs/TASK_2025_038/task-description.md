# Task Description - TASK_2025_038

**Created**: 2025-12-02  
**Product Manager**: product-manager  
**Status**: AWAITING USER VALIDATION

---

## 1. Task Overview

### Task Type

**FEATURE** (New Application)

### Complexity Assessment

**HIGH**

**Reasoning**: This task involves creating a new Nx application with multiple advanced technologies (Angular, DaisyUI, Three.js, GSAP), component reuse from existing libraries, static data rendering, GitHub Pages deployment, and sophisticated visual design with the Egyptian theme.

### Timeline Estimate

**Initial Estimate**: 5-7 days  
**Timeline Discipline**: ✅ Under 2 weeks - compliant

---

## 2. Business Requirements

### Primary Objective

Deliver a visually stunning landing page that showcases the Ptah Extension's value proposition - enhancing Claude Code with an Egyptian-themed, powerful VS Code interface. The page should demonstrate real product capabilities through a live demo component and clearly communicate the unique features (`workspace-intelligence`, `vscode-lm-tools`).

### User Stories

**US1: First-Time Visitor Experience**
**As a** potential user visiting the Ptah Extension landing page  
**I want** to immediately understand what Ptah Extension does  
**So that** I can decide if it's valuable for my development workflow

**US2: Live Demo Interaction**
**As a** developer evaluating the extension  
**I want** to see an interactive demo of the chat interface  
**So that** I can experience the product quality before installing

**US3: Feature Discovery**
**As a** developer looking for VS Code AI tooling  
**I want** to explore Ptah's unique features (`workspace-intelligence`, `vscode-lm-tools`)  
**So that** I understand how it improves upon standard Claude Code

**US4: Installation Journey**
**As a** convinced visitor  
**I want** to easily navigate to the VS Code Marketplace or GitHub  
**So that** I can install the extension immediately

### Success Metrics

- **Page Load Time**: < 3 seconds on 4G network (Lighthouse score > 90)
- **Engagement**: Average scroll depth > 75% of page
- **Conversion**: Clear CTA visibility with < 2 clicks to marketplace
- **Visual Impact**: Three.js/GSAP animations execute without frame drops (60fps)
- **Demo Quality**: Chat demo renders sample session with full component fidelity

---

## 3. Functional Requirements (SMART Format)

### FR1: Nx Application Scaffolding

**Specific**: Create a new Angular application in the Nx workspace at `apps/ptah-landing-page` with standalone components, DaisyUI styling, and the existing "Anubis" theme configuration.  
**Measurable**: Application builds successfully with `nx build ptah-landing-page` and serves with `nx serve ptah-landing-page`.  
**Achievable**: Standard Nx generator with existing tailwind/DaisyUI configuration pattern from webview app.  
**Relevant**: Foundation for all landing page content and features.  
**Time-bound**: 0.5 days

### FR2: Hero Section with Three.js Animation

**Specific**: Create a hero section featuring an animated Three.js canvas (Egyptian-themed 3D elements - pyramids, ankh symbols, hieroglyphics) with GSAP-powered scroll effects. The hero includes headline, tagline, and primary CTA button.  
**Measurable**: Canvas renders at 60fps, GSAP animations trigger correctly on scroll, hero section displays on all viewports (mobile-first responsive).  
**Achievable**: Three.js and GSAP are well-documented libraries with Angular integration patterns.  
**Relevant**: Creates the "wow factor" first impression that differentiates Ptah from competitors.  
**Time-bound**: 1.5 days

### FR3: Live Chat Demo Section

**Specific**: Integrate the existing chat library components (`chat-view`, `message-bubble`, `execution-node`, `agent-execution`) to render a pre-loaded session from JSON data (derived from `test-sessions-anubis/*.jsonl`). The demo should display actual Claude Code interactions including tool calls, agent sub-tasks, and markdown rendering.  
**Measurable**: Demo renders at least 5 message exchanges with nested agent executions, tool calls display correctly, markdown renders properly.  
**Achievable**: Components exist and are exported from `libs/frontend/chat`. Need to create a static data adapter service.  
**Relevant**: Core value demonstration - showing users what they'll experience.  
**Time-bound**: 1.5 days

### FR4: Feature Showcase Cards (`workspace-intelligence` & `vscode-lm-tools`)

**Specific**: Create animated feature cards highlighting:

1. **workspace-intelligence**: Context analysis, file prioritization, project detection capabilities
2. **vscode-lm-tools**: VS Code Language Model API integration, code execution, permission handling

Cards use DaisyUI components with Egyptian "power-up" styling and GSAP entrance animations.  
**Measurable**: Cards display on scroll with animation, content accurately describes features, links to documentation/source.  
**Achievable**: Standard DaisyUI card components with GSAP scroll triggers.  
**Relevant**: Educates users on Ptah's unique differentiators beyond basic Claude CLI.  
**Time-bound**: 1 day

### FR5: Claude Code Enhancement Narrative Section

**Specific**: Create a comparison/enhancement section showing how Ptah transforms Claude Code CLI experience:

- Before: Terminal-only, no persistent sessions, no visual context
- After: Visual GUI, session management, workspace intelligence, tool visualization

Use Egyptian theme metaphors (e.g., "Ancient wisdom meets modern AI").  
**Measurable**: Section renders with visual before/after comparison, content is scannable with clear value props.  
**Achievable**: HTML/CSS with DaisyUI components.  
**Relevant**: Addresses user question "Why use Ptah instead of just Claude CLI?"  
**Time-bound**: 0.5 days

### FR6: Call-to-Action Footer

**Specific**: Create a footer section with:

- Primary CTA: "Install from VS Code Marketplace" button
- Secondary CTA: "View on GitHub" link
- Social/Community links (if applicable)
- MIT License acknowledgment

**Measurable**: CTAs are visible, buttons navigate to correct URLs, footer renders on all viewports.  
**Achievable**: Standard DaisyUI footer components.  
**Relevant**: Conversion point for interested visitors.  
**Time-bound**: 0.25 days

### FR7: GitHub Pages Deployment Configuration

**Specific**: Configure the application for GitHub Pages deployment:

- Base href configuration for `/<repo-name>/` path
- Build output to `docs/` or `gh-pages` branch
- Nx target for production build with deployment

**Measurable**: `nx build ptah-landing-page --prod` outputs deployable assets, page loads correctly from GitHub Pages URL.  
**Achievable**: Standard Angular/Nx GitHub Pages pattern with hash-based routing.  
**Relevant**: Makes the landing page publicly accessible.  
**Time-bound**: 0.25 days

### FR8: Static Session Data Adapter

**Specific**: Create a service/utility that converts JSONL session data to the format expected by chat components. Include at least 2 sample sessions in `assets/demo-sessions/`:

1. A simple Q&A session
2. A complex multi-agent task with tool calls

**Measurable**: Service parses JSONL, returns typed `ExecutionNode[]` structure, components render correctly.  
**Achievable**: Parse logic mirrors existing session loader in webview app.  
**Relevant**: Enables the live demo without backend dependencies.  
**Time-bound**: 0.5 days

---

## 4. Non-Functional Requirements

### Performance Requirements

- **Page Load**: First Contentful Paint (FCP) < 1.5s, Largest Contentful Paint (LCP) < 2.5s
- **Animation Performance**: Three.js canvas maintains 60fps, GSAP animations don't cause jank
- **Bundle Size**: Initial bundle < 500KB (gzipped), lazy-load Three.js scene
- **Lighthouse Score**: Performance > 85, Accessibility > 90, Best Practices > 90, SEO > 90

### Accessibility Requirements

- **WCAG 2.1 Level AA** compliance
- All animations respect `prefers-reduced-motion` media query
- Full keyboard navigation support
- Screen reader friendly (proper ARIA labels, semantic HTML)
- Color contrast ratios meet AA standards (already satisfied by Anubis theme)

### Browser Compatibility

- Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- Mobile browsers: iOS Safari 14+, Chrome for Android
- Graceful degradation for older browsers (Three.js fallback to static image)

### SEO Requirements

- Semantic HTML5 structure
- Meta tags (title, description, Open Graph, Twitter Cards)
- Structured data (JSON-LD for SoftwareApplication)
- Canonical URL configuration

---

## 5. Acceptance Criteria (BDD Format)

### Scenario 1: Landing Page Initial Load

**Given** a user navigates to the Ptah Extension landing page  
**When** the page finishes loading  
**Then** the hero section with Three.js animation should be visible  
**And** the page should load in under 3 seconds on a 4G connection  
**And** the navigation bar should display Ptah branding

### Scenario 2: Hero Animation Engagement

**Given** the landing page is loaded with animations enabled  
**When** the user scrolls past the hero section  
**Then** the Three.js Egyptian elements should animate (parallax, rotation, or reveal effects)  
**And** the animation should maintain 60fps without frame drops

### Scenario 3: Reduced Motion Preference

**Given** a user has enabled "prefers-reduced-motion" in their system settings  
**When** the page loads  
**Then** all GSAP animations should be disabled or simplified  
**And** Three.js should display a static scene instead of animated elements

### Scenario 4: Live Chat Demo Rendering

**Given** the user scrolls to the live demo section  
**When** the demo section enters the viewport  
**Then** the chat interface should render with pre-loaded session data  
**And** at least 5 message exchanges should be visible  
**And** nested agent executions should display with proper hierarchy  
**And** tool calls should render with syntax highlighting

### Scenario 5: Feature Card Animations

**Given** the user scrolls to the feature showcase section  
**When** a feature card enters the viewport  
**Then** the card should animate into view (fade + slide from appropriate direction)  
**And** the animation should complete in under 500ms  
**And** the card content should be fully readable after animation

### Scenario 6: CTA Navigation

**Given** the user clicks the "Install from VS Code Marketplace" button  
**When** the click event fires  
**Then** a new tab should open to the VS Code Marketplace Ptah Extension page  
**And** the URL should match the official marketplace listing

### Scenario 7: Mobile Responsive Layout

**Given** the user views the page on a mobile device (< 768px viewport)  
**When** the page renders  
**Then** all sections should display in a single-column layout  
**And** the Three.js canvas should be appropriately sized  
**And** the chat demo should be scrollable within a bounded container  
**And** touch interactions should work correctly

### Scenario 8: GitHub Pages Deployment

**Given** the landing page is built with production configuration  
**When** deployed to GitHub Pages  
**Then** all assets should load with correct paths  
**And** hash-based routing should work correctly  
**And** the page should be accessible at `https://<org>.github.io/<repo>/`

---

## 6. Risk Assessment

### Technical Risks

| Risk                                               | Probability | Impact | Mitigation                                                                        |
| -------------------------------------------------- | ----------- | ------ | --------------------------------------------------------------------------------- |
| Three.js bundle size impacts load time             | MEDIUM      | MEDIUM | Lazy-load Three.js scene after initial page load, use minimal geometry            |
| Chat components have implicit webview dependencies | MEDIUM      | HIGH   | Audit component imports, mock/stub VS Code-specific services for static rendering |
| GSAP animations cause scroll performance issues    | LOW         | MEDIUM | Use GSAP's ScrollTrigger with proper optimization, test on low-end devices        |
| Session data format mismatch with components       | MEDIUM      | MEDIUM | Create dedicated adapter layer, comprehensive type mapping                        |

### Business Risks

| Risk                                                  | Probability | Impact | Mitigation                                                 |
| ----------------------------------------------------- | ----------- | ------ | ---------------------------------------------------------- |
| Landing page doesn't convey value proposition clearly | MEDIUM      | HIGH   | User testing with 2-3 developers before final deployment   |
| GitHub Pages path configuration causes broken links   | LOW         | MEDIUM | Test deployment in staging branch before main deployment   |
| Demo session reveals sensitive/copyrighted content    | LOW         | HIGH   | Carefully curate demo session data, use synthetic examples |

---

## 7. Research Recommendations

**Technical Research Needed**: YES

**Research Questions**:

1. **Three.js + Angular Integration**: What is the recommended pattern for integrating Three.js with Angular 20+ standalone components? Are there existing libraries (e.g., `angular-three`) or is direct integration preferred?
2. **GSAP ScrollTrigger with Angular**: How to properly initialize GSAP ScrollTrigger in an Angular component lifecycle? What are the best practices for cleanup?
3. **Chat Component Decoupling**: What VS Code-specific dependencies exist in the chat library components? How can we create a "standalone mode" for static rendering?
4. **GitHub Pages SPA Routing**: What is the current best practice for Angular SPA deployment to GitHub Pages with hash-based routing in 2025?

**Why Research Needed**: Three.js and GSAP integration patterns in Angular vary significantly, and making wrong architectural choices early will cause refactoring. The chat component dependency audit is critical to avoid runtime errors in the standalone landing page context.

---

## 8. UI/UX Requirements

**UI/UX Design Needed**: YES (Partial)

**Visual Components Required**:

- **Hero Section Layout**: Visual mockup showing Three.js canvas placement, headline hierarchy, CTA positioning
- **Feature Card Design**: Specifications for "power-up" card styling within Anubis theme
- **Demo Section Frame**: How the chat demo is framed/bounded on the page

**User Experience Goals**:

- **Immediate Understanding**: Visitor understands Ptah's value in < 10 seconds
- **Engagement Flow**: Natural scroll journey from hero → demo → features → CTA
- **Trust Building**: Professional, polished aesthetic that signals quality software

**Accessibility Requirements**:

- WCAG 2.1 AA compliance (inherited from existing Anubis theme)
- Skip-to-content link
- Focus indicators for all interactive elements
- Alt text for Three.js canvas (describe the visual)

**Note**: UI/UX can be executed in parallel with or after research phase, as the existing Anubis design system provides most styling foundations. Focus on layout decisions and component arrangement rather than new visual design.

---

## 9. Dependencies & Integration Points

### External Dependencies

- **Three.js**: ^0.160.0 - 3D rendering library
- **GSAP**: ^3.12.0 - Animation library with ScrollTrigger plugin
- **DaisyUI**: ^4.x (already in project)
- **Tailwind CSS**: ^3.x (already in project)

### Internal Dependencies

- **`libs/frontend/chat`**: Chat components (ChatView, MessageBubble, ExecutionNode, etc.)
- **`libs/frontend/core`**: Core frontend utilities (VsCodeThemeService may need mocking)
- **`libs/shared`**: Type definitions (ExecutionNode, ChatMessage, etc.)
- **Anubis Theme**: Existing DaisyUI theme configuration in webview `tailwind.config.js`

### Third-Party Services

- **GitHub Pages**: Hosting platform
- **VS Code Marketplace**: CTA link target (no API integration needed)

---

## 10. Out of Scope

Explicitly list what is NOT included:

- **Backend/API Integration**: No real Claude CLI communication - demo uses static JSON data only
- **User Authentication**: No login, accounts, or personalization
- **Analytics Implementation**: No tracking scripts (can be added post-launch)
- **Blog/Documentation Section**: Landing page only, not a full docs site
- **Multi-language Support**: English only for initial release
- **A/B Testing Infrastructure**: Not included in initial scope
- **Marketplace Publishing**: This task creates the page; publishing workflow is separate
- **Custom Domain Configuration**: GitHub Pages default URL only

---

**REQUIREMENTS COMPLETE - AWAITING USER VALIDATION**
