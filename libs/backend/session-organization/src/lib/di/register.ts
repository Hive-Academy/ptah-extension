/**
 * session-organization DI registration helper.
 *
 * Pre-conditions (registered by the SDK and the platform before this lib in
 * both hosts):
 *  - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` (persistence-sqlite);
 *  - `SDK_TOKENS.SDK_SESSION_METADATA_STORE` and
 *    `SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY` (agent-sdk);
 *  - `PLATFORM_TOKENS.OUTPUT_CHANNEL` (platform-core).
 *
 * Post-conditions, only when the SQLite connection token is registered:
 *  - store, service and capture service resolve as singletons;
 *  - `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` resolves to the SAME
 *    service instance as `SESSION_ORGANIZATION_TOKENS.SERVICE` (`useToken`),
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
import { SESSION_ORGANIZATION_TOKENS } from './tokens';

export function registerSessionOrganizationServices(
  container: DependencyContainer,
): void {
  if (!container.isRegistered(PERSISTENCE_TOKENS.SQLITE_CONNECTION, true)) {
    return;
  }

  container.registerSingleton(
    SESSION_ORGANIZATION_TOKENS.STORE,
    SessionOrganizationStore,
  );
  container.registerSingleton(
    SESSION_ORGANIZATION_TOKENS.SERVICE,
    SessionOrganizationService,
  );
  container.register(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, {
    useToken: SESSION_ORGANIZATION_TOKENS.SERVICE,
  });
  container.registerSingleton(SessionOrganizationCaptureService);
}
