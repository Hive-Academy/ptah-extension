# Requirements Document - TASK_2025_126

## Introduction

**Embedded Welcome Page for Unlicensed Users**

This document defines requirements for replacing the VS Code modal popup with an embedded welcome page inside the extension webview for users without a valid license. The current behavior shows a blocking `vscode.window.showWarningMessage()` modal that prevents users from seeing the extension's UI at all. The new behavior displays a visually appealing, branded welcome page within the webview that provides a better onboarding experience while maintaining the license gate.

**Business Value**: Improved user onboarding experience transforms a blocking modal (high friction) into an engaging first-touch experience (low friction). Users can see the extension's quality UI immediately, creating positive brand impression before purchase.

**Technical Context**:
- Current flow: `main.ts` shows VS Code modal -> Extension blocked -> Webview never shown
- Target flow: Extension activates -> Webview shown with `initialView: 'welcome'` -> License actions embedded in welcome page
- Architecture: Signal-based navigation via `AppStateManager.setCurrentView()`, NO Angular Router (blocked in VS Code webviews)

---

## Requirements

### Requirement 1: Add 'welcome' ViewType to Navigation System

**User Story:** As a frontend application, I want a 'welcome' view type registered in the navigation system, so that the app shell can render the welcome page when users don't have a valid license.

#### Acceptance Criteria

1. WHEN the application loads with no valid license THEN `ViewType` union type SHALL include `'welcome'` as a valid option alongside existing views (`'chat'`, `'command-builder'`, `'analytics'`, `'context-tree'`, `'settings'`, `'setup-wizard'`).

2. WHEN `window.initialView` is set to `'welcome'` by the extension backend THEN `AppStateManager.initializeState()` SHALL recognize and set `'welcome'` as the current view.

3. WHEN navigating to `'welcome'` view THEN `WebviewNavigationService.navigateToView('welcome')` SHALL return `true` and update state correctly.

4. WHEN the `VALID_VIEWS` array in `WebviewHtmlGenerator._getHtmlForWebview()` is evaluated THEN it SHALL include `'welcome'` to allow backend-initiated navigation to welcome view.

---

### Requirement 2: Create WelcomeComponent with Ptah Branding

**User Story:** As an unlicensed user, I want to see a visually appealing welcome page with Ptah branding, so that I get a positive first impression of the extension before purchasing.

#### Acceptance Criteria

1. WHEN the welcome view renders THEN the component SHALL display the Ptah logo/icon prominently using the `ptahIconUri` webview resource.

2. WHEN the welcome view renders THEN the component SHALL display a welcoming headline (e.g., "Welcome to Ptah") with professional typography using DaisyUI hero classes.

3. WHEN the welcome view renders THEN the component SHALL display a brief description of Ptah's value proposition highlighting key features.

4. WHEN the welcome view renders THEN the component SHALL display feature highlights/benefits in a scannable card or list format (at least 4 key features).

5. WHEN the view is displayed on any VS Code theme (dark, light, high-contrast) THEN the branding elements SHALL maintain visual consistency using DaisyUI theme variables.

6. WHEN the welcome view renders THEN the component SHALL be a full-page standalone layout (no sidebar, no tabs) matching the pattern of `setup-wizard` and `settings` views in `app-shell.component.html`.

---

### Requirement 3: License Key Entry Action

**User Story:** As an unlicensed user with an existing license key, I want to enter my license key directly from the welcome page, so that I can activate the extension without navigating away.

#### Acceptance Criteria

1. WHEN the user clicks "Enter License Key" button THEN the component SHALL trigger the `ptah.enterLicenseKey` VS Code command via RPC.

2. WHEN the license key entry command is triggered THEN the standard VS Code password input box (from `LicenseCommands.enterLicenseKey()`) SHALL appear with format validation.

3. WHEN the user successfully enters a valid license key THEN VS Code SHALL prompt to reload the window (existing behavior preserved).

4. WHEN the license key entry fails validation THEN the user SHALL see an error message from VS Code's native modal (existing behavior preserved).

5. WHEN the "Enter License Key" action button renders THEN it SHALL have a primary button style (DaisyUI `btn btn-primary`) to indicate the preferred action for returning users.

---

### Requirement 4: View Pricing Action

**User Story:** As an unlicensed user exploring Ptah, I want to view pricing information, so that I can evaluate subscription options.

#### Acceptance Criteria

1. WHEN the user clicks "View Pricing" button THEN the component SHALL open `https://ptah.dev/pricing` in the user's default external browser via `vscode.env.openExternal()`.

2. WHEN the View Pricing action is triggered THEN the webview SHALL remain visible (browser opens separately).

3. WHEN the "View Pricing" button renders THEN it SHALL have a secondary/outline button style (DaisyUI `btn btn-outline`) to indicate supplementary action.

---

### Requirement 5: Start Trial Action

**User Story:** As a new user evaluating Ptah, I want to start a free trial directly from the welcome page, so that I can experience the extension before committing to a subscription.

#### Acceptance Criteria

1. WHEN the user clicks "Start Trial" button THEN the component SHALL open `https://ptah.dev/pricing` in the external browser (matching existing Start Trial behavior from modal).

2. WHEN the "Start Trial" button renders THEN it SHALL have a prominent style (DaisyUI `btn btn-secondary btn-lg` or similar) with clear trial messaging.

3. WHEN the trial badge/text renders THEN it SHALL clearly communicate "14-day free trial" messaging consistent with existing modal text.

---

### Requirement 6: Context-Aware Welcome Messages

**User Story:** As a returning user whose license expired, I want to see contextually appropriate messaging, so that I understand why I'm seeing the welcome page.

#### Acceptance Criteria

1. WHEN the license status reason is `'expired'` THEN the welcome page header message SHALL indicate subscription expiration (e.g., "Your subscription has expired").

2. WHEN the license status reason is `'trial_ended'` THEN the welcome page header message SHALL indicate trial expiration (e.g., "Your trial has ended").

3. WHEN the license status reason is `'no_license'` or undefined THEN the welcome page header message SHALL show the default welcome message for new users.

4. WHEN the welcome component initializes THEN it SHALL call the `license:getStatus` RPC method to retrieve license status including the `reason` field.

---

### Requirement 7: Backend License Flow Modification

**User Story:** As the extension host, I want to show the webview with welcome view instead of blocking with a modal, so that users have a better onboarding experience.

#### Acceptance Criteria

1. WHEN `main.ts` detects an invalid license in `handleLicenseBlocking()` THEN the function SHALL initialize the webview with `initialView: 'welcome'` instead of calling `showLicenseRequiredUI()`.

2. WHEN the webview is shown for unlicensed users THEN minimal DI setup SHALL remain (license-only commands registered as currently implemented).

3. WHEN the webview initializes for unlicensed users THEN the `workspaceInfo` SHALL still be provided if available (for future context if user activates license).

4. WHEN the extension activates with invalid license THEN it SHALL NOT call the blocking `vscode.window.showWarningMessage()` modal.

5. WHEN the extension activates with invalid license THEN it SHALL still register the `ptah.enterLicenseKey`, `ptah.checkLicenseStatus`, and `ptah.openPricing` commands.

---

### Requirement 8: Post-Activation Navigation

**User Story:** As a user who just activated their license, I want to be transitioned to the main chat view, so that I can start using the extension immediately.

#### Acceptance Criteria

1. WHEN the user successfully enters a license key from the welcome page THEN VS Code's existing "Reload Window" prompt SHALL appear (no change to existing flow).

2. WHEN the window reloads with a valid license THEN the extension SHALL initialize normally and show `initialView: 'chat'` (default view).

3. WHEN the user dismisses the welcome page without activating (via any future close mechanism) THEN the extension SHALL remain in welcome view state (blocking access to other views).

---

### Requirement 9: App Shell Integration

**User Story:** As the app shell component, I want to render the welcome view in standalone mode, so that the welcome page has a clean, focused layout.

#### Acceptance Criteria

1. WHEN `currentView()` signal equals `'welcome'` THEN `app-shell.component.html` SHALL render the welcome component in a full-width, full-height container.

2. WHEN `currentView()` equals `'welcome'` THEN the sidebar and header tab bar SHALL NOT render (matching setup-wizard and settings pattern).

3. WHEN the welcome view is active THEN all navigation to other views (`'chat'`, `'analytics'`, etc.) SHALL be blocked (no escape hatch without license).

---

## Non-Functional Requirements

### Performance Requirements

- **Component Load Time**: Welcome component SHALL render within 100ms of webview initialization
- **Bundle Size**: Welcome component and assets SHALL add less than 15KB to the webview bundle
- **Memory Usage**: Welcome view SHALL use less than 10MB additional memory compared to blocked state

### Security Requirements

- **No License Bypass**: Users SHALL NOT be able to navigate away from welcome view to access extension features without a valid license
- **Credential Security**: License key entry continues to use VS Code's password input (not exposed in webview)
- **External Links**: All external URLs SHALL use `vscode.env.openExternal()` for proper security context

### Accessibility Requirements

- **Screen Reader Support**: All buttons and actions SHALL have appropriate `aria-label` attributes
- **Keyboard Navigation**: All interactive elements SHALL be focusable and operable via keyboard
- **Color Contrast**: Text and interactive elements SHALL meet WCAG 2.1 AA contrast requirements using DaisyUI theme variables
- **Focus Management**: Initial focus SHALL be set to primary action button when welcome view loads

### Scalability Requirements

- **Localization Ready**: All user-facing strings SHALL be extractable for future internationalization
- **Theme Support**: Component SHALL render correctly in VS Code's dark, light, and high-contrast themes

### Reliability Requirements

- **Error Handling**: RPC call failures (license status check) SHALL display appropriate error state with retry option
- **Graceful Degradation**: If branding assets fail to load, component SHALL still render functional buttons

---

## Integration Points

### Backend Integration

| Integration Point | File | Description |
|-------------------|------|-------------|
| License Check Flow | `apps/ptah-extension-vscode/src/main.ts` | Modify `handleLicenseBlocking()` to show webview instead of modal |
| Webview Generator | `apps/ptah-extension-vscode/src/services/webview-html-generator.ts` | Add `'welcome'` to `VALID_VIEWS` array |
| License Commands | `apps/ptah-extension-vscode/src/commands/license-commands.ts` | No changes needed - reuse existing commands |
| License RPC | `apps/ptah-extension-vscode/src/services/rpc/handlers/license-rpc.handlers.ts` | No changes needed - reuse `license:getStatus` |

### Frontend Integration

| Integration Point | File | Description |
|-------------------|------|-------------|
| ViewType Definition | `libs/frontend/core/src/lib/services/app-state.service.ts` | Add `'welcome'` to ViewType union |
| App Shell | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` | Add `@case ('welcome')` block |
| Welcome Component | `libs/frontend/chat/src/lib/components/templates/welcome.component.ts` | NEW: Create welcome page component |
| RPC Service | `libs/frontend/core/src/lib/services/claude-rpc.service.ts` | No changes - reuse existing RPC call mechanism |

### Shared Types

| Integration Point | File | Description |
|-------------------|------|-------------|
| RPC Types | `libs/shared/src/lib/types/rpc.types.ts` | Consider adding `license:enterKey` RPC type if needed (optional - current approach uses VS Code commands) |

---

## Open Questions

### Design Questions

1. **Feature Highlights**: What specific features should be highlighted on the welcome page? Suggested:
   - AI-powered code assistance
   - Multi-agent orchestration
   - VS Code native integration
   - Session history and continuity

2. **Pricing Plan Preview**: Should the welcome page show a brief comparison of Basic vs Pro tiers, or just link to pricing page?

3. **Close Button**: Should there be a close/dismiss button on the welcome page, and what happens if clicked? (Recommendation: No close button - welcome view is the only accessible view for unlicensed users)

### Technical Questions

1. **Library Placement**: Should `WelcomeComponent` live in `@ptah-extension/chat` (alongside app-shell) or in a new `@ptah-extension/onboarding` library? (Recommendation: `@ptah-extension/chat` for simplicity since it's the only component)

2. **License Status Reason**: The current `LicenseGetStatusResponse` type doesn't expose the `reason` field from backend `LicenseStatus`. Should we extend the RPC response to include this? (Recommendation: Yes, add `reason?: string` to response type)

3. **PtahExtension Integration**: The `PtahExtension` class is only instantiated for licensed users. Should we create a minimal webview provider for unlicensed users, or modify the existing flow? (Recommendation: Create minimal webview provider in `handleLicenseBlocking()`)

---

## Dependencies

### Blocking Dependencies

- None - all required infrastructure exists

### Technical Dependencies

| Dependency | Status | Description |
|------------|--------|-------------|
| ViewType system | Exists | `AppStateManager` with signal-based navigation |
| App Shell routing | Exists | `@switch (currentView())` pattern in app-shell |
| License RPC | Exists | `license:getStatus` method returns license info |
| VS Code Commands | Exists | `ptah.enterLicenseKey`, `ptah.openPricing` commands |
| DaisyUI/Tailwind | Exists | Styling framework for component |
| Webview HTML Generator | Exists | `initialView` option support |

---

## Acceptance Criteria Summary

### Minimum Viable Implementation

- [ ] `'welcome'` added to ViewType union in `app-state.service.ts`
- [ ] `'welcome'` added to `VALID_VIEWS` in `webview-html-generator.ts`
- [ ] `WelcomeComponent` created with branding and three action buttons
- [ ] App shell renders welcome component for `'welcome'` view
- [ ] `handleLicenseBlocking()` shows webview instead of modal
- [ ] "Enter License Key" triggers VS Code command
- [ ] "View Pricing" opens external URL
- [ ] "Start Trial" opens external URL

### Complete Implementation

- [ ] Context-aware messaging based on license reason
- [ ] Feature highlights section
- [ ] Proper accessibility attributes
- [ ] Theme support validation (dark/light/high-contrast)
- [ ] Error handling for RPC failures
- [ ] Integration tests for navigation blocking

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-27 | Project Manager | Initial requirements document |
