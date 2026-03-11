# TASK_2025_143: Tasks

## Batch 1: Backend API Fix

Status: IMPLEMENTED

### Task 1.1: Add `reason` field to `/licenses/me` response

- **Status**: IMPLEMENTED
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-license-server\src\license\controllers\license.controller.ts`
- **Description**: Modify the `GET /licenses/me` endpoint to include the `reason` field from license verification. When a user's trial has ended, the response should include `reason: 'trial_ended'`.
- **Acceptance Criteria**:
  - [x] `reason` field included in response when license verification returns it
  - [x] Returns `'trial_ended'` when subscription.status is 'trialing' but trialEnd < now
  - [x] Returns `'expired'` when license.status is 'expired'
  - [x] Returns `undefined` for active licenses

---

## Batch 2: Frontend Interface & Modal

Status: IMPLEMENTED

### Task 2.1: Add `reason` field to `LicenseData` interface

- **Status**: IMPLEMENTED
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\models\license-data.interface.ts`
- **Description**: Add optional `reason` field to the interface to capture trial-ended and other expiration reasons.
- **Acceptance Criteria**:
  - [x] `reason?: 'trial_ended' | 'expired' | 'revoked' | 'not_found'` added to interface

### Task 2.2: Create TrialEndedModalComponent for landing page

- **Status**: IMPLEMENTED
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\components\trial-ended-modal.component.ts`
- **Description**: Port the modal from extension (`libs/frontend/chat/.../trial-ended-modal.component.ts`) to landing page. Adapt for landing page context (use Angular Router instead of RPC).
- **Acceptance Criteria**:
  - [x] Modal displays when `reason === 'trial_ended'`
  - [x] Shows feature comparison (Pro vs Community)
  - [x] "Upgrade to Pro" button navigates to `/pricing`
  - [x] "Continue with Community" button closes modal
  - [x] 24-hour dismissal cooldown via localStorage
  - [x] DaisyUI styling consistent with landing page

### Task 2.3: Wire up modal in ProfilePageComponent

- **Status**: IMPLEMENTED
- **File(s)**:
  - `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\profile\profile-page.component.ts`
- **Description**: Import and render TrialEndedModalComponent, pass the `reason` from license data.
- **Acceptance Criteria**:
  - [x] Modal component imported and added to template
  - [x] `reason` passed from `license()?.reason`
  - [x] Modal displays when user's trial has ended

---

## Batch 3: Pricing Page Enhancement

Status: IMPLEMENTED

### Task 3.1: Add trial-ended banner to pricing page

- **Status**: IMPLEMENTED
- **File(s)**:
  - `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\pages\pricing\components\pricing-grid.component.ts`
- **Description**: Show a prominent banner at the top of the pricing page when user's trial has ended, encouraging them to upgrade.
- **Acceptance Criteria**:
  - [x] Banner displays when `subscriptionState.licenseReason() === 'trial_ended'`
  - [x] Banner has clear "Your trial has ended" message
  - [x] Banner highlights Pro plan benefits
  - [x] DaisyUI alert styling (warning variant)
  - [x] Dismissible with session storage

### Task 3.2: Update SubscriptionStateService to expose reason

- **Status**: IMPLEMENTED
- **File(s)**: `D:\projects\ptah-extension\apps\ptah-landing-page\src\app\services\subscription-state.service.ts`
- **Description**: Add a computed signal to expose the `reason` field from license data for easy access.
- **Acceptance Criteria**:
  - [x] `licenseReason` computed signal added
  - [x] Returns `licenseData()?.reason`

---

## Summary

| Batch | Focus                      | Tasks | Status      |
| ----- | -------------------------- | ----- | ----------- |
| 1     | Backend API                | 1     | IMPLEMENTED |
| 2     | Frontend Interface & Modal | 3     | IMPLEMENTED |
| 3     | Pricing Page Enhancement   | 2     | IMPLEMENTED |

**Total Tasks**: 6
