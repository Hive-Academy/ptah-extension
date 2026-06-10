export type SkillRepropagationKind = 'skill' | 'agent' | 'command';

export interface SkillRepropagationPort {
  repropagate(
    kind: SkillRepropagationKind,
    slug: string,
    workspaceRoot: string,
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
