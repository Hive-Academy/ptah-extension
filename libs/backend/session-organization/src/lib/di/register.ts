/**
 * session-organization DI registration helper.
 *
 * Pre-conditions (registered by the SDK and the platform before this lib in
 * both hosts):
 *  - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` (persistence-sqlite);
 *  - `SDK_TOKENS.SDK_SESSION_METADATA_STORE`,
 *    `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` and
 *    `SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY` (agent-sdk);
 *  - `PLATFORM_TOKENS.OUTPUT_CHANNEL` (platform-core).
 *
 * Post-conditions, only when the SQLite connection token is registered:
 *  - store, service, capture service, auto-link store and services (the
 *    auto-link service also needs `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` and
 *    the two prompt registries; the task index service is optional) resolve
 *    as singletons;
 *  - `SESSION_ORGANIZATION_TOKENS.SIDE_TABLES` aliases the auto-link store,
 *    the main store's transaction participant;
 *  - `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` and the
 *    `SessionOrganizationService` class resolve to the SAME service instance
 *    as `SESSION_ORGANIZATION_TOKENS.SERVICE` (`useToken`),
 *    so the port the producers write through and the API the RPC handlers
 *    read through share one change stream.
 *
 * Without the connection the lib binds nothing: the recorder port stays
 * unregistered and its optional consumers skip capture. Registration has no
 * side effects — nothing is resolved, opened or subscribed here;
 * `startSessionOrganization` does the subscribing.
 */
import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { SessionOrganizationStore } from '../session-organization.store';
import { SessionOrganizationService } from '../session-organization.service';
import { SessionOrganizationCaptureService } from '../session-organization-capture.service';
import { SessionAutoLinkStore } from '../session-auto-link.store';
import { SessionAutoLinkService } from '../session-auto-link.service';
import { SessionTodoProgressService } from '../session-todo-progress.service';
import { SESSION_ORGANIZATION_TOKENS } from './tokens';

export function registerSessionOrganizationServices(
  container: DependencyContainer,
): void {
  if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)) {
    return;
  }

  // The side tables first: the main store requires them as its transaction
  // participant (SIDE_TABLES aliases the same singleton).
  container.registerSingleton(
    SESSION_ORGANIZATION_TOKENS.AUTO_LINK_STORE,
    SessionAutoLinkStore,
  );
  container.register(SESSION_ORGANIZATION_TOKENS.SIDE_TABLES, {
    useToken: SESSION_ORGANIZATION_TOKENS.AUTO_LINK_STORE,
  });
  container.registerSingleton(
    SESSION_ORGANIZATION_TOKENS.STORE,
    SessionOrganizationStore,
  );
  container.registerSingleton(
    SESSION_ORGANIZATION_TOKENS.SERVICE,
    SessionOrganizationService,
  );
  // The class itself aliases the SERVICE singleton too, so resolving by class
  // can never build a second instance with its own change stream.
  container.register(SessionOrganizationService, {
    useToken: SESSION_ORGANIZATION_TOKENS.SERVICE,
  });
  container.register(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, {
    useToken: SESSION_ORGANIZATION_TOKENS.SERVICE,
  });
  container.registerSingleton(SessionOrganizationCaptureService);
  container.registerSingleton(SessionAutoLinkService);
  container.registerSingleton(SessionTodoProgressService);
}
