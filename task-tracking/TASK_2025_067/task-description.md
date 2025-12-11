# Requirements Document - TASK_2025_067

## Introduction

This task represents a strategic UI/UX enhancement to improve the visual hierarchy and user experience of the Ptah extension's sidebar header. The redesign focuses on better branding, cleaner interface, and improved navigation by consolidating similar UI elements while reducing visual clutter.

**Business Value**: Enhanced brand presence, improved UX with icon-based interactions, and more intuitive session/tab management lead to better user engagement and clearer information architecture.

## Task Classification

- **Type**: FEATURE
- **Priority**: P2-Medium
- **Complexity**: Medium
- **Estimated Effort**: 4-6 hours

## Workflow Dependencies

- **Research Needed**: No (straightforward UI restructuring)
- **UI/UX Design Needed**: Yes (layout changes, icon placement, visual hierarchy)

## Requirements

### Requirement 1: Ptah Icon Display in Sidebar

**User Story**: As a user viewing the sidebar, I want to see the Ptah branding icon, so that I have a clear visual identity of the application and can distinguish the tool at a glance.

#### Acceptance Criteria

1. WHEN the sidebar is open THEN the Ptah icon SHALL be displayed in the sidebar header section
2. WHEN retrieving the icon THEN the system SHALL use `vscodeService.getPtahIconUri()` method which returns the icon from config or falls back to `assets/ptah-icon.svg`
3. WHEN the icon is displayed THEN it SHALL have appropriate sizing (recommend 20x20 or 24x24 pixels) and positioning for visual balance

### Requirement 2: New Session Button Icon Conversion

**User Story**: As a user who frequently creates new sessions, I want a streamlined icon-only button instead of text, so that I have a cleaner interface and faster visual recognition of the action.

#### Acceptance Criteria

1. WHEN viewing the sidebar header THEN the "New Session" button SHALL be replaced with an icon-only button using the Lucide Plus icon
2. WHEN the button is converted THEN it SHALL maintain the same functionality (calling `createNewSession()` method)
3. WHEN hovering over the icon button THEN a tooltip SHALL display "New Session" or appropriate accessibility text
4. WHEN the button is rendered THEN it SHALL use consistent DaisyUI button styling matching existing UI patterns

### Requirement 3: Tab Repositioning to Header

**User Story**: As a user navigating multiple sessions, I want the session tabs located in the main header near the sidebar toggle, so that I have tab controls in a conventional location and reduce duplicate navigation elements.

#### Acceptance Criteria

1. WHEN viewing the main content header (navbar) THEN the tab-bar component SHALL be positioned after the sidebar toggle button and before/in place of the "Ptah" text
2. WHEN tabs are relocated THEN the tab-bar SHALL maintain full functionality including tab selection, tab closing, and new tab creation
3. WHEN tabs are displayed in header THEN they SHALL use appropriate styling for horizontal layout with adequate spacing
4. WHEN tabs overflow THEN horizontal scrolling SHALL be maintained as per current `tab-bar.component` implementation

### Requirement 4: "Ptah" Text Removal

**User Story**: As a user viewing the interface, I want the redundant "Ptah" text label removed from the header, so that the UI is cleaner and the Ptah branding is represented by the icon instead.

#### Acceptance Criteria

1. WHEN the header is displayed THEN the "Ptah" text (currently in `.flex-1` div at line 113-115 of `app-shell.component.html`) SHALL be completely removed
2. WHEN the text is removed THEN the layout SHALL adjust to fill the space appropriately with tabs or other header elements
3. WHEN Ptah branding is needed THEN it SHALL be represented exclusively by the Ptah icon in the sidebar header

## Non-Functional Requirements

### Performance

- **Response Time**: Icon loading \u003c100ms, layout reflow \u003c50ms
- **Throughput**: No impact on existing session/tab switching performance
- **Resource Usage**: No additional memory overhead beyond icon asset loading

### Accessibility

- **ARIA Labels**: All icon-only buttons must include proper `aria-label` attributes
- **Keyboard Navigation**: All interactive elements must be keyboard accessible (tab order preserved)
- **Screen Readers**: Icon buttons must have descriptive text for screen readers
- **Focus Indicators**: Visual focus indicators must be maintained for all interactive elements

### Visual Design

- **Consistency**: All styling must follow existing DaisyUI theme and component patterns
- **Responsive Layout**: Layout must adapt to sidebar open/closed states
- **Icon Sizing**: Icons must maintain consistent sizing (recommend 16-20px for action buttons, 20-24px for branding)
- **Spacing**: Adequate padding/margins between header elements (minimum 0.5rem/8px)

### Scalability

- **Tab Overflow**: Tab-bar must handle unlimited tabs with horizontal scrolling
- **Icon Assets**: Ptah icon must support theme variations (light/dark modes)

### Reliability

- **Fallback**: If `getPtahIconUri()` fails, system should degrade gracefully
- **State Preservation**: Tab states must be preserved during header restructuring
- **Error Handling**: Missing icons should not break layout

## Stakeholder Analysis

- **End Users**: Developers using Ptah for AI-assisted coding - need clean, efficient UI
- **Business Owners**: Improved branding and UX lead to better user retention
- **Development Team**: Straightforward UI refactoring with minimal complexity

## Risk Analysis

### Technical Risks

**Risk 1**: Layout breaking due to tab repositioning

- **Probability**: Low
- **Impact**: Medium
- **Mitigation**: Thorough testing of sidebar open/closed states, tab overflow scenarios
- **Contingency**: Revert to current layout if CSS flexbox issues arise

**Risk 2**: Icon not loading or displaying incorrectly

- **Probability**: Low
- **Impact**: Low
- **Mitigation**: Verify `getPtahIconUri()` returns valid SVG path, test in both themes
- **Contingency**: Use hardcoded fallback path to `assets/ptah-icon.svg`

**Risk 3**: Accessibility regression from text to icon conversion

- **Probability**: Medium
- **Impact**: Medium
- **Mitigation**: Comprehensive ARIA labeling, screen reader testing
- **Contingency**: Add text labels back if accessibility issues cannot be resolved

## Dependencies

### Technical

- **Libraries**: lucide-angular (already in use), DaisyUI (already in use)
- **Services**: `VSCodeService.getPtahIconUri()`, `TabManagerService`, `ChatStore`
- **Components**: `app-shell.component`, `tab-bar.component`

### Team

- None (isolated frontend UI change)

### External

- None

## Success Metrics

- **Visual Hierarchy**: Ptah icon visible in sidebar when open (100% of users)
- **Icon Usability**: New session icon button maintains same click rate as text button
- **Tab Accessibility**: Tab navigation from header location maintains same usage patterns
- **Code Quality**: No accessibility violations reported by automated testing
- **Performance**: No measurable impact on rendering performance (\u003c5ms variance)

## Implementation Files

**Files to Modify**:

1. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` - Sidebar header icon, header tab placement, "Ptah" text removal
2. `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` - Import icon assets if needed
3. `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts` - Potential styling adjustments for header placement

**Files to Investigate** (UI/UX Design Phase):

- Visual mockups showing icon placement
- Tab-bar positioning in header
- Responsive behavior documentation
