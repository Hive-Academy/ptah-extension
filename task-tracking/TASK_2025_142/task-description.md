# Requirements Document - TASK_2025_142

## Trial Subscription Experience Enhancement

### Introduction

This task enhances the trial subscription experience for Ptah Extension users by implementing comprehensive notifications, visual indicators, and conversion flows. Currently, the 14-day Pro trial system (implemented in TASK_2025_121) provides basic trial tracking via `LicenseService.verifyLicense()`, but lacks proactive user communication about trial status, expiration warnings, and upgrade pathways.

**Business Value**: Improved trial experience increases conversion rates from trial to paid subscriptions by:

1. Keeping users informed about their trial status
2. Providing timely reminders before expiration
3. Offering clear upgrade pathways when trial ends
4. Reducing "surprise" trial expirations that lead to user frustration

---

## Requirements

### Requirement 1: Extension Webview Trial Countdown Banner

**User Story:** As a trial user using the Ptah Extension webview, I want to see how many days remain in my trial, so that I can plan my subscription decision before the trial expires.

#### Acceptance Criteria

1. WHEN a user with `trialActive: true` and `trialDaysRemaining > 0` opens the chat view THEN a persistent countdown banner SHALL display at the top of the chat interface showing "X days remaining in trial"
2. WHEN `trialDaysRemaining <= 3` THEN the banner color SHALL change to warning (amber/yellow) to indicate urgency
3. WHEN `trialDaysRemaining <= 1` THEN the banner color SHALL change to error (red) to indicate critical urgency
4. WHEN the user clicks the banner THEN the system SHALL navigate to the pricing page in an external browser
5. WHEN the user dismisses the banner THEN it SHALL remain hidden for the current session only (reappears on next session)
6. WHEN `trialActive: false` OR `trialDaysRemaining` is null THEN the banner SHALL NOT be displayed

#### Technical Notes

- Component: New `trial-banner.component.ts` in `libs/frontend/chat/src/lib/components/molecules/`
- Integration: Add to `chat-view.component.ts` template at top of main content area
- Data source: Leverage existing `license:getStatus` RPC which already returns `trialActive` and `trialDaysRemaining`
- State: Use Angular signals for banner visibility, session-scoped dismissal via `sessionStorage`

---

### Requirement 2: Trial-Ended Modal with Upgrade CTA

**User Story:** As a user whose trial has just ended, I want to see a clear explanation of what happened and how to continue using premium features, so that I can make an informed decision about upgrading.

#### Acceptance Criteria

1. WHEN `license:getStatus` returns `reason: 'trial_ended'` THEN a modal dialog SHALL be displayed with trial-ended messaging
2. WHEN the modal is displayed THEN it SHALL contain:
   - Clear headline: "Your Pro Trial Has Ended"
   - Explanation of Community tier limitations
   - Primary CTA button: "Upgrade to Pro" (opens pricing page)
   - Secondary CTA: "Continue with Community" (dismisses modal)
   - Feature comparison snippet (3-4 key Pro features)
3. WHEN user clicks "Upgrade to Pro" THEN the system SHALL open the pricing page via `ptah.openPricing` command
4. WHEN user clicks "Continue with Community" THEN the modal SHALL close and not reappear for 24 hours
5. WHEN user enters a valid license key THEN the modal SHALL automatically close

#### Technical Notes

- Component: New `trial-ended-modal.component.ts` in `libs/frontend/chat/src/lib/components/molecules/`
- Trigger: Check `reason` field in `welcome.component.ts` or `app-shell.component.ts` on init
- Dismissal persistence: Use `localStorage` with 24-hour TTL
- Differentiate from existing `welcome.component.ts` which handles full unlicensed flow

---

### Requirement 3: Settings Page Trial Status Enhancement

**User Story:** As a trial user viewing my settings, I want to see detailed trial status information, so that I can understand my current subscription state and remaining time.

#### Acceptance Criteria

1. WHEN a trial user opens the settings page THEN a dedicated trial status section SHALL display:
   - Trial days remaining with visual progress indicator
   - Trial end date in human-readable format
   - "Upgrade Now" button linking to pricing page
2. WHEN `trialDaysRemaining <= 3` THEN the status section SHALL use warning styling
3. WHEN `trialDaysRemaining <= 1` THEN the status section SHALL use error styling with "Expires Tomorrow" or "Expires Today" text
4. WHEN the trial has ended (`reason: 'trial_ended'`) THEN the section SHALL show "Trial Expired" with upgrade CTA

#### Technical Notes

- Location: Enhance existing `settings.component.ts` which already has `trialActive` and `trialDaysRemaining` signals
- UI: Add new section between license status card and auth config section
- Reuse existing computed signals: `showTrialInfo`, `tierDisplayName`

---

### Requirement 4: Email Notifications for Trial Expiration

**User Story:** As a trial user, I want to receive email reminders before my trial expires, so that I don't miss the opportunity to upgrade and maintain access to premium features.

#### Acceptance Criteria

1. WHEN a trial is 7 days from expiring THEN the system SHALL send a reminder email with subject "Your Ptah Pro trial ends in 7 days"
2. WHEN a trial is 3 days from expiring THEN the system SHALL send a reminder email with subject "3 days left in your Ptah Pro trial"
3. WHEN a trial is 1 day from expiring THEN the system SHALL send an urgent reminder email with subject "Your Ptah Pro trial ends tomorrow"
4. WHEN a trial expires THEN the system SHALL send a notification email with subject "Your Ptah Pro trial has ended"
5. WHEN sending trial reminder emails THEN each email SHALL contain:
   - Personalized greeting (user's first name if available, otherwise email)
   - Clear trial end date
   - Summary of Pro features they will lose
   - Prominent "Upgrade Now" CTA button linking to pricing page
6. WHEN a user has already upgraded to Pro THEN the system SHALL NOT send trial reminder emails

#### Technical Notes

- Service: Extend `EmailService` with new methods: `sendTrialReminder7Day`, `sendTrialReminder3Day`, `sendTrialReminder1Day`, `sendTrialExpired`
- Scheduler: Add `@nestjs/schedule` module for cron jobs
- Job: New `TrialReminderService` with daily cron job at 9:00 AM UTC
- Query: Find subscriptions with `status: 'trialing'` and `trialEnd` within target date ranges
- Idempotency: Track sent reminders to prevent duplicate emails (new `trialRemindersSent` JSON field or separate table)

---

## Non-Functional Requirements

### Performance Requirements

- **Banner Render Time**: Trial countdown banner SHALL render within 100ms of chat view load
- **Modal Display Time**: Trial-ended modal SHALL display within 200ms of license status fetch completion
- **Email Delivery**: Trial reminder emails SHALL be queued within 5 seconds of cron job execution
- **Cron Job Duration**: Daily trial reminder job SHALL complete within 60 seconds for up to 10,000 trial users

### Reliability Requirements

- **Email Delivery**: Email service SHALL retry failed sends up to 3 times with exponential backoff (existing implementation)
- **Cron Job Recovery**: If cron job fails mid-execution, it SHALL resume on next scheduled run without duplicate emails
- **State Persistence**: Banner dismissal state SHALL survive browser refresh within same session

### Security Requirements

- **Email Content**: Trial reminder emails SHALL NOT contain license keys or sensitive data
- **Rate Limiting**: Trial reminder cron job SHALL be limited to 100 emails per minute to avoid SendGrid rate limits

### Scalability Requirements

- **Database Query**: Trial reminder query SHALL use indexed fields (`status`, `trialEnd`) for efficient filtering
- **Batch Processing**: Email sends SHALL be batched in groups of 50 for memory efficiency

---

## Scope Definition

### IN Scope

1. **Extension Webview Components**

   - Trial countdown banner component for chat view
   - Trial-ended modal component with upgrade CTA
   - Enhanced trial status display in settings page

2. **License Server Backend**

   - Email templates for trial reminders (7-day, 3-day, 1-day, expired)
   - Scheduled job for sending trial reminder emails
   - Email service methods for each reminder type

3. **Infrastructure**
   - Add `@nestjs/schedule` module to license server
   - Database tracking for sent reminder emails (prevent duplicates)

### OUT of Scope

1. **Grace Period Implementation** - Instant trial invalidation behavior remains unchanged
2. **Landing Page Modifications** - Profile page already shows trial status adequately
3. **SMS/Push Notifications** - Email-only for this iteration
4. **Customizable Reminder Schedule** - Fixed schedule (7/3/1/0 days)
5. **Trial Extension Functionality** - No self-service trial extension
6. **A/B Testing of Email Content** - Single template per reminder type
7. **Webhook-Based Real-Time Notifications** - Cron-based batch processing only

---

## User Stories Summary

| ID   | User Story                          | Priority | Complexity           |
| ---- | ----------------------------------- | -------- | -------------------- |
| US-1 | Trial countdown banner in chat view | High     | Medium               |
| US-2 | Trial-ended modal with upgrade CTA  | High     | Medium               |
| US-3 | Enhanced trial status in settings   | Medium   | Low                  |
| US-4 | Email reminder at 7 days            | High     | High                 |
| US-5 | Email reminder at 3 days            | High     | Low (template reuse) |
| US-6 | Email reminder at 1 day             | High     | Low (template reuse) |
| US-7 | Email notification on expiration    | Medium   | Low (template reuse) |

---

## Dependencies

### Existing Systems

| System                           | Dependency Type | Description                                                  |
| -------------------------------- | --------------- | ------------------------------------------------------------ |
| `LicenseService.verifyLicense()` | Data Source     | Returns `trialActive`, `trialDaysRemaining`, `reason` fields |
| `license:getStatus` RPC          | API             | Frontend fetches trial status via this endpoint              |
| `EmailService`                   | Service         | Existing SendGrid integration with retry logic               |
| `settings.component.ts`          | Component       | Already has trial-related signals to enhance                 |
| `welcome.component.ts`           | Component       | Handles `reason: 'trial_ended'` case                         |
| Prisma `Subscription` model      | Database        | Contains `status: 'trialing'` and `trialEnd` fields          |

### New Dependencies Required

| Dependency         | Type        | Purpose                                 |
| ------------------ | ----------- | --------------------------------------- |
| `@nestjs/schedule` | NPM Package | Cron job scheduling for email reminders |
| `cron`             | NPM Package | Peer dependency for @nestjs/schedule    |

### RPC Types Extension

The existing `LicenseGetStatusResponse` type already contains required fields:

- `trialActive: boolean`
- `trialDaysRemaining: number | null`
- `reason?: 'expired' | 'trial_ended' | 'no_license'`

No RPC type changes required.

---

## Risks and Mitigations

### Technical Risks

| Risk                                              | Probability | Impact | Mitigation Strategy                                                 |
| ------------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------- |
| SendGrid rate limiting during bulk email send     | Medium      | High   | Implement batch processing with 100 emails/minute limit             |
| Cron job fails silently                           | Low         | High   | Add logging, error handling, and health check endpoint              |
| Duplicate reminder emails sent                    | Medium      | Medium | Track sent reminders in database with unique constraint             |
| Trial status out of sync between frontend/backend | Low         | Medium | Use single source of truth (backend), frontend always fetches fresh |

### UX Risks

| Risk                                  | Probability | Impact | Mitigation Strategy                                              |
| ------------------------------------- | ----------- | ------ | ---------------------------------------------------------------- |
| Banner feels intrusive to users       | Medium      | Medium | Allow dismissal, use subtle styling for early days               |
| Modal feels aggressive/pushy          | Low         | High   | Provide clear "Continue with Community" option, 24-hour cooldown |
| Email fatigue from too many reminders | Medium      | Medium | Limit to 4 emails total (7, 3, 1, 0 days), professional tone     |

### Business Risks

| Risk                                                | Probability | Impact | Mitigation Strategy                                       |
| --------------------------------------------------- | ----------- | ------ | --------------------------------------------------------- |
| Users unsubscribe from all emails                   | Low         | Medium | Ensure trial reminders are separate from marketing emails |
| Confusion between trial and subscription expiration | Low         | Medium | Clear copy distinguishing "trial" vs "subscription"       |

---

## Success Metrics

| Metric                                            | Target         | Measurement Method                     |
| ------------------------------------------------- | -------------- | -------------------------------------- |
| Trial-to-paid conversion rate                     | +15% increase  | Compare 30-day conversion before/after |
| Email open rate for trial reminders               | > 40%          | SendGrid analytics                     |
| Banner click-through rate                         | > 10%          | Frontend analytics event               |
| Modal upgrade button clicks                       | > 25%          | Frontend analytics event               |
| Support tickets about "surprise" trial expiration | -50% reduction | Support ticket categorization          |

---

## Implementation Phases

### Phase 1: Frontend Components (Priority: High)

- Trial countdown banner component
- Trial-ended modal component
- Settings page enhancement

### Phase 2: Backend Email Infrastructure (Priority: High)

- Install and configure `@nestjs/schedule`
- Create email templates for all reminder types
- Implement `TrialReminderService` with cron job

### Phase 3: Database Tracking (Priority: Medium)

- Add reminder tracking mechanism (prevent duplicates)
- Implement batch query for trials expiring within date ranges

### Phase 4: Testing and Validation (Priority: High)

- Unit tests for new components and services
- Integration tests for cron job execution
- Manual testing of email delivery

---

## Appendix: Email Template Specifications

### 7-Day Reminder Email

**Subject:** Your Ptah Pro trial ends in 7 days

**Body Sections:**

1. Personalized greeting
2. Trial status: "You have 7 days remaining in your Pro trial"
3. Feature highlight: 3 Pro features they'll lose access to
4. CTA: "Upgrade Now" button
5. Footer: Link to pricing page, unsubscribe (if applicable)

### 3-Day Reminder Email

**Subject:** 3 days left in your Ptah Pro trial

**Body Sections:**

1. Personalized greeting
2. Urgency message: "Only 3 days left to upgrade"
3. Brief Pro vs Community comparison
4. CTA: "Upgrade to Pro" button
5. Footer

### 1-Day Reminder Email

**Subject:** Your Ptah Pro trial ends tomorrow

**Body Sections:**

1. Personalized greeting
2. Urgent message: "Last chance - trial ends tomorrow"
3. What happens after trial: "You'll be moved to Community tier"
4. CTA: "Upgrade Now" button (prominent styling)
5. Footer

### Trial Expired Email

**Subject:** Your Ptah Pro trial has ended

**Body Sections:**

1. Personalized greeting
2. Status: "Your 14-day Pro trial has ended"
3. What changed: "You now have access to Community features"
4. Encouragement: "Upgrade anytime to restore Pro access"
5. CTA: "View Plans" button
6. Footer
