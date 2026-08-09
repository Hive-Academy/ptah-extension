/**
 * Messaging Gateway UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need gateway services without pulling the gateway tab
 * component — and the Thoth shell graph behind it — into the bundle:
 *
 *   import { GatewayStateService } from '@ptah-extension/messaging-gateway-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { MessagingGatewayTabComponent } from '@ptah-extension/messaging-gateway-ui';
 *
 * `GatewayStateService` is a `MESSAGE_HANDLERS` entry constructed at bootstrap
 * to receive gateway push messages — it must stay EAGER. Only the components
 * are deferred (TASK_2026_187, I-3/R4).
 */

export { GatewayStateService } from './lib/services/gateway-state.service';
export { GatewayRpcService } from './lib/services/gateway-rpc.service';
