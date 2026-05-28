import { z } from 'zod';
import { defineSetting } from './definition';

/**
 * Smithery registry API key.
 *
 * Stored in secure OS storage (scope/sensitivity 'secret') and read
 * backend-side only at resolve time — never serialized to the webview.
 *
 * `marketplaceSafeKey` provides a trademark-scanner-safe alternative key for
 * any code that generates package.json contributions (the VS Code Marketplace
 * scanner rejects trademarked product names in non-JS files).
 */
export const SMITHERY_API_KEY_DEF = defineSetting({
  key: 'smithery.apiKey',
  scope: 'secret',
  sensitivity: 'secret',
  marketplaceSafeKey: 'mcpRegistry.providerB.apiKey',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
