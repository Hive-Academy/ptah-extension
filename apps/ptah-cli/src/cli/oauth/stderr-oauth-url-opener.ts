/**
 * StderrOAuthUrlOpener — IOAuthUrlOpener fallback used by one-shot CLI
 * commands (e.g. `ptah auth login copilot`) when there is no JSON-RPC peer
 * on stdio. Writes the verification URL + device code to stderr so a human
 * operator can open the URL and paste the code manually.
 *
 * Returns `{ opened: false }` so the caller knows the URL was NOT opened on
 * the user's behalf and that polling should still proceed (the user may
 * still complete the flow out-of-band in a browser).
 *
 * TASK_2026_104 Batch 8c.
 */

import type { IOAuthUrlOpener } from '@ptah-extension/platform-cli';

/** Writable stream signature compatible with `process.stderr` (and PassThrough in tests). */
export interface StderrLike {
  write(chunk: string | Uint8Array): boolean;
}

export class StderrOAuthUrlOpener implements IOAuthUrlOpener {
  constructor(private readonly stderr: StderrLike = process.stderr) {}

  async openOAuthUrl(params: {
    provider: string;
    verificationUri: string;
    userCode?: string;
  }): Promise<{ opened: boolean; code?: string }> {
    this.stderr.write(`Open this URL: ${params.verificationUri}\n`);
    if (params.userCode) {
      this.stderr.write(`Device code: ${params.userCode}\n`);
    }
    return { opened: false };
  }
}
