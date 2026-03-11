# TASK_2025_143: Landing Page Trial-Ended Status Display

## User Request

Fix the landing page to properly display trial-ended status for users whose trial has expired. Currently, the landing page doesn't show any indication that a trial has ended - users see generic "No License" messaging instead of specific trial-ended CTAs.

## Background (from TASK_2025_142 investigation)

TASK_2025_142 added trial UI components to the **extension webview** but marked landing page as "out of scope". Testing revealed the landing page has critical gaps.

### Current State

| Component               | Extension Webview | Landing Page                        |
| ----------------------- | ----------------- | ----------------------------------- |
| Trial countdown banner  | ✅ Implemented    | N/A (not needed)                    |
| Trial-ended modal       | ✅ Implemented    | ❌ MISSING                          |
| `reason` field in API   | ✅ Uses `/verify` | ❌ `/licenses/me` doesn't return it |
| Upgrade CTA for expired | ✅ Works          | ❌ Shows generic message            |

### Root Cause Analysis

1. **API Gap**: `GET /licenses/me` doesn't include `reason` field (only `POST /verify` does)
2. **Interface Gap**: `LicenseData` interface has no `reason` field
3. **UI Gap**: No trial-ended modal/banner component on landing page
4. **Detection Gap**: No logic to check `reason === 'trial_ended'`

## Task Type

**BUGFIX/FEATURE** - Fix missing functionality that was expected but not implemented

## Scope

### IN SCOPE

1. **Backend**: Add `reason` field to `/licenses/me` response
2. **Frontend Interface**: Add `reason` to `LicenseData` interface
3. **Profile Page**: Create trial-ended modal, wire up display logic
4. **Pricing Page**: Add trial-ended banner/CTA for expired users

### OUT OF SCOPE

- Automatic subscription status updates (keep request-time verification)
- Email reminder changes (already done in TASK_2025_142)
- Extension webview changes (already complete)

## Affected Files

### Backend

- `apps/ptah-license-server/src/license/controllers/license.controller.ts` - Add `reason` to response

### Frontend (Landing Page)

- `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts` - Add `reason` field
- `apps/ptah-landing-page/src/app/pages/profile/components/trial-ended-modal.component.ts` - NEW
- `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts` - Wire up modal
- `apps/ptah-landing-page/src/app/pages/pricing-page/` - Add trial-ended banner

## References

- Extension modal to port: `libs/frontend/chat/src/lib/components/molecules/trial-ended-modal.component.ts`
- License verification: `apps/ptah-license-server/src/license/services/license.service.ts:156-168`
- Profile page: `apps/ptah-landing-page/src/app/pages/profile/`
