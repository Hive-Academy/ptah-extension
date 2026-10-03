/**
 * Cursor CLI agents: `{ws}/.cursor/agents/<id>.md`.
 *
 * Markdown with frontmatter, like the source. Cursor has no structured
 * follow-up-question tool, so `AskUserQuestion` degrades to the instruction
 * "ask the user directly in your response"; `Task` delegation becomes
 * `cursor agent --agent NAME`.
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
  yamlDoubleQuoted,
} from './transform-rules';

export class CursorAgentTransformer implements IHarnessAgentTransformer {
  readonly target: HarnessTargetId = 'cursor';

  readonly dirRel = '.cursor/agents';

  relPathFor(agentId: string): string {
    return `${this.dirRel}/${agentId}.md`;
  }

  transform(source: HarnessAgentSource): string {
    const description = resolveAgentDescription(
      source.content,
      undefined,
      source.agentId,
    );
    const content = transformAgentContent(
      source.content,
      'cursor',
      source.agentId,
      description,
    );
    const model = source.model;
    return model
      ? content.replace(
          /^---\n/,
          () => `---\nmodel: ${yamlDoubleQuoted(model)}\n`,
        )
      : content;
  }

  /** Same markdown frontmatter signature Copilot uses; same two generations. */
  isPtahOutput(content: string): boolean {
    return hasPtahFrontmatterSignature(content);
  }
}
