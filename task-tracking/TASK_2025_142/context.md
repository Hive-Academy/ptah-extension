# TASK_2025_142: Trial Subscription Experience Enhancement

## User Request

Enhance the trial subscription experience with systematic improvements to trial expiration handling, user notifications, and conversion CTAs across both the extension and landing page.

## Background Investigation (Pre-Orchestration)

A comprehensive investigation was conducted revealing:

### Current Trial System

- **Trial Creation**: `LicenseService.createTrialLicense()` - 14-day Pro trial on signup
- **Expiration Check**: `LicenseService.verifyLicense()` returns `{ valid: false, tier: 'expired', reason: 'trial_ended' }`
- **RPC Response**: Includes `trialActive`, `trialDaysRemaining`, `reason` fields
- **Landing Page UI**: Profile header shows days remaining, Pro plan card has badge variants

### Identified Gaps

| Area                                | Current State                       | Gap                                            |
| ----------------------------------- | ----------------------------------- | ---------------------------------------------- |
| **Extension webview notifications** | RPC returns `reason: 'trial_ended'` | No dedicated modal/banner for trial expiration |
| **Email reminders**                 | None                                | No automated trial-ending email notifications  |
| **In-app countdown**                | Days remaining available via RPC    | No persistent banner in main chat view         |
| **Grace period**                    | Instant invalidation                | No soft landing before full lockout            |

## Task Type

**FEATURE** - New functionality for trial experience enhancement

## Complexity Assessment

**Medium-High** - Multiple components across frontend (extension webview + landing page) and backend (license server email integration)

## Affected Areas

1. **License Server** (`apps/ptah-license-server`)

   - Email service for trial reminders
   - Scheduled job for trial expiration emails (7-day, 3-day, 1-day, expired)

2. **Extension Webview** (`apps/ptah-extension-webview`, `libs/frontend`)

   - Trial countdown banner component
   - Trial-ended modal with upgrade CTA
   - Settings page trial status display

3. **Landing Page** (`apps/ptah-landing-page`)
   - Enhanced trial messaging on pricing page
   - Profile page trial status improvements

## Strategy

**FEATURE workflow**: PM → Architect → Team-Leader → QA

## References

- Trial system investigation: Explore agent output above
- License server: `apps/ptah-license-server/src/license/services/license.service.ts`
- Subscription state: `apps/ptah-landing-page/src/app/pages/pricing-page/subscription-state.service.ts`
- Pro plan card: `apps/ptah-landing-page/src/app/pages/pricing-page/components/pro-plan-card.component.ts`
