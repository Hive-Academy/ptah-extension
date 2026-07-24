import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Repo root, resolved from this file: src/support -> src -> app -> apps -> root */
export const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/**
 * Minimal `.env` parser — identical shape to the `loadEnv()` in
 * `scripts/discourse-e2e.mjs` so the e2e harness and the backend-contract
 * scripts read secrets the same way (one source of truth for JWT_SECRET etc.).
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(join(REPO_ROOT, '.env'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export const env = loadEnv();
