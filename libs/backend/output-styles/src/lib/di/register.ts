/**
 * output-styles DI registration helper.
 *
 * Mirrors `registerTaskSpecsServices`. Pre-conditions:
 *  - `TOKENS.LOGGER` is registered (vscode-core).
 *  - `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER` and
 *    `PLATFORM_TOKENS.WORKSPACE_PROVIDER` are registered (Phase 1 adapters).
 *  - `SETTINGS_TOKENS.SETTINGS_STORE` is registered — `SESSION_ACTIVATION`
 *    reads the persisted selection through it. Injection is lazy, so the order
 *    of the two `register*` calls does not matter, only that both ran before
 *    the first resolve.
 *
 * Post-condition: all five `OUTPUT_STYLE_TOKENS` resolve as singletons.
 *
 * `OutputStyleActivationResolver` has no constructor dependencies at all — it
 * is registered here anyway so every consumer reaches the decision through the
 * same token rather than importing the pure function directly and quietly
 * growing a second decision point (R3).
 *
 * No plugin-roots registration: plugin-tier discovery is deferred.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { ClaudeSettingsWriter } from '../claude-settings.writer';
import { OutputStyleActivationResolver } from '../output-style-activation.resolver';
import { OutputStyleDiscoveryService } from '../output-style-discovery.service';
import { OutputStyleFileWriter } from '../output-style-file.writer';
import { OutputStyleSessionActivationService } from '../output-style-session-activation.service';
import { OUTPUT_STYLE_TOKENS } from './tokens';

export function registerOutputStyleServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[output-styles] registering services');

  container.registerSingleton(OutputStyleDiscoveryService);
  container.register(OUTPUT_STYLE_TOKENS.DISCOVERY, {
    useToken: OutputStyleDiscoveryService,
  });

  container.registerSingleton(OutputStyleFileWriter);
  container.register(OUTPUT_STYLE_TOKENS.FILE_WRITER, {
    useToken: OutputStyleFileWriter,
  });

  container.registerSingleton(ClaudeSettingsWriter);
  container.register(OUTPUT_STYLE_TOKENS.CLAUDE_SETTINGS_WRITER, {
    useToken: ClaudeSettingsWriter,
  });

  container.registerSingleton(OutputStyleActivationResolver);
  container.register(OUTPUT_STYLE_TOKENS.ACTIVATION_RESOLVER, {
    useToken: OutputStyleActivationResolver,
  });

  container.registerSingleton(OutputStyleSessionActivationService);
  container.register(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION, {
    useToken: OutputStyleSessionActivationService,
  });

  logger.info('[output-styles] services registered', {
    tokens: [
      'DISCOVERY',
      'FILE_WRITER',
      'CLAUDE_SETTINGS_WRITER',
      'ACTIVATION_RESOLVER',
      'SESSION_ACTIVATION',
    ],
  });
}
