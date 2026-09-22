/**
 * OpenCode subagents: `{ws}/.opencode/agent/<id>.md`.
 *
 * OpenCode discovers skills from `.claude/skills` and `.agents/skills` on its
 * own and receives Ptah's MCP server at spawn time through
 * `OPENCODE_CONFIG_CONTENT`, but it saw NONE of Ptah's subagents: nothing ever
 * wrote its agent format. This transformer is that missing half.
 *
 * ## Verified against opencode v2.0.12 (live probe, 2026-09-22)
 *
 * Probe agents were written into a real OpenCode project and read back through
 * the running server's `GET /api/agent`. Three facts came out of it, and each
 * one is load-bearing here:
 *
 * 1. **Both `.opencode/agent` and `.opencode/agents` are scanned.** The
 *    singular spelling is what `opencode agent create --path` documents as its
 *    project default, so that is what we write. The plural one loads too, which
 *    means a user who already keeps agents there is unaffected either way.
 * 2. **Unknown frontmatter keys are tolerated.** An agent carrying `name`,
 *    `source: ptah` and `target-cli: opencode` loaded with its `description`
 *    and `mode` intact. That is what lets this format keep the same
 *    `source: ptah` ownership signature the Copilot and Cursor markdown
 *    transformers use — see {@link hasPtahFrontmatterSignature}.
 * 3. **An unresolvable `model` DROPS THE WHOLE AGENT.** A probe identical to a
 *    loading one except for `model: opus` did not appear in the agent list at
 *    all — not degraded, not defaulted, absent. Claude's model tiers (`opus`,
 *    `sonnet`) are not OpenCode model ids, and OpenCode wants a
 *    `provider/model` pair it can resolve. So `model` is NEVER emitted and the
 *    subagent inherits the session's model, exactly as
 *    `CodexAgentTransformer` decided for the same reason. Mapping a tier here
 *    would silently delete every synced agent.
 *
 * Frontmatter is rewritten rather than passed through, because `mode: subagent`
 * is structural — it is what makes OpenCode treat the file as a delegate
 * instead of a primary agent — and the source's Claude frontmatter carries
 * keys (`tools`, `model`) whose values mean nothing here.
 */

import type { HarnessTargetId } from '@ptah-extension/shared';
import {
  hasPtahFrontmatterSignature,
  type HarnessAgentSource,
  type IHarnessAgentTransformer,
} from './agent-transformer.port';
import {
  resolveAgentDescription,
  transformAgentBody,
  yamlDoubleQuoted,
} from './transform-rules';

export class OpencodeAgentTransformer implements IHarnessAgentTransformer {
  readonly target: HarnessTargetId = 'opencode';

  /**
   * Singular `agent`, not `agents`. Both are scanned by v2.0.12, but the
   * singular form is the one `opencode agent create` defaults to for a project,
   * so it is the directory a user is most likely to already recognise.
   */
  readonly dirRel = '.opencode/agent';

  relPathFor(agentId: string): string {
    return `${this.dirRel}/${agentId}.md`;
  }

  transform(source: HarnessAgentSource): string {
    const description = resolveAgentDescription(
      source.content,
      undefined,
      source.agentId,
    );
    const body = transformAgentBody(source.content, 'opencode');

    const frontmatter = [
      '---',
      `description: ${yamlDoubleQuoted(description)}`,
      'mode: subagent',
      'source: ptah',
      `target-cli: ${this.target}`,
      '---',
    ].join('\n');

    return `${frontmatter}\n\n${body}\n`;
  }

  /**
   * `source: ptah` in the frontmatter, the same proof the other two markdown
   * transformers accept.
   *
   * This target has no predecessor generation to recognise: nothing before it
   * ever wrote `.opencode/agent`, so every file there carrying the signature
   * came out of THIS transformer, and every file without one is the user's.
   */
  isPtahOutput(content: string): boolean {
    return hasPtahFrontmatterSignature(content);
  }
}
