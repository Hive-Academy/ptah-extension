/**
 * Host routing DI registration (TASK_2026_857, Component 16).
 *
 * Binds `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` to a singleton
 * `HostRoutingCoordinator`. Electron-only by registration: only the Electron
 * composition root calls this, so VS Code and the CLI never bind the token and
 * `ChatSessionService` (which injects it as optional) admits no turns there.
 *
 * Call it after `registerSdkServices` (reminder queue, adapter events,
 * session-id registry), `registerLaneRoutingServices` (setting, scope check,
 * route decide, decision model config, reuse cache) and the binding of
 * `TOKENS.PTAH_API_BUILDER`.
 *
 * The coordinator is resolved lazily, together with `ChatSessionService`. A
 * required token missing at that moment would fail the chat service's
 * resolution, not just routing, because `isOptional` only covers an UNBOUND
 * token. So the required tokens are checked here, at bootstrap, the same way
 * `registerChatServices` checks its cross-lib precondition.
 */

import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { LANE_ROUTING_TOKENS } from '@ptah-extension/lane-routing';

import { CHAT_TOKENS } from '../tokens';
import { HostRoutingCoordinator } from './host-routing.coordinator';

/** Tokens `HostRoutingCoordinator` injects without `isOptional`. */
const REQUIRED_TOKENS: ReadonlyArray<readonly [string, symbol]> = [
  ['TOKENS.LOGGER', TOKENS.LOGGER],
  [
    'LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING',
    LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING,
  ],
  [
    'LANE_ROUTING_TOKENS.SCOPE_CHECK_SERVICE',
    LANE_ROUTING_TOKENS.SCOPE_CHECK_SERVICE,
  ],
  [
    'LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE',
    LANE_ROUTING_TOKENS.ROUTE_DECIDE_SERVICE,
  ],
  [
    'LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG',
    LANE_ROUTING_TOKENS.DECISION_MODEL_CONFIG,
  ],
  [
    'SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE',
    SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE,
  ],
  ['TOKENS.PTAH_API_BUILDER', TOKENS.PTAH_API_BUILDER],
];

export function registerHostRouting(container: DependencyContainer): void {
  // `isRegistered(token, true)` recurses to parent containers.
  const missing = REQUIRED_TOKENS.filter(
    ([, token]) => !container.isRegistered(token, true),
  ).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      'registerHostRouting(): register the host routing dependencies first ' +
        '(registerSdkServices, registerLaneRoutingServices and the Ptah API ' +
        `builder). Missing: ${missing.join(', ')}.`,
    );
  }
  container.registerSingleton(
    CHAT_TOKENS.HOST_ROUTING_COORDINATOR,
    HostRoutingCoordinator,
  );
}
