import { z } from 'zod';
import { defineSetting } from './definition';

/**
 * Gateway messaging token secrets.
 *
 * These store cipher text (encrypted bot tokens) in the global settings file.
 * The actual encryption/decryption is handled by the platform adapter layer.
 * Scope is 'secret' to signal that values must never be logged or displayed.
 */
export const GATEWAY_TELEGRAM_TOKEN_DEF = defineSetting({
  key: 'gateway.telegram.tokenCipher',
  scope: 'secret',
  sensitivity: 'secret',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});

export const GATEWAY_DISCORD_TOKEN_DEF = defineSetting({
  key: 'gateway.discord.tokenCipher',
  scope: 'secret',
  sensitivity: 'secret',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});

export const GATEWAY_SLACK_TOKEN_DEF = defineSetting({
  key: 'gateway.slack.tokenCipher',
  scope: 'secret',
  sensitivity: 'secret',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
