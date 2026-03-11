# Task Context - TASK_2025_134

## User Request

Add a "Get License Key" button to the profile/account page that allows users to securely retrieve their license keys associated with their subscription. Users already receive license keys via email, but need an in-app way to recover lost keys. The button should be in the Account Details section, call the license server API to fetch the user's active license keys, and display them securely.

## Task Type

FEATURE

## Complexity Assessment

Medium

## Strategy Selected

Partial: Architect -> Team-Leader -> Developers -> QA

## Key Findings from Research

1. **Profile Page Location**: `apps/ptah-landing-page/src/app/pages/profile/components/profile-details.component.ts`
2. **Parent Orchestrator**: `apps/ptah-landing-page/src/app/pages/profile/profile-page.component.ts`
3. **License Server API**: `apps/ptah-license-server/src/license/controllers/license.controller.ts`
4. **Current Security**: `GET /api/v1/licenses/me` explicitly excludes `licenseKey` - comment says "NEVER includes licenseKey in response"
5. **License Model**: Prisma schema has `licenseKey` field in License table
6. **LicenseData Interface**: `apps/ptah-landing-page/src/app/pages/profile/models/license-data.interface.ts`
7. **Existing Patterns**: Sync with Paddle button, Manage Subscription button already in ProfileDetailsComponent

## Conversation Summary

- User wants authenticated users to retrieve their license keys from the profile page
- Keys are currently only sent via email, users may lose them
- Need both backend API endpoint and frontend UI changes
- Must be secure (authenticated endpoint, rate-limited)

## Related Tasks

- TASK_2025_075: Simplified License Server
- TASK_2025_112: Production License System
- TASK_2025_121: Two-Tier Paid Extension Model
- TASK_2025_128: Freemium Model Conversion

## Created

2026-02-02
