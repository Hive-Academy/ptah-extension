---
name: webhook-architecture
description: 'Three-layer NestJS design for inbound webhooks. Use when adding a webhook endpoint, verifying signatures, routing external events, idempotent processing or failed-delivery recovery. Not for billing or subscription logic — use saas-platform-patterns.'
---

# 3-Layer Webhook Architecture

## Apply

- Implement each inbound provider webhook in its Stage B domain module. Keep HTTP extraction, verification/routing, and domain handling in separate layers.
- Preserve the raw request bytes for signature verification. Verify before parsing or dispatching an event.
- Deduplicate provider event IDs before applying domain mutations. Catch and persist handler failures in the webhook service, then acknowledge with 200 so provider retries do not duplicate processing; consult the recovery guide for exceptions.
- Keep provider-specific event mapping in the webhook service; route each event type to one domain handler method, which owns its business changes.

## Load by task

- For controller, verification service, domain handler, and module wiring, load [three-layer pattern](references/three-layer-pattern.md).
- For SDK verification or HMAC, timestamp, and raw body requirements, load [signature verification](references/signature-verification.md).
- For idempotency, failed delivery storage, response handling, and retry queues, load [resilience and recovery](references/resilience-and-recovery.md).
