import { randomBytes } from 'node:crypto';

export const TASK_ID_SUFFIX_RE = /^[0-9a-f]{4}$/;

export function randomIdSuffix(): string {
  return randomBytes(2).toString('hex');
}
