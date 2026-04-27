/**
 * Zod schemas for {@link LicenseRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the license handler validates `license:setKey` input
 * via a hand-rolled regex (`/^ptah_lic_[a-f0-9]{64}$/`) and type guards, not
 * via Zod. No `z.object({...})` literals existed in `license-rpc.handlers.ts`
 * at the time of W0.B6 extraction.
 *
 * This empty export is kept so downstream batches can stub imports consistently
 * across every handler. If license validation moves to Zod in a future task
 * (e.g. to share the key-format regex between handler and tests), the schemas
 * belong here.
 */

export {};
