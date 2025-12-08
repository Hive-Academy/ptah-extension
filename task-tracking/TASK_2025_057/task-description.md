# Requirements Document - TASK_2025_057

## Introduction

The Ptah extension currently suffers from a critical authentication initialization race condition that prevents the Claude Agent SDK from functioning. The extension activates and registers services without initializing authentication, resulting in silent failures when users attempt to interact with Claude. Additionally, users lack a user-friendly interface to configure authentication settings, forcing them to navigate VS Code's buried settings UI.

This task addresses both issues through a dual-track parallel development approach: fixing backend SDK initialization and building a frontend Settings UI component. The solution will provide reliable authentication initialization, automatic configuration watching, and an intuitive settings interface with real-time feedback.

**Business Value**: Users can successfully authenticate and use Claude Code functionality immediately after installation without wrestling with environment variables or hidden settings. This directly impacts user onboarding success rates and product usability.

**Technical Context**: Authentication settings were recently added to `package.json` (ptah.claudeOAuthToken, ptah.anthropicApiKey, ptah.authMethod), and the SDK adapter contains authentication logic, but the initialization flow was never wired into the extension activation sequence. This creates a critical gap between configuration availability and actual functionality.

## Requirements

### Requirement 1: SDK Authentication Initialization

**User Story**: As an extension developer integrating the Claude Agent SDK, I want the SDK to initialize authentication during extension activation, so that the agent is ready to handle user requests immediately without race conditions or silent failures.

#### Acceptance Criteria

1. WHEN extension activates THEN `SdkAgentAdapter.initialize()` SHALL be called after DI container setup but before webview registration
2. WHEN `initialize()` executes THEN authentication configuration SHALL be read from ConfigManager (ptah.claudeOAuthToken, ptah.anthropicApiKey, ptah.authMethod)
3. WHEN authentication settings are found THEN process.env variables SHALL be populated (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)
4. WHEN no authentication is configured THEN health status SHALL be set to "error" and clear error message SHALL be logged
5. WHEN initialization fails THEN extension activation SHALL NOT fail, and error SHALL be logged with actionable guidance
6. WHEN authentication is configured THEN health status SHALL be set to "available" with timestamp and uptime
7. WHEN initialization completes successfully THEN SDK SHALL be ready to accept chat session requests

### Requirement 2: Configuration Watcher for Dynamic Re-initialization

**User Story**: As a user changing my authentication settings via VS Code Settings UI (Ctrl+,), I want the SDK to automatically re-initialize without requiring an extension reload, so that I can test different authentication methods immediately.

#### Acceptance Criteria

1. WHEN SdkAgentAdapter initializes THEN ConfigManager watcher SHALL be registered for authentication keys (ptah.claudeOAuthToken, ptah.anthropicApiKey, ptah.authMethod)
2. WHEN any watched authentication setting changes THEN watcher callback SHALL trigger SDK re-initialization
3. WHEN re-initialization starts THEN existing active sessions SHALL be gracefully terminated with abort signals
4. WHEN re-initialization completes THEN new health status SHALL be computed and logged
5. WHEN re-initialization succeeds THEN user SHALL be able to start new sessions immediately
6. WHEN re-initialization fails THEN error SHALL be logged with specific failure reason
7. WHEN extension disposes THEN ConfigManager watcher SHALL be unregistered to prevent memory leaks

### Requirement 3: Onboarding UI for Missing Authentication

**User Story**: As a new user activating Ptah for the first time without authentication configured, I want to see a clear notification with actionable steps, so that I understand what configuration is required and where to find setup instructions.

#### Acceptance Criteria

1. WHEN extension activates with no authentication configured THEN information message SHALL be shown via `vscode.window.showInformationMessage()`
2. WHEN onboarding message displays THEN message SHALL include clear description of authentication requirement
3. WHEN onboarding message displays THEN action button "Open Settings" SHALL be available
4. WHEN "Open Settings" is clicked THEN VS Code Settings UI SHALL open to "ptah" configuration section
5. WHEN onboarding message displays THEN action button "Get OAuth Token" SHALL be available with link to Claude Code setup page
6. WHEN onboarding UI shows THEN error SHALL be logged with context for troubleshooting
7. WHEN user dismisses notification THEN extension SHALL remain active but SDK SHALL be in error state until authentication configured

### Requirement 4: Authentication Health Status RPC Method

**User Story**: As a frontend developer building the Settings UI, I want to query the current authentication health status via RPC, so that I can display connection status and provide real-time feedback to users.

#### Acceptance Criteria

1. WHEN RPC method `auth:getHealth` is registered THEN it SHALL return current SdkAgentAdapter health status
2. WHEN health status is "available" THEN response SHALL include uptime, lastCheck timestamp, and responseTime
3. WHEN health status is "error" THEN response SHALL include errorMessage with actionable guidance
4. WHEN health status is "initializing" THEN response SHALL indicate SDK is not yet ready
5. WHEN RPC method fails THEN error SHALL be logged and error response SHALL be returned with details
6. WHEN health status changes THEN no automatic notification SHALL be sent (frontend polls on demand)
7. WHEN multiple rapid calls occur THEN health status SHALL be returned from cache without re-initialization

### Requirement 5: Settings UI Component Library

**User Story**: As a user managing Ptah configuration, I want a dedicated Settings page accessible from the main chat UI, so that I can configure authentication, model selection, and autopilot without navigating VS Code's complex settings hierarchy.

#### Acceptance Criteria

1. WHEN user clicks "Settings" navigation item THEN Settings view SHALL be displayed replacing chat view
2. WHEN Settings view loads THEN current configuration SHALL be fetched via RPC methods (auth health, model selection, autopilot state)
3. WHEN Settings view displays THEN AuthConfigComponent SHALL be visible with authentication form
4. WHEN Settings view displays THEN ModelSelectorComponent SHALL be visible with model dropdown
5. WHEN Settings view displays THEN AutopilotConfigComponent SHALL be visible with permission toggles
6. WHEN user clicks "Back to Chat" THEN navigation SHALL return to chat view
7. WHEN Settings view is active THEN browser back button SHALL return to previous view

### Requirement 6: Authentication Configuration Component

**User Story**: As a user configuring authentication via Settings UI, I want to select my authentication method (OAuth or API Key), enter my credentials, and test the connection, so that I can verify my setup works before attempting to chat.

#### Acceptance Criteria

1. WHEN AuthConfigComponent renders THEN radio buttons SHALL display auth method options (OAuth Token, API Key, Auto-detect)
2. WHEN OAuth Token is selected THEN password-masked input field SHALL be shown for ptah.claudeOAuthToken
3. WHEN API Key is selected THEN password-masked input field SHALL be shown for ptah.anthropicApiKey
4. WHEN Auto-detect is selected THEN both input fields SHALL be shown with explanation text
5. WHEN user enters token/key THEN "Save & Test Connection" button SHALL be enabled
6. WHEN "Save & Test Connection" is clicked THEN RPC method SHALL save settings to VS Code configuration
7. WHEN save completes THEN "Test Connection" RPC method SHALL be called and result SHALL be displayed (success/error message)
8. WHEN connection test succeeds THEN green checkmark icon SHALL appear with "Connected" status
9. WHEN connection test fails THEN red error icon SHALL appear with specific error message
10. WHEN settings are saved THEN ConfigManager watcher SHALL trigger SDK re-initialization automatically

### Requirement 7: RPC Methods for Settings UI Integration

**User Story**: As a backend developer implementing Settings UI RPC handlers, I want type-safe RPC methods for saving authentication settings and testing connections, so that frontend and backend communicate reliably with clear contracts.

#### Acceptance Criteria

1. WHEN RPC method `auth:saveSettings` is registered THEN it SHALL accept params (authMethod, claudeOAuthToken, anthropicApiKey)
2. WHEN `auth:saveSettings` executes THEN settings SHALL be saved via ConfigManager.set() with Workspace target
3. WHEN `auth:saveSettings` completes THEN ConfigManager watcher SHALL automatically trigger SDK re-initialization
4. WHEN RPC method `auth:testConnection` is registered THEN it SHALL call SdkAgentAdapter.getHealth() after re-initialization
5. WHEN `auth:testConnection` returns success THEN health status SHALL be "available" with metadata
6. WHEN `auth:testConnection` returns error THEN errorMessage SHALL include specific failure reason (invalid token, network error, etc.)
7. WHEN RPC method fails THEN error SHALL be logged and error response SHALL be returned to frontend

### Requirement 8: Settings UI Navigation Integration

**User Story**: As a user navigating the Ptah interface, I want a visible "Settings" link in the main navigation, so that I can access configuration without searching through VS Code menus.

#### Acceptance Criteria

1. WHEN main webview loads THEN navigation menu SHALL include "Settings" item with gear icon
2. WHEN "Settings" link is clicked THEN AppStateManager signal SHALL update to settings view
3. WHEN settings view is active THEN "Settings" navigation item SHALL be highlighted/active
4. WHEN user navigates away from settings THEN previous view state SHALL be restored
5. WHEN settings view is dismissed THEN no configuration changes SHALL occur unless explicitly saved
6. WHEN navigation occurs THEN route transition SHALL be smooth without flicker
7. WHEN deep link to settings is used THEN settings view SHALL render directly

## Non-Functional Requirements

### Performance Requirements

**Response Time**:

- SDK initialization: Complete within 500ms under normal conditions
- ConfigManager watcher callback: Trigger re-initialization within 100ms of settings change
- RPC health status query: Return cached status within 50ms (95th percentile)
- Settings UI load time: Render complete form within 200ms
- Connection test: Complete within 3 seconds for valid credentials

**Throughput**:

- ConfigManager watchers: Handle configuration changes without blocking extension activation
- RPC method calls: Support concurrent requests from multiple webview instances
- Settings UI: Handle rapid user input changes without lag

**Resource Usage**:

- Memory: ConfigManager watchers shall not leak memory on repeated configuration changes
- CPU: Re-initialization shall not block main extension thread for more than 50ms
- Network: Connection test shall timeout after 5 seconds to prevent UI freezing

### Security Requirements

**Authentication**:

- OAuth tokens and API keys SHALL be stored in VS Code's configuration system (not plain text files)
- Password input fields SHALL use type="password" to mask credentials
- Credentials SHALL NOT be logged in plain text (mask in logs)
- Environment variables SHALL be cleared on extension deactivation

**Authorization**:

- Only extension code SHALL access authentication settings via ConfigManager
- RPC methods SHALL NOT expose raw credentials in responses
- Settings UI SHALL validate input format before sending to backend

**Data Protection**:

- Credentials SHALL be transmitted via secure RPC channel only
- No credentials SHALL be included in error messages displayed to users
- Connection test SHALL NOT expose credentials in network logs

**Compliance**:

- Authentication handling SHALL follow VS Code extension security best practices
- No credentials SHALL be transmitted to external servers except Anthropic API endpoints
- GDPR compliance: Users can clear credentials by deleting settings

### Reliability Requirements

**Uptime**:

- Extension activation SHALL NOT fail if SDK initialization fails (graceful degradation)
- Settings UI SHALL remain functional even if SDK is in error state
- ConfigManager watchers SHALL recover from transient errors automatically

**Error Handling**:

- All RPC methods SHALL catch exceptions and return structured error responses
- SDK re-initialization failures SHALL log actionable error messages
- Settings UI SHALL display user-friendly error messages (not stack traces)

**Recovery Time**:

- ConfigManager watcher SHALL detect configuration changes within 1 second
- SDK re-initialization SHALL complete within 2 seconds on configuration change
- Failed connection test SHALL not block UI interaction

### Scalability Requirements

**Load Capacity**:

- ConfigManager SHALL support 100+ settings keys without performance degradation
- RPC handler SHALL process 1000+ requests per minute
- Settings UI SHALL handle rapid form input changes (debounced)

**Growth Planning**:

- Authentication system SHALL support future provider additions (Azure OpenAI, etc.)
- Settings UI SHALL be extensible for new configuration sections
- RPC methods SHALL follow versioned contract pattern for backward compatibility

**Resource Scaling**:

- ConfigManager watchers SHALL scale linearly with number of watched keys
- Settings UI SHALL lazy-load components for large configuration forms

### Usability Requirements

**User Experience**:

- Onboarding notification SHALL appear within 2 seconds of extension activation
- Settings UI SHALL provide inline validation feedback (red border on invalid input)
- Connection test SHALL show loading spinner during execution
- Success/error messages SHALL auto-dismiss after 5 seconds

**Accessibility**:

- Settings form SHALL be keyboard-navigable (tab order logical)
- Error messages SHALL be announced to screen readers
- Form labels SHALL be semantically correct (for attribute)
- Color-blind users SHALL understand success/error states (icons + text)

**Documentation**:

- Onboarding message SHALL link to setup documentation
- Settings UI SHALL include help tooltips explaining each field
- Error messages SHALL suggest specific remediation steps

## Stakeholder Analysis

### Primary Stakeholders

**End Users (Ptah Extension Users)**:

- Needs: Simple authentication setup, clear error messages, immediate feedback
- Pain Points: Current silent failures, no visibility into authentication status, buried settings
- Success Criteria: Can configure authentication in under 2 minutes without consulting documentation

**Development Team (Backend + Frontend Developers)**:

- Needs: Clear separation of concerns, type-safe RPC contracts, maintainable code
- Pain Points: Current race condition, unclear initialization sequence, missing integration layer
- Success Criteria: SDK initialization wired correctly, Settings UI fully functional, 100% test coverage on critical paths

**Product Owners**:

- Needs: Improved user onboarding, reduced support tickets for authentication issues
- Pain Points: Current setup friction causes user drop-off
- Success Criteria: 90% of users successfully authenticate on first attempt, support tickets reduced by 50%

### Secondary Stakeholders

**Operations Team**:

- Needs: Clear logging for troubleshooting authentication failures
- Pain Points: Current silent failures make debugging difficult
- Success Criteria: All authentication errors logged with actionable context

**QA/Testing Team**:

- Needs: Testable authentication flows, clear success/failure states
- Pain Points: Current race condition makes testing unreliable
- Success Criteria: Authentication flows are deterministic and testable in CI/CD

### Stakeholder Impact Matrix

| Stakeholder    | Impact Level | Involvement      | Success Criteria                               |
| -------------- | ------------ | ---------------- | ---------------------------------------------- |
| End Users      | Critical     | Testing/Feedback | Authentication setup under 2 minutes           |
| Dev Team       | High         | Implementation   | Zero race conditions, clean architecture       |
| Product Owners | High         | Requirements     | 90% first-time authentication success          |
| Operations     | Medium       | Monitoring       | All errors logged with context                 |
| QA Team        | Medium       | Testing          | Deterministic authentication flows for testing |

## Risk Analysis

### Technical Risks

#### Risk 1: ConfigManager Watcher Timing Issues

- **Probability**: Medium
- **Impact**: High
- **Description**: ConfigManager watcher triggers re-initialization while active sessions are mid-request, causing undefined behavior
- **Mitigation**:
  - Implement graceful session termination with abort signals before re-initialization
  - Add state machine to prevent concurrent re-initialization attempts
  - Test with rapid configuration changes during active chat sessions
- **Contingency**: Add "Reload Required" notification if safe re-initialization fails

#### Risk 2: RPC Method Type Safety Violations

- **Probability**: Low
- **Impact**: Medium
- **Description**: Frontend sends malformed RPC parameters causing runtime errors in backend
- **Mitigation**:
  - Use Zod schemas for RPC parameter validation
  - Add runtime type checks in all RPC handlers
  - Return structured error responses with validation details
- **Contingency**: Implement generic error boundary in RPC handler layer

#### Risk 3: SDK Initialization Performance Regression

- **Probability**: Low
- **Impact**: Medium
- **Description**: Adding initialization call to activation flow increases activation time beyond acceptable threshold
- **Mitigation**:
  - Benchmark initialization performance (target: <500ms)
  - Make SDK initialization non-blocking if performance exceeds budget
  - Add performance monitoring for activation sequence
- **Contingency**: Move SDK initialization to background task if blocking is unacceptable

#### Risk 4: Settings UI Bundle Size Increase

- **Probability**: Medium
- **Impact**: Low
- **Description**: Adding new Settings library increases webview bundle size, slowing load times
- **Mitigation**:
  - Use Angular lazy loading for Settings feature module
  - Optimize component bundle with tree-shaking
  - Monitor bundle size in CI/CD pipeline
- **Contingency**: Extract Settings UI to separate webview panel if bundle size exceeds 500KB

### Business Risks

#### Risk 5: User Credential Security Concerns

- **Probability**: Low
- **Impact**: Critical
- **Description**: Users fear credential leakage through Ptah extension
- **Mitigation**:
  - Document security architecture in README
  - Use VS Code's secure storage APIs (not workspace settings for secrets)
  - Add credential masking in all logs and error messages
- **Contingency**: Provide credential audit log feature if users demand transparency

#### Risk 6: Configuration Migration Complexity

- **Probability**: Medium
- **Impact**: Medium
- **Description**: Existing users with environment-variable-based authentication need migration guidance
- **Mitigation**:
  - Auto-detect environment variables during first initialization
  - Show migration notification for users with existing .env files
  - Provide migration guide in documentation
- **Contingency**: Support both environment variables and VS Code settings indefinitely

### Integration Risks

#### Risk 7: VS Code Settings UI Conflict

- **Probability**: Low
- **Impact**: Low
- **Description**: Users confused whether to use Ptah Settings UI or VS Code Settings UI
- **Mitigation**:
  - Add clear guidance in Settings UI about synchronization
  - Show "Managed by Ptah Settings UI" indicator in VS Code Settings
  - Keep both UIs in sync via ConfigManager
- **Contingency**: Add "Advanced Settings" link to VS Code Settings UI from Ptah UI

#### Risk 8: Anthropic API Changes

- **Probability**: Medium
- **Impact**: High
- **Description**: Anthropic changes authentication requirements, breaking SDK integration
- **Mitigation**:
  - Monitor Anthropic API changelog
  - Add version detection for SDK authentication schema
  - Implement graceful degradation for unsupported auth methods
- **Contingency**: Show maintenance notification and guide users to update extension

## Risk Matrix

| Risk                           | Probability | Impact   | Score | Mitigation Strategy                                                 |
| ------------------------------ | ----------- | -------- | ----- | ------------------------------------------------------------------- |
| ConfigManager Watcher Timing   | Medium      | High     | 6     | Graceful session termination + state machine for re-init            |
| RPC Type Safety Violations     | Low         | Medium   | 3     | Zod schema validation + runtime type checks                         |
| SDK Initialization Performance | Low         | Medium   | 3     | Benchmark <500ms + non-blocking option                              |
| Settings UI Bundle Size        | Medium      | Low      | 3     | Angular lazy loading + bundle monitoring                            |
| User Credential Security       | Low         | Critical | 4     | Security documentation + VS Code secure storage APIs                |
| Configuration Migration        | Medium      | Medium   | 4     | Auto-detect env vars + migration notification                       |
| VS Code Settings UI Conflict   | Low         | Low      | 2     | Clear guidance + "Managed by Ptah" indicators                       |
| Anthropic API Changes          | Medium      | High     | 6     | API changelog monitoring + version detection + graceful degradation |

## Quality Gates

Before delegation to software-architect, verify:

- [x] All requirements follow SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound)
- [x] Acceptance criteria in proper WHEN/THEN/SHALL format (BDD style)
- [x] Stakeholder analysis complete with impact matrix
- [x] Risk assessment with mitigation strategies (8 risks identified)
- [x] Success metrics clearly defined for each stakeholder
- [x] Dependencies identified and documented (ConfigManager, RpcHandler, SdkAgentAdapter)
- [x] Non-functional requirements specified (Performance, Security, Reliability, Scalability, Usability)
- [x] Compliance requirements addressed (VS Code security best practices, GDPR)
- [x] Performance benchmarks established (<500ms init, <50ms health query, <200ms UI load)
- [x] Security requirements documented (credential masking, secure storage, no plain-text logging)

## Out of Scope

The following items are explicitly **OUT OF SCOPE** for TASK_2025_057:

1. **License Server Integration** (TASK_2025_043)

   - Premium license validation
   - License key management UI
   - Subscription status checks
   - Reason: Blocked until authentication system is stable

2. **Multi-Provider Support**

   - Azure OpenAI authentication
   - Google Vertex AI integration
   - AWS Bedrock integration
   - Reason: Future enhancement after core authentication proven

3. **Advanced Settings UI Features**

   - Theme customization
   - Keyboard shortcut configuration
   - Extension behavior preferences
   - Reason: Focus on authentication first, other settings later

4. **Credential Migration Tools**

   - Automatic .env file import
   - Batch credential update utilities
   - Multi-workspace credential sync
   - Reason: Manual migration sufficient for initial release

5. **Settings Export/Import**

   - Configuration backup
   - Settings synchronization across machines
   - Team configuration sharing
   - Reason: VS Code settings sync already handles this

6. **Backward Compatibility Layers**

   - Support for deprecated authentication methods
   - Legacy API compatibility
   - Old configuration format migration
   - Reason: This is net-new authentication system, no legacy to support

7. **Advanced Security Features**

   - Two-factor authentication
   - Credential rotation policies
   - Access audit logs
   - Reason: Overkill for MVP, consider if enterprise users request

8. **Settings UI Advanced Components**
   - Visual prompt editor
   - Custom tool configuration
   - Workspace-specific overrides UI
   - Reason: Future enhancement after core settings proven

## Success Criteria Summary

### Backend (SDK Initialization & Configuration Watching)

- SDK `initialize()` called during extension activation (after DI setup, before webview registration)
- ConfigManager watchers registered for ptah.claudeOAuthToken, ptah.anthropicApiKey, ptah.authMethod
- Authentication changes trigger automatic SDK re-initialization without extension reload
- Onboarding notification shown when no authentication configured
- Health status exposed via `auth:getHealth` RPC method
- All authentication errors logged with actionable guidance
- Zero race conditions during configuration changes

### Frontend (Settings UI Component)

- Settings route accessible from main navigation (gear icon)
- AuthConfigComponent renders with auth method selection and masked credential inputs
- "Save & Test Connection" button triggers RPC save + health check
- Connection status displayed with success (green checkmark) or error (red icon + message)
- ModelSelectorComponent integrated with existing RPC methods
- AutopilotConfigComponent integrated with existing RPC methods
- Settings saved via RPC persist to VS Code configuration (Workspace scope)

### Integration (RPC Methods & Wiring)

- RPC method `auth:getHealth` returns current SdkAgentAdapter health status
- RPC method `auth:saveSettings` accepts params and saves via ConfigManager
- RPC method `auth:testConnection` calls health check after re-initialization
- All RPC methods handle errors gracefully and return structured error responses
- Frontend receives success/error feedback within 3 seconds
- Configuration changes detected by watcher within 1 second

### Quality & Testing

- Unit tests: 80% coverage on SdkAgentAdapter initialization logic
- Integration tests: ConfigManager watcher triggers re-initialization
- E2E tests: Full authentication flow from Settings UI to successful chat
- Performance: SDK initialization completes within 500ms (95th percentile)
- Security: Credentials masked in all logs and error messages
- Usability: Users can complete authentication setup in under 2 minutes

## Dependencies

### External Dependencies

- **VS Code API**: vscode.workspace.getConfiguration(), vscode.window.showInformationMessage()
- **ConfigManager Service**: Already implemented in vscode-core library
- **RpcHandler Service**: Already implemented in vscode-core library
- **SdkAgentAdapter**: Already implemented in agent-sdk library (initialize() method exists but never called)
- **Angular 20+**: Frontend framework for Settings UI components

### Internal Dependencies

- **Task Ordering**: Backend (SDK init + watchers) MUST complete before frontend (Settings UI) integration testing
- **Parallel Development**: Backend and frontend CAN be developed in parallel by separate developers
- **Integration Point**: RPC methods bridge backend and frontend (requires coordination)

### Blocking Dependencies

- None (all required services already implemented)

### Future Dependencies

- TASK_2025_043 (License Server) is blocked until this task completes successfully

## Testing Strategy

### Unit Testing

**Backend**:

- SdkAgentAdapter.initialize() with various auth configurations (OAuth, API key, auto, none)
- ConfigManager watcher callback execution on configuration changes
- RPC method handlers (auth:getHealth, auth:saveSettings, auth:testConnection)

**Frontend**:

- AuthConfigComponent form validation and submission
- Settings navigation state management
- Connection status display logic

### Integration Testing

**Backend**:

- ConfigManager watcher triggers SDK re-initialization on auth setting change
- RPC method saves settings and triggers watcher callback
- Onboarding notification displays when no auth configured

**Frontend**:

- Settings UI sends RPC requests and handles responses
- Navigation between chat and settings views
- Connection test displays success/error states

### End-to-End Testing

**Full Authentication Flow**:

1. Activate extension with no authentication configured
2. Verify onboarding notification appears
3. Click "Open Settings" and navigate to Settings UI
4. Enter OAuth token in AuthConfigComponent
5. Click "Save & Test Connection"
6. Verify success message and green checkmark
7. Return to chat and send message
8. Verify chat works with authenticated SDK

**Configuration Change Flow**:

1. Activate extension with valid authentication
2. Start chat session
3. Change authentication via VS Code Settings UI (Ctrl+,)
4. Verify ConfigManager watcher detects change
5. Verify SDK re-initializes automatically
6. Verify new chat session works with new authentication

### Performance Testing

- Benchmark SDK initialization time (target: <500ms 95th percentile)
- Benchmark ConfigManager watcher callback execution (target: <100ms)
- Benchmark RPC health status query (target: <50ms)
- Benchmark Settings UI load time (target: <200ms)
- Load test: 100 rapid configuration changes

### Security Testing

- Verify credentials never logged in plain text
- Verify credentials not exposed in RPC responses
- Verify password fields masked in UI
- Verify environment variables cleared on deactivation
- Penetration test: Attempt to extract credentials via extension API

## Acceptance Criteria for Task Completion

Task TASK_2025_057 is considered COMPLETE when:

1. **Backend Implementation**:

   - SDK initialization call added to main.ts activation flow
   - ConfigManager watchers registered for auth settings
   - Onboarding notification shown when auth missing
   - RPC methods `auth:getHealth`, `auth:saveSettings`, `auth:testConnection` implemented
   - All backend unit tests passing (80% coverage)

2. **Frontend Implementation**:

   - Settings UI library created with Angular components
   - AuthConfigComponent renders with form and connection test
   - Navigation to Settings view functional
   - All frontend unit tests passing (80% coverage)

3. **Integration**:

   - RPC methods connect frontend to backend successfully
   - Configuration changes trigger SDK re-initialization
   - Settings UI displays health status correctly
   - All integration tests passing

4. **Quality**:

   - Code review passes (style + logic reviewers)
   - E2E test passes: New user → authentication setup → successful chat
   - Performance benchmarks met (init <500ms, health query <50ms, UI load <200ms)
   - Security review passes (no credential leakage)

5. **Documentation**:

   - Code comments added to complex logic (ConfigManager watcher, RPC handlers)
   - README updated with authentication setup instructions
   - Settings UI usage documented in user guide

6. **Git & Deployment**:
   - All changes committed with valid commit messages (feat(vscode): add sdk initialization, feat(webview): add settings ui)
   - Branch `feature/TASK_2025_057` merged to main via PR
   - PR approved by at least one reviewer
   - CI/CD pipeline passes (lint, typecheck, tests)
