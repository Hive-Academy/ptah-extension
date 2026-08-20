/**
 * Codex native subagents: `{ws}/.codex/agents/<id>.toml`.
 *
 * Codex (GA 2026-03) reads project-scoped subagents as standalone TOML files.
 * `name` and `description` are structural fields; the whole instruction body
 * goes into `developer_instructions`. That is why this transformer strips the
 * YAML frontmatter instead of rewriting it — the metadata is carried by TOML,
 * and leaving `---` blocks in the instructions would just feed Codex noise.
 *
 * `model` is deliberately never emitted: Claude model hints (`opus`, `sonnet`)
 * are not valid Codex models, so a subagent inherits the parent session's.
 */

import type { HarnessTargetId } from '@ptah-extension/shared';
import type {
  HarnessAgentSource,
  IHarnessAgentTransformer,
} from './agent-transformer.port';
import { resolveAgentDescription, transformAgentBody } from './transform-rules';

/** Escape a value for a single-line TOML basic string. */
function tomlBasicString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * Escape a value for a multi-line TOML basic string (`"""..."""`).
 * Newlines are preserved literally; only backslashes and quotes are escaped so
 * no `"""` sequence can prematurely close the string.
 */
function tomlMultilineString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"""\n${escaped}\n"""`;
}

/**
 * Reviewer agents inspect code and must not mutate the workspace, so they run
 * in Codex's read-only sandbox. Everything else inherits the parent sandbox.
 */
function isReadOnlyAgent(agentId: string): boolean {
  return /reviewer$/.test(agentId);
}

/**
 * The writer signature, as a TOML comment.
 *
 * Codex's format has no frontmatter, so the `source: ptah` marker the markdown
 * transformers rely on has nowhere to live. Emitting it as a leading comment
 * gives `.codex/agents/*.toml` the same unambiguous proof of authorship the
 * other two formats have had all along — which is what lets a later pass adopt
 * a copy whose ownership record was lost instead of freezing on it forever.
 * A comment is inert TOML; Codex reads the file exactly as before.
 */
const CODEX_PTAH_MARKER = '# source: ptah';

export class CodexAgentTransformer implements IHarnessAgentTransformer {
  readonly target: HarnessTargetId = 'codex';

  readonly dirRel = '.codex/agents';

  relPathFor(agentId: string): string {
    return `${this.dirRel}/${agentId}.toml`;
  }

  transform(source: HarnessAgentSource): string {
    const description = resolveAgentDescription(
      source.content,
      undefined,
      source.agentId,
    );
    const instructions = transformAgentBody(source.content, 'codex');

    const lines = [
      CODEX_PTAH_MARKER,
      `name = ${tomlBasicString(source.agentId)}`,
      `description = ${tomlBasicString(description)}`,
    ];
    if (isReadOnlyAgent(source.agentId)) {
      lines.push('sandbox_mode = "read-only"');
    }
    lines.push(`developer_instructions = ${tomlMultilineString(instructions)}`);
    return `${lines.join('\n')}\n`;
  }

  /**
   * Two accepted proofs, because two pipelines wrote the files on disk.
   *
   * 1. **The marker.** Everything this transformer emits carries
   *    {@link CODEX_PTAH_MARKER}. Unambiguous.
   * 2. **The predecessor's shape.** `CodexSubagentTransformer` in the deleted
   *    `agent-generation/cli-agent-transforms/` emitted no marker, and its
   *    output is every `.codex/agents/*.toml` written before this lib existed.
   *    Its shape is distinctive: a top-level `name` key plus a
   *    `developer_instructions` multi-line basic string.
   *
   * The second test is a heuristic, and it is a bounded one: it is only ever
   * consulted for a path that is EXACTLY `.codex/agents/<id>.toml` for an `id`
   * the user layer carries, so a coincidence requires the user to have
   * hand-written a Codex subagent, in that shape, under one of Ptah's own agent
   * names. Weigh that against the alternative — the failure this fixes was 15
   * agents that no pass could ever repair, on every workspace that predates the
   * marker — and a regenerable file is the cheaper mistake.
   */
  isPtahOutput(content: string): boolean {
    if (/^#\s*source:\s*ptah\s*$/m.test(content)) return true;
    return (
      /^name\s*=\s*"/m.test(content) &&
      /^developer_instructions\s*=\s*"""/m.test(content)
    );
  }
}
