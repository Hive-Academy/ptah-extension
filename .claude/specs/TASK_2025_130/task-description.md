# Requirements Document - TASK_2025_130

## Introduction

The Ptah Extension's webview UI currently suffers from a visual inconsistency between its two main areas: the **sidebar** (session list) and the **chat area** (message bubbles, input, stats). The chat area has received significant polish with well-structured DaisyUI components, thoughtful spacing, hover states, and visual hierarchy. In contrast, the sidebar uses basic DaisyUI `menu` classes with minimal customization, creating a jarring disconnect that undermines the overall product quality.

Additionally, the dark theme ("anubis") uses extremely dark base colors (`#0a0a0a`, `#1a1a1a`, `#2a2a2a`) that feel harsh and fatiguing during extended use. The user describes the theme as "too dark and annoying." The goal is to soften these colors to create a more refined, comfortable dark theme while preserving the Egyptian-inspired brand identity.

**Business Value**: A cohesive, polished UI increases perceived product quality, reduces visual fatigue, and creates a professional experience that matches the sophistication of the underlying Claude Code integration.

---

## Problem Statement

### Problem 1: Sidebar Visual Quality Gap

The sidebar (`app-shell.component.html`, lines 37-186) uses:

- Basic `bg-base-200` background with `border-r border-base-300` -- no depth or visual interest
- `menu menu-sm` DaisyUI class with minimal customization
- Session items are plain `<button>` elements with `text-xs` and `py-1.5 px-2` -- cramped and utilitarian
- Active state uses raw `bg-primary text-primary-content` -- flat, no gradient or subtle highlight
- Hover state relies on DaisyUI menu defaults -- no custom hover treatment
- Date formatting uses Angular `DatePipe` with `'M/d HH:mm'` -- functional but not user-friendly (no "Today", "Yesterday" relative formatting)
- Message count badge uses `badge badge-xs badge-ghost` -- barely visible
- Delete button appears with `opacity-0 group-hover:opacity-100` -- correct pattern but lacks polish
- "New Session" button uses `btn-primary btn-sm btn-square` -- disconnected from sidebar aesthetic
- Scrollbar uses global `::-webkit-scrollbar` styling -- no sidebar-specific refinement
- No section headers, no visual grouping of sessions by date
- No empty state illustration/icon beyond plain text "No sessions yet"

### Problem 2: Harsh Dark Theme

The current "anubis" theme in `tailwind.config.js` uses:

- `base-100: '#0a0a0a'` -- nearly pure black, creates eye strain
- `base-200: '#1a1a1a'` -- very dark charcoal, low contrast with base-100
- `base-300: '#2a2a2a'` -- still very dark, inadequate elevation differentiation
- `neutral: '#1a1a1a'` -- same as base-200, no distinction
- `base-content: '#f5f5dc'` -- high-contrast cream on near-black, harsh in extended use
- `primary: '#1e3a8a'` -- deep blue that gets lost on dark backgrounds
- `error: '#b22222'` -- dark red that lacks visibility on dark surfaces

The overall effect is a theme that is too dark, with insufficient contrast between surface levels and overly bright text on extremely dark backgrounds.

---

## Scope

### In Scope

1. **Sidebar Full Redesign** (app-shell.component.html + app-shell.component.ts)

   - Session list item styling (hover, active, open tab states)
   - Sidebar header with Ptah icon and new session button
   - Typography hierarchy (session name, metadata, timestamps)
   - Spacing and padding refinement
   - Custom scrollbar for sidebar area
   - "New Session" button redesign
   - Date formatting improvements (relative dates: "Today", "Yesterday", "Jan 15")
   - Empty state refinement
   - "Load More" button styling
   - Delete button hover styling
   - Session name popover styling

2. **Dark Theme Softening** (tailwind.config.js)

   - Soften base-100, base-200, base-300 colors
   - Adjust neutral and neutral-content colors
   - Refine base-content for comfortable contrast
   - Adjust primary color for better dark-background visibility
   - Adjust semantic colors (error, success, info) for dark-surface visibility
   - Update CSS custom properties in styles.css that reference hardcoded dark values

3. **Global CSS Adjustments** (styles.css)
   - Update hardcoded color references that use the old dark values
   - Ensure glass morphism effects work with softened theme
   - Ensure scrollbar styling is harmonious with new theme
   - Ensure sidebar-specific component overrides align with new aesthetic

### Out of Scope

- Chat area component redesign (already polished -- serves as reference)
- Light theme ("anubis-light") modifications
- Settings page redesign
- Welcome page redesign
- Setup wizard redesign
- New feature additions (search, sorting, filtering sessions)
- Backend changes to session data model
- Tab bar redesign
- Dashboard page changes
- Landing page changes
- Animation system changes (keyframes, GSAP)
- Font changes (Inter, JetBrains Mono, Cinzel remain)
- Icon library changes (Lucide remains)

---

## Requirements

### Requirement 1: Sidebar Session List Item Redesign

**User Story:** As a user viewing the session sidebar, I want each session item to have clear visual states (default, hover, active, open-in-tab) with proper typography hierarchy and spacing, so that I can quickly scan and navigate between sessions.

#### Acceptance Criteria

1. WHEN a session list item is in its **default state** THEN it SHALL display with:

   - Session name in `text-sm font-medium` (not `text-xs`) with proper truncation and `leading-snug`
   - Timestamp below session name in `text-xs opacity-50` with relative date formatting
   - Message count displayed as a subtle inline text (not a badge), e.g., "12 msgs"
   - Padding of `py-2.5 px-3` for comfortable touch targets
   - Rounded corners matching `--rounded-btn` (0.375rem)
   - Smooth transition on all interactive properties (`transition-all duration-200`)

2. WHEN a session list item is **hovered** THEN it SHALL display:

   - Background color shift to `bg-base-300/50` (subtle, not jarring)
   - No transform/scale effects (keep it professional)
   - Delete button fades in smoothly on the right side

3. WHEN a session list item is the **currently active session** THEN it SHALL display:

   - A left border accent (`border-l-2 border-primary`) instead of full `bg-primary` fill
   - Slightly elevated background (`bg-base-300/70`)
   - Session name in full opacity with primary color tint
   - No full primary background color (current approach is too aggressive)

4. WHEN a session list item has an **open tab** (but is not the active session) THEN it SHALL display:

   - A subtle left border (`border-l-2 border-primary/30`)
   - Normal background
   - Primary color tint on session name text

5. WHEN the session list is **empty** THEN it SHALL display:

   - A centered message "No sessions yet" with `text-sm text-base-content/40`
   - Padding of `p-6` for visual breathing room
   - Optional: a subtle icon above the text (e.g., message-square from Lucide)

6. WHEN session metadata is displayed THEN timestamps SHALL use relative formatting:
   - "Just now" for < 1 minute ago
   - "5m ago" for < 1 hour ago
   - "2h ago" for < 24 hours ago
   - "Yesterday" for previous day
   - "Mon", "Tue", etc. for current week
   - "Jan 15" for older dates within current year
   - "Jan 15, 2025" for previous years

### Requirement 2: Sidebar Header and New Session Button Redesign

**User Story:** As a user, I want the sidebar header to feel cohesive with the rest of the UI, with a refined "New Session" button that is inviting and clearly actionable, so that creating new sessions feels natural.

#### Acceptance Criteria

1. WHEN the sidebar header is displayed THEN it SHALL have:

   - Padding of `p-3` (increased from `p-2`)
   - The Ptah icon at `w-5 h-5` (slightly reduced from `w-6 h-6`)
   - A separator from the session list via `border-b border-base-content/10` (subtler than `border-base-300`)
   - Proper vertical alignment between icon and button

2. WHEN the "New Session" button is displayed THEN it SHALL be:

   - A `btn-ghost` style with a `+` icon (not `btn-primary btn-square`)
   - On hover: background shift to `bg-base-300/50` with primary-colored icon
   - Rounded with `rounded-lg`
   - Same height as sidebar font context (`btn-sm`)

3. WHEN the session name popover is open THEN it SHALL have:
   - A soft background matching the sidebar (`bg-base-200`)
   - Border of `border-base-content/10`
   - Shadow for elevation (`shadow-lg`)
   - Input field with `input-sm` matching sidebar scale
   - Action buttons with consistent sidebar styling

### Requirement 3: Sidebar Scrollbar and Container Styling

**User Story:** As a user scrolling through many sessions, I want the sidebar scrollbar and container to feel refined and unobtrusive, so that the sidebar feels like an integrated part of the application.

#### Acceptance Criteria

1. WHEN the sidebar container is displayed THEN it SHALL have:

   - Background of softened `bg-base-200` (matches new theme)
   - Right border of `border-r border-base-content/5` (nearly invisible, just enough separation)
   - Width of `w-56` (224px, increased from `w-52`/208px) for better readability
   - Smooth width transition when toggling (`transition-all duration-300`)

2. WHEN the session list scrollbar is visible THEN it SHALL display:

   - Width of 4px (thinner than global 8px)
   - Track: transparent
   - Thumb: `bg-base-content/15` with `rounded-full`
   - Thumb on hover: `bg-base-content/25`
   - Only visible on hover of the sidebar (CSS `:hover` on aside element)

3. WHEN the "Load More" button is displayed THEN it SHALL:
   - Use `btn-ghost btn-xs` with `text-base-content/50`
   - Include the remaining count in muted text
   - Have `mt-1` separation from the last session item
   - Show loading spinner centered when loading

### Requirement 4: Dark Theme Softening

**User Story:** As a user working in dark mode for extended periods, I want the dark theme to use softer, more comfortable colors with proper surface elevation hierarchy, so that the interface reduces eye strain while maintaining the Egyptian-inspired aesthetic.

#### Acceptance Criteria

1. WHEN the "anubis" dark theme is applied THEN base surface colors SHALL be softened:

   - `base-100` SHALL change from `#0a0a0a` to approximately `#131317` (soft dark with slight blue undertone)
   - `base-200` SHALL change from `#1a1a1a` to approximately `#1a1a20` (subtle elevation step)
   - `base-300` SHALL change from `#2a2a2a` to approximately `#242430` (clear elevation distinction)
   - Each level SHALL have visible but subtle differentiation (not identical-looking)

2. WHEN the dark theme is applied THEN neutral colors SHALL be adjusted:

   - `neutral` SHALL change from `#1a1a1a` to approximately `#1e1e26` (distinct from base-200)
   - `neutral-content` SHALL remain `#d1d5db` (already appropriate)

3. WHEN the dark theme is applied THEN text colors SHALL be softened:

   - `base-content` SHALL change from `#f5f5dc` (harsh cream) to approximately `#e8e6e1` (soft warm gray)
   - `primary-content` SHALL change from `#f5f5dc` to approximately `#e8e6e1`

4. WHEN the dark theme is applied THEN accent and semantic colors SHALL be adjusted for visibility:

   - `primary` SHALL change from `#1e3a8a` to approximately `#2563eb` (brighter blue, visible on dark surfaces)
   - `error` SHALL change from `#b22222` to approximately `#dc2626` (brighter red for visibility)
   - `success` SHALL change from `#228b22` to approximately `#16a34a` (brighter green)
   - `secondary` (gold) SHALL remain `#d4af37` (already has good contrast)
   - `accent` (gold) SHALL remain `#fbbf24` (already has good contrast)

5. WHEN the theme changes are applied THEN DaisyUI custom properties SHALL remain unchanged:

   - `--rounded-box`, `--rounded-btn`, `--rounded-badge` keep current values
   - `--animation-btn`, `--animation-input` keep current values
   - No changes to border-radius or animation timing

6. WHEN the theme softening is applied THEN all existing UI components SHALL maintain WCAG AA contrast ratios:
   - Body text on base-100: minimum 7:1 ratio
   - Interactive elements: minimum 3:1 ratio
   - Badge text: minimum 4.5:1 ratio

### Requirement 5: Global CSS Updates for Theme Consistency

**User Story:** As a developer maintaining the design system, I want all hardcoded color references in styles.css to align with the softened theme, so that the visual language is consistent and the glass morphism effects harmonize with the new colors.

#### Acceptance Criteria

1. WHEN hardcoded dark color values exist in styles.css THEN they SHALL be updated:

   - `rgba(10, 10, 10, ...)` references SHALL be updated to match new `base-100`
   - `rgba(42, 42, 42, ...)` in `--glass-panel` SHALL be updated to match new `base-300`
   - Hardcoded hex values (`#0a0a0a`, `#1a1a1a`, `#2a2a2a`) in CSS custom properties SHALL be updated

2. WHEN agent badge colors reference hardcoded values THEN:

   - `--agent-badge-text-light` SHALL update from `#f5f5dc` to match new `base-content`
   - `--agent-badge-text-dark` SHALL update from `#0a0a0a` to match new `base-100`
   - All agent badge background colors SHALL be validated for contrast against new surfaces

3. WHEN the `.text-papyrus` utility class references `#f5f5dc` THEN it SHALL be updated to match the new `base-content` value.

4. WHEN glass morphism custom properties are defined THEN they SHALL harmonize with softened colors:
   - `--glass-panel` SHALL use updated semi-transparent value
   - `--glass-border` SHALL remain gold-tinted (brand identity)
   - Backdrop blur values SHALL remain unchanged

---

## Non-Functional Requirements

### Performance Requirements

- **Render Time**: Sidebar session list with 50+ items SHALL render without visible jank (< 16ms per frame)
- **Scroll Performance**: Custom scrollbar SHALL not introduce scroll jank on the session list
- **Theme Switch**: Dark-to-light theme toggle SHALL apply within < 100ms (no flash of unstyled content)
- **Animation Budget**: All sidebar transitions SHALL use CSS transitions only (no JavaScript animation overhead)

### Accessibility Requirements

- **Keyboard Navigation**: All sidebar items SHALL be navigable via Tab key and activatable via Enter/Space
- **ARIA Labels**: Session delete buttons SHALL have descriptive `aria-label` attributes
- **Focus Indicators**: Focused session items SHALL show a visible focus ring (`outline-2 outline-offset-2`)
- **Screen Reader**: Session list SHALL use `role="list"` / `role="listitem"` semantics
- **Reduced Motion**: All transitions SHALL respect `prefers-reduced-motion: reduce`
- **Contrast**: All text/interactive elements SHALL meet WCAG AA contrast requirements (4.5:1 for text, 3:1 for UI components)

### Maintainability Requirements

- **No New CSS Files**: All styling SHALL use Tailwind utility classes, DaisyUI component classes, or additions to the existing `styles.css`
- **No Inline Styles**: No `style="..."` attributes in templates (exception: dynamic height for auto-resize textarea, which already exists)
- **Theme Tokens**: All colors SHALL reference DaisyUI theme tokens (`base-100`, `base-content`, `primary`, etc.) -- no hardcoded hex in templates
- **Component Isolation**: Sidebar styling changes SHALL not affect chat area or other views

---

## Affected Files

### Primary Files (Must Change)

| File                                                                       | Change Type | Description                                                              |
| -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `apps/ptah-extension-webview/tailwind.config.js`                           | Modify      | Soften anubis dark theme color tokens                                    |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` | Modify      | Redesign sidebar template (session list, header, states)                 |
| `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`   | Modify      | Add relative date formatting utility method, possible new icons          |
| `apps/ptah-extension-webview/src/styles.css`                               | Modify      | Update hardcoded color references, add sidebar-specific scrollbar styles |

### Secondary Files (May Need Adjustment)

| File                                                                                 | Change Type | Description                                           |
| ------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------- |
| `libs/frontend/chat/src/lib/components/molecules/chat-empty-state.component.ts`      | Review      | Ensure empty state works with softened theme          |
| `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`      | Review      | Verify chat bubble colors work with softened base-300 |
| `libs/frontend/chat/src/lib/components/molecules/session-stats-summary.component.ts` | Review      | Verify stat badges contrast with softened theme       |
| `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`            | Review      | Verify input area styling with softened theme         |

### Files That Should NOT Change

- Any backend library files (`libs/backend/*`)
- Shared types (`libs/shared/*`)
- Light theme configuration (anubis-light in tailwind.config.js)
- Landing page configuration (`apps/ptah-landing-page/*`)
- VS Code extension host files (`apps/ptah-extension-vscode/*`)
- Animation keyframes in styles.css (keep existing animation system)

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder                       | Impact Level | Involvement                      | Success Criteria                                                                                 |
| --------------------------------- | ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| End Users (developers using Ptah) | High         | Visual feedback, comfort testing | Sidebar feels polished and cohesive with chat area; theme is comfortable for multi-hour sessions |
| Product Owner                     | High         | Aesthetic approval               | UI quality matches the sophistication of the Claude Code integration                             |
| Frontend Developers               | Medium       | Implementation and maintenance   | Clean, maintainable Tailwind/DaisyUI patterns; no CSS hacks                                      |

### Secondary Stakeholders

| Stakeholder         | Impact Level | Involvement                      | Success Criteria                                 |
| ------------------- | ------------ | -------------------------------- | ------------------------------------------------ |
| Accessibility Users | Medium       | Contrast and keyboard navigation | WCAG AA compliance maintained                    |
| Theme System        | Low          | Token consistency                | All components properly reference DaisyUI tokens |

---

## Risk Assessment

| Risk                                                                                  | Probability | Impact | Score | Mitigation Strategy                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme color changes break contrast in existing components                             | Medium      | High   | 6     | Test all existing components (chat bubbles, badges, buttons, inputs) against new colors before finalizing; use browser DevTools contrast checker |
| Sidebar width increase (w-52 to w-56) causes layout issues on narrow VS Code sidebars | Low         | Medium | 3     | Test at minimum VS Code sidebar width (200px); sidebar is already collapsible so width only matters when open                                    |
| Relative date formatting introduces edge cases (timezones, locale)                    | Low         | Low    | 2     | Use simple relative formatting based on Date.now() delta; no timezone conversion needed since all times are local                                |
| Glass morphism effects look wrong with softened colors                                | Medium      | Medium | 4     | Test glass-panel overlay on softened base-100/200/300; adjust opacity values if needed                                                           |
| Hardcoded hex values exist in places not discovered during investigation              | Low         | Medium | 3     | Run grep for `#0a0a0a`, `#1a1a1a`, `#2a2a2a`, `#f5f5dc` across entire codebase before marking complete                                           |
| Light theme (anubis-light) affected by shared CSS changes                             | Low         | High   | 4     | All CSS changes must be scoped to dark theme or verified neutral; light theme fixes in styles.css are in `[data-theme='anubis-light']` block     |

---

## Implementation Guidance

### Recommended Approach

1. **Phase 1: Theme Softening** (tailwind.config.js + styles.css)

   - Update the anubis theme color tokens first
   - Update hardcoded color references in styles.css
   - Verify existing components (chat area, settings, etc.) still look correct
   - This provides the foundation for sidebar work

2. **Phase 2: Sidebar Redesign** (app-shell.component.html + app-shell.component.ts)

   - Redesign session list items with new visual states
   - Update sidebar container, header, and scrollbar
   - Add relative date formatting
   - Polish new session popover
   - Polish empty state and load-more button

3. **Phase 3: Validation**
   - Test dark theme across all views (chat, settings, sidebar)
   - Test at different VS Code sidebar widths
   - Validate WCAG AA contrast ratios
   - Test theme toggle (dark-to-light and back)

### Design Reference: Chat Area Quality Level

The chat area demonstrates the target quality level with:

- `chat-bubble bg-base-300 text-base-content shadow-card` -- proper elevation and shadow
- `chat-header text-xs text-base-content/70` -- muted secondary text
- `group-hover:opacity-100 transition-opacity duration-200` -- smooth hover reveals
- `flex gap-1.5 items-center` -- consistent spacing with alignment
- `badge badge-sm bg-base-200/80 text-base-content/70` -- refined badge styling
- Consistent use of DaisyUI semantic color tokens
- OnPush change detection for performance

The sidebar should match this level of polish.

### Color Direction Guidance

The "Faros" reference from the user indicates a desire for a softer, more sophisticated dark theme. The recommended direction uses slightly blue-tinted dark grays (instead of pure neutral grays) to create depth and reduce the "flat black" feeling:

- Base surfaces: Dark charcoal with subtle cool undertones (#131317, #1a1a20, #242430)
- Text: Warm off-white instead of cream (#e8e6e1 instead of #f5f5dc)
- Primary: Brighter blue for better dark-surface visibility (#2563eb instead of #1e3a8a)
- Gold accent: Unchanged -- serves as the Egyptian brand anchor

The exact hex values in this document are recommendations. The implementer should fine-tune values based on visual testing and contrast ratio validation.

---

## Success Metrics

1. **Visual Cohesion**: The sidebar and chat area should feel like they belong to the same application -- no jarring quality gap
2. **Theme Comfort**: Extended use (1+ hour) in dark mode should not cause eye strain
3. **Surface Hierarchy**: Three distinct surface levels (base-100, base-200, base-300) should be visually distinguishable
4. **Interaction Quality**: Hover, active, and focus states should feel smooth and intentional
5. **Zero Regression**: No existing component should look worse or lose contrast after theme changes

---

## Quality Gates

- [ ] All requirements follow SMART criteria
- [ ] Acceptance criteria specify measurable outcomes
- [ ] Stakeholder analysis complete
- [ ] Risk assessment with mitigation strategies defined
- [ ] Affected files identified with change types
- [ ] Scope boundaries clearly defined (in/out)
- [ ] Non-functional requirements (performance, accessibility, maintainability) specified
- [ ] Implementation phasing recommended
- [ ] Design reference (target quality level) documented
- [ ] Color direction with specific token recommendations provided
