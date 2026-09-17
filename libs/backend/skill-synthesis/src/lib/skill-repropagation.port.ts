import type { QueryOrigin } from './internal-query.interface';

export type SkillRepropagationKind = 'skill' | 'agent' | 'command';

export interface SkillRepropagationPort {
  /**
   * @param origin Who caused the change (TASK_2026_437 FU-17b).
   *   `userInitiated: true` — an RPC click that awaits this call — must never
   *   wait for the background-work governor. Absent or `false` — auto-enhance
   *   from the curator interval, auto-promotion from invocation tracking — is
   *   background work a host may hold while a turn is generating.
   */
  repropagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
    origin?: QueryOrigin,
  ): Promise<void>;
}

export const SKILL_REPROPAGATION_TOKEN = Symbol.for('PtahSkillRepropagation');

import { injectable } from 'tsyringe';

@injectable()
export class NoOpSkillRepropagation implements SkillRepropagationPort {
  async repropagate(): Promise<void> {
    return;
  }
}
