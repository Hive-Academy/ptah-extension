/**
 * Copilot CLI agents: `{ws}/.github/agents/<id>.agent.md`.
 *
 * Same markdown-with-frontmatter shape as the source, so the transform is a
 * rewrite rather than a reformat: `AskUserQuestion` becomes
 * `ask_followup_question`, `Task` delegation becomes `copilot --agent NAME`,
 * slash commands become `copilot <command>`, and `@ptah-extension/*` import
 * lines are stripped because they mean nothing outside this repo.
 *
 * The `.agent.md` suffix is Copilot's, not a Ptah convention — a plain `.md`
 * file in that directory is not discovered.
 */

import type { HarnessTargetId } from '@ptah-extension/shared';
import {
  hasPtahFrontmatterSignature,
  type HarnessAgentSource,
  type IHarnessAgentTransformer,
} from './agent-transformer.port';
import {
  resolveAgentDescription,
  transformAgentContent,
} from './transform-rules';

export class CopilotAgentTransformer implements IHarnessAgentTransformer {
  readonly target: HarnessTargetId = 'copilot';

  readonly dirRel = '.github/agents';

  relPathFor(agentId: string): string {
    return `${this.dirRel}/${agentId}.agent.md`;
  }

  transform(source: HarnessAgentSource): string {
    const description = resolveAgentDescription(
      source.content,
      undefined,
      source.agentId,
    );
    return transformAgentContent(
      source.content,
      'copilot',
      source.agentId,
      description,
    );
  }

  /**
   * `source: ptah` in the frontmatter — emitted by this transformer and, before
   * it, by `MultiCliAgentWriterService` through the same `rewriteFrontmatter`.
   * One test covers both generations of `.github/agents/*.agent.md`.
   */
  isPtahOutput(content: string): boolean {
    return hasPtahFrontmatterSignature(content);
  }
}
