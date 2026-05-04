/**
 * Messaging Gateway e2e (TASK_2026_HERMES Track 4).
 *
 * Surface under test: `gateway:status`, `gateway:listBindings`,
 * `gateway:approveBinding`, `gateway:blockBinding`, `gateway:listMessages`
 * RPC methods backed by `@ptah-extension/messaging-gateway`.
 *
 * Why skipped:
 *   The RPC methods are registered on the in-process `cli-message-transport`
 *   but are not accessible via the `ptah interact` stdio inbound channel (which
 *   only surfaces `task.submit / task.cancel / session.shutdown / session.history`).
 *
 *   One-shot subcommand dispatching would work, but the `ptah gateway`
 *   subcommand group has not yet been added to `apps/ptah-cli/src/cli/router.ts`
 *   as of the Thoth hub work.
 *
 *   A direct in-process integration test (instantiating GatewayService with a
 *   fake IMessagingAdapter without the CLI) is also feasible but requires
 *   wiring the full tsyringe DI container (Logger, IWorkspaceProvider,
 *   ITokenVault, SqliteConnectionService) in the test — that level of harness
 *   setup is beyond the current e2e test conventions.
 *
 * When unblocked, the test flow is:
 *   1. tmp = await createTmpHome()
 *   2. Register a fake IMessagingAdapter for the 'telegram' platform.
 *   3. spawnOneshot(['gateway', 'status', '--json'])
 *      → assert result.enabled === false (default off).
 *   4. Simulate an inbound message from an unknown sender via the adapter.
 *   5. spawnOneshot(['gateway', 'list-bindings', '--json'])
 *      → assert one binding with approvalStatus === 'pending'.
 *   6. Assert the adapter received a pairing-code reply (no echo of user message).
 *   7. Extract bindingId; call spawnOneshot(['gateway', 'approve-binding',
 *      '--binding-id', bindingId, '--json'])
 *      → assert binding.approvalStatus === 'approved'.
 *   8. Simulate a second inbound message on the approved binding.
 *   9. spawnOneshot(['gateway', 'list-messages', '--binding-id', bindingId, '--json'])
 *      → assert ≥1 message row logged with direction === 'inbound'.
 *  10. tmp.cleanup()
 *
 * Stream coalescer assertion (when adapter supports edit callbacks):
 *   A 10-chunk burst injected via appendOutboundChunk should produce ≤3
 *   outbound adapter.editMessage calls within a 250ms window. This verifies
 *   the coalescer debounce logic from architecture §9.6.
 *
 * Prerequisite:
 *   - `ptah gateway status|start|stop|set-token|list-bindings|approve-binding|
 *       block-binding|list-messages` CLI subcommands in router.ts; OR
 *   - A harness helper that wires GatewayService with a fake adapter and exposes
 *     inbound injection without requiring the full DI container.
 */

describe.skip('messaging gateway e2e (TASK_2026_HERMES Track 4 — requires ptah gateway CLI subcommands)', () => {
  it('inbound message from unknown sender creates a pending binding and sends pairing code — no echo', () => {
    /* Stub — see file header. */
  });

  it('gateway:approveBinding transitions binding to approved status', () => {
    /* Stub — see file header. */
  });

  it('inbound on approved binding persists a gateway_messages row with direction inbound', () => {
    /* Stub — see file header. */
  });

  it('10-chunk outbound burst coalesces to ≤3 adapter edits within 250ms window', () => {
    /* Stub — see file header. */
  });

  it('gateway:blockBinding transitions binding to rejected and drops subsequent inbound', () => {
    /* Stub — see file header. */
  });

  it('gateway:listMessages returns rows scoped to a single bindingId', () => {
    /* Stub — see file header. */
  });
});
