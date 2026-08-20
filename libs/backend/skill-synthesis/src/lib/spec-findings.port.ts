/**
 * Port the enhancer uses to pull graded review findings for a subagent slug out
 * of `.ptah/specs`. Implemented by SpecHarvesterService; defaults to a no-op so
 * runtimes without a specs folder (or with the harvester disabled) still work.
 */
export interface SpecFindingsPort {
  getRecentFindings(slug: string): Promise<string | null>;
}

export const SPEC_FINDINGS_TOKEN = Symbol.for('PtahSpecFindings');

import { injectable } from 'tsyringe';

@injectable()
export class NoOpSpecFindings implements SpecFindingsPort {
  async getRecentFindings(): Promise<string | null> {
    return null;
  }
}
