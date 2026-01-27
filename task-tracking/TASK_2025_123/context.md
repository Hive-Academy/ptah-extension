# Task Context - TASK_2025_123

## User Request

Implement reliable Paddle subscription management system with:

1. **Centralized Subscription API** - Backend API that checks Paddle API for subscription status, callable from both Angular landing page AND VS Code extension
2. **Webhook Failure Handling** - Store failed webhooks in database, provide user-initiated reconciliation (NOT cron job)
3. **Webhook-based Expiration Updates** - Use Paddle webhooks instead of cron jobs for license expiration
4. **Pre-checkout Validation** - Prevent duplicate subscriptions by checking Paddle API before checkout

## Task Type

FEATURE

## Complexity Assessment

Complex (multi-day implementation across backend, frontend, and extension)

## Strategy Selected

FEATURE: PM -> [Research] -> Architect -> Team-Leader -> QA

## Background Context

Current issues identified:

- Webhook failures cause subscriptions to exist in Paddle but not in our database
- Users can create duplicate subscriptions for the same email (screenshot evidence)
- No pre-checkout validation to block existing subscribers
- License expiration relies on non-existent cron job instead of webhooks

Paddle API constraints:

- Rate limit: 240 requests/minute per IP (plenty for our use case)
- Available endpoints: `list_customers` (by email), `list_subscriptions` (by customer_id)
- `create_customer_portal_session` for subscription management

## Key Design Decisions

1. **No cron jobs** - Use Paddle webhooks for all state changes
2. **User-initiated reconciliation** - Button on profile page, not automated
3. **Shared backend API** - Both landing page and VS Code extension call same endpoints
4. **Paddle as source of truth** - Verify against Paddle API before checkout

## Related Tasks

- TASK_2025_121: Two-Tier Paid Extension Model (current Paddle integration)
- TASK_2025_114: Paddle Subscription Integration (frontend implementation)
- TASK_2025_112: Production License System (research)

## Created

2026-01-27
