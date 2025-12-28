# Task Description - TASK_2025_038

## SMART Requirements

**Created**: 2025-12-02
**Product Manager**: product-manager
**Status**: AWAITING USER VALIDATION

## 1. Task Overview

### Task Type

FEATURE

### Complexity Assessment

COMPLEX

**Reasoning**: This task involves creating a new Angular application within an existing Nx monorepo, integrating advanced graphics libraries (Three.js, GSAP), reusing complex internal components (chat library) in a new context, and deploying to a public host (GitHub Pages). The visual requirements ("Egyptian styles power ups", "slick ui") add significant design complexity.

### Timeline Estimate

**Initial Estimate**: 5-7 days
**Timeline Discipline**: Compliant (< 2 weeks)

---

## 2. Business Requirements

### Primary Objective

Create a high-impact landing page that effectively markets "Claude Code" as a powerful tool and "Ptah Extension" as its essential "Egyptian-styled power-up" for VS Code. The page must demonstrate technical capability through a live, interactive chat demo using real session data.

### User Stories

**As a** Potential User (Developer)
**I want** to see a live demonstration of the Ptah extension's chat interface
**So that** I can understand the UX quality and "power-up" features without installing it first.

**As a** Product Owner
**I want** to highlight `workspace-intelligence` and `vscode-lm-tools` features
**So that** users understand the technical depth and unique value proposition of the extension.

**As a** Marketing Team Member
**I want** a visually stunning, Egyptian-themed landing page with 3D elements and smooth animations
**So that** the brand identity is reinforced and the product feels premium and modern.

### Success Metrics

- **Performance**: Lighthouse Performance score > 90.
- **Engagement**: Users spend > 30 seconds interacting with the Live Demo.
- **Visual Fidelity**: Three.js background and GSAP animations run smoothly (60fps) on average devices.
- **Deployment**: Successfully accessible via GitHub Pages URL.

---

## 3. Functional Requirements (SMART Format)

### FR1: Landing Page Application Structure

**Specific**: Create a new Nx Angular application `apps/ptah-landing` configured for GitHub Pages deployment.
**Measurable**: Application builds successfully with `nx build` and deploys to `gh-pages`.
**Achievable**: Standard Nx and Angular CLI capabilities.
**Relevant**: Foundation for the entire task.
**Time-bound**: Day 1.

### FR2: Hero Section with Three.js & GSAP

**Specific**: Implement a Hero section featuring an Egyptian-themed 3D background (Three.js) and GSAP entrance animations for the title and CTA.
**Measurable**: 3D canvas renders without errors; animations trigger on load.
**Achievable**: Using `ngx-three` or native Three.js with GSAP Angular integration.
**Relevant**: "Show off" factor requested by user.
**Time-bound**: Day 2-3.

### FR3: Live Chat Demo Integration

**Specific**: Integrate the existing shared Angular chat components to render a read-only or interactive simulation.
**Measurable**: Chat UI renders correctly within the landing page.
**Achievable**: Reusing `libs/frontend/chat` (requires checking dependencies).
**Relevant**: Core value proposition demonstration.
**Time-bound**: Day 3-4.

### FR4: Session Data Simulation

**Specific**: Load and parse local JSONL files (from `test-sessions-anubis`) to populate the Live Chat Demo.
**Measurable**: Chat window displays messages from the provided JSONL files with correct formatting.
**Achievable**: Client-side JSONL parsing logic.
**Relevant**: "Saving a local json file like #file:test-sessions-anubis" requirement.
**Time-bound**: Day 4.

### FR5: Feature Showcase Section

**Specific**: Dedicated sections explaining `workspace-intelligence` and `vscode-lm-tools` with "Egyptian power-up" styling (DaisyUI).
**Measurable**: Content is present and styled according to the theme.
**Achievable**: Standard HTML/CSS/DaisyUI.
**Relevant**: Specific user request to highlight these features.
**Time-bound**: Day 5.

---

## 4. Non-Functional Requirements

### Performance

- **First Contentful Paint**: < 1.5s.
- **Bundle Size**: Optimized lazy loading for Three.js assets.

### Usability

- **Responsiveness**: Fully functional on Mobile, Tablet, and Desktop.
- **Accessibility**: WCAG 2.1 AA compliance (especially contrast on themed elements).

### Compatibility

- **Browsers**: Chrome, Firefox, Safari, Edge (latest 2 versions).

---

## 5. Acceptance Criteria (BDD Format)

### Scenario 1: Hero Section Loading

**Given** a user visits the landing page URL
**When** the page loads
**Then** the Egyptian-themed 3D background shall render
**And** the title and CTA shall animate in using GSAP
**And** no console errors shall appear

### Scenario 2: Live Demo Interaction

**Given** the Live Demo section is visible
**When** the user selects a sample session (e.g., "Anubis Test")
**Then** the Chat Component shall load the corresponding JSONL data
**And** the conversation history shall be displayed with correct styling (user vs agent bubbles)
**And** code blocks within messages shall be syntax highlighted

### Scenario 3: Feature Highlights

**Given** the user scrolls to the Features section
**When** the `workspace-intelligence` card comes into view
**Then** it shall display the feature description
**And** it shall use the defined "Egyptian power-up" visual style (DaisyUI theme)

---

## 6. Risk Assessment

### Technical Risks

| Risk                     | Probability | Impact | Mitigation                                                                                                                                                                  |
| :----------------------- | :---------- | :----- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component Reuse**      | HIGH        | HIGH   | Existing chat components might be tightly coupled to VS Code APIs. **Mitigation**: Research phase must verify decoupling or create a "web-compatible" wrapper/mock service. |
| **Three.js Performance** | MEDIUM      | MEDIUM | 3D on mobile can be heavy. **Mitigation**: Use lightweight models/shaders and implement performance toggles or fallbacks.                                                   |
| **JSONL Parsing**        | LOW         | LOW    | Browser handling of NDJSON. **Mitigation**: Simple utility function to split by newline and parse JSON.                                                                     |

### Business Risks

| Risk                    | Probability | Impact | Mitigation                                                                                                                                |
| :---------------------- | :---------- | :----- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Design Subjectivity** | HIGH        | MEDIUM | "Slick UI" and "Egyptian style" are subjective. **Mitigation**: UI/UX Phase (Phase 3) to produce visual specs for approval before coding. |

---

## 7. Research Recommendations

**Technical Research Needed**: YES

**Research Questions**:

1. **Component Decoupling**: Can `libs/frontend/chat` be used outside the VS Code webview context? What services need mocking (e.g., `vscode-api`)?
2. **Three.js Integration**: What is the best approach for Angular 18+ (ngx-three vs native)?
3. **Asset Management**: How to handle 3D assets and JSONL files in the Nx build process for GitHub Pages?
4. **DaisyUI Theme**: How to configure a custom "Egyptian" theme in DaisyUI/Tailwind for the new app?

**Why Research Needed**: The reuse of internal extension components in a standard web app is the biggest technical unknown.

---

## 8. UI/UX Requirements

**UI/UX Design Needed**: YES

**Visual Components Required**:

- **Hero 3D Scene**: Concept for the Egyptian background.
- **Chat Container**: Web-specific wrapper for the chat component.
- **Feature Cards**: Styled cards for `workspace-intelligence` etc.

**User Experience Goals**:

- "Wow" factor on entry.
- Seamless transition between marketing content and the technical demo.

---

## 9. Dependencies & Integration Points

### Internal Dependencies

- `libs/frontend/chat`: The core chat UI library.
- `libs/shared/ui`: Shared UI components (if applicable).
- `test-sessions-anubis`: Source data.

### External Dependencies

- `three`: 3D library.
- `gsap`: Animation library.
- `daisyui`: UI component library.

---

## 10. Out of Scope

- Backend integration (Real-time chat with an LLM).
- User authentication.
- VS Code extension functionality (this is a marketing page only).

---

**REQUIREMENTS COMPLETE - AWAITING USER VALIDATION**
