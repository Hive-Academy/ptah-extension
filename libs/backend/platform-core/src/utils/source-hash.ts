import { createHash } from 'node:crypto';

/** Hash the exact text of a clone body for draft freshness checks. */
export function formatSourceHash(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}
