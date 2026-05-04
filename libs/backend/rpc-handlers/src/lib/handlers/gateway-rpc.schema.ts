/**
 * Zod schemas for {@link GatewayRpcHandlers}.
 *
 * INTENTIONALLY EMPTY — the gateway handler validates its params via the
 * static TypeScript types from `@ptah-extension/shared` (`GatewaySetTokenParams`,
 * `GatewayApproveBindingParams`, etc.) plus inline guard clauses (the
 * `params.platform === 'slack' && !params.slackAppToken` check in
 * `registerSetToken`, the `bindingId` presence checks in approve/block/list).
 *
 * If a future task moves any of those inline guards to Zod (e.g. to validate
 * pairing-code shape on the wire), those schemas belong here.
 */

export {};
