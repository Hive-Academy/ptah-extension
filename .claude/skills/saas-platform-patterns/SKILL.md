---
name: saas-platform-patterns
description: 'SaaS monetization patterns for NestJS. Use when designing free, trial and paid tiers, license keys, subscription state machines, checkout and customer portal flows, or pricing configuration. Not for webhook plumbing — use webhook-architecture.'
---

# SaaS Platform Patterns

## Apply

- Activate per Stage B monetization task; use discovery and the roadmap to choose the business model before implementing plans or entitlements.
- Treat subscription state as authoritative for access decisions. Make billing event processing idempotent and reconcile state with the provider.
- Separate license issuance and validation from checkout and portal flows. Keep provider credentials and webhook verification at integration boundaries.

## Model and integration decisions

| Model | Pricing need and fit | Complexity | Route |
| --- | --- | --- | --- |
| Freemium | Free tier with paid gates; developer tools and productivity apps | Medium | [Freemium model](references/freemium-model.md) |
| Trial-to-paid | Time-limited full access; B2B and enterprise software | Low | [Freemium model](references/freemium-model.md) for trial handling |
| Usage-based | API calls, storage, or compute; APIs and infrastructure | High | Define metering before provider integration |
| Seat-based | Per-user team pricing; collaboration and project management | Medium | Count active seats in the domain model |

Models can be combined; start with the simplest model that validates pricing. Keep plan definitions in static configuration, enforce feature gates on the server, and use locally synchronized subscription state instead of calling the payment API on every request.

The webhook architecture skill owns the HTTP and verification layers; this skill's subscription service is its domain handler. The backend patterns skill owns the abstract payment client and provider adapters. Use the workspace architect for placement: licensing in `shared/licensing`, payment adapters in `shared/payments`.

Deduplicate payment events before issuing licenses or changing subscriptions. Keep business rules behind the payment client interface so changing provider does not change domain logic.

## Load by task

- For plan tiers, feature limits, and upgrades, load [freemium model](references/freemium-model.md).
- For issuing, validating, renewing, and revoking licenses, load [license lifecycle](references/license-lifecycle.md).
- For subscription transitions and provider events, load [subscription state machine](references/subscription-state-machine.md).
- For hosted checkout and customer self-service, load [checkout and portal](references/checkout-and-portal.md).
